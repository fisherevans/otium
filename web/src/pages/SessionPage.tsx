import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, useMemo } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { api, type Item, type ItemContent, type ItemRender, type Selected } from "@/api/client";
import { ItemActions } from "@/components/ItemActions";
import { ItemDetails } from "@/components/ItemDetails";
import { ReaderPage } from "@/components/ReaderPage";
import { SavePicker } from "@/components/SavePicker";
import { ScoreBreakdownSheet } from "@/components/ScoreBreakdown";
import { ArrowDown, BookOpen, ChevronRight } from "lucide-react";
import { ContextInstrument } from "@/components/ContextInstrument";
import { Brand } from "@/components/Brand";
import { BottomSheet } from "@/components/BottomSheet";
import { Player } from "@/components/Player";
import { SessionReview, type SessionReviewData } from "@/components/SessionReview";
import { SessionPresetPrompt } from "@/components/SessionPresetPrompt";
import { useAuth } from "@/context/AuthContext";
import { SourceSheet } from "@/components/SourceSheet";
import { SessionCard } from "@/components/SessionCard";
import type { MediaPosition } from "@/components/InlineMedia";
import { SessionShortsPlayer } from "@/components/SessionShortsPlayer";
import { SessionBuilding } from "@/components/SessionBuilding";
import { useSessionPlayback } from "@/lib/sessionPlayback";
import { useImmersiveShorts, useShortsMode } from "@/lib/shortsMode";
import * as perf from "@/lib/perf";
import { createShortsBus } from "@/lib/shortsBus";
import { cardRender, isMedia, isVideo } from "@/lib/render";
import { usePreferences } from "@/context/PreferencesContext";
import { SHIPPED_LAYOUT, SHIPPED_VARS, cardVars, solveWhenReady } from "@/lib/cardLayout";

// Which in-app content surface an item opens into (#51). Video/audio play in
// the Player; everything else (article/rss/quote/text) reads in the ReaderPage.
function contentKind(item: Item): "video" | "audio" | "read" {
  if (item.media_type === "short" || item.media_type === "long" || item.media_type === "live") return "video";
  if (item.media_type === "audio") return "audio";
  return "read";
}

// #67/#79: the session is durable. This page drives entirely off the backend
// session identified by the URL id - it does NOT rebuild a topic. On load it
// resumes the active session (its stored queue + cursor); as the user advances it
// persists the cursor. When the session is over (elapsed >= the single duration,
// or the queue is exhausted) it does NOT yank the user out (#79): the current
// item stays readable as long as they like. The end only surfaces as a terminal
// end-card the *next time they advance for more*. A refresh mid-session lands
// back on the same items at the same place.
type Checkin = null | "fast";

// Mindfulness check-in tuning (#68/#137). The nudge is pattern-based, not
// speed-based: pass this many cards in a row without opening ANY (open/click/
// save) before the calm check-in surfaces. Deliberately high - a real "scrolling
// past everything" run, not a few skipped headlines. Any engagement resets it.
const FAST_STREAK = 8;

export default function SessionPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const fromBuild = !!(useLocation().state as { building?: boolean } | null)?.building;
  const { user } = useAuth();
  const [shortsMode, setShortsMode] = useShortsMode();
  const [immersivePref, setImmersive] = useImmersiveShorts();
  const playback = useSessionPlayback(user?.id, id);
  const lastShort = useRef<Selected | null>(null);
  const shortsPosition = useRef<MediaPosition | null>(null);
  const cacheKey = `otium:session:${user?.id ?? "unknown"}`;
  const { motionAllowed, prefs, presentation } = usePreferences();

  const [items, setItems] = useState<Selected[]>([]);
  const [current, setCurrent] = useState(0);
  // #182: the card hosting the shared Shorts player. It follows `current` only
  // once the reel stops scrolling, so YouTube's clip-loading work never lands in
  // the middle of a swipe; the clip you are leaving keeps playing as it scrolls
  // away and the incoming card shows its poster.
  const [playerIdx, setPlayerIdx] = useState(0);
  const currentRef = useRef(0);
  currentRef.current = current;
  const playerCommit = useRef(0);
  const commitPlayer = useRef(() => {});
  commitPlayer.current = () => { window.clearTimeout(playerCommit.current); setPlayerIdx(currentRef.current); };
  const scheduleCommit = useRef((delay: number) => {
    window.clearTimeout(playerCommit.current);
    playerCommit.current = window.setTimeout(() => commitPlayer.current(), delay);
  });
  const shortsBus = useRef(createShortsBus()).current;
  // Where an in-flight smooth Next/Prev is heading; cleared when the reel settles.
  const scrollTarget = useRef<number | null>(null);
  const [duration, setDuration] = useState(15); // minutes; the single chosen length (#69)
  const [themes, setThemes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [saveItem, setSaveItem] = useState<Item | null>(null); // Save picker target (#57)
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false);
  const [review, setReview] = useState<SessionReviewData | null>(null);
  const reviewRef = useRef<SessionReviewData | null>(null);
  const [saved, setSaved] = useState<Record<number, boolean>>({});
  const [reviewMedia, setReviewMedia] = useState<Selected | null>(null);
  const [extending, setExtending] = useState(false);
  const [ending, setEnding] = useState(false);
  const endConfirmed = useRef(false);
  const [endError, setEndError] = useState("");
  const [breakdown, setBreakdown] = useState<Selected | null>(null);
  const [content, setContent] = useState<Selected | null>(null); // the in-app content surface (#51)
  const [sourceSel, setSourceSel] = useState<Selected | null>(null); // source context menu target (#75)
  // #96: content-aware callout state. renderMap holds the authoritative 3-state
  // `render` once the content endpoint resolves an item; until then the card uses
  // the synchronous cardRender() guess. contentCache retains the fetched body so
  // opening the reader is instant (no second round-trip).
  const [renderMap, setRenderMap] = useState<Record<number, ItemRender>>({});
  const contentCache = useRef<Map<number, ItemContent>>(new Map());
  // #79: when the time budget runs out we freeze the reel here (the index the
  // user was on) instead of navigating - the queue collapses to this item + a
  // terminal end-card, so "keep reading" works and "go further" hits the end.
  // null = session still running (show the full queue).
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const durationSec = duration * 60;

  // #79: how many real cards the reel shows. Full queue while running; once the
  // time budget freezes it (overIdx), collapse to that item + the end-card so
  // going further can only land on the end. The end-card lives at index
  // `visibleCount`. Declared here (above the effects that read it) so the
  // IntersectionObserver closure sees a defined binding.
  const visibleCount = overIdx !== null ? Math.min(overIdx + 1, items.length) : items.length;

  const [elapsed, setElapsed] = useState(0);
  const [checkin, setCheckin] = useState<Checkin>(null);
  const [ytHistory, setYtHistory] = useState(false); // #151: YouTube embed host (nocookie vs youtube.com)
  // Dwell + fast-scroll check-in (#68). fastCheckin gates BOTH the dwell
  // measurement and the nudge; off = old explicit-only behavior. Read via a ref
  // inside the IntersectionObserver so toggling it never re-subscribes the
  // observer. shownAt marks when the current item became engaged (wall-clock),
  // so dwell = advance time - shownAt. fastStreak counts consecutive fast +
  // unengaged advances - the "scrolling fast without engaging" signal.
  const fastCheckin = useRef(true);
  const shownAt = useRef(Date.now());
  const fastStreak = useRef(0);
  const shownIds = useRef<Set<number>>(new Set());
  const engaged = useRef<Set<number>>(new Set()); // ids that got open/save
  const played = useRef<Set<number>>(new Set());
  const autoplayed = useRef<Set<number>>(new Set());
  const opened = useRef<Set<number>>(new Set()); // ids that fired an `open` event (dedupe, #51)
  // #135 active-reading timer: the in-app read/watch currently being timed.
  const readTimer = useRef<{ itemId: number; kind: string; openedAt: number; hiddenMs: number; hiddenSince: number | null } | null>(null);
  // #149 recap accounting. In-app consumption time split by kind (article read vs
  // video watch vs audio listen), so the recap can report each with its own total.
  const readMsByKind = useRef<{ read: number; video: number; audio: number }>({ read: 0, video: 0, audio: 0 });
  // Headlines advanced past without engaging (the "rest of the time" bucket), and
  // the distinct sources a card was actually shown from this session.
  const skipCount = useRef(0);
  const skippedIds = useRef<Set<number>>(new Set());
  const exposedSources = useRef<Set<number>>(new Set());
  // Session wall-clock start + time the tab was hidden (screen off / app switched),
  // so the recap can separate "time away from otium" from active session time.
  const sessionStart = useRef(Date.now());
  const awayMs = useRef(0);
  const awaySince = useRef<number | null>(null);
  const lastContent = useRef<Selected | null>(null); // retains the surface item through the exit anim
  const prevIdx = useRef(0);
  const endRequest = useRef<Promise<unknown>>(Promise.resolve());
  const endedServer = useRef(false); // did we already mark the session ended server-side
  const didInitialScroll = useRef(false);
  // #103: suppress cursor persistence during the initial resume. Otherwise the
  // observer briefly reporting item 0 (before the resume-scroll lands) fires the
  // debounced save and clobbers the stored cursor back to 0 - so every refresh
  // resumes at the beginning. Lifted once the resume-scroll has settled.
  const suppressPersist = useRef(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const itemEls = useRef<(HTMLDivElement | null)[]>([]);

  const persistActivity = useRef<() => void>(() => {});
  persistActivity.current = () => {
    if (loading) return;
    try {
      const lightweight = (list: Selected[]) => list.map((sel) => ({ ...sel, item: { ...sel.item, content: "" } }));
      localStorage.setItem(cacheKey, JSON.stringify({ id, items: lightweight(items), duration, themes, endConfirmed: endConfirmed.current,
        review: reviewRef.current ? { ...reviewRef.current, items: lightweight(reviewRef.current.items) } : null,
        elapsed, seen: [...shownIds.current], opened: [...opened.current], played: [...played.current], autoplayed: [...autoplayed.current], engaged: [...engaged.current],
        skipped: [...skippedIds.current], skips: skipCount.current, reading: readMsByKind.current,
        sources: [...exposedSources.current], away: awayMs.current }));
    } catch { /* Local storage may be unavailable; the server still owns the queue. */ }
  };
  const finishSessionRef = useRef<() => void>(() => {});
  function finishSession() {
    if (reviewRef.current) return;
    stopRead();
    const snapshot: SessionReviewData = {
      items: items.filter((sel, index, all) => shownIds.current.has(sel.item.id) && all.findIndex((entry) => entry.item.id === sel.item.id) === index),
      opened: [...opened.current], played: [...played.current], skipped: [...skippedIds.current], skips: skipCount.current,
      activeSeconds: elapsed, awaySeconds: awayMs.current / 1000, reading: { ...readMsByKind.current },
      sources: exposedSources.current.size, cursor: Math.min(current, items.length - 1), duration,
    };
    reviewRef.current = snapshot;
    setReview(snapshot);
    setCheckin(null);
    setMenuOpen(false);
    setDetailsOpen(false);
    endServer();
    persistActivity.current();
  }

  finishSessionRef.current = finishSession;

  useEffect(() => {
    if (!recapOpen || !review) return;
    let cancelled = false;
    void Promise.all(review.items.map(async ({ item }) => {
      try { const collections = await api.collections(item.id); return [item.id, collections.some((collection) => collection.contains)] as const; }
      catch { return [item.id, false] as const; }
    })).then((entries) => { if (!cancelled) setSaved(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [recapOpen, review]);

  function closeSave() {
    const target = saveItem;
    setSaveItem(null);
    if (target) void api.collections(target.id).then((collections) => {
      const contains = collections.some((collection) => collection.contains);
      setSaved((previous) => ({ ...previous, [target.id]: contains }));
      if (contains && !reviewRef.current) engaged.current.add(target.id);
    }).catch(() => {});
  }

  // The authoritative render state for a card's callout (#96): the resolved value
  // once fetched, else the synchronous guess off the payload.
  function renderOf(item: Item): ItemRender {
    return renderMap[item.id] ?? cardRender(item);
  }

  // endServer marks the session ended server-side, once (idempotent). It does NOT
  // navigate (#79) - the durable "ended" status is only written when the session
  // is genuinely done (the user reached the end-card or chose to leave), so a
  // refresh while still reading past the time budget resumes the session intact.
  const endServer = useCallback(() => {
    if (endedServer.current) return;
    endedServer.current = true;
    setEndError("");
    setEnding(true);
    endConfirmed.current = false;
    if (id) endRequest.current = api.updateSession(id, { status: "ended" }).then(() => {
      endConfirmed.current = true;
      persistActivity.current();
    }).catch((error) => {
      endedServer.current = false;
      setEndError(`Could not end the session: ${String(error.message ?? error)}`);
    }).finally(() => setEnding(false));
  }, [id]);

  // goHome ends the session and returns to intent. The explicit exit for the
  // end-card's "Start a new session", the fast-scroll "Something else", and the
  // empty-state button. Never fired automatically (#79).
  const goHome = useCallback(() => {
    if (extending || ending) return;
    endServer();
    nav("/");
  }, [endServer, nav, extending, ending]);

  // Load / resume the active session by id. If there is no active session, or the
  // URL points at a session that's no longer current (superseded / ended), this
  // URL is stale - go home ("this session's over").
  useEffect(() => {
    let cancelled = false;
    endedServer.current = false;
    endConfirmed.current = false;
    didInitialScroll.current = false;
    shortsPosition.current = null;
    suppressPersist.current = true;
    setLoading(true);
    setErr("");
    let cached: any = null;
    try { cached = JSON.parse(localStorage.getItem(cacheKey) || "null"); } catch { /* no local activity */ }
    if (cached?.id !== id) cached = null;
    setElapsed(cached?.elapsed ?? 0);
    reviewRef.current = cached?.review ?? null;
    setReview(reviewRef.current);
    setRecapOpen(false);
    setOverIdx(null);
    setCheckin(null);
    fastStreak.current = 0;
    shownAt.current = Date.now();
    shownIds.current = new Set(cached?.seen ?? []);
    engaged.current = new Set(cached?.engaged ?? []);
    opened.current = new Set(cached?.opened ?? []);
    played.current = new Set(cached?.played ?? []);
    autoplayed.current = new Set(cached?.autoplayed ?? []);
    readMsByKind.current = cached?.reading ?? { read: 0, video: 0, audio: 0 };
    skipCount.current = cached?.skips ?? 0;
    skippedIds.current = new Set(cached?.skipped ?? []);
    exposedSources.current = new Set(cached?.sources ?? []);
    sessionStart.current = Date.now();
    awayMs.current = cached?.away ?? 0;
    awaySince.current = null;
    if (cached?.review && cached?.items?.length) {
      setItems(cached.items);
      setDuration(cached.duration);
      setThemes(cached.themes ?? []);
      setCurrent(cached.review.cursor);
      prevIdx.current = cached.review.cursor;
      endConfirmed.current = cached.endConfirmed ?? true;
      endedServer.current = endConfirmed.current;
      if (!endConfirmed.current) setEndError("This session's ending could not be confirmed. Retry to mark it ended.");
      setLoading(false);
      return;
    }
    api
      .currentSession()
      .then((s) => {
        if (cancelled) return;
        if (!s || !s.session_id || s.session_id !== id) {
          nav("/", { replace: true });
          return;
        }
        setItems(s.items);
        setDuration(s.duration_min > 0 ? s.duration_min : 15);
        setThemes(s.themes ?? []);
        const start = Math.min(Math.max(0, s.cursor), Math.max(0, s.items.length - 1));
        setCurrent(start);
        prevIdx.current = start;
        // Local activity records exactly which items were displayed. A cursor
        // alone is not evidence that every earlier queue item was shown.
        setLoading(false);
      })
      .catch((e: any) => {
        if (!cancelled) {
          setErr(String(e.message ?? e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, nav, cacheKey]);

  // Solve the focused card's layout.
  //
  // A card is a fixed box with no inner scroll, so how its height is divided has
  // to be decided against real measurements - see lib/cardLayout. Only the focused
  // card is solved: it is the only one whose media is live, and the off-screen
  // ones are thumbnails nobody is looking at. Re-runs when the focus moves, when
  // the item's resolved render state changes what the row holds, and on resize.
  useEffect(() => {
    const stage = stageRef.current;
    const card = itemEls.current[current];
    if (!stage || !card || review) return;
    let cancel = solveWhenReady(stage, stage, card, SHIPPED_LAYOUT);
    const onResize = () => {
      cancel();
      cancel = solveWhenReady(stage, stage, card, SHIPPED_LAYOUT);
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(stage);
    window.addEventListener("resize", onResize);
    return () => {
      cancel();
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [current, items, renderMap, prefs, presentation, review, shortsMode]);

  // Once a card becomes the focus, finish its snap before painting. WebKit can
  // reset an in-flight smooth scroll when the previous card's iframe is removed.
  // The same anchor keeps this card in place when the instrument changes height
  // between Shorts and ordinary cards, or the viewport is resized.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || loading || review) return;
    const anchor = () => {
      const top = current * stage.clientHeight;
      // A smooth Next/Prev already heading here finishes on its own; setting
      // scrollTop mid-animation made Chromium land 48px off (#184).
      if (scrollTarget.current === top) return;
      if (Math.abs(stage.scrollTop - top) > 1) stage.scrollTop = top;
    };
    anchor();
    let height = stage.clientHeight;
    const observer = new ResizeObserver(() => {
      if (stage.clientHeight === height) return;
      height = stage.clientHeight;
      anchor();
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [current, loading, review, shortsMode]);

  // Resume scroll: after the queue renders, jump (no animation) to the stored
  // cursor so a refresh lands where the user left off.
  useEffect(() => {
    if (loading || review || didInitialScroll.current || items.length === 0) return;
    didInitialScroll.current = true;
    const stage = stageRef.current;
    if (!stage) {
      suppressPersist.current = false;
      return;
    }
    // Each card is exactly one stage height, so the resumed item sits at
    // index * height. A direct scrollTop is deterministic - scrollIntoView on a
    // mandatory-snap container is unreliable on some (e-ink) browsers and can
    // leave the reader at the top. Re-assert after a beat for slow layout, then
    // re-enable cursor persistence so genuine advances save again.
    const target = current;
    const jump = () => {
      if (prevIdx.current === target) stage.scrollTop = target * stage.clientHeight;
    };
    requestAnimationFrame(jump);
    window.setTimeout(() => {
      jump();
      suppressPersist.current = false;
    }, 300);
  }, [loading, items, current, review]);

  // Load the fast-scroll check-in setting once. When off, no dwell is measured
  // and no nudge fires (the observer reads fastCheckin.current at advance time).
  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        fastCheckin.current = s.fast_scroll_checkin;
        setYtHistory(s.youtube_history); // #151: which YouTube host the inline player embeds from
      })
      .catch(() => {});
  }, []);

  // #96: resolve the focused card's render state + prefetch its reader body. Only
  // for readable items (video/audio are always "external" and need no fetch) and
  // only once per id (cached). This both fixes the callout label and makes the
  // reader open instantly. Skips the end-card index.
  useEffect(() => {
    if (loading || current >= visibleCount) return;
    const it = items[current]?.item;
    if (!it || isMedia(it) || contentCache.current.has(it.id)) return;
    let cancelled = false;
    api
      .itemContent(it.id)
      .then((c) => {
        if (cancelled) return;
        contentCache.current.set(it.id, c);
        setRenderMap((m) => ({ ...m, [it.id]: c.render }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [current, items, loading, visibleCount]);

  // Active-time ticker (pauses while hidden).
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible" && !reviewRef.current) setElapsed((e) => e + 1);
      persistActivity.current();
    }, 1000);
    return () => window.clearInterval(t);
  }, []);


  // #149: the header "← intent" asks to end the session. Every end route shows the
  // recap (same as running out of time), so the stats are never skipped. We ack the
  // event synchronously so the header knows it was handled and doesn't also navigate.
  useEffect(() => {
    const onEnd = (e: Event) => {
      (e as CustomEvent).detail?.ack?.();
      finishSession();
    };
    window.addEventListener("otium:request-end", onEnd);
    return () => window.removeEventListener("otium:request-end", onEnd);
  });

  // Flush the latest pending cursor on departure as well as after scrolling.
  const pendingCursor = useRef<{ id: string; cursor: number } | null>(null);
  useEffect(() => {
    if (loading || review || !id || suppressPersist.current) return;
    pendingCursor.current = { id, cursor: current };
    const t = window.setTimeout(() => {
      pendingCursor.current = null;
      api.updateSession(id, { cursor: current }).catch(() => {});
    }, 250);
    return () => window.clearTimeout(t);
  }, [current, id, loading, review]);
  useEffect(() => () => {
    const pending = pendingCursor.current;
    if (pending) void api.updateSession(pending.id, { cursor: pending.cursor }).catch(() => {});
  }, []);

  // Time budget reached (#79): the single duration is up. Do NOT navigate - just
  // freeze the reel at wherever the user is (overIdx). The queue collapses to
  // this item plus a terminal end-card, so they can keep reading the current item
  // indefinitely and only meet the end when they advance for more. Works even
  // while mid-read in the content surface: the collapse happens behind the open
  // page, so nothing yanks them out.
  useEffect(() => {
    if (loading || items.length === 0 || overIdx !== null) return;
    if (elapsed >= durationSec) setOverIdx(current);
  }, [elapsed, durationSec, loading, items.length, overIdx, current]);

  // #135: pause the active-read timer while the tab is hidden (backgrounded /
  // screen locked), so "time spent" reflects real attention, not a left-open tab.
  // #149: also accrue whole-session away time (tab hidden for any reason) so the
  // recap can report "time away from otium" as its own line.
  useEffect(() => {
    function onVis() {
      if (reviewRef.current) return;
      const t = readTimer.current;
      if (t) {
        if (document.hidden) {
          if (t.hiddenSince === null) t.hiddenSince = Date.now();
        } else if (t.hiddenSince !== null) {
          t.hiddenMs += Date.now() - t.hiddenSince;
          t.hiddenSince = null;
        }
      }
      if (document.hidden) {
        if (awaySince.current === null) awaySince.current = Date.now();
      } else if (awaySince.current !== null) {
        awayMs.current += Date.now() - awaySince.current;
        awaySince.current = null;
      }
    }
    document.addEventListener("visibilitychange", onVis);
    const save = () => persistActivity.current();
    window.addEventListener("pagehide", save);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", save); stopRead(); persistActivity.current(); };
  }, []);

  // #135: whenever the in-app reader clears (via any path - scrim, back button,
  // popstate), flush the active-read time. stopRead no-ops if nothing's timing.
  useEffect(() => {
    if (content === null) stopRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  // Scroll-snap: an IntersectionObserver marks the centered item as current,
  // marks it seen, and tracks advance pace (fast-flicking check-in). No refill -
  // the queue is fixed and durable.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || review) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting || reviewRef.current) continue;
          const idx = Number((en.target as HTMLElement).dataset.idx);
          if (Number.isNaN(idx)) continue;
          // Leaving a card flushes any inline watch/read time it accrued (#135):
          // media plays in-card with no open/close event to hang the flush on.
          if (idx !== prevIdx.current) {
            stopRead();
            perf.focusChanged(prevIdx.current, idx, items[idx]?.item.media_type ?? "end");
          }
          setCurrent(idx);
          // Finalize the item we just moved past.
          if (idx > prevIdx.current) {
            const left = items[prevIdx.current];
            if (left) {
              const now = Date.now();
              const dwellMs = now - shownAt.current;
              // Engagement (#68): opened the reader/player, clicked through, liked,
              // or saved - all land in engaged.current. That's the "genuinely
              // consuming it" read.
              const wasEngaged = engaged.current.has(left.item.id);
              const autoWatched = autoplayed.current.has(left.item.id);
              // An actual autoplay is playback, not an explicit open or rejection.
              // Keep its provenance separate from engagement and headline skips.
              if (!wasEngaged && !autoWatched) {
                api.itemEvent(left.item.id, "skip", id).catch(() => {});
                skipCount.current += 1;
                skippedIds.current.add(left.item.id); // #149: a headline passed without opening
              }
              // Dwell measurement + the fast-scroll nudge are gated by the setting.
              // Dwell is append-only raw material (never re-ranks); the nudge is a
              // check-in, not a topic change.
              if (fastCheckin.current) {
                api.recordDwell(left.item.id, id, dwellMs, wasEngaged).catch(() => {});
                // #137: intervene on a PATTERN, not raw speed - passing card after
                // card without opening ANY of them (regardless of how fast). Any
                // engagement (open/like/save) resets the streak, so this only trips
                // on a genuine "scrolling past everything" run, never on skimming a
                // few headlines looking for something worth opening.
                if (!wasEngaged && !autoWatched) {
                  fastStreak.current += 1;
                  if (fastStreak.current >= FAST_STREAK && !checkin) setCheckin("fast");
                } else {
                  fastStreak.current = 0; // any engagement (open/save) resets it
                }
              }
            }
          }
          prevIdx.current = idx;
          shownAt.current = Date.now(); // the newly-centered item starts its dwell now
          // Reaching the terminal end-card (#79) is the moment the session is
          // genuinely done: mark it ended server-side (idempotent). No nav.
          if (idx >= visibleCount) {
            finishSessionRef.current();
            continue;
          }
          const it = items[idx];
          if (it && !shownIds.current.has(it.item.id)) {
            shownIds.current.add(it.item.id);
            exposedSources.current.add(it.item.source_id); // #149: a source shown to you
            api.itemEvent(it.item.id, "seen", id).catch(() => {});
          }
        }
      },
      { root: stage, threshold: 0.6 },
    );
    itemEls.current.forEach((el) => el && obs.observe(el));
    // #182: scroll idle closes a transition's settle time. scrollend where
    // supported; a short debounce elsewhere.
    let idle = 0;
    // scrollend hands the player over as soon as the snap finishes. A busy main
    // thread can space scroll events further apart than a short debounce, which
    // would start the next clip's load mid-swipe, so the idle fallback is long
    // where scrollend exists (WebKit skips it for some instant scrolls) and
    // moderate where it does not.
    const idleMs = "onscrollend" in window ? 400 : 220;
    const onScroll = () => {
      window.clearTimeout(idle);
      window.clearTimeout(playerCommit.current);
      idle = window.setTimeout(() => { finishTarget(); perf.scrollSettled(); commitPlayer.current(); }, idleMs);
    };
    const finishTarget = () => {
      const target = scrollTarget.current;
      scrollTarget.current = null;
      if (target !== null && Math.abs(stage.scrollTop - target) > 1) stage.scrollTop = target;
    };
    const onScrollEnd = () => { window.clearTimeout(idle); finishTarget(); perf.scrollSettled(); commitPlayer.current(); };
    stage.addEventListener("scroll", onScroll, { passive: true });
    stage.addEventListener("scrollend", onScrollEnd);
    return () => {
      obs.disconnect();
      window.clearTimeout(idle);
      stage.removeEventListener("scroll", onScroll);
      stage.removeEventListener("scrollend", onScrollEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, id, checkin, visibleCount, review]);

  useEffect(() => {
    if (playerIdx !== current) scheduleCommit.current(160);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  useEffect(() => () => window.clearTimeout(playerCommit.current), []);

  // Each card is exactly one stage height, so the target is index * height (the
  // anchor and resume logic rely on the same). scrollIntoView({block: center})
  // also weighs the window's viewport and landed 48px short in full-screen
  // Shorts (#184), leaving the card under the floating header.
  function scrollTo(idx: number) {
    const stage = stageRef.current;
    if (!stage || !itemEls.current[idx]) return;
    const top = idx * stage.clientHeight;
    scrollTarget.current = motionAllowed ? top : null;
    stage.scrollTo({ top, behavior: motionAllowed ? "smooth" : "instant" });
  }

  const cur = items[current];
  const atEnd = current >= visibleCount;

  // #184: full-screen Shorts. The reel takes the whole viewport for the session
  // (so card geometry never changes between Shorts and articles), and the app
  // header and pill float over it, restyled while a Short is under them.
  // Only sessions that contain Shorts: a News session keeps the normal layout.
  const hasShorts = useMemo(() => items.some((sel) => sel.item.media_type === "short"), [items]);
  const immersive = shortsMode && immersivePref && hasShorts && !review;
  const overVideo = immersive && !atEnd && cur?.item.media_type === "short";
  useEffect(() => {
    const root = document.documentElement;
    if (immersive) root.dataset.immersive = "on"; else delete root.dataset.immersive;
    if (overVideo) root.dataset.overVideo = "on"; else delete root.dataset.overVideo;
  }, [immersive, overVideo]);
  useEffect(() => () => { delete document.documentElement.dataset.immersive; delete document.documentElement.dataset.overVideo; }, []);


  // The in-app content surface (#51). Retain the item through the close
  // animation so the surface doesn't blank as it slides away.
  if (content) lastContent.current = content;
  const shown = content ?? lastContent.current;
  const shownKind = shown ? contentKind(shown.item) : null;
  const shownContent = shown ? contentCache.current.get(shown.item.id) ?? null : null;

  // Tap-to-open (#47) vs scroll-snap drag vs swipe-to-advance (#10). Track the
  // pointer from press to release: past a small move threshold it's a scroll, a
  // dominant leftward drag on the focused card advances it.
  const SWIPE_DIST = 60; // px of horizontal travel to count as a swipe
  const SWIPE_DOMINANCE = 1.3; // horizontal must beat vertical by this factor
  const press = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  function cardPointerDown(e: ReactPointerEvent) {
    press.current = null;
    suppressClick.current = false;
    if (!e.isPrimary || (window.visualViewport?.scale ?? 1) > 1 || e.button !== 0 || (e.target as Element).closest("button, a, input, video, audio, iframe, [role=button]")) return;
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  }
  function cardPointerMove(e: ReactPointerEvent) {
    const p = press.current;
    if (p?.id === e.pointerId && (Math.abs(e.clientX - p.x) > 10 || Math.abs(e.clientY - p.y) > 10)) p.moved = true;
  }
  function cardPointerCancel() {
    press.current = null;
    suppressClick.current = true;
  }
  function cardPointerUp(e: ReactPointerEvent, i: number) {
    const p = press.current;
    press.current = null;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    suppressClick.current = p.moved || Math.abs(dx) > 10 || Math.abs(dy) > 10;
    if (i === current && dx <= -SWIPE_DIST && Math.abs(dx) >= Math.abs(dy) * SWIPE_DOMINANCE) next();
  }
  function cardClick(sel: Selected) {
    press.current = null;
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    engage(sel);
  }

  // The content-aware primary engagement (#96). full_text -> reader page;
  // media plays inline in the card (no modal), so a body tap there is a no-op -
  // the embedded player owns interaction; preview/external -> original in a new tab.
  function engage(sel: Selected) {
    if (isMedia(sel.item)) return;
    const r = renderOf(sel.item);
    if (r === "full_text") openContent(sel);
    else openExternal(sel);
  }

  // Opening content in-app (or handing off to the source) is genuine
  // consumption: fire an `open` event exactly once per item so it counts as
  // engagement, not a skip.
  function recordOpen(sel: Selected) {
    if (reviewRef.current) return;
    engaged.current.add(sel.item.id);
    if (!opened.current.has(sel.item.id)) {
      opened.current.add(sel.item.id);
      api.itemEvent(sel.item.id, "open", id).catch(() => {});
    }
  }
  // The shared Overlay owns browser history for the reader and nested sheets.
  // SessionPage only opens/closes content and accounts for active reading time.
  function readKind(it: Item): string {
    return isVideo(it) ? "video" : isMedia(it) ? "audio" : "read";
  }
  // #135 active-reading timer: measure time the in-app reader/player is open AND
  // the tab is visible; pause while hidden (see the visibilitychange effect).
  function startRead(sel: Selected) {
    if (reviewRef.current) return;
    if (readTimer.current?.itemId === sel.item.id) return;
    stopRead();
    readTimer.current = {
      itemId: sel.item.id,
      kind: readKind(sel.item),
      openedAt: Date.now(),
      hiddenMs: 0,
      hiddenSince: document.hidden ? Date.now() : null,
    };
  }
  function stopRead() {
    const t = readTimer.current;
    readTimer.current = null;
    if (!t) return;
    const hidden = t.hiddenMs + (t.hiddenSince !== null ? Date.now() - t.hiddenSince : 0);
    const ms = Math.max(0, Date.now() - t.openedAt - hidden);
    const bucket = t.kind === "video" ? "video" : t.kind === "audio" ? "audio" : "read";
    readMsByKind.current[bucket] += ms;
    api.recordRead(t.itemId, id ?? "", ms, false, t.kind).catch(() => {});
  }
  function openContent(sel: Selected) {
    if (isMedia(sel.item)) return; // media plays inline in the card, never in a surface
    recordOpen(sel);
    startRead(sel);
    setContent(sel);
  }
  function closeContent() {
    stopRead();
    setContent(null);
  }
  // #149: swipe-up at the bottom of the reader advances the feed as if the user
  // scrolled to the next card - close the surface and move the reel forward one, so
  // finishing an article flows straight into the next item without a back-then-swipe.
  function readerNext() {
    closeContent();
    next();
  }
  function openExternal(sel: Selected) {
    recordOpen(sel);
    // External read: engagement counted, duration unmeasured (excluded from averages).
    if (!reviewRef.current) api.recordRead(sel.item.id, id ?? "", 0, true, readKind(sel.item)).catch(() => {});
    window.open(sel.item.url, "_blank", "noopener");
  }
  function save(sel: Selected) {
    setSaveItem(sel.item);
  }
  function next() {
    // Advancing past the last shown card lands on the terminal end-card (#79).
    // When the time budget has frozen the reel (overIdx), visibleCount collapses
    // so the very next advance is the end-card - "go further → session's over".
    if (current < visibleCount - 1) scrollTo(current + 1);
    else scrollTo(visibleCount);
  }
  function prev() {
    if (current > 0) scrollTo(current - 1);
  }
  function dismissCheckin() {
    setCheckin(null);
    fastStreak.current = 0;
  }
  // #142: add more time from the session-over hub. Unfreezes the reel and drops
  // the user back where they were (the item we froze at) with the extra minutes,
  // so "add time" feels like the session simply continued.
  async function extend(more: number) {
    if (extending) return;
    setExtending(true);
    setEndError("");
    try {
      await endRequest.current;
      await api.updateSession(id, { extend_min: more });
      const back = reviewRef.current?.cursor ?? overIdx ?? current;
      endedServer.current = false;
      endConfirmed.current = false;
      reviewRef.current = null;
      setReview(null);
      setDuration((d) => d + more);
      setOverIdx(null);
      setRecapOpen(false);
      didInitialScroll.current = false;
      setCurrent(Math.min(back, items.length - 1));
      prevIdx.current = Math.min(back, items.length - 1);
      persistActivity.current();
    } catch (error: any) { setEndError(String(error.message ?? error)); }
    finally { setExtending(false); }
  }


  // Desktop keyboard navigation (#4): arrows page the reel, space/enter opens
  // the focused item, backspace returns to intent. Inert while a sheet or the
  // reader is open (they own their own keys) or while typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (content || menuOpen || detailsOpen || breakdown || saveItem || sourceSel || checkin || review) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input,textarea,select,button,a,[contenteditable]")) return;
      if (e.key.startsWith("Arrow") || e.key === "j" || e.key === "k") perf.noteTrigger("key");
      switch (e.key) {
        case "ArrowDown":
        case "ArrowRight":
        case "j":
          e.preventDefault();
          next();
          break;
        case "ArrowUp":
        case "ArrowLeft":
        case "k":
          e.preventDefault();
          prev();
          break;
        case " ":
        case "Enter":
          if (cur && !atEnd) {
            e.preventDefault();
            engage(cur);
          }
          break;
        case "Backspace":
          e.preventDefault();
          finishSession();
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (err) return <div className={`focus-session afterglow-session ${!review && shortsMode && cur?.item.media_type === "short" ? "shorts-viewing" : ""}`}><div className="center"><p className="err">Couldn't resume your session: {err}</p><button className="btn" onClick={() => window.location.reload()}>Retry</button></div><ContextInstrument mode="app" eyebrow="Session" label="Could not load" action={{ label: "Back", onClick: () => nav("/") }} /></div>;
  // #186: the same building screen Home showed while the server made the session.
  if (loading) return <div className="focus-session afterglow-session"><SessionBuilding label={fromBuild ? "Building your session" : "Opening your session"} continued={fromBuild} /><ContextInstrument mode="session" eyebrow="Session" label="Loading" action={{ label: "Back", onClick: () => nav("/") }} /></div>;
  if (items.length === 0) {
    return (
      <div className="center">
        <p className="display">No items available.</p>
        <p>No eligible items in {themes.length ? themes.join(", ") : "your sources"}.</p>
        <button className="btn ghost" onClick={goHome}>New session</button>
        <ContextInstrument mode="app" eyebrow="Session" label="No items available" action={{ label: "Back", onClick: goHome }} />
      </div>
    );
  }

  const hosted = items[playerIdx];
  const focusedShort = shortsMode && hosted?.item.media_type === "short" && playerIdx < visibleCount && !review ? hosted : null;
  if (focusedShort) lastShort.current = focusedShort;
  const short = lastShort.current;
  const playbackActive = !content && !menuOpen && !detailsOpen && !breakdown && !saveItem && !sourceSel && !checkin && !review;

  const shownItems = overIdx !== null ? items.slice(0, visibleCount) : items;

  return (
    <div className={`focus-session afterglow-session ${!review && shortsMode && cur?.item.media_type === "short" ? "shorts-viewing" : ""}`}>
      {/* Desktop-only keyboard hint (#4); hidden on mobile so the top is clean. */}
      <div className="timestrip">
        <span className="kbd-hint" aria-hidden>
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          move
          <kbd>space</kbd>
          open
          <kbd>⌫</kbd>
          back
        </span>
      </div>

      <BottomSheet open={checkin === "fast"} onClose={dismissCheckin} kicker="Session">
        <div className="session-checkin">
          <p>{fastStreak.current} cards passed without opening any.</p>
          <div className="session-checkin-actions">
            <button className="btn ghost" onClick={dismissCheckin}>Keep going</button>
            <button className="btn" onClick={() => { setCheckin(null); finishSession(); }}>End session</button>
          </div>
        </div>
      </BottomSheet>

      {!review && <div className="stage" ref={stageRef} style={cardVars(SHIPPED_VARS)}>
        {shownItems.map((it, i) => (
          <SessionCard
            key={`${it.item.id}-${i}`}
            sel={it}
            index={i}
            focused={i === current}
            shortsMode={shortsMode}
            persistentShorts
            hostsPlayer={!!focusedShort && i === playerIdx}
            immersive={immersive}
            onImmersiveChange={setImmersive}
            shortsBus={shortsBus}
            shortsPosition={shortsPosition}
            playbackActive={i === current && !content && !menuOpen && !detailsOpen && !breakdown && !saveItem && !sourceSel && !checkin && !review}
            muted={playback.muted}
            onMutedChange={playback.setMuted}
            onPlaybackChange={(playing) => {
              if (playing) startRead(it);
              else if (readTimer.current?.itemId === it.item.id) stopRead();
            }}
            render={renderOf(it.item)}
            hierarchy="taxonomy-credit"
            sectionName={it.topic?.section_name}
            menuPlacement="actions"
            ref={(el) => {
              itemEls.current[i] = el;
            }}
            onOpenContent={openContent}
            onOpenExternal={openExternal}
            onSave={save}
            onSource={(s) => setSourceSel(s)}
            onMenu={() => setMenuOpen(true)}
            onDetails={() => setDetailsOpen(true)}
            onFirstPlay={(s, explicit) => {
              played.current.add(s.item.id);
              if (explicit) recordOpen(s);
              else autoplayed.current.add(s.item.id);
            }}
            onNext={next}
            onPrev={prev}
            ytHistory={ytHistory}
            onPointerDown={cardPointerDown}
            onPointerCancel={cardPointerCancel}
            onPointerMove={cardPointerMove}
            onPointerUp={(e) => cardPointerUp(e, i)}
            onClick={() => cardClick(it)}
          />
        ))}
        {/* Terminal end-card (#79). Reaching it is passive - the session is
            already over; this just offers the way onward. No auto-redirect: the
            user got here by choosing to advance. */}
        <div
          className="snap"
          data-idx={visibleCount}
          ref={(el) => {
            itemEls.current[visibleCount] = el;
          }}
        >
          <div className="center"><p>Session complete</p></div>
        </div>
      </div>}

      {short && <SessionShortsPlayer key={`${user?.id}:${id}`} stage={stageRef} index={playerIdx}
        visible={!!focusedShort} item={short.item} nextItem={shownItems[playerIdx + 1]?.item} bus={shortsBus}
        active={playbackActive} muted={playback.muted} onMutedChange={playback.setMuted}
        positionMemory={shortsPosition} captions={playback.captions} onCaptionsChange={playback.setCaptions} ytHistory={ytHistory}
        onOpenOriginal={() => openExternal(short)} onNext={next} onPrev={prev}
        onFirstPlay={(explicit) => {
          played.current.add(short.item.id);
          if (explicit) recordOpen(short); else autoplayed.current.add(short.item.id);
        }}
        onPlaybackChange={(playing) => {
          if (playing) startRead(short);
          else if (readTimer.current?.itemId === short.item.id) stopRead();
        }} />}

      {review && <div className="session-ending">
        <Brand compact />
        <h1>Session complete</h1>
        <button className="session-review-entry" onClick={() => setRecapOpen(true)}>
          <BookOpen size={22} strokeWidth={1.6} aria-hidden /><span>Review session</span><ChevronRight size={19} aria-hidden />
        </button>
        <div className="session-ending-actions">
          <button className="btn" onClick={goHome} disabled={extending || ending}>New session</button>
          <button className="btn ghost" onClick={() => void extend(5)} disabled={extending || ending}>+5 min</button>
          <button className="btn ghost" onClick={() => void extend(10)} disabled={extending || ending}>+10 min</button>
        </div>
        {endError && <div><p className="err" role="alert">{endError}</p>{!endedServer.current && <button className="btn ghost" onClick={endServer} disabled={extending || ending}>Retry ending session</button>}</div>}
        <SessionPresetPrompt sessionId={id} />
      </div>}

      {/* #186: full screen keeps only a floating Next; the session menu is the
          ··· on each card, and the time phrase is in that menu's header. */}
      {immersive && !atEnd ? (
        <button type="button" className="immersive-next" onClick={() => { perf.noteTrigger("button"); next(); }}>
          Next <ArrowDown size={17} aria-hidden />
        </button>
      ) : (
        <ContextInstrument mode={review ? "app" : "session"} eyebrow={review ? "Session complete" : "Session"}
          label={review ? "Review session" : elapsed >= durationSec ? "Session time reached" : durationSec - elapsed <= 120 ? "A little time left" : durationSec - elapsed <= 300 ? "A few minutes left" : "Session in progress"}
          onMenu={review ? undefined : () => setMenuOpen(true)} menuLabel="Article and session actions"
          onLabel={review ? () => setRecapOpen(true) : undefined}
          action={review ? { label: "Done", onClick: goHome, disabled: extending || ending } : { label: "Next", onClick: () => { perf.noteTrigger("button"); next(); }, icon: <ArrowDown size={18} aria-hidden /> }} />
      )}

      {review && recapOpen && <SessionReview review={review} onClose={() => setRecapOpen(false)} saved={saved} onSave={save}
        onRead={(sel) => { if (isMedia(sel.item)) setReviewMedia(sel); else openContent(sel); }} />}
      <Player item={reviewMedia?.item ?? null} sourceTitle={reviewMedia?.source_title} open={reviewMedia !== null}
        onClose={() => setReviewMedia(null)} onOpenOriginal={() => { if (reviewMedia) openExternal(reviewMedia); }}
        onSave={() => { if (reviewMedia) save(reviewMedia); }} />

      <ItemActions
        selected={atEnd ? null : cur}
        open={menuOpen}
        shortsMode={shortsMode}
        onShortsModeChange={setShortsMode}
        status={immersive ? (elapsed >= durationSec ? "Session time reached" : durationSec - elapsed <= 120 ? "A little time left" : durationSec - elapsed <= 300 ? "A few minutes left" : "Session in progress") : undefined}
        immersive={shortsMode ? immersivePref : undefined}
        onImmersiveChange={(value) => { setMenuOpen(false); setImmersive(value); }}
        nativeControls={shortsBus.get().native}
        onNativeControls={focusedShort && focusedShort === cur ? () => { setMenuOpen(false); shortsBus.controls.toggleNative(); } : undefined}
        onClose={() => setMenuOpen(false)}
        onRead={() => {
          setMenuOpen(false);
          if (cur) openContent(cur);
        }}
        onSave={(it) => {
          setMenuOpen(false);
          setSaveItem(it);
        }}
        onOpenOriginal={() => { setMenuOpen(false); if (cur) openExternal(cur); }}
        onEnd={finishSession}
        onDetails={() => {
          setMenuOpen(false);
          setDetailsOpen(true);
        }}
      />

      <ItemDetails
        selected={atEnd ? null : cur}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        onWhy={() => {
          setDetailsOpen(false);
          if (cur) setBreakdown(cur);
        }}
        onActions={review ? undefined : () => {
          setDetailsOpen(false);
          setMenuOpen(true);
        }}
      />

      <ScoreBreakdownSheet sel={breakdown} open={breakdown !== null} onClose={() => setBreakdown(null)} />

      {/* In-app reader (#51/#85): text reads in the pushed ReaderPage. Media plays
          inline in its card (no modal) - the old Player sheet is retired. */}
      <ReaderPage
        item={shown && shownKind === "read" ? shown.item : null}
        sourceTitle={shown?.source_title}
        preloaded={shownKind === "read" ? shownContent : null}
        open={content !== null && shownKind === "read"}
        onClose={closeContent}
        onOpen={() => shown && openExternal(shown)}
        onSave={() => shown && setSaveItem(shown.item)}
        onNext={review ? undefined : readerNext}
      />

      {/* Source context menu (#75): tapping the source name on a card opens this -
          quick weight, source history, and a path to full settings - without
          leaving the session. */}
      <SourceSheet
        sourceId={sourceSel?.item.source_id ?? 0}
        sourceTitle={sourceSel?.source_title}
        currentItemId={sourceSel?.item.id ?? 0}
        open={sourceSel !== null}
        onClose={() => setSourceSel(null)}
      />

      {/* Save picker (#57): the deliberate save destination for the card Save,
          the ··· menu, and the reader/player. */}
      <SavePicker item={saveItem} open={saveItem !== null} onClose={closeSave} onChange={(item, contains) => {
        setSaved((previous) => ({ ...previous, [item.id]: contains }));
        if (contains && !reviewRef.current) engaged.current.add(item.id);
      }} />
    </div>
  );
}
