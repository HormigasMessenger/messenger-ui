import {ENVELOPE_ALG, encrypt, decrypt, type Ciphertext} from "./crypto.ts";

// The self-describing wrapper that rides in a closed message's `payload.body` (a JSON string the server
// treats as opaque). Versioned + carries the sender's keyId so the receiver knows which key to use and
// can detect a key change. See design §4.
export type Envelope = {
    v: 1;
    alg: string;
    spk: string;   // sender public-key id (keyId) — which key the sender derived with
    iv: string;    // base64, 12 bytes, unique per message
    ct: string;    // base64, AES-GCM ciphertext + tag
};

export const ENVELOPE_PREFIX = "e2ee:1:"; // cheap discriminator so a plaintext body is never mis-parsed

/** GCM additional-authenticated-data binding a message to its conversation + sender + version. */
function aadFor(conversationId: string, senderId: string): string {
    return `${conversationId}|${senderId}|1`;
}

/** Encrypt a plaintext message body into a wire string for payload.body. */
export async function sealMessage(args: {
    key: CryptoKey; senderKeyId: string; conversationId: string; senderId: string; plaintext: string;
}): Promise<string> {
    const {iv, ct} = await encrypt(args.key, args.plaintext, aadFor(args.conversationId, args.senderId));
    const env: Envelope = {v: 1, alg: ENVELOPE_ALG, spk: args.senderKeyId, iv, ct};
    return ENVELOPE_PREFIX + JSON.stringify(env);
}

/** True if a payload.body string is an E2EE envelope (vs plaintext). */
export function isEnvelope(body: string | undefined | null): boolean {
    return typeof body === "string" && body.startsWith(ENVELOPE_PREFIX);
}

/** Parse an envelope string; null if it isn't one / is malformed. */
export function parseEnvelope(body: string): Envelope | null {
    if (!isEnvelope(body)) return null;
    try {
        const env = JSON.parse(body.slice(ENVELOPE_PREFIX.length)) as Envelope;
        if (env && env.v === 1 && env.iv && env.ct && env.spk) return env;
    } catch { /* malformed */ }
    return null;
}

/** Decrypt an envelope back to plaintext; throws if the key/AAD/tag don't verify. */
export async function openMessage(args: {
    key: CryptoKey; env: Envelope; conversationId: string; senderId: string;
}): Promise<string> {
    const c: Ciphertext = {iv: args.env.iv, ct: args.env.ct};
    return decrypt(args.key, c, aadFor(args.conversationId, args.senderId));
}
