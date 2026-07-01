import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Feed } from "@/api/client";

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

export default function HomePage() {
  const nav = useNavigate();
  const padRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0.35, y: 0.35 });
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.feeds().then(setFeeds).catch(() => setFeeds([]));
  }, []);

  const [low, high] = padToRange(pos.x, pos.y);

  function moveFrom(e: PointerEvent | React.PointerEvent) {
    const el = padRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    setPos({ x, y });
  }

  function onDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    moveFrom(e);
    const move = (ev: PointerEvent) => moveFrom(ev);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
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
      <p className="sub">Drag to set how long, and how wide a mix you're in the mood for.</p>

      <div className="pad-wrap">
        <div className="pad" ref={padRef} onPointerDown={onDown}>
          <span className="pad-axis-y">longer ↑</span>
          <span className="pad-axis-x">more variety →</span>
          <div
            className="pad-knob"
            style={{ left: `${pos.x * 100}%`, top: `${(1 - pos.y) * 100}%` }}
          />
        </div>
        <div className="pad-readout">
          <span className="big">
            {low}–{high}
          </span>
          <span className="small">minutes</span>
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

      <button className="btn" onClick={build} disabled={busy}>
        Build my session
      </button>
    </div>
  );
}
