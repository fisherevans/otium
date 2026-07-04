import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type Item, type Selected } from "@/api/client";
import { ItemActions } from "@/components/ItemActions";
import { Reader } from "@/components/Reader";
import { Player } from "@/components/Player";
import { SavePicker } from "@/components/SavePicker";
import { ScoreCue, ScoreBreakdownSheet } from "@/components/ScoreBreakdown";

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

// The card's identity line (#44/#48): feed as the emphasized anchor (icon +
// name), then the source, the media descriptor, and a relative age - so "who"
// and "when" read together. A feedless source (e.g. YouTube) has no feed ref, so
// the line degrades to source-only. Icons inherit ink via currentColor; when a
// feed has no icon set we fall back to its color swatch.
function Identity({ sel }: { sel: Selected }) {
  const f = sel.feed;
  const Ic = feedIcon(f?.icon);
  const type = sel.item.media_type === "audio" ? mins(sel.item.duration_sec || sel.est_duration_sec) : sel.item.media_type;
  const age = relTime(sel.item.published_at || sel.item.fetched_at);
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
      <span className={f ? "id-source" : "id-source lead"}>{sel.source_title}</span>
      {type && <span className="id-type">{type}</span>}
      {age && <span className="id-age">{age}</span>}
    </div>
  );
}

type Checkin = null | "low" | "high" | "fast";

export default function SessionPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const low = Number(params.get("low") ?? 10);
  const high = Number(params.get("high") ?? 20);
  const themes = (params.get("themes") ?? "").split(",").filter(Boolean);
  const lowSec = low * 60;
  const highSec = high * 60;

  const [items, setItems] = useState<Selected[]>([]);
  const [current, setCurrent] = useState(0);
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [err, setErr] = useState("");
  const [liked, setLiked] = useState<Set<number>>(new Set());
  const [saveItem, setSaveItem] = useState<Item | null>(null); // Save picker target (#57)
  const [menuOpen, setMenuOpen] = useState(false);
  const [breakdown, setBreakdown] = useState<Selected | null>(null);
  const [content, setContent] = useState<Selected | null>(null); // the in-app content surface (#51)

  // The strongest rank score in the loaded queue - the yardstick the on-card score
  // cue fills against, so each cue reads as "how strongly did this rank vs the best."
  const maxScore = useMemo(() => items.reduce((m, s) => Math.max(m, s.score), 0), [items]);

  const [elapsed, setElapsed] = useState(0);
  const [checkin, setCheckin] = useState<Checkin>(null);
  const [flash, setFlash] = useState(0);
  const ackLow = useRef(false);
  const ackHigh = useRef(false);
  const advances = useRef<number[]>([]);
  const shownIds = useRef<Set<number>>(new Set());
  const engaged = useRef<Set<number>>(new Set()); // ids that got open/like/save
  const opened = useRef<Set<number>>(new Set()); // ids that fired an `open` event (dedupe, #51)
  const lastContent = useRef<Selected | null>(null); // retains the surface item through the sheet's exit anim
  const prevIdx = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const itemEls = useRef<(HTMLDivElement | null)[]>([]);

  const build = useCallback(
    async (append: boolean): Promise<number> => {
      try {
        const resp = await api.buildSession(low, high, themes);
        setSessionId(resp.session_id);
        const fresh = resp.result.items.filter((s) => !shownIds.current.has(s.item.id));
        if (append) {
          if (fresh.length === 0) setExhausted(true);
          else setItems((prev) => [...prev, ...fresh]);
        } else {
          setItems(fresh);
          setExhausted(fresh.length === 0);
        }
        return fresh.length;
      } catch (e: any) {
        setErr(String(e.message ?? e));
        return 0;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.toString()],
  );

  useEffect(() => {
    setItems([]);
    setCurrent(0);
    setExhausted(false);
    setErr("");
    setLoading(true);
    setElapsed(0);
    ackLow.current = false;
    ackHigh.current = false;
    advances.current = [];
    shownIds.current = new Set();
    engaged.current = new Set();
    opened.current = new Set();
    prevIdx.current = 0;
    build(false).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  // Active-time ticker (pauses while hidden).
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setElapsed((e) => e + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Pacing check-ins.
  useEffect(() => {
    if (checkin) return;
    if (elapsed >= highSec && !ackHigh.current) {
      ackHigh.current = true;
      setCheckin("high");
    } else if (elapsed >= lowSec && !ackLow.current && low !== high) {
      ackLow.current = true;
      setCheckin("low");
    }
  }, [elapsed, lowSec, highSec, low, high, checkin]);

  // Scroll-snap: an IntersectionObserver marks the centered item as current,
  // marks it seen, tracks advance pace (fast-flicking check-in), and refills.
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
          // Finalize the item we just moved past: advancing forward without
          // having opened/liked/saved it is a skip (next == skip).
          if (idx > prevIdx.current) {
            const left = items[prevIdx.current];
            if (left && !engaged.current.has(left.item.id)) {
              api.itemEvent(left.item.id, "skip", sessionId).catch(() => {});
              const now = Date.now();
              advances.current = [...advances.current, now].slice(-4);
              if (advances.current.filter((t) => now - t < 8000).length >= 3 && !checkin) setCheckin("fast");
            }
          }
          prevIdx.current = idx;
          const it = items[idx];
          if (it && !shownIds.current.has(it.item.id)) {
            shownIds.current.add(it.item.id);
            api.itemEvent(it.item.id, "seen", sessionId).catch(() => {});
          }
          if (idx >= items.length - 1 && elapsed < highSec && !exhausted && !loadingMore) void loadMore();
        }
      },
      { root: stage, threshold: 0.6 },
    );
    itemEls.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, sessionId, elapsed, exhausted, loadingMore]);

  async function loadMore(): Promise<number> {
    if (loadingMore || exhausted) return 0;
    setLoadingMore(true);
    const n = await build(true);
    setLoadingMore(false);
    return n;
  }

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

  // Tap-to-open (#47): a click on the card body opens the item, but a scroll-snap
  // drag must not count as a tap. Track the pointer from press to release and
  // treat anything past a small move threshold as a scroll, not a tap.
  //
  // Swipe-to-advance (#10): a deliberate horizontal drag on the focused card
  // advances it - the same path as the Next button (next == skip). The gesture
  // is fenced off from the two neighbours it could collide with:
  //   - vertical scroll-snap: the card carries `touch-action: pan-y`, so the
  //     browser keeps vertical panning and hands horizontal motion to us; we also
  //     require the horizontal delta to dominate the vertical one.
  //   - tap-to-open: any qualifying swipe is >> the 10px move threshold, so it
  //     already trips `moved` and cardClick bails before openItem.
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
    // Left swipe on the still-focused card = advance. Left only: there's no
    // "back", so a right drag intentionally does nothing (it falls through to a
    // no-op tap since `moved` is set).
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
  // engagement, not a skip. `opened` dedupes the event; `engaged` (also fed by
  // like/save) is what exempts the item from the next==skip rule (#51).
  function recordOpen(sel: Selected) {
    engaged.current.add(sel.item.id);
    if (!opened.current.has(sel.item.id)) {
      opened.current.add(sel.item.id);
      api.itemEvent(sel.item.id, "open", sessionId).catch(() => {});
    }
  }
  // Primary: tapping the card body reads/plays the item in-app (#51).
  function openContent(sel: Selected) {
    recordOpen(sel);
    setContent(sel);
  }
  // Secondary: the original source in a browser tab (demoted from #47's default).
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
    // Toggle: liking fires `like` (state + engagement signal, unchanged) and adds
    // to the auto Liked collection server-side; un-liking fires `unlike`, which
    // only removes that membership and never touches the ranker signal (#57).
    const willLike = !liked.has(cur.item.id);
    setLiked((s) => {
      const n = new Set(s);
      willLike ? n.add(cur.item.id) : n.delete(cur.item.id);
      return n;
    });
    api.itemEvent(cur.item.id, willLike ? "like" : "unlike", sessionId).catch(() => {});
  }
  // Save is the deliberate path (#57): open the collection picker rather than a
  // one-tap toggle. The picker writes membership with no engagement event; the
  // act of saving still counts as engagement for the next==skip exemption.
  function save() {
    if (!cur) return;
    engaged.current.add(cur.item.id);
    setSaveItem(cur.item);
  }
  function next() {
    if (current < items.length - 1) scrollTo(current + 1);
    else if (!exhausted && elapsed < highSec) loadMore().then(() => scrollTo(current + 1));
    else scrollTo(items.length); // end panel
  }
  function dismissCheckin() {
    setCheckin(null);
    advances.current = [];
  }

  if (err) return <div className="err">Couldn't build a session: {err}</div>;
  if (loading) return <div className="spinner">composing…</div>;
  if (items.length === 0) {
    return (
      <div className="center">
        <p className="display">Nothing new to surface.</p>
        <p>You're caught up on {themes.length ? themes.join(", ") : "everything you follow"}.</p>
        <button className="btn ghost" onClick={() => nav("/")}>Back to intent</button>
      </div>
    );
  }

  const progress = Math.min(1, elapsed / highSec);
  const isLastReal = current === items.length - 1;

  return (
    <div className="focus-session">
      {flash > 0 && <span className="eink-flash" key={flash} />}
      <div className="timestrip">
        <div className="timebar">
          <div className="timebar-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="clock">
          {mins(elapsed)} / {low === high ? `${low}m` : `${low}–${high}m`}
        </span>
      </div>

      {checkin && (
        <div className="checkin">
          {checkin === "low" && <p>You've spent about {low} min. Keep going, or wrap up?</p>}
          {checkin === "high" && <p>That's about {high} min — your session's worth.</p>}
          {checkin === "fast" && <p>Flicking past these? Want a different mix?</p>}
          <div className="checkin-actions">
            <button className="mini" onClick={dismissCheckin}>
              {checkin === "fast" ? "Keep going" : "Keep going"}
            </button>
            <button className="mini solid" onClick={() => nav("/")}>
              {checkin === "fast" ? "Change mix" : checkin === "high" ? "Done" : "Wrap up"}
            </button>
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
            <Media item={it.item} />
            <Identity sel={it} />
            {it.item.summary && <p className="excerpt">{it.item.summary}</p>}
          </div>
        ))}
        {/* end panel */}
        <div
          className="snap"
          data-idx={items.length}
          ref={(el) => {
            itemEls.current[items.length] = el;
          }}
        >
          <div className="center" style={{ padding: "20px 0" }}>
            <p className="display">{exhausted ? "That's everything new." : "That's your session."}</p>
            <p>{exhausted ? `Caught up on ${themes.length ? themes.join(", ") : "everything"}.` : `About ${mins(elapsed)} spent.`}</p>
            {!exhausted && (
              <button className="btn ghost" onClick={() => loadMore().then(() => scrollTo(current))}>A few more</button>
            )}
            <button className="btn" onClick={() => nav("/")}>Done</button>
          </div>
        </div>
      </div>

      <div className="actionbar">
        <button className="act-btn" onClick={open} disabled={atEnd}>
          <span className="ic">↗</span>Original
        </button>
        <button className={`act-btn ${cur && liked.has(cur.item.id) ? "on" : ""}`} onClick={like} disabled={atEnd}>
          <span className="ic">♥</span>Like
        </button>
        <button className="act-btn" onClick={save} disabled={atEnd}>
          <span className="ic">▣</span>Save
        </button>
        <button className="act-btn" onClick={next}>
          <span className="ic">↓</span>{isLastReal && !exhausted ? "More" : atEnd ? "Done" : "Next"}
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

      {/* Save picker (#57): the deliberate save destination for the bottom-bar
          Save, the ··· menu, and the reader/player. */}
      <SavePicker item={saveItem} open={saveItem !== null} onClose={() => setSaveItem(null)} />
    </div>
  );
}
