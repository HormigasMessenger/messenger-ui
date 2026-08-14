import type {WSMessage} from "@/infrastructure/types.ts";

type CallStatus = "idle" | "ringing" | "calling" | "connecting" | "in_call";

export interface CallState {
    status: CallStatus;
    peerId: string | null;
    offer: RTCSessionDescriptionInit | null;
}

// A call is either audio-only (voice) or with video. The caller stamps its choice on the offer so the
// callee brings up the matching local media (audio-only → no camera). Rides in payload.body via
// frameBridge, so no backend change is needed. Absent = video (back-compat with older clients).
export type CallMedia = "audio" | "video";

export type IncomingWebRTCMessage =
    | WSMessage & { type: "call:offer"; from: string; offer: RTCSessionDescriptionInit; media?: CallMedia }
    | WSMessage & { type: "call:answer"; from: string; answer: RTCSessionDescriptionInit }
    | WSMessage & { type: "call:ice"; from: string; candidate: RTCIceCandidateInit }
    | WSMessage & { type: "call:end"; from: string };

export type OutgoingWebRTCMessage =
    | { type: "call:offer"; to: string; offer: RTCSessionDescriptionInit; media?: CallMedia }
    | { type: "call:answer"; to: string; answer: RTCSessionDescriptionInit }
    | { type: "call:ice"; to: string; candidate: RTCIceCandidateInit }
    | { type: "call:end"; to: string };

export type FromOffer = { from: string, offer: RTCSessionDescriptionInit, media?: CallMedia }
export type FromAnswer = { from: string, answer: RTCSessionDescriptionInit }
export type FromCandidate = { from: string, candidate: RTCIceCandidateInit }