// @vitest-environment node
// Pure crypto/logic — run in NODE, not jsdom. jsdom gives a second JS realm (its own ArrayBuffer), so a
// node-WebCrypto ArrayBuffer fails the library's `instanceof ArrayBuffer` check even with correct bytes.
// One realm (node) matches production (a browser is single-realm) and lets X3DH validate our keys.
import "fake-indexeddb/auto";
import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
import {SignalStore} from "../signalStore";
import {ensureProvisioned} from "../provisioning";
import {encryptTo, decryptFrom} from "../secretSession";

// End-to-end 2c+2d: two independent "devices" (isolated IndexedDB stores) provision into a shared FAKE
// directory, then Alice encrypts to Bob and Bob decrypts — through the REAL SignalStore + wrapping + the
// real X3DH/Double Ratchet. This is the proof the crypto engine works before wiring it to the chat path.

// A stateful in-memory stand-in for hormiga-key-directory: publish stores a device bundle under the
// caller's userId; fetch returns them (and would consume an OPK — we keep it simple and don't deplete).
type Bundle = { deviceId: string; identityKey: string; signedPreKey: {id:number;publicKey:string;signature:string}; oneTimePreKeys: {id:number;publicKey:string}[] };
const dir: Record<string, Bundle[]> = {};
let currentUser = "alice";                    // whom the auth header would identify

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("/key-directory/v1", "");
    if (init?.method === "POST" && path === "/keys") {
        const body = JSON.parse(init.body as string) as Bundle;
        (dir[currentUser] ||= []).push(body);
        return { ok: true, status: 200, text: async () => JSON.stringify({ deviceId: body.deviceId, oneTimePreKeysRemaining: body.oneTimePreKeys.length }) };
    }
    const m = path.match(/^\/keys\/([^/]+)$/);   // GET /keys/{userId}
    if (m) {
        const user = decodeURIComponent(m[1]);
        const devices = (dir[user] || []).map((b) => ({
            deviceId: b.deviceId, identityKey: b.identityKey, signedPreKey: b.signedPreKey,
            oneTimePreKey: b.oneTimePreKeys[0] ?? null, oneTimePreKeysRemaining: b.oneTimePreKeys.length,
        }));
        return { ok: true, status: 200, text: async () => JSON.stringify({ userId: user, devices }) };
    }
    return { ok: false, status: 404, text: async () => "" };
});

beforeEach(() => { for (const k of Object.keys(dir)) delete dir[k]; vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

async function provisionAs(user: string, dbName: string) {
    currentUser = user;
    const store = new SignalStore(dbName);
    const { deviceId } = await ensureProvisioned(store);
    return { store, deviceId };
}

describe("secretSession — X3DH + Double Ratchet, end to end", () => {
    it("Alice encrypts to Bob; Bob decrypts (X3DH established from the directory bundle)", async () => {
        const alice = await provisionAs("alice", "e2ee-alice");
        const bob = await provisionAs("bob", "e2ee-bob");

        const env = await encryptTo(alice.store, "bob", alice.deviceId, "hola bob 🔐");
        expect(env.alg).toBe("signal");
        expect(env.from).toBe(alice.deviceId);
        expect(env.to[bob.deviceId]).toBeTruthy();            // encrypted to bob's device
        // The envelope carries ONLY ciphertext — no plaintext leaks.
        expect(JSON.stringify(env)).not.toContain("hola");

        const plain = await decryptFrom(bob.store, "alice", bob.deviceId, env);
        expect(plain).toBe("hola bob 🔐");
    });

    it("steady-state ratchet: several messages both directions", async () => {
        const alice = await provisionAs("alice", "e2ee-a2");
        const bob = await provisionAs("bob", "e2ee-b2");

        const e1 = await encryptTo(alice.store, "bob", alice.deviceId, "m1");
        expect(await decryptFrom(bob.store, "alice", bob.deviceId, e1)).toBe("m1");
        const e2 = await encryptTo(alice.store, "bob", alice.deviceId, "m2");
        expect(await decryptFrom(bob.store, "alice", bob.deviceId, e2)).toBe("m2");
        // Bob → Alice
        const r1 = await encryptTo(bob.store, "alice", bob.deviceId, "reply");
        expect(await decryptFrom(alice.store, "bob", alice.deviceId, r1)).toBe("reply");
    });

    it("encrypting to a peer with NO published keys throws NO_PEER_KEYS (not a vague failure)", async () => {
        const alice = await provisionAs("alice", "e2ee-nk");
        // "carol" never provisioned → directory has nothing → 404 → empty roster → NO_PEER_KEYS.
        await expect(encryptTo(alice.store, "carol", alice.deviceId, "hi")).rejects.toThrow("NO_PEER_KEYS");
    });

    it("out-of-order deliver (3,1,2) all decrypt; a duplicate is rejected", async () => {
        const alice = await provisionAs("alice", "e2ee-a3");
        const bob = await provisionAs("bob", "e2ee-b3");
        // establish
        const e0 = await encryptTo(alice.store, "bob", alice.deviceId, "hello");
        await decryptFrom(bob.store, "alice", bob.deviceId, e0);

        const m1 = await encryptTo(alice.store, "bob", alice.deviceId, "one");
        const m2 = await encryptTo(alice.store, "bob", alice.deviceId, "two");
        const m3 = await encryptTo(alice.store, "bob", alice.deviceId, "three");
        expect(await decryptFrom(bob.store, "alice", bob.deviceId, m3)).toBe("three");   // ahead
        expect(await decryptFrom(bob.store, "alice", bob.deviceId, m1)).toBe("one");     // gap fill
        expect(await decryptFrom(bob.store, "alice", bob.deviceId, m2)).toBe("two");
        // replay m1 → the message key is gone
        await expect(decryptFrom(bob.store, "alice", bob.deviceId, m1)).rejects.toBeTruthy();
    });
});
