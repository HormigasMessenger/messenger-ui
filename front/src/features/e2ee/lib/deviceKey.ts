import {openDB, type IDBPDatabase} from "idb";

// The device wrapping key: a single NON-EXTRACTABLE AES-GCM CryptoKey, generated once and persisted in
// IndexedDB (structured-clone keeps a non-extractable CryptoKey intact — it can never be read back out as
// bytes, even by our own code). Every private key + every stored plaintext is encrypted under it, so the
// at-rest bytes are useless without a live handle to this key in this origin. This is the practical
// ceiling of PWA E2EE: a runtime-compromised origin can still use the key, but nothing on disk is readable.

const DB = "e2ee-device";
const STORE = "wrap";
const KEY = "deviceKey";

let dbp: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
    if (!dbp) dbp = openDB(DB, 1, { upgrade(d) { if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); } });
    return dbp;
}

let keyp: Promise<CryptoKey> | null = null;
/** Get-or-create the device wrapping key (memoized for the session). */
export function getDeviceKey(): Promise<CryptoKey> {
    if (!keyp) keyp = (async () => {
        const d = await db();
        const existing = (await d.get(STORE, KEY)) as CryptoKey | undefined;
        if (existing) {
            // Backfill createdAt for keys made before this field existed (so the info page has a value —
            // "first seen", approximate but stable).
            if (!(await d.get(STORE, "createdAt"))) await d.put(STORE, Date.now(), "createdAt");
            return existing;
        }
        const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false /* non-extractable */, ["encrypt", "decrypt"]);
        await d.put(STORE, key, KEY);
        await d.put(STORE, Date.now(), "createdAt");   // for the info page
        return key;
    })();
    return keyp;
}

/** When the device key was first generated (epoch ms), or 0 if not yet created. */
export async function getDeviceKeyCreatedAt(): Promise<number> {
    try { return ((await (await db()).get(STORE, "createdAt")) as number | undefined) ?? 0; } catch { return 0; }
}

export interface Wrapped { iv: ArrayBuffer; ct: ArrayBuffer }

// Coerce any BufferSource (possibly from a cross-realm source — the crypto lib, or jsdom in tests) into a
// fresh same-realm Uint8Array, so WebCrypto's strict instanceof checks accept it.
function toBytes(src: BufferSource): Uint8Array {
    const view = ArrayBuffer.isView(src)
        ? new Uint8Array((src as ArrayBufferView).buffer, (src as ArrayBufferView).byteOffset, (src as ArrayBufferView).byteLength)
        : new Uint8Array(src as ArrayBuffer);
    return Uint8Array.from(view);
}

/** Encrypt arbitrary bytes under the device key (12-byte random IV). */
export async function wrapBytes(plain: BufferSource): Promise<Wrapped> {
    const key = await getDeviceKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, toBytes(plain) as BufferSource);
    return { iv: iv.buffer, ct };
}

/** Decrypt bytes previously wrapped with wrapBytes. */
export async function unwrapBytes(w: Wrapped): Promise<ArrayBuffer> {
    const key = await getDeviceKey();
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(w.iv) }, key, w.ct);
}

/** Reset the device key (logout / wipe). Makes ALL wrapped material — keys and stored plaintext — permanently unreadable. */
export async function clearDeviceKey(): Promise<void> {
    keyp = null;
    try { const d = await db(); await d.delete(STORE, KEY); } catch { /* best-effort */ }
}

// --- base64 (std) for the directory wire format ---
export function b64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
}
export function unb64(s: string): ArrayBuffer {
    const bin = atob(s); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}
