// Message-list windowing: render only the most recent N bubbles to cap DOM nodes on long
// histories (the history page can be up to 200). "Show earlier messages" reveals another step.
// This is dependency-free virtualization tuned for chat UX (you almost always view the tail).
export const MESSAGE_WINDOW_INITIAL = 60;
export const MESSAGE_WINDOW_STEP = 60;

// History pagination. The backend serves the NEWEST page by default (or `?before=<id>` for the
// page immediately older, ASC), plus `?since=<id>` for a forward reconnect catch-up. So we load
// the latest page on open and pull older pages on demand (scroll-up / "show earlier"). Rendering
// is windowed on top of the loaded set (MESSAGE_WINDOW_*).
export const HISTORY_PAGE_SIZE = 200;

// Max attachment size accepted client-side (before requesting a presigned upload URL).
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB

// Client-side image compression (before upload): downscale proportionally so the longest side is at
// most IMAGE_MAX_DIMENSION and re-encode to WebP at IMAGE_QUALITY. Saves bandwidth/storage and speeds
// up sends. Images already smaller than IMAGE_COMPRESS_MIN_BYTES are sent as-is (not worth it). Encode
// uses jSquash (WASM) with a native canvas fallback; see features/chat/lib/imageCompress.ts.
export const IMAGE_MAX_DIMENSION = 1200;            // px — longest side after downscale (never upscales)
export const IMAGE_QUALITY = 0.8;                   // 0..1 → WebP quality
export const IMAGE_COMPRESS_MIN_BYTES = 150 * 1024; // don't bother compressing images below this
