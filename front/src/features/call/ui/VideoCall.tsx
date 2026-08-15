import {useEffect, useRef, useState} from "react";
import {useSelector} from "react-redux";
import {useTranslation} from "react-i18next";
import {skipToken} from "@reduxjs/toolkit/query/react";
import type {RootState} from "@/store/store.ts";
import {idsDisplayName, useGetIdsUserQuery} from "@/features/directory";
import ConfirmModal from "@/shared/ui/ConfirmModal.jsx";

interface VideoCallProps {
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    onHangUp: () => void;
    acceptCall: () => void;
    rejectCall: () => void;
}

export default function VideoCall({
                                      localStream,
                                      remoteStream,
                                      onHangUp,
                                      acceptCall,
                                      rejectCall,
                                  }: VideoCallProps) {
    const {t} = useTranslation();
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const remoteAudioRef = useRef<HTMLAudioElement>(null);

    const audioOnly = useSelector((state: RootState) => state.call.audioOnly);

    useEffect(() => {
        if (localVideoRef.current && localStream) {
            localVideoRef.current.srcObject = localStream;
        }
    }, [localStream]);

    useEffect(() => {
        // Attach the remote stream to whichever element is mounted for the current mode (video panel
        // for a video call, hidden audio element for a voice call) and explicitly start playback — the
        // stream arrives async (after the click that started the call), so the element doesn't always
        // autoplay on its own, which is heard as "no sound on the call".
        const el = audioOnly ? remoteAudioRef.current : remoteVideoRef.current;
        if (el && remoteStream) {
            el.srcObject = remoteStream;
            void el.play?.().catch(() => { /* autoplay policy may defer until a user gesture */ });
        }
    }, [remoteStream, audioOnly]);

    const callFrom = useSelector((state: RootState) => state.call.peerId);
    const callStatus = useSelector((state: RootState) => state.call.status);

    // Resolve the caller's display name by id (peerId is a user id) — no full-directory download.
    const {data: caller} = useGetIdsUserQuery(callFrom ?? skipToken);
    const callerName = caller ? idsDisplayName(caller) : (callFrom ?? "");

    const [newCall, setNewCall] = useState(true);

    if (newCall && callStatus === "ringing") {
        return (
            <ConfirmModal
                title={t("call.incoming")}
                message={t("call.callingYou", {name: callerName})}
                confirmText={t("call.accept")}
                cancelText={t("call.reject")}
                onConfirm={() => {
                    setNewCall(false);
                    acceptCall();
                }}
                onCancel={() => {
                    if (callFrom) {
                        rejectCall();
                    }
                }}
            />
        );
    }

    const statusLine = callStatus === "calling"
        ? t("call.calling", {name: callerName})
        : callStatus === "connecting" ? t("call.connecting") : null;

    if (audioOnly) {
        return (
            <div className="fixed inset-0 bg-teal-950 z-50 flex flex-col items-center justify-center text-white">
                <div className="w-28 h-28 rounded-full bg-teal-800 flex items-center justify-center text-5xl font-semibold">
                    {(callerName || "?").charAt(0).toUpperCase()}
                </div>
                <div className="mt-5 text-2xl font-medium">{callerName}</div>
                <div className="mt-1 text-sm text-teal-300">🎙 {statusLine ?? t("call.audioCall")}</div>
                {/* Remote audio (no video track in a voice call) */}
                <audio autoPlay playsInline ref={remoteAudioRef} className="hidden"/>
                <button
                    onClick={onHangUp}
                    className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-3 rounded-full hover:bg-red-700 transition-colors"
                >
                    {t("call.hangUp")}
                </button>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black z-50 flex">
            {statusLine && (
                <div className="absolute top-8 inset-x-0 text-center text-white text-lg z-10">
                    {statusLine}
                </div>
            )}
            <video
                autoPlay
                muted
                playsInline
                ref={localVideoRef}
                className="w-1/4 absolute bottom-4 right-4 rounded-lg"
            />
            <video
                autoPlay
                playsInline
                ref={remoteVideoRef}
                className="w-full h-full object-cover"
            />
            <button
                onClick={onHangUp}
                className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-3 rounded-full hover:bg-red-700 transition-colors"
            >
                {t("call.hangUp")}
            </button>
        </div>
    );
}