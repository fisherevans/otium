import type { CSSProperties } from "react";

// The card's layout engine.
//
// A session card is a FIXED box - one item per screen, no inner scroll - so the
// only question is how that fixed height gets divided. CSS alone cannot answer
// it: the answer depends on what the item actually is (a 9:16 player wants every
// pixel; a three-line news item wants none of them), and on measurements only the
// browser has. So this measures, allocates, then measures again to check.
//
// It lives here, not in the lab, because the lab and the session MUST run the
// same engine - the same rule as SessionCard. A preview that solves differently
// from the real card is a preview that lies.
//
// Three passes, in order:
//   applyRhythm  even OPTICAL gaps down the header stack (half-leading aware)
//   solveCard    fit the content to the box, giving in a fixed order
//   a centring pad, folded into solveCard's tail
//
// Everything lands as CSS custom properties on a "vars" element, so the styling
// stays in the stylesheet and this only decides numbers.

/** The type ramp the solver steps down, largest first. */
export const TITLE_RAMP = [23, 21, 19, 17, 16, 15, 14];

/** What the solver needs to know. The lab's LayoutOptions is a superset. */
export interface CardLayoutOpts {
  solve: boolean;
  title: string;
  titleMin: number;
  hero: string;
  heroCap: number;
  video: string;
  mediaWidth: number;
  align: string;
  /** Space to leave under the action row, px. */
  bottomGap: number;
  /** Target optical gap between header rows, px. */
  rhythm: number;
}

/** What ships: the values behind the card you see in the session. */
export const SHIPPED_LAYOUT: CardLayoutOpts = {
  solve: true,
  title: "ramp",
  titleMin: 16,
  hero: "cap",
  heroCap: 0.46,
  video: "budget",
  mediaWidth: 0.95,
  align: "center",
  bottomGap: 16,
  rhythm: 13,
};

/** The static half of the same settings, as CSS custom properties. */
export function cardVars(o: { gutter: number; topGap: number; rhythm: number; mediaWidth: number }): CSSProperties {
  return {
    "--card-gutter": `${o.gutter}px`,
    "--card-top-gap": `${o.topGap}px`,
    "--card-rhythm": `${o.rhythm}px`,
    "--card-media-w": `${Math.round(o.mediaWidth * 100)}%`,
  } as CSSProperties;
}

/** The static values the session ships with, to pair with SHIPPED_LAYOUT. */
export const SHIPPED_VARS = { gutter: 20, topGap: 18, rhythm: 13, mediaWidth: 0.95 };

/**
 * The budget solver, applied to a rendered card.
 *
 * The card is exactly one screen (`height:100%; overflow:hidden`), which means
 * `scrollHeight` CLAMPS - it can never report the overflow we are trying to
 * measure. So every measurement here temporarily lets the card size to its
 * content, reads it, and puts it back. Getting this wrong silently collapses the
 * media to nothing, which is exactly what it did the first time.
 */
// NB: `.snap` has min-height:100%, so this floors at the card's full height. It
// detects OVERFLOW (the only thing it is used for); it cannot measure slack.
export function contentHeight(card: HTMLElement): number {
  const h = card.style.height;
  const o = card.style.overflow;
  card.style.height = "auto";
  card.style.overflow = "visible";
  const measured = card.offsetHeight;
  card.style.height = h;
  card.style.overflow = o;
  return measured;
}

/**
 * Even vertical rhythm across the header stack.
 *
 * Equal margins do NOT read as equal space. Each text row carries half its
 * leading above and below the glyphs, and those half-leadings differ per row
 * (10px mono caps vs 15px serif vs 23px serif). So the same margin between a
 * mono row and a serif row looks smaller than between two mono rows.
 *
 * This sets each margin to `rhythm - halfLeading(above) - halfLeading(below)`,
 * which makes the gap the EYE sees equal, which is what was actually asked for.
 */
export function applyRhythm(card: HTMLElement, rhythm: number) {
  const halfLead = (el: HTMLElement | null) => {
    if (!el) return 0;
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize) || 0;
    const lh = parseFloat(cs.lineHeight) || fs * 1.2;
    return Math.max(0, (lh - fs) / 2);
  };
  const q = (sel: string) => card.querySelector<HTMLElement>(sel);
  const hier = q(".card-hier");
  const rows = q(".card-hier .ch-rows");
  const tax = q(".card-hier .ch-tax");
  const creator = rows && rows.children.length > 1 ? (rows.children[rows.children.length - 1] as HTMLElement) : null;
  const title = q(".card-title");
  const credit = q(".card-credit");
  const media = q(".card-media, .media, .wave");

  // `setter` owns the margin after `text`. For the last row inside the hierarchy
  // block that is the block itself - and the block can be TALLER than its text,
  // because the ··· button is centred against it. That slack is why predicting
  // the margin arithmetically did not work.
  const stack: { setter: HTMLElement | null; text: HTMLElement | null }[] = [];
  if (tax) stack.push({ setter: creator ? tax : hier, text: tax });
  if (creator) stack.push({ setter: hier, text: creator });
  if (title) stack.push({ setter: title, text: title });
  if (credit) stack.push({ setter: credit, text: credit });
  if (media) stack.push({ setter: null, text: null });
  if (stack.length < 2) return;

  if (rows) rows.style.rowGap = "0px";
  if (title) title.style.marginTop = "0px";

  // Seed with the arithmetic guess, then close the loop on the measured result.
  const margins = stack.slice(0, -1).map((row, i) =>
    Math.max(2, Math.round(rhythm - halfLead(row.text) - halfLead(stack[i + 1].text))),
  );
  const write = () =>
    margins.forEach((m, i) => {
      const el = stack[i].setter;
      if (el) el.style.marginBottom = `${m}px`;
    });
  write();

  for (let pass = 0; pass < 4; pass++) {
    const k = card.offsetHeight ? card.getBoundingClientRect().height / card.offsetHeight : 1;
    if (!k) break;
    let worst = 0;
    for (let i = 0; i < margins.length; i++) {
      const a = stack[i].text;
      const bEl = stack[i + 1].text ?? media;
      if (!a || !bEl) continue;
      const gapPx = (bEl.getBoundingClientRect().top - a.getBoundingClientRect().bottom) / k;
      const optical = gapPx + halfLead(a) + halfLead(stack[i + 1].text);
      const delta = rhythm - optical;
      if (Math.abs(delta) > 0.6) {
        margins[i] = Math.max(0, Math.round(margins[i] + delta));
        worst = Math.max(worst, Math.abs(delta));
      }
    }
    if (worst === 0) break;
    write();
  }
}

export function solveCard(vars: HTMLElement, reel: HTMLElement, card: HTMLElement, opts: CardLayoutOpts): string[] {
  const title = card.querySelector<HTMLElement>(".card-title");
  const frame = card.querySelector<HTMLElement>(".im-frame");
  const budget = reel.clientHeight;

  // clear anything a previous pass wrote
  vars.style.removeProperty("--card-title-size");
  vars.style.removeProperty("--card-frame-h");
  vars.style.removeProperty("--card-center-pad");
  vars.removeAttribute("data-solved-blurb");
  if (frame) frame.style.removeProperty("height");
  if (!opts.solve) return [];

  const gaveUp: string[] = [];
  let cap = opts.heroCap;
  let ti = 0;

  // The content column: the card's box minus its own padding. NOT the frame's
  // parent - that element is already clamped by the media-width cap, so deriving
  // the cap from it is circular and the media can never grow past where it is.
  const columnWidth = () => {
    const cs = getComputedStyle(card);
    return Math.max(0, card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  };

  // Media takes the residual: measure the card with the frame collapsed, then
  // hand the frame whatever is left (bounded by its own aspect ratio).
  const sizeMedia = () => {
    if (!frame) return;
    // Chrome by subtraction, not by collapsing the frame: the player sits inside
    // two nested flex containers, and zeroing its height does not reliably shrink
    // them, which silently reported "no room" and collapsed the media to 2px.
    const chrome = contentHeight(card) - frame.offsetHeight;
    const ar = parseFloat(getComputedStyle(frame).getPropertyValue("--ar")) || 0.5625;
    // The portrait player may be narrower than the column; convert that width cap
    // into a height cap so the frame stays on its true aspect ratio.
    const colW = columnWidth();
    const capW = ar < 1 ? colW * opts.mediaWidth : colW;
    const widthBound = capW / ar;
    // Do NOT reserve the bottom gap here: the card's own padding and the action
    // row's margin already provide separation, and the clearance pass below is
    // what actually targets it. Subtracting it here too double-counts and leaves
    // the media short. Two pixels is just rounding headroom.
    const room = Math.max(0, budget - chrome - 2);
    const target = opts.video === "bleed" ? colW / ar : Math.min(room, widthBound);
    vars.style.setProperty("--card-frame-h", `${Math.round(target)}px`);
    frame.style.height = `${Math.round(target)}px`;
  };

  const apply = () => {
    applyRhythm(card, opts.rhythm);
    // In PIXELS, deliberately. As a percentage this resolves against the card's
    // height - and contentHeight() makes that height auto while measuring, which
    // turns the percentage indefinite, drops the cap, and inflates every reading.
    vars.style.setProperty("--card-hero-cap", `${Math.round(cap * budget)}px`);
    if (opts.title === "ramp" && title) {
      vars.style.setProperty("--card-title-size", `${TITLE_RAMP[ti]}px`);
    }
    sizeMedia();
  };

  // Give-order. Video cards have almost nothing to yield because the frame
  // already absorbs the slack; article cards yield the excerpt, then the hero's
  // share, then type.
  const knobs: [string, () => boolean][] = frame
    ? [
        ["title 21px", () => step(1)],
        ["title 19px", () => step(2)],
        ["title 17px", () => step(3)],
        ["title 16px", () => step(4)],
      ]
    : [
        ["excerpt dropped", () => dropBlurb()],
        ["hero cap 34%", () => setCap(0.34)],
        ["title 21px", () => step(1)],
        ["hero cap 26%", () => setCap(0.26)],
        ["title 19px", () => step(2)],
        ["title 17px", () => step(3)],
        ["hero cap 18%", () => setCap(0.18)],
        ["title 16px", () => step(4)],
      ];
  function step(n: number) {
    if (opts.title !== "ramp") return false;
    if (ti >= n || TITLE_RAMP[n] < opts.titleMin) return false;
    ti = n;
    return true;
  }
  function setCap(v: number) {
    if (opts.hero !== "cap" || cap <= v) return false;
    cap = v;
    return true;
  }
  function dropBlurb() {
    if (vars.getAttribute("data-solved-blurb") === "off") return false;
    vars.setAttribute("data-solved-blurb", "off");
    return true;
  }

  for (let i = 0; i < 16; i++) {
    apply();
    let over = contentHeight(card) - budget;
    // On a media card the frame absorbs the overflow FIRST. Stepping the title
    // down before trying that is why a card with plenty of room still ended up
    // at 17px: a few pixels of border and margin looked like a type problem.
    if (over > 0 && frame) {
      const floor = budget * 0.4;
      const h = frame.offsetHeight - over;
      if (h >= floor) {
        frame.style.height = `${Math.round(h)}px`;
        vars.style.setProperty("--card-frame-h", `${Math.round(h)}px`);
        over = contentHeight(card) - budget;
      }
    }
    if (over <= 1) break;
    const next = knobs.find(([, fn]) => fn());
    if (!next) break;
    gaveUp.push(next[0]);
  }

  // Drive the media to the requested clearance. Everything above works in
  // predicted pixels; this closes the loop on the measured result, so "grow the
  // media until the buttons are pushed down but not touching" is literally what
  // happens rather than something inferred from margins.
  if (frame) {
    const ar2 = parseFloat(getComputedStyle(frame).getPropertyValue("--ar")) || 0.5625;
    const colW2 = columnWidth();
    const maxH = (ar2 < 1 ? colW2 * opts.mediaWidth : colW2) / ar2;
    for (let i = 0; i < 6; i++) {
      const actions = card.querySelector<HTMLElement>(".im-actions, .card-callout");
      if (!actions) break;
      // rects are transform-scaled; offsetHeight is not, so derive the factor
      const k = frame.offsetHeight ? frame.getBoundingClientRect().height / frame.offsetHeight : 1;
      if (!k) break;
      const clear = (card.getBoundingClientRect().bottom - actions.getBoundingClientRect().bottom) / k;
      const delta = clear - opts.bottomGap;
      if (Math.abs(delta) < 2) break;
      const next = Math.min(maxH, Math.max(budget * 0.3, frame.offsetHeight + delta));
      if (Math.abs(next - frame.offsetHeight) < 1) break;
      frame.style.height = `${Math.round(next)}px`;
      vars.style.setProperty("--card-frame-h", `${Math.round(next)}px`);
    }
  }

  // Centre the stack in whatever is left over.
  //
  // Not `justify-content: center`: on an overflow:hidden column that splits any
  // OVERFLOW across both ends too, so a full card loses its top to a clip you
  // cannot scroll back to. That is why this was top-aligned in the first place.
  // Measuring instead means the pad is only ever made of real slack, so it
  // degrades to top-aligned exactly when the card fills up - centred when it can
  // be, never at the cost of the first line.
  //
  // The bottom gap is held back before splitting, so a media card that already
  // drove its clearance to `bottomGap` gets a pad of 0 and is left alone.
  if (opts.align === "center") {
    const actions = card.querySelector<HTMLElement>(".im-actions, .card-callout");
    // NOT budget - contentHeight(card): `.snap` carries min-height:100%, so a card
    // that fits measures exactly the budget however little it holds, and the slack
    // reads as zero every time. Measure to the last thing on the card instead.
    const k = card.offsetHeight ? card.getBoundingClientRect().height / card.offsetHeight : 1;
    const last = actions ?? card.lastElementChild;
    if (last && k) {
      const slack = (card.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom) / k;
      const pad = Math.floor(Math.max(0, slack - opts.bottomGap) / 2);
      if (pad > 0) vars.style.setProperty("--card-center-pad", `${pad}px`);
    }
  }

  // Last resort: take any remaining spill out of the media rather than let the
  // card clip an action.
  if (frame) {
    const spill = contentHeight(card) - budget;
    if (spill > 0) {
      const h = Math.max(0, frame.offsetHeight - spill);
      frame.style.height = `${h}px`;
      vars.style.setProperty("--card-frame-h", `${h}px`);
    }
  }
  return gaveUp;
}

/**
 * Solve once the card can actually be measured, and return a cancel function.
 *
 * Images must be decoded first or none of the measuring means anything: an <img>
 * with no intrinsic size yet measures as its borders, so the solver allocates the
 * card's height against a 2px picture and the media ends up collapsed. So wait
 * for every pending image, then solve on the next frame.
 */
export function solveWhenReady(
  vars: HTMLElement,
  reel: HTMLElement,
  card: HTMLElement,
  opts: CardLayoutOpts,
  onDone?: (gaveUp: string[]) => void,
): () => void {
  let cancelled = false;
  let raf = 0;
  const run = () => {
    if (cancelled) return;
    const gaveUp = solveCard(vars, reel, card, opts);
    if (onDone) raf = requestAnimationFrame(() => !cancelled && onDone(gaveUp));
  };
  const pending = Array.from(card.querySelectorAll("img")).filter((i) => !i.complete || i.naturalHeight === 0);
  const cleanups: (() => void)[] = [];
  if (pending.length === 0) {
    raf = requestAnimationFrame(run);
  } else {
    let left = pending.length;
    const done = () => {
      if (--left <= 0 && !cancelled) raf = requestAnimationFrame(run);
    };
    pending.forEach((img) => {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
      cleanups.push(() => {
        img.removeEventListener("load", done);
        img.removeEventListener("error", done);
      });
    });
  }
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
    cleanups.forEach((c) => c());
  };
}
