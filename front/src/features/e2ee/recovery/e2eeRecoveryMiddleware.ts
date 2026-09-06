import type {Middleware} from "@reduxjs/toolkit";
import {chatApi} from "@/features/chat/rest/chatApi.ts";
import {logger} from "@/shared/logger/logger.ts";
import i18n from "@/shared/i18n";
import {savePlaintext} from "../lib/atRest.ts";
import {addPending, allPending, bumpAttempt, removePending, type PendingItem} from "./pendingStore.ts";
import {RECOVER_REQ, RECOVER_RESP, buildRequest, buildResponse, applyResponse, type RecoverReq, type RecoverResp} from "./protocol.ts";

// Client-to-client recovery (Step B), as a SELF-CONTAINED module. When a secret message can't be decrypted
// (permanent gap / ciphertext the ratchet never saw), we ask the ORIGINAL sender to re-encrypt it from
// their own stored plaintext — recovering the message without recovering a key (forward secrecy intact).
// The chat pipeline stays clean: chatMiddleware only DISPATCHES `e2ee/reportUndecryptable`; every bit of
// protocol, retry and persistence lives here and in ./protocol + ./pendingStore.

export const REPORT_UNDECRYPTABLE = "e2ee/reportUndecryptable";
export interface ReportUndecryptable {
    type: typeof REPORT_UNDECRYPTABLE;
    payload: { chatId: string; peerId: string; items: Array<{clientId: string; serverId: string}> };
}
/** Dispatched by chatMiddleware when a history secret message fails to decrypt (has a clientId to correlate). */
export const reportUndecryptable = (payload: ReportUndecryptable["payload"]): ReportUndecryptable => ({type: REPORT_UNDECRYPTABLE, payload});

const RETRY_MAX = 5;
const RETRY_BASE_MS = 30_000;
const RETRY_FACTOR = 1.5;
const TICK_MS = 15_000;

export const e2eeRecoveryMiddleware: Middleware = (store) => {
    type S = {user?: {id?: string}; ws?: {status?: string}};
    const getMyId = () => (store.getState() as S).user?.id ?? "";
    const wsConnected = () => (store.getState() as S).ws?.status === "connected";

    const patchRow = (chatId: string, serverId: string, text: string) => {
        const myId = getMyId();
        if (!myId) return;
        store.dispatch(chatApi.util.updateQueryData("getChatHistory", {myId, chatId}, (draft) => {
            const row = draft?.find((r) => r.id === serverId);
            if (row) { row.text = text; row.secret = true; }
        }) as never);
    };

    const sendRequestsFor = async (items: PendingItem[]) => {
        // Group by peer+chat, batch the client ids into one request each.
        const groups = new Map<string, {peerId: string; chatId: string; ids: string[]}>();
        for (const it of items) {
            const k = it.peerId + "|" + it.chatId;
            (groups.get(k) ?? groups.set(k, {peerId: it.peerId, chatId: it.chatId, ids: []}).get(k)!).ids.push(it.clientId);
        }
        for (const g of groups.values()) {
            store.dispatch({type: "ws/send", payload: buildRequest(g.peerId, g.chatId, g.ids)});
            for (const id of g.ids) await bumpAttempt(id);
        }
    };

    // Retry loop: re-request due items (backoff), give up + mark "lost" past RETRY_MAX.
    let timer: ReturnType<typeof setInterval> | null = null;
    const startTimer = () => {
        if (timer) return;
        timer = setInterval(() => { void tick(); }, TICK_MS);
    };
    const tick = async () => {
        if (!wsConnected()) return;
        const now = Date.now();
        const pend = await allPending();
        const exhausted = pend.filter((p) => p.attempts >= RETRY_MAX);
        for (const p of exhausted) { patchRow(p.chatId, p.serverId, i18n.t("chat.decryptLost")); await removePending(p.clientId); }
        const due = pend.filter((p) => p.attempts < RETRY_MAX && now - p.lastAt > RETRY_BASE_MS * Math.pow(RETRY_FACTOR, p.attempts));
        if (due.length) await sendRequestsFor(due);
    };

    return (next) => (action) => {
        const result = next(action);
        const a = action as {type?: string; payload?: unknown};
        startTimer();

        // (1) chatMiddleware reports messages it couldn't decrypt → mark pending, request now.
        if (a?.type === REPORT_UNDECRYPTABLE) {
            const {chatId, peerId, items} = (a as ReportUndecryptable).payload;
            if (items.length) void (async () => {
                const added = await addPending(items.map((it) => ({...it, chatId, peerId})));
                if (added.length) await sendRequestsFor(added);
            })();
            return result;
        }

        // (2) incoming SIGNAL recovery frames (routed here via frameBridge e2ee: → SIGNAL).
        if (a?.type === "ws/incoming") {
            const f = a.payload as {type?: string; from?: string; conversationId?: string; clientIds?: string[]; items?: RecoverResp["items"]};
            if (f?.type === RECOVER_REQ && f.from && f.conversationId && Array.isArray(f.clientIds)) {
                void (async () => {
                    try {
                        const resp = await buildResponse(f.from!, f.conversationId!, f.clientIds!);
                        if (resp.items.length) store.dispatch({type: "ws/send", payload: resp satisfies RecoverResp});
                    } catch (e) { logger.debug("e2ee recovery: respond failed", e as Error); }
                })();
                return result;
            }
            if (f?.type === RECOVER_RESP && f.from && Array.isArray(f.items)) {
                void (async () => {
                    try {
                        const recovered = await applyResponse(f.from!, f.items!);
                        const pend = await allPending();
                        const byClient = new Map(pend.map((p) => [p.clientId, p]));
                        for (const {forClientId, plaintext} of recovered) {
                            const p = byClient.get(forClientId);
                            if (!p) continue;
                            await savePlaintext(p.serverId, p.chatId, plaintext);
                            patchRow(p.chatId, p.serverId, plaintext);
                            await removePending(forClientId);
                        }
                    } catch (e) { logger.debug("e2ee recovery: apply failed", e as Error); }
                })();
                return result;
            }
        }
        return result;
    };
};

// silence unused-type import in some TS configs
export type {RecoverReq};
