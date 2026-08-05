import {useEffect, useRef, useState} from "react";
import {useSelector} from "react-redux";
import {useTranslation} from "react-i18next";
import {skipToken} from "@reduxjs/toolkit/query/react";
import type {RootState} from "@/store/store.ts";
import {idsDisplayName, useGetIdsUserQuery} from "@/features/directory";
import ConfirmModal from "@/widgets/modal/ConfirmModal.jsx";

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

    useEffect(() => {
        if (localVideoRef.current && localStream) {
            localVideoRef.current.srcObject = localStream;
        }
    }, [localStream]);

    useEffect(() => {
        if (remoteVideoRef.current && remoteStream) {
            remoteVideoRef.current.srcObject = remoteStream;
        }
    }, [remoteStream]);

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

    return (
        <div className="fixed inset-0 bg-black z-50 flex">
            {(callStatus === "calling" || callStatus === "connecting") && (
                <div className="absolute top-8 inset-x-0 text-center text-white text-lg z-10">
                    {callStatus === "calling" ? t("call.calling", {name: callerName}) : t("call.connecting")}
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