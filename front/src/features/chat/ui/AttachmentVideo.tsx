import {useEffect, useRef, useState, type SyntheticEvent} from "react";
import {useTranslation} from "react-i18next";
import {loadAttachmentBlob, saveAttachmentBlob} from "@/features/chat/db/db.ts";
import {targetDimensions} from "@/features/chat/lib/imageCompress.ts";
import {THUMB_MAX_DIMENSION, THUMB_QUALITY} from "@/shared/config/chat.ts";

/**
 * Inline player for a video attachment. The video itself STREAMS the presigned URL (clips run up to the
 * 25MB cap — fetching+caching the whole file would be the wrong trade-off). What we DO cache is a small
 * POSTER (the first frame), keyed by attachmentId in the shared media cache (video never stores its main
 * blob there, so no key clash): a freshly-arrived video otherwise shows a blank player with no preview.
 *
 * Two layers of "show a first frame":
 *  - `#t=0.1` media fragment on the src → the browser paints the frame at 0.1s as the poster immediately,
 *    no generation, works while streaming (esp. mobile, where preload often shows nothing otherwise).
 *  - Once a frame decodes we draw it to a canvas (same-origin → not tainted), downscale to a WebP, use it
 *    as the poster, and cache it — so re-opening the chat shows the preview instantly without streaming.
 *
 * Resolve is retried for a just-uploaded object; a playback error re-resolves a fresh presigned URL.
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
    const [url, setUrl] = useState<string | null>(null);     // presigned URL (streamed)
    const [poster, setPoster] = useState<string | null>(null); // objectURL of the cached/generated frame
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const playbackErrors = useRef(0);
    const posterDone = useRef(false);          // generate/attach the poster at most once
    const posterUrlRef = useRef<string | null>(null); // live poster objectURL, for revoke

    const [prevId, setPrevId] = useState(attachmentId);
    if (attachmentId !== prevId) { setPrevId(attachmentId); setUrl(null); setPoster(null); setFailed(false); }

    // Set the poster, revoking any previous objectURL first; revoke on unmount too.
    const applyPoster = (blob: Blob) => {
        if (posterUrlRef.current) URL.revokeObjectURL(posterUrlRef.current);
        posterUrlRef.current = URL.createObjectURL(blob);
        setPoster(posterUrlRef.current);
    };
    useEffect(() => () => {
        if (posterUrlRef.current) { URL.revokeObjectURL(posterUrlRef.current); posterUrlRef.current = null; }
    }, []);

    // Resolve the presigned URL (retry for a just-uploaded object).
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

    // Poster: serve a cached first-frame immediately if we have one (no streaming needed to preview).
    useEffect(() => {
        let alive = true;
        loadAttachmentBlob(attachmentId).then((blob) => {
            if (!alive || !blob) return;
            posterDone.current = true;
            applyPoster(blob);
        }).catch(() => { /* no cached poster yet */ });
        return () => { alive = false; };
    }, [attachmentId]);

    // First decoded frame → draw, downscale to a WebP poster, cache it, show it.
    const onLoadedData = (e: SyntheticEvent<HTMLVideoElement>) => {
        if (posterDone.current) return;
        const v = e.currentTarget;
        if (!v.videoWidth || !v.videoHeight) return;
        posterDone.current = true;
        try {
            const {width, height} = targetDimensions(v.videoWidth, v.videoHeight, THUMB_MAX_DIMENSION);
            const canvas = document.createElement("canvas");
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.drawImage(v, 0, 0, width, height);
            canvas.toBlob((blob) => {
                if (!blob) return;
                saveAttachmentBlob(attachmentId, blob).catch(() => { /* best-effort cache */ });
                applyPoster(blob);
            }, "image/webp", THUMB_QUALITY);
        } catch { /* tainted/unsupported → the #t=0.1 frame still previews */ }
    };

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
        <video
            controls
            preload="metadata"
            src={`${url}#t=0.1`}
            poster={poster ?? undefined}
            onLoadedData={onLoadedData}
            onError={onVideoError}
            className="block max-w-[240px] max-h-[240px] rounded-md bg-black"
            title={fileName}
        >
            <a href={url} target="_blank" rel="noopener">🎬 {t("chat.video")}</a>
        </video>
    );
}
