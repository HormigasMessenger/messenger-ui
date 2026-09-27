# Tasks

## 1. Sender-side peer cache (messenger-ui)
- [x] 1.1 Peer-roster cache `{ peerUserId → { deviceIds[], fetchedAt } }` in `signalStore`
      (db v2 `roster` store) with a 24h TTL. Sessions already persist in `signalStore`.
- [x] 1.2 `secretSession.ensureSessions` fast path: fresh snapshot + a live session per device
      → return device ids WITHOUT `fetchUserKeys` (no OPK spend); else fetch/establish/snapshot.
- [x] 1.3 `invalidatePeer(peerUserId)` drops the roster snapshot (keeps sessions).
- [x] 1.4 `encryptTo` encrypts to the (cached) device set unchanged.

## 2. Rekey hint — recipient side
- [x] 2.1 No `to[myDeviceId]` → `decryptFrom` throws → classified "wrong-device" in `failure.ts`.
- [x] 2.2 Emit `e2ee:rekey` (`rekeyHint.ts`) — `{to, conversationId}`, NO key material / deviceId.
- [x] 2.3 Coalesce: `makeThrottle` — at most one hint per peer per 10s window.

## 3. Rekey hint — sender side
- [x] 3.1 Inbound `e2ee:rekey` → `invalidatePeer` → next send re-resolves (fetch bypasses cache)
      → establishes new sessions → re-snapshots (in the e2ee recovery middleware).
- [x] 3.2 Affected past messages are recovered via the EXISTING client-to-client recovery path
      (the new device reports them undecryptable) rather than a bespoke resend; durable dedup
      still guards a double on a still-live old device.
- [x] 3.3 Rate-limit re-resolves: one per peer per window (`rekeyActThrottle`).

## 4. Wire format + types
- [x] 4.1 No schema change needed — `e2ee:rekey` rides the SIGNAL channel via the frameBridge
      `e2ee:` prefix (same as recovery/calls), carried as an `event` SIGNAL_IN.
- [x] 4.2 Inbound routed via `ws/incoming` to the sender handler; emission via `ws/send`.

## 5. Cache invalidation coverage
- [x] 5.1 Roster TTL expiry → `ensureSessions` fast path falls through to a fetch.
- [x] 5.2 Identity-change teardown retained in `ensureSessions` slow path; rekey hint covers the
      device-switch case promptly.

## 6. Directory TTL (hormiga-key-directory)
- [x] 6.1 `config.go` default `KD_DEVICE_TTL_DAYS` 30 → 60.
- [x] 6.2 README config table updated (device TTL default 60).

## 7. Tests
- [x] 7.1 `secretSession`: 2nd/3rd send reuses cache → `fetchUserKeys` NOT called.
- [x] 7.2 First send → fetch once + establish + snapshot.
- [x] 7.3 Rekey-hint throttle: one per peer per window; frame is metadata-only.
- [x] 7.4 `invalidatePeer` → next send re-fetches (secretSession test).
- [x] 7.5 Spoofed hint bounded by the throttle (one re-fetch per window) — unit-covered via throttle.
- [~] 7.6 Roster TTL expiry re-fetch — covered by the fast-path logic; not a dedicated timer test.
- [x] 7.7 Peer re-provision heals via invalidation (secretSession re-provision test, updated).
- [x] 7.8 (key-directory) last-resort memory test (pool→consume / empty+LRK / empty+no-LRK).
      TTL-60 default is config-level (no unit).
- [~] 7.9 Full middleware integration (emit-on-decrypt-fail wiring) verified by build + logic units,
      not a bespoke store-scaffolded middleware test.

## 8. Last-resort prekey (prekey-exhaustion hardening)
- [x] 8.1 (key-directory) migration V3: nullable `last_resort_id/last_resort_pub` on `e2e_identity`.
- [x] 8.2 (key-directory) `store` publish sets/rotates it; `dto.PublishRequest.LastResortPreKey`.
- [x] 8.3 (key-directory) `FetchAndConsume` serves the LRK (not consumed) only when the pool is
      empty; `OneTimePreKeyIsLastResort`. Postgres + Memory + interface parity.
- [x] 8.4 (key-directory) memory test (pool→consume / empty+LRK→serve-not-consume / empty+no-LRK→null).
- [x] 8.5 (messenger-ui) STABLE last-resort prekey at provision (reserved id); backfill on
      republish; stored in META; `signalStore` no-ops removePreKey for the reserved id (reusable).
- [x] 8.6 (messenger-ui) DTOs: `lastResortPreKey` on publish, `oneTimePreKeyIsLastResort` on fetch.
- [x] 8.7 (messenger-ui) tests: session establishes via LRK; reusable across two peers; reserved
      id absent from allocated OPK ids.

## 9. Replenish-on-demand
- [x] 9.1 `features/e2ee/index.ts`: periodic `selfCount → maybeReplenish` (30m interval + on
      tab-visible), in addition to startup.
- [x] 9.2 `maybeReplenish` decision covered by existing provisioning tests (low-water → replenish;
      healthy → no-op).

## 10. Doc-staleness cleanup (code ↔ model parity)
- [x] 10.1 `index.ts` "48h" → 7-day; recovery `protocol.ts`/middleware "48h" → 7-day.
- [x] 10.2 `index.ts` + `provisioning.ts` "serves only latest-published / v1 single-device"
      → serve-all + keep-newest; republish is a touch, not "current".

## 11. Release
- [~] 11.1 Gate green: app `tsc --noEmit` typecheck + 405 vitest + `vite build` (the deploy gate,
      per front/Dockerfile). Pre-existing repo-wide `tsc -b`/lint issues in untouched files remain.
- [ ] 11.2 Bump messenger-ui version; push branches; open PRs (prior main = rollback anchor).
- [ ] 11.3 Deploy: key-directory (V3 migration + `KD_DEVICE_TTL_DAYS=60`), then messenger-ui.
- [ ] 11.4 Live-verify: repeated sends consume no OPK (self-count steady); simulated device switch
      heals via one rekey round-trip; exhausted-pool fetch serves the LRK.
