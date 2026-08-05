import {Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {useDispatch, useSelector} from "react-redux";
import {useTranslation} from "react-i18next";
import type {AppDispatch, RootState} from "@/store/store";
import type {Contact} from "@/entities/contact";
import {setSelectedChatId} from "@/features/chat/model/slices/chatUiSlice.ts";
import {loadOlderHistory} from "@/features/chat/thunk/loadOlderHistory.ts";
import {useGetPresenceStatusQuery} from "@/features/chat/rest/chatApi.ts";
import {fmtLastSeen} from "@/features/chat/model/lastSeen.ts";
import {MESSAGE_WINDOW_INITIAL, MESSAGE_WINDOW_STEP} from "@/shared/config/chat.ts";
import {sameDay} from "@/shared/lib/datetime.ts";
import {ChatHeader} from "./ChatHeader.tsx";
import {Composer} from "./Composer.tsx";
import {MessageBubble, type ChatMessageView} from "./MessageBubble.tsx";
import {dateLabel} from "./messageFormat.tsx";

interface ChatWindowProps {
    chat: Contact | null;
    counterpartId?: string | null;
    messages: ChatMessageView[];
    historyError?: boolean;
    onReloadHistory?: () => void;
    inputText: string;
    setInputText: (value: string) => void;
    sendMessage: (text: string) => void;
    onDeleteChat: () => void;
    onCall: () => void;
    onTyping?: () => void;
    onToggleBlock?: () => void;
    blocked?: boolean;
    blockedByMe?: boolean;
    blockedByPeer?: boolean;
    onDeleteMessage?: (id: string) => void;
    onSendAttachment?: (file: File) => void;
    uploadProgress?: number | null;
    onDownloadAttachment?: (attachmentId: string) => void;
    onResolveAttachment?: (attachmentId: string) => Promise<string | null>;
    outboxStatusById?: Record<string, string>;
    onRetryMessage?: (id: string) => void;
    onDiscardMessage?: (id: string) => void;
}

function ChatWindow({
                        chat,
                        counterpartId,
                        messages,
                        historyError,
                        onReloadHistory,
                        inputText,
                        setInputText,
                        sendMessage,
                        onDeleteChat,
                        onCall,
                        onTyping,
                        onToggleBlock,
                        blocked,
                        blockedByMe,
                        blockedByPeer,
                        onDeleteMessage,
                        onSendAttachment,
                        uploadProgress,
                        onDownloadAttachment,
                        onResolveAttachment,
                        outboxStatusById,
                        onRetryMessage,
                        onDiscardMessage,
                    }: ChatWindowProps) {
    const {t} = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    // "Last seen" for an OFFLINE peer: fetch only while they're offline (online-ness comes live from
    // the presence slice; the timestamp only from this REST read). refetchOnMountOrArgChange gets a
    // fresh value each time the header re-opens or the peer transitions offline. Absent/legacy backend
    // (404) or a null timestamp → fmtLastSeen returns null → the header shows a plain "offline".
    const {data: peerPresence} = useGetPresenceStatusQuery(counterpartId ?? "", {
        skip: !counterpartId || !!chat?.online,
        refetchOnMountOrArgChange: true,
    });
    const lastSeenText = !chat?.online ? fmtLastSeen(peerPresence?.lastSeen ?? null, t) : null;

    const selectedChatId = useSelector(
        (state: RootState) => state.chatUi.selectedChatId
    );
    // The message id (server ULID) the peer has read up to. Server-driven: the history response
    // (HistoryPage.peerLastReadId) and the live READ_OUT frame (its correlationId) both feed it via
    // chatUi. A sent message shows ✓✓ iff its id <= this (ULID lexicographic == chronological).
    const peerLastReadId = useSelector((state: RootState) =>
        selectedChatId ? (state.chatUi.peerLastReadIdByChat[selectedChatId] ?? "") : ""
    );
    const peerTyping = useSelector((state: RootState) =>
        selectedChatId ? !!state.chatUi.typingByChat[selectedChatId] : false
    );

    const bottomRef = useRef<HTMLDivElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    // Track whether the user is at the bottom, so a new message doesn't yank them up out of the
    // history they're reading; unseenBelow drives the "↓ N new" jump button.
    const atBottomRef = useRef(true);
    const prevLenRef = useRef(messages.length);
    const [unseenBelow, setUnseenBelow] = useState(0);

    const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
        bottomRef.current?.scrollIntoView({behavior});
        atBottomRef.current = true;
        setUnseenBelow(0);
    };
    const onListScroll = () => {
        const el = listRef.current;
        const atBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 120 : true;
        atBottomRef.current = atBottom;
        if (atBottom && unseenBelow) setUnseenBelow(0);
    };

    // Windowed rendering: keep only the most recent messages in the DOM so a long history doesn't
    // reconcile hundreds of bubbles. "Show earlier" reveals another step. Reset to the tail when
    // switching chats.
    const [visibleCount, setVisibleCount] = useState(MESSAGE_WINDOW_INITIAL);
    // reachedStart: the server has no older page (loadOlderHistory returned 0). loadingOlder: a
    // network fetch is in flight. anchorRef: distance-from-bottom captured before revealing/loading
    // older, so we can restore the viewport after the taller list renders (no scroll jump).
    const [reachedStart, setReachedStart] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const anchorRef = useRef<number | null>(null);
    const prevLastIdRef = useRef<string | null>(null);
    // Set true when a chat opens; a layout effect lands the view at the newest message as soon as the
    // opened chat's rows actually render (history loads async, so scrolling on open-alone lands on an
    // empty/stale list — the "stuck in the middle" bug).
    const pendingBottomRef = useRef(true);
    useEffect(() => {
        setVisibleCount(MESSAGE_WINDOW_INITIAL);
        setReachedStart(false);
    }, [selectedChatId]);
    const shown = useMemo(
        () => (messages.length > visibleCount ? messages.slice(messages.length - visibleCount) : messages),
        [messages, visibleCount]
    );
    // More to reveal: either older messages already loaded in memory, or the server may have more.
    const hasEarlierInMemory = messages.length > visibleCount;
    const hasEarlier = hasEarlierInMemory || !reachedStart;

    // "Show earlier": first reveal in-memory older messages (windowing); once those run out, pull an
    // older page from the server (`?before=`) and reveal it too. Capture the scroll anchor first.
    const showEarlier = useCallback(async () => {
        if (loadingOlder) return;
        const el = listRef.current;
        anchorRef.current = el ? el.scrollHeight - el.scrollTop : null;
        if (hasEarlierInMemory) {
            setVisibleCount((c) => c + MESSAGE_WINDOW_STEP);
            return;
        }
        if (reachedStart || !selectedChatId) return;
        setLoadingOlder(true);
        try {
            const n = await dispatch(loadOlderHistory(selectedChatId));
            if (!n) setReachedStart(true);
            else setVisibleCount((c) => c + n); // reveal the freshly-prepended older messages
        } finally {
            setLoadingOlder(false);
        }
    }, [loadingOlder, hasEarlierInMemory, reachedStart, selectedChatId, dispatch]);

    // Restore the viewport after older messages render at the top: keep the same distance from the
    // bottom so the content the user was reading stays put (no jump).
    useLayoutEffect(() => {
        if (anchorRef.current == null) return;
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight - anchorRef.current;
        anchorRef.current = null;
    }, [shown.length]);

    // Opening a chat: reset trackers, arm the "land at bottom" flag, focus the composer (wide screens
    // only — don't pop the mobile keyboard on every open). LAYOUT effect (before paint) + defined
    // BEFORE the landing effect below, so pendingBottomRef is set before that effect reads it.
    useLayoutEffect(() => {
        atBottomRef.current = true;
        setUnseenBelow(0);
        pendingBottomRef.current = true;
        if (typeof window !== "undefined" && window.matchMedia?.("(min-width: 640px)").matches) {
            inputRef.current?.focus();
        }
    }, [selectedChatId]);

    // Land at the newest message once the opened chat's rows are present. Instant (scrollTop), not a
    // smooth animation that a re-render can interrupt. Waits for shown.length > 0 so an async history
    // load lands correctly instead of leaving the view mid-list. A rAF re-assert catches late layout
    // (e.g. images gaining height) so the view doesn't drift off the bottom right after opening.
    useLayoutEffect(() => {
        if (!pendingBottomRef.current || shown.length === 0) return;
        const el = listRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        atBottomRef.current = true;
        pendingBottomRef.current = false;
        requestAnimationFrame(() => {
            const e2 = listRef.current;
            if (e2 && atBottomRef.current) e2.scrollTop = e2.scrollHeight;
        });
    }, [selectedChatId, shown.length]);

    // Keep the view pinned to the newest message while we're at the bottom, even as content grows
    // AFTER paint — image attachments fetch + decode async and gain height later, which otherwise
    // pushes the last message up and strands the view mid-list ("scroll breaks after images load").
    // A ResizeObserver on the content re-pins to bottom on any such growth, but ONLY while we're at
    // the bottom (or still landing after open) — it never yanks a user who has scrolled up to read.
    useEffect(() => {
        const content = contentRef.current;
        const el = listRef.current;
        if (!content || !el || typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(() => {
            if (atBottomRef.current || pendingBottomRef.current) el.scrollTop = el.scrollHeight;
        });
        ro.observe(content);
        return () => ro.disconnect();
    }, []);

    // Follow to the bottom / count "unseen" ONLY when a message is APPENDED (newest id changes) —
    // never when older messages are PREPENDED (scroll-up load grows length but the last id is same),
    // which must not yank the view or inflate the "↓ N new" badge.
    const lastMessageId = messages.length ? messages[messages.length - 1].id : null;
    useEffect(() => {
        const grew = messages.length - prevLenRef.current;
        const appended = lastMessageId !== prevLastIdRef.current;
        prevLenRef.current = messages.length;
        prevLastIdRef.current = lastMessageId;
        if (!appended) return;                       // prepend (older page) → leave scroll untouched
        if (atBottomRef.current) {
            bottomRef.current?.scrollIntoView({behavior: "smooth"});
            setUnseenBelow(0);
        } else if (grew > 0) {
            setUnseenBelow((n) => n + grew);
        }
    }, [lastMessageId, messages.length]);

    // Open the window only when the conversation is actually in the list. Guards against a dangling
    // selectedChatId (e.g. a soft-deleted chat dropped from getChats on refetch) rendering an empty
    // window with no counterpart name and a dead composer.
    const isChatOpen = !!selectedChatId && !!chat;

    return (
        <main
            className={`relative h-full flex flex-col w-full overflow-hidden ${
                !isChatOpen ? "hidden" : "flex"
            }`}
        >
            {/* Header */}
            <ChatHeader
                chat={chat}
                peerTyping={peerTyping}
                lastSeenText={lastSeenText}
                blockedByMe={blockedByMe}
                onBack={() => dispatch(setSelectedChatId(null))}
                onCall={onCall}
                onToggleBlock={onToggleBlock}
                onDeleteChat={onDeleteChat}
            />

            {/* Messages */}
            <div ref={listRef} onScroll={onListScroll}
                 className="flex-1 overflow-y-auto overscroll-contain p-4 bg-gray-300">
                <div ref={contentRef}>
                {/* History failed to load (server error) — show it, don't render a silent empty chat. */}
                {historyError && (
                    <div className="mx-auto my-2 max-w-xs text-center text-sm bg-red-100 text-red-800 rounded-lg px-3 py-2">
                        {t("chat.historyLoadError", {defaultValue: "Couldn't load messages"})}
                        {onReloadHistory && (
                            <button onClick={() => onReloadHistory()} className="ml-2 underline font-medium">
                                {t("chat.retry")}
                            </button>
                        )}
                    </div>
                )}
                {hasEarlier && (
                    <button
                        onClick={showEarlier}
                        disabled={loadingOlder}
                        className="mx-auto block text-sm text-teal-800 hover:underline py-1 disabled:opacity-50"
                    >
                        {loadingOlder ? t("loading") : t("chat.loadEarlier")}
                    </button>
                )}
                {shown.map((msg, idx) => {
                    const prev = idx > 0 ? shown[idx - 1] : null;
                    const showDate = !prev || !sameDay(prev.createdAt, msg.createdAt);
                    // Tighten spacing for a run of consecutive same-sender messages (within 5 min).
                    const grouped = !!prev && !showDate && prev.fromMe === msg.fromMe
                        && (msg.createdAt - prev.createdAt) < 5 * 60 * 1000;
                    const bubbleMt = showDate ? "mt-0" : grouped ? "mt-0.5" : "mt-3";
                    return (
                    <Fragment key={msg.id}>
                    {showDate && (
                        <div className="text-center my-2">
                            <span className="inline-block text-[11px] text-gray-600 bg-white/70 rounded-full px-3 py-0.5">
                                {dateLabel(msg.createdAt, t)}
                            </span>
                        </div>
                    )}
                    <MessageBubble
                        msg={msg}
                        bubbleMt={bubbleMt}
                        peerLastReadId={peerLastReadId}
                        status={outboxStatusById?.[msg.id]}
                        onResolveAttachment={onResolveAttachment}
                        onDownloadAttachment={onDownloadAttachment}
                        onDeleteMessage={onDeleteMessage}
                        onRetryMessage={onRetryMessage}
                        onDiscardMessage={onDiscardMessage}
                    />
                    </Fragment>
                    );
                })}
                <div ref={bottomRef}/>
                </div>
            </div>

            {/* Jump-to-bottom when scrolled up and new messages arrived below */}
            {unseenBelow > 0 && (
                <button
                    onClick={() => scrollToBottom()}
                    className="absolute right-4 bottom-24 z-20 bg-teal-950 text-white text-xs rounded-full px-3 py-1.5 shadow-lg hover:bg-teal-900"
                >
                    ↓ {unseenBelow}
                </button>
            )}

            <Composer
                inputRef={inputRef}
                inputText={inputText}
                setInputText={setInputText}
                sendMessage={sendMessage}
                onTyping={onTyping}
                onSendAttachment={onSendAttachment}
                uploadProgress={uploadProgress}
                blocked={blocked}
                blockedByPeer={blockedByPeer}
            />
        </main>
    );
}

// Memoized so typing in the input / presence ticks (which re-render <Messenger>) don't re-render
// the whole window unless its own props change. Relies on Messenger passing memoized callbacks.
export default memo(ChatWindow);
