import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api, type FontKey, type InkKey, type Preferences, type PreferencesPatch } from "@/api/client";

// PreferencesContext (#80) is the reactive spine of the appearance system.
//
// The tunable values are applied as CSS custom properties on :root, and the
// reader + card CSS reads them (with the current theme values as fallbacks). That
// is what makes BOTH the live app and the Appearance screen's preview restyle
// instantly with zero prop-drilling: change a var, everything that consumes it
// reflows. Non-CSS values (presets) are read straight off the context.
//
// Defaults are held locally so the app has a correct look on first paint (no
// flash); the server fetch reconciles to the stored blob. Edits apply to :root
// immediately and persist via a debounced PUT (merge semantics server-side).

const DEFAULTS: Preferences = {
  reader: {
    font_size: 17,
    line_height: 1.62,
    measure: 66,
    images: true,
    font_family: "newsreader",
    font_weight: 400,
    ink: "soft",
  },
  card: {
    meta_size: 11,
    source_size: 15,
    topic_tag_size: 13,
    date_size: 13,
    hero_show: true,
    hero_color: true,
    // #97 per-element meta defaults mirror the v0.29 card's designed look.
    topic_weight: 600,
    topic_ink: "topic",
    source_weight: 600,
    source_ink: "soft",
    author_weight: 500,
    author_ink: "mute",
    date_weight: 400,
    date_ink: "mute",
    delim: "dot",
    delim_gap: 7,
    // legacy shared meta (pre-#97), kept only as the server-side migration seed.
    meta_weight: 400,
    meta_ink: "mute",
  },
  presets: [5, 10, 20, 40],
};

// #90: curated typography maps. Font keys resolve to system font stacks (the
// existing theme stacks + one new book serif) - no self-hosted/CDN fonts, in
// keeping with the offline stance. Ink keys are grayscale shades on the e-ink
// ramp. Both are shared with the Appearance editor so swatches/labels match
// exactly what the app renders. Both values are `var(...)` references resolved
// lazily at the consuming element (works because custom-property values can hold
// var() and are substituted at use site). #159: inks must be theme tokens, never
// hex - a literal here is dark-on-dark once the dark palette applies.
export const FONT_STACKS: Record<FontKey, string> = {
  newsreader: "var(--reading)",
  charter: "var(--serif)",
  book: "var(--book)",
  didot: '"Didot", "Hoefler Text", "Baskerville", serif',
  grotesk: "var(--grot)",
};
export const INK_SHADES: Record<InkKey, string> = {
  ink: "var(--ink)",
  graphite: "var(--ink-graphite)",
  soft: "var(--ink-soft)",
  mute: "var(--ink-mute)",
};

// prefsToVars maps preferences to the CSS custom properties the reader/card
// stylesheet consumes. Kept in one place so the live :root application and the
// preview scope stay identical. Values carry their units here (px/ch), and the
// hero controls become a display keyword + a filter, so the card needs no JS.
// #97: byline delimiter glyph keys -> the actual CSS `content` string (quoted, so
// it drops straight into `content: var(--pref-card-delim)`).
const DELIM_GLYPHS: Record<string, string> = {
  dot: '"·"',
  pipe: '"|"',
  slash: '"/"',
  space: '" "',
};

export function prefsToVars(p: Preferences): CSSProperties {
  const heroFilter = p.card.hero_color ? "none" : "grayscale(1) contrast(1.15)";
  return {
    "--pref-reader-font-size": `${p.reader.font_size}px`,
    "--pref-reader-line-height": `${p.reader.line_height}`,
    "--pref-reader-measure": p.reader.measure ? `${p.reader.measure}ch` : "none",
    "--pref-reader-img-display": p.reader.images ? "block" : "none",
    // #90: reader body face / weight / ink
    "--pref-reader-font-family": FONT_STACKS[p.reader.font_family] ?? "var(--serif)",
    "--pref-reader-font-weight": `${p.reader.font_weight}`,
    "--pref-reader-ink": INK_SHADES[p.reader.ink] ?? INK_SHADES.soft,
    "--pref-card-meta-size": `${p.card.meta_size}px`,
    "--pref-card-source-size": `${p.card.source_size}px`,
    "--pref-card-topictag-size": `${p.card.topic_tag_size}px`,
    "--pref-card-date-size": `${p.card.date_size}px`,
    "--pref-hero-display": p.card.hero_show ? "block" : "none",
    "--pref-hero-filter": heroFilter,
    "--pref-image-filter": heroFilter,
    // #97: per-element meta weight/ink. Each card meta part (topic pill, source,
    // author, date) styles independently. Weight + ink are always emitted with the
    // resolved value; the matching global.css rule carries the same default as its
    // CSS fallback (pure safety). The one exception is the topic pill's ink: its
    // default "topic" means "keep the topic's own color tint," so that var is omitted
    // at default and the CSS fallback (inherit -> topic color) stands. applyToRoot
    // clears it (CARD_COND_VARS) so returning to "topic" restores the tint.
    "--pref-card-topic-weight": `${p.card.topic_weight}`,
    "--pref-card-source-weight": `${p.card.source_weight}`,
    "--pref-card-source-ink": INK_SHADES[p.card.source_ink] ?? INK_SHADES.soft,
    "--pref-card-author-weight": `${p.card.author_weight}`,
    "--pref-card-author-ink": INK_SHADES[p.card.author_ink] ?? INK_SHADES.mute,
    "--pref-card-date-weight": `${p.card.date_weight}`,
    "--pref-card-date-ink": INK_SHADES[p.card.date_ink] ?? INK_SHADES.mute,
    // #97: byline delimiter glyph + spacing.
    "--pref-card-delim": DELIM_GLYPHS[p.card.delim] ?? DELIM_GLYPHS.dot,
    "--pref-card-delim-gap": `${p.card.delim_gap}px`,
    ...(p.card.topic_ink !== "topic" ? { "--pref-card-topic-ink": INK_SHADES[p.card.topic_ink as InkKey] } : {}),
  } as CSSProperties;
}

// Conditionally-emitted vars (see prefsToVars). Cleared before each apply so that
// returning a control to its default removes the override rather than leaving a
// stale value on :root. #97: only the topic pill ink is conditional (its "topic"
// default keeps the topic-color tint via the CSS fallback).
const CARD_COND_VARS = ["--pref-card-topic-ink"];

function applyToRoot(p: Preferences) {
  const style = document.documentElement.style;
  for (const k of CARD_COND_VARS) style.removeProperty(k);
  const vars = prefsToVars(p) as Record<string, string>;
  for (const [k, v] of Object.entries(vars)) style.setProperty(k, v);
}

export type Presentation = "standard" | "eink";
export type SaveStatus = "saved" | "pending" | "saving" | "error";
const PRESENTATION_KEY = "otium-presentation";

function storedPresentation(): Presentation {
  try {
    return localStorage.getItem(PRESENTATION_KEY) === "eink" ? "eink" : "standard";
  } catch {
    return "standard";
  }
}

interface PrefsState {
  prefs: Preferences;
  loaded: boolean;
  loadError: boolean;
  saveStatus: SaveStatus;
  update: (patch: PreferencesPatch) => void;
  retry: () => void;
  presentation: Presentation;
  setPresentation: (presentation: Presentation) => void;
  presentationError: boolean;
  reducedMotion: boolean;
  motionAllowed: boolean;
}

const Ctx = createContext<PrefsState>({
  prefs: DEFAULTS, loaded: false, loadError: false, saveStatus: "saved",
  update: () => {}, retry: () => {}, presentation: "standard", setPresentation: () => {},
  presentationError: false, reducedMotion: false, motionAllowed: true,
});

function merge(base: Preferences, patch: PreferencesPatch): Preferences {
  return {
    reader: { ...base.reader, ...patch.reader },
    card: { ...base.card, ...patch.card },
    presets: patch.presets ?? base.presets,
  };
}

// Later edits always win, including when an older request fails in flight.
function mergePatches(older: PreferencesPatch, newer: PreferencesPatch): PreferencesPatch {
  return {
    ...(older.reader || newer.reader ? { reader: { ...older.reader, ...newer.reader } } : {}),
    ...(older.card || newer.card ? { card: { ...older.card, ...newer.card } } : {}),
    ...(newer.presets || older.presets ? { presets: newer.presets ?? older.presets } : {}),
  };
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [presentation, setPresentationState] = useState<Presentation>(storedPresentation);
  const [presentationError, setPresentationError] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<PreferencesPatch>({});
  const edits = useRef<PreferencesPatch>({});
  const saving = useRef(false);
  const loading = useRef(false);
  const loadFailed = useRef(false);

  useEffect(() => applyToRoot(prefs), [prefs]);
  useEffect(() => {
    document.documentElement.dataset.presentation = presentation;
  }, [presentation]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReducedMotion(media.matches);
    media.addEventListener("change", changed);
    const storage = (e: StorageEvent) => {
      if (e.key === PRESENTATION_KEY || e.key === null) setPresentationState(storedPresentation());
    };
    window.addEventListener("storage", storage);
    return () => {
      media.removeEventListener("change", changed);
      window.removeEventListener("storage", storage);
    };
  }, []);

  const setPresentation = useCallback((value: Presentation) => {
    setPresentationState(value);
    try {
      localStorage.setItem(PRESENTATION_KEY, value);
      setPresentationError(false);
    } catch {
      setPresentationError(true);
    }
  }, []);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const stored = await api.getPreferences();
      // A slow initial GET or retry must not undo edits made while it ran.
      setPrefs(merge(stored, edits.current));
      loadFailed.current = false;
      setLoadError(false);
    } catch {
      loadFailed.current = true;
      setLoadError(true);
    } finally {
      loading.current = false;
      setLoaded(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const flush = useCallback(async () => {
    if (saving.current || Object.keys(pending.current).length === 0) return;
    const patch = pending.current;
    pending.current = {};
    saving.current = true;
    setSaveStatus("saving");
    try {
      await api.updatePreferences(patch);
      setSaveStatus(Object.keys(pending.current).length ? "pending" : "saved");
    } catch {
      pending.current = mergePatches(patch, pending.current);
      setSaveStatus("error");
      return;
    } finally {
      saving.current = false;
    }
    // Serialize writes so an old response cannot overwrite a newer preference.
    if (Object.keys(pending.current).length) void flush();
  }, []);

  const update = useCallback((patch: PreferencesPatch) => {
    edits.current = mergePatches(edits.current, patch);
    pending.current = mergePatches(pending.current, patch);
    setPrefs((cur) => merge(cur, patch));
    setSaveStatus("pending");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flush(), 400);
  }, [flush]);

  const retry = useCallback(() => {
    if (loadFailed.current) void load();
    void flush();
  }, [load, flush]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        window.clearTimeout(saveTimer.current);
        void flush();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("online", retry);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("online", retry);
      window.clearTimeout(saveTimer.current);
    };
  }, [flush, retry]);

  return <Ctx.Provider value={{ prefs, loaded, loadError, saveStatus, update, retry,
    presentation, setPresentation, presentationError, reducedMotion,
    motionAllowed: presentation === "standard" && !reducedMotion,
  }}>{children}</Ctx.Provider>;
}

export const usePreferences = () => useContext(Ctx);
