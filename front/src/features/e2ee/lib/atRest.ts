import {openDB, type IDBPDatabase} from "idb";
import {wrapBytes, unwrapBytes, type Wrapped} from "./deviceKey.ts";

// At-rest plaintext store (Phase 2e). A Double Ratchet message key is CONSUMED on first decrypt and then
// deleted (forward secrecy), so a secret message can be decrypted exactly ONCE — re-decrypting the same
// envelope from reloaded history is impossible. So the moment we decrypt (on receipt) — and the moment we
// send — we stash the plaintext here, RE-ENCRYPTED under the device key, keyed by message id. History
// rendering then reads plaintext from here instead of trying to re-run the ratchet. On disk it's ciphertext
// (device-key-wrapped); only a live origin can unwrap it. Best-effort — never throws into the caller.

const DB = "e2ee-plaintext";
const STORE = "pt";
const enc = new TextEncoder(), dec = new TextDecoder();

let dbp: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
    if (!dbp) dbp = openDB(DB, 1, { upgrade(d) { if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); } });
    return dbp;
}

/** Stash a decrypted/sent secret message's plaintext under its id (wrapped). Best-effort. */
export async function savePlaintext(id: string, text: string): Promise<void> {
    try { if (id) await (await db()).put(STORE, await wrapBytes(enc.encode(text).buffer), id); } catch { /* best-effort */ }
}

/** Recover a stored plaintext by id, or null if we never decrypted/sent it on this device. */
export async function loadPlaintext(id: string): Promise<string | null> {
    try {
        const w = (await (await db()).get(STORE, id)) as Wrapped | undefined;
        return w ? dec.decode(await unwrapBytes(w)) : null;
    } catch { return null; }
}
