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
    font_family: "charter",
    font_weight: 400,
    ink: "soft",
  },
  card: {
    meta_size: 11,
    source_size: 11,
    interest_tag_size: 13,
    date_size: 13,
    hero_show: true,
    hero_color: false,
    // #97 per-element meta defaults mirror the v0.29 card's designed look.
    interest_weight: 600,
    interest_ink: "interest",
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
// exactly what the app renders. A font value is a `var(...)` reference resolved
// lazily at the consuming element (works because custom-property values can hold
// var() and are substituted at use site).
export const FONT_STACKS: Record<FontKey, string> = {
  charter: "var(--serif)",
  book: "var(--book)",
  didot: "var(--didot)",
  grotesk: "var(--grot)",
};
export const INK_SHADES: Record<InkKey, string> = {
  ink: "#1a1815",
  graphite: "#3a352d",
  soft: "#4b4740",
  mute: "#8b857a",
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
    "--pref-reader-measure": `${p.reader.measure}ch`,
    "--pref-reader-img-display": p.reader.images ? "block" : "none",
    // #90: reader body face / weight / ink
    "--pref-reader-font-family": FONT_STACKS[p.reader.font_family] ?? "var(--serif)",
    "--pref-reader-font-weight": `${p.reader.font_weight}`,
    "--pref-reader-ink": INK_SHADES[p.reader.ink] ?? INK_SHADES.soft,
    "--pref-card-meta-size": `${p.card.meta_size}px`,
    "--pref-card-source-size": `${p.card.source_size}px`,
    "--pref-card-interesttag-size": `${p.card.interest_tag_size}px`,
    "--pref-card-date-size": `${p.card.date_size}px`,
    "--pref-hero-display": p.card.hero_show ? "block" : "none",
    "--pref-hero-filter": heroFilter,
    // #97: per-element meta weight/ink. Each card meta part (interest pill, source,
    // author, date) styles independently. Weight + ink are always emitted with the
    // resolved value; the matching global.css rule carries the same default as its
    // CSS fallback (pure safety). The one exception is the interest pill's ink: its
    // default "interest" means "keep the interest's own color tint," so that var is omitted
    // at default and the CSS fallback (inherit -> interest color) stands. applyToRoot
    // clears it (CARD_COND_VARS) so returning to "interest" restores the tint.
    "--pref-card-interest-weight": `${p.card.interest_weight}`,
    "--pref-card-source-weight": `${p.card.source_weight}`,
    "--pref-card-source-ink": INK_SHADES[p.card.source_ink] ?? INK_SHADES.soft,
    "--pref-card-author-weight": `${p.card.author_weight}`,
    "--pref-card-author-ink": INK_SHADES[p.card.author_ink] ?? INK_SHADES.mute,
    "--pref-card-date-weight": `${p.card.date_weight}`,
    "--pref-card-date-ink": INK_SHADES[p.card.date_ink] ?? INK_SHADES.mute,
    // #97: byline delimiter glyph + spacing.
    "--pref-card-delim": DELIM_GLYPHS[p.card.delim] ?? DELIM_GLYPHS.dot,
    "--pref-card-delim-gap": `${p.card.delim_gap}px`,
    ...(p.card.interest_ink !== "interest" ? { "--pref-card-interest-ink": INK_SHADES[p.card.interest_ink as InkKey] } : {}),
  } as CSSProperties;
}

// Conditionally-emitted vars (see prefsToVars). Cleared before each apply so that
// returning a control to its default removes the override rather than leaving a
// stale value on :root. #97: only the interest pill ink is conditional (its "interest"
// default keeps the interest-color tint via the CSS fallback).
const CARD_COND_VARS = ["--pref-card-interest-ink"];

function applyToRoot(p: Preferences) {
  const style = document.documentElement.style;
  for (const k of CARD_COND_VARS) style.removeProperty(k);
  const vars = prefsToVars(p) as Record<string, string>;
  for (const [k, v] of Object.entries(vars)) style.setProperty(k, v);
}

interface PrefsState {
  prefs: Preferences;
  loaded: boolean;
  // update merges a patch, applies it live (:root), and debounce-persists it.
  update: (patch: PreferencesPatch) => void;
}

const Ctx = createContext<PrefsState>({ prefs: DEFAULTS, loaded: false, update: () => {} });

// Merge a deep-partial patch onto the current prefs (one level of nesting).
function merge(base: Preferences, patch: PreferencesPatch): Preferences {
  return {
    reader: { ...base.reader, ...(patch.reader ?? {}) },
    card: { ...base.card, ...(patch.card ?? {}) },
    presets: patch.presets ?? base.presets,
  };
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<PreferencesPatch>({});

  // Apply defaults synchronously on mount so the very first paint is correct,
  // then reconcile with the server. A failed fetch (offline / unauth redirect)
  // just leaves the defaults in place.
  useEffect(() => {
    applyToRoot(DEFAULTS);
    api
      .getPreferences()
      .then((p) => {
        setPrefs(p);
        applyToRoot(p);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const flush = useCallback(() => {
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return;
    api.updatePreferences(patch).catch(() => {});
  }, []);

  const update = useCallback(
    (patch: PreferencesPatch) => {
      setPrefs((cur) => {
        const next = merge(cur, patch);
        applyToRoot(next); // live, immediate - preview + app both reflow
        return next;
      });
      // Accumulate the patch so a burst of slider changes coalesces into one PUT.
      pending.current = {
        reader: { ...(pending.current.reader ?? {}), ...(patch.reader ?? {}) },
        card: { ...(pending.current.card ?? {}), ...(patch.card ?? {}) },
        ...(patch.presets ? { presets: patch.presets } : {}),
      };
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flush, 400);
    },
    [flush],
  );

  // Persist any pending edit if the tab is hidden/closed mid-debounce.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        window.clearTimeout(saveTimer.current);
        flush();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [flush]);

  return <Ctx.Provider value={{ prefs, loaded, update }}>{children}</Ctx.Provider>;
}

export const usePreferences = () => useContext(Ctx);
