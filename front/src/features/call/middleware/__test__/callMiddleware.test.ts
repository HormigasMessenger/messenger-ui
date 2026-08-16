import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingWebRTCMessage } from "@/features/call/model/types.ts";
import {
    acceptCall,
    incomingAnswer,
    incomingOffer,
    incomingRemoteEnd,
    localEnd,
    outgoingCall,
} from "@/features/call/model/slices/callSlice.js";
import {READY_FALLBACK_MS} from "@/shared/config/webrtc.ts";
import { createCallMiddleware } from "../callMiddleware";
import type { WebRTCService } from "@/features/call/service/webRTCService";
import { chatApi } from "@/features/chat/rest/chatApi.ts";

// A getState() that resolves the getChats cache so the outgoing-call conversation guard passes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stateWithConversation(counterpartId: string, call: any) {
    return {
        call,
        user: { id: "me" },
        [chatApi.reducerPath]: {
            queries: {
                'getChats({"myId":"me"})': {
                    status: "fulfilled",
                    data: [{ conversationId: "c1", counterpartId, blocked: false, blockedByMe: false, blockedByPeer: false }],
                },
            },
        },
    };
}

describe("callMiddleware", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let store: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let next: any;
    let webRTCService: WebRTCService;
    let middleware: ReturnType<typeof createCallMiddleware>;

    beforeEach(() => {
        store = {
            dispatch: vi.fn(),
            getState: vi.fn(() => ({
                call: {
                    incomingOfferData: { from: "peerX", offer: {} },
                    peerId: "peerY",
                    status: "idle",
                },
            })),
        };
        next = vi.fn();

        webRTCService = {
            startCall: vi.fn(() => Promise.resolve()),
            handleOffer: vi.fn(() => Promise.resolve()),
            handleAnswer: vi.fn(() => Promise.resolve()),
            addIce: vi.fn(() => Promise.resolve()),
            hangUp: vi.fn(),
            endRemote: vi.fn(),
            declineOffer: vi.fn(),
            rejectCall: vi.fn(),
            resendOffer: vi.fn(() => true),
            signalReady: vi.fn(),
            getConnectionState: vi.fn(() => null),
        } as unknown as WebRTCService;

        middleware = createCallMiddleware(webRTCService);
    });

    it("passes action through next", () => {
        const action = { type: "any/action" };
        middleware(store)(next)(action);
        expect(next).toHaveBeenCalledWith(action);
    });

    it("ws/incoming: call:offer диспатчит incomingOffer", () => {
        const msg: IncomingWebRTCMessage = { type: "call:offer", from: "peer1", offer: {} as RTCSessionDescriptionInit};
        middleware(store)(next)({ type: "ws/incoming", payload: msg });
        expect(store.dispatch).toHaveBeenCalledWith(
            incomingOffer({ from: "peer1", offer: {} as RTCSessionDescriptionInit})
        );
    });

    it("ws/incoming: call:answer вызывает handleAnswer и диспатчит incomingAnswer (когда есть pc)", async () => {
        // We have a pending outgoing call → getConnectionState is truthy → transition to connecting.
        webRTCService.getConnectionState = vi.fn(() => "connecting" as RTCPeerConnectionState);
        const msg: IncomingWebRTCMessage = { type: "call:answer", from: "peer2", answer: {} as RTCSessionDescriptionInit};
        await middleware(store)(next)({ type: "ws/incoming", payload: msg });
        expect(webRTCService.handleAnswer).toHaveBeenCalledWith(msg);
        expect(store.dispatch).toHaveBeenCalledWith(incomingAnswer());
    });

    it("ws/incoming: call:answer БЕЗ активного pc НЕ диспатчит incomingAnswer (поздний/сторонний answer)", async () => {
        // getConnectionState is null (default mock) → a stray answer must not flip idle → connecting.
        const msg: IncomingWebRTCMessage = { type: "call:answer", from: "peer2", answer: {} as RTCSessionDescriptionInit};
        await middleware(store)(next)({ type: "ws/incoming", payload: msg });
        expect(webRTCService.handleAnswer).toHaveBeenCalledWith(msg);
        expect(store.dispatch).not.toHaveBeenCalledWith(incomingAnswer());
    });

    it("ws/incoming: call:offer при НЕ-idle статусе отклоняется (declineOffer), не клоббит активный звонок", () => {
        store.getState = vi.fn(() => ({ call: { status: "in_call", peerId: "peerY", incomingOfferData: null } }));
        const msg: IncomingWebRTCMessage = { type: "call:offer", from: "peerZ", offer: {} as RTCSessionDescriptionInit };
        middleware(store)(next)({ type: "ws/incoming", payload: msg });
        expect(webRTCService.declineOffer).toHaveBeenCalledWith("peerZ");
        expect(store.dispatch).not.toHaveBeenCalledWith(incomingOffer({ from: "peerZ", offer: {} as RTCSessionDescriptionInit }));
    });

    it("ws/incoming: call:offer от абонента, КОТОРОМУ мы звоним (glare / перезвон по пушу) — не отклоняет, а отвечает", async () => {
        // We're calling peerCB; they were offline, opened the app from the call push and called back.
        // Resolve in their favor: drop our outgoing pc WITHOUT signaling (endRemote), then answer.
        store.getState = vi.fn(() => ({ call: { status: "calling", peerId: "peerCB", incomingOfferData: null } }));
        const msg: IncomingWebRTCMessage = { type: "call:offer", from: "peerCB", offer: {} as RTCSessionDescriptionInit, media: "video" };
        await middleware(store)(next)({ type: "ws/incoming", payload: msg });
        expect(webRTCService.endRemote).toHaveBeenCalled();
        expect(webRTCService.declineOffer).not.toHaveBeenCalled();
        expect(webRTCService.handleOffer).toHaveBeenCalledWith({ from: "peerCB", offer: {} as RTCSessionDescriptionInit, media: "video" });
        expect(store.dispatch).toHaveBeenCalledWith(acceptCall());
    });

    it("ws/incoming: call:ready от абонента, которому мы звоним → пере-отправляем offer (resendOffer)", () => {
        store.getState = vi.fn(() => ({ call: { status: "calling", peerId: "peerR", incomingOfferData: null } }));
        middleware(store)(next)({ type: "ws/incoming", payload: { type: "call:ready", from: "peerR" } });
        expect(webRTCService.resendOffer).toHaveBeenCalled();
    });

    it("ws/incoming: call:ready когда мы idle (уже сдались) → НЕ пере-отправляем", () => {
        store.getState = vi.fn(() => ({ call: { status: "idle", peerId: null, incomingOfferData: null } }));
        middleware(store)(next)({ type: "ws/incoming", payload: { type: "call:ready", from: "peerR" } });
        expect(webRTCService.resendOffer).not.toHaveBeenCalled();
    });

    it("call/answerViaPush шлёт call:ready и, если offer не пришёл, откатывается на glare-перезвон", () => {
        vi.useFakeTimers();
        try {
            store.getState = vi.fn(() => ({ call: { status: "idle", peerId: null, conversationId: "c9", incomingOfferData: null } }));
            middleware(store)(next)({ type: "call/answerViaPush", payload: { peerId: "peerP", conversationId: "c9" } });
            expect(webRTCService.signalReady).toHaveBeenCalledWith("peerP");
            expect(store.dispatch).not.toHaveBeenCalledWith(outgoingCall({ peerId: "peerP", conversationId: "c9" }));
            vi.advanceTimersByTime(READY_FALLBACK_MS);
            // Still idle after the window → fall back to calling them back.
            expect(store.dispatch).toHaveBeenCalledWith(outgoingCall({ peerId: "peerP", conversationId: "c9" }));
        } finally {
            vi.useRealTimers();
        }
    });

    it("call/answerViaPush: если offer пришёл (не idle) — фолбэк-перезвон НЕ срабатывает", () => {
        vi.useFakeTimers();
        try {
            // Idle when the ready is sent, then ringing by the time the fallback timer fires.
            let status = "idle";
            store.getState = vi.fn(() => ({ call: { status, peerId: "peerP", conversationId: "c9", incomingOfferData: null } }));
            middleware(store)(next)({ type: "call/answerViaPush", payload: { peerId: "peerP", conversationId: "c9" } });
            status = "ringing";
            vi.advanceTimersByTime(READY_FALLBACK_MS);
            expect(store.dispatch).not.toHaveBeenCalledWith(outgoingCall({ peerId: "peerP", conversationId: "c9" }));
        } finally {
            vi.useRealTimers();
        }
    });

    it("ws/incoming: call:ice вызывает addIce", async () => {
        const msg: IncomingWebRTCMessage = { type: "call:ice", from: "peer3", candidate: {} };
        await middleware(store)(next)({ type: "ws/incoming", payload: msg });
        expect(webRTCService.addIce).toHaveBeenCalledWith(msg);
    });

    it("ws/incoming: call:end вызывает endRemote (без эхо) и диспатчит incomingRemoteEnd", () => {
        const msg: IncomingWebRTCMessage = { type: "call:end", from: "peer4" };
        middleware(store)(next)({ type: "ws/incoming", payload: msg });
        expect(webRTCService.endRemote).toHaveBeenCalled();
        expect(webRTCService.hangUp).not.toHaveBeenCalled();
        expect(store.dispatch).toHaveBeenCalledWith(incomingRemoteEnd());
    });

    it("call/outgoingCall вызывает startCall когда есть беседа с абонентом", async () => {
        store.getState = vi.fn(() => stateWithConversation("peer5", { status: "idle", peerId: null, incomingOfferData: null }));
        const action = { type: "call/outgoingCall", payload: { peerId: "peer5", audioOnly: false } };
        await middleware(store)(next)(action);
        expect(webRTCService.startCall).toHaveBeenCalledWith("peer5", false);
    });

    it("call/outgoingCall БЕЗ беседы не звонит, а диспатчит localEnd", async () => {
        store.getState = vi.fn(() => stateWithConversation("someoneElse", { status: "idle", peerId: null, incomingOfferData: null }));
        const action = { type: "call/outgoingCall", payload: { peerId: "peer5", audioOnly: false } };
        await middleware(store)(next)(action);
        expect(webRTCService.startCall).not.toHaveBeenCalled();
        expect(store.dispatch).toHaveBeenCalledWith(localEnd());
    });

    it("call/outgoingCall со ЯВНЫМ conversationId звонит даже без беседы в getChats (deep-link из пуша)", async () => {
        // Cold start from a call notification: getChats isn't loaded, but the push carried the
        // conversationId → the call must proceed instead of erroring "open a chat first".
        store.getState = vi.fn(() => stateWithConversation("someoneElse", { status: "calling", peerId: "peer9", conversationId: "cX", incomingOfferData: null }));
        const action = { type: "call/outgoingCall", payload: { peerId: "peer9", audioOnly: false, conversationId: "cX" } };
        await middleware(store)(next)(action);
        expect(webRTCService.startCall).toHaveBeenCalledWith("peer9", false);
    });

    it("call/outgoingCall резолвит беседу из sticky-чатов (union), когда getChats её не отдаёт", async () => {
        // An open-but-empty chat is hidden from /api/chats but kept via sticky — calling it must work.
        store.getState = vi.fn(() => ({
            call: { status: "calling", peerId: "peerS", conversationId: null, incomingOfferData: null },
            user: { id: "me" },
            stickyChats: { byId: { cS: { conversationId: "cS", counterpartId: "peerS", blocked: false, blockedByMe: false, blockedByPeer: false } } },
            [chatApi.reducerPath]: { queries: {} },
        }));
        const action = { type: "call/outgoingCall", payload: { peerId: "peerS", audioOnly: false } };
        await middleware(store)(next)(action);
        expect(webRTCService.startCall).toHaveBeenCalledWith("peerS", false);
    });

    it("call/outgoingCall audio-only передаёт audioOnly=true в startCall", async () => {
        store.getState = vi.fn(() => stateWithConversation("peer6", { status: "idle", peerId: null, incomingOfferData: null }));
        const action = { type: "call/outgoingCall", payload: { peerId: "peer6", audioOnly: true } };
        await middleware(store)(next)(action);
        expect(webRTCService.startCall).toHaveBeenCalledWith("peer6", true);
    });

    it("call/acceptCall вызывает handleOffer если есть incomingOfferData", async () => {
        const action = { type: "call/acceptCall" };
        await middleware(store)(next)(action);
        expect(webRTCService.handleOffer).toHaveBeenCalledWith({ from: "peerX", offer: {} });
    });

    it("call/localEnd вызывает hangUp", () => {
        const action = { type: "call/localEnd" };
        middleware(store)(next)(action);
        expect(webRTCService.hangUp).toHaveBeenCalled();
    });

    it("call/rejectCall вызывает rejectCall с peerId", () => {
        const action = { type: "call/rejectCall" };
        middleware(store)(next)(action);
        expect(webRTCService.rejectCall).toHaveBeenCalledWith("peerY");
    });

    it("call/acceptCall: если handleOffer падает — диспатчит localEnd", async () => {
        // The connected→in_call transition is now driven by webRTCService's onConnected callback
        // (wired in store.ts), not polled here. What callMiddleware owns is the failure path:
        // a rejected handleOffer (e.g. camera denied) must drop the call back to idle.
        webRTCService.handleOffer = vi.fn(() => Promise.reject(new Error("camera denied")));
        middleware(store)(next)({ type: "call/acceptCall" });
        await new Promise((r) => setTimeout(r, 0)); // flush the .catch microtask
        expect(store.dispatch).toHaveBeenCalledWith(localEnd());
    });
});
