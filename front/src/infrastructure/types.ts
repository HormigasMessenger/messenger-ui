import type {IncomingWebRTCMessage} from "@/features/call/model/types.ts";

type WSStatus = "disconnected" | "connecting" | "connected"

export type WSMessage = {
    type: string;
    [key: string]: unknown;
}
export type WSDispatcher = (data: WSMessage) => void;

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
