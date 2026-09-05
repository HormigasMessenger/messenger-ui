// Public API of the E2EE feature. Consumers import from here, not the internal lib modules.
export {ensureProvisioned, maybeReplenish} from "./lib/provisioning.ts";
export {SignalStore} from "./lib/signalStore.ts";
export {clearDeviceKey} from "./lib/deviceKey.ts";
export {selfCount} from "./lib/keyDirectory.ts";
export {encryptForSend, decryptReceived, isSecretEnvelope} from "./lib/secretChat.ts";
export {savePlaintext, loadPlaintext, deletePlaintextForChat, sweepExpired} from "./lib/atRest.ts";

import {ensureProvisioned, maybeReplenish} from "./lib/provisioning.ts";
import {selfCount} from "./lib/keyDirectory.ts";
import {logger} from "@/shared/logger/logger.ts";

/**
 * Fire-and-forget: make sure this device has published its E2EE keys to the directory, and top up the
 * one-time-prekey pool if it's low. Called once after login. FULLY best-effort — any failure (directory
 * down, WebCrypto unavailable, storage blocked) is swallowed so it can NEVER affect login or the app.
 * Publishes PUBLIC keys only; nothing user-visible. Readies the directory for secret chats (later phases).
 */
export function provisionE2EEInBackground(): void {
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
