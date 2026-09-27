# Tasks

## 1. Sender-side peer cache (messenger-ui)
- [ ] 1.1 Add a peer-roster cache: `{ peerUserId → { deviceIds[], fetchedAt } }`,
      persisted (IndexedDB) with a TTL (default 24h). Sessions themselves already
      persist in `signalStore`.
- [ ] 1.2 `secretSession.ensureSessions`: if a fresh roster snapshot exists AND a
      live session exists for each of its devices → return those device ids WITHOUT
      calling `fetchUserKeys` (no OPK spend). Otherwise fetch, establish, snapshot.
- [ ] 1.3 Add `invalidatePeer(peerUserId)` that drops the roster snapshot (keeps
      still-valid sessions) so the next send re-fetches.
- [ ] 1.4 Verify `encryptTo` encrypts to the (cached) device set unchanged.

## 2. Rekey hint — recipient side
- [ ] 2.1 `decryptFrom` / chat middleware: when an inbound envelope has no `to[myDeviceId]`,
      do NOT error silently — classify it as "mis-addressed" and trigger a hint.
- [ ] 2.2 Emit a `secret:rekey` control message to the sender: `{ chatId }` + the
      messenger-authenticated sender identity; NO key material, NO deviceId.
- [ ] 2.3 Coalesce: at most one hint per peer per short window (dedupe by peer).

## 3. Rekey hint — sender side
- [ ] 3.1 Handle inbound `secret:rekey`: `invalidatePeer(peer)` → re-resolve
      (`fetchUserKeys` bypassing cache) → establish new sessions → re-snapshot.
- [ ] 3.2 Resend the affected message(s) to the now-known device set; rely on durable
      dedup to avoid a double on a still-live old device.
- [ ] 3.3 Rate-limit / coalesce re-resolves: one per peer per burst.

## 4. Wire format + types
- [ ] 4.1 Add `secret:rekey` to the messenger wire schema (metadata only).
- [ ] 4.2 Route it through `chatMiddleware` to the sender handler.

## 5. Cache invalidation coverage
- [ ] 5.1 Invalidate on roster TTL expiry (checked in `ensureSessions`).
- [ ] 5.2 Invalidate on local decrypt-failure/identity-change (reuse existing
      re-provision teardown in `ensureSessions`).

## 6. Directory TTL (hormiga-key-directory)
- [ ] 6.1 `internal/config/config.go`: default `KD_DEVICE_TTL_DAYS` 30 → 60 (or set in
      deploy `.env`). No logic change (serve-all + keep-newest GC already shipped).
- [ ] 6.2 Update README config table (device TTL default 60).

## 7. Tests
- [ ] 7.1 `secretSession`: 2nd send reuses cache → `fetchUserKeys` NOT called, no OPK.
- [ ] 7.2 First send → fetch once + establish + snapshot.
- [ ] 7.3 Mis-addressed envelope → emits exactly one rekey hint (coalesced on repeat).
- [ ] 7.4 Inbound rekey hint → invalidate + re-resolve + encrypt-to-all + resend.
- [ ] 7.5 Spoofed hint → only a bounded re-fetch; no attacker device used.
- [ ] 7.6 Roster TTL expiry → next send re-fetches.
- [ ] 7.7 Identity change → session torn down, safety number unverified, re-resolve.
- [ ] 7.8 (key-directory) `KD_DEVICE_TTL_DAYS` unset → 60d effective; `=0` disables.

## 8. Last-resort prekey (prekey-exhaustion hardening)
- [ ] 8.1 (key-directory) migration: per-device reusable last-resort prekey (id + pub),
      nullable; not counted in the consumable remaining.
- [ ] 8.2 (key-directory) `store` publish stores/updates the last-resort key; `dto.go`
      `PublishBody.lastResortPreKey?`.
- [ ] 8.3 (key-directory) `FetchAndConsume`: when the normal pool is empty and a
      last-resort key exists, serve it WITHOUT consuming; response
      `oneTimePreKeyIsLastResort: true`. Postgres + Memory + interface parity.
- [ ] 8.4 (key-directory) tests: pool→consume; empty+LRK→serve-not-consume; empty+no-LRK→null.
- [x] 8.5 (messenger-ui) `provisioning.ts`: generate + publish a STABLE last-resort prekey
      at provision (reserved id); backfill/re-assert on `republishCurrentDevice`; store
      private in META; `signalStore` no-ops removePreKey for the reserved id (reusable).
- [x] 8.6 (messenger-ui) `keyDirectory.ts` DTOs: `lastResortPreKey` on publish,
      `oneTimePreKeyIsLastResort` on fetch (X3DH treats it as an ordinary OPK).
- [ ] 8.7 (messenger-ui) tests: session establishes against an exhausted peer via LRK;
      LRK reusable across two peers; reserved id absent from allocated OPK ids.

## 9. Replenish-on-demand
- [ ] 9.1 (messenger-ui) trigger `maybeReplenish` whenever a self-directory response
      reports `remaining ≤ LOW_WATER`, plus a lightweight periodic `selfCount` while
      active — not only at startup.
- [ ] 9.2 (messenger-ui) tests: remaining ≤ low-water while active → replenish; healthy → no-op.

## 10. Doc-staleness cleanup (code ↔ model parity)
- [ ] 10.1 `features/e2ee/index.ts:36` comment "48h" → 7 days (matches current TTL).
- [ ] 10.2 `index.ts:43` + `provisioning.ts:79` comments "serves only latest-published
      / v1 single-device" → serve-all + keep-newest; republish is a touch, not "current".

## 11. Release
- [ ] 11.1 `npm run ci` green on the host (lint + typecheck + test + build).
- [ ] 11.2 Bump messenger-ui version; push branch; open PR (prior main = rollback anchor).
- [ ] 11.3 Deploy directory (`KD_DEVICE_TTL_DAYS=60`, last-resort migration) + messenger-ui.
- [ ] 11.4 Live-verify: repeated sends consume no OPK (self-count steady); a simulated
      device switch heals via one rekey round-trip; exhausted-pool fetch serves the LRK.
