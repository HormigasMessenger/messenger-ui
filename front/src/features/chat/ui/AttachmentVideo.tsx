import {useEffect, useRef, useState} from "react";
import {useTranslation} from "react-i18next";

/**
 * Inline player for a video attachment. Unlike images/audio (fetched into a blob + cached via
 * useAttachmentObjectUrl), video STREAMS the presigned URL directly: clips can be up to the 25MB
 * attachment cap, so fetching the whole file into a blob before showing anything — and caching it, which
 * would evict the image/audio cache — is the wrong trade-off. Real video containers (MP4/webm-from-camera)
 * carry proper metadata, so a streaming `<video>` doesn't hit the no-Duration spinner that MediaRecorder
 * voice-note webm did.
 *
 * The presigned resolve is retried for a just-uploaded object; on a playback error (e.g. the 300s URL
 * expired before the user pressed play) it re-resolves a FRESH one, capped so a broken object can't loop.
 */
export function AttachmentVideo({
    attachmentId,
    fileName,
    resolveUrl,
}: {
    attachmentId: string;
    fileName: string;
    resolveUrl?: (attachmentId: string) => Promise<string | null>;
}) {
    const {t} = useTranslation();
    const [url, setUrl] = useState<string | null>(null); // presigned URL (streamed, not a blob)
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const playbackErrors = useRef(0);

    const [prevId, setPrevId] = useState(attachmentId);
    if (attachmentId !== prevId) { setPrevId(attachmentId); setUrl(null); setFailed(false); }

    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let tries = 0;
        const MAX = 4;
        const go = () => {
            resolveUrl?.(attachmentId)
                .then((u) => {
                    if (!alive) return;
                    if (u) { setUrl(u); return; }
                    if (++tries < MAX) timer = setTimeout(go, 800 * tries); else setFailed(true);
                })
                .catch(() => {
                    if (!alive) return;
                    if (++tries < MAX) timer = setTimeout(go, 800 * tries); else setFailed(true);
                });
        };
        go();
        return () => { alive = false; if (timer) clearTimeout(timer); };
    }, [attachmentId, attempt, resolveUrl]);

    const retry = () => { setFailed(false); setUrl(null); setAttempt((a) => a + 1); };
    const onVideoError = () => {
        if (playbackErrors.current < 2) { playbackErrors.current += 1; retry(); } // maybe an expired URL
        else setFailed(true);
    };

    if (failed) return (
        <button onClick={retry} className="break-all underline decoration-dotted" title={fileName}>
            🎬 {t("chat.video")} — ↻
        </button>
    );
    if (!url) return <span className="opacity-60 text-xs">🎬 {t("chat.video")}…</span>;
    return (
        <video controls preload="metadata" src={url} onError={onVideoError}
               className="block max-w-[240px] max-h-[240px] rounded-md" title={fileName}>
            <a href={url} target="_blank" rel="noopener">🎬 {t("chat.video")}</a>
        </video>
    );
}
