import {openDB, type IDBPDatabase} from "idb";
import {generateIdentityKeys, type IdentityKeys} from "./crypto.ts";

// This device's E2EE identity keypair, persisted in its OWN IndexedDB (isolated from the chat DB). The
// stored private key is a non-extractable CryptoKey — IndexedDB structured-clone preserves it as-is, so
// it survives reloads without ever being serialisable. The public key + keyId are stored alongside for
// publishing to the key directory.

const DB_NAME = "e2ee-keys";
const DB_VERSION = 1;
const STORE = "identity";
const SELF = "self";

let dbPromise: Promise<IDBPDatabase<unknown>> | null = null;
function db() {
    if (!dbPromise) {
        dbPromise = openDB(DB_NAME, DB_VERSION, {
            upgrade(d) { if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); },
        });
    }
    return dbPromise;
}

/** Load this device's identity, or null if none has been generated yet. */
export async function loadIdentity(): Promise<IdentityKeys | null> {
    const d = await db();
    return ((await d.get(STORE, SELF)) as IdentityKeys | undefined) ?? null;
}

/** Return the device identity, generating + persisting one on first use. Stable across reloads. */
export async function getOrCreateIdentity(): Promise<IdentityKeys> {
    const existing = await loadIdentity();
    if (existing) return existing;
    const keys = await generateIdentityKeys();
    const d = await db();
    await d.put(STORE, keys, SELF);
    return keys;
}

/**
 * Wipe the device identity (logout on a shared device). v1 has no key backup, so the next login
 * generates a fresh key and cannot read prior E2EE history — the deliberate no-backup trade-off.
 */
export async function clearIdentity(): Promise<void> {
    const d = await db();
    await d.delete(STORE, SELF);
}
