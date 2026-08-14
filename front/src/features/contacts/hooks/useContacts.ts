import {useSelector} from "react-redux";
import type {RootState} from "@/store/store.ts";
import {useGetChatsQuery} from "@/features/chat/rest/chatApi.ts";
import type {ChatSummary} from "@/entities/conversation";
import type {Contact} from "@/entities/contact";
import {isNotLogged} from "@/shared/utils/checks.ts";
import {idsDisplayName, useGetIdsUsersByIdsQuery} from "@/features/directory";
import {useGetGroupsQuery} from "@/features/groups";
import {toGroupSummary} from "@/features/chat/model/reconcileChats.ts";
import {useMemo} from "react";
import {useTranslation} from "react-i18next";

export function useContacts() {
    const {t} = useTranslation();
    const myId = useSelector((state: RootState) => state.user.id);
    const presence = useSelector((state: RootState) => state.presence.byId);
    const skip = isNotLogged(myId);

    // The chat list spans TWO resources in the deployed backend (variant A — separate, not unioned):
    // DIRECT chats (GET /api/chats) and GROUPS (GET /api/groups). Fetch both and merge.
    const {data: directSummaries = [], isLoading: chatsLoading, isError} = useGetChatsQuery({myId}, {skip});
    const {data: groupItems = [], isLoading: groupsLoading} = useGetGroupsQuery(undefined, {skip});
    const isLoading = chatsLoading || groupsLoading;
    // Sticky DIRECT chats the user engaged with but the backend hides (empty → omitted from
    // /api/chats). Merge in only those NOT already returned by the backend (a chat with activity comes
    // from getChats and wins). Groups aren't stickied (getGroups already lists them all).
    const sticky = useSelector((state: RootState) => state.stickyChats.byId);
    const summaries = useMemo(() => {
        const backendIds = new Set(directSummaries.map((s) => s.conversationId));
        const stickyExtra = Object.values(sticky).filter((s) => !backendIds.has(s.conversationId));
        return [...directSummaries, ...stickyExtra, ...groupItems.map(toGroupSummary)];
    }, [directSummaries, groupItems, sticky]);

    // Resolve only the 1:1 chat counterparts by id (stable, de-duped key). Groups carry no counterpart
    // (counterpartId ""), so they're excluded — a group's name comes from its own summary.
    const counterpartIds = useMemo(
        () => Array.from(new Set(
            summaries.filter((s) => s.kind !== "group").map((s) => s.counterpartId)
        )).sort(),
        [summaries]
    );
    const {data: idsById = {}} = useGetIdsUsersByIdsQuery(counterpartIds, {
        skip: skip || counterpartIds.length === 0,
    });

    // Names resolve from the IDS directory (all users), then presence (online peers), then the
    // order label / identity id. Online status comes from presence (PRESENT_* frames). A GROUP renders
    // from its own summary: its name, a group kind, and no presence (no single peer).
    const contacts = useMemo<Contact[]>(
        () => summaries.map((s) => {
            if (s.kind === "group") {
                return {
                    id: s.conversationId,
                    kind: "group" as const,
                    name: s.name || t("chat.group"),
                    last: "",
                    email: "",
                    online: false,
                };
            }
            const ids = idsById[s.counterpartId];
            const p = presence[s.counterpartId];
            const name =
                (ids ? idsDisplayName(ids) : undefined) ||
                p?.name ||
                (s.orderId ? `Order ${s.orderId}` : s.counterpartId);
            return {
                id: s.conversationId,
                kind: "direct" as const,
                name,
                last: "",
                email: ids?.email || p?.email || s.counterpartId,
                online: p?.online ?? false,
            };
        }),
        [summaries, presence, idsById, t]
    );

    const getContactById = useMemo(
        () => (id: string): Contact | null => contacts.find(c => c.id === id) ?? null,
        [contacts]
    );

    const getContactByName = useMemo(
        () => (name: string): Contact | null => contacts.find(c => c.name === name) ?? null,
        [contacts]
    );

    const getSummary = useMemo(
        () => (conversationId: string): ChatSummary | null =>
            summaries.find(s => s.conversationId === conversationId) ?? null,
        [summaries]
    );

    return {
        contacts,
        summaries,
        getContactById,
        getContactByName,
        getSummary,
        // back-compat aliases for existing consumers
        isLoadingIds: isLoading,
        isLoadingUsers: false,
        isErrorIds: isError,
        isErrorUsers: false,
    };
}