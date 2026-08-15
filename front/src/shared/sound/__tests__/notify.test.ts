import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
import {startRinging, stopRinging, unlockAudio} from "../notify";

// A minimal fake AudioContext (jsdom has none). Kept as one stable object because notify.ts caches the
// context module-level after the first use; tests mutate `.state` to drive unlockAudio.
const chain = {connect: () => chain};
const fakeCtx = {
    state: "running" as string,
    currentTime: 0,
    resume: vi.fn(() => Promise.resolve()),
    createOscillator: () => ({type: "", frequency: {setValueAtTime: () => {}}, connect: () => chain, start: () => {}, stop: () => {}}),
    createGain: () => ({gain: {setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}}, connect: () => chain}),
    destination: {},
};

beforeEach(() => {
    // A PLAIN function (not vi.fn): `new fn()` returns fn's returned object, so the module caches our
    // shared fakeCtx. A vi.fn constructor would return a fresh empty `this` instead.
    vi.stubGlobal("AudioContext", function () { return fakeCtx; });
    fakeCtx.state = "running";
    fakeCtx.resume.mockClear();
    stopRinging(); // reset module ring state between tests
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("notify — unlockAudio", () => {
    it("resumes a suspended AudioContext", () => {
        fakeCtx.state = "suspended";
        unlockAudio();
        expect(fakeCtx.resume).toHaveBeenCalledTimes(1);
    });
    it("is a no-op when the context is already running", () => {
        fakeCtx.state = "running";
        unlockAudio();
        expect(fakeCtx.resume).not.toHaveBeenCalled();
    });
});

describe("notify — ringtone loop", () => {
    it("startRinging arms exactly one interval; a second call is a no-op; stopRinging clears it", () => {
        vi.useFakeTimers();
        const setSpy = vi.spyOn(globalThis, "setInterval");
        const clearSpy = vi.spyOn(globalThis, "clearInterval");

        startRinging();
        startRinging(); // already ringing → must not arm a second interval
        expect(setSpy).toHaveBeenCalledTimes(1);

        stopRinging();
        expect(clearSpy).toHaveBeenCalledTimes(1);
        stopRinging(); // idempotent
        expect(clearSpy).toHaveBeenCalledTimes(1);
    });
});
