import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Interest, type Source } from "@/api/client";

// #95: the intent page is one calm, no-scroll screen with two controls.
//   - Time: a big Didot numeral with - / + steppers (5-min steps, default 15,
//     bounds 5..120) and a thin fine-tune slider under it. The steppers are the
//     primary control; the slider is optional polish. Two taps down reaches 5.
//   - Topics: the user's interests as a quiet multi-select checklist (option B, the
//     chosen direction over underline tabs), all checked by default. An All /
//     Clear toggle flips the whole set at once.
// One solid "Start reading" button is the only heavy element (de-noised style:
// type + whitespace over borders, a single solid CTA).
//
// Session build is unchanged from #67/#69: POST /sessions with the chosen
// duration + the selected interest slugs as `themes`. "All checked" maps to an empty
// themes list so interestless sources (e.g. YouTube channels) are still included -
// exactly the pre-#95 blank-selection default.
const MIN_MINUTES = 5;
const MAX_MINUTES = 120;
const DEFAULT_MINUTES = 15;
const STEP = 5;

export default function HomePage() {
  const nav = useNavigate();
  const [minutes, setMinutes] = useState(DEFAULT_MINUTES);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api
      .interests()
      .then((f) => {
        setInterests(f);
        setPicked(f.map((x) => x.slug)); // default: everything checked
      })
      .catch(() => setInterests([]));
    api.sources().then(setSources).catch(() => setSources([]));
  }, []);

  const allSelected = interests.length > 0 && picked.length === interests.length;
  const noneSelected = interests.length > 0 && picked.length === 0;

  // "All interests checked" is the same intent as the old blank selection: send an
  // empty themes list so the backend includes interestless sources too. A subset
  // sends exactly those slugs.
  const themes = allSelected ? [] : picked;

  // Unseen supply for the current selection - only used to disable Start when
  // there's genuinely nothing new. Mirrors the themes mapping: all-checked (or
  // no interests at all) counts every source; a subset counts only matching interests.
  const unseenForSelection = useMemo(() => {
    const match =
      allSelected || interests.length === 0
        ? sources
        : sources.filter((s) => s.interest_slug && picked.includes(s.interest_slug));
    return match.reduce((n, s) => n + (s.unseen_count ?? 0), 0);
  }, [sources, picked, allSelected, interests.length]);
  const nothingNew = !noneSelected && sources.length > 0 && unseenForSelection === 0;

  function toggle(slug: string) {
    setPicked((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]));
  }

  function setAll(on: boolean) {
    setPicked(on ? interests.map((f) => f.slug) : []);
  }

  function nudge(delta: number) {
    setMinutes((m) => Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, m + delta)));
  }

  async function start() {
    setBusy(true);
    setErr("");
    try {
      const resp = await api.createSession(minutes, themes);
      if (resp && resp.session_id) nav(`/session/${resp.session_id}`);
      else setErr("Nothing new to gather right now.");
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || noneSelected || nothingNew;
  const label = noneSelected
    ? "Pick a topic"
    : nothingNew
      ? "Nothing new right now"
      : "Start reading";

  return (
    <div className="intent">
      <div className="intent-head">
        <h1 className="display">How much time?</h1>
        <p className="sub">Set a length and pick your topics. Otium builds a session to fit.</p>
      </div>

      <div className="time-pick">
        <div className="time-set">
          <button
            className="step"
            onClick={() => nudge(-STEP)}
            disabled={minutes <= MIN_MINUTES}
            aria-label="5 minutes less"
          >
            &minus;
          </button>
          <div className="time-readout">
            <span className="big">{minutes}</span>
            <span className="unit">min</span>
          </div>
          <button
            className="step"
            onClick={() => nudge(STEP)}
            disabled={minutes >= MAX_MINUTES}
            aria-label="5 minutes more"
          >
            +
          </button>
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
      </div>

      {interests.length > 0 && (
        <div className="intent-topics">
          <div className="topics-head">
            <span className="topics-label">Topics</span>
            <button className="topics-all" onClick={() => setAll(!allSelected)}>
              {allSelected ? "Clear" : "All"}
            </button>
          </div>
          <ul className="topic-list">
            {interests.map((f) => {
              const on = picked.includes(f.slug);
              return (
                <li key={f.slug}>
                  <button
                    className="topic-row"
                    onClick={() => toggle(f.slug)}
                    role="checkbox"
                    aria-checked={on}
                  >
                    <span className={`topic-check ${on ? "on" : ""}`} aria-hidden="true" />
                    <span className="topic-name">{f.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {err && (
        <p className="intent-hint" role="alert">
          {err}
        </p>
      )}

      <button className="btn" onClick={start} disabled={disabled}>
        {label}
      </button>
    </div>
  );
}
