import type {Middleware, PayloadAction} from "@reduxjs/toolkit";
import type {WSMessage} from "@/infrastructure/types.ts";
import type {AppDispatch, RootState} from "@/store/store.ts";
import {chatApi} from "@/features/chat/rest/chatApi.ts";
import {groupApi} from "@/features/groups/rest/groupApi.ts";
import {chatMessagesService} from "@/features/chat/model/services/chatMessages.service.ts";
import {wireToChatMessage} from "@/features/chat/model/mapper.ts";
import {buildChatAck, buildReadIn, type WireMessage} from "@/features/chat/model/schema/wireMessage.schema.ts";
import {bumpActivity, markChatUnread, setPeerLastReadId, setTyping} from "@/features/chat/model/slices/chatUiSlice.ts";
import {markSent} from "@/features/chat/model/slices/outboxSlice.ts";
import {logger} from "@/shared/logger/logger.ts";
import {playNotificationSound} from "@/shared/sound/notify.ts";
import {showDesktopNotification} from "@/features/notifications";
import i18n from "@/shared/i18n";

// How long a "peer is typing" indicator lingers before auto-clearing if no follow-up frame.
const TYPING_TIMEOUT_MS = 4000;

/**
 * Routes incoming chat/read/typing WS frames per-frame, the same way presenceMiddleware routes
 * PRESENT_* frames. This is deliberately NOT a React effect on `ws.lastIncoming`: that slot holds
 * only the LAST frame, so a burst of frames arriving between renders would drop all but the last
 * (lost messages + missing ACKs). Reacting to every `ws/incoming` action here processes each frame
 * exactly once, synchronously, before the next one can overwrite anything.
 */
export const chatMiddleware: Middleware = (store) => (next) => (action) => {
    const result = next(action);
    const a = action as PayloadAction<WSMessage>;
    if (a?.type !== "ws/incoming") return result;

    const frame = a.payload as WireMessage;
    const st = store.getState();
    const myId = st.user?.id as string;
    const selectedChatId = (st.chatUi?.selectedChatId as string | null) ?? null;
    // The middleware's dispatch is typed as plain Dispatch; cast to the app's ThunkDispatch so
    // RTK Query thunks (updateQueryData / initiate) type-check like they do in the services.
    const dispatch = store.dispatch as AppDispatch;

    switch (frame?.type) {
        case "CHAT_OUT": {
            const msg = wireToChatMessage(frame);
            const chatId = msg.chatId;
            if (!chatId) break;

            // Bump last-activity so the chat sorts to the top of the list on a new message (live).
            dispatch(bumpActivity({chatId, at: msg.createdAt.getTime()}));

            // Append to the open conversation's history (idempotent). No-op if that query has
            // no subscriber (chat not open) — the message loads over REST when it's opened.
            dispatch(
                chatApi.util.updateQueryData("getChatHistory", {myId, chatId}, (draft) => {
                    if (!draft) return;
                    // Client-side dedup: drop a duplicate live delivery by server id OR by the
                    // sender's original client messageId (clientId ← correlationId). The latter
                    // catches a lost-ACK resend, which the backend stores under a fresh server id.
                    const dup = draft.some(
                        (m) => m.id === msg.id || (!!msg.clientId && m.clientId === msg.clientId)
                    );
                    if (!dup) draft.push(msg);
                })
            );

            // NOTE: we do NOT infer the peer's read state from an incoming message. Receiving a
            // reply does not imply the peer read my earlier messages — messages can cross (I send A,
            // the peer sends B without having seen A), which would light up a false ✓✓. The peer's
            // read state comes only from the receipts projection (history load) and the READ_OUT
            // frame below.

            // If this conversation isn't in the chat list yet (first message from a new peer),
            // refetch the list so the chat appears — but via the preserve-selected helper, NOT a bare
            // invalidateTags: a plain refetch would drop a freshly-created, still-hidden chat the user
            // has selected (GET /chats omits message-less convs), and the dangling-close would then
            // shut their open compose window.
            // The list spans two resources: DIRECT chats (getChats) and GROUPS (getGroups). Only treat
            // the conversation as "unknown" if it's in NEITHER — otherwise every incoming GROUP message
            // (never in getChats) would needlessly refetch /api/chats. If it's truly unknown, refresh the
            // direct list (preserve-selected) AND the groups list (covers being freshly added to a group).
            const inDirects = chatApi.endpoints.getChats.select({myId})(st)?.data
                ?.some((s) => s.conversationId === chatId);
            const inGroups = groupApi.endpoints.getGroups.select(undefined)(st)?.data
                ?.some((g) => g.id === chatId);
            if (!inDirects && !inGroups) {
                logger.debug("CHAT_OUT for unknown conversation, refreshing chat lists", chatId);
                chatMessagesService.refetchChatsPreservingSelected(dispatch, store.getState as () => RootState);
                dispatch(groupApi.endpoints.getGroups.initiate(undefined, {forceRefetch: true}));
            }

            // ACK delivery (SENT → DELIVERED; advances the server GC watermark).
            dispatch({type: "ws/send", payload: buildChatAck(frame)});
            clearTypingTimer(chatId);
            dispatch(setTyping({chatId, typing: false}));

            // "Actively viewing" = the chat is open AND the tab is visible. Only then is it truly
            // read; a message that arrives while the tab is hidden is marked unread (and the
            // deferred read fires when the tab regains focus — see useChat).
            const hidden = typeof document !== "undefined" && document.hidden;
            const active = chatId === selectedChatId && !hidden;
            if (active) {
                // Read boundary = this just-delivered message's id (a server ULID), so the peer's
                // durable receipt advances to it.
                if (frame.senderId) dispatch({type: "ws/send", payload: buildReadIn(chatId, frame.senderId, frame.messageId)});
            } else {
                dispatch(markChatUnread(chatId));
                // Best-effort notify when not actively viewing.
                playNotificationSound();
                // Pass the server message id so the SW arbiter can dedup this online notification
                // against an offline Web Push for the SAME message (both carry the server ULID).
                if (hidden) showDesktopNotification(i18n.t("chat.newMessage"), msg.text || "", chatId, msg.id);
            }
            break;
        }

        case "CHAT_ACK": {
            if (!frame.correlationId) break;
            // Our queued message was accepted → drop it from the outbox. The message is ALREADY in
            // the open history (inserted optimistically at enqueue, keyed by the client messageId).
            // We deliberately do NOT re-read the history here: getChatHistory forward-pages the WHOLE
            // conversation, so a refetch per ACK re-downloaded up to thousands of rows just to swap
            // one temporary id for the server ULID — a real cost on every send. Instead we reconcile
            // in place: stamp the echo with the server timestamp so its ✓/✓✓ read-receipt timing
            // matches the server clock (the list is sorted by createdAt, and server stamps are
            // monotonic, so ordering is preserved). The temporary client id is upgraded to the real
            // ULID on the next natural read-through (the reconnect refetch in useChat). The ACK does
            // NOT carry the stored message's id — its messageId is the ack frame's own id.
            dispatch(markSent(frame.correlationId));
            const chatId = frame.conversationId ?? selectedChatId;
            const at = frame.serverTimestamp;
            // The STORED server ULID (backend contract: CHAT_ACK.serverMessageId — capture it!).
            // NOT messageId (that is the ack frame's own id). Reconciling my optimistic echo to it
            // lets a just-sent message match the peer's read watermark and flip to ✓✓ without a reload.
            const serverId = frame.serverMessageId;
            if (chatId && (typeof at === "number" || serverId)) {
                dispatch(
                    chatApi.util.updateQueryData("getChatHistory", {myId, chatId}, (draft) => {
                        const m = draft?.find(
                            (x) => x.clientId === frame.correlationId || x.id === frame.correlationId
                        );
                        if (!m) return;
                        // Reconcile the optimistic echo: swap its temporary client id for the real
                        // server ULID (so delete/read-boundary work by id), and stamp server time.
                        if (serverId) m.id = serverId;
                        if (typeof at === "number") m.createdAt = new Date(at);
                    })
                );
            }
            break;
        }

        case "READ_OUT": {
            // Live peer read progress (backend contract): correlationId = the peer's new read-up-to
            // (a server ULID). Advance the ✓✓ watermark without refetching history. ULID-guarded +
            // monotonic in the reducer.
            if (frame.conversationId && frame.correlationId) {
                dispatch(setPeerLastReadId({chatId: frame.conversationId, lastReadId: frame.correlationId}));
            }
            break;
        }

        case "SERVICE_OUT": {
            // Best-effort roster-change hint (ADR-024): payload.kind = member_joined | member_left for
            // a group, payload.body = the subject user id. Invalidate that group's roster so the
            // RosterPanel / header re-fetch the authoritative membership. Non-durable — missed while
            // offline; the self-heal in ChatWindow (unknown sender → refetch) covers the gaps.
            const chatId = frame.conversationId;
            const p = frame.payload as {kind?: string; body?: string} | undefined;
            const kind = p?.kind;
            if (chatId && (kind === "member_joined" || kind === "member_left")) {
                dispatch(chatApi.util.invalidateTags([{type: "Chat", id: `group-members:${chatId}`}]));
                // If *I* am the subject, my groups LIST changed — refetch it so a group I was just added
                // to appears in my chat list (or a group I was removed from drops) without a refresh.
                if (p?.body === myId) {
                    dispatch(groupApi.endpoints.getGroups.initiate(undefined, {forceRefetch: true}));
                }
            }
            break;
        }

        case "TYPING_OUT": {
            const chatId = frame.conversationId;
            if (!chatId) break;
            dispatch(setTyping({chatId, typing: true, author: frame.senderId}));
            // Auto-clear, replacing any pending timer for this chat (no unbounded timer pile-up).
            clearTypingTimer(chatId);
            typingTimers.set(
                chatId,
                setTimeout(() => {
                    typingTimers.delete(chatId);
                    dispatch(setTyping({chatId, typing: false}));
                }, TYPING_TIMEOUT_MS)
            );
            break;
        }
    }

    return result;
};

// Per-conversation "typing" auto-clear timers, so rapid TYPING_OUT frames don't stack timeouts.
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTypingTimer(chatId: string) {
    const t = typingTimers.get(chatId);
    if (t) {
        clearTimeout(t);
        typingTimers.delete(chatId);
    }
}
