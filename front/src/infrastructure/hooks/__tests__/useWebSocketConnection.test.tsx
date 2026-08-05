import {describe, it, expect, beforeEach, afterEach} from "vitest";
import {renderHook} from "@testing-library/react";
import {createElement, type ReactNode} from "react";
import {Provider} from "react-redux";
import {configureStore} from "@reduxjs/toolkit";

import {useWebSocketConnection} from "../useWebSocketConnection";

function setVisibility(v: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", {configurable: true, get: () => v});
}

function makeHarness() {
    const actions: Array<{type: string}> = [];
    const recorder = () => (next: (a: unknown) => unknown) => (action: unknown) => {
        actions.push(action as {type: string});
        return next(action);
    };
    const store = configureStore({
        reducer: {user: (s = {id: "me"}) => s},
        middleware: (gDM) => gDM().concat(recorder),
    });
    const wrapper = ({children}: {children: ReactNode}) => createElement(Provider, {store, children});
    return {wrapper, actions};
}

const types = (a: Array<{type: string}>) => a.map((x) => x.type).filter((t) => t.startsWith("ws/"));

beforeEach(() => {
    setVisibility("visible");
    Object.defineProperty(navigator, "onLine", {configurable: true, get: () => true});
});
afterEach(() => setVisibility("visible"));

describe("useWebSocketConnection — go offline on suspend", () => {
    it("connects on mount", () => {
        const {wrapper, actions} = makeHarness();
        renderHook(() => useWebSocketConnection(), {wrapper});
        expect(types(actions)).toContain("ws/connect");
    });

    it("disconnects when the page is FROZEN (mobile background) so Web Push can take over", () => {
        const {wrapper, actions} = makeHarness();
        renderHook(() => useWebSocketConnection(), {wrapper});
        actions.length = 0;
        document.dispatchEvent(new Event("freeze"));
        expect(types(actions)).toEqual(["ws/disconnect"]);
    });

    it("disconnects on pagehide (Safari/iOS backgrounding)", () => {
        const {wrapper, actions} = makeHarness();
        renderHook(() => useWebSocketConnection(), {wrapper});
        actions.length = 0;
        window.dispatchEvent(new Event("pagehide"));
        expect(types(actions)).toEqual(["ws/disconnect"]);
    });

    it("reconnects on resume when visible + online", () => {
        const {wrapper, actions} = makeHarness();
        renderHook(() => useWebSocketConnection(), {wrapper});
        actions.length = 0;
        setVisibility("visible");
        document.dispatchEvent(new Event("resume"));
        expect(types(actions)).toContain("ws/connect");
    });

    it("a plain visibilitychange→visible reconnects, but does NOT itself disconnect", () => {
        const {wrapper, actions} = makeHarness();
        renderHook(() => useWebSocketConnection(), {wrapper});
        actions.length = 0;
        setVisibility("visible");
        document.dispatchEvent(new Event("visibilitychange"));
        expect(types(actions)).toContain("ws/connect");
        expect(types(actions)).not.toContain("ws/disconnect");
    });

    it("does not reconnect on wake while hidden", () => {
        const {wrapper, actions} = makeHarness();
        renderHook(() => useWebSocketConnection(), {wrapper});
        actions.length = 0;
        setVisibility("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
        expect(types(actions)).not.toContain("ws/connect");
    });
});
