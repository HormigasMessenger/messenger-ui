import {useCallback, useEffect, useMemo} from "react";
import {useDispatch, useSelector} from "react-redux";
import {skipToken} from "@reduxjs/toolkit/query/react";

import {chatApi} from "@/features/chat/rest/chatApi";
import {toChatMessageView} from "@/features/chat/model/mapper";
import type {AppDispatch, RootState} from "@/store/store";
import type {ChatMessage} from "@/features/chat/model/schema/domainChatMessage.schema";
import {chatMessagesService} from "@/features/chat/model/services/chatMessages.service";
import {logger} from "@/shared/logger/logger";

export function useChatMessages() {
    const myId = useSelector((state: RootState) => state.user.id);
    const dispatch = useDispatch<AppDispatch>();

    /* ======================
       Selected chat (global)
    ====================== */
    const selectedChatId = useSelector(
        (state: RootState) => state.chatUi.selectedChatId
    );

    /* ======================
       RTK Query: history — a group is fetched the SAME way as any conversation (its id IS a
       conversation id). getChatHistory maps a 404 (a conversation with no message backing yet) to an
       empty list, so it never leaves RTK's `data` holding the PREVIOUS chat's rows.
    ====================== */
    const {data = [], isLoading, isError, error} = chatApi.useGetChatHistoryQuery(
        selectedChatId ? {myId, chatId: selectedChatId} : skipToken
    );

    // Surface, don't swallow: a server error loading history used to fall back to an empty list,
    // indistinguishable from a genuinely empty chat and with no log. Log it and expose isError so
    // the UI can show a retryable error state instead of a silent "empty" window.
    useEffect(() => {
        if (isError) logger.error("getChatHistory failed", {chatId: selectedChatId, error});
    }, [isError, error, selectedChatId]);

    const [deleteHistory] = chatApi.useDeleteChatHistoryMutation();

    /* ======================
       Reload (force refetch)
    ====================== */
    const reloadChatHistory = useCallback(
        async () => {
            chatMessagesService.reloadChatHistory(dispatch, myId, selectedChatId);
        },
        [dispatch, myId, selectedChatId]
    );

    /* ======================
       Handle incoming WS message
       (patch RTK Query cache)
    ====================== */
    const handleIncomingMessage = useCallback(
        (msg: ChatMessage) => {
            chatMessagesService.incomingMessage(dispatch, myId, msg);
        },
        [dispatch, myId]
    );

    /* ======================
       Clear chat
    ====================== */
    const clearChat = useCallback(
        async () => {
            await chatMessagesService.clearChatHistory(dispatch, deleteHistory, myId, selectedChatId);
        },
        [deleteHistory, myId, selectedChatId, dispatch]
    );

    /* ======================
       View mapping (memoized: a fresh array every render made ChatWindow's
       scroll effect fire on every render and forced a full list reconcile).
       Sorted by createdAt so display order is chronological even if a WS frame
       arrives out of order or history isn't pre-sorted by the backend.
    ====================== */
    const messages = useMemo(
        () =>
            [...data]
                .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
                .map((msg) => toChatMessageView(msg, myId)),
        [data, myId]
    );

    return {
        messages,
        isLoading,
        isError,
        reloadChatHistory,
        handleIncomingMessage,
        clearChat,
    };
}
