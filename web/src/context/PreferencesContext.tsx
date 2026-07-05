import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api, type Preferences, type PreferencesPatch } from "@/api/client";

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
  reader: { font_size: 17, line_height: 1.62, measure: 66, images: true },
  card: {
    meta_size: 11,
    source_size: 11,
    feed_tag_size: 13,
    date_size: 13,
    hero_show: true,
    hero_color: false,
  },
  presets: [5, 15, 30, 60],
};

// prefsToVars maps preferences to the CSS custom properties the reader/card
// stylesheet consumes. Kept in one place so the live :root application and the
// preview scope stay identical. Values carry their units here (px/ch), and the
// hero controls become a display keyword + a filter, so the card needs no JS.
export function prefsToVars(p: Preferences): CSSProperties {
  const heroFilter = p.card.hero_color ? "none" : "grayscale(1) contrast(1.15)";
  return {
    "--pref-reader-font-size": `${p.reader.font_size}px`,
    "--pref-reader-line-height": `${p.reader.line_height}`,
    "--pref-reader-measure": `${p.reader.measure}ch`,
    "--pref-reader-img-display": p.reader.images ? "block" : "none",
    "--pref-card-meta-size": `${p.card.meta_size}px`,
    "--pref-card-source-size": `${p.card.source_size}px`,
    "--pref-card-feedtag-size": `${p.card.feed_tag_size}px`,
    "--pref-card-date-size": `${p.card.date_size}px`,
    "--pref-hero-display": p.card.hero_show ? "block" : "none",
    "--pref-hero-filter": heroFilter,
  } as CSSProperties;
}

function applyToRoot(p: Preferences) {
  const style = document.documentElement.style;
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
export const DEFAULT_PREFERENCES = DEFAULTS;
