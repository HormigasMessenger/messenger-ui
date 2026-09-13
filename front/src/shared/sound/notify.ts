// Asset-free notification sound: a short WebAudio blip. This is the ONLY notification concern that
// belongs in shared — it's a generic, stateless sound util with no chat/notification policy. The
// desktop-notification policy (permission lifecycle + the single-arbiter routing) lives in
// features/notifications/desktopNotification.ts. Best-effort: autoplay policy may suppress the blip
// (audio needs a prior user gesture).

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
    try {
        if (!ctx) {
            const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
        }
        return ctx;
    } catch {
        return null;
    }
}

/**
 * The shared AudioContext, so other audio (e.g. the voice-note playback gain boost) reuses the ONE
 * context that unlockAudio() already resumes on the first user gesture — instead of spinning up a fresh
 * suspended context per element, which made the FIRST play silent (context not yet running). Returns null
 * if WebAudio is unavailable.
 */
export function getSharedAudioContext(): AudioContext | null {
    return audioCtx();
}

/** Short two-tone blip via WebAudio (no media asset needed). */
export function playNotificationSound() {
    const ac = audioCtx();
    if (!ac) return;
    try {
        if (ac.state === "suspended") ac.resume().catch(() => {});
        const now = ac.currentTime;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.setValueAtTime(880, now + 0.08);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        osc.connect(gain).connect(ac.destination);
        osc.start(now);
        osc.stop(now + 0.24);
    } catch { /* ignore */ }
}

/**
 * Resume the AudioContext from a user gesture. Browsers start it "suspended" and reject resume() unless
 * it's called during a gesture, so notification/ring audio is silent until the user has interacted once.
 * Wire this to a one-time pointerdown/keydown at app start (see App). Idempotent + best-effort.
 */
export function unlockAudio() {
    const ac = audioCtx();
    if (ac && ac.state === "suspended") ac.resume().catch(() => {});
}

// Resume a suspended context and WAIT for it — scheduling oscillators while the context is still
// suspended pins them to a frozen currentTime, so when it finally resumes their start time is already in
// the past and the browser drops/clips them. That's the "first ring is silent / sometimes no sound" bug.
async function ensureRunning(ac: AudioContext): Promise<void> {
    if (ac.state === "suspended") { try { await ac.resume(); } catch { /* blocked outside a gesture */ } }
}

// Mobile browsers SUSPEND the AudioContext when the page goes to the background and don't auto-resume on
// return, so a call arriving as you switch back would be silent. Re-warm it whenever the app regains the
// foreground (best-effort; a plain resume on return-to-foreground is honored in practice).
if (typeof document !== "undefined") {
    const rewarm = () => { if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {}); };
    document.addEventListener("visibilitychange", () => { if (!document.hidden) rewarm(); });
    if (typeof window !== "undefined") window.addEventListener("focus", rewarm);
}

// --- incoming/outgoing call ringtone (asset-free, looped) --------------------------------------------
let ringTimer: ReturnType<typeof setInterval> | null = null;

async function ringBurst() {
    const ac = audioCtx();
    if (!ac) return;
    await ensureRunning(ac);             // resume FIRST, then schedule against a live clock
    const base = ac.currentTime;
    // Two short beeps (classic "ring-ring").
    for (const offset of [0, 0.45]) {
        const t = base + offset;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(480, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
        gain.gain.setValueAtTime(0.6, t + 0.3);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
        osc.connect(gain).connect(ac.destination);
        osc.start(t);
        osc.stop(t + 0.38);
    }
}

/** Start the looping ringtone (incoming call / outgoing ringback). No-op if already ringing. */
export function startRinging() {
    if (ringTimer) return;
    void ringBurst();
    ringTimer = setInterval(() => { void ringBurst(); }, 2600);
}

/** Stop the ringtone. */
export function stopRinging() {
    if (ringTimer) { clearInterval(ringTimer); ringTimer = null; }
}
