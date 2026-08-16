import type { CSSProperties } from "react";

// The layout axis for the lab (/lab).
//
// otium already parameterizes *styling* - CardPrefs emits ~18 `--pref-card-*`
// vars (sizes, weights, inks, delimiter, hero colour). What it has never had is a
// parameterized *layout*: how the fixed height of a card gets divided up. These
// options are that missing axis.
//
// Every option is expressed as a data-attribute or a CSS variable on the frame
// wrapper, so a variant is pure CSS over the real SessionCard markup. Nothing here
// forks the component - if it cannot be done by overriding the real card's rules,
// it does not belong in this file, it belongs in the component.

export type TitlePolicy = "clamp3" | "clamp2" | "full" | "ramp";
export type HeroPolicy = "fixed" | "aspect" | "cap";
export type VideoPolicy = "fixed72" | "budget" | "bleed";
export type DensityPolicy = "roomy" | "normal" | "tight";
export type AlignPolicy = "center" | "top";
export type HierarchyPolicy = "pill" | "plain";
export type ActionsPolicy = "current" | "icons" | "labels";
export type ChromePolicy = "full" | "slim" | "none";
export type ReasonPolicy = "top" | "hidden";

export interface LayoutOptions {
  /** Run the budget solver after paint (sizes media from leftover space). */
  solve: boolean;
  title: TitlePolicy;
  /** Floor for the type ramp, px. */
  titleMin: number;
  hero: HeroPolicy;
  /** Share of the card a capped hero may claim, 0..1. */
  heroCap: number;
  video: VideoPolicy;
  /** Target share of the card for a portrait player, 0..1. */
  videoTarget: number;
  density: DensityPolicy;
  align: AlignPolicy;
  hierarchy: HierarchyPolicy;
  actions: ActionsPolicy;
  chrome: ChromePolicy;
  reason: ReasonPolicy;
  /** Blurb line cap; 0 hides the blurb entirely. */
  blurbLines: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  solve: false,
  title: "clamp3",
  titleMin: 16,
  hero: "fixed",
  heroCap: 0.42,
  video: "fixed72",
  videoTarget: 0.6,
  density: "normal",
  align: "center",
  hierarchy: "pill",
  actions: "current",
  chrome: "full",
  reason: "top",
  blurbLines: 2,
};

/** What the app ships today. The baseline every variant is judged against. */
export const AS_SHIPPED: LayoutOptions = { ...DEFAULT_LAYOUT };

/** A starting point for the fit direction: nothing truncated, media from budget. */
export const FIT_PRESET: LayoutOptions = {
  ...DEFAULT_LAYOUT,
  solve: true,
  title: "ramp",
  hero: "cap",
  video: "budget",
  density: "normal",
  hierarchy: "plain",
  chrome: "slim",
  blurbLines: 3,
};

export const PRESETS: { key: string; label: string; opts: LayoutOptions }[] = [
  { key: "shipped", label: "As shipped", opts: AS_SHIPPED },
  { key: "fit", label: "Fit (budget)", opts: FIT_PRESET },
  { key: "unclamped", label: "Just unclamp", opts: { ...AS_SHIPPED, title: "full", hero: "aspect" } },
  { key: "video-max", label: "Video first", opts: { ...FIT_PRESET, videoTarget: 0.72, chrome: "none" } },
];

/** data-* attributes the variant CSS keys off. */
export function layoutAttrs(o: LayoutOptions): Record<string, string> {
  return {
    "data-title": o.title,
    "data-hero": o.hero,
    "data-video": o.video,
    "data-density": o.density,
    "data-align": o.align,
    "data-hierarchy": o.hierarchy,
    "data-actions": o.actions,
    "data-chrome": o.chrome,
    "data-reason": o.reason,
    "data-blurb": o.blurbLines === 0 ? "off" : String(o.blurbLines),
  };
}

/** CSS variables the variant CSS reads for the continuous knobs. */
export function layoutVars(o: LayoutOptions): CSSProperties {
  return {
    "--lab-hero-cap": `${Math.round(o.heroCap * 100)}%`,
    "--lab-video-target": `${Math.round(o.videoTarget * 100)}%`,
    "--lab-title-min": `${o.titleMin}px`,
    "--lab-blurb-lines": `${o.blurbLines || 1}`,
  } as CSSProperties;
}

export const TITLE_RAMP = [23, 21, 19, 17, 16, 15, 14];

export interface FitResult {
  fits: boolean;
  /** Card content height vs the space available, px. */
  contentH: number;
  budget: number;
  titlePx: number;
  mediaW: number;
  mediaH: number;
  mediaPct: number;
  /** Reductions the solver had to apply, in the order they fired. */
  gaveUp: string[];
  /** Elements whose box falls outside the card's clipping bounds. */
  clipped: string[];
  titleTruncated: boolean;
}

// Measure a rendered card without changing it. Used for the baseline (solve:false)
// so "as shipped" reports the same numbers the real app produces.
export function measureCard(card: HTMLElement): Omit<FitResult, "gaveUp" | "titlePx" | "fits"> & { titlePx: number; fits: boolean } {
  const cr = card.getBoundingClientRect();
  const title = card.querySelector<HTMLElement>(".card-title");
  let titlePx = 0;
  let titleTruncated = false;
  if (title) {
    const cs = getComputedStyle(title);
    titlePx = parseFloat(cs.fontSize);
    const lh = parseFloat(cs.lineHeight) || titlePx * 1.24;
    const shown = Math.round(title.offsetHeight / lh);
    const clone = title.cloneNode(true) as HTMLElement;
    clone.style.cssText = `position:absolute;visibility:hidden;display:block;-webkit-line-clamp:unset;width:${title.offsetWidth}px;font:${cs.font};line-height:${cs.lineHeight}`;
    title.parentElement?.appendChild(clone);
    titleTruncated = Math.round(clone.offsetHeight / lh) > shown;
    clone.remove();
  }
  const frame = card.querySelector<HTMLElement>(".im-frame") ?? card.querySelector<HTMLElement>(".media");
  const mediaW = frame ? Math.round(frame.offsetWidth) : 0;
  const mediaH = frame ? Math.round(frame.offsetHeight) : 0;
  const clipped = Array.from(card.querySelectorAll<HTMLElement>("*"))
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 2 && r.width > 2 && (r.bottom > cr.bottom + 1 || r.top < cr.top - 1);
    })
    .map((el) => (typeof el.className === "string" ? el.className.split(" ")[0] : el.tagName))
    .filter((c, i, a) => c && a.indexOf(c) === i);
  // offsetHeight, not the bounding rect: the lab renders the device at true CSS
  // pixels and then transform-scales it, so rect heights are scaled while
  // offsetHeight/offsetWidth are not. Mixing them reported media at 119% of a
  // card it actually filled 81% of.
  const budget = card.offsetHeight;
  const contentH = card.scrollHeight;
  return {
    fits: clipped.length === 0 && !titleTruncated,
    contentH,
    budget,
    titlePx,
    mediaW,
    mediaH,
    mediaPct: budget ? Math.round((mediaH / budget) * 100) : 0,
    clipped,
    titleTruncated,
  };
}
