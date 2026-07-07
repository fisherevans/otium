import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Interest, type Mix, type Source } from "@/api/client";
import { usePreferences } from "@/context/PreferencesContext";

// The intent flow is two deliberate steps (#112):
//   1. How long - preset chips from the user's session-length presets (editable
//      in Settings -> Appearance -> Sessions), plus a "custom" link that reveals a
//      slider + numeric input. Next advances.
//   2. Choose a mix - "Everything you follow" (default), the user's mixes (saved
//      groups of interests), and the individual interests below as "other". Custom
//      selection is just multi-checking mixes/interests. "Begin" builds the session.
//
// Session build (unchanged, #67/#69/#86): POST /sessions with the chosen duration,
// the selected interest slugs as `themes`, and the selected mix slugs as `mixes`.
// "Everything" sends both empty, so interestless sources are included too.

const MIN_MINUTES = 5;
const MAX_MINUTES = 120;
const STEP = 5;

function minutesLabel(v: number): string {
  if (v < 60) return `${v} min`;
  const h = v / 60;
  return Number.isInteger(h) ? `${h} hr` : `${Math.floor(v / 60)}h ${v % 60}m`;
}

export default function HomePage() {
  const nav = useNavigate();
  const { prefs } = usePreferences();

  const [step, setStep] = useState<1 | 2>(1);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [custom, setCustom] = useState(false);

  const [interests, setInterests] = useState<Interest[]>([]);
  const [mixes, setMixes] = useState<Mix[]>([]);
  const [sources, setSources] = useState<Source[]>([]);

  // Selection. `everything` is the default; picking any mix/interest turns it off.
  const [everything, setEverything] = useState(true);
  const [pickedMixes, setPickedMixes] = useState<string[]>([]);
  const [pickedInterests, setPickedInterests] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.interests().then(setInterests).catch(() => setInterests([]));
    api.mixes().then(setMixes).catch(() => setMixes([]));
    api.sources().then(setSources).catch(() => setSources([]));
  }, []);

  // Default the time to a preset once preferences load (middle-ish, else first).
  useEffect(() => {
    if (minutes == null && prefs.presets.length > 0) {
      const mid = prefs.presets[Math.min(1, prefs.presets.length - 1)];
      setMinutes(mid);
    }
  }, [prefs.presets, minutes]);

  // Interests that belong to no mix, shown as "other sources" in step 2. With no
  // mixes defined yet this is simply every interest.
  const mixedInterestSlugs = useMemo(() => {
    // We don't have per-mix membership loaded here (that's a drill-in); treat all
    // interests as pickable and only separate them once mixes carry members.
    return new Set<string>();
  }, []);
  const otherInterests = useMemo(
    () => interests.filter((i) => !mixedInterestSlugs.has(i.slug)),
    [interests, mixedInterestSlugs],
  );

  function pickEverything() {
    setEverything(true);
    setPickedMixes([]);
    setPickedInterests([]);
  }
  function toggleMix(slug: string) {
    setEverything(false);
    setPickedMixes((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]));
  }
  function toggleInterest(slug: string) {
    setEverything(false);
    setPickedInterests((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]));
  }

  // If a selection empties out, fall back to "everything" so Begin is never a no-op.
  const effectiveEverything = everything || (pickedMixes.length === 0 && pickedInterests.length === 0);

  // Unseen supply for the selection, to disable Begin when there's nothing new.
  const unseen = useMemo(() => {
    if (effectiveEverything) return sources.reduce((n, s) => n + (s.unseen_count ?? 0), 0);
    const match = sources.filter((s) => s.interest_slug && pickedInterests.includes(s.interest_slug));
    // Mixes expand server-side; if any mix is picked we can't cheaply count here,
    // so assume there's supply (the build will confirm).
    if (pickedMixes.length > 0) return 1;
    return match.reduce((n, s) => n + (s.unseen_count ?? 0), 0);
  }, [sources, pickedInterests, pickedMixes, effectiveEverything]);
  const nothingNew = sources.length > 0 && unseen === 0;

  async function begin() {
    if (minutes == null) return;
    setBusy(true);
    setErr("");
    try {
      const themes = effectiveEverything ? [] : pickedInterests;
      const mixSlugs = effectiveEverything ? [] : pickedMixes;
      const resp = await api.createSession(minutes, themes, mixSlugs);
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
      {step === 1 && (
        <div className="intent-step" key="step-time">
          <div className="intent-head">
            <h1 className="display">How long?</h1>
            <p className="sub">Pick a length. Otium builds a finite session to fit.</p>
          </div>

          {!custom ? (
            <>
              <div className="time-presets">
                {prefs.presets.map((v) => (
                  <button
                    key={v}
                    className={`time-chip ${minutes === v ? "on" : ""}`}
                    onClick={() => setMinutes(v)}
                  >
                    {minutesLabel(v)}
                  </button>
                ))}
              </div>
              <button className="intent-link" onClick={() => setCustom(true)}>
                custom length
              </button>
            </>
          ) : (
            <div className="time-custom">
              <div className="time-readout">
                <span className="big">{minutes ?? 0}</span>
                <span className="unit">min</span>
              </div>
              <input
                className="time-slider"
                type="range"
                min={MIN_MINUTES}
                max={MAX_MINUTES}
                step={STEP}
                value={minutes ?? MIN_MINUTES}
                onChange={(e) => setMinutes(Number(e.target.value))}
                aria-label="How long"
              />
              <input
                className="field time-number"
                type="number"
                min={MIN_MINUTES}
                max={MAX_MINUTES}
                value={minutes ?? MIN_MINUTES}
                onChange={(e) => setMinutes(Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Number(e.target.value) || MIN_MINUTES)))}
                aria-label="Minutes"
              />
              <button className="intent-link" onClick={() => setCustom(false)}>
                use a preset
              </button>
            </div>
          )}

          <button className="btn" onClick={() => setStep(2)} disabled={minutes == null}>
            Choose a mix →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="intent-step slide-up" key="step-mix">
          <div className="intent-head">
            <button className="intent-back" onClick={() => setStep(1)} aria-label="Back to length">
              ← {minutesLabel(minutes ?? 0)}
            </button>
            <h1 className="display">Choose a mix</h1>
            <p className="sub">A mix, or hand-pick what to read. Nothing chosen = everything you follow.</p>
          </div>

          <ul className="pick-list">
            <li>
              <button
                className={`pick-row primary ${effectiveEverything ? "on" : ""}`}
                onClick={pickEverything}
                role="checkbox"
                aria-checked={effectiveEverything}
              >
                <span className={`pick-check ${effectiveEverything ? "on" : ""}`} aria-hidden />
                <span className="pick-name">Everything you follow</span>
              </button>
            </li>
          </ul>

          {mixes.length > 0 && (
            <div className="pick-group">
              <div className="pick-group-label">Mixes</div>
              <ul className="pick-list">
                {mixes.map((m) => {
                  const on = !everything && pickedMixes.includes(m.slug);
                  return (
                    <li key={m.slug}>
                      <button className={`pick-row ${on ? "on" : ""}`} onClick={() => toggleMix(m.slug)} role="checkbox" aria-checked={on}>
                        <span className={`pick-check ${on ? "on" : ""}`} aria-hidden />
                        <span className="pick-name">{m.name}</span>
                        <span className="pick-meta">{m.interest_count} interests</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {otherInterests.length > 0 && (
            <div className="pick-group">
              <div className="pick-group-label">{mixes.length > 0 ? "Other interests" : "Interests"}</div>
              <ul className="pick-list">
                {otherInterests.map((i) => {
                  const on = !everything && pickedInterests.includes(i.slug);
                  return (
                    <li key={i.slug}>
                      <button className={`pick-row ${on ? "on" : ""}`} onClick={() => toggleInterest(i.slug)} role="checkbox" aria-checked={on}>
                        <span className={`pick-check ${on ? "on" : ""}`} aria-hidden />
                        <span className="pick-name">{i.name}</span>
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

          <button className="btn" onClick={begin} disabled={busy || nothingNew}>
            {busy ? "Gathering…" : nothingNew ? "Nothing new right now" : "Begin"}
          </button>
        </div>
      )}
    </div>
  );
}
