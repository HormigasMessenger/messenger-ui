import {type IDBPDatabase, openDB} from 'idb';
import {DB_NAME, DB_VERSION, HISTORY_STORE_NAME, STORE_KEY, STORE_NAME, THUMB_STORE_NAME} from "@/shared/config/idb";
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
export async function saveThumbToDB(attachmentId: string, blob: Blob) {
    if (!attachmentId || !blob) return;
    const db = await initDB();
    await db.put(THUMB_STORE_NAME, blob, attachmentId);
}

export async function loadThumbFromDB(attachmentId: string): Promise<Blob | null> {
    if (!attachmentId) return null;
    const db = await initDB();
    const result = await db.get(THUMB_STORE_NAME, attachmentId);
    return (result as Blob) ?? null;
}

// Wipe all locally-cached user data (outbox queue + per-conversation history + attachment thumbnails).
// Called on logout so one user's queued messages, plaintext history and images never linger on the
// device for the next user.
export async function clearAllLocalData() {
    const db = await initDB();
    await Promise.all([db.clear(STORE_NAME), db.clear(HISTORY_STORE_NAME), db.clear(THUMB_STORE_NAME)]);
}
