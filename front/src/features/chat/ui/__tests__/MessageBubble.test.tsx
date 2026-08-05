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
