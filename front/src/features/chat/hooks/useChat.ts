import {useCallback, useMemo, useState, useEffect} from "react";
import {useDispatch, useSelector} from "react-redux";
import {setSelectedChatId} from "@/features/chat/model/slices/chatUiSlice";
import {rememberSticky, forgetSticky} from "@/features/chat/model/slices/stickyChatsSlice";
import type {AppDispatch, RootState} from "@/store/store";

import {useChatMessages} from "./useChatMessages";
import {useChatAttachments} from "./useChatAttachments";
import {useUnreadChats} from "./useUnreadChats";
import {useReadReceipts} from "./useReadReceipts";
import {useReconnectCatchup} from "./useReconnectCatchup";
import {useOutboxStatus} from "./useOutboxStatus";
import {useChatModeration} from "./useChatModeration";
import {useMessageComposer} from "./useMessageComposer";
import {useContacts} from "../../contacts/hooks/useContacts.ts";

import {logger} from "@/shared/logger/logger.ts";
import type {Contact} from "@/entities/contact";


export function useChat() {
    const dispatch = useDispatch<AppDispatch>();

    /* ======================
       UI state (local)
    ====================== */
    const [searchQuery, setSearchQuery] = useState("");

    /* ======================
       Global state
    ====================== */
    const myId = useSelector((state: RootState) => state.user.id);
    const selectedChatId = useSelector(
        (state: RootState) => state.chatUi.selectedChatId
    );

    /* ======================
       Contacts (chat list from GET /api/chats)
    ====================== */
    const {contacts, summaries, getContactById, getSummary, isLoadingIds} = useContacts();

    // Close a chat whose conversation is no longer in the (loaded) list — e.g. a soft-deleted/empty
    // chat the backend transiently lists then drops on a getChats refetch. Without this, ChatWindow
    // stays open (isChatOpen keys off selectedChatId) but getContactById/getSummary return null → no
    // counterpart name and a dead composer, silently with no error.
    useEffect(() => {
        if (!selectedChatId || isLoadingIds) return;
        if (!summaries.some((s) => s.conversationId === selectedChatId)) {
            logger.warn("selected chat not in the loaded list — closing (was a silent dead window)", {selectedChatId});
            dispatch(setSelectedChatId(null));
        }
    }, [selectedChatId, summaries, isLoadingIds, dispatch]);

    // Remember an opened DIRECT chat so it stays in the list even after it goes empty (the backend hides
    // message-less conversations from /api/chats). Re-storing the same summary is an Immer no-op, so this
    // settles (no loop) even though remembering feeds back into `summaries` → getSummary; a getChats
    // refetch just refreshes the stored snapshot once.
    useEffect(() => {
        if (!selectedChatId) return;
        const s = getSummary(selectedChatId);
        if (s && s.kind !== "group") dispatch(rememberSticky(s));
    }, [selectedChatId, getSummary, dispatch]);

    // Declared before the handlers that reference them (reloadChatHistory/clearChat/markRead).
    const {unreadChats, markRead} = useUnreadChats();
    const {messages, isError: historyError, reloadChatHistory, clearChat} = useChatMessages();

    // Attachment lifecycle (upload/download/resolve + progress) lives in its own hook.
    const {uploadProgress, sendAttachment, downloadAttachment, getAttachmentUrl} =
        useChatAttachments(selectedChatId, reloadChatHistory);

    const filteredChats = useMemo(
        () =>
            contacts.filter((c) =>
                c.name.toLowerCase().includes(searchQuery.toLowerCase())
            ),
        [contacts, searchQuery]
    );

    const selectedChat: Contact | null = useMemo(
        () => (selectedChatId ? getContactById(selectedChatId) : null),
        [selectedChatId, getContactById]
    );

    // The counterpart's USER id (for WebRTC signaling recipientId) — distinct from the
    // conversationId used as the chat/list key.
    const selectedCounterpartId = useMemo(
        () => (selectedChatId ? getSummary(selectedChatId)?.counterpartId ?? null : null),
        [selectedChatId, getSummary]
    );
    // Whether the open conversation is a GROUP — drives group rendering (author labels, no ✓✓,
    // no call/block, group header) across ChatWindow.
    const selectedIsGroup = useMemo(
        () => (selectedChatId ? getSummary(selectedChatId)?.kind === "group" : false),
        [selectedChatId, getSummary]
    );
    // Moderation (block flags + toggleBlock + deleteMessage) lives in its own hook.
    const {selectedBlocked, selectedBlockedByMe, selectedBlockedByPeer, toggleBlock, deleteMessage} =
        useChatModeration({selectedChatId, getSummary});

    // Incoming CHAT_OUT / CHAT_ACK / READ_OUT / TYPING_OUT are handled per-frame in chatMiddleware
    // (not a lastIncoming effect), so bursts of frames are never dropped.

    // Reconnect / resume catch-up (refresh list + open history on ws reconnect and on resume from
    // background) lives in its own hook.
    useReconnectCatchup({selectedChatId, reloadChatHistory});

    // Read-receipt (READ_IN) machinery lives in its own hook (boundary reader + the visible/connect/
    // newest triggers). It hands back the boundary reader and a sender for openChat.
    const newestMessageId = messages.length ? messages[messages.length - 1].id : null;
    const {sendReadReceipt} = useReadReceipts({selectedChatId, newestMessageId, getSummary, markRead});

    /* ======================
       Actions (memoized so <ChatWindow>/<ChatList> can be React.memo'd)
    ====================== */
    const openChat = useCallback(async (chatId: string) => {
        dispatch(setSelectedChatId(chatId));
        markRead(chatId);
        // Mark the conversation read on open (peer receives READ_OUT).
        sendReadReceipt(chatId);
    }, [dispatch, markRead, sendReadReceipt]);

    const deleteChat = useCallback(async () => {
        // Explicit delete: also forget it as sticky so it doesn't reappear as an "empty" chat.
        if (selectedChatId) dispatch(forgetSticky(selectedChatId));
        await clearChat();
        dispatch(setSelectedChatId(null));
    }, [clearChat, dispatch, selectedChatId]);

    // Outbox delivery status (per-message 🕐 / ⚠ + retry/discard) lives in its own hook.
    const {outboxStatusById, retryMessage, discardMessage} = useOutboxStatus({selectedChatId, myId});

    // Composer state + send + typing notifier live in their own hook.
    const {messageInput, setMessageInput, sendMessage, notifyTyping} =
        useMessageComposer({selectedChatId, myId, getSummary});

    return {
        contacts,
        filteredChats,
        selectedChat,
        selectedChatId,
        selectedCounterpartId,
        selectedIsGroup,
        selectedBlocked,
        selectedBlockedByMe,
        selectedBlockedByPeer,
        toggleBlock,
        deleteMessage,
        sendAttachment,
        uploadProgress,
        downloadAttachment,
        getAttachmentUrl,
        notifyTyping,
        messageInput,
        setMessageInput,
        searchQuery,
        setSearchQuery,
        openChat,
        sendMessage,
        deleteChat,
        unreadChats,
        messages,
        historyError,
        reloadChatHistory,
        outboxStatusById,
        retryMessage,
        discardMessage,
    };
}
