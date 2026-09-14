// Edge prefix under which the Hormigas Messenger is exposed on the Ory edge.
// On staging the messenger REST lives at `${origin}/messenger/api/**` and the WS at
// `${origin}/messenger/ws`. All calls are host-relative so the browser sends the
// existing Kratos session cookie (same-origin with the edge). Override per-env with
// VITE_MESSENGER_BASE (e.g. "" if the messenger is mounted at the origin root).
export const MESSENGER_BASE =
    (import.meta.env.VITE_MESSENGER_BASE as string | undefined) ?? "/messenger";

export const MESSENGER_API = `${MESSENGER_BASE}/api`;
export const MESSENGER_WS_PATH = `${MESSENGER_BASE}/ws`;

// hormiga-webpush edge prefix (Kratos+Oathkeeper): GET /webpush/vapid-public-key (public) and
// GET/POST/DELETE /webpush/subscriptions (cookie-authed). Host-relative → same-origin session cookie.
export const WEBPUSH_BASE =
    (import.meta.env.VITE_WEBPUSH_BASE as string | undefined) ?? "/webpush";

// IDS (KratosGate) admin directory for user search. The edge route (host-relative, same
// origin) is provided by the platform; the frontend sends the IDS admin key as X-Admin-Key.
// Override the path with VITE_IDS_URL.
//
// ⚠️ SECURITY / TEMPORARY DEMO-ONLY: these admin keys live in the frontend .env and are
// baked into the JS bundle at build time — anyone who loads the app can read them. This is a
// concept-demo crutch. The real fix is a server-side proxy (or a short-lived, scoped token)
// that holds the admin key so it never reaches the browser. Rotate + remove after the demo.
export const MESSENGER_IDS_URL =
    (import.meta.env.VITE_IDS_URL as string | undefined) ?? "/ids";

// IDS adaptive people-search — the END-USER contact search. Unlike the /ids/admin
// directory lookups above, this edge route is gated by the Kratos SESSION only
// (Oathkeeper injects X-User-Id); no admin key is sent. Host-relative, same-origin
// with the edge. Override the path with VITE_PEOPLE_SEARCH_PATH.
export const PEOPLE_SEARCH_PATH =
    (import.meta.env.VITE_PEOPLE_SEARCH_PATH as string | undefined) ?? "/people/search";

// IDS (kratosgate) admin key — for /ids/admin/** directory lookups only.
export const IDS_ADMIN_KEY =
    (import.meta.env.VITE_IDS_ADMIN_KEY as string | undefined) ?? "";

// Messenger admin key — for the messenger's own admin/service endpoints (e.g.
// POST /api/chats provisioning). This is a DIFFERENT key from IDS_ADMIN_KEY; sending the
// IDS key here yields 403 "X-Admin-Key inválido". Falls back to IDS_ADMIN_KEY only for
// backward compatibility with single-key setups where both backends share one key.
export const MESSENGER_ADMIN_KEY =
    (import.meta.env.VITE_MESSENGER_ADMIN_KEY as string | undefined) ?? IDS_ADMIN_KEY;
