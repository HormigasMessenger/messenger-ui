import {useCallback, useEffect, useState} from "react";
import {useNavigate, useSearchParams} from "react-router-dom";
import {useDispatch, useSelector} from "react-redux";
import {useTranslation} from "react-i18next";

import ChatList from "@/features/chat/ui/ChatList.tsx";
import ChatWindow from "@/features/chat/ui/ChatWindow.js";
import {ConnectionBanner} from "@/features/chat/ui/ConnectionBanner.tsx";
import {NotificationPrompt} from "@/features/notifications";
import ConfirmModal from "@/widgets/modal/ConfirmModal.jsx";
import VideoCall from "@/features/call/ui/VideoCall.tsx";
import {useChat} from "@/features/chat/hooks";
import {useOutboxRetry} from "@/features/chat/hooks/useOutboxRetry.ts";
import {useCallTimeout} from "@/features/call/hooks/useCallTimeout.ts";
import {useCallRingtone} from "@/features/call/hooks/useCallRingtone.ts";

import type {RootState, AppDispatch} from "@/store/store.ts";
import {outgoingCall, acceptCall, localEnd, rejectCall} from "@/features/call/model/slices/callSlice";
import {useWebRTC} from "@/features/call/hooks/useWebRTC.ts";


export default function Messenger() {
    const navigate = useNavigate();
    const dispatch = useDispatch<AppDispatch>();
    const {t} = useTranslation();

    // Periodic outbox retry driver (ACK-timeout resend).
    useOutboxRetry();
    // End an unanswered outgoing call after a timeout.
    useCallTimeout();
    // Ring while a call is incoming/dialing.
    useCallRingtone();

    /* ======================
       WebRTC service
    ====================== */
    const {localStream, remoteStream} = useWebRTC(); // 🔥
    /* ======================
       Chat service
    ====================== */
    const chat = useChat();

    /* ======================
       Deep link from a push notification: /messenger-ui/?chat=<conversationId> opens that chat
       (the SW's notificationclick navigates here). Open it once, then strip the param so a later
       reload/back doesn't reopen it.
    ====================== */
    const [searchParams, setSearchParams] = useSearchParams();
    const openChat = chat.openChat;
    useEffect(() => {
        const chatParam = searchParams.get("chat");
        if (!chatParam) return;
        openChat(chatParam);
        const next = new URLSearchParams(searchParams);
        next.delete("chat");
        setSearchParams(next, {replace: true});
    }, [searchParams, openChat, setSearchParams]);

    // Deep link from an INCOMING-CALL push (SW notificationclick "Answer"):
    //   ?call=<conversationId>&caller=<callerUserId>
    // Open the conversation and call the caller back — the original WebRTC offer is stale by the time
    // the app cold-starts, so "answering" re-initiates the call to them. Then strip the params.
    useEffect(() => {
        const callParam = searchParams.get("call");
        const caller = searchParams.get("caller");
        if (!callParam) return;
        openChat(callParam);
        if (caller) dispatch(outgoingCall({peerId: caller}));
        const next = new URLSearchParams(searchParams);
        next.delete("call");
        next.delete("caller");
        setSearchParams(next, {replace: true});
    }, [searchParams, openChat, dispatch, setSearchParams]);

    /* ======================
       Delete modal
    ====================== */
    const [showDeleteModal, setShowDeleteModal] = useState(false);

    /* ======================
       Call status from Redux
    ====================== */
    const callStatus = useSelector((state: RootState) => state.call.status);

    /* ======================
       Derived
    ====================== */
    const peerContact = chat.selectedChat ?? null;
    const myName = useSelector((state: RootState) => state.user.name);

    // Stable callbacks so the memoized ChatList/ChatWindow don't re-render on unrelated state.
    const selectedCounterpartId = chat.selectedCounterpartId;
    const onLogout = useCallback(() => navigate("/logout"), [navigate]);
    const onOpenDeleteModal = useCallback(() => setShowDeleteModal(true), []);
    const onCall = useCallback(() => {
        // Call the counterpart's USER id (signaling recipient), not the conversationId.
        if (selectedCounterpartId) dispatch(outgoingCall({peerId: selectedCounterpartId, audioOnly: false}));
    }, [selectedCounterpartId, dispatch]);
    const onAudioCall = useCallback(() => {
        if (selectedCounterpartId) dispatch(outgoingCall({peerId: selectedCounterpartId, audioOnly: true}));
    }, [selectedCounterpartId, dispatch]);

    /* ======================
       Render
    ====================== */
    return (
        <div className="relative h-dvh w-screen flex overflow-hidden bg-gray-300">
            <ConnectionBanner/>
            <NotificationPrompt/>
            {/* ===== Chat List ===== */}
            <ChatList
                chats={chat.filteredChats}
                openChat={chat.openChat}
                unreadChats={chat.unreadChats}
                search={chat.searchQuery}
                setSearch={chat.setSearchQuery}
                myName={myName}
                onLogout={onLogout}
            />

            {/* ===== Chat Window ===== */}
            <ChatWindow
                chat={chat.selectedChat}
                counterpartId={selectedCounterpartId}
                isGroup={chat.selectedIsGroup}
                messages={chat.messages}
                historyError={chat.historyError}
                onReloadHistory={chat.reloadChatHistory}
                inputText={chat.messageInput}
                setInputText={chat.setMessageInput}
                sendMessage={chat.sendMessage}
                onTyping={chat.notifyTyping}
                onToggleBlock={chat.toggleBlock}
                blocked={chat.selectedBlocked}
                blockedByMe={chat.selectedBlockedByMe}
                blockedByPeer={chat.selectedBlockedByPeer}
                onDeleteMessage={chat.deleteMessage}
                onSendAttachment={chat.sendAttachment}
                uploadProgress={chat.uploadProgress}
                onDownloadAttachment={chat.downloadAttachment}
                onResolveAttachment={chat.getAttachmentUrl}
                outboxStatusById={chat.outboxStatusById}
                onRetryMessage={chat.retryMessage}
                onDiscardMessage={chat.discardMessage}
                onDeleteChat={onOpenDeleteModal}
                onCall={onCall}
                onAudioCall={onAudioCall}
            />

            {/* ===== Video Call ===== */}
            {callStatus !== "idle" && (
                <VideoCall
                    localStream={localStream}
                    remoteStream={remoteStream}
                    onHangUp={() => dispatch(localEnd())}
                    acceptCall={() => dispatch(acceptCall())}
                    rejectCall={() => dispatch(rejectCall())}
                />
            )}

            {/* ===== Delete Confirmation Modal ===== */}
            {showDeleteModal && peerContact && (
                <ConfirmModal
                    title={t("chat.deleteChatTitle")}
                    message={t("chat.deleteChatConfirm", {name: peerContact.name})}
                    confirmText={t("chat.delete")}
                    cancelText={t("common.cancel")}
                    onCancel={() => setShowDeleteModal(false)}
                    onConfirm={async () => {
                        await chat.deleteChat();
                        setShowDeleteModal(false);
                    }}
                />
            )}
        </div>
    );
}