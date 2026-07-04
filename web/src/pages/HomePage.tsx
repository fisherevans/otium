import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Feed, type Source } from "@/api/client";

// #69 + #70: the intent page is one dead-simple, no-scroll screen.
//
// #70 refines it into two calm states:
//   - Blank state: four preset-length chips (5 / 15 / 30 / 1 hr). This is the
//     front door - a few clear choices, not a raw slider.
//   - Slider state: tapping a preset reveals the #69 slider experience pre-set
//     to that value, with -5 / +5 nudge buttons flanking the slider so you can
//     fine-tune without thumb-scrubbing. Topics + Start appear here.
// A session is that one chosen duration - no range, no flexibility axis.
const MIN_MINUTES = 5;
const MAX_MINUTES = 60;
const STEP = 5;
const PRESETS = [5, 15, 30, 60];

export default function HomePage() {
  const nav = useNavigate();
  // null = blank state (no duration chosen yet); a number = slider state.
  const [minutes, setMinutes] = useState<number | null>(null);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const chosen = minutes !== null;

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

  function nudge(delta: number) {
    setMinutes((m) => {
      const base = m ?? 15;
      return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, base + delta));
    });
  }

  async function start() {
    if (minutes === null) return;
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

      {!chosen ? (
        <div className="preset-pick">
          <div className="preset-grid">
            {PRESETS.map((p) => (
              <button
                key={p}
                className="preset-chip"
                onClick={() => setMinutes(p)}
                aria-label={p === 60 ? "1 hour" : `${p} minutes`}
              >
                <span className="preset-num">{p === 60 ? "1" : p}</span>
                <span className="preset-unit">{p === 60 ? "hour" : "min"}</span>
              </button>
            ))}
          </div>
          <p className="intent-hint">Choose a starting length - you can fine-tune it next.</p>
        </div>
      ) : (
        <div className="slider-state">
          <button className="reset-link" onClick={() => setMinutes(null)}>
            Change length
          </button>

          <div className="time-pick">
            <div className="time-readout">
              <span className="big">{minutes}</span>
              <span className="unit">minutes</span>
            </div>
            <div className="time-adjust">
              <button
                className="nudge"
                onClick={() => nudge(-STEP)}
                disabled={minutes <= MIN_MINUTES}
                aria-label="5 minutes less"
              >
                &minus;5
              </button>
              <input
                className="time-slider"
                type="range"
                min={MIN_MINUTES}
                max={MAX_MINUTES}
                step={STEP}
                value={minutes ?? 15}
                onChange={(e) => setMinutes(Number(e.target.value))}
                aria-label="How much time"
                aria-valuetext={`${minutes} minutes`}
              />
              <button
                className="nudge"
                onClick={() => nudge(STEP)}
                disabled={minutes >= MAX_MINUTES}
                aria-label="5 minutes more"
              >
                +5
              </button>
            </div>
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
      )}
    </div>
  );
}
