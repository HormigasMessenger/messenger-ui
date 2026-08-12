import {useSelector} from "react-redux";
import type {RootState} from "@/store/store.ts";
import {useGetChatsQuery} from "@/features/chat/rest/chatApi.ts";
import type {ChatSummary} from "@/entities/conversation";
import type {Contact} from "@/entities/contact";
import {isNotLogged} from "@/shared/utils/checks.ts";
import {idsDisplayName, useGetIdsUsersByIdsQuery} from "@/features/directory";
import {useMemo} from "react";
import {useTranslation} from "react-i18next";

export function useContacts() {
    const {t} = useTranslation();
    const myId = useSelector((state: RootState) => state.user.id);
    const presence = useSelector((state: RootState) => state.presence.byId);
    const skip = isNotLogged(myId);

    const {data: summaries = [], isLoading, isError} = useGetChatsQuery({myId}, {skip});

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