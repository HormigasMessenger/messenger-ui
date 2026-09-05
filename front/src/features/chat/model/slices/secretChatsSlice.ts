import {createSlice, type PayloadAction} from "@reduxjs/toolkit";

// Which conversations are in E2EE "secret" mode (opt-in, per conversation). A secret chat encrypts every
// message end-to-end; a normal chat is plaintext as before — the two never mix. Persisted to localStorage
// (the toggle must survive reloads) and cleared on logout, mirroring stickyChats.

const KEY = "hormiga.secretChats";

export function loadSecretChats(): Record<string, true> {
    try {
        const raw = localStorage.getItem(KEY);
        return raw ? (JSON.parse(raw) as Record<string, true>) : {};
    } catch { return {}; }
}
export function saveSecretChats(byId: Record<string, true>): void {
    try { localStorage.setItem(KEY, JSON.stringify(byId)); } catch { /* quota / unavailable */ }
}

interface SecretState { byId: Record<string, true> }
const initialState: SecretState = {byId: loadSecretChats()};

const secretChatsSlice = createSlice({
    name: "secretChats",
    initialState,
    reducers: {
        setSecret(state, action: PayloadAction<{conversationId: string; secret: boolean}>) {
            const {conversationId, secret} = action.payload;
            if (secret) state.byId[conversationId] = true;
            else delete state.byId[conversationId];
        },
        clearSecretChats(state) { state.byId = {}; },
    },
});

export const {setSecret, clearSecretChats} = secretChatsSlice.actions;
export default secretChatsSlice.reducer;
