import {Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {useDispatch, useSelector} from "react-redux";
import {useTranslation} from "react-i18next";
import type {AppDispatch, RootState} from "@/store/store";
import type {Contact} from "@/features/contacts/model/schema/domainContract.schema.ts";
import {setSelectedChatId} from "@/features/chat/model/slices/chatUiSlice.ts";
import {loadOlderHistory} from "@/features/chat/thunk/loadOlderHistory.ts";
import {useGetPresenceStatusQuery} from "@/features/chat/rest/chatApi.ts";
import {fmtLastSeen} from "@/features/chat/model/lastSeen.ts";
import {MESSAGE_WINDOW_INITIAL, MESSAGE_WINDOW_STEP} from "@/shared/config/chat.ts";
import {isUlid} from "@/shared/ulid/ulid.ts";

// Local HH:mm for a message timestamp (epoch ms).
const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});

// Render message text with clickable links. Safe: builds React nodes (no HTML injection).
const URL_RE = /(https?:\/\/[^\s]+)/g;
function linkify(text: string) {
    return text.split(URL_RE).map((part, i) =>
        /^https?:\/\//.test(part)
            ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline break-all">{part}</a>
            : <Fragment key={i}>{part}</Fragment>
    );
}

const sameDay = (a: number, b: number) => {
    const x = new Date(a), y = new Date(b);
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};
// "Hoy" / "Ayer" / a localized date for the day-separator chips.
function dateLabel(ms: number, t: (k: string) => string) {
    const now = Date.now();
    const yesterday = now - 86_400_000;
    if (sameDay(ms, now)) return t("chat.today");
    if (sameDay(ms, yesterday)) return t("chat.yesterday");
    const d = new Date(ms);
    return d.toLocaleDateString([], {
        day: "2-digit",
        month: "short",
        year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    });
}

/** Inline thumbnail for image attachments. Presigned GET URLs expire, so it resolves
 *  a fresh URL on mount (per attachmentId). Click opens the full image in a new tab. */
function AttachmentImage({
                             attachmentId,
                             fileName,
                             resolveUrl,
                         }: {
    attachmentId: string;
    fileName: string;
    resolveUrl?: (attachmentId: string) => Promise<string | null>;
}) {
    const [url, setUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const resolveRef = useRef(resolveUrl);
    resolveRef.current = resolveUrl;

    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        setUrl(null);
        setFailed(false);
        // A JUST-uploaded image can briefly be unresolvable (presign/object not ready yet). Retry a
        // few times with backoff before giving up, instead of getting stuck on the "📎 attachment"
        // fallback forever (the one-shot resolve was the bug for recently-sent images).
        let tries = 0;
        const MAX = 4;
        const go = () => {
            resolveRef.current?.(attachmentId)
                .then((u) => {
                    if (!alive) return;
                    if (u) { setUrl(u); return; }
                    if (++tries < MAX) timer = setTimeout(go, 800 * tries);
                    else setFailed(true);
                })
                .catch(() => {
                    if (!alive) return;
                    if (++tries < MAX) timer = setTimeout(go, 800 * tries);
                    else setFailed(true);
                });
        };
        go();
        return () => { alive = false; if (timer) clearTimeout(timer); };
    }, [attachmentId, attempt]);

    // Failed after retries → tappable to try again (rather than a dead label).
    if (failed) return (
        <button onClick={() => setAttempt((a) => a + 1)} className="break-all underline decoration-dotted" title={fileName}>
            📎 {fileName} — ↻
        </button>
    );
    if (!url) return <span className="opacity-60 text-xs">🖼 cargando…</span>;
    return (
        <a href={url} target="_blank" rel="noopener noreferrer" title={fileName}>
            <img
                src={url}
                alt={fileName}
                onError={() => setFailed(true)}
                className="max-w-[200px] max-h-[200px] rounded-md object-cover"
            />
        </a>
    );
}

interface ChatMessageView {
    id: string;
    text: string;
    fromMe: boolean;
    createdAt: number;
    kind?: string;
    meta?: Record<string, string>;
}

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
    const fileRef = useRef<HTMLInputElement>(null);
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

    // Opening a chat lands at the newest message, resets trackers, and focuses the composer (only
    // on wide screens — avoid popping the mobile keyboard on every open).
    useEffect(() => {
        atBottomRef.current = true;
        setUnseenBelow(0);
        bottomRef.current?.scrollIntoView();
        if (typeof window !== "undefined" && window.matchMedia?.("(min-width: 640px)").matches) {
            inputRef.current?.focus();
        }
    }, [selectedChatId]);

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
            <div
                className="shrink-0 py-4 px-4 bg-teal-950 text-white border-b font-semibold flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => dispatch(setSelectedChatId(null))}
                        className="sm:hidden text-xl"
                        aria-label={t("chat.back")}
                        title={t("chat.back")}
                    >
                        ←
                    </button>
                    <span className="flex flex-col leading-tight">
                        <span>{chat?.name}</span>
                        <span className="text-xs font-normal">
                            {peerTyping
                                ? <span className="text-teal-300">{t("chat.typing")}</span>
                                : chat?.online
                                    ? <span className="text-green-400">● {t("chat.online")}</span>
                                    : <span className="text-gray-400">● {lastSeenText ? t("chat.lastSeen", {time: lastSeenText}) : t("chat.offline")}</span>}
                        </span>
                    </span>
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={onCall}
                        title={t("chat.call")}
                        aria-label={t("chat.call")}
                        className="hover:opacity-80 text-xl"
                    >
                        📞
                    </button>

                    <button
                        onClick={onToggleBlock}
                        title={blockedByMe ? t("chat.unblock") : t("chat.block")}
                        aria-label={blockedByMe ? t("chat.unblock") : t("chat.block")}
                        className="hover:opacity-80 text-xl"
                    >
                        {blockedByMe ? "🔓" : "🚫"}
                    </button>

                    <button
                        onClick={onDeleteChat}
                        title={t("chat.deleteChat")}
                        aria-label={t("chat.deleteChat")}
                        className="text-red-400 hover:text-red-500 text-xl"
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div ref={listRef} onScroll={onListScroll}
                 className="flex-1 overflow-y-auto overscroll-contain p-4 bg-gray-300">
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
                    <div
                        className={`${bubbleMt} max-w-xs px-4 py-2 rounded-lg text-sm whitespace-pre-wrap break-words ${
                            msg.fromMe
                                ? "ml-auto bg-teal-950 text-white rounded-br-none"
                                : "mr-auto bg-white text-teal-950 rounded-bl-none"
                        }`}
                    >
                        {msg.kind === "attachment" ? (
                            (msg.meta?.contentType ?? "").startsWith("image/") ? (
                                <AttachmentImage
                                    attachmentId={msg.meta?.attachmentId ?? ""}
                                    fileName={msg.meta?.fileName ?? msg.text ?? "imagen"}
                                    resolveUrl={onResolveAttachment}
                                />
                            ) : (
                                <button
                                    onClick={() => onDownloadAttachment?.(msg.meta?.attachmentId ?? "")}
                                    className="underline decoration-dotted break-all text-left"
                                    title="Descargar"
                                >
                                    📎 {msg.meta?.fileName ?? msg.text ?? "archivo"}
                                </button>
                            )
                        ) : (
                            linkify(msg.text)
                        )}
                        <span className="ml-2 text-[10px] align-bottom opacity-50">{fmtTime(msg.createdAt)}</span>
                        {msg.fromMe && (() => {
                            const st = outboxStatusById?.[msg.id];
                            if (st === "failed") {
                                return (
                                    <span className="ml-2 text-[10px] align-bottom">
                                        <span title={t("chat.failed")} className="text-red-300">⚠</span>
                                        <button onClick={() => onRetryMessage?.(msg.id)} title={t("chat.retry")}
                                                aria-label={t("chat.retry")}
                                                className="ml-1 opacity-70 hover:opacity-100">↻</button>
                                        <button onClick={() => onDiscardMessage?.(msg.id)} title={t("chat.discard")}
                                                aria-label={t("chat.discard")}
                                                className="ml-1 opacity-70 hover:opacity-100">🗑</button>
                                    </span>
                                );
                            }
                            if (st === "pending" || st === "sending") {
                                return (
                                    <span className="ml-2 text-[10px] align-bottom opacity-70" title={t("chat.sending")}>🕐</span>
                                );
                            }
                            // Per-message read state: read iff this message's id is at/below the peer's
                            // read boundary. BOTH sides must be server ULIDs for the string compare to be
                            // chronological. An optimistic message not yet reconciled by CHAT_ACK still
                            // carries its temporary nanoid id — comparing that against a ULID boundary is
                            // meaningless (nanoid's first char lands on either side of a ULID's at random),
                            // which produced intermittent false ✓✓. Guard with isUlid: no server id == not
                            // yet stored == cannot be read.
                            const isRead = !!peerLastReadId && isUlid(msg.id) && msg.id <= peerLastReadId;
                            return (
                                <span className="ml-2 text-[10px] align-bottom opacity-70"
                                      title={isRead ? t("chat.read") : t("chat.sent")}>
                                    {isRead ? "✓✓" : "✓"}
                                </span>
                            );
                        })()}
                        {onDeleteMessage && msg.fromMe && (
                            <button
                                onClick={() => onDeleteMessage(msg.id)}
                                title={t("chat.deleteMessage")}
                                aria-label={t("chat.deleteMessage")}
                                className="ml-2 text-[10px] opacity-40 hover:opacity-100"
                            >
                                🗑
                            </button>
                        )}
                    </div>
                    </Fragment>
                    );
                })}
                <div ref={bottomRef}/>
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

            {/* Attachment upload progress */}
            {uploadProgress != null && (
                <div className="shrink-0 px-4 pt-2 bg-white">
                    <div className="text-[11px] text-gray-500 mb-1">{t("chat.uploading", {p: uploadProgress})}</div>
                    <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-teal-700 transition-all" style={{width: `${uploadProgress}%`}}/>
                    </div>
                </div>
            )}

            {/* Input — replaced by a banner when the pair is blocked (mutual: neither side can send) */}
            {blocked ? (
                <div className="shrink-0 p-3 bg-gray-100 border-t text-center text-sm text-gray-600">
                    {blockedByPeer ? t("chat.blockedByPeer") : t("chat.blockedByYou")}
                </div>
            ) : (
            <div className="shrink-0 p-4 bg-white border-t flex items-center gap-2">
                <input
                    type="file"
                    ref={fileRef}
                    className="hidden"
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onSendAttachment?.(f);
                        e.target.value = "";
                    }}
                />
                <button
                    onClick={() => fileRef.current?.click()}
                    title={t("chat.attach")}
                    aria-label={t("chat.attach")}
                    className="text-2xl px-1 hover:opacity-80"
                >
                    📎
                </button>
                <textarea
                    ref={inputRef}
                    rows={1}
                    placeholder={t("chat.messagePlaceholder")}
                    value={inputText}
                    onChange={(e) => { setInputText(e.target.value); onTyping?.(); }}
                    onKeyDown={(e) => {
                        // Enter sends; Shift+Enter inserts a newline. Ignore IME composition.
                        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            sendMessage(inputText);
                        }
                    }}
                    className="flex-1 border rounded-2xl text-base px-4 py-2 resize-none max-h-32 overflow-y-auto focus:outline-none"
                />
                <button
                    onClick={() => sendMessage(inputText)}
                    aria-label={t("chat.send")}
                    title={t("chat.send")}
                    className="bg-teal-950 text-white px-5 py-3.5 rounded-full"
                >
                    ↑
                </button>
            </div>
            )}
        </main>
    );
}

// Memoized so typing in the input / presence ticks (which re-render <Messenger>) don't re-render
// the whole window unless its own props change. Relies on Messenger passing memoized callbacks.
export default memo(ChatWindow);
