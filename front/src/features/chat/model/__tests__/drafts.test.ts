import {describe, it, expect, beforeEach} from "vitest";
import {loadDraft, saveDraft, clearDraft, clearAllDrafts} from "../drafts";

describe("drafts (per-chat, localStorage)", () => {
    beforeEach(() => localStorage.clear());

    it("returns '' when there is no draft", () => {
        expect(loadDraft("c1")).toBe("");
    });

    it("round-trips a draft per chat, isolated from other chats", () => {
        saveDraft("c1", "hello");
        saveDraft("c2", "world");
        expect(loadDraft("c1")).toBe("hello");
        expect(loadDraft("c2")).toBe("world");
    });

    it("saving empty text removes the draft (no accumulation)", () => {
        saveDraft("c1", "typing…");
        saveDraft("c1", "");
        expect(loadDraft("c1")).toBe("");
        expect(localStorage.getItem("hormiga.drafts.v1")).toBe("{}");
    });

    it("clearDraft removes just that chat's draft", () => {
        saveDraft("c1", "a");
        saveDraft("c2", "b");
        clearDraft("c1");
        expect(loadDraft("c1")).toBe("");
        expect(loadDraft("c2")).toBe("b");
    });

    it("clearAllDrafts wipes everything (logout)", () => {
        saveDraft("c1", "a");
        saveDraft("c2", "b");
        clearAllDrafts();
        expect(loadDraft("c1")).toBe("");
        expect(loadDraft("c2")).toBe("");
    });

    it("ignores an empty chatId", () => {
        saveDraft("", "x");
        expect(loadDraft("")).toBe("");
    });
});
