import {openDB, type IDBPDatabase} from "idb";
import type {StorageType, KeyPairType, SessionRecordType} from "@privacyresearch/libsignal-protocol-typescript";
import {wrapBytes, unwrapBytes, type Wrapped} from "./deviceKey.ts";

// IndexedDB-backed implementation of libsignal's StorageType. The library hands us ArrayBuffer key
// material and opaque session-record strings; we persist them with the SENSITIVE parts (private keys,
// session/ratchet state) WRAPPED under the device key, and the PUBLIC parts (public keys, peer identities
// for TOFU) in the clear. All private bytes are only ever unwrapped into memory when the ratchet uses them.
//
// Stores: meta (identity keypair + registrationId + deviceId) · prekeys · signedprekeys · sessions (ratchet
// state, wrapped) · peers (peer public identity keys, for trust-on-first-use).

const V = 1;
const META = "meta", PREKEYS = "prekeys", SIGNED = "signedprekeys", SESSIONS = "sessions", PEERS = "peers";

// A stored keypair: public half in the clear, private half wrapped.
interface StoredKeyPair { pub: ArrayBuffer; priv: Wrapped }
async function packKeyPair(kp: KeyPairType): Promise<StoredKeyPair> { return { pub: kp.pubKey, priv: await wrapBytes(kp.privKey) }; }
async function unpackKeyPair(s: StoredKeyPair | undefined): Promise<KeyPairType | undefined> {
    if (!s) return undefined;
    return { pubKey: s.pub, privKey: await unwrapBytes(s.priv) };
}

const enc = new TextEncoder(), dec = new TextDecoder();

export class SignalStore implements StorageType {
    // dbName is parameterized so tests can isolate two "devices"; prod uses the single default.
    private dbName: string;
    constructor(dbName = "e2ee-signal") { this.dbName = dbName; }
    private db(): Promise<IDBPDatabase> {
        return openDB(this.dbName, V, {
            upgrade(d) {
                for (const s of [META, PREKEYS, SIGNED, SESSIONS, PEERS]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
            },
        });
    }

    // --- identity + registration (set once at provisioning) ---
    async setup(identity: KeyPairType, registrationId: number, deviceId: string): Promise<void> {
        const d = await this.db();
        await d.put(META, await packKeyPair(identity), "identity");
        await d.put(META, registrationId, "registrationId");
        await d.put(META, deviceId, "deviceId");
    }
    async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
        return unpackKeyPair((await (await this.db()).get(META, "identity")) as StoredKeyPair | undefined);
    }
    async getLocalRegistrationId(): Promise<number | undefined> {
        return (await (await this.db()).get(META, "registrationId")) as number | undefined;
    }
    async getDeviceId(): Promise<string | undefined> {
        return (await (await this.db()).get(META, "deviceId")) as string | undefined;
    }

    // --- peer identities (TOFU) ---
    async isTrustedIdentity(_addr: string, _identityKey: ArrayBuffer): Promise<boolean> {
        // TOFU with re-pinning: accept both first contact AND a later identity change.
        // A peer that re-provisions (cleared storage / new device) publishes a NEW identity;
        // rejecting it here (returning false on change) would DEADLOCK — the stale side could
        // neither re-establish a session (send) nor accept the peer's new prekey (receive), and
        // messaging/safety-numbers would never recover. Instead we let the change through and
        // surface it out-of-band: `saveIdentity` returns whether the key changed (caller warns),
        // and the safety number shifts → any prior verification auto-drops → "re-verify" prompt.
        // The safety number, compared in person, is the real MITM check — not this in-band gate.
        return true;
    }
    async saveIdentity(addr: string, publicKey: ArrayBuffer): Promise<boolean> {
        const d = await this.db();
        const prev = (await d.get(PEERS, addr)) as ArrayBuffer | undefined;
        await d.put(PEERS, publicKey, addr);
        return !!prev && !b64eq(prev, publicKey);             // true = the identity CHANGED (caller warns)
    }
    async loadIdentityKey(addr: string): Promise<ArrayBuffer | undefined> {
        return (await (await this.db()).get(PEERS, addr)) as ArrayBuffer | undefined;
    }
    /** A peer's stored identity public key, by userId (PEERS are keyed "userId.deviceNum"). v1: first device. */
    async getPeerIdentity(userId: string): Promise<ArrayBuffer | undefined> {
        const d = await this.db();
        const keys = (await d.getAllKeys(PEERS)) as string[];
        const k = keys.find((key) => key.startsWith(userId + "."));
        return k ? ((await d.get(PEERS, k)) as ArrayBuffer | undefined) : undefined;
    }

    // --- one-time prekeys ---
    async loadPreKey(id: string | number): Promise<KeyPairType | undefined> {
        return unpackKeyPair((await (await this.db()).get(PREKEYS, String(id))) as StoredKeyPair | undefined);
    }
    async storePreKey(id: string | number, kp: KeyPairType): Promise<void> {
        await (await this.db()).put(PREKEYS, await packKeyPair(kp), String(id));
    }
    async removePreKey(id: string | number): Promise<void> { await (await this.db()).delete(PREKEYS, String(id)); }
    async countPreKeys(): Promise<number> { return (await this.db()).count(PREKEYS); }

    /**
     * Allocate `count` fresh, strictly-increasing one-time-prekey ids and persist the new floor. Ids must
     * NEVER be reused for the life of the device: the directory keeps a published id's public key (insert
     * is ON CONFLICT DO NOTHING), so reissuing an id would leave the private we hold out of sync with the
     * public a peer fetches, and a prekey message under it would fail to decrypt. Older builds kept the
     * counter in a module variable that reset to 1 on every reload — this persists it. The floor is seeded
     * beyond any id already stored, so existing installs don't collide the first time this code runs.
     */
    async allocatePreKeyIds(count: number): Promise<number[]> {
        const d = await this.db();
        let floor = (await d.get(META, "nextPreKeyId")) as number | undefined;
        if (floor === undefined) {
            const keys = (await d.getAllKeys(PREKEYS)) as string[];
            let max = 0;
            for (const k of keys) { const n = parseInt(k, 10); if (Number.isFinite(n) && n > max) max = n; }
            floor = max + 1;
        }
        const ids: number[] = [];
        for (let i = 0; i < count; i++) ids.push(floor + i);
        await d.put(META, floor + count, "nextPreKeyId");
        return ids;
    }

    // --- signed prekeys ---
    async loadSignedPreKey(id: string | number): Promise<KeyPairType | undefined> {
        return unpackKeyPair((await (await this.db()).get(SIGNED, String(id))) as StoredKeyPair | undefined);
    }
    async storeSignedPreKey(id: string | number, kp: KeyPairType): Promise<void> {
        await (await this.db()).put(SIGNED, await packKeyPair(kp), String(id));
    }
    async removeSignedPreKey(id: string | number): Promise<void> { await (await this.db()).delete(SIGNED, String(id)); }

    // --- sessions (ratchet state — wrapped) ---
    async loadSession(addr: string): Promise<SessionRecordType | undefined> {
        const w = (await (await this.db()).get(SESSIONS, addr)) as Wrapped | undefined;
        if (!w) return undefined;
        return dec.decode(await unwrapBytes(w));
    }
    async storeSession(addr: string, record: SessionRecordType): Promise<void> {
        await (await this.db()).put(SESSIONS, await wrapBytes(enc.encode(record).buffer), addr);
    }
    /** Drop a session so the next handshake starts FRESH — used by recovery to avoid riding a stalled chain. */
    async deleteSession(addr: string): Promise<void> { await (await this.db()).delete(SESSIONS, addr); }

    /**
     * Prune stored PEER-IDENTITY entries for `userId`'s devices that are NOT in `keepAddrs`.
     * A peer that re-provisions (cleared storage / new device) gets a NEW device address, so its old
     * device's stored identity LINGERS. `getPeerIdentity` (find-first) could then return that stale key,
     * and the safety number computed against it never matches the peer's current one. Called on every
     * `ensureSessions` with the current roster's addresses so only live devices remain. Addresses are
     * "userId.deviceNum"; we scope the scan to this user's prefix so other peers are untouched. We prune
     * ONLY identities (PEERS): stale SESSIONS are inert (encrypt/decrypt only ever address the current
     * roster / envelope device) and the SESSIONS store also holds the recovery lane, which must survive.
     */
    async retainPeerDevices(userId: string, keepAddrs: Set<string>): Promise<void> {
        const d = await this.db();
        const prefix = userId + ".";
        const keys = (await d.getAllKeys(PEERS)) as string[];
        for (const k of keys) if (k.startsWith(prefix) && !keepAddrs.has(k)) await d.delete(PEERS, k);
    }

    // --- wipe (logout) ---
    async clear(): Promise<void> {
        const d = await this.db();
        for (const s of [META, PREKEYS, SIGNED, SESSIONS, PEERS]) await d.clear(s);
    }
}

function b64eq(a: ArrayBuffer, b: ArrayBuffer): boolean {
    const x = new Uint8Array(a), y = new Uint8Array(b);
    if (x.length !== y.length) return false;
    let diff = 0; for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];  // constant-time-ish
    return diff === 0;
}
