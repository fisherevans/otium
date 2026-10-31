// A small store between the shared Shorts player and the card that shows it
// (#182). The player publishes sound, captions, playing and the playhead; the
// card footer renders quiet controls from it and calls back into the player.
// Calls run synchronously inside the tap, which iOS needs to allow unmuting.
// Subscribers re-render only when a visible value changes (the clock in whole
// seconds), so a playing clip never re-renders the session page.

export interface ShortsState {
    itemId: number;
    muted: boolean;
    captions: boolean;
    playing: boolean;
    native: boolean;
    at: number;     // whole seconds
    total: number;  // whole seconds; 0 when unknown
}

export interface ShortsControls {
    toggleSound(): void;
    toggleCaptions(): void;
    toggleNative(): void;
}

export interface ShortsBus {
    get(): ShortsState;
    set(patch: Partial<ShortsState>): void;
    subscribe(listener: () => void): () => void;
    controls: ShortsControls;
    bind(controls: ShortsControls | null): void;
}

export function createShortsBus(): ShortsBus {
    let state: ShortsState = { itemId: 0, muted: true, captions: true, playing: false, native: false, at: 0, total: 0 };
    let bound: ShortsControls | null = null;
    const listeners = new Set<() => void>();
    return {
        get: () => state,
        set(patch) {
            let changed = false;
            for (const [k, v] of Object.entries(patch)) {
                if ((state as any)[k] !== v) { changed = true; break; }
            }
            if (!changed) return;
            state = { ...state, ...patch };
            listeners.forEach((l) => l());
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        controls: {
            toggleSound: () => bound?.toggleSound(),
            toggleCaptions: () => bound?.toggleCaptions(),
            toggleNative: () => bound?.toggleNative(),
        },
        bind(controls) { bound = controls; },
    };
}

export function formatClock(seconds: number) {
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
