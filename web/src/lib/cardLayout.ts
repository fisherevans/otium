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
    // #207: a post's card is a box, not a line of text: no half-leading.
    if (!el || el.classList.contains("bsky-post")) return 0;
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
  // #207: a post's rows sit inside its own card, so the card is the row.
  const title = q(".card-title, .bsky-post, .card-post");
  const credit = q(".card-credit");
  const media = q(".card-media, .media, .wave");

  // `setter` owns the margin after `text`. For the last row inside the hierarchy
  // block that is the block itself - and the block can be TALLER than its text,
  // because the ··· button is centred against it. That slack is why predicting
  // the margin arithmetically did not work.
  //
  // Rows go in DOM order: an article reads title then credit, a post (#205)
  // reads credit then its text.
  const stack: { setter: HTMLElement | null; text: HTMLElement | null }[] = [];
  if (tax) stack.push({ setter: creator ? tax : hier, text: tax });
  if (creator) stack.push({ setter: hier, text: creator });
  const body = [title, credit].filter((el): el is HTMLElement => !!el);
  body.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  for (const el of body) stack.push({ setter: el, text: el });
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
  const frame = card.querySelector<HTMLElement>(".im-frame, .im-audio-art");
  const audioArt = frame?.classList.contains("im-audio-art") ?? false;
  const budget = reel.clientHeight;

  // clear anything a previous pass wrote
  vars.style.removeProperty("--card-title-size");
  vars.style.removeProperty("--card-frame-h");
  vars.style.removeProperty("--card-center-pad");
  vars.removeAttribute("data-solved-blurb");
  vars.removeAttribute("data-solved-conv");
  vars.removeAttribute("data-solved-linkdesc");
  vars.removeAttribute("data-solved-quote");
  vars.style.removeProperty("--card-post-lines");
  if (frame) frame.style.removeProperty("height");
  if (!opts.solve) return [];

  if (card.classList.contains("shorts-card") && frame) {
    const footer = card.querySelector<HTMLElement>(".shorts-card-footer");
    const cs = getComputedStyle(card);
    const column = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const chrome = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      + (footer?.offsetHeight ?? 0) + (card.querySelector<HTMLElement>(".im-controls")?.offsetHeight ?? 0)
      + (parseFloat(cs.rowGap) || 0);
    const ar = parseFloat(getComputedStyle(frame).getPropertyValue("--ar")) || 0.5625;
    const room = Math.max(0, budget - chrome);
    const height = Math.floor(Math.min(room, column / ar));
    vars.style.setProperty("--card-frame-h", `${height}px`);
    frame.style.height = `${height}px`;
    // A width-bound square/landscape Short keeps its full frame and centers in
    // the remaining space. Portrait video uses the full available height.
    vars.style.setProperty("--card-center-pad", `${Math.floor(Math.max(0, room - height) / 2)}px`);
    return [];
  }

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
    const ar = audioArt ? 1 : parseFloat(getComputedStyle(frame).getPropertyValue("--ar")) || 0.5625;
    // The portrait player may be narrower than the column; convert that width cap
    // into a height cap so the frame stays on its true aspect ratio.
    const colW = columnWidth();
    const capW = audioArt ? Math.min(132, colW) : ar < 1 ? colW * opts.mediaWidth : colW;
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
  // already absorbs the slack; article cards yield some image space and type before dropping the excerpt.
  // #200: a card's replies are secondary to the post itself, so they go before
  // the excerpt (a post's own text) and after the first type steps. The "more"
  // link always stays. Both knobs are no-ops on a card without replies.
  //
  // #205: a post's text is the card, so everything else gives way first - the
  // picture steps down, the replies go - and only then is the text trimmed, to
  // exactly what fits. Its size never steps: a post is read, not scanned.
  // #207: a post is drawn with its thread, so its picture steps all the way down
  // before the last reply goes; then the link card's description and a quoted
  // post's text, and only then the post's own text, which is what it says.
  const postEl = card.querySelector<HTMLElement>(".card-post");
  const knobs: [string, () => boolean][] = postEl && !frame
    ? [
        ["hero cap 34%", () => setCap(0.34)],
        ["second reply dropped", () => trimConv("one")],
        ["hero cap 26%", () => setCap(0.26)],
        ["hero cap 18%", () => setCap(0.18)],
        ["replies dropped", () => trimConv("off")],
        ["link description dropped", () => dropLinkDesc()],
        ["quote to 2 lines", () => trimQuote("short")],
        ["post trimmed", () => trimPost()],
        ["quote text dropped", () => trimQuote("off")],
      ]
    : frame
    ? [
        ["title 21px", () => step(1)],
        ["second reply dropped", () => trimConv("one")],
        ["title 19px", () => step(2)],
        ["replies dropped", () => trimConv("off")],
        ["title 17px", () => step(3)],
        ["title 16px", () => step(4)],
      ]
    : [
        ["hero cap 34%", () => setCap(0.34)],
        ["title 21px", () => step(1)],
        ["hero cap 26%", () => setCap(0.26)],
        ["title 19px", () => step(2)],
        ["second reply dropped", () => trimConv("one")],
        ["replies dropped", () => trimConv("off")],
        ["excerpt dropped", () => dropBlurb()],
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
  function trimConv(to: "one" | "off") {
    const replies = card.querySelectorAll(".cv-card-replies > .cv-row").length;
    const now = vars.getAttribute("data-solved-conv");
    if (replies === 0 || now === "off" || now === to || (to === "one" && replies < 2)) return false;
    vars.setAttribute("data-solved-conv", to);
    return true;
  }
  function trimPost() {
    if (!postEl || vars.style.getPropertyValue("--card-post-lines")) return false;
    const over = contentHeight(card) - budget;
    const lh = parseFloat(getComputedStyle(postEl).lineHeight) || 26;
    const lines = Math.max(2, Math.floor((postEl.offsetHeight - over - 2) / lh));
    vars.style.setProperty("--card-post-lines", String(lines));
    return true;
  }
  function dropLinkDesc() {
    if (!card.querySelector(".bp-link-desc") || vars.getAttribute("data-solved-linkdesc") === "off") return false;
    vars.setAttribute("data-solved-linkdesc", "off");
    return true;
  }
  function trimQuote(to: "short" | "off") {
    const now = vars.getAttribute("data-solved-quote");
    if (!card.querySelector(".bp-quote-text") || now === to || now === "off") return false;
    vars.setAttribute("data-solved-quote", to);
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
    // #200: a video's comments must not shrink the player to make room for
    // themselves. While any are visible and the frame is below its natural
    // height, keep stepping, which gives the comments up before the video.
    if (over <= 0 && !(frame && squeezedByConv(card, frame, budget))) break;
    const next = knobs.find(([, fn]) => fn());
    if (!next) break;
    gaveUp.push(next[0]);
  }

  // Drive the media to the requested clearance. Everything above works in
  // predicted pixels; this closes the loop on the measured result, so "grow the
  // media until the buttons are pushed down but not touching" is literally what
  // happens rather than something inferred from margins.
  const clearance = Math.max(opts.bottomGap, parseFloat(getComputedStyle(card).paddingBottom) || 0);
  if (frame) {
    const ar2 = audioArt ? 1 : parseFloat(getComputedStyle(frame).getPropertyValue("--ar")) || 0.5625;
    const colW2 = columnWidth();
    const maxH = audioArt ? Math.min(132, colW2) : (ar2 < 1 ? colW2 * opts.mediaWidth : colW2) / ar2;
    for (let i = 0; i < 6; i++) {
      const actions = bottomRow(card);
      if (!actions) break;
      // rects are transform-scaled; offsetHeight is not, so derive the factor
      const k = frame.offsetHeight ? frame.getBoundingClientRect().height / frame.offsetHeight : 1;
      if (!k) break;
      const clear = (card.getBoundingClientRect().bottom - actions.getBoundingClientRect().bottom) / k;
      const delta = clear - clearance;
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
    const actions = bottomRow(card);
    // #205: full-screen Shorts pad every other card clear of the floating chrome
    // (--imm-bottom). That padding is not slack: hold back whichever is larger, so
    // the stack centres between the header and the bottom chrome, not the screen.
    const reserve = Math.max(opts.bottomGap, parseFloat(getComputedStyle(card).paddingBottom) || 0);
    // NOT budget - contentHeight(card): `.snap` carries min-height:100%, so a card
    // that fits measures exactly the budget however little it holds, and the slack
    // reads as zero every time. Measure to the last thing on the card instead.
    const k = card.offsetHeight ? card.getBoundingClientRect().height / card.offsetHeight : 1;
    const last = actions ?? card.lastElementChild;
    if (last && k) {
      const slack = (card.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom) / k;
      const pad = Math.floor(Math.max(0, slack - reserve) / 2);
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
 * True when visible comments would not fit beside a landscape frame at its
 * natural size. Measured with the frame put back to natural height, because the
 * frame's working height inside the loop is not a reliable signal.
 */
function squeezedByConv(card: HTMLElement, frame: HTMLElement, budget: number): boolean {
  const visible = Array.from(card.querySelectorAll<HTMLElement>(".cv-card-replies > .cv-row")).some((r) => r.offsetParent !== null);
  if (!visible) return false;
  const ar = parseFloat(getComputedStyle(frame).getPropertyValue("--ar")) || 0;
  if (ar < 1) return false;
  const prev = frame.style.height;
  frame.style.height = `${Math.round((frame.parentElement?.clientWidth ?? 0) / ar)}px`;
  const over = contentHeight(card) - budget;
  frame.style.height = prev;
  return over > 0;
}

/**
 * The card's lowest row: the action row, or a long video's comments (#200),
 * which sit under the player's actions. Clearance and centring measure to it.
 */
function bottomRow(card: HTMLElement): HTMLElement | null {
  const rows = Array.from(card.querySelectorAll<HTMLElement>(".im-actions, .card-callout, .card-conv"));
  let best: HTMLElement | null = null;
  for (const r of rows) if (!best || r.getBoundingClientRect().bottom > best.getBoundingClientRect().bottom) best = r;
  return best;
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
    if (document.fonts.status === "loading") void document.fonts.ready.then(() => { if (!cancelled) raf = requestAnimationFrame(run); });
    if (onDone) raf = requestAnimationFrame(() => !cancelled && onDone(gaveUp));
  };
  const schedule = () => {
    void document.fonts.ready.then(() => { if (!cancelled) raf = requestAnimationFrame(run); });
  };
  // #205: `complete` with no pixels is a BROKEN image (a hero that 404s or is
  // refused by its host). Its load/error events have already fired, so waiting on
  // it meant the card was never solved - never centred - for as long as it lived.
  const pending = Array.from(card.querySelectorAll("img")).filter((i) => !i.complete);
  const cleanups: (() => void)[] = [];
  if (pending.length === 0) {
    schedule();
  } else {
    let left = pending.length;
    let solved = false;
    const done = () => {
      if (--left <= 0 && !cancelled) schedule();
    };
    // A slow image must not hold the layout hostage either: solve with what has
    // arrived, and solve again when the rest lands.
    const late = window.setTimeout(() => { if (!cancelled && !solved && left > 0) { solved = true; schedule(); } }, 1500);
    cleanups.push(() => window.clearTimeout(late));
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
