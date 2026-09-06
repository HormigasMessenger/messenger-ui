// Public API of the E2EE feature. Consumers import from here, not the internal lib modules.
export {ensureProvisioned, maybeReplenish} from "./lib/provisioning.ts";
export {SignalStore} from "./lib/signalStore.ts";
export {clearDeviceKey} from "./lib/deviceKey.ts";
export {selfCount} from "./lib/keyDirectory.ts";
export {encryptForSend, decryptReceived, isSecretEnvelope} from "./lib/secretChat.ts";
export {e2eeRecoveryMiddleware, reportUndecryptable} from "./recovery/e2eeRecoveryMiddleware.ts";
export {savePlaintext, loadPlaintext, deletePlaintextForChat, sweepExpired, E2EE_PLAINTEXT_TTL_MS} from "./lib/atRest.ts";
export {computeSafetyNumber, formatSafetyNumber, markVerified, clearVerified, isVerified} from "./lib/safetyNumber.ts";
export {cryptoStats, type CryptoStats} from "./lib/cryptoStats.ts";

import {ensureProvisioned, maybeReplenish} from "./lib/provisioning.ts";
import {selfCount} from "./lib/keyDirectory.ts";
import {sweepExpired, E2EE_PLAINTEXT_TTL_MS} from "./lib/atRest.ts";
import {logger} from "@/shared/logger/logger.ts";

// Arm the disappearing-messages sweep: purge locally-stored decrypted plaintext older than the TTL, on
// app start and then hourly. Best-effort; idempotent. Started once from provisionE2EEInBackground.
let sweepTimer: ReturnType<typeof setInterval> | null = null;
function armPlaintextSweep(): void {
    void sweepExpired(E2EE_PLAINTEXT_TTL_MS).catch(() => {});
    if (!sweepTimer) sweepTimer = setInterval(() => { void sweepExpired(E2EE_PLAINTEXT_TTL_MS).catch(() => {}); }, 60 * 60 * 1000);
}

/**
 * Fire-and-forget: make sure this device has published its E2EE keys to the directory, and top up the
 * one-time-prekey pool if it's low. Called once after login. FULLY best-effort — any failure (directory
 * down, WebCrypto unavailable, storage blocked) is swallowed so it can NEVER affect login or the app.
 * Publishes PUBLIC keys only; nothing user-visible. Readies the directory for secret chats (later phases).
 */
export function provisionE2EEInBackground(): void {
    // Ask the browser to keep our storage PERSISTENT so it isn't evicted under pressure — eviction would
    // wipe the device key + Signal identity + at-rest secret plaintext (unrecoverable; normal history
    // re-syncs from the server, secret history does not). Best-effort; a no-op where unsupported/denied.
    try { void navigator.storage?.persist?.(); } catch { /* ignore */ }
    armPlaintextSweep();   // disappearing-messages GC (48h)
    void (async () => {
        try {
            const {deviceId, provisioned} = await ensureProvisioned();
            if (!provisioned) {
                // Already provisioned earlier — just replenish the OPK pool if the server says it's low.
                try { const {oneTimePreKeysRemaining} = await selfCount(deviceId); await maybeReplenish(deviceId, oneTimePreKeysRemaining); }
                catch { /* directory unreachable → try again next login */ }
            }
        } catch (e) {
            logger.debug("e2ee background provisioning skipped (best-effort)", e as Error);
        }
    })();
}
