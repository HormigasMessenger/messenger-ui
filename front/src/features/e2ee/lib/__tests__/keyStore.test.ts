import "fake-indexeddb/auto";
import {describe, it, expect, beforeEach} from "vitest";
import {getOrCreateIdentity, loadIdentity, clearIdentity} from "../keyStore.ts";

describe("e2ee keyStore", () => {
    beforeEach(async () => { await clearIdentity(); });

    it("returns null before any identity exists", async () => {
        expect(await loadIdentity()).toBeNull();
    });

    it("creates + persists an identity, and returns the SAME one on the next call", async () => {
        const first = await getOrCreateIdentity();
        expect(first.keyId).toMatch(/^[0-9a-f]{16}$/);
        const again = await getOrCreateIdentity();
        expect(again.keyId).toBe(first.keyId);
        expect((await loadIdentity())?.keyId).toBe(first.keyId);
    });

    it("persists a NON-extractable private key across load", async () => {
        await getOrCreateIdentity();
        const loaded = await loadIdentity();
        expect(loaded).not.toBeNull();
        // survived structured-clone into IDB and is still non-extractable
        await expect(crypto.subtle.exportKey("jwk", loaded!.privateKey)).rejects.toBeTruthy();
    });

    it("clearIdentity wipes it (logout)", async () => {
        await getOrCreateIdentity();
        await clearIdentity();
        expect(await loadIdentity()).toBeNull();
    });
});
