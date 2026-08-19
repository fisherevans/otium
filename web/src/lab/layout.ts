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
export type HierarchyPolicy = "pill" | "plain" | "stack" | "breadcrumb" | "overline" | "taxonomy" | "taxonomy-credit";
export type MenuPlacement = "top" | "hierarchy" | "actions";
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
  /** Where the ··· overflow sits: its own row, the hierarchy row, or the actions. */
  menu: MenuPlacement;
  actions: ActionsPolicy;
  chrome: ChromePolicy;
  reason: ReasonPolicy;
  /** Blurb line cap; 0 hides the blurb entirely. */
  blurbLines: number;
  /** Card side padding, px. Lower = wider content. */
  gutter: number;
  /** Portrait player width as a share of the content column, 0..1. */
  mediaWidth: number;
  /** Media action row: as shipped, or every control a bare icon. */
  notes: "labelled" | "icon";
  showByline: boolean;
  /** Where the light/dark control sits in the top bar. */
  themeToggle: "library" | "wordmark";
  /** Space above the hierarchy block, px. */
  topGap: number;
  /** Breathing room reserved below the action row so it never touches the
   *  session bar. The solver treats this as unavailable space. */
  bottomGap: number;
  /** One vertical rhythm for the whole header stack: taxonomy -> creator ->
   *  title -> media all get this same OPTICAL gap. Margins alone would not be
   *  equal to the eye, because each row's line-height contributes different
   *  half-leading above and below its text. */
  rhythm: number;
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
  menu: "top",
  actions: "current",
  chrome: "full",
  reason: "top",
  blurbLines: 2,
  gutter: 20,
  mediaWidth: 0.81,
  notes: "labelled",
  showByline: true,
  themeToggle: "library",
  topGap: 12,
  bottomGap: 12,
  rhythm: 12,
};

/** What the app ships today. The baseline every option is judged against. */
export const AS_SHIPPED: LayoutOptions = { ...DEFAULT_LAYOUT };

// ---------------------------------------------------------------------------
// The options, derived from the external layout feedback. Each is a coherent
// design position rather than a pick-and-mix, and each traces to the numbered
// points it answers so a rejection is a rejection of something specific.
//
// All of them share one non-negotiable: the item is exactly one screen and
// never scrolls internally. Swipe moves between items.
// ---------------------------------------------------------------------------

/** A - stop the failures, change nothing else. Points 4, 12, and the clipping. */
export const OPT_MINIMAL: LayoutOptions = {
  ...DEFAULT_LAYOUT,
  solve: true,
  title: "ramp",
  hero: "cap",
  heroCap: 0.42,
  video: "budget",
};

/** B - A, plus the pill flattened to plain type. Adds 7, 17. */
export const OPT_QUIET: LayoutOptions = {
  ...OPT_MINIMAL,
  hierarchy: "plain",
  reason: "hidden",
  blurbLines: 3,
};

/** C - the feedback's actual ask: Section > Topic > Source on one chevron line,
 *  with the ··· attached to it. Two rows of chrome become one. Points 5, 6, 8. */
export const OPT_BREADCRUMB: LayoutOptions = {
  ...OPT_MINIMAL,
  hierarchy: "breadcrumb",
  menu: "hierarchy",
  reason: "hidden",
  blurbLines: 3,
};

/** D - section as an overline, topic > source beneath it. The middle ground. */
export const OPT_STACK: LayoutOptions = {
  ...OPT_MINIMAL,
  hierarchy: "stack",
  menu: "hierarchy",
  reason: "hidden",
  blurbLines: 3,
};

/** E - the most reduction: a section overline and a rule, nothing else. The
 *  source moves to the byline. Closest to the e-ink brief. Point 18. */
export const OPT_OVERLINE: LayoutOptions = {
  ...OPT_MINIMAL,
  hierarchy: "overline",
  menu: "hierarchy",
  reason: "hidden",
  chrome: "slim",
  density: "tight",
  blurbLines: 3,
};

/** F - breadcrumb with the chrome trimmed and the headline given room. Adds 9, 21. */
export const OPT_EDITORIAL: LayoutOptions = {
  ...OPT_BREADCRUMB,
  chrome: "slim",
  density: "roomy",
  heroCap: 0.34,
};

/** D - B, tuned so inline video is as large as it can be. */
export const OPT_VIDEO_FIRST: LayoutOptions = {
  ...OPT_BREADCRUMB,
  chrome: "slim",
  density: "tight",
  actions: "icons",
  videoTarget: 0.78,
};

/** H - overline, top-aligned and dense. Adds 18. */
export const OPT_EINK: LayoutOptions = {
  ...OPT_OVERLINE,
  chrome: "slim",
  density: "tight",
  align: "top",
  actions: "labels",
  heroCap: 0.3,
};

/**
 * P - Fisher's prototype. The lab boots into this, and `reset` restores it.
 *
 * "Section > Topic", then the TITLE, then the creator and the relative date on one
 * caption line beneath it. Content is pushed up and widened, the byline and reason
 * line are gone, the ··· sits in the action row under the post, and every media
 * control is a bare icon - including "Show notes", which loses its outline.
 */
export const OPT_PROTOTYPE: LayoutOptions = {
  ...DEFAULT_LAYOUT,
  solve: true,
  title: "ramp",
  hero: "cap",
  heroCap: 0.46,
  video: "budget",
  mediaWidth: 0.95,
  hierarchy: "taxonomy-credit",
  menu: "actions",
  reason: "hidden",
  showByline: false,
  notes: "icon",
  align: "center",
  density: "tight",
  gutter: 20,
  blurbLines: 3,
  themeToggle: "wordmark",
  topGap: 18,
  bottomGap: 16,
  rhythm: 13,
};

/** R - the earlier read: the creator gets its own line under the breadcrumb and
 *  the title comes third. No date. Kept so the two are easy to hold side by side. */
export const OPT_CREATOR_LINE: LayoutOptions = {
  ...OPT_PROTOTYPE,
  hierarchy: "taxonomy",
};

export const PRESETS: { key: string; label: string; opts: LayoutOptions }[] = [
  { key: "p-prototype", label: "P · Prototype (credit under title)", opts: OPT_PROTOTYPE },
  { key: "r-creator-line", label: "R · Creator on its own line", opts: OPT_CREATOR_LINE },
  { key: "shipped", label: "Now (shipped)", opts: AS_SHIPPED },
  { key: "a-minimal", label: "A · Minimal fix (pill kept)", opts: OPT_MINIMAL },
  { key: "b-quiet", label: "B · Flat pill", opts: OPT_QUIET },
  { key: "c-breadcrumb", label: "C · Breadcrumb", opts: OPT_BREADCRUMB },
  { key: "d-stack", label: "D · Section overline + crumb", opts: OPT_STACK },
  { key: "e-overline", label: "E · Overline only", opts: OPT_OVERLINE },
  { key: "f-editorial", label: "F · Breadcrumb, editorial", opts: OPT_EDITORIAL },
  { key: "g-video", label: "G · Breadcrumb, video first", opts: OPT_VIDEO_FIRST },
  { key: "h-eink", label: "H · Overline, e-ink", opts: OPT_EINK },
];

/** data-* attributes the variant CSS keys off. */
export function layoutAttrs(o: LayoutOptions): Record<string, string> {
  return {
    "data-title": o.title,
    "data-hero": o.hero,
    "data-video": o.video,
    "data-density": o.density,
    "data-align": o.align,
    "data-solve": o.solve ? "on" : "off",
    "data-hierarchy": o.hierarchy,
    "data-menu": o.menu,
    "data-actions": o.actions,
    "data-chrome": o.chrome,
    "data-reason": o.reason,
    "data-blurb": o.blurbLines === 0 ? "off" : String(o.blurbLines),
    "data-notes": o.notes,
    "data-byline": o.showByline ? "on" : "off",
    "data-theme-slot": o.themeToggle,
  };
}

/** CSS variables the variant CSS reads for the continuous knobs. */
export function layoutVars(o: LayoutOptions): CSSProperties {
  return {
    "--card-hero-cap": `${Math.round(o.heroCap * 100)}%`,
    "--lab-video-target": `${Math.round(o.videoTarget * 100)}%`,
    "--lab-title-min": `${o.titleMin}px`,
    "--card-gutter": `${o.gutter}px`,
    "--card-media-w": `${Math.round(o.mediaWidth * 100)}%`,
    "--card-top-gap": `${o.topGap}px`,
    "--card-rhythm": `${o.rhythm}px`,
    "--lab-blurb-lines": `${o.blurbLines || 1}`,
  } as CSSProperties;
}

// One ramp, defined by the engine both surfaces run.
export { TITLE_RAMP } from "@/lib/cardLayout";

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
  /** Distance from the bottom of the action row to the bottom of the card, px.
   *  Negative means the controls are past the edge. */
  bottomClearance: number;
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
  const actions = card.querySelector<HTMLElement>(".im-actions, .card-callout");
  const bottomClearance = actions
    ? Math.round(cr.bottom - actions.getBoundingClientRect().bottom)
    : 0;
  return {
    bottomClearance,
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
