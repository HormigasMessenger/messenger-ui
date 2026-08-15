import {describe, it, expect, vi, beforeEach} from "vitest";
import {configureStore, type Reducer} from "@reduxjs/toolkit";
import toast from "react-hot-toast";
import {authErrorListener} from "../authErrorMiddleware";
import userReducer from "@/features/auth/slices/userSlice.ts";

vi.mock("react-hot-toast", () => ({default: {error: vi.fn()}}));
vi.mock("@/shared/i18n", () => ({default: {t: (k: string) => k}}));

// A rejected-with-value action shaped like an RTK Query failure with an HTTP status.
const rejected = (status: number) => ({
    type: "chatApi/executeQuery/rejected",
    payload: {status},
    meta: {requestStatus: "rejected", rejectedWithValue: true, requestId: "r", arg: undefined, aborted: false, condition: false},
    error: {message: "Rejected"},
});

function makeStore(userId: string) {
    const seen: string[] = [];
    const recorder: Reducer<Record<string, never>> = (state = {}, action) => { seen.push(action.type); return state; };
    const store = configureStore({
        reducer: {user: userReducer, rec: recorder},
        middleware: (gDM) => gDM().prepend(authErrorListener.middleware),
        preloadedState: {user: {id: userId, name: userId, initialized: true}},
    });
    return {store, seen};
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("authErrorMiddleware", () => {
    beforeEach(() => vi.mocked(toast.error).mockClear());

    it("on a 401 (logged in): toast once + clearUser + ws/disconnect", async () => {
        const {store, seen} = makeStore("u1");
        store.dispatch(rejected(401));
        await tick();
        expect(seen).toContain("user/clearUser");
        expect(seen).toContain("ws/disconnect");
        expect(toast.error).toHaveBeenCalledTimes(1);
    });

    it("is a no-op on a 401 when already logged out (guard)", async () => {
        const {store, seen} = makeStore("Anonimo"); // isNotLogged sentinel
        store.dispatch(rejected(401));
        await tick();
        expect(seen).not.toContain("user/clearUser");
        expect(toast.error).not.toHaveBeenCalled();
    });

    it("ignores a non-401 rejection", async () => {
        const {store, seen} = makeStore("u1");
        store.dispatch(rejected(500));
        await tick();
        expect(seen).not.toContain("user/clearUser");
        expect(toast.error).not.toHaveBeenCalled();
    });
});
