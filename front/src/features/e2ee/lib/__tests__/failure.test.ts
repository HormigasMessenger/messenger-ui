import {describe, it, expect} from "vitest";
import {
    MAX_SKIP_PER_CHAIN, classifyDecryptError, isRecoverable, secretStateKey,
    type DecryptFailure, type SecretMsgState,
} from "../failure";

describe("failure taxonomy", () => {
    it("pins the library's hard skip ceiling", () => {
        expect(MAX_SKIP_PER_CHAIN).toBe(2000);   // matches session-cipher.js "Over 2000 messages into the future!"
    });

    it("classifies the real libsignal error messages", () => {
        const cases: Array<[string, DecryptFailure]> = [
            ["Over 2000 messages into the future!", "hard-gap"],
            ["Message key not found. The counter was repeated or the key was not filled.", "hard-gap"],
            ["No record for device", "no-session"],
            ["No session to decrypt with", "no-session"],
            ["Identity key changed", "no-session"],
            ["e2ee: not an envelope", "corrupt"],
            ["Unexpected token < in JSON at position 0", "corrupt"],
            ["something totally unexpected", "unknown"],
        ];
        for (const [msg, want] of cases) {
            expect(classifyDecryptError(new Error(msg)), msg).toBe(want);
        }
    });

    it("accepts a non-Error too (never throws on odd input)", () => {
        expect(classifyDecryptError("into the future")).toBe("hard-gap");
        expect(classifyDecryptError(null)).toBe("unknown");
        expect(classifyDecryptError(undefined)).toBe("unknown");
    });

    it("marks a hard-gap / no-session / unknown as recoverable, but never corrupt or duplicate", () => {
        expect(isRecoverable("hard-gap")).toBe(true);
        expect(isRecoverable("no-session")).toBe(true);
        expect(isRecoverable("unknown")).toBe(true);
        expect(isRecoverable("corrupt")).toBe(false);
        expect(isRecoverable("duplicate")).toBe(false);
    });

    it("maps every visible state to a stable i18n key", () => {
        const map: Record<SecretMsgState, string> = {
            decrypting: "chat.decrypting",
            pending: "chat.decryptPending",
            lost: "chat.decryptLost",
            unavailable: "chat.decryptUnavailable",
        };
        for (const [state, key] of Object.entries(map)) {
            expect(secretStateKey(state as SecretMsgState)).toBe(key);
        }
    });
});
