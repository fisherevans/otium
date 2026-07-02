import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Feed, type Source } from "@/api/client";

const round5 = (v: number) => Math.max(0, Math.round(v / 5) * 5);

// The pad encodes an intent in one gesture:
//   X (left->right) = session length, ~5 min to ~60 min.
//   Y (bottom->top) = how flexible that length is. Bottom = an exact target;
//     drag up and the range fans out around the center (e.g. center 15 min at
//     full flex -> 5-25 min). A wider range gives the session builder slack to
//     optimize *which* items it stages instead of being forced to hit a number.
function padToRange(x: number, y: number): { low: number; high: number; center: number; h: number } {
  const center = Math.max(5, round5(5 + x * 55)); // 5..60
  const hmax = Math.min(center - 5, 20); // how far the range can fan at this length
  const h = round5(y * hmax);
  const low = Math.max(2, center - h);
  const high = center + h;
  return { low, high, center, h };
}

function describe(low: number, high: number, center: number, h: number): string {
  if (h === 0) return `Exactly ${center} minutes`;
  if (h <= 10) return `About ${center} minutes, give or take`;
  return `Anywhere from ${low} to ${high} minutes`;
}

export default function HomePage() {
  const nav = useNavigate();
  const padRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 }); // analog stick: rests centered
  const [dragging, setDragging] = useState(false);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.feeds().then(setFeeds).catch(() => setFeeds([]));
    api.sources().then(setSources).catch(() => setSources([]));
  }, []);

  const { low, high, center, h } = padToRange(pos.x, pos.y);
  const xRight = pos.x >= 0.5;
  const yUp = pos.y >= 0.5;

  // Unseen supply for the current theme selection - used only to disable Build
  // (and say so) when there's genuinely nothing new. Not shown as a count.
  const unseenForSelection = useMemo(() => {
    const match = picked.length
      ? sources.filter((s) => (s.feed_slugs ?? []).some((slug) => picked.includes(slug)))
      : sources;
    return match.reduce((n, s) => n + (s.unseen_count ?? 0), 0);
  }, [sources, picked]);
  const nothingNew = sources.length > 0 && unseenForSelection === 0;

  function moveFrom(e: React.PointerEvent) {
    const el = padRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    setPos({ x, y });
  }

  function onDown(e: React.PointerEvent) {
    padRef.current?.setPointerCapture(e.pointerId);
    setDragging(true);
    moveFrom(e);
  }
  function onMove(e: React.PointerEvent) {
    if (dragging) moveFrom(e);
  }
  function onUp(e: React.PointerEvent) {
    setDragging(false);
    padRef.current?.releasePointerCapture(e.pointerId);
  }
  function recenter() {
    setPos({ x: 0.5, y: 0.5 });
  }

  function toggle(slug: string) {
    setPicked((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]));
  }

  async function build() {
    setBusy(true);
    const qs = new URLSearchParams({ low: String(low), high: String(high) });
    if (picked.length) qs.set("themes", picked.join(","));
    nav(`/session?${qs.toString()}`);
  }

  return (
    <div>
      <h1 className="display">How much time?</h1>
      <p className="sub">Left to right: how long. Up: how flexible the range.</p>

      <div className="pad-wrap">
        <div
          className={`pad ${dragging ? "dragging" : ""}`}
          ref={padRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <div className="pad-grid" />
          {/* axis labels: X = length, Y = flexibility */}
          <span className={`pad-edge left ${!xRight ? "on" : ""}`}>5 min</span>
          <span className={`pad-edge right ${xRight ? "on" : ""}`}>1 hr</span>
          <span className={`pad-edge bottom ${!yUp ? "on" : ""}`}>exact</span>
          <span className={`pad-edge top ${yUp ? "on" : ""}`}>flexible</span>
          <svg className="pad-tether" viewBox="0 0 100 100" preserveAspectRatio="none">
            <circle className="pad-origin" cx="50" cy="50" r="1.4" />
            <line x1="50" y1="50" x2={pos.x * 100} y2={(1 - pos.y) * 100} />
          </svg>
          <div
            className="pad-knob"
            style={{ left: `${pos.x * 100}%`, top: `${(1 - pos.y) * 100}%` }}
          />
        </div>
        <p className="pad-descriptor" onClick={recenter} title="tap to recenter">
          {describe(low, high, center, h)}
        </p>
        <div className="pad-readout">
          <span className="big">{h === 0 ? center : `${low}–${high}`}</span>
          <span className="small">min</span>
          {h > 0 && (
            <>
              <span className="dot">·</span>
              <span className="small">flexible</span>
            </>
          )}
        </div>
      </div>

      {feeds.length > 0 && (
        <>
          <div className="section-label">What are you in the mood for?</div>
          <div className="chips">
            {feeds.map((f) => (
              <button
                key={f.slug}
                className={`chip ${picked.includes(f.slug) ? "on" : ""}`}
                onClick={() => toggle(f.slug)}
              >
                {f.name}
              </button>
            ))}
          </div>
          <p className="sub" style={{ marginTop: 10, fontSize: 13 }}>
            {picked.length === 0 ? "Nothing picked = everything you follow." : `${picked.length} selected.`}
          </p>
        </>
      )}

      <button className="btn" onClick={build} disabled={busy || nothingNew}>
        {nothingNew ? "Nothing new right now" : "Build my session"}
      </button>
    </div>
  );
}
