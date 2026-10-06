import {useState} from "react";
import {useTranslation} from "react-i18next";
import type {Contact} from "@/entities/contact";

/**
 * Forward picker: choose a chat to forward a message's text into. Presentational — the actual send is
 * done by the caller's `onPick(chatId)` (which enqueues the text into that conversation). Text only;
 * attachments are not forwarded (they'd need re-upload/re-encryption).
 */
export function ForwardModal({
    chats,
    preview,
    onPick,
    onClose,
}: {
    chats: Contact[];
    preview: string;
    onPick: (chatId: string) => void;
    onClose: () => void;
}) {
    const {t} = useTranslation();
    const [q, setQ] = useState("");
    const filtered = q.trim()
        ? chats.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()))
        : chats;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={t("chat.forwardTo", {defaultValue: "Forward to…"})}
        >
            <div
                className="w-full max-w-sm max-h-[80vh] flex flex-col overflow-hidden rounded-xl bg-white shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-4 py-3 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-teal-950">{t("chat.forwardTo", {defaultValue: "Forward to…"})}</h2>
                        <button onClick={onClose} aria-label={t("close", {defaultValue: "Close"})}
                                className="text-gray-400 hover:text-gray-700 text-lg leading-none">×</button>
                    </div>
                    <p className="mt-1 truncate text-xs text-gray-500" title={preview}>“{preview}”</p>
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder={t("chat.searchPlaceholder", {defaultValue: "Search"})}
                        className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-teal-600 focus:outline-none"
                        autoFocus
                    />
                </div>
                <ul className="flex-1 overflow-y-auto">
                    {filtered.length === 0 && (
                        <li className="px-4 py-6 text-center text-sm text-gray-400">{t("chat.noChats", {defaultValue: "No chats"})}</li>
                    )}
                    {filtered.map((c) => (
                        <li key={c.id}>
                            <button
                                onClick={() => onPick(c.id)}
                                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-100"
                            >
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-900 text-xs font-semibold text-white">
                                    {c.kind === "group" ? "👥" : c.name.slice(0, 2).toUpperCase()}
                                </span>
                                <span className="truncate text-sm text-teal-950">{c.name}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
