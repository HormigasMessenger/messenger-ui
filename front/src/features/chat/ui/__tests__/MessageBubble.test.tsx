import {describe, it, expect, vi} from "vitest";
import {render} from "@testing-library/react";
import {MessageBubble, type ChatMessageView} from "../MessageBubble";

vi.mock("react-i18next", () => ({useTranslation: () => ({t: (k: string) => k})}));
// AttachmentImage does async URL resolution we don't need here.
vi.mock("../AttachmentImage.tsx", () => ({AttachmentImage: () => <span>img</span>}));

const ULID_A = "01KY29D4BHHB40EW2FKMHR6V7M";
const ULID_B = "01KY29D4BHHB40EW2FKMHR6V7N"; // > A lexicographically

const msg = (over: Partial<ChatMessageView> = {}): ChatMessageView => ({
    id: ULID_A, text: "hi", fromMe: true, createdAt: 1_700_000_000_000, ...over,
});

const renderBubble = (props: Partial<Parameters<typeof MessageBubble>[0]> = {}) =>
    render(<MessageBubble msg={msg()} bubbleMt="mt-3" peerLastReadId="" {...props} />).container;

describe("MessageBubble delivery/read indicator", () => {
    it("shows 🕐 while sending/pending", () => {
        expect(renderBubble({status: "sending"}).textContent).toContain("🕐");
        expect(renderBubble({status: "pending"}).textContent).toContain("🕐");
    });

    it("shows ⚠ + retry/discard on failure", () => {
        const c = renderBubble({status: "failed"});
        expect(c.textContent).toContain("⚠");
        expect(c.querySelectorAll("button").length).toBeGreaterThanOrEqual(2); // ↻ + 🗑
    });

    it("shows ✓✓ when the peer read boundary is at/after this message (ULID compare)", () => {
        const c = renderBubble({peerLastReadId: ULID_B}); // B >= A
        expect(c.textContent).toContain("✓✓");
    });

    it("shows single ✓ when the boundary is before this message", () => {
        const c = renderBubble({msg: msg({id: ULID_B}), peerLastReadId: ULID_A}); // A < B
        expect(c.textContent).toContain("✓");
        expect(c.textContent).not.toContain("✓✓");
    });

    it("does NOT show ✓✓ for a not-yet-reconciled temp (non-ULID) id, even with a boundary set", () => {
        const c = renderBubble({msg: msg({id: "temp-nanoid"}), peerLastReadId: ULID_B});
        expect(c.textContent).toContain("✓");
        expect(c.textContent).not.toContain("✓✓"); // isUlid guard prevents a false ✓✓
    });

    it("renders no tick for a peer's message (not fromMe)", () => {
        const c = renderBubble({msg: msg({fromMe: false}), peerLastReadId: ULID_B});
        expect(c.textContent).not.toContain("✓");
        expect(c.textContent).not.toContain("🕐");
    });
});

describe("MessageBubble discard / delete affordances", () => {
    it("a pending message can be discarded from the queue (🗑 → onDiscardMessage)", () => {
        const onDiscardMessage = vi.fn();
        const c = renderBubble({status: "pending", onDiscardMessage});
        const btn = c.querySelector("button[aria-label='chat.discard']") as HTMLButtonElement;
        expect(btn).toBeTruthy();
        btn.click();
        expect(onDiscardMessage).toHaveBeenCalledWith(ULID_A);
    });

    it("does NOT show the server-side delete on an un-sent (pending) message", () => {
        const c = renderBubble({status: "pending", onDeleteMessage: vi.fn(), onDiscardMessage: vi.fn()});
        expect(c.querySelector("button[aria-label='chat.deleteMessage']")).toBeNull();
    });

    it("shows the server-side delete only on an actually-sent message (no outbox status)", () => {
        const c = renderBubble({onDeleteMessage: vi.fn()}); // status undefined = sent/server row
        expect(c.querySelector("button[aria-label='chat.deleteMessage']")).toBeTruthy();
    });
});

describe("MessageBubble in a GROUP", () => {
    it("labels the author on a peer's bubble", () => {
        const c = renderBubble({msg: msg({fromMe: false, from: "u2"}), isGroup: true, authorName: "Alice"});
        expect(c.textContent).toContain("Alice");
    });

    it("does NOT label the author on my own bubble", () => {
        const c = renderBubble({msg: msg({fromMe: true, from: "me"}), isGroup: true, authorName: "Me"});
        expect(c.textContent).not.toContain("Me");
    });

    it("does NOT label the author in a 1:1 chat", () => {
        const c = renderBubble({msg: msg({fromMe: false, from: "u2"}), authorName: "Alice"});
        expect(c.textContent).not.toContain("Alice");
    });

    it("never shows ✓✓ in a group — no read-by-N aggregate (single ✓ even past a boundary)", () => {
        const c = renderBubble({isGroup: true, peerLastReadId: ULID_B}); // B >= A would be ✓✓ in 1:1
        expect(c.textContent).toContain("✓");
        expect(c.textContent).not.toContain("✓✓");
    });
});
