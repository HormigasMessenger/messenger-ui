// The Conversation entity: the frontend chat-list item, derived from the backend Conversation
// relative to the caller. Shared across features (chat, contacts, call, the WS transport), so it
// lives in the entities layer rather than inside any one feature's api.

/** Frontend chat-list item derived from a backend Conversation, relative to the caller. */
export type ChatSummary = {
    conversationId: string;
    counterpartId: string;
    orderId?: string;
    blocked: boolean;        // either side blocked → sending is impossible (block is mutual/terminal)
    blockedByMe: boolean;    // I blocked the peer (I can unblock)
    blockedByPeer: boolean;  // the peer blocked me (I can't unblock their side)
};
