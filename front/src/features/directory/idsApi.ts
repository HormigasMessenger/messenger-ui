import {createApi, fetchBaseQuery} from "@reduxjs/toolkit/query/react";
import {IDS_ADMIN_KEY, MESSENGER_IDS_URL, PEOPLE_SEARCH_PATH} from "@/shared/config/api.ts";

// Absolute (origin-rooted) URL for the session-authed people-search route, so it
// escapes this api's admin base (MESSENGER_IDS_URL) via RTK's absolute-URL passthrough.
const peopleSearchUrl = (): string =>
    (typeof window !== "undefined" ? window.location.origin : "") + PEOPLE_SEARCH_PATH;

// IDS (KratosGate) identity directory, proxied by the edge at {VITE_IDS_URL}/users and gated by
// the Kratos session cookie; the admin key goes in X-Admin-Key. Cached once and shared across the
// app so names resolve everywhere (chat list + new-chat search), not only for online peers.
export type IdsUser = {
    id: string;
    email?: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
    locale?: string;
    role?: string;
    status?: string;
    verified?: boolean;
};

export function idsDisplayName(u: IdsUser): string {
    return (
        u.display_name?.trim() ||
        [u.first_name, u.last_name].filter(Boolean).join(" ").trim() ||
        u.email ||
        u.id
    );
}

export const idsApi = createApi({
    reducerPath: "idsApi",
    baseQuery: fetchBaseQuery({
        baseUrl: MESSENGER_IDS_URL,
        credentials: "include",
        prepareHeaders: (headers, {endpoint}) => {
            headers.set("Accept", "application/json");
            // people-search is session-authed (no admin key). Only the /ids/admin
            // directory lookups carry X-Admin-Key.
            if (endpoint !== "searchIdsUsers" && IDS_ADMIN_KEY) {
                headers.set("X-Admin-Key", IDS_ADMIN_KEY);
            }
            return headers;
        },
    }),
    endpoints: (builder) => ({
        // Loads the whole directory (used only for name resolution in the chat
        // list / calls). The NEW-CHAT picker uses searchIdsUsers instead so it
        // never downloads everyone.
        getIdsUsers: builder.query<IdsUser[], void>({
            query: () => "/users",
            transformResponse: (resp: unknown): IdsUser[] => {
                const users = (resp as { users?: unknown })?.users;
                return Array.isArray(users) ? (users as IdsUser[]) : [];
            },
        }),
        // Server-side, paginated type-ahead over name/email — the adaptive
        // people-search endpoint (POST /people/search), session-authed via the edge
        // (X-User-Id), no admin key. Keyset pagination: pass the previous page's
        // nextToken (the server's next_cursor) to get the next page. want_refinement
        // is off for now — the picker renders a flat list; wire the breadcrumb
        // refinement UI later. Arg/return shape is unchanged so callers don't move.
        searchIdsUsers: builder.query<
            { users: IdsUser[]; nextToken?: string; total: number },
            { q: string; pageToken?: string; pageSize?: number }
        >({
            query: ({q, pageToken, pageSize = 20}) => ({
                url: peopleSearchUrl(),
                method: "POST",
                body: {
                    query: q,
                    size: pageSize,
                    ...(pageToken ? {cursor: pageToken} : {}),
                    want_refinement: false,
                },
            }),
            transformResponse: (resp: unknown) => {
                const r = resp as { results?: unknown; next_cursor?: string | null; total?: number };
                return {
                    users: Array.isArray(r?.results) ? (r.results as IdsUser[]) : [],
                    nextToken: r?.next_cursor || undefined,
                    total: r?.total ?? 0,
                };
            },
        }),
        // A single user by id (used to resolve the current user's own role,
        // without downloading the whole directory).
        getIdsUser: builder.query<IdsUser | null, string>({
            query: (id) => `/users/${encodeURIComponent(id)}`,
            transformResponse: (resp: unknown): IdsUser | null =>
                resp && (resp as IdsUser).id ? (resp as IdsUser) : null,
        }),
        // Resolve only the given ids (e.g. the chat counterparts) into an
        // id -> user map, instead of downloading the whole directory. Fetches
        // each id in parallel through the same edge (session + X-Admin-Key);
        // missing ids are simply omitted. Pass a STABLE (sorted, de-duped) id
        // array so the RTK cache key is stable across re-renders.
        getIdsUsersByIds: builder.query<Record<string, IdsUser>, string[]>({
            async queryFn(ids, _api, _extra, baseQuery) {
                const unique = Array.from(new Set(ids.filter(Boolean)));
                if (unique.length === 0) return {data: {}};
                const results = await Promise.all(
                    unique.map((id) => baseQuery(`/users/${encodeURIComponent(id)}`))
                );
                const map: Record<string, IdsUser> = {};
                results.forEach((r, i) => {
                    const u = r.data as IdsUser | null | undefined;
                    if (u && u.id) map[unique[i]] = u;
                });
                return {data: map};
            },
        }),
    }),
});

export const {
    useGetIdsUsersQuery,
    useLazySearchIdsUsersQuery,
    useGetIdsUserQuery,
    useGetIdsUsersByIdsQuery,
} = idsApi;
