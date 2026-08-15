// Per-conversation composer drafts, persisted in localStorage so an unsent message survives switching
// chats, closing the tab, or a reload. One JSON map { chatId: text } under a versioned key. Empty text
// removes the entry (no accumulation). Best-effort — storage errors (quota / private mode) are ignored.

const KEY = "hormiga.drafts.v1";
const MAX_DRAFTS = 300; // cap the map so it can't grow unbounded

function read(): Record<string, string> {
    try {
        const raw = localStorage.getItem(KEY);
        const obj = raw ? JSON.parse(raw) : null;
        return obj && typeof obj === "object" ? obj as Record<string, string> : {};
    } catch {
        return {};
    }
}

function write(map: Record<string, string>): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(map));
    } catch { /* quota / disabled → skip */ }
}

export function loadDraft(chatId: string): string {
    if (!chatId) return "";
    return read()[chatId] ?? "";
}

export function saveDraft(chatId: string, text: string): void {
    if (!chatId) return;
    const map = read();
    if (text) {
        map[chatId] = text;
        // Evict the oldest keys if we somehow exceed the cap (insertion order is preserved by JSON).
        const keys = Object.keys(map);
        for (let i = 0; i < keys.length - MAX_DRAFTS; i++) delete map[keys[i]];
    } else {
        delete map[chatId];
    }
    write(map);
}

export function clearDraft(chatId: string): void {
    saveDraft(chatId, "");
}

export function clearAllDrafts(): void {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
