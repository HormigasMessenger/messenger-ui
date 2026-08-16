// TURN/STUN must hit the ORIGIN host directly (coturn on 91.99.6.25:3478), NOT the
// Cloudflare-proxied hostname (CF only proxies HTTP). Override per-env with VITE_TURN_*.
const TURN_HOST = (import.meta.env.VITE_TURN_HOST as string | undefined) ?? "91.99.6.25";
const TURN_USER = (import.meta.env.VITE_TURN_USER as string | undefined) ?? "user";
const TURN_PASS = (import.meta.env.VITE_TURN_PASS as string | undefined) ?? "pass";

// If an outgoing call isn't answered/connected within this window, give up (end + toast) instead
// of leaving the caller on a black screen forever. Kept generous (60s) so a callee who was OFFLINE has
// time to receive the call push, open the app and call back while the caller is still ringing — that
// "glare" callback (callMiddleware call:offer) is what connects a closed-app answer. Past the window the
// caller goes idle and the callback simply rings them as a fresh incoming call instead.
export const CALL_TIMEOUT_MS = 60_000;

// Answering from a call push: the callee sends call:ready and expects the caller to re-offer (→ a real
// incoming dialog). If no offer arrives within this window (caller gave up, or the ready was lost), fall
// back to the glare callback — the callee calls the caller back instead.
export const READY_FALLBACK_MS = 4_000;

export const ICE_SERVERS: RTCConfiguration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: `stun:${TURN_HOST}:3478` },
        {
            urls: [
                `turn:${TURN_HOST}:3478?transport=udp`,
                `turn:${TURN_HOST}:3478?transport=tcp`,
            ],
            username: TURN_USER,
            credential: TURN_PASS,
        },
    ],
};
