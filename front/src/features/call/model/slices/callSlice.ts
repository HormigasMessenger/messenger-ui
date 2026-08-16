import {createSlice, type PayloadAction} from "@reduxjs/toolkit";
import type {FromOffer} from "@/features/call/model/types.ts";

const callSlice = createSlice({
  name: "call",
  initialState: {
    status: "idle" as "idle" | "ringing" | "calling" | "connecting" | "in_call",
    peerId: null as string | null,
    // Explicit conversationId for the outgoing call frame. Set only when we already know it (a call
    // deep-link from a push carries ?call=<conversationId>), so the frame doesn't depend on the chat
    // directory being loaded — otherwise a cold start from the notification races the getChats fetch.
    conversationId: null as string | null,
    incomingOfferData: null as FromOffer | null,
    // Current call is audio-only (voice) → the UI hides video and the service opens no camera.
    audioOnly: false,
  },
  reducers: {
    outgoingCall: (state, action: PayloadAction<{ peerId: string; audioOnly?: boolean; conversationId?: string }>) => {
      state.status = "calling";
      state.peerId = action.payload.peerId;
      state.conversationId = action.payload.conversationId ?? null;
      state.audioOnly = action.payload.audioOnly ?? false;
    },

    // Callee opened from a call push. Stash the conversationId (so the outgoing call:ready — and the
    // later answer/ice — route correctly even before getChats loads) but stay IDLE, so when the caller
    // re-offers we ring a real INCOMING dialog rather than auto-answering. peerId is used only by the
    // middleware (to address call:ready); we deliberately keep call state otherwise idle.
    answerViaPush: (state, action: PayloadAction<{ peerId: string; conversationId: string }>) => {
      state.conversationId = action.payload.conversationId;
    },

    incomingOffer: (state, action: PayloadAction<FromOffer>) => {
      state.status = "ringing";
      state.peerId = action.payload.from;
      state.incomingOfferData = action.payload; // 🔥 сохраняем offer
      state.audioOnly = action.payload.media === "audio";
    },

    acceptCall: (state) => {
      state.status = "connecting";
    },

    incomingAnswer: (state) => {
      state.status = "connecting";
    },

    webrtcConnected: (state) => {
      state.status = "in_call";
    },

    incomingRemoteEnd: (state) => {
      state.status = "idle";
      state.peerId = null;
      state.conversationId = null;
      state.incomingOfferData = null;
      state.audioOnly = false;
    },

    rejectCall: (state) => {
      state.status = "idle";
      state.peerId = null;
      state.conversationId = null;
      state.incomingOfferData = null;
      state.audioOnly = false;
    },


    localEnd: (state) => {
      state.status = "idle";
      state.peerId = null;
      state.conversationId = null;
      state.incomingOfferData = null;
      state.audioOnly = false;
    },
  },
});

export const {
  outgoingCall,
  answerViaPush,
  incomingOffer,
  acceptCall,
  incomingAnswer,
  webrtcConnected,
  incomingRemoteEnd,
  localEnd,
  rejectCall
} = callSlice.actions;

export default callSlice.reducer;