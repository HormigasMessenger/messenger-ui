// STUN must hit the ORIGIN host directly (coturn on 91.99.6.25:3478), NOT the Cloudflare-proxied
// hostname (CF only proxies HTTP). Override per-env with VITE_TURN_HOST. TURN creds are NO LONGER static
// in the bundle — they're fetched per call (short-lived, coturn use-auth-secret) via getIceConfig().
const TURN_HOST = (import.meta.env.VITE_TURN_HOST as string | undefined) ?? "91.99.6.25";

// If an outgoing call isn't answered/connected within this window, give up (end + toast) instead
// of leaving the caller on a black screen forever. Kept generous (60s) so a callee who was OFFLINE has
// time to receive the call push, open the app and call back while the caller is still ringing — that
// "glare" callback (callMiddleware call:offer) is what connects a closed-app answer. Past the window the
// caller goes idle and the callback simply rings them as a fresh incoming call instead.
export const CALL_TIMEOUT_MS = 60_000;

// STUN-only base (no auth). getIceConfig() appends short-lived TURN creds fetched per call. If that fetch
// fails, calls fall back to this STUN-only config (P2P works; only relay is unavailable).
export const ICE_SERVERS: RTCConfiguration = {
    iceServers: [
        // Our OWN STUN only — Google's public STUN would hand a third party (Google) the caller's IP and
        // the time of every call, and our coturn already provides STUN on the same host.
        { urls: `stun:${TURN_HOST}:3478` },
    ],
};
