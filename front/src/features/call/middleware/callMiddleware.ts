import type {Middleware, PayloadAction} from "@reduxjs/toolkit";
import type {IncomingWebRTCMessage} from "@/features/call/model/types.ts";
import {
    acceptCall,
    incomingAnswer,
    incomingOffer,
    incomingRemoteEnd,
    localEnd,
    outgoingCall,
    pushAnswerFlushed
} from "@/features/call/model/slices/callSlice.js";
import {connected} from "@/infrastructure/slices/websocketSlice.ts";
import type {RootState} from "@/store/store.ts";
import {logger} from "@/shared/logger/logger.ts";
import type {WebRTCService} from "@/features/call/service/webRTCService";
import {selectCallConversationId} from "@/features/chat/model/directDirectory.ts";
import {READY_FALLBACK_MS} from "@/shared/config/webrtc.ts";
import toast from "react-hot-toast";
import i18n from "@/shared/i18n";

const exceptionHandler = (ex: Error) => logger.error(ex.message, ex);

export const createCallMiddleware = (webRTCService: WebRTCService): Middleware => {
    return (store) => (next) => (action) => {
        const {dispatch, getState} = store;
        // Capture the peer BEFORE reducers run — call/rejectCall nulls peerId, but we still need
        // it to send call:end to the caller (otherwise the caller never learns the call was declined).
        const peerIdBefore = (getState() as RootState).call.peerId;
        const result = next(action);
        const callAction = action as PayloadAction<unknown>;

        /* ======================
           Incoming WS messages
        ====================== */
        if (callAction.type === "ws/incoming") {
            const msg = (action as PayloadAction<IncomingWebRTCMessage>).payload;

            if (typeof msg?.type === "string" && msg.type.startsWith("call:")) {
                switch (msg.type) {
                    case "call:offer": {
                        const cs = (getState() as RootState).call;
                        // GLARE / push-answer: the peer we're currently CALLING is calling US back. They
                        // were offline, got the call push, opened the app and re-initiated (see
                        // parseCallDeepLink). Resolve in their favor — drop our own outgoing attempt
                        // WITHOUT signaling (endRemote, NOT hangUp: a call:end would cancel THEIR call),
                        // then answer their offer. Both sides converge into one connected call.
                        if (cs.status === "calling" && msg.from === cs.peerId) {
                            webRTCService.endRemote();
                            dispatch(acceptCall());   // calling → connecting
                            webRTCService.handleOffer({from: msg.from, offer: msg.offer, media: msg.media})
                                .catch((err) => { exceptionHandler(err); dispatch(localEnd()); });
                            break;
                        }
                        // Otherwise only a truly idle client may start ringing. If we're already
                        // ringing/connecting/in a call (or a STRAY third party offers mid-call), decline
                        // that caller instead of clobbering the active call. declineOffer does NOT touch
                        // our live pc/streams.
                        if (cs.status !== "idle") {
                            webRTCService.declineOffer(msg.from);
                            break;
                        }
                        dispatch(incomingOffer({from: msg.from, offer: msg.offer, media: msg.media}));
                        break;
                    }

                    case "call:ready": {
                        // The callee opened from the call push and is ready. If we're STILL ringing them,
                        // re-send our offer so they get a real incoming Accept/Decline dialog. If we've
                        // already given up (idle), ignore — their glare-callback fallback rings us instead.
                        const cs = (getState() as RootState).call;
                        if (cs.status === "calling" && msg.from === cs.peerId) {
                            webRTCService.resendOffer().catch(exceptionHandler);
                        }
                        break;
                    }

                    case "call:answer":
                        webRTCService.handleAnswer(msg).catch(exceptionHandler);
                        // Only transition to "connecting" if we actually have a pending outgoing call
                        // (a pc exists). A late/duplicate answer arriving after teardown must not flip
                        // an idle client back into "connecting" and restart the call-timeout.
                        if (webRTCService.getConnectionState()) dispatch(incomingAnswer());
                        break;

                    case "call:ice":
                        webRTCService.addIce(msg).catch(exceptionHandler);
                        break;

                    case "call:end":
                        webRTCService.endRemote();   // cleanup only — no call:end echo back to a peer that already ended
                        dispatch(incomingRemoteEnd());
                        break;
                }
            }
        }

        /* ======================
           Outgoing call
        ====================== */
        if (callAction.type === "call/outgoingCall") {
            const {peerId, audioOnly, conversationId} =
                (action as PayloadAction<{ peerId: string; audioOnly?: boolean; conversationId?: string }>).payload;

            // A call frame needs a conversationId or the backend drops the SIGNAL_IN and the caller
            // hangs on "calling" until the 30s timeout. It comes from one of two places: an explicit id
            // (a call push deep-link carries it — survives a cold start before getChats loads) or the
            // UNION chat directory (getChats ∪ sticky, so an open-but-empty chat still resolves). Only
            // when NEITHER yields a conversationId do we fail fast with a clear message.
            const st = getState() as RootState;
            if (!conversationId && !selectCallConversationId(st, peerId)) {
                toast.error(i18n.t("call.noConversation"));
                dispatch(localEnd());
                return result;
            }

            webRTCService.startCall(peerId, audioOnly ?? false)
                .then(() => {
                    // Успешно начали звонок
                })
                .catch((err) => {
                    exceptionHandler(err);
                    dispatch(localEnd()); // 🔥 Middleware диспатчит localEnd
                });
        }

        /* ======================
           Answer via push: the callee opened from the incoming-call notification. We ask the still-ringing
           caller to (re)send the offer (→ a real incoming dialog here); if none arrives shortly, fall back
           to the glare callback (call them back ourselves — with the SAME media, so an audio call can't
           turn into video). conversationId was stashed so call:ready / answer / ice route correctly even
           before getChats loads.

           CRITICAL: on a cold start the WS opens only AFTER we mount, and ws/send drops frames on a closed
           socket — so we can't send call:ready right away. flushPushAnswer() runs it the moment we ARE
           connected: either now (warm start, socket already open) or on the ws/connected transition below.
        ====================== */
        const flushPushAnswer = () => {
            const cs = (getState() as RootState).call;
            const p = cs.pendingPushAnswer;
            if (!p || cs.status !== "idle") return;   // nothing pending, or a real offer already arrived
            dispatch(pushAnswerFlushed());             // one-shot: don't re-send on a later reconnect
            webRTCService.signalReady(p.peerId);
            setTimeout(() => {
                if ((getState() as RootState).call.status === "idle") {
                    dispatch(outgoingCall({peerId: p.peerId, conversationId: p.conversationId, audioOnly: p.media === "audio"}));
                }
            }, READY_FALLBACK_MS);
        };
        if (callAction.type === "call/answerViaPush") {
            if ((getState() as RootState).ws.status === "connected") flushPushAnswer();
            // else: stays pending, flushed by the ws/connected branch when the socket opens.
        }
        if (callAction.type === connected.type) {
            flushPushAnswer();
        }

        /* ======================
           Accept incoming call
        ====================== */
        if (callAction.type === "call/acceptCall") {
            const state = getState() as RootState;
            const offer = state.call.incomingOfferData;

            if (offer) {
                webRTCService.handleOffer(offer).catch((err) => {
                    exceptionHandler(err);
                    // Accepting failed (camera denied / negotiation error) — drop back to idle so
                    // the UI doesn't hang on "connecting" (symmetric with the outgoing-call path).
                    dispatch(localEnd());
                });
            }
        }

        /* ======================
           Local hangup
        ====================== */
        if (callAction.type === "call/localEnd") {
            webRTCService.hangUp();
        }

        /* ======================
           Reject incoming call
        ====================== */
        if (callAction.type === "call/rejectCall") {
            if (peerIdBefore) {
                webRTCService.rejectCall(peerIdBefore);
            }
        }

        // NOTE: the "connected" → in_call transition (and "failed/closed" → idle) is now driven by
        // webRTCService's onConnectionStateChange callbacks (wired in store.ts), not polled here on
        // incidental Redux traffic.

        return result;
    };
};