import {useTranslation} from "react-i18next";
import {isUlid, ulidTimeMs} from "@/shared/ulid/ulid.ts";
import {formatLocalTime} from "@/shared/lib/datetime.ts";
import {AttachmentImage} from "./AttachmentImage.tsx";
import {AttachmentAudio} from "./AttachmentAudio.tsx";
import {AttachmentVideo} from "./AttachmentVideo.tsx";
import {linkify} from "./messageFormat.tsx";

export interface ChatMessageView {
    id: string;
    text: string;
    fromMe: boolean;
    from?: string;   // author (senderId) — used to label the sender in a GROUP
    createdAt: number;
    kind?: string;
    meta?: Record<string, string>;
}

/**
 * One message bubble: attachment (image thumbnail / download) or linkified text, the local time, and
 * — for my own messages — the delivery/read indicator (🕐 sending, ⚠ failed + retry/discard, ✓ sent,
 * ✓✓ read) plus a delete button. Extracted from ChatWindow VERBATIM, including the ULID-guarded ✓✓
 * rule (a temp nanoid id must not be compared against a ULID read boundary — that gave false ✓✓).
 */
export function MessageBubble({
    msg,
    bubbleMt,
    peerLastReadId,
    status,
    isGroup,
    authorName,
    onResolveAttachment,
    onDownloadAttachment,
    onDeleteMessage,
    onRetryMessage,
    onDiscardMessage,
}: {
    msg: ChatMessageView;
    bubbleMt: string;
    peerLastReadId: string;
    status?: string;
    isGroup?: boolean;      // GROUP: label the author on peers' bubbles + no ✓✓ (no read-by-N aggregate)
    authorName?: string;    // resolved display name of msg.from, for a peer's bubble in a group
    onResolveAttachment?: (attachmentId: string) => Promise<string | null>;
    onDownloadAttachment?: (attachmentId: string) => void;
    onDeleteMessage?: (id: string, attachmentId?: string) => void;
    onRetryMessage?: (id: string) => void;
    onDiscardMessage?: (id: string) => void;
}) {
    const {t} = useTranslation();
    return (
        <div
            className={`${bubbleMt} max-w-xs px-4 py-2 rounded-lg text-sm whitespace-pre-wrap break-words ${
                msg.fromMe
                    ? "ml-auto bg-teal-950 text-white rounded-br-none"
                    : "mr-auto bg-white text-teal-950 rounded-bl-none"
            }`}
        >
            {/* Author label — only on a peer's bubble in a GROUP (in 1:1 the sender is obvious). */}
            {isGroup && !msg.fromMe && authorName && (
                <div className="text-[11px] font-semibold text-teal-700 mb-0.5">{authorName}</div>
            )}
            {msg.kind === "attachment" ? (
                (msg.meta?.contentType ?? "").startsWith("image/") ? (
                    <AttachmentImage
                        attachmentId={msg.meta?.attachmentId ?? ""}
                        fileName={msg.meta?.fileName ?? msg.text ?? "imagen"}
                        resolveUrl={onResolveAttachment}
                    />
                ) : (msg.meta?.contentType ?? "").startsWith("audio/") ? (
                    <AttachmentAudio
                        attachmentId={msg.meta?.attachmentId ?? ""}
                        fileName={msg.meta?.fileName ?? msg.text ?? "audio"}
                        resolveUrl={onResolveAttachment}
                    />
                ) : (msg.meta?.contentType ?? "").startsWith("video/") ? (
                    <AttachmentVideo
                        attachmentId={msg.meta?.attachmentId ?? ""}
                        fileName={msg.meta?.fileName ?? msg.text ?? "video"}
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
            <span className="ml-2 text-[10px] align-bottom opacity-50">{formatLocalTime(msg.createdAt)}</span>
            {msg.fromMe && (() => {
                if (status === "failed") {
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
                if (status === "pending" || status === "sending") {
                    return (
                        <span className="ml-2 text-[10px] align-bottom">
                            <span title={t("chat.sending")} className="opacity-70">🕐</span>
                            {/* Discard an un-sent message: drop it from the send queue (not a server
                                delete — it was never accepted). */}
                            {onDiscardMessage && (
                                <button onClick={() => onDiscardMessage(msg.id)} title={t("chat.discard")}
                                        aria-label={t("chat.discard")}
                                        className="ml-1 opacity-70 hover:opacity-100">🗑</button>
                            )}
                        </span>
                    );
                }
                // Per-message read state: read iff this message's id is at/below the peer's read
                // boundary. BOTH sides must be server ULIDs for the string compare to be chronological.
                // An optimistic message not yet reconciled by CHAT_ACK still carries its temporary nanoid
                // id — comparing that against a ULID boundary is meaningless (nanoid's first char lands on
                // either side of a ULID's at random), which produced intermittent false ✓✓. Guard with
                // isUlid: no server id == not yet stored == cannot be read.
                // Read iff the peer's read boundary (a server ULID, ULID-guarded in the reducer) is
                // at/after this message. Prefer an EXACT id compare once the message has its server
                // ULID (reconciled by CHAT_ACK); before that — a just-sent optimistic echo still on its
                // temp client id — fall back to comparing the boundary ULID's embedded TIME against this
                // message's createdAt, so ✓✓ appears LIVE without waiting for a history reload to swap
                // the id. Groups have no peer read watermark (read-by-N is a later backend phase) → ✓ only.
                const isRead = !isGroup && isUlid(peerLastReadId) && (
                    isUlid(msg.id)
                        ? msg.id <= peerLastReadId
                        : msg.createdAt <= ulidTimeMs(peerLastReadId)
                );
                return (
                    <span className="ml-2 text-[10px] align-bottom opacity-70"
                          title={isRead ? t("chat.read") : t("chat.sent")}>
                        {isRead ? "✓✓" : "✓"}
                    </span>
                );
            })()}
            {/* Server-side "delete for me" — only for an actually-sent message (no outbox status).
                A pending/sending/failed one is discarded from the queue via the status block above. */}
            {onDeleteMessage && msg.fromMe && !status && (
                <button
                    onClick={() => onDeleteMessage(msg.id, msg.meta?.attachmentId)}
                    title={t("chat.deleteMessage")}
                    aria-label={t("chat.deleteMessage")}
                    className="ml-2 text-[10px] opacity-40 hover:opacity-100"
                >
                    🗑
                </button>
            )}
        </div>
    );
}
