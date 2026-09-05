import {openDB, type IDBPDatabase} from "idb";

// A tiny PERSISTENT id→display-name store, separate from the media/history DB (no version coupling). The
// app writes it as the directory resolves; the SERVICE WORKER reads it (raw IndexedDB, see push-sw.js) to
// name Web Push notifications even when the app is CLOSED — the RTK-Query directory cache is in-memory
// only and gone once the page unloads. Same DB name + store + version 1 on both sides so whichever opens
// first creates the store. All best-effort — never throws into the caller.
const DB = "hormiga-names";
const STORE = "names";

let dbp: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
    if (!dbp) {
        dbp = openDB(DB, 1, {
            upgrade(d) { if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); },
        });
    }
    return dbp;
}

/** Persist id→name (only real names; empty/blank skipped). Best-effort. */
export async function saveNames(map: Record<string, string>): Promise<void> {
    try {
        const entries = Object.entries(map).filter(([id, name]) => id && name);
        if (entries.length === 0) return;
        const d = await db();
        const tx = d.transaction(STORE, "readwrite");
        for (const [id, name] of entries) tx.store.put(name, id);
        await tx.done;
    } catch { /* best-effort — names just fall back to generic in notifications */ }
}

/**
 * Read the whole id→name cache. Used to SEED the address book on a cold start: the chat list can render
 * real names instantly from this persistent cache while the IDS directory re-fetches in the background
 * (read-through), instead of briefly showing ids/emails. Best-effort — returns {} on any failure.
 */
export async function loadNames(): Promise<Record<string, string>> {
    try {
        const d = await db();
        const keys = await d.getAllKeys(STORE);
        const vals = await d.getAll(STORE);
        const out: Record<string, string> = {};
        keys.forEach((k, i) => { if (typeof k === "string" && typeof vals[i] === "string") out[k] = vals[i] as string; });
        return out;
    } catch { return {}; }
}
