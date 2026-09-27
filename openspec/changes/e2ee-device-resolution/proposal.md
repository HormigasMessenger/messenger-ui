# Change: Cached, lazily-resolved multi-device delivery for secret chats

## Why

Secret chats address ciphertext to a **device**, not a user (Signal is pairwise:
one Double Ratchet session per peer device). Two problems live in how the sender
currently finds a peer's devices:

1. **OPK burn on every send.** `encryptTo` → `ensureSessions` calls
   `fetchUserKeys(peer)` on **every message**, with no client cache. Each fetch
   (`GET /key-directory/v1/keys/{userId}`) **consumes one one-time-prekey (OPK)
   per device server-side**. But an OPK is only needed **once**, to run the X3DH
   handshake that establishes a session. Once the Double Ratchet session exists it
   advances on its own and needs no OPK. So today every message wastefully drains
   the peer's OPK pool, forces constant replenishment, and adds a directory
   round-trip plus rate-limit (429) pressure to the hot send path. The in-code
   comment already claims "only fetch for devices we don't already have a session
   with" — the code does not honor it.

2. **No path to discover a device switch.** If a peer moves from iPad to desktop,
   the sender keeps encrypting to the stale device until — nothing tells it
   otherwise. The just-shipped directory model (serve-all + `PruneStaleDevices`
   keep-newest) makes a fetch *return* the new device, but nothing prompts the
   sender to re-fetch.

The fix is a single coherent model: **cache the peer's sessions/roster on the
sender, and re-resolve only on an explicit signal.** A recipient device that
receives an envelope not addressed to it emits a metadata-only "rekey" hint; the
sender drops its cache for that peer, re-resolves from the trusted directory, and
re-encrypts to all currently-known devices. This is **lazily-discovered
multi-device**: after one round-trip the sender knows every live device and
delivers to all of them — parallel devices work, a device switch heals itself, and
OPKs are spent only on genuine session establishment.

## What Changes

- **Sender-side cache (messenger-ui).** Cache, per peer, the established sessions
  and a roster snapshot with a TTL (default 24h). A send that has a live cached
  session for the peer's devices uses it directly — **no directory fetch, no OPK
  consumption.** `fetchUserKeys` (and its OPK cost) runs only on a cache miss or an
  explicit invalidation.
- **Encrypt to all known devices.** Keep encrypt-to-all, but over the *cached*
  device set. Normally one device; during a transition, both. This preserves the
  robustness restored by the serve-all revert while removing the per-send fetch.
- **Rekey hint (metadata-only NACK).** When a recipient device receives an envelope
  whose `to` map has no entry for its own deviceId (it is a parallel/new device of
  the addressed user), it sends the sender a control message: "device mismatch,
  re-resolve me in this chat." It carries **no key material and no device address**
  — only a hint. Granularity is per chat/peer.
- **Invalidate-and-re-resolve.** On a rekey hint the sender: drops its cached roster
  for that peer, re-fetches from the directory **bypassing the cache**, establishes
  any missing sessions, encrypts to all now-known devices, and **resends** the
  affected message(s). The stale-device copy is dead (undecryptable by the new
  device); delivery happens on the resend. Durable dedup prevents a double if the
  old device was in fact still live.
- **Cache invalidation triggers:** (a) a rekey hint, (b) roster-snapshot TTL
  expiry, (c) local decrypt failure of the peer's reply (identity changed →
  re-install), which already tears down the stale session.
- **Rekey-hint safety.** The hint only triggers a re-fetch from the directory, whose
  `POST /keys` is auth-bound to the caller's `userId` (Oathkeeper) — a spoofed hint
  cannot inject an attacker device, only cause a spurious re-fetch, so hints are
  **coalesced / rate-limited** (one re-resolve per peer per burst).
- **Directory device TTL 30 → 60 days.** The shipped stale-device GC keeps the
  newest device per user always and prunes superseded devices older than the TTL;
  this change sets the TTL to 60 days (`KD_DEVICE_TTL_DAYS=60`). Keep-newest and
  never-delete-last are unchanged (a user must always have ≥1 fetchable device or a
  first contact 404s).
- **Last-resort prekey (prekey-exhaustion hardening).** Each device publishes one
  dedicated *reusable* last-resort one-time prekey. When a fetch finds the device's
  normal one-time-prekey pool exhausted, the directory serves the last-resort key
  (without consuming it) instead of `null`, so X3DH keeps its full 4-DH shape rather
  than degrading. Note: the security floor is unchanged — a reused last-resort key is
  cryptographically equivalent to the existing `IK+SPK`-only fallback (it loses the
  one-time replay/forward-secrecy property once reused). Its value is a uniform
  handshake shape for callers and a working session even under a drained pool. It is
  generated once and kept **stable** (not rotated): a peer may hold its public between
  fetch and first send, and it must stay reusable on the recipient side (the store
  no-ops prekey deletion for its reserved id). It does not restore per-handshake
  one-timeness under sustained exhaustion — only real replenishment does that.
- **Replenish-on-demand (not only at startup).** Today `maybeReplenish` runs once, at
  app launch, against the count returned by the startup republish. A fast drain
  (many peers fetching, or the pre-cache per-send burn) then sits exhausted until the
  next launch. This change replenishes whenever the client observes its own
  server-side remaining count at/below the low-water mark — checked periodically while
  active and after directory operations — so the pool refills without waiting for a
  relaunch.

## Impact

- Affected specs: `secret-chat` (new capability doc — sender resolution/caching +
  rekey hint), `key-directory` (device-lifetime contract this relies on).
- Affected code (messenger-ui):
  - `front/src/features/e2ee/lib/secretSession.ts` — `ensureSessions` reads the
    cache; fetch only on miss/invalidation; `encryptTo` over cached device set;
    `decryptFrom` signals "no ciphertext for this device" up to the middleware.
  - New: a peer-roster/session cache module (sessions already persist in
    `signalStore`; add a roster snapshot + TTL and an invalidate(peer) call).
  - `front/src/features/e2ee/lib/keyDirectory.ts` — no cost change; called less.
  - `front/src/features/chat/middleware/chatMiddleware.ts` (+ secretChat glue) —
    emit a rekey hint when an inbound envelope isn't for this device; handle an
    inbound hint by invalidating the peer cache and resending pending items.
  - Messenger wire: a `secret:rekey` control message (chatId + sender identity),
    metadata only.
- Affected code (hormiga-key-directory):
  - `internal/config/config.go` default `KD_DEVICE_TTL_DAYS` 30 → 60 (or set via
    deploy `.env`). Serve-all + keep-newest GC already shipped — no logic change.
  - Last-resort prekey: schema (a nullable last-resort prekey column / reusable row
    per device), `store` publish path stores it, `FetchAndConsume` serves it (not
    consumed) when the normal pool is empty; `dto.go` gains `lastResortPreKey` on the
    publish body and an `oneTimePreKeyIsLastResort` flag on the fetch response.
- Affected code (messenger-ui), prekey hardening:
  - `provisioning.ts` — generate + publish a last-resort prekey at provision; rotate
    it on `republishCurrentDevice`; store its private half.
  - `keyDirectory.ts` DTOs — `lastResortPreKey` on publish, `oneTimePreKeyIsLastResort`
    on fetch.
  - Replenish-on-demand: a periodic/self-triggered `selfCount` → `maybeReplenish`
    while active, in addition to the startup path in `features/e2ee/index.ts`.
- Behavior change: OPK consumption drops from ~1/message to ~1/session-establish.
  A first message after a peer's device switch costs one extra round-trip
  (send → hint → re-resolve → resend), shown as `pending` meanwhile.
- Security: unchanged trust model. The rekey hint is a hint, never trusted key
  material; re-resolution always goes through the auth-bound directory; safety
  numbers still change on a genuine device/identity change and prompt re-verify.
- Rollout: additive and backward-compatible. A sender without the cache still works
  (just wastes OPKs as today); a recipient without rekey-hint support just doesn't
  emit the hint (sender heals on roster TTL instead). No hard cutover.
