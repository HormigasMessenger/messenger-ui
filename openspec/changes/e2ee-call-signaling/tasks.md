# Tasks

## 1. Wire format + types
- [ ] 1.1 `model/types.ts` + wire schema: `call:offer` / `call:answer` carry `sdp: string`
      (E2EE ciphertext) instead of the plaintext `offer` / `answer` objects.
- [ ] 1.2 Update `FromOffer` / `FromAnswer` shapes accordingly.

## 2. Encrypt on send (webRTCService)
- [ ] 2.1 `startCall` + `resendOffer`: `encryptForSend(peerId, JSON.stringify(offer))` → send `sdp`.
- [ ] 2.2 `handleOffer`: encrypt the answer with `encryptForSend(from, JSON.stringify(answer))`.
- [ ] 2.3 Wrap every `encryptForSend` in try/catch → on failure end the call + toast; NO plaintext fallback.

## 3. Decrypt on receive (webRTCService)
- [ ] 3.1 `handleOffer`: `JSON.parse(await decryptReceived(from, sdp))` → `setRemoteDescription`; on
      decrypt failure end the call (reject a tampered/forged SDP), never `setRemoteDescription` raw.
- [ ] 3.2 `handleAnswer`: same decrypt-then-apply.

## 4. Middleware threading
- [ ] 4.1 `callMiddleware`: pass the `sdp` ciphertext field through to `handleOffer` / `handleAnswer`.

## 5. Verified indicator (optional UX)
- [ ] 5.1 `VideoCall.tsx`: show "🔒 verified" when `isVerified(peerUserId)` for the current call.

## 6. Tests
- [ ] 6.1 webRTCService: offer/answer round-trip through mocked `encryptForSend`/`decryptReceived`;
      server never sees plaintext SDP.
- [ ] 6.2 Fail-closed: `encryptForSend` throws (no peer keys) → call ends, no `call:offer` with raw SDP.
- [ ] 6.3 Reject: `decryptReceived` throws (tampered SDP) → `setRemoteDescription` NOT called, call ended.
- [ ] 6.4 callMiddleware: `call:offer`/`call:answer` route the `sdp` field.

## 7. Release
- [ ] 7.1 `npm run ci` green on the host (lint + typecheck + test + build).
- [ ] 7.2 Bump version to 0.3.0; push branch; open PR (main = rollback anchor).
- [ ] 7.3 Deploy the branch build as the release; document the one-line rollback (redeploy main).
