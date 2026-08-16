import {useEffect, useRef, type SyntheticEvent} from "react";
import {useTranslation} from "react-i18next";
import {useAttachmentObjectUrl} from "@/features/chat/lib/useAttachmentObjectUrl.ts";
import {loadAttachmentBlob, saveAttachmentBlob, deleteAttachmentBlob} from "@/features/chat/db/db.ts";
import {AUDIO_PLAYBACK_GAIN} from "@/shared/config/chat.ts";

/**
 * Inline player for an audio attachment (voice message). Uses the shared useAttachmentObjectUrl layer:
 * the bytes are fetched into a Blob and played from a local `blob:` URL — never streamed from the
 * presigned URL. That both (a) avoids the endless spinner (MediaRecorder webm has no Duration/Cues in its
 * header, so a streaming <audio> hangs reading metadata over a range-served URL) and (b) makes a presigned
 * URL expiring irrelevant once fetched. The blob is persisted in the shared size-bounded media cache, so
 * re-opening a chat replays voice notes instantly (and offline) instead of re-downloading.
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
    const {url, failed, retry} = useAttachmentObjectUrl({
        attachmentId, resolveUrl,
        load: loadAttachmentBlob, save: saveAttachmentBlob, invalidate: deleteAttachmentBlob,
    });
    const durationFixed = useRef(false);
    const boostRef = useRef<AudioContext | null>(null);

    // Boost quiet voice notes on playback. A web app can't raise the device's MEDIA volume, but routing
    // the <audio> through a WebAudio GainNode (>1) makes it audible at a lower system volume. Wired on the
    // first play (a user gesture → the AudioContext is allowed to run). Best-effort: any failure leaves the
    // element playing natively. Once a MediaElementSource is created the audio flows through the graph, so
    // we only build it once and just resume() on subsequent plays.
    const onPlay = (e: SyntheticEvent<HTMLAudioElement>) => {
        const a = e.currentTarget;
        a.volume = 1;
        if (boostRef.current) { void boostRef.current.resume?.(); return; }
        try {
            const Ctx = window.AudioContext || (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
            if (!Ctx) return;
            const ctx = new Ctx();
            const src = ctx.createMediaElementSource(a);
            const gain = ctx.createGain();
            gain.gain.value = AUDIO_PLAYBACK_GAIN;
            src.connect(gain).connect(ctx.destination);
            void ctx.resume?.();
            boostRef.current = ctx;
        } catch { /* WebAudio unavailable/blocked → native element playback */ }
    };
    useEffect(() => () => { try { void boostRef.current?.close(); } catch { /* ignore */ } }, []);

    // MediaRecorder webm has no Duration in its header → the <audio> reports duration=Infinity and the
    // seek bar / total time are broken. Force a real duration: seek to the end once (the blob is local
    // and complete, so this resolves instantly), then snap back to the start.
    const onLoadedMetadata = (e: SyntheticEvent<HTMLAudioElement>) => {
        const a = e.currentTarget;
        if (durationFixed.current) return;
        if (a.duration === Infinity || Number.isNaN(a.duration)) {
            durationFixed.current = true;
            const onTimeUpdate = () => { a.removeEventListener("timeupdate", onTimeUpdate); a.currentTime = 0; };
            a.addEventListener("timeupdate", onTimeUpdate);
            a.currentTime = 1e101;
        }
    };

    if (failed) return (
        <button onClick={retry} className="break-all underline decoration-dotted" title={fileName}>
            🎙 {t("chat.voiceMessage")} — ↻
        </button>
    );
    if (!url) return <span className="opacity-60 text-xs">🎙 {t("chat.voiceMessage")}…</span>;
    return (
        <audio controls src={url} onLoadedMetadata={onLoadedMetadata} onPlay={onPlay} onError={retry}
               className="max-w-[240px] h-9" title={fileName}>
            <a href={url} target="_blank" rel="noopener">🎙 {t("chat.voiceMessage")}</a>
        </audio>
    );
}
