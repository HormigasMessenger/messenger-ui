import {useEffect, useMemo, useState} from "react";
import {useNavigate} from "react-router-dom";
import {useDispatch, useSelector} from "react-redux";
import toast from "react-hot-toast";
import {useTranslation} from "react-i18next";

import type {AppDispatch, RootState} from "@/store/store.ts";
import {setSelectedChatId} from "@/features/chat/model/slices/chatUiSlice.ts";
import {idsDisplayName, useLazySearchIdsUsersQuery, type IdsUser} from "@/features/directory";
import {isNotLogged} from "@/shared/utils/checks.ts";
import {useCreateGroupMutation} from "../rest/groupApi.ts";

const initials = (name: string) => {
    const p = name.trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
};

/**
 * Create a GROUP chat: name it and pick ≥1 member from the IDS directory (same debounced server-side
 * search as AddUser). POST /api/groups → the backend mints the group; we open it (createGroup
 * invalidates the chat list so the new group appears). 422 = too few members, 413 = over the size cap.
 */
export default function CreateGroup() {
    const {t} = useTranslation();
    const myId = useSelector((s: RootState) => s.user.id);
    const dispatch = useDispatch<AppDispatch>();
    const navigate = useNavigate();
    const [createGroup, {isLoading: creating}] = useCreateGroupMutation();

    const [name, setName] = useState("");
    const [query, setQuery] = useState("");
    const [debounced, setDebounced] = useState("");
    const [items, setItems] = useState<IdsUser[]>([]);
    const [selected, setSelected] = useState<Record<string, IdsUser>>({});
    const [runSearch, {isFetching, isError}] = useLazySearchIdsUsersQuery();

    const MIN_CHARS = 2;
    useEffect(() => {
        const h = setTimeout(() => setDebounced(query.trim()), 300);
        return () => clearTimeout(h);
    }, [query]);

    useEffect(() => {
        if (debounced.length < MIN_CHARS) return;   // too short → the render gates the list to []
        let cancelled = false;
        runSearch({q: debounced}).unwrap()
            .then((page) => { if (!cancelled) setItems(page.users.filter((u) => u.id !== myId)); })
            .catch(() => { /* isError surfaces it */ });
        return () => { cancelled = true; };
    }, [debounced, myId, runSearch]);

    const selectedList = useMemo(() => Object.values(selected), [selected]);
    const visible = debounced.length < MIN_CHARS ? [] : items;

    const toggle = (u: IdsUser) => setSelected((prev) => {
        const next = {...prev};
        if (next[u.id]) delete next[u.id]; else next[u.id] = u;
        return next;
    });

    async function create() {
        if (selectedList.length < 1 || creating) return;
        try {
            const group = await createGroup({
                memberIds: selectedList.map((u) => u.id),
                name: name.trim() || undefined,
            }).unwrap();
            dispatch(setSelectedChatId(group.id));
            navigate("/");
        } catch (e) {
            const status = (e as {status?: number})?.status;
            toast.error(
                status === 413 ? t("group.tooManyMembers")
                    : status === 422 ? t("group.tooFewMembers")
                    : t("group.createError"),
            );
        }
    }

    if (isNotLogged(myId)) return null;

    return (
        <div className="min-h-dvh flex flex-col bg-gray-200">
            <div className="bg-teal-950 text-white px-4 py-3 flex items-center gap-3">
                <button onClick={() => navigate("/")} aria-label={t("chat.back")} className="text-xl">←</button>
                <span className="font-semibold">{t("group.newGroup")}</span>
            </div>

            <div className="p-4 flex flex-col gap-3 flex-1 min-h-0">
                <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("group.namePlaceholder")}
                    className="rounded-full px-4 py-2 bg-white border focus:outline-none"
                />

                {/* Selected chips */}
                {selectedList.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {selectedList.map((u) => (
                            <button key={u.id} onClick={() => toggle(u)}
                                    className="flex items-center gap-1 bg-teal-100 text-teal-900 rounded-full pl-3 pr-2 py-1 text-sm">
                                {idsDisplayName(u)} <span className="opacity-60">✕</span>
                            </button>
                        ))}
                    </div>
                )}

                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("group.searchMembers")}
                    className="rounded-full px-4 py-2 bg-white border focus:outline-none"
                />

                <div className="flex-1 overflow-y-auto rounded-lg bg-white">
                    {isError && <div className="p-3 text-sm text-red-700">{t("chat.searchError", {defaultValue: "Search failed"})}</div>}
                    {isFetching && visible.length === 0 && <div className="p-3 text-sm text-gray-500">…</div>}
                    {visible.map((u) => {
                        const picked = !!selected[u.id];
                        return (
                            <div key={u.id} onClick={() => toggle(u)}
                                 className={`p-3 flex items-center gap-3 cursor-pointer hover:bg-gray-100 ${picked ? "bg-teal-50" : ""}`}>
                                <span className="w-10 h-10 rounded-full bg-teal-950 text-white text-sm flex items-center justify-center">
                                    {initials(idsDisplayName(u))}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate font-medium text-gray-800">{idsDisplayName(u)}</div>
                                    <div className="truncate text-sm text-gray-500">{u.email}</div>
                                </div>
                                <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-xs ${picked ? "bg-teal-700 text-white border-teal-700" : "border-gray-400"}`}>
                                    {picked ? "✓" : ""}
                                </span>
                            </div>
                        );
                    })}
                </div>

                <button
                    onClick={create}
                    disabled={selectedList.length < 1 || creating}
                    className="bg-teal-950 text-white rounded-full py-3 font-medium disabled:opacity-50"
                >
                    {creating ? t("loading") : t("group.create", {n: selectedList.length})}
                </button>
            </div>
        </div>
    );
}
