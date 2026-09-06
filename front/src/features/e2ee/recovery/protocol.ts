import {ensureProvisioned} from "../lib/provisioning.ts";
import {encryptTo, decryptFrom, type SecretEnvelope} from "../lib/secretSession.ts";
import {loadPlaintext, E2EE_PLAINTEXT_TTL_MS} from "../lib/atRest.ts";

// The recovery protocol messages (ride the opaque SIGNAL channel, so `from`/`to`/`conversationId` are added
// by the transport). clientIds are NOT secret; only the recovered message bodies are (re-encrypted).
export const RECOVER_REQ = "e2ee:recover-req";
export const RECOVER_RESP = "e2ee:recover-resp";

export const MAX_RECOVER_BATCH = 50;          // cap ids per request (anti-storm)

export interface RecoverReq { type: typeof RECOVER_REQ; to: string; conversationId: string; clientIds: string[] }
interface RecoverItem { forClientId: string; env: SecretEnvelope }
export interface RecoverResp { type: typeof RECOVER_RESP; to: string; conversationId: string; items: RecoverItem[] }

/** Build the outgoing request frame (batched, capped). */
export function buildRequest(peerId: string, chatId: string, clientIds: string[]): RecoverReq {
    return { type: RECOVER_REQ, to: peerId, conversationId: chatId, clientIds: clientIds.slice(0, MAX_RECOVER_BATCH) };
}

/**
 * Responder (the ORIGINAL sender): for each requested clientId, look up OUR own stored plaintext (kept
 * under the client id at send) and RE-ENCRYPT it as a fresh secret message to the requester — a new
 * ratchet key, so there's no gap on their side. Only what we still have (within the 48h TTL) is returned.
 */
export async function buildResponse(requesterId: string, chatId: string, clientIds: string[]): Promise<RecoverResp> {
    const {store, deviceId} = await ensureProvisioned();
    const items: RecoverItem[] = [];
    for (const clientId of clientIds.slice(0, MAX_RECOVER_BATCH)) {
        const plain = await loadPlaintext(clientId, E2EE_PLAINTEXT_TTL_MS);
        if (plain == null) continue;                                   // expired / never ours → can't help
        try { items.push({ forClientId: clientId, env: await encryptTo(store, requesterId, deviceId, plain) }); }
        catch { /* skip this one */ }
    }
    return { type: RECOVER_RESP, to: requesterId, conversationId: chatId, items };
}

/** Requester side: decrypt each recovered item → {forClientId, plaintext}. */
export async function applyResponse(senderId: string, items: RecoverItem[]): Promise<Array<{forClientId: string; plaintext: string}>> {
    const {store, deviceId} = await ensureProvisioned();
    const out: Array<{forClientId: string; plaintext: string}> = [];
    for (const it of items) {
        try { out.push({ forClientId: it.forClientId, plaintext: await decryptFrom(store, senderId, deviceId, it.env) }); }
        catch { /* couldn't decrypt this recovered item — leave it pending/lost */ }
    }
    return out;
}
