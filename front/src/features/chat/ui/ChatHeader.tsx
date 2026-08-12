import {useTranslation} from "react-i18next";
import type {Contact} from "@/entities/contact";

/**
 * Chat window header: counterpart name + presence line (typing / online / last-seen / offline) and
 * the call / block / delete actions. Presentational — no scroll or read-receipt state — extracted
 * from ChatWindow. Behavior preserved verbatim.
 */
export function ChatHeader({
    chat,
    isGroup,
    memberCount,
    onlineCount,
    typingName,
    onOpenRoster,
    peerTyping,
    lastSeenText,
    blockedByMe,
    onBack,
    onCall,
    onToggleBlock,
    onDeleteChat,
}: {
    chat: Contact | null;
    isGroup?: boolean;
    memberCount?: number;
    onlineCount?: number;
    typingName?: string;
    onOpenRoster?: () => void;
    peerTyping: boolean;
    lastSeenText: string | null;
    blockedByMe?: boolean;
    onBack: () => void;
    onCall: () => void;
    onToggleBlock?: () => void;
    onDeleteChat: () => void;
}) {
    const {t} = useTranslation();
    return (
        <div
            className="shrink-0 py-4 px-4 bg-teal-950 text-white border-b font-semibold flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
                <button
                    onClick={onBack}
                    className="sm:hidden text-xl"
                    aria-label={t("chat.back")}
                    title={t("chat.back")}
                >
                    ←
                </button>
                {/* In a group the name+subtitle open the roster panel (members / add / leave). */}
                <span
                    className={`flex flex-col leading-tight min-w-0 ${isGroup ? "cursor-pointer" : ""}`}
                    onClick={isGroup ? onOpenRoster : undefined}
                >
                    <span className="truncate">{isGroup ? `👥 ${chat?.name}` : chat?.name}</span>
                    <span className="text-xs font-normal truncate">
                        {isGroup
                            ? peerTyping
                                ? <span className="text-teal-300">{typingName ? t("group.typingBy", {name: typingName}) : t("chat.typing")}</span>
                                : <span className="text-gray-400">{t("group.membersOnline", {n: memberCount ?? 0, online: onlineCount ?? 0})}</span>
                            : peerTyping
                                ? <span className="text-teal-300">{t("chat.typing")}</span>
                                : chat?.online
                                    ? <span className="text-green-400">● {t("chat.online")}</span>
                                    : <span className="text-gray-400">● {lastSeenText ? t("chat.lastSeen", {time: lastSeenText}) : t("chat.offline")}</span>}
                    </span>
                </span>
            </div>

            <div className="flex items-center gap-4 shrink-0">
                {/* Group: roster (members / add / leave). 1:1: call + per-pair block. */}
                {isGroup && (
                    <button
                        onClick={onOpenRoster}
                        title={t("group.members")}
                        aria-label={t("group.members")}
                        className="hover:opacity-80 text-xl"
                    >
                        ⓘ
                    </button>
                )}

                {!isGroup && (
                    <button
                        onClick={onCall}
                        title={t("chat.call")}
                        aria-label={t("chat.call")}
                        className="hover:opacity-80 text-xl"
                    >
                        📞
                    </button>
                )}

                {!isGroup && (
                    <button
                        onClick={onToggleBlock}
                        title={blockedByMe ? t("chat.unblock") : t("chat.block")}
                        aria-label={blockedByMe ? t("chat.unblock") : t("chat.block")}
                        className="hover:opacity-80 text-xl"
                    >
                        {blockedByMe ? "🔓" : "🚫"}
                    </button>
                )}

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
    );
}
