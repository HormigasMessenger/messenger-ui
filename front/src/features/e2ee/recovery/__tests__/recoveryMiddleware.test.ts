import {describe, it, expect, vi, beforeEach} from "vitest";

// The RECOVER_RESP handler: recovered items patch in, NACKed ids are marked lost — but ONLY from the peer we
// actually asked, for that chat, and never clobbering a message the same response just recovered. clientIds
// ride the frames in the clear, so an unauthenticated NACK from a third party must NOT force a false "lost".
const h = vi.hoisted(() => ({
    applyResponse: vi.fn(),
    savePlaintext: vi.fn(async () => {}),
    allPending: vi.fn(),
    removePending: vi.fn(async () => {}),
}));

vi.mock("../protocol.ts", async (orig) => ({
    ...(await orig<typeof import("../protocol.ts")>()),
    applyResponse: h.applyResponse, buildResponse: vi.fn(),
}));
vi.mock("../../lib/atRest.ts", () => ({savePlaintext: h.savePlaintext}));
vi.mock("../pendingStore.ts", () => ({
    allPending: h.allPending, removePending: h.removePending,
    addPending: vi.fn(async () => []), bumpAttempt: vi.fn(async () => {}),
}));
vi.mock("@/features/chat/rest/chatApi.ts", () => ({
    chatApi: {util: {updateQueryData: vi.fn((endpoint, args, recipe) => ({type: "uqd", endpoint, args, recipe}))}},
}));
vi.mock("@/shared/i18n", () => ({default: {t: (k: string) => k}}));

import {e2eeRecoveryMiddleware} from "../e2eeRecoveryMiddleware.ts";
import {RECOVER_RESP} from "../protocol.ts";

type Dispatched = {type: string; [k: string]: unknown};
// Fresh timestamps: within the 48h recovery window and recently requested, so the reconnect-triggered
// retry tick is a no-op and each test isolates the RECOVER_RESP handler.
const pend = (over: Record<string, unknown> = {}) => ({
    clientId: "c1", serverId: "s1", chatId: "chat", peerId: "bob", attempts: 1, lastAt: Date.now(), createdAt: Date.now(), ...over,
});

function harness() {
    const dispatched: Dispatched[] = [];
    const store = {
        dispatch: vi.fn((a: Dispatched) => { dispatched.push(a); return a; }),
        getState: vi.fn(() => ({user: {id: "me"}, ws: {status: "connected"}})),
    };
    const run = (frame: unknown) =>
        e2eeRecoveryMiddleware(store as never)(((a: unknown) => a) as never)({type: "ws/incoming", payload: frame});
    return {dispatched, run};
}
const flush = () => new Promise((r) => setTimeout(r, 0));
// Final text a given serverId settled on, after applying every getChatHistory patch recipe in order.
const textFor = (d: Dispatched[], serverId: string) => {
    const draft = [{id: serverId, text: "?", secret: false}];
    for (const a of d) if (a.type === "uqd" && a.endpoint === "getChatHistory") (a.recipe as (x: unknown[]) => void)(draft);
    return draft[0].text;
};
const resp = (over: Record<string, unknown> = {}) =>
    ({type: RECOVER_RESP, from: "bob", conversationId: "chat", items: [], missing: [], ...over});

beforeEach(() => {
    h.applyResponse.mockReset().mockResolvedValue([]);
    h.savePlaintext.mockClear();
    h.removePending.mockReset().mockResolvedValue(undefined);
    h.allPending.mockReset().mockResolvedValue([pend()]);
});

describe("recovery middleware — RECOVER_RESP handling", () => {
    it("marks a NACKed id lost when it comes from the asked peer + chat", async () => {
        const {dispatched, run} = harness();
        run(resp({missing: ["c1"]}));
        await flush();
        expect(textFor(dispatched, "s1")).toBe("chat.decryptLost");
        expect(h.removePending).toHaveBeenCalledWith("c1");
    });

    it("IGNORES a forged NACK from a different peer (no false lost, no removal)", async () => {
        const {dispatched, run} = harness();
        run(resp({from: "mallory", missing: ["c1"]}));
        await flush();
        expect(textFor(dispatched, "s1")).toBe("?");            // untouched
        expect(h.removePending).not.toHaveBeenCalled();
    });

    it("IGNORES a NACK whose conversation doesn't match the pending item", async () => {
        const {dispatched, run} = harness();
        run(resp({conversationId: "other", missing: ["c1"]}));
        await flush();
        expect(textFor(dispatched, "s1")).toBe("?");
        expect(h.removePending).not.toHaveBeenCalled();
    });

    it("recovered wins over a colliding missing entry (same id in both lists)", async () => {
        h.applyResponse.mockResolvedValue([{forClientId: "c1", plaintext: "hola"}]);
        const {dispatched, run} = harness();
        run(resp({items: [{mid: "c1", t: 3, b: "x"}], missing: ["c1"]}));
        await flush();
        expect(textFor(dispatched, "s1")).toBe("hola");         // NOT overwritten with "lost"
        expect(h.savePlaintext).toHaveBeenCalledWith("s1", "chat", "hola");
        expect(h.removePending).toHaveBeenCalledTimes(1);       // removed once, by the recovered path
    });
});
