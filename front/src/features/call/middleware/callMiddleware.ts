import type {Middleware, PayloadAction} from "@reduxjs/toolkit";
import type {IncomingWebRTCMessage} from "@/features/call/model/types.ts";
import {
    incomingAnswer,
    incomingOffer,
    incomingRemoteEnd,
    localEnd
} from "@/features/call/model/slices/callSlice.js";
import type {RootState} from "@/store/store.ts";
import {logger} from "@/shared/logger/logger.ts";
import type {WebRTCService} from "@/features/call/service/webRTCService";
import {chatApi} from "@/features/chat/rest/chatApi.ts";
import type {ChatSummary} from "@/entities/conversation";
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
                        // Guard against glare / a stray second caller: only a truly idle client may
                        // start ringing. If we're already calling/ringing/connecting/in a call, decline
                        // the new offer (tell just that caller) instead of clobbering the active call's
                        // peerId/status. declineOffer does NOT touch our live pc/streams.
                        if ((getState() as RootState).call.status !== "idle") {
                            webRTCService.declineOffer(msg.from);
                            break;
                        }
                        dispatch(incomingOffer({from: msg.from, offer: msg.offer, media: msg.media}));
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
            const {peerId, audioOnly} = (action as PayloadAction<{ peerId: string; audioOnly?: boolean }>).payload;

            // A call frame needs a conversationId (resolved from the chat directory by counterpart id)
            // or the backend drops the SIGNAL_IN and the caller hangs on "calling" until the 30s
            // timeout. If there's no conversation with this peer, fail fast with a clear message.
            const st = getState() as RootState;
            const myId = st.user?.id;
            const summaries = chatApi.endpoints.getChats.select({myId})(st)?.data as ChatSummary[] | undefined;
            if (!summaries?.some((s) => s.counterpartId === peerId)) {
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