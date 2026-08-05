import {useRef, type RefObject} from "react";
import {useTranslation} from "react-i18next";

/**
 * Message composer: attachment-upload progress, the blocked banner (replaces the input when the pair
 * is blocked — mutual, neither side can send), and the input row (attach + textarea + send).
 * Presentational — no scroll/read-receipt state — extracted from ChatWindow verbatim. `inputRef` stays
 * owned by ChatWindow (it focuses the textarea on chat open) and is forwarded here; the file input ref
 * is local to the composer.
 */
export function Composer({
    inputRef,
    inputText,
    setInputText,
    sendMessage,
    onTyping,
    onSendAttachment,
    uploadProgress,
    blocked,
    blockedByPeer,
}: {
    inputRef: RefObject<HTMLTextAreaElement | null>;
    inputText: string;
    setInputText: (value: string) => void;
    sendMessage: (text: string) => void;
    onTyping?: () => void;
    onSendAttachment?: (file: File) => void;
    uploadProgress?: number | null;
    blocked?: boolean;
    blockedByPeer?: boolean;
}) {
    const {t} = useTranslation();
    const fileRef = useRef<HTMLInputElement>(null);

    return (
        <>
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
        </>
    );
}
