# Change: End-to-end-authenticated call signaling

## Why

WebRTC media in a 1:1 call is already end-to-end encrypted by **DTLS-SRTP** — coturn only
relays ciphertext and cannot decrypt it. The gap is **signaling**: the SDP offer/answer
(which carries `a=fingerprint`, the hash committing to each peer's DTLS certificate) is
relayed by the messenger server in **plaintext**. A malicious or compromised messenger
server can rewrite the fingerprint and run two DTLS handshakes (one per browser),
becoming an active man-in-the-middle that decrypts the call. This is the same adversary
(an untrusted server) that E2EE chat already defends against — but calls do not, so calls
are today weaker than chat.

This is NOT a TURN-server problem (TURN cannot read media and cannot inject SDP), and it
is NOT a passive-eavesdropping problem (DTLS-SRTP blocks that). It is an **active
signaling MITM** by the server.

## What Changes

- Carry the call SDP (offer and answer) **inside the existing Signal E2EE session**
  (`encryptForSend` / `decryptReceived`) instead of in the clear. The server then sees
  only ciphertext and cannot read or tamper with the `a=fingerprint`. The browser's own
  DTLS stack verifies the peer certificate against the now-authenticated fingerprint, so
  no manual fingerprint parsing is needed and no custom media crypto is added.
- **Fail closed, no downgrade:** if the SDP cannot be E2EE-wrapped (peer has no published
  keys) the call is ended with a clear message; there is NO plaintext-SDP fallback (a
  fallback would let the server force a downgrade back to the MITM).
- Applies to **both audio and video** calls (one PeerConnection, one DTLS session covers
  all tracks) — identically, with no per-media work.
- Surface a **"verified" indicator** on the call when the peer's safety number is already
  verified (reuses the chat's `isVerified`).
- ICE candidates stay as-is (they are transport addresses; with an authenticated
  fingerprint, routing media through a hostile relay still yields only ciphertext).
  Encrypting ICE for metadata is explicitly out of scope here.

Ships as a **separate release (v0.3.0) on its own branch**; `main` (v0.2.x) remains the
rollback anchor — reverting is a redeploy of `main`.

## Impact

- Affected specs: `calls` (new capability doc).
- Affected code (messenger-ui):
  - `front/src/features/call/service/webRTCService.ts` — encrypt offer/answer on send,
    decrypt on receive, fail-closed.
  - `front/src/features/call/middleware/callMiddleware.ts` — thread the ciphertext field.
  - `front/src/features/call/model/types.ts` + wire schema — `sdp: string` (ciphertext)
    replaces the plaintext `offer`/`answer` objects on `call:offer` / `call:answer`.
  - `front/src/features/call/ui/VideoCall.tsx` — verified indicator (optional).
- Behavior change: a call now **requires** both parties to have E2EE keys (provisioning is
  automatic at login, so this is normally always true). A call to a peer with no keys
  fails closed instead of connecting over plaintext-authenticated signaling.
- Rollout: no plaintext fallback means a client on the OLD bundle (plaintext SDP) and one
  on the NEW bundle cannot interoperate for the transition window — the old client must
  reload. This is the deliberate cost of refusing a downgrade path.
- No new dependencies. No change to coturn, DTLS-SRTP, or the media path.
