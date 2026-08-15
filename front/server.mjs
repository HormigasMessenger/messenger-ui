// Minimal zero-dependency static server for the built SPA.
// Deploy target: /opt/front4mess on the backend host, run under Node on port 5555,
// behind the same Ory edge as the messenger (same origin → the Kratos cookie applies).
//
//   npm ci && npm run build      # produces ./dist
//   PORT=5555 node server.mjs    # serves ./dist, SPA-fallback to index.html
//
// The app calls the messenger host-relative (/messenger/api, /messenger/ws) and Kratos
// at /.ory/kratos/public, so the edge must route those paths and this app's "/" to :5555.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const PORT = Number(process.env.PORT) || 5555;
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".wasm": "application/wasm",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
};

// Cache policy is critical for a PWA behind a CDN (Cloudflare):
//  - sw.js / the workbox runtime / index.html / manifest MUST NOT be cached, or a stale service
//    worker keeps precaching an OLD build whose chunk hashes no longer match the fresh index.html
//    → the app loads new HTML but the SW serves old chunks → runtime crashes. Serve them no-store.
//  - Content-hashed assets (/assets/*, hashed filenames) are immutable → cache them hard.
function cacheControlFor(path) {
    const base = path.split(/[/\\]/).pop() || "";
    // The service worker (any *sw.js — we use app-sw.js) and its workbox runtime must NEVER be
    // CDN-cached, or a stale SW pins an old precache manifest → chunk-hash mismatch → app crash.
    if (base.endsWith("sw.js") || base.startsWith("workbox-")) return "no-store, no-cache, must-revalidate";
    const ext = extname(path);
    if (ext === ".html") return "no-store, no-cache, must-revalidate";
    if (ext === ".webmanifest") return "no-cache";
    if (path.includes(`${"/"}assets${"/"}`)) return "public, max-age=31536000, immutable";
    return "no-cache";
}

// E2EE hardening (Phase 0): a strict CSP so the app runs only OUR code (can't be tricked into loading
// attacker JS that would read E2EE keys). Everything the app talks to is same-origin (the edge routes
// /messenger, /.ory, /webpush and the presigned attachment URLs under this host) → 'self' covers REST,
// WS and attachment fetch. WebRTC ICE/TURN is not governed by CSP. Inline style ATTRIBUTES (progress
// bars etc.) need style 'unsafe-inline' (style injection is not a code-exec vector).
//
// Shipped REPORT-ONLY first: it blocks nothing, only logs violations to the console, so we can discover
// anything cross-origin (esp. attachments/MinIO) and the inline SW-registration script (needs its
// sha256 in script-src) BEFORE flipping to the enforcing `Content-Security-Policy` header.
const CSP = [
    "default-src 'self'",
    "script-src 'self'",            // TODO before enforce: add 'sha256-…' of the inline SW registration
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self'",           // REST + same-origin wss + attachment fetch
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
].join("; ");

async function sendFile(res, path) {
    const body = await readFile(path);
    const headers = {
        "Content-Type": MIME[extname(path)] || "application/octet-stream",
        "Cache-Control": cacheControlFor(path),
    };
    // CSP governs the document; set it on the HTML responses (the SPA shell).
    if (extname(path) === ".html") headers["Content-Security-Policy-Report-Only"] = CSP;
    res.writeHead(200, headers);
    res.end(body);
}

const server = createServer(async (req, res) => {
    try {
        const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
        // Contain the path within DIST (no traversal).
        const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
        const candidate = join(DIST, rel);

        if (candidate.startsWith(DIST)) {
            try {
                const s = await stat(candidate);
                if (s.isFile()) return await sendFile(res, candidate);
            } catch {
                // fall through to SPA fallback
            }
        }
        // SPA fallback: any non-file route renders index.html (client-side routing).
        return await sendFile(res, join(DIST, "index.html"));
    } catch {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal error");
    }
});

server.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`front4mess serving ${DIST} on http://${HOST}:${PORT}`);
});
