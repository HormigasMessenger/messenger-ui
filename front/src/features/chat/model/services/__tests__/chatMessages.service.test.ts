import {beforeEach, describe, expect, it, vi} from "vitest";
import {chatMessagesService} from "../chatMessages.service";
import {chatApi} from "@/features/chat/rest/chatApi";
import {logger} from "@/shared/logger/logger";


vi.mock("@/store/store", () => ({}));

vi.mock("@/features/chat/rest/chatApi", () => ({
    chatApi: {
        util: {
            updateQueryData: vi.fn(),
        },
        endpoints: {
            getChatHistory: {
                initiate: vi.fn(),
            },
        },
    },
}));

vi.mock("@/features/chat/thunk/sendOutboxThunk", () => ({
    flushOutbox: vi.fn(() => ({ type: "outbox/flush-mock-thunk" })),
}));

vi.mock("@/features/chat/model/outbox", () => ({
    enqueueMessage: vi.fn((msg) => ({type: "ENQUEUE", payload: msg})),
}));

vi.mock("@/shared/logger/logger", () => ({
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
    },
}));

describe("chatMessagesService", () => {
    const dispatch = vi.fn();
    const myId = "user1";

    beforeEach(() => {
        dispatch.mockClear();
        vi.clearAllMocks();
    });

    it("clearChatHistory: deletes history and updates cache", async () => {
        const dispatch = vi.fn();
        const unwrap = vi.fn().mockResolvedValue(undefined);
        const deleteHistory = vi.fn().mockReturnValue({unwrap});

        await chatMessagesService.clearChatHistory(
            dispatch,
            deleteHistory as ReturnType<typeof chatApi.useDeleteChatHistoryMutation>[0],
            "user1",
            "chat123"
        );

        expect(deleteHistory).toHaveBeenCalledWith({
            myId: "user1",
            chatId: "chat123",
        });

        expect(unwrap).toHaveBeenCalled();

        expect(chatApi.util.updateQueryData).toHaveBeenCalledWith(
            "getChatHistory",
            {myId: "user1", chatId: "chat123"},
            expect.any(Function)
        );

        expect(dispatch).toHaveBeenCalledTimes(1);
    });


    it("clearChatHistory: does not dispatch on error", async () => {
        const dispatch = vi.fn();
        const unwrap = vi.fn().mockRejectedValue(new Error("boom"));
        const deleteHistory = vi.fn().mockReturnValue({unwrap});

        await chatMessagesService.clearChatHistory(
            dispatch,
            deleteHistory as ReturnType<typeof chatApi.useDeleteChatHistoryMutation>[0],
            "user1",
            "chat123"
        );

        expect(deleteHistory).toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });


    it("reloadChatHistory: does nothing if chatId is null", () => {
        const dispatch = vi.fn();

        const result = chatMessagesService.reloadChatHistory(dispatch, "user1", null);

        expect(result).toBeUndefined();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it("reloadChatHistory calls initiate with correct params and dispatches it", () => {
        const dispatch = vi.fn();
        const thunk = vi.fn();

        //@ts-expect-error("no need to use types")
        chatApi.endpoints.getChatHistory.initiate.mockReturnValue(thunk);

        chatMessagesService.reloadChatHistory(dispatch, "user1", "chat123");

        // проверяем, с какими аргументами был вызван initiate
        expect(chatApi.endpoints.getChatHistory.initiate).toHaveBeenCalledWith(
            {myId: "user1", chatId: "chat123"},
            {forceRefetch: true}
        );

        expect(dispatch).toHaveBeenCalledWith(thunk);
    });

    it("reloadChatHistory does nothing if chatId is null", () => {
        const dispatch = vi.fn();

        chatMessagesService.reloadChatHistory(dispatch, "user1", null);

        expect(chatApi.endpoints.getChatHistory.initiate).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it("does nothing if conversationId is null", () => {
        chatMessagesService.enqueueChatMessage(dispatch, "Hello", myId, null, "recipient1");

        expect(dispatch).not.toHaveBeenCalled();
        expect(logger.debug).not.toHaveBeenCalled();
    });

    it("dispatches enqueueMessage and flushOutbox with correct args", () => {
        const selectedChatId = "chat123";
        const recipientId = "recipient1";
        const text = "Hello world";

        chatMessagesService.enqueueChatMessage(dispatch, text, myId, selectedChatId, recipientId);

        expect(logger.debug).toHaveBeenCalledWith("sending chat message via a queue", text);

        // First dispatch is the outbox enqueue; its payload carries the CHAT_IN wire frame.
        const firstCall = dispatch.mock.calls[0][0];
        expect(firstCall.type).toBe("outbox/enqueueMessage");
        expect(firstCall.payload).toMatchObject({
            status: "pending",
            payload: {
                type: "CHAT_IN",
                conversationId: selectedChatId,
                recipientId,
                payload: { kind: "text", body: text },
            },
        });

        expect(typeof firstCall.payload.id).toBe("string");
        expect(typeof firstCall.payload.idempotencyKey).toBe("string");

        // Last dispatch flushes the outbox (the optimistic getChatHistory patch sits in between).
        const calls = dispatch.mock.calls;
        expect(calls[calls.length - 1][0].type).toBe("outbox/flush-mock-thunk");
    });


});
