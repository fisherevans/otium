import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Feed, type Source } from "@/api/client";

// The pad turns one gesture into an intent: vertical = how long, horizontal =
// how varied. Fisher's idea - "I have five minutes" is a flick up a little;
// "half an hour on the couch" is up and to the right.
function padToRange(x: number, y: number): [number, number] {
  const center = Math.round(5 + y * 55); // 5..60 min at the middle of the range
  const spread = 0.12 + x * 0.6; // tight (12%) to loose (72%)
  const low = Math.max(2, Math.round(center * (1 - spread / 2)));
  const high = Math.round(center * (1 + spread / 2));
  return [low, high];
}

// Plain-language descriptor of the current pad position - the pad teaches itself
// as you drag rather than making you decode two axes.
function describe(xHigh: boolean, yHigh: boolean): string {
  if (yHigh && xHigh) return "A long, wide-ranging session";
  if (yHigh && !xHigh) return "A long, focused sit";
  if (!yHigh && xHigh) return "A quick, varied sampler";
  return "A quick, focused skim";
}

const AVG_ITEM_MIN = 4.5; // rough mixed avg (short 1m, article 4m, long 10m)

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

  const [low, high] = padToRange(pos.x, pos.y);
  const xHigh = pos.x >= 0.5;
  const yHigh = pos.y >= 0.5;

  // How much unseen supply the current theme selection actually has, so the
  // item estimate is honest instead of a made-up number.
  const unseenForSelection = useMemo(() => {
    const match = picked.length
      ? sources.filter((s) => (s.feed_slugs ?? []).some((slug) => picked.includes(slug)))
      : sources;
    return match.reduce((n, s) => n + (s.unseen_count ?? 0), 0);
  }, [sources, picked]);

  const itemsEst = useMemo(() => {
    const mid = (low + high) / 2;
    const raw = Math.max(1, Math.round(mid / AVG_ITEM_MIN));
    return sources.length ? Math.min(raw, unseenForSelection) : raw;
  }, [low, high, unseenForSelection, sources.length]);

  function moveFrom(e: React.PointerEvent) {
    const el = padRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    setPos({ x, y });
  }

  // Analog-stick drag: all handlers stay on the pad element (more reliable on
  // mobile than window listeners), pointer capture keeps the drag alive if the
  // finger slides off the pad.
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

  // Which corner label is "active" - the mood nearest the knob, brightened.
  const activeCorner = `${yHigh ? "t" : "b"}${xHigh ? "r" : "l"}`;

  return (
    <div>
      <h1 className="display">How much time?</h1>
      <p className="sub">Drag up for longer, right for a wider mix.</p>

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
          <span className={`pad-corner tl ${activeCorner === "tl" ? "on" : ""}`}>long · focused</span>
          <span className={`pad-corner tr ${activeCorner === "tr" ? "on" : ""}`}>long · varied</span>
          <span className={`pad-corner bl ${activeCorner === "bl" ? "on" : ""}`}>quick · focused</span>
          <span className={`pad-corner br ${activeCorner === "br" ? "on" : ""}`}>quick · varied</span>
          {/* tether from the center origin to the knob - the analog-stick look */}
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
          {describe(xHigh, yHigh)}
        </p>
        <div className="pad-readout">
          <span className="big">
            {low}–{high}
          </span>
          <span className="small">min</span>
          <span className="dot">·</span>
          <span className="small">
            {sources.length && unseenForSelection === 0 ? "nothing unseen" : `~${itemsEst} item${itemsEst === 1 ? "" : "s"}`}
          </span>
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

      <button className="btn" onClick={build} disabled={busy || (sources.length > 0 && unseenForSelection === 0)}>
        Build my session
      </button>
    </div>
  );
}
