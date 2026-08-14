import {useEffect, useState} from "react";
import {useTranslation} from "react-i18next";

/**
 * Inline player for an audio attachment (voice message).
 *
 * The audio bytes are FETCHED into a Blob and played from a local `blob:` URL rather than streamed via
 * `<audio src={presignedUrl}>`. MediaRecorder's webm/opus has no Duration/Cues in its header, so a
 * streaming `<audio>` element hangs on an endless spinner trying to read metadata over a range-served
 * URL. A fully-downloaded blob is complete and seekable, so it just plays. (Attachment URLs are
 * same-origin/edge-fronted, so `fetch()` needs no CORS.)
 *
 * The presigned resolve is retried with backoff (a just-uploaded object's GET can 404 the first time).
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
    const [url, setUrl] = useState<string | null>(null); // a blob: URL
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0); // bumped by the manual retry to re-run the effect

    // Reset on attachment change during render (not in the effect) so the effect only loads.
    const [prevId, setPrevId] = useState(attachmentId);
    if (attachmentId !== prevId) { setPrevId(attachmentId); setUrl(null); setFailed(false); }

    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let objectUrl: string | null = null;
        let tries = 0;
        const MAX = 4;

        const fail = () => { if (++tries < MAX) timer = setTimeout(go, 800 * tries); else setFailed(true); };
        function go() {
            resolveUrl?.(attachmentId)
                .then(async (presigned) => {
                    if (!alive) return;
                    if (!presigned) { fail(); return; }
                    try {
                        const resp = await fetch(presigned);
                        if (!resp.ok) throw new Error("download " + resp.status);
                        const blob = await resp.blob();
                        if (!alive) return;
                        objectUrl = URL.createObjectURL(blob);
                        setUrl(objectUrl);
                    } catch {
                        if (alive) fail();
                    }
                })
                .catch(() => { if (alive) fail(); });
        }
        go();

        return () => {
            alive = false;
            if (timer) clearTimeout(timer);
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [attachmentId, attempt, resolveUrl]);

    const retry = () => { setFailed(false); setUrl(null); setAttempt((a) => a + 1); };

    if (failed) return (
        <button onClick={retry} className="break-all underline decoration-dotted" title={fileName}>
            🎙 {t("chat.voiceMessage")} — ↻
        </button>
    );
    if (!url) return <span className="opacity-60 text-xs">🎙 {t("chat.voiceMessage")}…</span>;
    return (
        <audio controls src={url} className="max-w-[240px] h-9" title={fileName}>
            <a href={url} target="_blank" rel="noopener">🎙 {t("chat.voiceMessage")}</a>
        </audio>
    );
}
