import {useEffect, useRef, useState} from "react";

/** Inline thumbnail for image attachments. Presigned GET URLs expire, so it resolves
 *  a fresh URL on mount (per attachmentId). Click opens the full image in a new tab. */
export function AttachmentImage({
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
