import {useEffect, useRef, useState, type SyntheticEvent} from "react";
import {loadThumbFromDB, saveThumbToDB} from "@/features/chat/db/db.ts";
import {targetDimensions} from "@/features/chat/lib/imageCompress.ts";
import {THUMB_MAX_DIMENSION, THUMB_QUALITY} from "@/shared/config/chat.ts";

/**
 * Inline thumbnail for image attachments, cached in IndexedDB (keyed by attachmentId).
 *
 *  - Cache HIT → show the cached WebP thumbnail instantly, zero network. The full-res presigned URL is
 *    resolved lazily only when the user taps to open.
 *  - Cache MISS → resolve a fresh presigned GET (they expire; retry a few times for a just-uploaded
 *    object), show the full image, and — since the object is same-origin (edge-fronted) so the canvas
 *    isn't tainted — generate a small WebP from the loaded <img> and cache it for next time.
 *
 * Tap opens the full-res image in a new tab.
 */
export function AttachmentImage({
                             attachmentId,
                             fileName,
                             resolveUrl,
                         }: {
    attachmentId: string;
    fileName: string;
    resolveUrl?: (attachmentId: string) => Promise<string | null>;
}) {
    const [displayUrl, setDisplayUrl] = useState<string | null>(null); // cached-thumb objectURL OR the full presigned URL
    const [fullUrl, setFullUrl] = useState<string | null>(null);       // full presigned URL (for tap-to-open)
    const [fromCache, setFromCache] = useState(false);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const objectUrlRef = useRef<string | null>(null);

    // Reset when the attachment changes — DURING render (React's recommended adjust-state-on-prop-change),
    // not in the effect. The effect's cleanup revokes the previous object URL.
    const [prevId, setPrevId] = useState(attachmentId);
    if (attachmentId !== prevId) {
        setPrevId(attachmentId);
        setDisplayUrl(null); setFullUrl(null); setFromCache(false); setFailed(false);
    }

    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;

        (async () => {
            // 1) Cache hit → instant thumbnail, no network.
            const cached = await loadThumbFromDB(attachmentId).catch(() => null);
            if (!alive) return;
            if (cached) {
                const u = URL.createObjectURL(cached);
                objectUrlRef.current = u;
                setDisplayUrl(u);
                setFromCache(true);
                return;
            }
            // 2) Cache miss → resolve the presigned URL (retry for a just-uploaded object) and show full.
            let tries = 0;
            const MAX = 4;
            const go = () => {
                resolveUrl?.(attachmentId)
                    .then((u) => {
                        if (!alive) return;
                        if (u) { setFullUrl(u); setDisplayUrl(u); return; }
                        if (++tries < MAX) timer = setTimeout(go, 800 * tries); else setFailed(true);
                    })
                    .catch(() => {
                        if (!alive) return;
                        if (++tries < MAX) timer = setTimeout(go, 800 * tries); else setFailed(true);
                    });
            };
            go();
        })();

        return () => {
            alive = false;
            if (timer) clearTimeout(timer);
            if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
        };
    }, [attachmentId, attempt, resolveUrl]);

    // Generate + cache a thumbnail from the loaded full image (same-origin → canvas is readable).
    const onImgLoad = (e: SyntheticEvent<HTMLImageElement>) => {
        if (fromCache) return; // already showing a cached thumbnail
        const img = e.currentTarget;
        try {
            const {width, height} = targetDimensions(img.naturalWidth, img.naturalHeight, THUMB_MAX_DIMENSION);
            const canvas = document.createElement("canvas");
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => { if (blob) saveThumbToDB(attachmentId, blob).catch(() => { /* best-effort */ }); },
                "image/webp", THUMB_QUALITY);
        } catch { /* tainted/unsupported → skip caching (no regression) */ }
    };

    const openFull = async () => {
        let u = fullUrl;
        if (!u) u = (await resolveUrl?.(attachmentId).catch(() => null)) ?? null;
        if (u) window.open(u, "_blank", "noopener");
    };

    if (failed) return (
        <button onClick={() => { setFailed(false); setAttempt((a) => a + 1); }} className="break-all underline decoration-dotted" title={fileName}>
            📎 {fileName} — ↻
        </button>
    );
    if (!displayUrl) return <span className="opacity-60 text-xs">🖼 cargando…</span>;
    return (
        // inline-block + a BLOCK img so the button box hugs the image exactly (an inline img sits on the
        // text baseline, leaving the button taller than the picture → only a corner was clickable).
        <button onClick={openFull} title={fileName}
                className="inline-block align-top p-0 border-0 bg-transparent cursor-pointer">
            <img
                src={displayUrl}
                alt={fileName}
                onLoad={onImgLoad}
                onError={() => setFailed(true)}
                className="block max-w-[200px] max-h-[200px] rounded-md"
            />
        </button>
    );
}
