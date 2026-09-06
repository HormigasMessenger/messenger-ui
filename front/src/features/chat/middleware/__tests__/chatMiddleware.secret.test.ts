import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";

// The SECRET (E2EE) live-delivery path of chatMiddleware: durable dedup by server id / client id, and the
// classify-then-recover behavior added for reviewer #2 — a recoverable gap on the live path now goes to
// client-to-client recovery immediately (was: dead-ended at "unavailable" until a later history reload).

const h = vi.hoisted(() => ({
    decryptReceived: vi.fn(),
    loadPlaintext: vi.fn(),
    savePlaintext: vi.fn(),
    reportUndecryptable: vi.fn((payload: unknown) => ({type: "e2ee/reportUndecryptable", payload})),
}));

vi.mock("@/features/chat/rest/chatApi.ts", () => ({
    chatApi: {
        util: {updateQueryData: vi.fn((endpoint, args, recipe) => ({type: "test/updateQueryData", endpoint, args, recipe}))},
        endpoints: {getChats: {select: vi.fn(() => () => ({data: [{conversationId: "c1"}]}))}},
    },
}));
vi.mock("@/features/groups/rest/groupApi.ts", () => ({
    groupApi: {endpoints: {getGroups: {select: vi.fn(() => () => ({data: []})), initiate: vi.fn(() => ({type: "x"}))}}},
}));
vi.mock("@/features/chat/model/services/chatMessages.service.ts", () => ({chatMessagesService: {refetchChatsPreservingSelected: vi.fn()}}));
vi.mock("@/shared/sound/notify.ts", () => ({playNotificationSound: vi.fn()}));
vi.mock("@/features/notifications/desktopNotification.ts", () => ({showDesktopNotification: vi.fn()}));
vi.mock("@/shared/i18n", () => ({default: {t: (k: string) => k}}));

// The seam: real marker logic for isSecretEnvelope, mocked ratchet for decryptReceived.
vi.mock("@/features/e2ee/lib/secretChat.ts", () => ({
    isSecretEnvelope: (b?: string) => !!b && b.startsWith("E2EE1:"),
    decryptReceived: h.decryptReceived,
}));
vi.mock("@/features/e2ee/lib/atRest.ts", () => ({
    savePlaintext: h.savePlaintext, loadPlaintext: h.loadPlaintext, E2EE_PLAINTEXT_TTL_MS: 172_800_000,
}));
vi.mock("@/features/e2ee", () => ({reportUndecryptable: h.reportUndecryptable}));
// failure.ts is the REAL module (pure) — the classify/recoverable logic under test.

import {chatMiddleware} from "../chatMiddleware";

const SERVER_ID = "01KY29D4BHHB40EW2FKMHR6V7M";
const CLIENT_ID = "nano_abc123";
type Dispatched = {type: string; [k: string]: unknown};

function harness(selectedChatId: string | null) {
    const dispatched: Dispatched[] = [];
    const store = {
        dispatch: vi.fn((a: Dispatched) => { dispatched.push(a); return a; }),
        getState: vi.fn(() => ({user: {id: "me"}, chatUi: {selectedChatId}})),
    };
    const next = vi.fn((a) => a);
    const run = (frame: unknown) => chatMiddleware(store as never)(next as never)({type: "ws/incoming", payload: frame});
    return {dispatched, run};
}
const flush = () => new Promise((r) => setTimeout(r, 0));
// Apply the LAST getChatHistory recipe to a one-row draft → the text the path settled on.
const settledText = (d: Dispatched[]) => {
    const recipes = d.filter((a) => a.type === "test/updateQueryData" && a.endpoint === "getChatHistory");
    const draft = [{id: SERVER_ID, text: "?"}];
    for (const r of recipes) (r.recipe as (x: unknown[]) => void)(draft);
    return draft[0].text;
};

const secretOut = (over: Record<string, unknown> = {}) => ({
    type: "CHAT_OUT", messageId: SERVER_ID, correlationId: CLIENT_ID, conversationId: "c1",
    senderId: "peer", recipientId: "me", serverTimestamp: 1_700_000_000_000,
    payload: {body: "E2EE1:opaque", kind: "text"}, ...over,
});

beforeEach(() => {
    Object.defineProperty(document, "hidden", {configurable: true, get: () => false});
    h.decryptReceived.mockReset(); h.loadPlaintext.mockReset(); h.savePlaintext.mockReset(); h.reportUndecryptable.mockClear();
    h.loadPlaintext.mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe("chatMiddleware — secret live path", () => {
    it("decrypts and stashes under BOTH server id and client id (so a resend dedups)", async () => {
        h.decryptReceived.mockResolvedValue("hola");
        const {dispatched, run} = harness("c1");
        run(secretOut());
        await flush();
        expect(settledText(dispatched)).toBe("hola");
        expect(h.savePlaintext).toHaveBeenCalledWith(SERVER_ID, "c1", "hola");
        expect(h.savePlaintext).toHaveBeenCalledWith(CLIENT_ID, "c1", "hola");
    });

    it("durable dedup: a stored copy is reused and the ratchet is never touched", async () => {
        h.loadPlaintext.mockResolvedValueOnce("from-at-rest");   // first check (by server id) hits
        const {dispatched, run} = harness("c1");
        run(secretOut());
        await flush();
        expect(settledText(dispatched)).toBe("from-at-rest");
        expect(h.decryptReceived).not.toHaveBeenCalled();        // one-shot ratchet protected
    });

    it("recoverable gap → shows 'pending' AND triggers client-to-client recovery", async () => {
        h.decryptReceived.mockRejectedValue(new Error("Over 2000 messages into the future!"));
        const {dispatched, run} = harness("c1");
        run(secretOut());
        await flush();
        expect(settledText(dispatched)).toBe("chat.decryptPending");
        expect(h.reportUndecryptable).toHaveBeenCalledWith({
            chatId: "c1", peerId: "peer", items: [{clientId: CLIENT_ID, serverId: SERVER_ID}],
        });
    });

    it("corrupt frame → 'unavailable', no recovery request", async () => {
        h.decryptReceived.mockRejectedValue(new Error("e2ee: not an envelope"));
        const {dispatched, run} = harness("c1");
        run(secretOut());
        await flush();
        expect(settledText(dispatched)).toBe("chat.decryptUnavailable");
        expect(h.reportUndecryptable).not.toHaveBeenCalled();
    });

    it("no clientId to correlate → 'unavailable', no recovery request", async () => {
        h.decryptReceived.mockRejectedValue(new Error("Over 2000 messages into the future!"));
        const {dispatched, run} = harness("c1");
        run(secretOut({correlationId: undefined}));
        await flush();
        expect(settledText(dispatched)).toBe("chat.decryptUnavailable");
        expect(h.reportUndecryptable).not.toHaveBeenCalled();
    });
});
