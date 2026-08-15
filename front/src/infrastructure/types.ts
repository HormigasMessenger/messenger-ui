type WSStatus = "disconnected" | "connecting" | "connected"

export type WSMessage = {
    type: string;
    [key: string]: unknown;
}
export type WSDispatcher = (data: WSMessage) => void;

// WebRTC signalling wire types live HERE (the WS boundary), not in features/call — infrastructure is a
// lower layer and must not import UP into a feature. features/call re-exports these downward.
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

export type WebSocketState = {
    status: WSStatus;
    lastIncoming: IncomingWSMessage | null;
    lastOutgoing: OutgoingWSMessage | null;
    error: string | null;
    epoch: number;   // incremented on each (re)connect; used by the outbox for duplicate-safe resend
    // A newer session for this user (another tab/device) took over → the backend closed us with 4409
    // and we deliberately stopped auto-reconnecting. Distinct from a plain "disconnected" so the UI can
    // tell the user WHY they went offline and offer to take the session back here. Cleared on (re)connect.
    superseded: boolean;
};

// After the frameBridge, WebRTC signaling arrives as a `call:*` frame; everything else
// is a raw backend frame (CHAT_OUT, CHAT_ACK, READ_OUT, PRESENT_*, SYSTEM_OUT, ...).
export type IncomingWSMessage = IncomingWebRTCMessage | WSMessage;

export type OutgoingWSMessage = {
    type: string;
    [key: string]: unknown;
};
