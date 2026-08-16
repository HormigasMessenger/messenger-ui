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
