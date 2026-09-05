import {openDB, type IDBPDatabase} from "idb";
import {wrapBytes, unwrapBytes, type Wrapped} from "./deviceKey.ts";

// At-rest plaintext store (Phase 2e). A Double Ratchet message key is CONSUMED on first decrypt and then
// deleted (forward secrecy), so a secret message can be decrypted exactly ONCE — re-decrypting the same
// envelope from reloaded history is impossible. So the moment we decrypt (on receipt) — and the moment we
// send — we stash the plaintext here, RE-ENCRYPTED under the device key, keyed by message id. History
// rendering reads plaintext from here instead of re-running the ratchet. On disk it's ciphertext
// (device-key-wrapped); only a live origin can unwrap it. Each record carries its chatId (so clearing a
// chat wipes its plaintext) and savedAt (for disappearing-message expiry). Best-effort — never throws.

const DB = "e2ee-plaintext";
const STORE = "pt";
const V = 2;                                // v2 adds chatId + the by-chat index
const enc = new TextEncoder(), dec = new TextDecoder();

interface Rec { chatId: string; savedAt: number; w: Wrapped }

let dbp: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
    if (!dbp) dbp = openDB(DB, V, {
        upgrade(d, _old, _new, tx) {
            const s = d.objectStoreNames.contains(STORE) ? tx.objectStore(STORE) : d.createObjectStore(STORE);
            if (!s.indexNames.contains("chatId")) s.createIndex("chatId", "chatId");
        },
    });
    return dbp;
}

/** Stash a decrypted/sent secret message's plaintext under its id (wrapped), tagged with its chat. */
export async function savePlaintext(id: string, chatId: string, text: string): Promise<void> {
    try {
        if (!id) return;
        const rec: Rec = {chatId, savedAt: Date.now(), w: await wrapBytes(enc.encode(text).buffer)};
        await (await db()).put(STORE, rec, id);
    } catch { /* best-effort */ }
}

/**
 * Recover a stored plaintext by id, or null if we never decrypted/sent it on this device. If ttlMs is given
 * and the record is older, it's treated as EXPIRED — deleted and null returned (disappearing messages).
 */
export async function loadPlaintext(id: string, ttlMs?: number): Promise<string | null> {
    try {
        const d = await db();
        const rec = (await d.get(STORE, id)) as Rec | Wrapped | undefined;
        if (!rec) return null;
        // Tolerate a v1 record (bare Wrapped, no chatId/savedAt) written before the upgrade.
        const w = "w" in rec ? rec.w : rec;
        const savedAt = "savedAt" in rec ? rec.savedAt : 0;
        if (ttlMs && savedAt && Date.now() - savedAt > ttlMs) { await d.delete(STORE, id).catch(() => {}); return null; }
        return dec.decode(await unwrapBytes(w));
    } catch { return null; }
}

/** Wipe every stored plaintext for a chat — called when the user clears/deletes that chat locally. */
export async function deletePlaintextForChat(chatId: string): Promise<void> {
    try {
        const d = await db();
        const tx = d.transaction(STORE, "readwrite");
        let cur = await tx.store.index("chatId").openCursor(IDBKeyRange.only(chatId));
        while (cur) { await cur.delete(); cur = await cur.continue(); }
        await tx.done;
    } catch { /* best-effort */ }
}

/** Sweep all plaintext older than ttlMs across every chat (disappearing-message GC). Returns count removed. */
export async function sweepExpired(ttlMs: number): Promise<number> {
    let n = 0;
    try {
        const d = await db();
        const cutoff = Date.now() - ttlMs;
        const tx = d.transaction(STORE, "readwrite");
        let cur = await tx.store.openCursor();
        while (cur) {
            const rec = cur.value as Rec;
            if (rec?.savedAt && rec.savedAt < cutoff) { await cur.delete(); n++; }
            cur = await cur.continue();
        }
        await tx.done;
    } catch { /* best-effort */ }
    return n;
}
