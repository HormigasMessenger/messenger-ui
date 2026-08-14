export const DB_NAME = 'chatDB';
export const STORE_NAME = 'outbox';
export const STORE_KEY = 'messages';
// Per-conversation history cache (keyed by chatId) — instant open + offline read.
export const HISTORY_STORE_NAME = 'history';
// Image-attachment thumbnail cache (keyed by attachmentId, value = a small WebP Blob) so the chat
// renders images instantly without re-resolving/re-downloading on every mount/scroll.
export const THUMB_STORE_NAME = 'attachment-thumbs';
// Bumped to 3 to add the attachment-thumbnail store (see db.ts upgrade).
export const DB_VERSION = 3;
