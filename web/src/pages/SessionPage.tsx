import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Item, type Selected } from "@/api/client";
import { ItemActions } from "@/components/ItemActions";
import { Reader } from "@/components/Reader";
import { Player } from "@/components/Player";
import { SavePicker } from "@/components/SavePicker";
import { ScoreCue, ScoreBreakdownSheet } from "@/components/ScoreBreakdown";
import { SourceSheet } from "@/components/SourceSheet";
import { ExternalLink, Heart, Bookmark, ChevronDown } from "lucide-react";

// Which in-app content surface an item opens into (#51). Video/audio play in
// the Player; everything else (article/rss/quote/text) reads in the Reader.
function contentKind(item: Item): "video" | "audio" | "read" {
  if (item.media_type === "short" || item.media_type === "long" || item.media_type === "live") return "video";
  if (item.media_type === "audio") return "audio";
  return "read";
}
import { feedIcon } from "@/lib/feedIcons";
import { relTime } from "@/lib/format";

function clock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function mins(sec: number) {
  const m = Math.round(sec / 60);
  return m < 1 ? "<1 min" : `${m} min`;
}

// Media preview, rendered as e-ink: real thumbnail (grayscaled) when we have one,
// otherwise a dithered placeholder, with the right aspect + affordances per type.
function Media({ item }: { item: Item }) {
  const t = item.media_type;
  if (t === "audio") {
    return (
      <div className="wave" aria-label="audio">
        {Array.from({ length: 40 }, (_, i) => (
          <i key={i} style={{ height: `${20 + Math.abs(Math.sin(i * 1.7)) * 60}%` }} />
        ))}
      </div>
    );
  }
  if (t === "short" || t === "long" || t === "live") {
    const vertical = t === "short";
    return (
      <div className={`media ${vertical ? "v" : "h"}`}>
        {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" loading="lazy" /> : <div className="dither" />}
        <div className="dither" />
        <div className="play" />
        {item.duration_sec > 0 && <span className="dur">{clock(item.duration_sec)}</span>}
      </div>
    );
  }
  if (t === "article" && item.thumbnail_url) {
    return (
      <div className="media h">
        <img src={item.thumbnail_url} alt="" loading="lazy" />
        <div className="dither" />
      </div>
    );
  }
  return null; // quote / plain text: no media
}

// The prominent date above the hero (#73). The item's relative age reads first,
// larger and clearer than the mono identity line, so "when" lands at a glance
// before the media. relTime returns "" for a missing stamp, in which case we
// omit the cue rather than fabricate one.
function CardDate({ item }: { item: Item }) {
  const age = relTime(item.published_at || item.fetched_at);
  if (!age) return null;
  return <div className="card-date">{age}</div>;
}

// The card's identity line (#44/#48): feed as the emphasized anchor (icon +
// name), then the source and the media descriptor. The relative age moved above
// the hero (#73), so it's no longer on this line. The source name is tappable
// (#75): it opens the source context menu, and stops propagation so it doesn't
// also trigger the card-body tap-to-open. A feedless source (e.g. YouTube) has
// no feed ref, so the line degrades to source-only. Icons inherit ink via
// currentColor; when a feed has no icon set we fall back to its color swatch.
function Identity({ sel, onSource }: { sel: Selected; onSource: () => void }) {
  const f = sel.feed;
  const Ic = feedIcon(f?.icon);
  const type = sel.item.media_type === "audio" ? mins(sel.item.duration_sec || sel.est_duration_sec) : sel.item.media_type;
  return (
    <div className="identity">
      {f && (
        <span className="id-feed">
          {Ic ? (
            <Ic size={15} strokeWidth={1.75} aria-hidden />
          ) : (
            <span className="id-swatch" style={{ background: f.color || "var(--ink-mute)" }} />
          )}
          <span className="id-feed-name">{f.name}</span>
        </span>
      )}
      <button
        type="button"
        className={f ? "id-source" : "id-source lead"}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onSource();
        }}
      >
        {sel.source_title}
      </button>
      {type && <span className="id-type">{type}</span>}
    </div>
  );
}

// #67: the session is durable. This page drives entirely off the backend session
// identified by the URL id - it does NOT rebuild a feed. On load it resumes the
// active session (its stored queue + cursor); as the user advances it persists
// the cursor; when the session is over (elapsed >= the single duration, or the
// queue is exhausted) it marks the session ended and returns home. A refresh
// mid-session lands back on the same items at the same place.
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

  const durationSec = duration * 60;

  // The strongest rank score in the queue - the yardstick the on-card score cue
  // fills against, so each cue reads as "how strongly did this rank vs the best."
  const maxScore = useMemo(() => items.reduce((m, s) => Math.max(m, s.score), 0), [items]);

  const [elapsed, setElapsed] = useState(0);
  const [checkin, setCheckin] = useState<Checkin>(null);
  const [flash, setFlash] = useState(0);
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
  const lastContent = useRef<Selected | null>(null); // retains the surface item through the sheet's exit anim
  const prevIdx = useRef(0);
  const finished = useRef(false);
  const didInitialScroll = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const itemEls = useRef<(HTMLDivElement | null)[]>([]);

  // finish ends the session server-side (idempotent) and returns home. The single
  // exit for both "time's up" and "queue exhausted" (#67).
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    if (id) api.updateSession(id, { status: "ended" }).catch(() => {});
    nav("/", { replace: true });
  }, [id, nav]);

  // Load / resume the active session by id. If there is no active session, or the
  // URL points at a session that's no longer current (superseded / ended), this
  // URL is stale - go home ("this session's over").
  useEffect(() => {
    let cancelled = false;
    finished.current = false;
    didInitialScroll.current = false;
    setLoading(true);
    setErr("");
    setElapsed(0);
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
    const el = itemEls.current[current];
    if (el) el.scrollIntoView({ block: "center" });
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

  // Active-time ticker (pauses while hidden).
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") setElapsed((e) => e + 1);
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  // Persist the cursor as the user advances (debounced). The backend only accepts
  // a cursor write on an active session, so a late write is a harmless no-op.
  useEffect(() => {
    if (loading || !id) return;
    const t = window.setTimeout(() => {
      api.updateSession(id, { cursor: current }).catch(() => {});
    }, 500);
    return () => window.clearTimeout(t);
  }, [current, id, loading]);

  // Time budget reached (#67): the single duration is up. End + home - but not
  // while the user is mid-read in the content surface (defer until they close it,
  // so we never yank them out of an article).
  useEffect(() => {
    if (loading || finished.current) return;
    if (elapsed >= durationSec && !content) finish();
  }, [elapsed, durationSec, content, loading, finish]);

  // Queue exhausted: the end panel is centered. Let the affirming end-state show
  // for a calm beat, then return home.
  useEffect(() => {
    if (loading || items.length === 0) return;
    if (current >= items.length) {
      const t = window.setTimeout(finish, 2200);
      return () => window.clearTimeout(t);
    }
  }, [current, items.length, loading, finish]);

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
              // check-in, not a feed change.
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
  }, [items, id, checkin]);

  function scrollTo(idx: number) {
    const el = itemEls.current[idx];
    if (el) {
      setFlash((f) => f + 1);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  const cur = items[current];
  const atEnd = current >= items.length;

  // The in-app content surface (#51). Retain the item through the close
  // animation so the sheet doesn't blank as it slides down.
  if (content) lastContent.current = content;
  const shown = content ?? lastContent.current;
  const shownKind = shown ? contentKind(shown.item) : null;

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
    if (i === current && dx <= -SWIPE_DIST && Math.abs(dx) >= Math.abs(dy) * SWIPE_DOMINANCE) {
      p.moved = true; // keep cardClick from treating the follow-up click as a tap
      next();
    }
  }
  function cardClick(sel: Selected) {
    const p = press.current;
    press.current = null;
    if (p?.moved) return; // it was a scroll or a swipe, not a tap
    openContent(sel);
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
  function openContent(sel: Selected) {
    recordOpen(sel);
    setContent(sel);
  }
  function openExternal(sel: Selected) {
    recordOpen(sel);
    window.open(sel.item.url, "_blank", "noopener");
  }
  function open() {
    if (cur) openExternal(cur);
  }
  function like() {
    if (!cur) return;
    engaged.current.add(cur.item.id);
    const willLike = !liked.has(cur.item.id);
    setLiked((s) => {
      const n = new Set(s);
      willLike ? n.add(cur.item.id) : n.delete(cur.item.id);
      return n;
    });
    api.itemEvent(cur.item.id, willLike ? "like" : "unlike", id).catch(() => {});
  }
  function save() {
    if (!cur) return;
    engaged.current.add(cur.item.id);
    setSaveItem(cur.item);
  }
  function next() {
    if (current < items.length - 1) scrollTo(current + 1);
    else if (current === items.length - 1) scrollTo(items.length); // to end panel
    else finish();
  }
  function dismissCheckin() {
    setCheckin(null);
    fastStreak.current = 0;
  }

  if (err) return <div className="err">Couldn't resume your session: {err}</div>;
  if (loading) return <div className="spinner">resuming…</div>;
  if (items.length === 0) {
    return (
      <div className="center">
        <p className="display">Nothing left to surface.</p>
        <p>You're caught up on {themes.length ? themes.join(", ") : "everything you follow"}.</p>
        <button className="btn ghost" onClick={finish}>Back to intent</button>
      </div>
    );
  }

  const progress = Math.min(1, elapsed / durationSec);
  const isLastReal = current === items.length - 1;

  return (
    <div className="focus-session">
      {flash > 0 && <span className="eink-flash" key={flash} />}
      <div className="timestrip">
        <div className="timebar">
          <div className="timebar-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="clock">
          {mins(elapsed)} / {duration}m
        </span>
      </div>

      {/* #68: the fast-scroll check-in. A nudge toward self-honesty, never a feed
          change - "Keep going" just dismisses; "Something else" ends the session
          and returns home. Neither re-ranks or re-fetches. */}
      {checkin === "fast" && (
        <div className="checkin">
          <p>You're scrolling fast - want to keep going, or do something else?</p>
          <div className="checkin-actions">
            <button className="mini" onClick={dismissCheckin}>Keep going</button>
            <button className="mini solid" onClick={finish}>Something else</button>
          </div>
        </div>
      )}

      <div className="stage" ref={stageRef}>
        {items.map((it, i) => (
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
            <div className="reason-row" onClick={(e) => e.stopPropagation()}>
              <span className="reason">{it.reason}</span>
              <ScoreCue sel={it} maxScore={maxScore} onOpen={() => setBreakdown(it)} />
            </div>
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
            <h3>{it.item.title}</h3>
            <CardDate item={it.item} />
            <Media item={it.item} />
            <Identity sel={it} onSource={() => setSourceSel(it)} />
            {it.item.summary && <p className="excerpt">{it.item.summary}</p>}
          </div>
        ))}
        {/* end panel - reaching it ends the session and returns home */}
        <div
          className="snap"
          data-idx={items.length}
          ref={(el) => {
            itemEls.current[items.length] = el;
          }}
        >
          <div className="center" style={{ padding: "20px 0" }}>
            <p className="display">That's your session.</p>
            <p>About {mins(elapsed)} spent. Returning home…</p>
            <button className="btn" onClick={finish}>Done</button>
          </div>
        </div>
      </div>

      <div className="actionbar">
        <button className="act-btn" onClick={open} disabled={atEnd}>
          <ExternalLink className="ic" size={18} strokeWidth={1.75} aria-hidden />
          Original
        </button>
        <button className={`act-btn ${cur && liked.has(cur.item.id) ? "on" : ""}`} onClick={like} disabled={atEnd}>
          <Heart className="ic" size={18} strokeWidth={1.75} fill={cur && liked.has(cur.item.id) ? "currentColor" : "none"} aria-hidden />
          Like
        </button>
        <button className="act-btn" onClick={save} disabled={atEnd}>
          <Bookmark className="ic" size={18} strokeWidth={1.75} aria-hidden />
          Save
        </button>
        <button className="act-btn" onClick={next}>
          <ChevronDown className="ic" size={18} strokeWidth={1.75} aria-hidden />
          {atEnd ? "Done" : isLastReal ? "Finish" : "Next"}
        </button>
      </div>

      <ItemActions
        selected={atEnd ? null : cur}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onOpen={open}
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

      {/* In-app content surface (#51): text reads in the Reader, video/audio play
          in the Player. Tapping the card body opens the kind that fits the item. */}
      <Reader
        item={shown && shownKind === "read" ? shown.item : null}
        sourceTitle={shown?.source_title}
        open={content !== null && shownKind === "read"}
        onClose={() => setContent(null)}
        onOpen={() => shown && openExternal(shown)}
        onSave={() => shown && setSaveItem(shown.item)}
      />
      <Player
        item={shown && shownKind !== "read" ? shown.item : null}
        sourceTitle={shown?.source_title}
        open={content !== null && shownKind !== "read"}
        onClose={() => setContent(null)}
        onOpenOriginal={() => shown && openExternal(shown)}
        onSave={() => shown && setSaveItem(shown.item)}
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

      {/* Save picker (#57): the deliberate save destination for the bottom-bar
          Save, the ··· menu, and the reader/player. */}
      <SavePicker item={saveItem} open={saveItem !== null} onClose={() => setSaveItem(null)} />
    </div>
  );
}
