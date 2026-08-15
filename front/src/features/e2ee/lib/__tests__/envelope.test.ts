import {describe, it, expect} from "vitest";
import {generateIdentityKeys, deriveConversationKey} from "../crypto.ts";
import {sealMessage, openMessage, isEnvelope, parseEnvelope} from "../envelope.ts";

describe("e2ee envelope", () => {
    it("seals a message A→B that B opens with the shared key", async () => {
        const a = await generateIdentityKeys();
        const b = await generateIdentityKeys();
        const conv = "c1", sender = "userA";
        const kA = await deriveConversationKey(a.privateKey, b.publicKeyRaw, conv);
        const kB = await deriveConversationKey(b.privateKey, a.publicKeyRaw, conv);

        const wire = await sealMessage({key: kA, senderKeyId: a.keyId, conversationId: conv, senderId: sender, plaintext: "тайное сообщение"});
        expect(isEnvelope(wire)).toBe(true);
        const env = parseEnvelope(wire)!;
        expect(env.v).toBe(1);
        expect(env.spk).toBe(a.keyId);
        expect(env.iv).toBeTruthy();
        expect(env.ct).toBeTruthy();

        expect(await openMessage({key: kB, env, conversationId: conv, senderId: sender})).toBe("тайное сообщение");
    });

    it("treats a plaintext body as NOT an envelope", () => {
        expect(isEnvelope("just a normal message")).toBe(false);
        expect(parseEnvelope("just a normal message")).toBeNull();
        expect(parseEnvelope("e2ee:1:{not json")).toBeNull();
    });

    it("open() fails if the sender/conversation context (AAD) doesn't match", async () => {
        const a = await generateIdentityKeys();
        const b = await generateIdentityKeys();
        const kA = await deriveConversationKey(a.privateKey, b.publicKeyRaw, "c1");
        const kB = await deriveConversationKey(b.privateKey, a.publicKeyRaw, "c1");
        const wire = await sealMessage({key: kA, senderKeyId: a.keyId, conversationId: "c1", senderId: "userA", plaintext: "x"});
        const env = parseEnvelope(wire)!;
        await expect(openMessage({key: kB, env, conversationId: "c1", senderId: "IMPOSTER"})).rejects.toBeTruthy();
    });
});
