import {useEffect, useRef, useState} from "react";
import {useTranslation} from "react-i18next";

/**
 * Inline player for an audio attachment (voice message). Resolves a fresh presigned GET and renders the
 * browser's native <audio> controls. Presigned URLs expire, so it resolves per mount rather than caching.
 *
 * Resolving is RETRIED with backoff (like AttachmentImage): a just-uploaded object's presigned GET can
 * fail the first time (the confirm/emit hasn't propagated), and a single attempt would strand the note
 * on the "🎙 …" fallback forever — which is exactly "no player, no sound right after sending".
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
    const [attempt, setAttempt] = useState(0); // bumped by the manual/playback retry to re-run the effect
    const playbackErrors = useRef(0);          // caps auto re-resolve on <audio> error (avoid a loop)

    // Reset on attachment change during render (not in the effect) so the effect only resolves.
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
    // A playback error usually means the presigned URL expired — re-resolve a fresh one, but only a
    // couple of times so a genuinely broken object doesn't loop.
    const onAudioError = () => {
        if (playbackErrors.current < 2) { playbackErrors.current += 1; retry(); }
        else setFailed(true);
    };

    if (failed) return (
        <button onClick={retry} className="break-all underline decoration-dotted" title={fileName}>
            🎙 {t("chat.voiceMessage")} — ↻
        </button>
    );
    if (!url) return <span className="opacity-60 text-xs">🎙 {t("chat.voiceMessage")}…</span>;
    return (
        // preload="metadata" so the browser fetches while the presigned URL is still fresh (rather than
        // only on press-play, which can land after the URL's TTL). onError re-resolves a fresh URL once.
        <audio controls preload="metadata" src={url} onError={onAudioError} className="max-w-[240px] h-9" title={fileName}>
            <a href={url} target="_blank" rel="noopener">🎙 {t("chat.voiceMessage")}</a>
        </audio>
    );
}
