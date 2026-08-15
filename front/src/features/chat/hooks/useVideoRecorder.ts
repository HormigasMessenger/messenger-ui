import {useCallback, useEffect, useRef, useState} from "react";
import toast from "react-hot-toast";
import {useTranslation} from "react-i18next";

import {logger} from "@/shared/logger/logger.ts";

/**
 * Camera + mic recording for video messages. Mirrors useVoiceRecorder but records video and EXPOSES the
 * live MediaStream so the UI can show a camera preview while recording. open() acquires the camera (for
 * the preview) without recording yet; start()/stop() bracket the actual recording; stop() resolves the
 * clip as a File; cancel()/close release the camera. The stream is always released on close/cancel/unmount.
 */

const MIME_CANDIDATES = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4", // Safari
];

function pickMimeType(): string {
    if (typeof MediaRecorder === "undefined") return "";
    for (const c of MIME_CANDIDATES) {
        try { if (MediaRecorder.isTypeSupported(c)) return c; } catch { /* ignore */ }
    }
    return "";
}

function extForMime(mime: string): string {
    return mime.includes("mp4") ? "mp4" : "webm";
}

export function useVideoRecorder() {
    const {t} = useTranslation();
    const [stream, setStream] = useState<MediaStream | null>(null); // live preview stream
    const [recording, setRecording] = useState(false);
    const [elapsedMs, setElapsedMs] = useState(0);

    const recRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const mimeRef = useRef("");
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const startedAtRef = useRef(0);
    const resolveRef = useRef<((f: File | null) => void) | null>(null);
    const openingRef = useRef(false);

    const releaseStream = () => {
        streamRef.current?.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
        setStream(null);
    };
    const clearTimer = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
    };

    // Acquire the camera + mic for the live preview (no recording yet).
    const open = useCallback(async (): Promise<boolean> => {
        if (streamRef.current || openingRef.current) return true;
        if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
            toast.error(t("chat.cameraError"));
            return false;
        }
        openingRef.current = true;
        try {
            const s = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
            streamRef.current = s;
            setStream(s);
            return true;
        } catch (e) {
            logger.error("camera failed to open", e as Error);
            toast.error(t("chat.cameraError"));
            return false;
        } finally {
            openingRef.current = false;
        }
    }, [t]);

    const start = useCallback((): boolean => {
        const s = streamRef.current;
        if (!s || recRef.current) return false;
        const mime = pickMimeType();
        mimeRef.current = mime;
        const rec = new MediaRecorder(s, mime ? {mimeType: mime} : undefined);
        chunksRef.current = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
        rec.onstop = () => {
            const type = (mimeRef.current || "video/webm").split(";")[0]; // clean base type for upload
            const file = chunksRef.current.length > 0
                ? new File([new Blob(chunksRef.current, {type})], `video-${Date.now()}.${extForMime(type)}`, {type})
                : null;
            chunksRef.current = [];
            const resolve = resolveRef.current;
            resolveRef.current = null;
            resolve?.(file);
        };
        recRef.current = rec;
        rec.start();
        startedAtRef.current = Date.now();
        setElapsedMs(0);
        setRecording(true);
        timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 200);
        return true;
    }, []);

    // Stop recording and resolve the clip (does NOT release the camera — caller closes).
    const stop = useCallback((): Promise<File | null> => {
        return new Promise((resolve) => {
            const rec = recRef.current;
            recRef.current = null;
            clearTimer();
            setRecording(false);
            if (!rec || rec.state === "inactive") { resolve(null); return; }
            resolveRef.current = resolve;
            rec.stop();
        });
    }, []);

    // Discard recording (if any) and release the camera.
    const close = useCallback(() => {
        const rec = recRef.current;
        recRef.current = null;
        resolveRef.current = null;
        chunksRef.current = [];
        clearTimer();
        setRecording(false);
        setElapsedMs(0);
        if (rec && rec.state !== "inactive") { rec.onstop = () => {}; try { rec.stop(); } catch { /* ignore */ } }
        releaseStream();
    }, []);

    // Safety net: release the camera if the component unmounts.
    useEffect(() => () => {
        clearTimer();
        const rec = recRef.current;
        if (rec && rec.state !== "inactive") { rec.onstop = null; try { rec.stop(); } catch { /* ignore */ } }
        streamRef.current?.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
    }, []);

    return {stream, recording, elapsedMs, open, start, stop, close};
}
