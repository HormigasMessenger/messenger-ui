import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useContacts } from "../../../contacts/hooks/useContacts.ts";
import { useSelector } from "react-redux";
import { useGetChatsQuery } from "@/features/chat/rest/chatApi";
import { useGetIdsUsersByIdsQuery } from "@/features/directory/idsApi";

// useContacts now derives the chat list from GET /chats (ChatSummary[]) and resolves counterpart
// names via the IDS directory by id (useGetIdsUsersByIdsQuery), with presence as a fallback.
// useSelector is stubbed against a fake state so the hook's myId / presence selectors resolve.
const fakeState = { user: { id: "user1" }, presence: { byId: {} } };

vi.mock("react-i18next", () => ({useTranslation: () => ({t: (k: string) => k})}));
vi.mock("react-redux", () => ({
    useSelector: vi.fn((sel: (s: unknown) => unknown) => sel(fakeState)),
}));
vi.mock("@/features/chat/rest/chatApi", () => ({ useGetChatsQuery: vi.fn() }));
vi.mock("@/features/directory/idsApi", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/features/directory/idsApi")>();
    return { ...actual, useGetIdsUsersByIdsQuery: vi.fn() };
});

describe("useContacts", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useSelector as unknown as Mock).mockImplementation(
            (sel: (s: unknown) => unknown) => sel(fakeState)
        );
    });

    it("returns empty contacts while the chat list is loading", () => {
        (useGetChatsQuery as unknown as Mock).mockReturnValue({ data: [], isLoading: true, isError: false });
        (useGetIdsUsersByIdsQuery as unknown as Mock).mockReturnValue({ data: {} });

        const { result } = renderHook(() => useContacts());

        expect(result.current.contacts).toEqual([]);
    });

    it("maps summaries to contacts keyed by conversationId, resolving names by counterpart id", () => {
        (useGetChatsQuery as unknown as Mock).mockReturnValue({
            data: [{ conversationId: "c1", counterpartId: "user2", blocked: false }],
            isLoading: false,
            isError: false,
        });
        (useGetIdsUsersByIdsQuery as unknown as Mock).mockReturnValue({
            data: { user2: { id: "user2", first_name: "Bob" } },
        });

        const { result } = renderHook(() => useContacts());

        expect(result.current.contacts).toEqual([
            { id: "c1", kind: "direct", name: "Bob", last: "", email: "user2", online: false },
        ]);
        expect(result.current.getContactById("c1")?.name).toBe("Bob");
        expect(result.current.getContactByName("Bob")?.id).toBe("c1");
        expect(result.current.getSummary("c1")?.counterpartId).toBe("user2");
    });

    it("falls back to the counterpart id as name when the directory has no entry", () => {
        (useGetChatsQuery as unknown as Mock).mockReturnValue({
            data: [{ conversationId: "c2", counterpartId: "user9", blocked: false }],
            isLoading: false,
            isError: false,
        });
        (useGetIdsUsersByIdsQuery as unknown as Mock).mockReturnValue({ data: {} });

        const { result } = renderHook(() => useContacts());

        expect(result.current.contacts).toEqual([
            { id: "c2", kind: "direct", name: "user9", last: "", email: "user9", online: false },
        ]);
    });

    it("maps a GROUP summary to a group contact (name from summary, no presence, no IDS lookup)", () => {
        (useGetChatsQuery as unknown as Mock).mockReturnValue({
            data: [{conversationId: "g1", kind: "group", counterpartId: "", name: "Squad", blocked: false}],
            isLoading: false,
            isError: false,
        });
        (useGetIdsUsersByIdsQuery as unknown as Mock).mockReturnValue({data: {}});

        const {result} = renderHook(() => useContacts());

        expect(result.current.contacts).toEqual([
            {id: "g1", kind: "group", name: "Squad", last: "", email: "", online: false},
        ]);
    });

    it("surfaces the chat-list error flag", () => {
        (useGetChatsQuery as unknown as Mock).mockReturnValue({ data: [], isLoading: false, isError: true });
        (useGetIdsUsersByIdsQuery as unknown as Mock).mockReturnValue({ data: {} });

        const { result } = renderHook(() => useContacts());

        expect(result.current.isErrorIds).toBe(true);
        expect(result.current.contacts).toEqual([]);
    });
});
