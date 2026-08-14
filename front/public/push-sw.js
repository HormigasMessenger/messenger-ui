/* Web Push + notification arbiter, imported into the generated service worker via workbox
 * `importScripts`.
 *
 * Plain JS on purpose: this file is served verbatim from /public (never bundled/hashed) and pulled
 * into app-sw.js with importScripts(), so it must run as-is in the SW global scope.
 *
 * SINGLE-ARBITER MODEL. One incoming message can be announced by TWO independent channels:
 *   - OFFLINE: the OS delivers a Web Push → the `push` event here (app suspended/closed).
 *   - ONLINE:  the live app got the CHAT_OUT frame and asks us to notify → the `message` event here.
 * Both converge on showChatNotification(), which dedups by `data.messageId` BEFORE showing. The SW
 * is single-threaded, so claiming the id (claimShow) is synchronous and race-free: whichever channel
 * reaches it first for a given messageId shows the notification; the other is dropped. This replaces
 * the old best-effort "same tag + close-existing" coalescing, which lost the near-simultaneous race.
 *
 * Payload shape (hormiga-webpush domain.Notification, and the page's postMessage payload):
 *   { title, body, tag?, data: { conversationId?, messageId?, senderId?, url? } }
 */

// App base path (…/messenger-ui/), derived from the SW scope so icon/URL are correct regardless of mount.
const SCOPE_PATH = (() => {
    try { return new URL(self.registration.scope).pathname; } catch (e) { return "/"; }
})();

// hormiga-webpush API on the edge. Same origin, mounted at /webpush (the deploy default,
// VITE_WEBPUSH_BASE — the SW is served verbatim so it can't read the app's build config).
const WEBPUSH_BASE = "/webpush";

// base64url VAPID key → Uint8Array (PushManager.applicationServerKey). Mirrors push.ts.
function vapidKeyToBytes(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

// Cross-channel dedup in TWO layers, keyed by messageId:
//  L1 — in-memory Map (this SW lifetime): wins the near-simultaneous online/offline race SYNCHRONOUSLY.
//  L2 — IndexedDB (durable across SW restarts): suppresses the backend's guaranteed REDELIVERY. The
//       server re-sends the SAME offline push until the message is acked (the user comes back online →
//       CHAT_ACK on reconnect). The SW is killed when idle, so a purely in-memory guard would re-show
//       (and re-buzz) on every redelivery. L2 remembers the id past the SW's death. (webpush's own dedup
//       is in-memory/best-effort and explicitly delegates durable coalescing to the browser.)
const DEDUP_TTL_MS = 60_000;                     // L1 window
const PERSIST_TTL_MS = 3 * 24 * 60 * 60 * 1000;  // L2: remember a shown message for a few days
const shownRecently = new Map();

function openDedupDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open("hormiga-push-dedup", 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("seen")) db.createObjectStore("seen");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// Durably claim `id`: true if newly recorded (show), false if already shown within PERSIST_TTL_MS
// (a redelivery → drop). Opportunistically prunes expired entries so the store stays bounded.
async function idbClaim(id, now, ttl) {
    const db = await openDedupDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction("seen", "readwrite");
            const store = tx.objectStore("seen");
            let isDup = false;
            const getReq = store.get(id);
            getReq.onsuccess = () => {
                const exp = getReq.result;
                if (typeof exp === "number" && exp > now) { isDup = true; return; }
                store.put(now + ttl, id);
                if (Math.random() < 0.1) {
                    const cur = store.openCursor();
                    cur.onsuccess = () => {
                        const c = cur.result;
                        if (!c) return;
                        if (typeof c.value === "number" && c.value <= now) c.delete();
                        c.continue();
                    };
                }
            };
            tx.oncomplete = () => resolve(!isDup);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error("dedup tx abort"));
        });
    } finally {
        db.close();
    }
}

// Claim the right to show `messageId`. L1 (sync) is claimed BEFORE any await so the push/message events
// can't both pass in one lifetime; L2 (IndexedDB) then suppresses cross-restart redelivery. A missing id
// can't be deduped → always shows.
async function claimShow(messageId) {
    const now = Date.now();
    for (const [k, exp] of shownRecently) { if (exp <= now) shownRecently.delete(k); }
    if (!messageId) return true;
    if (shownRecently.has(messageId)) return false;   // L1: already claimed this lifetime
    shownRecently.set(messageId, now + DEDUP_TTL_MS);
    try {
        if (!(await idbClaim(messageId, now, PERSIST_TTL_MS))) return false; // L2: shown in a prior lifetime
    } catch (e) { /* IndexedDB unavailable → fall back to L1 only */ }
    return true;
}

async function showChatNotification(payload) {
    const data = (payload && payload.data && typeof payload.data === "object") ? payload.data : {};
    // Dedup across channels + across the backend's redelivery (L1 sync claim, then durable L2).
    if (!(await claimShow(data.messageId))) return;

    const isCall = data.kind === "call";
    const title = (payload && payload.title) || (isCall ? "Incoming call" : "New message");
    // A call gets its OWN tag so it never collapses into a message notification for the same chat.
    const tag = isCall
        ? "call:" + (data.conversationId || "chat")
        : ((payload && payload.tag) || data.conversationId || "chat-message");
    const options = {
        body: (payload && payload.body) || (isCall ? "is calling you…" : "You have a new message"),
        icon: SCOPE_PATH + "pwa-192x192.png",
        badge: SCOPE_PATH + "pwa-192x192.png",
        tag,               // one notification per conversation (calls: per conversation, distinct)
        renotify: true,
        data,
        // Call: keep it up until acted on, vibrate, and offer an explicit action. The button's
        // action id is read in notificationclick to route to the answer/call-back flow.
        requireInteraction: isCall,
        vibrate: isCall ? [200, 100, 200, 100, 200] : undefined,
        actions: isCall ? [{ action: "answer", title: "Answer" }] : undefined,
    };
    // Belt-and-suspenders: also close any existing same-tag notification so a lingering prior one for
    // this conversation is replaced rather than stacked (OS tag-replace is unreliable on iOS).
    try {
        const existing = await self.registration.getNotifications({ tag });
        for (const n of existing) n.close();
    } catch (e) { /* getNotifications unsupported → rely on tag-replace */ }
    await self.registration.showNotification(title, options);
}

// OFFLINE channel: server Web Push.
self.addEventListener("push", (event) => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch (e) { payload = {}; }
    event.waitUntil(showChatNotification(payload));
});

// ONLINE channel: the live app asks the arbiter to render a notification (see notify.ts).
self.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg && msg.type === "show-notification" && msg.payload) {
        event.waitUntil(showChatNotification(msg.payload));
    }
});

// AUTOMATIC background token refresh. The browser / push service can ROTATE or EXPIRE the push
// subscription on its own — and it fires this event in the SW even when the app is closed. Without
// handling it, the rotated endpoint 410s server-side and the user SILENTLY stops receiving pushes
// until they next open the app (which re-subscribes). Here we re-subscribe with the current VAPID key
// and re-register the NEW endpoint with the backend immediately (the Kratos cookie rides on the
// same-origin fetch, so the backend re-associates it with this user). Best-effort.
self.addEventListener("pushsubscriptionchange", (event) => {
    event.waitUntil((async () => {
        try {
            const keyRes = await fetch(WEBPUSH_BASE + "/vapid-public-key", {credentials: "include"});
            if (!keyRes.ok) return;
            const publicKey = (await keyRes.json()).publicKey;
            if (!publicKey) return;
            // Prefer the browser-provided new subscription; otherwise re-subscribe.
            let sub = event.newSubscription || null;
            if (!sub) {
                sub = await self.registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: vapidKeyToBytes(publicKey),
                });
            }
            const j = sub.toJSON();
            await fetch(WEBPUSH_BASE + "/subscriptions", {
                method: "POST",
                credentials: "include",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    endpoint: j.endpoint,
                    keys: {p256dh: j.keys && j.keys.p256dh, auth: j.keys && j.keys.auth},
                    userAgent: (self.navigator && self.navigator.userAgent) || "",
                }),
            });
        } catch (e) { /* best-effort: the app also re-registers on next open */ }
    })());
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const data = event.notification.data || {};
    // For a call: tapping "Answer" (or the body) routes to the call-back deep link so the app opens the
    // conversation AND starts calling the caller (the original WebRTC offer is stale by now, so we
    // re-initiate). data.url is the plain chat link (used for message notifications / a non-call tap).
    let target = data.url || self.registration.scope;
    if (data.kind === "call" && (data.conversationId || data.senderId)) {
        const base = new URL(SCOPE_PATH, self.registration.scope).href;
        const qs = new URLSearchParams();
        if (data.conversationId) qs.set("call", data.conversationId);
        if (data.senderId) qs.set("caller", data.senderId);
        target = base + "?" + qs.toString();
    } else if (!data.url && data.conversationId) {
        // OFFLINE message push carries no `url` (the webpush payload is {conversationId, messageId,
        // senderId, kind}). Build the same ?chat= deep link the online path uses, so tapping the
        // notification opens the RIGHT conversation instead of the app root. (Messenger reads ?chat=.)
        const base = new URL(SCOPE_PATH, self.registration.scope).href;
        target = base + "?chat=" + encodeURIComponent(data.conversationId);
    }
    event.waitUntil((async () => {
        const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        // Focus an already-open app window if there is one, and route it to the click-through URL
        // (e.g. the conversation the push was for) — focus alone would leave it on whatever was open.
        for (const c of wins) {
            if (c.url && c.url.indexOf(SCOPE_PATH) !== -1 && "focus" in c) {
                try { await c.focus(); } catch (e) { /* ignore */ }
                if (target && "navigate" in c) { try { await c.navigate(target); } catch (e) { /* ignore */ } }
                return;
            }
        }
        // Otherwise open a new one.
        if (self.clients.openWindow) {
            try { await self.clients.openWindow(target); } catch (e) { /* ignore */ }
        }
    })());
});
