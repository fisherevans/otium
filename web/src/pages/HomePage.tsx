import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Topic, type Section, type Source } from "@/api/client";
import { usePreferences } from "@/context/PreferencesContext";

// The intent flow is two deliberate steps (#112):
//   1. How long - preset chips from the user's session-length presets (editable
//      in Settings -> Appearance -> Sessions), plus a "custom" link that reveals a
//      slider + numeric input. Next advances.
//   2. Choose a section - "Everything you follow" (default), the user's sections (saved
//      groups of topics), and the individual topics below as "other". Custom
//      selection is just multi-checking sections/topics. "Begin" builds the session.
//
// Session build (unchanged, #67/#69/#86): POST /sessions with the chosen duration,
// the selected topic slugs as `themes`, and the selected section slugs as `sections`.
// "Everything" sends both empty, so topicless sources are included too.

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

  const [topics, setTopics] = useState<Topic[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [sources, setSources] = useState<Source[]>([]);

  // Selection. `everything` is the default; picking any section/topic turns it off.
  const [everything, setEverything] = useState(true);
  const [pickedSections, setPickedSections] = useState<string[]>([]);
  const [pickedTopics, setPickedTopics] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.topics().then(setTopics).catch(() => setTopics([]));
    api.sections().then(setSections).catch(() => setSections([]));
    api.sources().then(setSources).catch(() => setSources([]));
  }, []);

  // Default the time to a preset once preferences load (middle-ish, else first).
  useEffect(() => {
    if (minutes == null && prefs.presets.length > 0) {
      const mid = prefs.presets[Math.min(1, prefs.presets.length - 1)];
      setMinutes(mid);
    }
  }, [prefs.presets, minutes]);

  // Topics that belong to no section, shown as "other sources" in step 2. With no
  // sections defined yet this is simply every topic.
  const sectionedTopicSlugs = useMemo(() => {
    // We don't have per-section membership loaded here (that's a drill-in); treat all
    // topics as pickable and only separate them once sections carry members.
    return new Set<string>();
  }, []);
  const otherTopics = useMemo(
    () => topics.filter((i) => !sectionedTopicSlugs.has(i.slug)),
    [topics, sectionedTopicSlugs],
  );

  function pickEverything() {
    setEverything(true);
    setPickedSections([]);
    setPickedTopics([]);
  }
  function toggleSection(slug: string) {
    setEverything(false);
    setPickedSections((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]));
  }
  function toggleTopic(slug: string) {
    setEverything(false);
    setPickedTopics((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]));
  }

  // If a selection empties out, fall back to "everything" so Begin is never a no-op.
  const effectiveEverything = everything || (pickedSections.length === 0 && pickedTopics.length === 0);

  // Unseen supply for the selection, to disable Begin when there's nothing new.
  const unseen = useMemo(() => {
    if (effectiveEverything) return sources.reduce((n, s) => n + (s.unseen_count ?? 0), 0);
    const match = sources.filter((s) => s.topic_slug && pickedTopics.includes(s.topic_slug));
    // Sections expand server-side; if any section is picked we can't cheaply count here,
    // so assume there's supply (the build will confirm).
    if (pickedSections.length > 0) return 1;
    return match.reduce((n, s) => n + (s.unseen_count ?? 0), 0);
  }, [sources, pickedTopics, pickedSections, effectiveEverything]);
  const nothingNew = sources.length > 0 && unseen === 0;

  async function begin() {
    if (minutes == null) return;
    setBusy(true);
    setErr("");
    try {
      const themes = effectiveEverything ? [] : pickedTopics;
      const sectionSlugs = effectiveEverything ? [] : pickedSections;
      const resp = await api.createSession(minutes, themes, sectionSlugs);
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
            Choose a section →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="intent-step slide-up" key="step-section">
          <div className="intent-head">
            <button className="intent-back" onClick={() => setStep(1)} aria-label="Back to length">
              ← {minutesLabel(minutes ?? 0)}
            </button>
            <h1 className="display">Choose a section</h1>
            <p className="sub">A section, or hand-pick what to read. Nothing chosen = everything you follow.</p>
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

          {sections.length > 0 && (
            <div className="pick-group">
              <div className="pick-group-label">Sections</div>
              <ul className="pick-list">
                {sections.map((m) => {
                  const on = !everything && pickedSections.includes(m.slug);
                  return (
                    <li key={m.slug}>
                      <button className={`pick-row ${on ? "on" : ""}`} onClick={() => toggleSection(m.slug)} role="checkbox" aria-checked={on}>
                        <span className={`pick-check ${on ? "on" : ""}`} aria-hidden />
                        <span className="pick-name">{m.name}</span>
                        <span className="pick-meta">{m.topic_count} topics</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {otherTopics.length > 0 && (
            <div className="pick-group">
              <div className="pick-group-label">{sections.length > 0 ? "Other topics" : "Topics"}</div>
              <ul className="pick-list">
                {otherTopics.map((i) => {
                  const on = !everything && pickedTopics.includes(i.slug);
                  return (
                    <li key={i.slug}>
                      <button className={`pick-row ${on ? "on" : ""}`} onClick={() => toggleTopic(i.slug)} role="checkbox" aria-checked={on}>
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
