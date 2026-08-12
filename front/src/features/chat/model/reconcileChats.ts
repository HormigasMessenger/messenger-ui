import type {ChatSummary} from "@/entities/conversation";

/** A row of GET /api/groups (the group list is its own resource, separate from DIRECT /api/chats). */
export type RawGroupListItem = {id: string; name?: string; memberCount?: number};

/**
 * Map a GET /api/groups row to a chat-list ChatSummary. Groups are a SEPARATE resource in the deployed
 * backend (not unioned into /api/chats), so the frontend merges these into the list itself.
 */
export function toGroupSummary(g: RawGroupListItem): ChatSummary {
    return {
        conversationId: g.id,
        kind: "group",
        counterpartId: "",
        name: g.name,
        memberIds: [],
        blocked: false,
        blockedByMe: false,
        blockedByPeer: false,
    };
}

/**
 * Raw backend Conversation (GET /api/chats). The list spans two domains merged server-side (ADR-024,
 * ChatLifecycle.listChats): DIRECT chats ∪ the caller's active GROUPS. A DIRECT row carries the
 * (clientId, masterId) pair; a GROUP row has a NULL pair, its name in metadata.name, and an empty roster
 * (the group's members are loaded per-group on open via GET /api/groups/{id}/members).
 */
export type RawConversation = {
    id: string;
    clientId: string | null;
    masterId: string | null;
    metadata?: Record<string, string> | null;
    clientBlocked?: boolean;
    masterBlocked?: boolean;
    clientReadReceipt?: string | null;
    masterReadReceipt?: string | null;
};

/**
 * Map one backend Conversation to the caller-relative chat-list item. Discriminates DIRECT vs GROUP by
 * the pair: a GROUP has a null clientId/masterId. Groups have no single counterpart (counterpartId ""),
 * no per-pair block (block in a group is per-sender at fan-out, not a conversation flag), and their name
 * comes from metadata.name; the roster is empty here (loaded on open).
 */
export function toChatSummary(c: RawConversation, myId: string): ChatSummary {
    const isGroup = c.clientId == null || c.masterId == null;
    if (isGroup) {
        return {
            conversationId: c.id,
            kind: "group",
            counterpartId: "",
            name: c.metadata?.name,
            memberIds: [],
            orderId: c.metadata?.orderId,
            blocked: false,
            blockedByMe: false,
            blockedByPeer: false,
        };
    }
    const amClient = c.clientId === myId;
    const blockedByMe = amClient ? Boolean(c.clientBlocked) : Boolean(c.masterBlocked);
    const blockedByPeer = amClient ? Boolean(c.masterBlocked) : Boolean(c.clientBlocked);
    return {
        conversationId: c.id,
        kind: "direct",
        counterpartId: (amClient ? c.masterId : c.clientId) as string,
        orderId: c.metadata?.orderId,
        blocked: blockedByMe || blockedByPeer,
        blockedByMe,
        blockedByPeer,
    };
}
