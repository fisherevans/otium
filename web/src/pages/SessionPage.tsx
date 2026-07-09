import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Item, type ItemContent, type ItemRender, type Selected } from "@/api/client";
import { ItemActions } from "@/components/ItemActions";
import { ReaderPage } from "@/components/ReaderPage";
import { Player } from "@/components/Player";
import { SavePicker } from "@/components/SavePicker";
import { ScoreBreakdownSheet } from "@/components/ScoreBreakdown";
import { SourceSheet } from "@/components/SourceSheet";
import { TopicPill, CardSource, Byline, Blurb, Media } from "@/components/CardParts";
import { ShareActions } from "@/components/ReaderActions";
import { Heart, Bookmark, BookOpen, Play, ExternalLink } from "lucide-react";
import { cardRender, isMedia, isVideo } from "@/lib/render";
import { mins } from "@/lib/format";

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

// Fast-scroll check-in tuning (#68). An advance counts as a "fast pass" when the
// item was on screen under FAST_DWELL_MS and was never engaged (opened/clicked/
// liked/saved). FAST_STREAK consecutive fast passes trips the calm check-in.
const FAST_DWELL_MS = 4000;
const FAST_STREAK = 3;

export default function SessionPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();

  const [items, setItems] = useState<Selected[]>([]);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(15); // minutes; the single chosen length (#69)
  const [themes, setThemes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [liked, setLiked] = useState<Set<number>>(new Set());
  const [saveItem, setSaveItem] = useState<Item | null>(null); // Save picker target (#57)
  const [menuOpen, setMenuOpen] = useState(false);
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
  const engaged = useRef<Set<number>>(new Set()); // ids that got open/like/save
  const opened = useRef<Set<number>>(new Set()); // ids that fired an `open` event (dedupe, #51)
  const lastContent = useRef<Selected | null>(null); // retains the surface item through the exit anim
  const prevIdx = useRef(0);
  const endedServer = useRef(false); // did we already mark the session ended server-side
  const readerPushed = useRef(false); // is there a history entry backing an open reader (#78)
  const didInitialScroll = useRef(false);
  // #103: suppress cursor persistence during the initial resume. Otherwise the
  // observer briefly reporting item 0 (before the resume-scroll lands) fires the
  // debounced save and clobbers the stored cursor back to 0 - so every refresh
  // resumes at the beginning. Lifted once the resume-scroll has settled.
  const suppressPersist = useRef(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const itemEls = useRef<(HTMLDivElement | null)[]>([]);

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
    if (id) api.updateSession(id, { status: "ended" }).catch(() => {});
  }, [id]);

  // goHome ends the session and returns to intent. The explicit exit for the
  // end-card's "Start a new session", the fast-scroll "Something else", and the
  // empty-state button. Never fired automatically (#79).
  const goHome = useCallback(() => {
    endServer();
    nav("/");
  }, [endServer, nav]);

  // Load / resume the active session by id. If there is no active session, or the
  // URL points at a session that's no longer current (superseded / ended), this
  // URL is stale - go home ("this session's over").
  useEffect(() => {
    let cancelled = false;
    endedServer.current = false;
    didInitialScroll.current = false;
    suppressPersist.current = true;
    setLoading(true);
    setErr("");
    setElapsed(0);
    setOverIdx(null);
    setCheckin(null);
    fastStreak.current = 0;
    shownAt.current = Date.now();
    shownIds.current = new Set();
    engaged.current = new Set();
    opened.current = new Set();
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
        // Items already passed were seen on a prior visit; seed shownIds so we
        // don't re-fire `seen` for them on resume.
        s.items.slice(0, start).forEach((it) => shownIds.current.add(it.item.id));
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
  }, [id, nav]);

  // Resume scroll: after the queue renders, jump (no animation) to the stored
  // cursor so a refresh lands where the user left off.
  useEffect(() => {
    if (loading || didInitialScroll.current || items.length === 0) return;
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
      stage.scrollTop = target * stage.clientHeight;
    };
    requestAnimationFrame(jump);
    window.setTimeout(() => {
      jump();
      suppressPersist.current = false;
    }, 300);
  }, [loading, items, current]);

  // Load the fast-scroll check-in setting once. When off, no dwell is measured
  // and no nudge fires (the observer reads fastCheckin.current at advance time).
  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        fastCheckin.current = s.fast_scroll_checkin;
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
      if (document.visibilityState === "visible") setElapsed((e) => e + 1);
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  // Back gesture / button closes an open reader instead of navigating (#78). Only
  // acts when a reader-backed history entry is live; otherwise back navigates the
  // SPA as usual. The entry is already popped by the browser here, so we just
  // clear our flag and close the surface.
  useEffect(() => {
    const onPop = () => {
      if (readerPushed.current) {
        readerPushed.current = false;
        setContent(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Persist the cursor as the user advances (debounced). The backend only accepts
  // a cursor write on an active session, so a late write is a harmless no-op.
  useEffect(() => {
    if (loading || !id || suppressPersist.current) return;
    const t = window.setTimeout(() => {
      api.updateSession(id, { cursor: current }).catch(() => {});
    }, 500);
    return () => window.clearTimeout(t);
  }, [current, id, loading]);

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

  // Scroll-snap: an IntersectionObserver marks the centered item as current,
  // marks it seen, and tracks advance pace (fast-flicking check-in). No refill -
  // the queue is fixed and durable.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const idx = Number((en.target as HTMLElement).dataset.idx);
          if (Number.isNaN(idx)) continue;
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
              // Advancing forward without engaging is a skip (next == skip). This
              // is an EXPLICIT curation signal - always fired, independent of the
              // dwell setting.
              if (!wasEngaged) api.itemEvent(left.item.id, "skip", id).catch(() => {});
              // Dwell measurement + the fast-scroll nudge are gated by the setting.
              // Dwell is append-only raw material (never re-ranks); the nudge is a
              // check-in, not a topic change.
              if (fastCheckin.current) {
                api.recordDwell(left.item.id, id, dwellMs, wasEngaged).catch(() => {});
                // A fast, unengaged pass = scrolling past without consuming.
                // Consecutive such passes are the drift signal; engaging or
                // dwelling on anything resets the streak.
                if (!wasEngaged && dwellMs < FAST_DWELL_MS) {
                  fastStreak.current += 1;
                  if (fastStreak.current >= FAST_STREAK && !checkin) setCheckin("fast");
                } else {
                  fastStreak.current = 0;
                }
              }
            }
          }
          prevIdx.current = idx;
          shownAt.current = Date.now(); // the newly-centered item starts its dwell now
          // Reaching the terminal end-card (#79) is the moment the session is
          // genuinely done: mark it ended server-side (idempotent). No nav.
          if (idx >= visibleCount) {
            endServer();
            continue;
          }
          const it = items[idx];
          if (it && !shownIds.current.has(it.item.id)) {
            shownIds.current.add(it.item.id);
            api.itemEvent(it.item.id, "seen", id).catch(() => {});
          }
        }
      },
      { root: stage, threshold: 0.6 },
    );
    itemEls.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, id, checkin, visibleCount]);

  function scrollTo(idx: number) {
    const el = itemEls.current[idx];
    // Instant snap, not a smooth glide: good e-ink panels (Plasma 2) render a
    // smooth-scroll as a low-framerate jitter, so we jump straight to the card.
    if (el) el.scrollIntoView({ block: "center" });
  }

  const cur = items[current];
  const atEnd = current >= visibleCount;

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
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  function cardPointerDown(e: ReactPointerEvent) {
    press.current = { x: e.clientX, y: e.clientY, moved: false };
  }
  function cardPointerMove(e: ReactPointerEvent) {
    const p = press.current;
    if (p && (Math.abs(e.clientX - p.x) > 10 || Math.abs(e.clientY - p.y) > 10)) p.moved = true;
  }
  function cardPointerUp(e: ReactPointerEvent, i: number) {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    // A dominant leftward drag on the focused card advances it (liking is an
    // explicit heart-button tap, not a gesture).
    if (i === current && dx <= -SWIPE_DIST && Math.abs(dx) >= Math.abs(dy) * SWIPE_DOMINANCE) {
      p.moved = true; // keep cardClick from treating the follow-up click as a tap
      next();
    }
  }
  function cardClick(sel: Selected) {
    const p = press.current;
    press.current = null;
    if (p?.moved) return; // it was a scroll or a swipe, not a tap
    // Title/body tap is content-aware (#96): full text reads in-app, video/audio
    // play in-app, and a link-only article opens the original in a new tab.
    engage(sel);
  }

  // The content-aware primary engagement (#96). full_text -> reader page;
  // video/audio -> Player; preview/external article -> original in a new tab.
  function engage(sel: Selected) {
    const r = renderOf(sel.item);
    if (r === "full_text") openContent(sel);
    else if (isMedia(sel.item)) openContent(sel);
    else openExternal(sel);
  }

  // Opening content in-app (or handing off to the source) is genuine
  // consumption: fire an `open` event exactly once per item so it counts as
  // engagement, not a skip.
  function recordOpen(sel: Selected) {
    engaged.current.add(sel.item.id);
    if (!opened.current.has(sel.item.id)) {
      opened.current.add(sel.item.id);
      api.itemEvent(sel.item.id, "open", id).catch(() => {});
    }
  }
  // Opening the reader/player pushes a history entry (#78) so the Android back
  // gesture / browser back closes it instead of navigating the SPA out of the
  // session. popstate (above) closes it; closeContent pops the entry when
  // dismissed by the back button / scrim so history stays balanced.
  function openContent(sel: Selected) {
    recordOpen(sel);
    setContent(sel);
    if (!readerPushed.current) {
      window.history.pushState({ otiumReader: true }, "");
      readerPushed.current = true;
    }
  }
  function closeContent() {
    setContent(null);
    if (readerPushed.current) {
      readerPushed.current = false;
      window.history.back(); // consume our pushed entry (fires popstate; the ref is already cleared)
    }
  }
  function openExternal(sel: Selected) {
    recordOpen(sel);
    window.open(sel.item.url, "_blank", "noopener");
  }
  function likeItem(it: Item) {
    engaged.current.add(it.id);
    const willLike = !liked.has(it.id);
    setLiked((s) => {
      const n = new Set(s);
      willLike ? n.add(it.id) : n.delete(it.id);
      return n;
    });
    api.itemEvent(it.id, willLike ? "like" : "unlike", id).catch(() => {});
  }
  function like() {
    if (cur) likeItem(cur.item);
  }
  function save(sel: Selected) {
    engaged.current.add(sel.item.id);
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

  // The primary callout button per render state (#96): label + icon + action.
  function primaryFor(sel: Selected): { label: string; Icon: typeof BookOpen; onClick: () => void } {
    const r = renderOf(sel.item);
    if (r === "full_text") return { label: "Read", Icon: BookOpen, onClick: () => openContent(sel) };
    if (isVideo(sel.item)) return { label: "Watch", Icon: Play, onClick: () => openContent(sel) };
    if (sel.item.media_type === "audio") return { label: "Listen", Icon: Play, onClick: () => openContent(sel) };
    return { label: "Open original", Icon: ExternalLink, onClick: () => openExternal(sel) };
  }

  // Desktop keyboard navigation (#4): arrows page the reel, space/enter opens
  // the focused item, L likes it, backspace returns to intent. Inert while a
  // sheet or the reader is open (they own their own keys) or while typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (content || menuOpen || breakdown || saveItem || sourceSel || checkin) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
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
        case "l":
        case "L":
          if (cur && !atEnd) {
            e.preventDefault();
            like();
          }
          break;
        case "Backspace":
          e.preventDefault();
          goHome();
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (err) return <div className="err">Couldn't resume your session: {err}</div>;
  if (loading) return <div className="spinner">resuming…</div>;
  if (items.length === 0) {
    return (
      <div className="center">
        <p className="display">Nothing left to surface.</p>
        <p>You're caught up on {themes.length ? themes.join(", ") : "everything you follow"}.</p>
        <button className="btn ghost" onClick={goHome}>Back to intent</button>
      </div>
    );
  }

  const progress = Math.min(1, elapsed / durationSec);
  const shownItems = overIdx !== null ? items.slice(0, visibleCount) : items;

  return (
    <div className="focus-session">
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

      {/* #68: the fast-scroll check-in. A nudge toward self-honesty, never a topic
          change - "Keep going" just dismisses; "Something else" ends the session
          and returns home. Neither re-ranks or re-fetches. */}
      {checkin === "fast" && (
        <div className="checkin">
          <p>You're scrolling fast - want to keep going, or do something else?</p>
          <div className="checkin-actions">
            <button className="mini" onClick={dismissCheckin}>Keep going</button>
            <button className="mini solid" onClick={goHome}>Something else</button>
          </div>
        </div>
      )}

      <div className="stage" ref={stageRef}>
        {shownItems.map((it, i) => {
          const primary = primaryFor(it);
          const render = renderOf(it.item);
          return (
            <div
              className={`snap ${i === current ? "" : "away"}`}
              key={`${it.item.id}-${i}`}
              data-idx={i}
              ref={(el) => {
                itemEls.current[i] = el;
              }}
              onPointerDown={cardPointerDown}
              onPointerMove={cardPointerMove}
              onPointerUp={(e) => cardPointerUp(e, i)}
              onClick={() => cardClick(it)}
              role="link"
            >
              {/* Quiet reason line (de-noised, no box) + the ··· overflow. */}
              <div className="card-top" onClick={(e) => e.stopPropagation()}>
                {it.reason && <span className="reason">{it.reason}</span>}
                {i === current && (
                  <button
                    className="item-more"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(true);
                    }}
                    aria-label="More actions"
                  >
                    ···
                  </button>
                )}
              </div>

              {/* Fixed card order (#96): Topic pill -> Source -> Title ->
                  Author·Date -> Hero -> Preview blurb -> callout buttons. */}
              <TopicPill topic={it.topic} />
              <CardSource sel={it} onSource={() => setSourceSel(it)} />
              <h3 className="card-title">{it.item.title}</h3>
              <Byline item={it.item} sourceTitle={it.source_title} />
              <Media item={it.item} />
              <Blurb item={it.item} />

              {i === current && (
                <div
                  className="card-callout"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button className="callout-primary" onClick={primary.onClick}>
                    <primary.Icon size={16} strokeWidth={1.9} aria-hidden />
                    {primary.label}
                  </button>
                  <button
                    className={`callout-act ${liked.has(it.item.id) ? "on" : ""}`}
                    onClick={like}
                    aria-label={liked.has(it.item.id) ? "Unlike" : "Like"}
                  >
                    <Heart size={18} strokeWidth={1.75} fill={liked.has(it.item.id) ? "currentColor" : "none"} aria-hidden />
                  </button>
                  <button className="callout-act" onClick={() => save(it)} aria-label="Save">
                    <Bookmark size={18} strokeWidth={1.75} aria-hidden />
                  </button>
                  <ShareActions item={it.item} />
                  {/* full_text keeps a quiet path to the original alongside Read. */}
                  {render === "full_text" && (
                    <button className="callout-orig" onClick={() => openExternal(it)}>
                      Open original
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
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
          <div className="center" style={{ padding: "20px 0" }}>
            <p className="display">{overIdx !== null ? "That's your session." : "That's everything new."}</p>
            <p>
              {overIdx !== null
                ? `About ${mins(elapsed)} spent - that's the time you asked for.`
                : `You're caught up on ${themes.length ? themes.join(", ") : "everything you follow"}.`}
            </p>
            <button className="btn" onClick={goHome}>Start a new session</button>
          </div>
        </div>
      </div>

      {/* Progress + time-left pinned at the bottom (#120), the same spot the reader
          keeps its reading progress - so "how far through" is always bottom-of-screen
          in every context. The reader overlay covers this while reading. */}
      <div className="session-foot">
        <span className="session-time">
          {mins(elapsed)} / {duration}m
        </span>
        <div className="session-progress" aria-hidden>
          <div className="session-progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      <ItemActions
        selected={atEnd ? null : cur}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onRead={() => {
          setMenuOpen(false);
          if (cur) openContent(cur);
        }}
        onSave={(it) => {
          setMenuOpen(false);
          setSaveItem(it);
        }}
        onWhy={() => {
          setMenuOpen(false);
          if (cur) setBreakdown(cur);
        }}
      />

      <ScoreBreakdownSheet sel={breakdown} open={breakdown !== null} onClose={() => setBreakdown(null)} />

      {/* In-app content surfaces (#51/#85): text reads in the pushed ReaderPage,
          video/audio play in the Player sheet. */}
      <ReaderPage
        item={shown && shownKind === "read" ? shown.item : null}
        sourceTitle={shown?.source_title}
        preloaded={shownKind === "read" ? shownContent : null}
        open={content !== null && shownKind === "read"}
        onClose={closeContent}
        onOpen={() => shown && openExternal(shown)}
        onSave={() => shown && setSaveItem(shown.item)}
        liked={shown ? liked.has(shown.item.id) : false}
        onLike={() => shown && likeItem(shown.item)}
      />
      <Player
        item={shown && shownKind !== "read" ? shown.item : null}
        sourceTitle={shown?.source_title}
        open={content !== null && shownKind !== "read"}
        onClose={closeContent}
        onOpenOriginal={() => shown && openExternal(shown)}
        onSave={() => shown && setSaveItem(shown.item)}
        liked={shown ? liked.has(shown.item.id) : false}
        onLike={() => shown && likeItem(shown.item)}
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
      <SavePicker item={saveItem} open={saveItem !== null} onClose={() => setSaveItem(null)} />
    </div>
  );
}
