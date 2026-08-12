import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Topic, type Section, type Source } from "@/api/client";
import { usePreferences } from "@/context/PreferencesContext";
import { HowItWorks } from "@/components/HowItWorks";

// The intent flow is three deliberate, sparse screens (#112/#132, restructured
// #142) - each fits without scrolling, and selecting usually advances you:
//   1. How long - preset chips + a custom slider.
//   2. What to read - "Everything you follow" or one section. Single-select by
//      default: tapping a section picks it AND advances. A "Select multiple" link
//      switches to checkboxes + a Next button for combining sections.
//   3. Topics + Begin - fine-tune the chosen section(s) topics (drop any for this
//      session) and start. Everything skips the tuning (no single section to narrow).
// Back button + swipe-right move backward through the screens.
//
// Session build (#67/#69/#86): POST /sessions with the duration, selected topic slugs
// as `themes`, and selected section slugs as `sections`. Dropping a topic sends the
// kept topics as themes (excluded ones fall out); a clean section selection sends the
// section slug (server expands it to all its topics). Everything sends both empty.

const MIN_MINUTES = 5;
const MAX_MINUTES = 120;
const STEP = 5;

function minutesLabel(v: number): string {
  if (v < 60) return `${v} min`;
  const h = v / 60;
  return Number.isInteger(h) ? `${h} hr` : `${Math.floor(v / 60)}h ${v % 60}m`;
}

type Step = 1 | 2 | 3;

export default function HomePage() {
  const nav = useNavigate();
  const { prefs } = usePreferences();

  const [step, setStep] = useState<Step>(1);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [custom, setCustom] = useState(false);

  const [topics, setTopics] = useState<Topic[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [sources, setSources] = useState<Source[]>([]);

  // Selection. `everything` is the default; picking any section turns it off.
  const [everything, setEverything] = useState(true);
  const [pickedSections, setPickedSections] = useState<string[]>([]);
  const [multi, setMulti] = useState(false); // section screen: checkbox mode
  // Topic slugs dropped for this session (within the picked sections).
  const [excluded, setExcluded] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api.topics().then((t) => setTopics(t ?? [])).catch(() => setTopics([]));
    api.sections().then(setSections).catch(() => setSections([]));
    api
      .sources()
      .then((s) => setSources(s ?? []))
      .catch(() => setSources([]))
      .finally(() => setLoaded(true));
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

  // Topics in the currently-picked sections (the scope step 3 tunes).
  const scopedTopics = useMemo(
    () => pickedSections.flatMap((slug) => topicsBySection.get(slug) ?? []),
    [pickedSections, topicsBySection],
  );

  const effectiveEverything = everything || pickedSections.length === 0;

  // Kept topic slugs (scope minus dropped).
  const keptTopics = useMemo(
    () => scopedTopics.filter((t) => !excluded.includes(t.slug)).map((t) => t.slug),
    [scopedTopics, excluded],
  );

  // --- section-screen actions ---
  // Single-select: pick one and advance straight to the topics/Begin screen.
  function pickEverythingAndGo() {
    setEverything(true);
    setPickedSections([]);
    setExcluded([]);
    setStep(3);
  }
  function pickSectionAndGo(slug: string) {
    setEverything(false);
    setPickedSections([slug]);
    setExcluded([]);
    setStep(3);
  }
  // Multi-select: accumulate, advance on Next.
  function toggleSection(slug: string) {
    setEverything(false);
    setPickedSections((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]));
    setExcluded([]);
  }
  function toggleExclude(slug: string) {
    setExcluded((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]));
  }

  // Unseen supply for the selection, to disable Begin when there's nothing new.
  const unseen = useMemo(() => {
    if (effectiveEverything) return sources.reduce((n, s) => n + (s.unseen_count ?? 0), 0);
    const scope = keptTopics;
    const match = sources.filter((s) => s.topic_slug && scope.includes(s.topic_slug));
    return match.reduce((n, s) => n + (s.unseen_count ?? 0), 0);
  }, [sources, effectiveEverything, keptTopics]);
  const nothingNew = sources.length > 0 && unseen === 0;

  async function begin() {
    if (minutes == null) return;
    setBusy(true);
    setErr("");
    try {
      let themes: string[] = [];
      let sectionSlugs: string[] = [];
      if (!effectiveEverything) {
        // Dropping a topic sends the kept ones as themes; an untouched selection
        // sends the section slug so the server expands it (topicless sources too).
        if (excluded.length > 0) themes = keptTopics;
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

  // Swipe-right anywhere on a step moves backward (like the reader's back gesture).
  const press = useRef<{ x: number; y: number } | null>(null);
  function stepDown(e: ReactPointerEvent) {
    press.current = { x: e.clientX, y: e.clientY };
  }
  function stepUp(e: ReactPointerEvent) {
    const p = press.current;
    press.current = null;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (dx > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (step === 3) setStep(2);
      else if (step === 2) setStep(1);
    }
  }

  // #138 first-run: no sources yet, so no session is possible. Point to the Library
  // and explain the model instead of a time picker that can't build anything.
  if (loaded && sources.length === 0) {
    return (
      <div className="intent">
        <div className="intent-step">
          <div className="intent-head">
            <h1 className="display">Welcome to Otium</h1>
            <p className="sub">A calmer way to keep up - finite sessions from the feeds you choose, not an endless stream.</p>
          </div>
          <p className="firstrun-step">
            You don't follow anything yet. Head to your <b>Library</b> to add a topic and its first sources - any RSS/Atom
            feed, YouTube channel, or podcast. Then come back and pick how long you have.
          </p>
          <button className="btn" onClick={() => nav("/sections")}>
            Go to Library
          </button>
          <HowItWorks defaultOpen />
        </div>
      </div>
    );
  }

  return (
    <div className="intent" onPointerDown={stepDown} onPointerUp={stepUp}>
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
            Choose what to read →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="intent-step slide-up step-sections" key="step-section">
          <div className="intent-head">
            <button className="intent-back" onClick={() => setStep(1)} aria-label="Back to length">
              ← {minutesLabel(minutes ?? 0)}
            </button>
            <h1 className="display">What to read</h1>
            <p className="sub">{multi ? "Pick any sections to combine." : "Tap a section, or read everything."}</p>
          </div>

          {/* Everything is a distinct full-width tile (single-select only). */}
          {!multi && (
            <button className="sec-tile everything" onClick={pickEverythingAndGo}>
              <span className="sec-tile-name">Everything you follow</span>
              <span className="sec-tile-meta">all your sources →</span>
            </button>
          )}

          {sections.length > 0 && (
            <>
              {!multi && (
                <div className="sec-divider">
                  <span>or choose a section</span>
                </div>
              )}
              <div className="sec-tiles">
                {sections.map((m) => {
                  const on = multi && pickedSections.includes(m.slug);
                  return (
                    <button
                      key={m.slug}
                      className={`sec-tile ${on ? "on" : ""}`}
                      onClick={() => (multi ? toggleSection(m.slug) : pickSectionAndGo(m.slug))}
                      role={multi ? "checkbox" : undefined}
                      aria-checked={multi ? on : undefined}
                    >
                      <span className="sec-tile-name">{m.name}</span>
                      <span className="sec-tile-meta">
                        {m.topic_count === 1 ? "1 topic" : `${m.topic_count} topics`}
                        {!multi ? " →" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Toggle between single-tap-to-go and multi-select-then-Next. */}
          {sections.length > 1 && (
            <button
              className="intent-link sec-multi-link"
              onClick={() => {
                setMulti((v) => !v);
                setPickedSections([]);
                setEverything(true);
              }}
            >
              {multi ? "← back to single" : "select multiple"}
            </button>
          )}

          {multi && (
            <button className="btn" onClick={() => setStep(3)} disabled={pickedSections.length === 0}>
              {pickedSections.length === 0 ? "Pick a section" : "Next →"}
            </button>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="intent-step slide-up step-sections" key="step-topics">
          <div className="intent-head">
            <button className="intent-back" onClick={() => setStep(2)} aria-label="Back to sections">
              ← {effectiveEverything ? "everything" : pickedSections.length === 1 ? sectionName(sections, pickedSections[0]) : `${pickedSections.length} sections`}
            </button>
            <h1 className="display">{effectiveEverything ? "Ready" : "Fine-tune"}</h1>
            <p className="sub">
              {effectiveEverything
                ? "Reading everything you follow."
                : "Drop any topic you'd rather skip this session, or just begin."}
            </p>
          </div>

          {!effectiveEverything && scopedTopics.length > 0 && (
            <div className="topic-tune open">
              <div className="topic-tune-head">
                <span className="pick-group-label">Topics · {keptTopics.length} of {scopedTopics.length} on</span>
              </div>
              {pickedSections.map((slug) => {
                const list = topicsBySection.get(slug) ?? [];
                const sec = sections.find((s) => s.slug === slug);
                if (list.length === 0) return null;
                return (
                  <div className="topic-group" key={slug}>
                    {pickedSections.length > 1 && <div className="pick-group-sublabel">{sec?.name}</div>}
                    <div className="topic-chips">
                      {list.map((t) => {
                        const on = !excluded.includes(t.slug);
                        return (
                          <button
                            key={t.slug}
                            className={`topic-chip ${on ? "on" : "off"}`}
                            onClick={() => toggleExclude(t.slug)}
                            aria-pressed={on}
                          >
                            {t.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {err && (
            <p className="intent-hint" role="alert">
              {err}
            </p>
          )}

          <button className="btn" onClick={begin} disabled={busy || nothingNew || (!effectiveEverything && keptTopics.length === 0)}>
            {busy ? "Gathering…" : nothingNew ? "Nothing new right now" : "Begin"}
          </button>
        </div>
      )}
    </div>
  );
}

function sectionName(sections: Section[], slug: string): string {
  return sections.find((s) => s.slug === slug)?.name ?? "section";
}
