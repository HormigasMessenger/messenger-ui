// Client for the hormiga-key-directory service (X3DH prekey directory). Reaches it same-origin through
// the Ory edge at /key-directory/v1 — the Kratos session cookie rides along, and Oathkeeper injects the
// caller's X-User-Id (we never send it). The service stores/serves PUBLIC keys only; all crypto is local.
// Contract mirrors the service's dto.go (public keys are standard base64 strings).

const BASE = "/key-directory/v1";

export interface PreKeyPub { id: number; publicKey: string }               // base64
export interface SignedPreKeyPub { id: number; publicKey: string; signature: string }

/** KEY_PUBLISH body — userId is taken from the auth header, never sent. */
export interface PublishBody {
    deviceId: string;
    identityKey: string;                 // base64 public identity key
    signedPreKey: SignedPreKeyPub;
    oneTimePreKeys: PreKeyPub[];
}

export interface DeviceBundle {
    deviceId: string;
    identityKey: string;
    signedPreKey: SignedPreKeyPub;
    oneTimePreKey: PreKeyPub | null;     // null when the peer's OPK pool is exhausted (X3DH → SPK-only)
    oneTimePreKeysRemaining: number;
}
export interface FetchResponse { userId: string; devices: DeviceBundle[] }
export interface CountResponse { deviceId: string; oneTimePreKeysRemaining: number }

class KeyDirectoryError extends Error {
    status: number;
    constructor(status: number, msg: string) { super(msg); this.name = "KeyDirectoryError"; this.status = status; }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(BASE + path, {
        ...init,
        credentials: "include",                                  // Kratos session cookie
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new KeyDirectoryError(res.status, `${init?.method ?? "GET"} ${path} → ${res.status}`);
    // 204/empty bodies (publish/replenish may return a small JSON; tolerate empty).
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
}

/** Publish/replace this device's identity + signed prekey and seed its one-time-prekey pool. */
export function publishKeys(body: PublishBody): Promise<CountResponse> {
    return req<CountResponse>("/keys", { method: "POST", body: JSON.stringify(body) });
}

/** Top up this device's one-time-prekey pool (low-water replenishment). */
export function replenishOneTime(deviceId: string, oneTimePreKeys: PreKeyPub[]): Promise<CountResponse> {
    return req<CountResponse>("/keys/one-time", { method: "POST", body: JSON.stringify({ deviceId, oneTimePreKeys }) });
}

/** How many one-time prekeys this device has left (drives replenishment). */
export function selfCount(deviceId: string): Promise<CountResponse> {
    return req<CountResponse>(`/keys/self/count?deviceId=${encodeURIComponent(deviceId)}`);
}

/**
 * Fetch a peer's bundles — one per usable device — to start X3DH. NOTE: this CONSUMES one one-time
 * prekey per device server-side, so only call it when actually establishing a session, not speculatively.
 * A device with an exhausted pool returns oneTimePreKey=null (X3DH falls back to signed-prekey only).
 */
export async function fetchUserKeys(userId: string): Promise<FetchResponse> {
    try {
        return await req<FetchResponse>(`/keys/${encodeURIComponent(userId)}`);
    } catch (e) {
        // A peer who has never published keys is a 404 — that's "no keys yet", NOT an error. Return an
        // empty roster so the caller can give a clear "contact hasn't enabled encryption" message instead
        // of a generic failure. Any OTHER status is a real error and re-throws.
        if (e instanceof KeyDirectoryError && e.status === 404) return { userId, devices: [] };
        throw e;
    }
}

/** Fetch one specific device's bundle (also consumes an OPK for that device). */
export function fetchDeviceKeys(userId: string, deviceId: string): Promise<{ userId: string; device: DeviceBundle }> {
    return req(`/keys/${encodeURIComponent(userId)}/${encodeURIComponent(deviceId)}`);
}

export { KeyDirectoryError };
