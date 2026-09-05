import "fake-indexeddb/auto";
import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
import {SignalStore} from "../signalStore";
import {ensureProvisioned, maybeReplenish} from "../provisioning";
import {wrapBytes, unwrapBytes} from "../deviceKey";

// Provisioning: generate device keys, persist PRIVATES wrapped, publish PUBLICS. These tests run against
// fake-indexeddb + node's WebCrypto and a mocked key-directory (fetch), so they exercise the real store +
// wrapping + KeyHelper without a browser or the live service.

const fetchMock = vi.fn();
beforeEach(() => {
    fetchMock.mockReset();
    // publish/replenish return a small count JSON
    fetchMock.mockReturnValue(Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ deviceId: "d", oneTimePreKeysRemaining: 20 })) }));
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("device key wrapping", () => {
    it("round-trips bytes through the non-extractable device key", async () => {
        const plain = new TextEncoder().encode("secret material").buffer;
        const w = await wrapBytes(plain);
        expect(new Uint8Array(w.ct)).not.toEqual(new Uint8Array(plain));   // actually encrypted
        const back = await unwrapBytes(w);
        expect(new TextDecoder().decode(back)).toBe("secret material");
    });
});

describe("ensureProvisioned", () => {
    it("first run: generates identity, publishes a bundle (publics only), persists privates", async () => {
        const store = new SignalStore();
        const { deviceId, provisioned } = await ensureProvisioned(store);
        expect(provisioned).toBe(true);
        expect(deviceId).toBeTruthy();

        // Published exactly once, to the publish endpoint, with a public bundle.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/key-directory/v1/keys");
        const body = JSON.parse(init.body);
        expect(body.deviceId).toBe(deviceId);
        expect(typeof body.identityKey).toBe("string");            // base64 PUBLIC key
        expect(body.signedPreKey.signature).toBeTruthy();
        expect(body.oneTimePreKeys.length).toBe(20);
        // The body must NOT contain any private field.
        expect(JSON.stringify(body)).not.toMatch(/priv/i);

        // Privates are persisted + usable (identity keypair round-trips through the wrapped store).
        const idkp = await store.getIdentityKeyPair();
        expect(idkp?.privKey.byteLength).toBeGreaterThan(0);
        expect(await store.countPreKeys()).toBe(20);
        expect(await store.loadSignedPreKey(1)).toBeTruthy();
    });

    it("second run: idempotent — does NOT re-publish or change the identity", async () => {
        const store = new SignalStore();
        const first = await ensureProvisioned(store);
        fetchMock.mockClear();
        const second = await ensureProvisioned(store);
        expect(second.provisioned).toBe(false);
        expect(second.deviceId).toBe(first.deviceId);
        expect(fetchMock).not.toHaveBeenCalled();                  // no re-publish
    });
});

describe("maybeReplenish", () => {
    it("replenishes when the pool is at/below low-water, no-ops otherwise", async () => {
        const store = new SignalStore();
        await ensureProvisioned(store);
        fetchMock.mockClear();

        expect(await maybeReplenish("d", 20, store)).toBe(false);  // plenty left → no-op
        expect(fetchMock).not.toHaveBeenCalled();

        expect(await maybeReplenish("d", 3, store)).toBe(true);    // low → replenish
        expect(fetchMock.mock.calls[0][0]).toBe("/key-directory/v1/keys/one-time");
        expect(await store.countPreKeys()).toBe(40);               // 20 initial + 20 new
    });
});
