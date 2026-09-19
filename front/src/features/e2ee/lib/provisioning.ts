import {KeyHelper} from "@privacyresearch/libsignal-protocol-typescript";
import {SignalStore} from "./signalStore.ts";
import {b64} from "./deviceKey.ts";
import {publishKeys, replenishOneTime, selfCount, KeyDirectoryError, type PublishBody, type PreKeyPub} from "./keyDirectory.ts";
import {logger} from "@/shared/logger/logger.ts";

// Device provisioning: generate this device's Signal keys, persist the PRIVATES to the wrapped store, and
// publish the PUBLICS to the key directory. Idempotent — a device provisions ONCE (stable identity +
// deviceId); after that it only replenishes its one-time-prekey pool. The directory only ever sees public
// keys; nothing here reveals a private key.

const OPK_BATCH = 20;           // how many one-time prekeys to seed at first provision
const OPK_TARGET = 20;          // top the pool UP TO this on replenish (never grow it unbounded)
const OPK_LOW_WATER = 5;        // replenish when the server-side remaining count drops to/below this
const SPK_ID = 1;

function randomDeviceId(): string {
    try { return crypto.randomUUID(); } catch { return "dev-" + Date.now() + "-" + Math.random().toString(36).slice(2); }
}

/**
 * Ensure this device has an identity in the directory. First run: generate identity + registrationId +
 * signed prekey + an OPK pool, persist privates (wrapped), publish publics. Subsequent runs: no-op (the
 * identity is already set) beyond an optional replenish. Returns the store, ready for X3DH (Phase 2c).
 */
export async function ensureProvisioned(store = new SignalStore()): Promise<{store: SignalStore; deviceId: string; provisioned: boolean}> {
    const existing = await store.getIdentityKeyPair();
    if (existing) {
        const deviceId = (await store.getDeviceId())!;
        // Self-heal: this device has local keys, but a prior publish may have failed
        // (e.g. the directory was unreachable) — then the directory doesn't know this
        // device and X3DH with it silently fails. Detect via a self-count 404 and
        // RE-PUBLISH from the local store: same identity (never rotated), a fresh
        // signed prekey + one-time-prekey pool. Any other error (network/500) must
        // NOT block startup — log and carry on.
        try {
            await selfCount(deviceId);
        } catch (e) {
            if (e instanceof KeyDirectoryError && e.status === 404) {
                await buildAndPublish(store, deviceId, existing);
                logger.warn("e2ee: device was missing from the directory — re-published", {deviceId});
                return {store, deviceId, provisioned: true};
            }
            logger.warn("e2ee: self-count failed (non-404); skipping self-heal", {deviceId});
        }
        return {store, deviceId, provisioned: false};
    }

    const identity = await KeyHelper.generateIdentityKeyPair();
    const registrationId = KeyHelper.generateRegistrationId();
    const deviceId = randomDeviceId();
    await store.setup(identity, registrationId, deviceId);
    await buildAndPublish(store, deviceId, identity);
    logger.debug("e2ee: device provisioned + published", {deviceId});
    return {store, deviceId, provisioned: true};
}

// buildAndPublish generates a fresh signed prekey + one-time-prekey pool for the
// (already-set-up) identity, persists the privates, and publishes the publics.
// Shared by first-run provisioning and the self-heal re-publish. The identity key
// is passed in unchanged — it is this device's stable identity and is never rotated.
async function buildAndPublish(store: SignalStore, deviceId: string, identity: {pubKey: ArrayBuffer; privKey: ArrayBuffer}): Promise<void> {
    const signed = await KeyHelper.generateSignedPreKey(identity, SPK_ID);
    await store.storeSignedPreKey(SPK_ID, signed.keyPair);
    const opks = await generateOPKs(store, OPK_BATCH);
    const body: PublishBody = {
        deviceId,
        identityKey: b64(identity.pubKey),
        signedPreKey: { id: SPK_ID, publicKey: b64(signed.keyPair.pubKey), signature: b64(signed.signature) },
        oneTimePreKeys: opks,
    };
    await publishKeys(body);
    logger.debug("e2ee: keys published", {deviceId, opks: opks.length});
}

/**
 * Re-publish THIS device's identity so the directory treats it as the user's CURRENT device.
 * The directory serves a peer only the most-recently-published device (v1 single-device). A user who
 * has provisioned in more than one place — a second browser, or a storage-eviction re-provision — leaves
 * other device rows behind; whichever was published LAST wins "current", even if it isn't the browser the
 * user is actually in. A peer would then verify against that other device's identity and the safety number
 * would never match. Touching on startup (bump identity updated_at + rotate the signed prekey; the OPK pool
 * is left intact) makes the ACTIVE browser current. Best-effort. Returns the server's remaining-OPK count.
 */
export async function republishCurrentDevice(store: SignalStore, deviceId: string): Promise<number> {
    const identity = await store.getIdentityKeyPair();
    if (!identity) return 0;                        // not provisioned yet → nothing to assert
    const signed = await KeyHelper.generateSignedPreKey(identity, SPK_ID);
    await store.storeSignedPreKey(SPK_ID, signed.keyPair);
    const {oneTimePreKeysRemaining} = await publishKeys({
        deviceId,
        identityKey: b64(identity.pubKey),
        signedPreKey: {id: SPK_ID, publicKey: b64(signed.keyPair.pubKey), signature: b64(signed.signature)},
        oneTimePreKeys: [],                         // touch only — never perturb the existing OPK pool
    });
    logger.debug("e2ee: re-asserted current device", {deviceId, remaining: oneTimePreKeysRemaining});
    return oneTimePreKeysRemaining;
}

/** Generate `count` one-time prekeys under freshly-allocated, NEVER-reused ids (persisted floor in the
 * store), persist their privates, and return the PUBLIC halves for the directory. */
async function generateOPKs(store: SignalStore, count: number): Promise<PreKeyPub[]> {
    const ids = await store.allocatePreKeyIds(count);
    const out: PreKeyPub[] = [];
    for (const id of ids) {
        const pk = await KeyHelper.generatePreKey(id);
        await store.storePreKey(id, pk.keyPair);
        out.push({ id, publicKey: b64(pk.keyPair.pubKey) });
    }
    return out;
}

/**
 * Replenish the one-time-prekey pool if the directory reports it running low. `remaining` is the
 * server-side count (from a publish/fetch/self-count response). Best-effort; publishes only the new publics.
 */
export async function maybeReplenish(deviceId: string, remaining: number, store = new SignalStore()): Promise<boolean> {
    if (remaining > OPK_LOW_WATER) return false;
    const need = OPK_TARGET - remaining;          // top UP TO the target, don't just add a fixed batch
    if (need <= 0) return false;
    const opks = await generateOPKs(store, need);
    await replenishOneTime(deviceId, opks);
    logger.debug("e2ee: OPK pool replenished", {deviceId, added: opks.length, target: OPK_TARGET});
    return true;
}
