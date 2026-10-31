// #189: how long Shorts take to start on this device, so the waiting animation can
// be timed to land when the clip is likely to play instead of looping blindly.
// Keeps the last few measured starts (player asked to load -> PLAYING) in this
// browser; the expectation is their median, with a modest default before any.

const KEY = "otium:shorts-start-ms";
const KEEP = 4;
const DEFAULT_MS = 1200;

function read(): number[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
        return Array.isArray(parsed) ? parsed.filter((n) => Number.isFinite(n) && n > 0) : [];
    } catch { return []; }
}

/** Remember one measured start. Outliers past 15s (backgrounded tab) are ignored. */
export function recordStart(ms: number) {
    if (!(ms > 0 && ms < 15000)) return;
    try { localStorage.setItem(KEY, JSON.stringify([...read(), Math.round(ms)].slice(-KEEP))); } catch { /* optional */ }
}

/** The expected start time in ms: the median of recent starts, clamped. */
export function expectedStart() {
    const recent = read().sort((a, b) => a - b);
    if (!recent.length) return DEFAULT_MS;
    const mid = Math.floor(recent.length / 2);
    const median = recent.length % 2 ? recent[mid] : (recent[mid - 1] + recent[mid]) / 2;
    return Math.min(4000, Math.max(400, Math.round(median)));
}
