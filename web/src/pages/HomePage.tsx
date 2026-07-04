import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Feed, type Source } from "@/api/client";

// #69: the intent page is one dead-simple, no-scroll screen. A single native
// slider picks how much time you want (5-60 min); a session is that one chosen
// duration - no range, no flexibility axis. Topic chips fit below it, and one
// calm button starts. The old 2-axis pad + a11y sliders are gone: a native range
// input is inherently accessible.
const MIN_MINUTES = 5;
const MAX_MINUTES = 60;
const STEP = 5;

export default function HomePage() {
  const nav = useNavigate();
  const [minutes, setMinutes] = useState(15);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.feeds().then(setFeeds).catch(() => setFeeds([]));
    api.sources().then(setSources).catch(() => setSources([]));
  }, []);

  // Unseen supply for the current theme selection - used only to disable Start
  // (and say so) when there's genuinely nothing new. Not shown as a count.
  const unseenForSelection = useMemo(() => {
    const match = picked.length
      ? sources.filter((s) => (s.feed_slugs ?? []).some((slug) => picked.includes(slug)))
      : sources;
    return match.reduce((n, s) => n + (s.unseen_count ?? 0), 0);
  }, [sources, picked]);
  const nothingNew = sources.length > 0 && unseenForSelection === 0;

  function toggle(slug: string) {
    setPicked((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]));
  }

  async function start() {
    setBusy(true);
    setErr("");
    try {
      const resp = await api.createSession(minutes, picked);
      if (resp && resp.session_id) nav(`/session/${resp.session_id}`);
      else setErr("Nothing new to gather right now.");
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="intent">
      <div className="intent-head">
        <h1 className="display">How much time?</h1>
        <p className="sub">Pick a length. Otium builds a session to fit it.</p>
      </div>

      <div className="time-pick">
        <div className="time-readout">
          <span className="big">{minutes}</span>
          <span className="unit">minutes</span>
        </div>
        <input
          className="time-slider"
          type="range"
          min={MIN_MINUTES}
          max={MAX_MINUTES}
          step={STEP}
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
          aria-label="How much time"
          aria-valuetext={`${minutes} minutes`}
        />
        <div className="time-scale">
          <span>{MIN_MINUTES} min</span>
          <span>{MAX_MINUTES} min</span>
        </div>
      </div>

      {feeds.length > 0 && (
        <div className="intent-topics">
          <div className="section-label">Topics</div>
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
          <p className="intent-hint">
            {picked.length === 0 ? "Nothing picked = everything you follow." : `${picked.length} selected.`}
          </p>
        </div>
      )}

      {err && <p className="intent-hint" role="alert">{err}</p>}

      <button className="btn" onClick={start} disabled={busy || nothingNew}>
        {nothingNew ? "Nothing new right now" : "Start reading"}
      </button>
    </div>
  );
}
