import {createSlice, type PayloadAction} from "@reduxjs/toolkit";
import type {FromOffer} from "@/features/call/model/types.ts";

const callSlice = createSlice({
  name: "call",
  initialState: {
    status: "idle" as "idle" | "ringing" | "calling" | "connecting" | "in_call",
    peerId: null as string | null,
    incomingOfferData: null as FromOffer | null,
    // Current call is audio-only (voice) → the UI hides video and the service opens no camera.
    audioOnly: false,
  },
  reducers: {
    outgoingCall: (state, action: PayloadAction<{ peerId: string; audioOnly?: boolean }>) => {
      state.status = "calling";
      state.peerId = action.payload.peerId;
      state.audioOnly = action.payload.audioOnly ?? false;
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
      state.incomingOfferData = null;
      state.audioOnly = false;
    },

    rejectCall: (state) => {
      state.status = "idle";
      state.peerId = null;
      state.incomingOfferData = null;
      state.audioOnly = false;
    },


    localEnd: (state) => {
      state.status = "idle";
      state.peerId = null;
      state.incomingOfferData = null;
      state.audioOnly = false;
    },
  },
});

export const {
  outgoingCall,
  incomingOffer,
  acceptCall,
  incomingAnswer,
  webrtcConnected,
  incomingRemoteEnd,
  localEnd,
  rejectCall
} = callSlice.actions;

export default callSlice.reducer;