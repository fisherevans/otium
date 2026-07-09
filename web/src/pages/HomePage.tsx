import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Topic, type Section, type Source } from "@/api/client";
import { usePreferences } from "@/context/PreferencesContext";

// The intent flow is two deliberate steps (#112/#132):
//   1. How long - preset chips from the user's session-length presets (editable in
//      Settings -> Appearance -> Sessions), plus a "custom" link (slider + number).
//   2. Choose section(s) - "Everything you follow" (default) or one/many of the
//      user's Sections. A subtle "Customize" link then reveals the Topics inside the
//      chosen sections so you can uncheck any you don't want this session. Begin.
//
// Session build (#67/#69/#86): POST /sessions with the duration, selected topic slugs
// as `themes`, and selected section slugs as `sections`. Customizing sends the kept
// topics as themes (no section slug) so the excluded ones drop out; a plain section
// selection sends the section slug (server expands it to all its topics). Everything
// sends both empty (topicless sources included too).

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

  // Selection. `everything` is the default; picking any section turns it off.
  const [everything, setEverything] = useState(true);
  const [pickedSections, setPickedSections] = useState<string[]>([]);
  const [customizing, setCustomizing] = useState(false);
  // Topic slugs unchecked while customizing (within the picked sections).
  const [excluded, setExcluded] = useState<string[]>([]);

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

  const topicsBySection = useMemo(() => {
    const m = new Map<string, Topic[]>();
    for (const t of topics) {
      if (!t.section_slug) continue;
      if (!m.has(t.section_slug)) m.set(t.section_slug, []);
      m.get(t.section_slug)!.push(t);
    }
    return m;
  }, [topics]);

  // Topics in the currently-picked sections (the scope Customize narrows).
  const scopedTopics = useMemo(
    () => pickedSections.flatMap((slug) => topicsBySection.get(slug) ?? []),
    [pickedSections, topicsBySection],
  );

  function pickEverything() {
    setEverything(true);
    setPickedSections([]);
    setCustomizing(false);
    setExcluded([]);
  }
  function toggleSection(slug: string) {
    setEverything(false);
    setPickedSections((p) => {
      const next = p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug];
      if (next.length === 0) {
        setCustomizing(false);
        setExcluded([]);
      }
      return next;
    });
  }
  function toggleExclude(slug: string) {
    setExcluded((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]));
  }

  const effectiveEverything = everything || pickedSections.length === 0;

  // Kept topic slugs when customizing (scope minus excluded).
  const keptTopics = useMemo(
    () => scopedTopics.filter((t) => !excluded.includes(t.slug)).map((t) => t.slug),
    [scopedTopics, excluded],
  );

  // Unseen supply for the selection, to disable Begin when there's nothing new.
  const unseen = useMemo(() => {
    if (effectiveEverything) return sources.reduce((n, s) => n + (s.unseen_count ?? 0), 0);
    const scope = customizing ? keptTopics : scopedTopics.map((t) => t.slug);
    const match = sources.filter((s) => s.topic_slug && scope.includes(s.topic_slug));
    return match.reduce((n, s) => n + (s.unseen_count ?? 0), 0);
  }, [sources, effectiveEverything, customizing, keptTopics, scopedTopics]);
  const nothingNew = sources.length > 0 && unseen === 0;

  async function begin() {
    if (minutes == null) return;
    setBusy(true);
    setErr("");
    try {
      let themes: string[] = [];
      let sectionSlugs: string[] = [];
      if (!effectiveEverything) {
        if (customizing) themes = keptTopics;
        else sectionSlugs = pickedSections;
      }
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
                  <button key={v} className={`time-chip ${minutes === v ? "on" : ""}`} onClick={() => setMinutes(v)}>
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
            <p className="sub">One or more sections, or everything you follow.</p>
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
                        <span className="pick-meta">{m.topic_count === 1 ? "1 topic" : `${m.topic_count} topics`}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Customize: uncheck individual topics inside the chosen sections. */}
          {!effectiveEverything && scopedTopics.length > 0 && (
            <div className="pick-customize">
              {!customizing ? (
                <button className="intent-link" onClick={() => setCustomizing(true)}>
                  customize topics…
                </button>
              ) : (
                <>
                  <div className="pick-group-label">Topics ({keptTopics.length} of {scopedTopics.length})</div>
                  {pickedSections.map((slug) => {
                    const list = topicsBySection.get(slug) ?? [];
                    const sec = sections.find((s) => s.slug === slug);
                    if (list.length === 0) return null;
                    return (
                      <div className="pick-group" key={slug}>
                        <div className="pick-group-sublabel">{sec?.name}</div>
                        <ul className="pick-list">
                          {list.map((t) => {
                            const on = !excluded.includes(t.slug);
                            return (
                              <li key={t.slug}>
                                <button className={`pick-row ${on ? "on" : ""}`} onClick={() => toggleExclude(t.slug)} role="checkbox" aria-checked={on}>
                                  <span className={`pick-check ${on ? "on" : ""}`} aria-hidden />
                                  <span className="pick-name">{t.name}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                  <button className="intent-link" onClick={() => (setCustomizing(false), setExcluded([]))}>
                    done customizing
                  </button>
                </>
              )}
            </div>
          )}

          {err && (
            <p className="intent-hint" role="alert">
              {err}
            </p>
          )}

          <button className="btn" onClick={begin} disabled={busy || nothingNew || (customizing && keptTopics.length === 0)}>
            {busy ? "Gathering…" : nothingNew ? "Nothing new right now" : "Begin"}
          </button>
        </div>
      )}
    </div>
  );
}
