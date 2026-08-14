export const DB_NAME = 'chatDB';
export const STORE_NAME = 'outbox';
export const STORE_KEY = 'messages';
// Per-conversation history cache (keyed by chatId) — instant open + offline read.
export const HISTORY_STORE_NAME = 'history';
// Image-attachment thumbnail cache (keyed by attachmentId, value = a small WebP Blob) so the chat
// renders images instantly without re-resolving/re-downloading on every mount/scroll.
export const THUMB_STORE_NAME = 'attachment-thumbs';
// Companion store holding the thumbnail insertion order (one array under THUMB_LRU_KEY) so the cache
// can be capped (evict oldest) instead of growing without bound. Kept separate from the blobs so the
// cap logic never has to read the (heavy) image data.
export const THUMB_META_STORE = 'attachment-thumbs-lru';
export const THUMB_LRU_KEY = 'order';
// Bumped to 4 to add the thumbnail-order companion store (see db.ts upgrade).
export const DB_VERSION = 4;
