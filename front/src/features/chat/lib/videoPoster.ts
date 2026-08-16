import {targetDimensions} from "./imageCompress.ts";
import {THUMB_MAX_DIMENSION, THUMB_QUALITY} from "@/shared/config/chat.ts";

/**
 * Generate a small first-frame WebP poster from a LOCAL video File/Blob — used at SEND time so the
 * sender's just-uploaded clip shows a real thumbnail immediately instead of a black 🎬 placeholder
 * (the receiver-side poster is still generated on first play). Best-effort: resolves null on any
 * failure (unsupported codec, tainted canvas, timeout) and never throws. Draws a frame ~0.1s in to
 * avoid a black pre-roll frame; handles MediaRecorder webm (no reliable duration) via loadeddata.
 */
export function videoPosterBlob(file: Blob): Promise<Blob | null> {
    return new Promise((resolve) => {
        let settled = false;
        let url: string | null = null;
        const v = document.createElement("video");
        const done = (blob: Blob | null) => {
            if (settled) return;
            settled = true;
            try { if (url) URL.revokeObjectURL(url); } catch { /* ignore */ }
            try { v.removeAttribute("src"); v.load(); } catch { /* ignore */ }
            resolve(blob);
        };
        try {
            url = URL.createObjectURL(file);
            v.muted = true;
            v.preload = "auto";
            (v as HTMLVideoElement & {playsInline?: boolean}).playsInline = true;
            const draw = () => {
                if (!v.videoWidth || !v.videoHeight) return done(null);
                try {
                    const {width, height} = targetDimensions(v.videoWidth, v.videoHeight, THUMB_MAX_DIMENSION);
                    const c = document.createElement("canvas");
                    c.width = width; c.height = height;
                    const ctx = c.getContext("2d");
                    if (!ctx) return done(null);
                    ctx.drawImage(v, 0, 0, width, height);
                    c.toBlob((b) => done(b), "image/webp", THUMB_QUALITY);
                } catch { done(null); }
            };
            v.onloadeddata = () => {
                // Seek a hair in for a non-black frame; fall back to the current frame if we can't.
                if (v.currentTime < 0.1) { try { v.currentTime = 0.1; return; } catch { /* draw now */ } }
                draw();
            };
            v.onseeked = () => draw();
            v.onerror = () => done(null);
            v.src = url;
            setTimeout(() => done(null), 5000); // safety net so a stuck decode never hangs the send
        } catch { done(null); }
    });
}
