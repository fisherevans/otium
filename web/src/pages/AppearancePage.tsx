import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Selected } from "@/api/client";
import { Media, CardDate, Identity } from "@/components/CardParts";
import { usePreferences, prefsToVars } from "@/context/PreferencesContext";

// Appearance screen (#80/#81/#82). The centerpiece is a LIVE PREVIEW pinned at
// the top: a real session card + a reader text block, built from the same
// components the app uses, so what you see is exactly what you get. The controls
// scroll below; every change writes CSS vars to :root immediately (via the
// preferences context) so the preview and the whole app restyle live, and a
// debounced PUT persists it. The preview container also carries the vars as an
// inline scope, so it reflects the current edit state directly off React state.

// A representative article for the preview card + reader. The thumbnail is an
// inline SVG data-URI (self-contained, and colorful so the grayscale/color hero
// toggle is visibly demonstrated). Negative ids keep it clearly synthetic.
const HERO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Cdefs%3E%3ClinearGradient id='s' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0' stop-color='%23e8b04b'/%3E%3Cstop offset='1' stop-color='%23d76a5a'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='320' height='180' fill='url(%23s)'/%3E%3Ccircle cx='232' cy='58' r='30' fill='%23f6e7c8'/%3E%3Cpath d='M0 150 L70 104 L128 138 L196 92 L260 132 L320 100 L320 180 L0 180 Z' fill='%234a5a53'/%3E%3Cpath d='M0 168 L84 132 L150 160 L220 128 L320 158 L320 180 L0 180 Z' fill='%232f3a37'/%3E%3C/svg%3E";

const REL_TWO_DAYS = new Date(Date.now() - 2 * 86_400_000).toISOString();

const SAMPLE: Selected = {
  item: {
    id: -1,
    source_id: -1,
    url: "",
    title: "The quiet architecture of attention",
    summary:
      "Finite, chosen sessions beat the infinite scroll - not because restraint is virtuous, but because a boundary is what lets a thing feel finished.",
    content: "",
    author: "A. Writer",
    thumbnail_url: HERO,
    media_type: "article",
    duration_sec: 0,
    published_at: REL_TWO_DAYS,
    fetched_at: REL_TWO_DAYS,
  },
  source_title: "The Reader",
  feed: { name: "Essays", slug: "essays", color: "#6b7f6b", icon: "" },
  score: 0.82,
  est_duration_sec: 300,
  reason: "Fresh - posted recently",
  breakdown: {
    weight: 1,
    rarity: 1,
    freshness: 0.9,
    skip_penalty: 1,
    effective_score: 0.9,
    cadence_per_day: 0.3,
    skip_pct: 0,
    age_days: 2,
  },
};

// --- small calm control primitives -------------------------------------------

// Segmented picker (reuses the .wbuckets e-ink bar). For numeric options it
// highlights the option nearest the current value, so a chip is always active
// even if a stored value drifted off the grid.
function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const activeIdx = useMemo(() => {
    if (typeof value === "number") {
      let best = 0;
      let bestD = Infinity;
      options.forEach((o, i) => {
        const d = Math.abs((o.value as number) - value);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    }
    return options.findIndex((o) => o.value === value);
  }, [options, value]);
  return (
    <div className="ctl">
      <div className="ctl-label">{label}</div>
      <div className="wbuckets">
        {options.map((o, i) => (
          <button
            key={String(o.value)}
            className={`wbucket ${i === activeIdx ? "on" : ""}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  desc,
  on,
  onChange,
}: {
  label: string;
  desc: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="settings-row">
      <div className="settings-copy">
        <b>{label}</b>
        <span>{desc}</span>
      </div>
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`switch ${on ? "on" : ""}`}
        onClick={() => onChange(!on)}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}

// --- the page ----------------------------------------------------------------

const READER_SIZE = [
  { label: "Small", value: 15 },
  { label: "Default", value: 17 },
  { label: "Large", value: 19 },
  { label: "X-Large", value: 22 },
];
const LINE_HEIGHT = [
  { label: "Tight", value: 1.4 },
  { label: "Default", value: 1.62 },
  { label: "Relaxed", value: 1.8 },
  { label: "Loose", value: 2.0 },
];
const MEASURE = [
  { label: "Narrow", value: 40 },
  { label: "Default", value: 66 },
  { label: "Wide", value: 80 },
];
const META_SIZE = [
  { label: "Small", value: 9 },
  { label: "Default", value: 11 },
  { label: "Large", value: 13 },
];
const TAG_SIZE = [
  { label: "Small", value: 11 },
  { label: "Default", value: 13 },
  { label: "Large", value: 16 },
];
const HERO_COLOR = [
  { label: "Grayscale", value: 0 },
  { label: "Color", value: 1 },
];

const PRESET_MIN = 5;
const PRESET_MAX = 120;
const PRESET_STEP = 5;
const MAX_PRESETS = 8;

function normalizePresets(list: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (let v of list) {
    v = Math.max(PRESET_MIN, Math.min(PRESET_MAX, Math.round(v / PRESET_STEP) * PRESET_STEP));
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out.sort((a, b) => a - b).slice(0, MAX_PRESETS);
}

function presetLabel(v: number): string {
  if (v >= 60 && v % 60 === 0) {
    const h = v / 60;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  return `${v} min`;
}

export default function AppearancePage() {
  const nav = useNavigate();
  const { prefs, update } = usePreferences();

  function setPresetAt(i: number, v: number) {
    const next = prefs.presets.slice();
    next[i] = v;
    update({ presets: normalizePresets(next) });
  }
  function removePreset(i: number) {
    if (prefs.presets.length <= 1) return; // keep at least one entry point
    const next = prefs.presets.slice();
    next.splice(i, 1);
    update({ presets: normalizePresets(next) });
  }
  function addPreset() {
    if (prefs.presets.length >= MAX_PRESETS) return;
    // Add the next unused 5-min slot after the current max.
    const max = prefs.presets.length ? Math.max(...prefs.presets) : 0;
    let cand = Math.min(PRESET_MAX, max + 15);
    while (prefs.presets.includes(cand) && cand < PRESET_MAX) cand += PRESET_STEP;
    update({ presets: normalizePresets([...prefs.presets, cand]) });
  }

  return (
    <div className="appearance">
      <button className="lib-back" onClick={() => nav("/settings")}>
        <span aria-hidden>←</span> Settings
      </button>

      {/* Live preview - pinned so it stays visible while you scroll the controls.
          Carries the current prefs as an inline var scope, so it reflects edits
          straight off React state (identical values to :root). */}
      <div className="preview" style={prefsToVars(prefs)}>
        <div className="preview-tag">Live preview</div>
        <div className="preview-scroll">
          <div className="pv-card snap">
            <div className="reason-row">
              <span className="reason">{SAMPLE.reason}</span>
            </div>
            <h3>{SAMPLE.item.title}</h3>
            <CardDate item={SAMPLE.item} />
            <Media item={SAMPLE.item} />
            <Identity sel={SAMPLE} onSource={() => {}} />
            <p className="excerpt">{SAMPLE.item.summary}</p>
          </div>

          <div className="pv-reader reader">
            <h3 className="reader-title">{SAMPLE.item.title}</h3>
            <div className="reader-meta">
              <span>{SAMPLE.source_title}</span>
              <span>·</span>
              <span>{SAMPLE.item.author}</span>
            </div>
            <div className="reader-body">
              <p>
                Attention is the only truly scarce thing you spend here. Everything else - the feed, the queue, the
                endless backlog - is manufactured abundance. A session says: this much, and no more.
              </p>
              <img src={HERO} alt="" />
              <p>
                When the boundary is real, finishing is real. You close the session not because you ran out of things
                to read, but because you chose where the edge was.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="ctl-groups">
        {/* Reader typography (#61) */}
        <section className="ctl-section">
          <h2 className="ctl-heading">Reader</h2>
          <Segmented
            label="Text size"
            options={READER_SIZE}
            value={prefs.reader.font_size}
            onChange={(v) => update({ reader: { font_size: v } })}
          />
          <Segmented
            label="Line spacing"
            options={LINE_HEIGHT}
            value={prefs.reader.line_height}
            onChange={(v) => update({ reader: { line_height: v } })}
          />
          <Segmented
            label="Line length"
            options={MEASURE}
            value={prefs.reader.measure}
            onChange={(v) => update({ reader: { measure: v } })}
          />
          <ToggleRow
            label="Images in reader"
            desc="Show images inline while reading. Off is calmer on e-ink and lighter on data."
            on={prefs.reader.images}
            onChange={(v) => update({ reader: { images: v } })}
          />
        </section>

        {/* Card styling (#81) */}
        <section className="ctl-section">
          <h2 className="ctl-heading">Card</h2>
          <Segmented
            label="Sub-text size"
            options={META_SIZE}
            value={prefs.card.meta_size}
            onChange={(v) => update({ card: { meta_size: v } })}
          />
          <Segmented
            label="Source label"
            options={META_SIZE}
            value={prefs.card.source_size}
            onChange={(v) => update({ card: { source_size: v } })}
          />
          <Segmented
            label="Feed tag"
            options={TAG_SIZE}
            value={prefs.card.feed_tag_size}
            onChange={(v) => update({ card: { feed_tag_size: v } })}
          />
          <Segmented
            label="Date"
            options={TAG_SIZE}
            value={prefs.card.date_size}
            onChange={(v) => update({ card: { date_size: v } })}
          />
          <Segmented
            label="Hero image"
            options={HERO_COLOR}
            value={prefs.card.hero_color ? 1 : 0}
            onChange={(v) => update({ card: { hero_color: v === 1 } })}
          />
          <ToggleRow
            label="Show hero image"
            desc="Show the lead image on the card. Off keeps cards text-first."
            on={prefs.card.hero_show}
            onChange={(v) => update({ card: { hero_show: v } })}
          />
        </section>

        {/* Session-length presets (#82) */}
        <section className="ctl-section">
          <h2 className="ctl-heading">Session lengths</h2>
          <p className="sub" style={{ marginTop: 0 }}>
            The starting-length chips on the intent page. {PRESET_MIN}-{PRESET_MAX} minutes, in steps of {PRESET_STEP}.
          </p>
          <div className="preset-editor">
            {prefs.presets.map((p, i) => (
              <div className="preset-edit-row" key={i}>
                <div className="capstep">
                  <button
                    onClick={() => setPresetAt(i, p - PRESET_STEP)}
                    disabled={p <= PRESET_MIN}
                    aria-label="less"
                  >
                    &minus;
                  </button>
                  <span className="preset-edit-val">{presetLabel(p)}</span>
                  <button
                    onClick={() => setPresetAt(i, p + PRESET_STEP)}
                    disabled={p >= PRESET_MAX}
                    aria-label="more"
                  >
                    +
                  </button>
                </div>
                <button
                  className="preset-remove"
                  onClick={() => removePreset(i)}
                  disabled={prefs.presets.length <= 1}
                  aria-label={`Remove ${presetLabel(p)}`}
                >
                  ×
                </button>
              </div>
            ))}
            <button className="btn ghost preset-add" onClick={addPreset} disabled={prefs.presets.length >= MAX_PRESETS}>
              Add a length
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
