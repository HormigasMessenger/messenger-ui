import {KeyHelper} from "@privacyresearch/libsignal-protocol-typescript";
import {SignalStore} from "./signalStore.ts";
import {b64} from "./deviceKey.ts";
import {publishKeys, replenishOneTime, type PublishBody, type PreKeyPub} from "./keyDirectory.ts";
import {logger} from "@/shared/logger/logger.ts";

// Device provisioning: generate this device's Signal keys, persist the PRIVATES to the wrapped store, and
// publish the PUBLICS to the key directory. Idempotent — a device provisions ONCE (stable identity +
// deviceId); after that it only replenishes its one-time-prekey pool. The directory only ever sees public
// keys; nothing here reveals a private key.

const OPK_BATCH = 20;           // how many one-time prekeys to seed / replenish at a time
const OPK_LOW_WATER = 5;        // replenish when the server-side remaining count drops to/below this
const SPK_ID = 1;

function randomDeviceId(): string {
    try { return crypto.randomUUID(); } catch { return "dev-" + Date.now() + "-" + Math.random().toString(36).slice(2); }
}

let nextPreKeyId = 1;           // monotonic id source for OPKs across a session (persisted floor is the store)

/**
 * Ensure this device has an identity in the directory. First run: generate identity + registrationId +
 * signed prekey + an OPK pool, persist privates (wrapped), publish publics. Subsequent runs: no-op (the
 * identity is already set) beyond an optional replenish. Returns the store, ready for X3DH (Phase 2c).
 */
export async function ensureProvisioned(store = new SignalStore()): Promise<{store: SignalStore; deviceId: string; provisioned: boolean}> {
    const existing = await store.getIdentityKeyPair();
    if (existing) {
        const deviceId = (await store.getDeviceId())!;
        return {store, deviceId, provisioned: false};
    }

    const identity = await KeyHelper.generateIdentityKeyPair();
    const registrationId = KeyHelper.generateRegistrationId();
    const deviceId = randomDeviceId();
    await store.setup(identity, registrationId, deviceId);

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
    logger.debug("e2ee: device provisioned + published", {deviceId, opks: opks.length});
    return {store, deviceId, provisioned: true};
}

/** Generate `count` one-time prekeys, persist their privates, return the PUBLIC halves for the directory. */
async function generateOPKs(store: SignalStore, count: number): Promise<PreKeyPub[]> {
    const out: PreKeyPub[] = [];
    for (let i = 0; i < count; i++) {
        const id = nextPreKeyId++;
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
    const opks = await generateOPKs(store, OPK_BATCH);
    await replenishOneTime(deviceId, opks);
    logger.debug("e2ee: OPK pool replenished", {deviceId, added: opks.length});
    return true;
}
