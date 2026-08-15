// E2EE crypto primitives (closed 1:1 chats). All Web Crypto — no key material ever leaves the device.
//
// Scheme (v1, see design doc): a per-device ECDH P-256 identity key → ECDH shared secret with the peer
// → HKDF-SHA256 (salt = conversationId) → a per-conversation AES-256-GCM key → AEAD encrypt/decrypt
// with a random 12-byte IV per message and the conversation/sender bound in as AAD. No forward secrecy
// in v1 (static ECDH); Double Ratchet is a v2 upgrade.

const ALG_ECDH = {name: "ECDH", namedCurve: "P-256"} as const;
const HKDF_INFO = "hormiga-e2ee-v1";
export const ENVELOPE_ALG = "ECDH-P256/HKDF-SHA256/AES-256-GCM";

const te = new TextEncoder();
const td = new TextDecoder();

// --- base64 <-> bytes (no Node Buffer; works in the browser) --------------------------------------
export function toB64(bytes: ArrayBuffer | Uint8Array): string {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
}
export function fromB64(s: string): Uint8Array {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// --- identity keypair ------------------------------------------------------------------------------
export type IdentityKeys = {
    /** Non-extractable ECDH private key — stored, used to derive, NEVER exported/sent. */
    privateKey: CryptoKey;
    /** Raw (65-byte) public key bytes — published to the key directory + used for keyId. */
    publicKeyRaw: Uint8Array;
    /** Short fingerprint of the public key (hex) — labels messages + shown for verification. */
    keyId: string;
};

/**
 * Generate a fresh device identity keypair. The pair is generated extractable so the PUBLIC key can be
 * exported for publishing; the private key is then re-imported as NON-extractable and the extractable
 * copy dropped — so the stored private key can never be exported, even by injected code.
 */
export async function generateIdentityKeys(): Promise<IdentityKeys> {
    const pair = await crypto.subtle.generateKey(ALG_ECDH, true, ["deriveBits"]);
    const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const privJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const privateKey = await crypto.subtle.importKey("jwk", privJwk, ALG_ECDH, false /* non-extractable */, ["deriveBits"]);
    return {privateKey, publicKeyRaw, keyId: await keyIdFor(publicKeyRaw)};
}

/** Import a peer's raw public key for ECDH. */
export function importPeerPublicKey(raw: Uint8Array): Promise<CryptoKey> {
    return crypto.subtle.importKey("raw", raw, ALG_ECDH, true, []);
}

/** Short public-key fingerprint (first 8 bytes of SHA-256, hex) — the message keyId / safety label. */
export async function keyIdFor(publicKeyRaw: Uint8Array): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", publicKeyRaw));
    return Array.from(digest.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- key agreement ---------------------------------------------------------------------------------
/**
 * Derive the per-conversation AES-GCM key: ECDH(myPrivate, peerPublic) → HKDF-SHA256 (salt=conversationId).
 * Both sides compute the SAME key (ECDH is symmetric), scoped per conversation by the salt.
 */
export async function deriveConversationKey(
    myPrivate: CryptoKey, peerPublicRaw: Uint8Array, conversationId: string,
): Promise<CryptoKey> {
    const peerPublic = await importPeerPublicKey(peerPublicRaw);
    const sharedBits = await crypto.subtle.deriveBits({name: "ECDH", public: peerPublic}, myPrivate, 256);
    const hkdf = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
        {name: "HKDF", hash: "SHA-256", salt: te.encode(conversationId), info: te.encode(HKDF_INFO)},
        hkdf, {name: "AES-GCM", length: 256}, false, ["encrypt", "decrypt"],
    );
}

// --- AEAD ------------------------------------------------------------------------------------------
export type Ciphertext = {iv: string; ct: string}; // both base64

/** AES-GCM encrypt with a fresh random IV; `aad` is authenticated but not encrypted. */
export async function encrypt(key: CryptoKey, plaintext: string, aad: string): Promise<Ciphertext> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
        {name: "AES-GCM", iv, additionalData: te.encode(aad)}, key, te.encode(plaintext),
    );
    return {iv: toB64(iv), ct: toB64(ct)};
}

/** AES-GCM decrypt; throws if the tag or AAD doesn't verify (tampered / wrong key / wrong context). */
export async function decrypt(key: CryptoKey, c: Ciphertext, aad: string): Promise<string> {
    const pt = await crypto.subtle.decrypt(
        {name: "AES-GCM", iv: fromB64(c.iv), additionalData: te.encode(aad)}, key, fromB64(c.ct),
    );
    return td.decode(pt);
}
