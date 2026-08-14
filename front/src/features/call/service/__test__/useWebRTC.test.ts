import { describe, it, expect, vi, beforeEach } from "vitest";
import { webRTCService } from "../";
import type { OutgoingWebRTCMessage, FromOffer, FromAnswer, FromCandidate } from "@/features/call/model/types";

// ======================
// Mocks
// ======================

vi.mock("react-hot-toast", () => ({
    default: {
        error: vi.fn(),
    },
}));

class MockRTCPeerConnection {
    static generateCertificate = vi.fn().mockResolvedValue({});

    connectionState = "new";
    signalingState: string = "stable";
    ontrack: ((ev: RTCTrackEvent) => void) | null = null;
    onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null = null;
    onconnectionstatechange: (() => void) | null = null;

    addTrack = vi.fn();
    createOffer = vi.fn().mockResolvedValue({ sdp: "offer-sdp", type: "offer" });
    setLocalDescription = vi.fn().mockResolvedValue(undefined);
    setRemoteDescription = vi.fn().mockResolvedValue(undefined);
    createAnswer = vi.fn().mockResolvedValue({ sdp: "answer-sdp", type: "answer" });
    addIceCandidate = vi.fn().mockResolvedValue(undefined);
    close = vi.fn();
}

(globalThis as unknown as { RTCPeerConnection: typeof MockRTCPeerConnection }).RTCPeerConnection =
    MockRTCPeerConnection;

Object.defineProperty(global.navigator, "mediaDevices", {
    value: {
        getUserMedia: vi.fn().mockResolvedValue({
            getTracks: () => [{ stop: vi.fn() }],
        }),
    },
});

// ======================
// Helper для сброса состояния singleton
// ======================
function resetService() {
    const service = webRTCService as unknown as {
        pc: RTCPeerConnection | null;
        localStream: MediaStream | null;
        remotePeerId: string | null;
        remoteReady: boolean;
        pendingIce: RTCIceCandidateInit[];
    };

    service.pc = null;
    service.localStream = null;
    service.remotePeerId = null;
    service.remoteReady = false;
    service.pendingIce = [];
}

// ======================
// Tests
// ======================

describe("WebRTCService", () => {
    let sendWS: (data: OutgoingWebRTCMessage) => void;
    let onLocalStream: (stream: MediaStream | null) => void;
    let onRemoteStream: (stream: MediaStream | null) => void;

    beforeEach(() => {
        resetService();

        sendWS = vi.fn<(data: OutgoingWebRTCMessage) => void>();
        onLocalStream = vi.fn<(stream: MediaStream | null) => void>();
        onRemoteStream = vi.fn<(stream: MediaStream | null) => void>();

        webRTCService.setSendCallback(sendWS);
        webRTCService.setStreamCallbacks(onLocalStream, onRemoteStream);

        vi.clearAllMocks();
    });

    it("startCall — успешно создаёт offer", async () => {
        await webRTCService.startCall("peer1");

        expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
        expect(sendWS).toHaveBeenCalledWith({
            type: "call:offer",
            to: "peer1",
            offer: { sdp: "offer-sdp", type: "offer" },
            media: "video",
        });
        expect(onLocalStream).toHaveBeenCalled();
    });

    it("handleOffer — вызывает call:end если уже есть pc", async () => {
        await webRTCService.startCall("peerX");
        const offer: FromOffer = { from: "peerY", offer: { sdp: "x", type: "offer" } };
        await expect(webRTCService.handleOffer(offer)).rejects.toThrow("Already in call");
        expect(sendWS).toHaveBeenCalledWith({ type: "call:end", to: "peerY" });
    });

    it("handleOffer — успешно принимает offer", async () => {
        const offer: FromOffer = { from: "peerY", offer: { sdp: "x", type: "offer" } };
        await webRTCService.handleOffer(offer);

        expect(sendWS).toHaveBeenCalledWith({
            type: "call:answer",
            to: "peerY",
            answer: { sdp: "answer-sdp", type: "answer" },
        });
    });

    it("handleAnswer — ничего не делает если pc отсутствует", async () => {
        const answer: FromAnswer = { from: "peerZ", answer: { sdp: "a", type: "answer" } };
        await webRTCService.handleAnswer(answer);
        expect(sendWS).not.toHaveBeenCalled();
    });

    it("handleAnswer — ничего не делает если signalingState !== 'have-local-offer'", async () => {
        // Мокируем pc вручную
        const pcMock = new MockRTCPeerConnection();
        (webRTCService as unknown as { pc: MockRTCPeerConnection }).pc = pcMock;

        // signalingState != 'have-local-offer'
        pcMock.signalingState = "stable";

        const answer: FromAnswer = { from: "peerZ", answer: { sdp: "a", type: "answer" } };
        await webRTCService.handleAnswer(answer);

        expect(sendWS).not.toHaveBeenCalled();
        expect(pcMock.setRemoteDescription).not.toHaveBeenCalled();
    });

    it("handleAnswer — успешно устанавливает remoteDescription и ICE", async () => {
        await webRTCService.startCall("peer1");
        const pc = (webRTCService as unknown as { pc: MockRTCPeerConnection }).pc!;
        pc.signalingState = "have-local-offer";

        const answer: FromAnswer = { from: "peerZ", answer: { sdp: "a", type: "answer" } };
        await webRTCService.handleAnswer(answer);

        expect(pc.setRemoteDescription).toHaveBeenCalledWith(answer.answer);
    });

    it("addIce — добавляет в pendingIce если remoteReady = false", async () => {
        const candidate: FromCandidate = { from: "peer1", candidate: { candidate: "ice", sdpMid: "0", sdpMLineIndex: 0 } };
        await webRTCService.addIce(candidate);

        const service = webRTCService as unknown as { pendingIce: RTCIceCandidateInit[] };
        expect(service.pendingIce).toHaveLength(1);
    });

    it("addIce — вызывает pc.addIceCandidate если remoteReady = true", async () => {
        await webRTCService.startCall("peer1");
        const pc = (webRTCService as unknown as { pc: MockRTCPeerConnection }).pc!;
        (webRTCService as unknown as { remoteReady: boolean }).remoteReady = true;

        const candidate: FromCandidate = { from: "peer1", candidate: { candidate: "ice", sdpMid: "0", sdpMLineIndex: 0 } };
        await webRTCService.addIce(candidate);

        expect(pc.addIceCandidate).toHaveBeenCalledWith(candidate.candidate);
    });

    it("getConnectionState — возвращает состояние соединения", async () => {
        expect(webRTCService.getConnectionState()).toBeNull();

        await webRTCService.startCall("peer1");
        expect(webRTCService.getConnectionState()).toBe("new");
    });
});
