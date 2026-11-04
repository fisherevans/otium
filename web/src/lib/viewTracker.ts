// Per-view engagement (#196). One view is one time an item held focus in a
// session: how long it was on screen (foreground only), whether it was opened,
// how long it was read or played, and for a video how far it got, pauses,
// seeks, resumes and whether it finished. The tracker keeps the running totals
// for the focused item and sends them under a key minted at focus, so a second
// send (leaving the card, then pagehide) replaces the first on the server.
//
// Descriptive only: nothing reads these to rank a session. Automatic playback is
// recorded as playback, never as an open.

import { api, type ItemView } from "@/api/client";

// YouTube player states (IFrame API).
const PLAYING = 1;
const PAUSED = 2;
const ENDED = 0;

// A jump in the playhead beyond what elapsed time explains, in seconds.
const SEEK_SLOP = 2.5;
// A pause shorter than this is not a pause: a double-tap like toggles playback
// off and straight back on.
const BLIP_MS = 700;
// Under this long in focus with nothing done, a card was passed through, not seen.
const MIN_VIEW_MS = 200;

type Live = ItemView & {
  itemId: number;
  startedAt: number;
  hiddenMs: number;
  hiddenSince: number | null;
  lastAt: number | null;
  lastAtWall: number;
  pausedByState: boolean;
  // The playhead was not advancing (paused, buffering, cued) since lastAt.
  frozen: boolean;
  pausedAt: number;
  dirty: boolean;
};

export function createViewTracker() {
  let live: Live | null = null;

  function current(itemId: number) {
    return live && live.itemId === itemId ? live : null;
  }

  function snapshot(v: Live): ItemView {
    const hidden = v.hiddenMs + (v.hiddenSince !== null ? Date.now() - v.hiddenSince : 0);
    return {
      view_key: v.view_key, session_id: v.session_id, shown_at: v.shown_at,
      dwell_ms: Math.max(0, Date.now() - v.startedAt - hidden),
      opened: v.opened, external: v.external, active_ms: Math.round(v.active_ms),
      video_len_sec: v.video_len_sec, max_pos_sec: v.max_pos_sec,
      plays: v.plays, pauses: v.pauses, seeks: v.seeks, resumed: v.resumed, completed: v.completed,
      scroll_depth: Math.round(v.scroll_depth * 100) / 100,
    };
  }

  function send(v: Live) {
    v.dirty = false;
    api.recordView(v.itemId, snapshot(v)).catch(() => {});
  }

  return {
    // The item that now holds focus. Sends the view it replaces.
    start(itemId: number, sessionId: string) {
      if (live?.itemId === itemId) return;
      this.end();
      const now = Date.now();
      live = {
        itemId, view_key: `${sessionId}:${itemId}:${now}`, session_id: sessionId,
        shown_at: new Date(now).toISOString(), dwell_ms: 0, opened: false, external: false,
        active_ms: 0, video_len_sec: 0, max_pos_sec: 0, plays: 0, pauses: 0, seeks: 0,
        resumed: false, completed: false, scroll_depth: 0,
        startedAt: now, hiddenMs: 0, hiddenSince: document.hidden ? now : null,
        lastAt: null, lastAtWall: now, pausedByState: false, frozen: true, pausedAt: 0, dirty: true,
      };
    },
    // Focus left every item (end card, recap, leaving the page).
    end() {
      // A card scrolled straight through (a resume jump, a fast fling) was
      // never really on screen; it is not a view.
      if (live && (Date.now() - live.startedAt >= MIN_VIEW_MS || live.opened || live.plays > 0)) send(live);
      live = null;
    },
    // pagehide / tab hidden: send what we have without ending the view.
    flush() {
      if (live?.dirty) send(live);
    },
    visibility(hidden: boolean) {
      if (!live) return;
      if (hidden) {
        if (live.hiddenSince === null) live.hiddenSince = Date.now();
        live.dirty = true;
        send(live);
      } else if (live.hiddenSince !== null) {
        live.hiddenMs += Date.now() - live.hiddenSince;
        live.hiddenSince = null;
      }
    },
    opened(itemId: number, external = false) {
      const v = current(itemId);
      if (!v) return;
      v.opened = true;
      if (external) v.external = true;
      v.dirty = true;
    },
    // Measured foreground reading or playing time (the #135 timer's intervals).
    active(itemId: number, ms: number) {
      const v = current(itemId);
      if (!v || ms <= 0) return;
      v.active_ms += ms;
      v.dirty = true;
    },
    scrollDepth(itemId: number, fraction: number) {
      const v = current(itemId);
      if (!v || fraction <= v.scroll_depth) return;
      v.scroll_depth = Math.min(1, fraction);
      v.dirty = true;
    },
    // A YouTube player report: a state change, or a playhead tick while playing.
    watch(itemId: number, state: number, at: number, total: number) {
      const v = current(itemId);
      if (!v) return;
      const now = Date.now();
      if (total > 0) v.video_len_sec = Math.round(total * 10) / 10;
      if (Number.isFinite(at) && at > v.max_pos_sec) v.max_pos_sec = Math.round(at * 10) / 10;
      if (v.lastAt !== null && Number.isFinite(at) && state === PLAYING) {
        const expected = v.lastAt + (v.frozen ? 0 : (now - v.lastAtWall) / 1000);
        if (Math.abs(at - expected) > SEEK_SLOP) v.seeks += 1;
      }
      if (state === PLAYING && v.pausedByState && now - v.pausedAt < BLIP_MS) {
        v.pauses -= 1; // the pause was a blip, not a pause
      } else {
        if (state === PLAYING && v.pausedByState) v.resumed = true;
        if (state === PLAYING && (v.plays === 0 || v.pausedByState)) v.plays += 1;
      }
      if (state === PAUSED && !v.pausedByState) { v.pauses += 1; v.pausedAt = now; }
      if (state === PAUSED) v.pausedByState = true;
      else if (state === PLAYING) v.pausedByState = false;
      if (state === ENDED) v.completed = true;
      if (Number.isFinite(at)) { v.lastAt = at; v.lastAtWall = now; }
      v.frozen = state !== PLAYING;
      v.dirty = true;
    },
  };
}

export type ViewTracker = ReturnType<typeof createViewTracker>;
