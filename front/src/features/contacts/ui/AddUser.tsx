import {useEffect, useState} from "react";
import {useNavigate} from "react-router-dom";
import {useDispatch, useSelector} from "react-redux";

import type {AppDispatch, RootState} from "@/store/store.ts";
import {chatApi, useCreateChatMutation} from "@/features/chat/rest/chatApi.ts";
import {setSelectedChatId} from "@/features/chat/model/slices/chatUiSlice.ts";
import {idsDisplayName, useGetIdsUserQuery, useLazySearchIdsUsersQuery, type IdsUser} from "@/features/directory";
import {isNotLogged} from "@/shared/utils/checks.ts";
import {resolveChatPair} from "@/features/contacts/model/resolveChatPair.ts";
import {logger} from "@/shared/logger/logger.ts";
import toast from "react-hot-toast";
import {useTranslation} from "react-i18next";

function initials(name: string): string {
    const p = name.trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

const roleColor: Record<string, string> = {
    master: "bg-indigo-100 text-indigo-700",
    client: "bg-emerald-100 text-emerald-700",
    admin: "bg-amber-100 text-amber-700",
};

// Pick ONE person to chat with. The conversation is created between the current user and the
// picked one; client/master roles come from the IDS directory. (Chat creation is authorised by
// X-Admin-Key, sent by the API layer.) You must be logged in as a client/master to be a
// participant and see the chat — an admin identity is not a participant.
export default function AddContactPage() {
    const {t} = useTranslation();
    const myId = useSelector((s: RootState) => s.user.id);
    const dispatch = useDispatch<AppDispatch>();
    const [createChat, {isLoading: creating}] = useCreateChatMutation();
    const navigate = useNavigate();

    // Current user's own role (to assign client/master on the pair) — resolved by
    // id, so we don't download the whole directory just for this.
    const {data: me} = useGetIdsUserQuery(myId, {skip: isNotLogged(myId)});
    const myRole = (me?.role ?? "").toLowerCase();

    // The caller's conversations — to reuse an existing chat with a counterpart instead of minting
    // a second one (see startChat). Shares the cache with the chat list (RTK Query dedups).
    const {data: existingChats} = chatApi.useGetChatsQuery({myId}, {skip: isNotLogged(myId)});

    // Debounced, server-side, paginated search (IDS /users/search, pg_trgm) — no
    // full directory download, no client-side filtering.
    const MIN_CHARS = 2;
    const [query, setQuery] = useState("");
    const [debounced, setDebounced] = useState("");
    const [items, setItems] = useState<IdsUser[]>([]);
    const [nextToken, setNextToken] = useState<string | undefined>(undefined);
    const [runSearch, {isFetching, isError}] = useLazySearchIdsUsersQuery();

    useEffect(() => {
        const t = setTimeout(() => setDebounced(query.trim()), 300);
        return () => clearTimeout(t);
    }, [query]);

    useEffect(() => {
        if (debounced.length < MIN_CHARS) {
            setItems([]);
            setNextToken(undefined);
            return;
        }
        let cancelled = false;
        runSearch({q: debounced})
            .unwrap()
            .then((page) => {
                if (cancelled) return;
                setItems(page.users.filter((u) => u.id !== myId));
                setNextToken(page.nextToken);
            })
            .catch(() => { /* isError surfaces it */ });
        return () => { cancelled = true; };
    }, [debounced, myId, runSearch]);

    async function loadMore() {
        if (!nextToken) return;
        try {
            const page = await runSearch({q: debounced, pageToken: nextToken}).unwrap();
            setItems((prev) => [...prev, ...page.users.filter((u) => u.id !== myId)]);
            setNextToken(page.nextToken);
        } catch { /* keep current items */ }
    }

    async function startChat(other: IdsUser) {
        // Reuse an existing conversation with this counterpart if one is already in the list, in
        // EITHER role direction — don't mint a second one. This is what caused "two same-named chats":
        // a conversation is keyed by the ordered (clientId, masterId) tuple, so creating from the
        // opposite side (e.g. after the peer deleted it and the other party starts anew) with swapped
        // roles produced a distinct conversation for the same two people. Opening the existing one
        // (getChats maps counterpartId regardless of role) avoids the duplicate.
        const existing = existingChats?.find((s) => s.counterpartId === other.id);
        if (existing) {
            dispatch(setSelectedChatId(existing.conversationId));
            navigate("/");
            return;
        }

        // Deterministic (clientId, masterId) so a create from either side yields the same tuple and
        // createChat stays idempotent (no swapped-role duplicate). See resolveChatPair.
        const {clientId, masterId} = resolveChatPair(myId, myRole, other.id, other.role);
        try {
            const conv = await createChat({clientId, masterId, metadata: {}}).unwrap();
            // The pair may already exist and be soft-deleted for both sides (getChats hides it
            // until new activity revives it). Inject it into the list cache and open it directly,
            // so the user can send the first message — which revives the thread for both.
            const counterpartId = conv.clientId === myId ? conv.masterId : conv.clientId;
            dispatch(
                chatApi.util.updateQueryData("getChats", {myId}, (draft) => {
                    if (draft && !draft.some((s) => s.conversationId === conv.id)) {
                        draft.push({
                            conversationId: conv.id,
                            counterpartId,
                            orderId: conv.metadata?.orderId,
                            blocked: false,
                            blockedByMe: false,
                            blockedByPeer: false,
                        });
                    }
                })
            );
            dispatch(setSelectedChatId(conv.id));
            toast.success(t("addUser.chatOpened"));
            navigate("/");
        } catch (err) {
            const status = (err as {status?: number})?.status;
            logger.error("createChat failed", {status, err});
            toast.error(
                status === 409 ? t("addUser.createBlocked")
                    : status === 403 ? t("addUser.createForbidden")
                        : status === 400 ? t("addUser.createInvalid")
                            : t("addUser.createError")
            );
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-200/80 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6 flex flex-col gap-4">
                <h2 className="text-xl font-semibold text-center">{t("addUser.title")}</h2>

                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("addUser.searchPlaceholder")}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2
                    focus:outline-none focus:ring-2 focus:ring-teal-600"
                    autoFocus
                />

                <div className="max-h-80 overflow-y-auto flex flex-col gap-1.5">
                    {debounced.length < MIN_CHARS && (
                        <p className="text-sm text-gray-500 text-center py-4">{t("addUser.minChars", {n: MIN_CHARS})}</p>
                    )}
                    {debounced.length >= MIN_CHARS && isError && (
                        <p className="text-sm text-red-600 text-center py-4">{t("addUser.searchError")}</p>
                    )}
                    {debounced.length >= MIN_CHARS && !isError && !isFetching && items.length === 0 && (
                        <p className="text-sm text-gray-500 text-center py-4">{t("addUser.noResults")}</p>
                    )}
                    {items.map((u) => {
                        const name = idsDisplayName(u);
                        return (
                            <button
                                key={u.id}
                                onClick={() => startChat(u)}
                                disabled={creating}
                                className="flex items-center gap-3 border rounded-lg px-3 py-2
                                text-left hover:bg-gray-50 disabled:opacity-50"
                            >
                                <span className="w-9 h-9 rounded-full bg-teal-950 text-white text-sm
                                flex items-center justify-center shrink-0">{initials(name)}</span>
                                <span className="flex flex-col min-w-0 flex-1">
                                    <span className="font-medium truncate">
                                        {name}
                                        {u.verified && <span className="ml-1 text-teal-600" title={t("addUser.verified")}>✓</span>}
                                    </span>
                                    {u.email && <span className="text-xs text-gray-500 truncate">{u.email}</span>}
                                </span>
                                {u.role && (
                                    <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full shrink-0
                                    ${roleColor[u.role] ?? "bg-gray-100 text-gray-600"}`}>{u.role}</span>
                                )}
                            </button>
                        );
                    })}
                    {isFetching && <p className="text-sm text-gray-500 text-center py-2">{t("addUser.searching")}</p>}
                    {nextToken && !isFetching && (
                        <button
                            type="button"
                            onClick={loadMore}
                            className="text-sm text-teal-800 hover:underline py-2"
                        >
                            {t("addUser.showMore")}
                        </button>
                    )}
                </div>

                <button
                    onClick={() => navigate(-1)}
                    className="w-full border border-gray-300 py-2 rounded-lg hover:bg-gray-100 transition"
                >
                    {t("addUser.cancel")}
                </button>
            </div>
        </div>
    );
}
