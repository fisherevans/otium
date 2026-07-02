import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type Item, type Selected } from "@/api/client";

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
  const [saved, setSaved] = useState<Set<number>>(new Set());

  const [elapsed, setElapsed] = useState(0);
  const [checkin, setCheckin] = useState<Checkin>(null);
  const [flash, setFlash] = useState(0);
  const ackLow = useRef(false);
  const ackHigh = useRef(false);
  const advances = useRef<number[]>([]);
  const shownIds = useRef<Set<number>>(new Set());
  const engaged = useRef<Set<number>>(new Set()); // ids that got open/like/save
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

  function open() {
    if (!cur) return;
    engaged.current.add(cur.item.id);
    api.itemEvent(cur.item.id, "open", sessionId).catch(() => {});
    window.open(cur.item.url, "_blank", "noopener");
  }
  function like() {
    if (!cur) return;
    engaged.current.add(cur.item.id);
    setLiked((s) => {
      const n = new Set(s);
      n.has(cur.item.id) ? n.delete(cur.item.id) : n.add(cur.item.id);
      return n;
    });
    api.itemEvent(cur.item.id, "like", sessionId).catch(() => {});
  }
  function save() {
    if (!cur) return;
    engaged.current.add(cur.item.id);
    setSaved((s) => {
      const n = new Set(s);
      n.has(cur.item.id) ? n.delete(cur.item.id) : n.add(cur.item.id);
      return n;
    });
    api.itemEvent(cur.item.id, "save", sessionId).catch(() => {});
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
          >
            <span className="reason">{it.reason}</span>
            <Media item={it.item} />
            <h3>{it.item.title}</h3>
            <div className="meta">
              <span>{it.source_title}</span>
              <span>·</span>
              <span>{it.item.media_type === "audio" ? mins(it.item.duration_sec || it.est_duration_sec) : it.item.media_type}</span>
            </div>
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
          <span className="ic">↗</span>Open
        </button>
        <button className={`act-btn ${cur && liked.has(cur.item.id) ? "on" : ""}`} onClick={like} disabled={atEnd}>
          <span className="ic">♥</span>Like
        </button>
        <button className={`act-btn ${cur && saved.has(cur.item.id) ? "on" : ""}`} onClick={save} disabled={atEnd}>
          <span className="ic">▣</span>Save
        </button>
        <button className="act-btn" onClick={next}>
          <span className="ic">↓</span>{isLastReal && !exhausted ? "More" : atEnd ? "Done" : "Next"}
        </button>
      </div>
    </div>
  );
}
