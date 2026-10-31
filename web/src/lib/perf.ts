// Shorts transition instrumentation (#182). One record per move between cards:
// how it was triggered, how long the scroll took to settle, how long from focus
// to the new clip playing, and how smooth the frames were while it happened.
//
// Records land in a ring buffer at window.__otiumPerf (tests and the console read
// it) and are batched to POST /api/v1/client-metrics, where the server logs them
// so real-device timings are queryable in Datadog. Add ?perf=1 (remembered in
// localStorage) to also log each record to the console. Frame sampling runs only
// while a transition is open, so an idle session costs nothing.

export type Trigger = "scroll" | "flick" | "button" | "key" | "restore";

export interface Transition {
    kind: "shorts_transition";
    from: number;
    to: number;
    trigger: Trigger;
    media: string;          // media type of the destination card
    settle_ms: number;      // focus change -> scroll idle
    load_ms: number;        // focus change -> the player was asked to load the clip (-1: never)
    playing_ms: number;     // focus change -> destination clip PLAYING (-1: never)
    frames: number;
    janky_frames: number;   // frames > 25ms apart (a missed 60Hz frame or worse)
    scroll_janky_frames: number; // ...of those, while the reel was still moving
    scroll_max_frame_ms: number;
    max_frame_ms: number;
    longtask_ms: number;    // main-thread long tasks during the transition (Chromium only)
    longtask_iframe_ms: number; // the part attributed to an iframe (YouTube)
    drift_px: number;       // max distance between the player layer and its card slot
    ua: string;
}

const FLUSH_AT = 8;
const CLOSE_AFTER_MS = 4000;

const buffer: Transition[] = [];
const outbox: Transition[] = [];
let open: (Omit<Transition, "settle_ms" | "playing_ms" | "load_ms"> & { t0: number; settledAt: number; playingAt: number; loadAt: number; lastFrame: number }) | null = null;
let pendingTrigger: { trigger: Trigger; at: number } | null = null;
let raf = 0;
let closeTimer = 0;
let longtaskObserver: PerformanceObserver | null = null;
let driftProbe: (() => number) | null = null;

const verbose = (() => {
    try {
        const flag = new URLSearchParams(location.search).get("perf");
        if (flag !== null) localStorage.setItem("otium:perf", flag === "0" ? "0" : "1");
        return localStorage.getItem("otium:perf") === "1";
    } catch { return false; }
})();

function uaClass() {
    const ua = navigator.userAgent;
    if (/iPhone|iPad/.test(ua)) return "ios";
    if (/Android/.test(ua)) return "android";
    if (/Safari/.test(ua) && !/Chrome/.test(ua)) return "safari";
    return "chromium";
}

/** Note what caused the next focus change (a flick over the video, the Next button). */
export function noteTrigger(trigger: Trigger) {
    pendingTrigger = { trigger, at: performance.now() };
}

/** The player layer reports how far it sits from its slot, sampled each frame. */
export function setDriftProbe(probe: (() => number) | null) {
    driftProbe = probe;
}

/** The reel focused a new card. */
export function focusChanged(from: number, to: number, media: string) {
    if (open) close();
    const now = performance.now();
    const trigger = pendingTrigger && now - pendingTrigger.at < 1500 ? pendingTrigger.trigger : "scroll";
    pendingTrigger = null;
    open = {
        kind: "shorts_transition", from, to, trigger, media,
        frames: 0, janky_frames: 0, scroll_janky_frames: 0, scroll_max_frame_ms: 0, max_frame_ms: 0, longtask_ms: 0, longtask_iframe_ms: 0, drift_px: 0, ua: uaClass(),
        t0: now, settledAt: 0, playingAt: 0, loadAt: 0, lastFrame: now,
    };
    startSampling();
    closeTimer = window.setTimeout(close, CLOSE_AFTER_MS);
}

/** The reel stopped scrolling. */
export function scrollSettled() {
    if (open && !open.settledAt) {
        open.settledAt = performance.now();
        maybeClose();
    }
}

/** The shared player was asked to load the focused card's clip. */
export function clipLoading() {
    if (open && !open.loadAt) open.loadAt = performance.now();
}

/** The shared player reached PLAYING for the focused card. */
export function clipPlaying() {
    if (open && !open.playingAt) {
        open.playingAt = performance.now();
        maybeClose();
    }
}

function maybeClose() {
    if (!open) return;
    const needsPlay = open.media === "short";
    if (open.settledAt && (!needsPlay || open.playingAt)) {
        // A few frames past the last milestone catch a late layout jump.
        window.setTimeout(() => { if (open) close(); }, 150);
    }
}

function startSampling() {
    cancelAnimationFrame(raf);
    const tick = (t: number) => {
        if (!open) return;
        const gap = t - open.lastFrame;
        open.lastFrame = t;
        open.frames += 1;
        if (open.frames > 1) {
            if (gap > 25) open.janky_frames += 1;
            open.max_frame_ms = Math.max(open.max_frame_ms, gap);
            if (!open.settledAt) {
                if (gap > 25) open.scroll_janky_frames += 1;
                open.scroll_max_frame_ms = Math.max(open.scroll_max_frame_ms, gap);
            }
        }
        if (driftProbe) open.drift_px = Math.max(open.drift_px, driftProbe());
        raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    if (!longtaskObserver && typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
        longtaskObserver = new PerformanceObserver((list) => {
            if (!open) return;
            for (const entry of list.getEntries()) {
                open.longtask_ms += entry.duration;
                const source = (entry as any).attribution?.[0];
                if (source?.containerType === "iframe" || (source?.name && source.name !== "self")) open.longtask_iframe_ms += entry.duration;
            }
        });
        longtaskObserver.observe({ entryTypes: ["longtask"] });
    }
}

function close() {
    if (!open) return;
    cancelAnimationFrame(raf);
    window.clearTimeout(closeTimer);
    const { t0, settledAt, playingAt, loadAt, lastFrame: _lastFrame, ...rest } = open;
    const record: Transition = {
        ...rest,
        settle_ms: Math.round((settledAt || performance.now()) - t0),
        playing_ms: playingAt ? Math.round(playingAt - t0) : -1,
        load_ms: loadAt ? Math.round(loadAt - t0) : -1,
        max_frame_ms: Math.round(rest.max_frame_ms),
        scroll_max_frame_ms: Math.round(rest.scroll_max_frame_ms),
        longtask_ms: Math.round(rest.longtask_ms),
        longtask_iframe_ms: Math.round(rest.longtask_iframe_ms),
        drift_px: Math.round(rest.drift_px),
    };
    open = null;
    buffer.push(record);
    if (buffer.length > 200) buffer.shift();
    outbox.push(record);
    if (verbose) console.info("[otium perf]", record);
    if (outbox.length >= FLUSH_AT) flush();
}

export function flush() {
    if (!outbox.length) return;
    const body = JSON.stringify(outbox.splice(0));
    try {
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon?.("/api/v1/client-metrics", blob)) return;
    } catch { /* fall through */ }
    fetch("/api/v1/client-metrics", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}

if (typeof window !== "undefined") {
    (window as any).__otiumPerf = buffer;
    window.addEventListener("pagehide", () => { close(); flush(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });
}
