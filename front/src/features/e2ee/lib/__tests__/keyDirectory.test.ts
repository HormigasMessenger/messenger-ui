import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
import {publishKeys, replenishOneTime, selfCount, fetchUserKeys, KeyDirectoryError} from "../keyDirectory";

// The key-directory client is a thin same-origin REST wrapper over /key-directory/v1. Verify it hits the
// right paths/methods, carries the session cookie (credentials:include), and surfaces HTTP errors.

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

const okJson = (obj: unknown) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(obj)) });

describe("keyDirectory client", () => {
    it("publishKeys POSTs /keys with the body + credentials", async () => {
        fetchMock.mockReturnValue(okJson({ deviceId: "d1", oneTimePreKeysRemaining: 3 }));
        const out = await publishKeys({ deviceId: "d1", identityKey: "IK", signedPreKey: { id: 1, publicKey: "SPK", signature: "sig" }, oneTimePreKeys: [{ id: 100, publicKey: "O1" }] });
        expect(out.oneTimePreKeysRemaining).toBe(3);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/key-directory/v1/keys");
        expect(init.method).toBe("POST");
        expect(init.credentials).toBe("include");
        expect(JSON.parse(init.body).deviceId).toBe("d1");
    });

    it("fetchUserKeys GETs /keys/{userId}", async () => {
        fetchMock.mockReturnValue(okJson({ userId: "bob", devices: [{ deviceId: "bd", identityKey: "IK", signedPreKey: { id: 1, publicKey: "S", signature: "g" }, oneTimePreKey: null, oneTimePreKeysRemaining: 0 }] }));
        const out = await fetchUserKeys("bob");
        expect(out.devices[0].oneTimePreKey).toBeNull();  // exhausted pool → SPK-only X3DH
        expect(fetchMock.mock.calls[0][0]).toBe("/key-directory/v1/keys/bob");
    });

    it("selfCount encodes the deviceId query", async () => {
        fetchMock.mockReturnValue(okJson({ deviceId: "d 1", oneTimePreKeysRemaining: 7 }));
        await selfCount("d 1");
        expect(fetchMock.mock.calls[0][0]).toBe("/key-directory/v1/keys/self/count?deviceId=d%201");
    });

    it("replenishOneTime POSTs /keys/one-time", async () => {
        fetchMock.mockReturnValue(okJson({ deviceId: "d1", oneTimePreKeysRemaining: 10 }));
        await replenishOneTime("d1", [{ id: 200, publicKey: "X" }]);
        expect(fetchMock.mock.calls[0][0]).toBe("/key-directory/v1/keys/one-time");
        expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    });

    it("throws KeyDirectoryError with the status on a non-2xx", async () => {
        fetchMock.mockReturnValue(Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("") }));
        await expect(fetchUserKeys("bob")).rejects.toBeInstanceOf(KeyDirectoryError);
        await expect(fetchUserKeys("bob")).rejects.toMatchObject({ status: 401 });
    });
});
