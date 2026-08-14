import {useEffect, useState} from "react";
import {useTranslation} from "react-i18next";

/**
 * Inline player for an audio attachment (voice message). Resolves a fresh presigned GET on mount and
 * renders the browser's native <audio> controls. Presigned URLs expire, so it resolves per mount rather
 * than caching (voice notes are far rarer than image thumbnails — no local cache layer here).
 */
export function AttachmentAudio({
    attachmentId,
    fileName,
    resolveUrl,
}: {
    attachmentId: string;
    fileName: string;
    resolveUrl?: (attachmentId: string) => Promise<string | null>;
}) {
    const {t} = useTranslation();
    const [url, setUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    // Reset on attachment change during render (not in the effect) so the effect never sets state
    // synchronously — the effect below only resolves the URL asynchronously.
    const [prevId, setPrevId] = useState(attachmentId);
    if (attachmentId !== prevId) { setPrevId(attachmentId); setUrl(null); setFailed(false); }

    useEffect(() => {
        let alive = true;
        resolveUrl?.(attachmentId)
            .then((u) => { if (alive) { if (u) setUrl(u); else setFailed(true); } })
            .catch(() => { if (alive) setFailed(true); });
        return () => { alive = false; };
    }, [attachmentId, resolveUrl]);

    if (failed) return <span className="break-all" title={fileName}>🎙 {t("chat.voiceMessage")}</span>;
    if (!url) return <span className="opacity-60 text-xs">🎙 {t("chat.voiceMessage")}…</span>;
    return (
        <audio controls preload="none" src={url} className="max-w-[240px] h-9" title={fileName}>
            <a href={url} target="_blank" rel="noopener">🎙 {t("chat.voiceMessage")}</a>
        </audio>
    );
}
