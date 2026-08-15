import {type IDBPDatabase, openDB} from 'idb';
import {
    DB_NAME, DB_VERSION, HISTORY_STORE_NAME, STORE_KEY, STORE_NAME,
    ATTACHMENT_BLOB_STORE, ATTACHMENT_INDEX_STORE, ATTACHMENT_INDEX_KEY,
    THUMB_STORE_NAME, THUMB_META_STORE,
} from "@/shared/config/idb";
import {ATTACHMENT_CACHE_MAX_BYTES} from "@/shared/config/chat.ts";
import type {OutboxState} from "@/features/chat/model/types";
import type {ChatMessage} from "@/features/chat/model/schema/domainChatMessage.schema";


// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbPromise: Promise<IDBPDatabase<any>> | null = null;


export const initDB = async () => {
    if (!dbPromise) {
        dbPromise = openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
                // v2: per-conversation history cache, keyed by chatId.
                if (!db.objectStoreNames.contains(HISTORY_STORE_NAME)) {
                    db.createObjectStore(HISTORY_STORE_NAME);
                }
                // v5: unified, size-bounded media-attachment cache (images/audio/video) + its index.
                // Replaces the v3/v4 thumbnail-only stores, dropped here (just a cache — safe to lose).
                if (db.objectStoreNames.contains(THUMB_STORE_NAME)) db.deleteObjectStore(THUMB_STORE_NAME);
                if (db.objectStoreNames.contains(THUMB_META_STORE)) db.deleteObjectStore(THUMB_META_STORE);
                if (!db.objectStoreNames.contains(ATTACHMENT_BLOB_STORE)) {
                    db.createObjectStore(ATTACHMENT_BLOB_STORE);
                }
                if (!db.objectStoreNames.contains(ATTACHMENT_INDEX_STORE)) {
                    db.createObjectStore(ATTACHMENT_INDEX_STORE);
                }
            },
        });
    }
    return dbPromise;
};

export async function saveOutboxToDB(data: OutboxState) {
    const db = await initDB();
    await db.put(STORE_NAME, data, STORE_KEY);
}

export async function loadOutboxFromDB(): Promise<OutboxState | null> {
    const db = await initDB();
    const result = await db.get(STORE_NAME, STORE_KEY);
    return result ?? null;
}

// --- per-conversation history cache -------------------------------------------------
export async function saveHistoryToDB(chatId: string, messages: ChatMessage[]) {
    if (!chatId) return;
    const db = await initDB();
    await db.put(HISTORY_STORE_NAME, messages, chatId);
}

export async function loadHistoryFromDB(chatId: string): Promise<ChatMessage[] | null> {
    if (!chatId) return null;
    const db = await initDB();
    const result = await db.get(HISTORY_STORE_NAME, chatId);
    return (result as ChatMessage[]) ?? null;
}

// --- unified media-attachment cache (images / voice notes / video) ------------------
// Size-bounded, oldest-first eviction. The index (ATTACHMENT_INDEX_STORE[ATTACHMENT_INDEX_KEY]) is one
// array of {id,size} in insertion order, so the total byte size and the eviction victims are known
// without reading any blob. The blob write and the index update aren't a single transaction — a rare
// concurrent save may over/under-count momentarily, which is harmless for a cache (never a correctness
// issue; the cap stays approximate). The newest entry is always kept even if it alone exceeds the budget.
export type CacheIndexEntry = {id: string; size: number};

/**
 * Pure oldest-first eviction: given the insertion-ordered index and a byte budget, return the entries to
 * keep and the ids to evict so the total fits. The newest entry (last) is always kept even if it alone
 * exceeds the budget. Exported for unit testing (IndexedDB isn't available in jsdom).
 */
export function evictToFit(entries: CacheIndexEntry[], maxBytes: number): {kept: CacheIndexEntry[]; evicted: string[]} {
    const kept = [...entries];
    const evicted: string[] = [];
    let total = kept.reduce((sum, e) => sum + e.size, 0);
    while (total > maxBytes && kept.length > 1) {
        const e = kept.shift();
        if (e) { evicted.push(e.id); total -= e.size; }
    }
    return {kept, evicted};
}

async function readCacheIndex(db: IDBPDatabase<unknown>): Promise<CacheIndexEntry[]> {
    return ((await db.get(ATTACHMENT_INDEX_STORE, ATTACHMENT_INDEX_KEY)) as CacheIndexEntry[] | undefined) ?? [];
}

export async function saveAttachmentBlob(attachmentId: string, blob: Blob) {
    if (!attachmentId || !blob) return;
    const db = await initDB();
    await db.put(ATTACHMENT_BLOB_STORE, blob, attachmentId);
    const index = await readCacheIndex(db);
    const next = [...index.filter((e) => e.id !== attachmentId), {id: attachmentId, size: blob.size || 0}];
    const {kept, evicted} = evictToFit(next, ATTACHMENT_CACHE_MAX_BYTES);
    for (const id of evicted) await db.delete(ATTACHMENT_BLOB_STORE, id);
    await db.put(ATTACHMENT_INDEX_STORE, kept, ATTACHMENT_INDEX_KEY);
}

export async function loadAttachmentBlob(attachmentId: string): Promise<Blob | null> {
    if (!attachmentId) return null;
    const db = await initDB();
    const result = await db.get(ATTACHMENT_BLOB_STORE, attachmentId);
    return (result as Blob) ?? null;
}

// Drop one cached attachment (its message was deleted, or the blob was stale/corrupt) — blob + index.
export async function deleteAttachmentBlob(attachmentId: string) {
    if (!attachmentId) return;
    const db = await initDB();
    await db.delete(ATTACHMENT_BLOB_STORE, attachmentId);
    const index = await readCacheIndex(db);
    if (index.some((e) => e.id === attachmentId)) {
        await db.put(ATTACHMENT_INDEX_STORE, index.filter((e) => e.id !== attachmentId), ATTACHMENT_INDEX_KEY);
    }
}

// Wipe all locally-cached user data (outbox queue + per-conversation history + media cache). Called on
// logout so one user's queued messages, plaintext history and media never linger for the next user.
export async function clearAllLocalData() {
    const db = await initDB();
    await Promise.all([
        db.clear(STORE_NAME), db.clear(HISTORY_STORE_NAME),
        db.clear(ATTACHMENT_BLOB_STORE), db.clear(ATTACHMENT_INDEX_STORE),
    ]);
}
