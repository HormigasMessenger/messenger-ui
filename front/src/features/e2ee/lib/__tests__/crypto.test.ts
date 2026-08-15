import {describe, it, expect} from "vitest";
import {
    generateIdentityKeys, deriveConversationKey, encrypt, decrypt, keyIdFor,
} from "../crypto.ts";

describe("e2ee crypto", () => {
    it("generates an identity with a 16-hex-char keyId; keyId is a stable fn of the public key", async () => {
        const id = await generateIdentityKeys();
        expect(id.keyId).toMatch(/^[0-9a-f]{16}$/);
        expect(id.publicKeyRaw.length).toBe(65); // uncompressed P-256 point
        expect(await keyIdFor(id.publicKeyRaw)).toBe(id.keyId);
    });

    it("both parties derive the SAME conversation key (ECDH symmetry) → A encrypts, B decrypts", async () => {
        const a = await generateIdentityKeys();
        const b = await generateIdentityKeys();
        const conv = "conv-1";
        const kA = await deriveConversationKey(a.privateKey, b.publicKeyRaw, conv);
        const kB = await deriveConversationKey(b.privateKey, a.publicKeyRaw, conv);

        const aad = "conv-1|userA|1";
        const ct = await encrypt(kA, "привет 🔒", aad);
        expect(await decrypt(kB, ct, aad)).toBe("привет 🔒");
    });

    it("scopes the key per conversation (salt = conversationId)", async () => {
        const a = await generateIdentityKeys();
        const b = await generateIdentityKeys();
        const k1 = await deriveConversationKey(a.privateKey, b.publicKeyRaw, "conv-1");
        const k2 = await deriveConversationKey(b.privateKey, a.publicKeyRaw, "conv-2");
        const ct = await encrypt(k1, "secret", "aad");
        await expect(decrypt(k2, ct, "aad")).rejects.toBeTruthy(); // different conv → different key
    });

    it("AEAD rejects a wrong AAD (context binding) and tampered ciphertext", async () => {
        const a = await generateIdentityKeys();
        const b = await generateIdentityKeys();
        const k = await deriveConversationKey(a.privateKey, b.publicKeyRaw, "c");
        const kB = await deriveConversationKey(b.privateKey, a.publicKeyRaw, "c");
        const ct = await encrypt(k, "hi", "conv|sender|1");

        await expect(decrypt(kB, ct, "conv|IMPOSTER|1")).rejects.toBeTruthy();
        const tampered = {...ct, ct: ct.ct.slice(0, -4) + (ct.ct.endsWith("A") ? "B" : "A") + "=="};
        await expect(decrypt(kB, tampered, "conv|sender|1")).rejects.toBeTruthy();
    });

    it("private key is non-extractable (cannot be exported)", async () => {
        const id = await generateIdentityKeys();
        await expect(crypto.subtle.exportKey("jwk", id.privateKey)).rejects.toBeTruthy();
    });
});
