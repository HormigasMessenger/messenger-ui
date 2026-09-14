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
// IDS (KratosGate) identity directory — reached through the edge under /people/**
// and gated by the Kratos SESSION only (Oathkeeper injects X-User-Id). The
// frontend no longer holds any IDS admin key: search, name-by-id and batch all go
// through session-authed routes. Override the base with VITE_PEOPLE_BASE.
export const PEOPLE_BASE_PATH =
    (import.meta.env.VITE_PEOPLE_BASE as string | undefined) ?? "/people";

// Messenger admin key — for the messenger's OWN admin/service endpoints (e.g.
// POST /api/chats provisioning). This is unrelated to IDS; removing it from the
// browser needs a messenger-backend change and is out of scope here.
//
// ⚠️ SECURITY / TEMPORARY DEMO-ONLY: this key is still baked into the JS bundle at
// build time. The real fix is a server-side gate so it never reaches the browser.
export const MESSENGER_ADMIN_KEY =
    (import.meta.env.VITE_MESSENGER_ADMIN_KEY as string | undefined) ?? "";
