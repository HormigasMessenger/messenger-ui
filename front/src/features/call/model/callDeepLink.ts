/**
 * Parse a call-back deep link from a push notification's URL params. The SW (public/push-sw.js) builds
 *   ?call=<conversationId>&caller=<callerUserId>
 * on an incoming-call notification tap. We call the caller back (the original WebRTC offer is stale by
 * the time the app opens), and we already KNOW the conversationId here — so it must be carried into the
 * call, or a cold start (getChats not loaded yet) fails the "do we have a conversation?" guard and shows
 * "open a chat with this contact first". Returns null when the params aren't a complete call link.
 */
export function parseCallDeepLink(params: URLSearchParams): { peerId: string; conversationId: string } | null {
    const conversationId = params.get("call");
    const peerId = params.get("caller");
    if (!conversationId || !peerId) return null;
    return { peerId, conversationId };
}
