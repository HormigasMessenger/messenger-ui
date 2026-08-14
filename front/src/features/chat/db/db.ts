import {type IDBPDatabase, openDB} from 'idb';
import {DB_NAME, DB_VERSION, HISTORY_STORE_NAME, STORE_KEY, STORE_NAME, THUMB_STORE_NAME, THUMB_META_STORE, THUMB_LRU_KEY} from "@/shared/config/idb";
import {THUMB_CACHE_MAX} from "@/shared/config/chat.ts";
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
                // v3: attachment thumbnail cache, keyed by attachmentId (value = small WebP Blob).
                if (!db.objectStoreNames.contains(THUMB_STORE_NAME)) {
                    db.createObjectStore(THUMB_STORE_NAME);
                }
                // v4: companion store for the thumbnail insertion order (drives the FIFO cap).
                if (!db.objectStoreNames.contains(THUMB_META_STORE)) {
                    db.createObjectStore(THUMB_META_STORE);
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

// --- attachment thumbnail cache -----------------------------------------------------
// Best-effort FIFO cache: a companion order array (THUMB_META_STORE[THUMB_LRU_KEY]) records insertion
// order so saveThumbToDB can evict the oldest once the count passes THUMB_CACHE_MAX. The blob write and
// the order update aren't in one transaction — a rare concurrent save may skip an eviction, which is
// harmless for a cache (the cap stays approximate, never a correctness issue).
export async function saveThumbToDB(attachmentId: string, blob: Blob) {
    if (!attachmentId || !blob) return;
    const db = await initDB();
    await db.put(THUMB_STORE_NAME, blob, attachmentId);
    const order = ((await db.get(THUMB_META_STORE, THUMB_LRU_KEY)) as string[] | undefined) ?? [];
    const next = order.filter((id) => id !== attachmentId);
    next.push(attachmentId);
    while (next.length > THUMB_CACHE_MAX) {
        const evicted = next.shift();
        if (evicted) await db.delete(THUMB_STORE_NAME, evicted);
    }
    await db.put(THUMB_META_STORE, next, THUMB_LRU_KEY);
}

export async function loadThumbFromDB(attachmentId: string): Promise<Blob | null> {
    if (!attachmentId) return null;
    const db = await initDB();
    const result = await db.get(THUMB_STORE_NAME, attachmentId);
    return (result as Blob) ?? null;
}

// Drop a single cached thumbnail (its message/attachment was deleted) — blob + its order entry.
export async function deleteThumbFromDB(attachmentId: string) {
    if (!attachmentId) return;
    const db = await initDB();
    await db.delete(THUMB_STORE_NAME, attachmentId);
    const order = (await db.get(THUMB_META_STORE, THUMB_LRU_KEY)) as string[] | undefined;
    if (order?.includes(attachmentId)) {
        await db.put(THUMB_META_STORE, order.filter((id) => id !== attachmentId), THUMB_LRU_KEY);
    }
}

// Wipe all locally-cached user data (outbox queue + per-conversation history + attachment thumbnails).
// Called on logout so one user's queued messages, plaintext history and images never linger on the
// device for the next user.
export async function clearAllLocalData() {
    const db = await initDB();
    await Promise.all([
        db.clear(STORE_NAME), db.clear(HISTORY_STORE_NAME),
        db.clear(THUMB_STORE_NAME), db.clear(THUMB_META_STORE),
    ]);
}
