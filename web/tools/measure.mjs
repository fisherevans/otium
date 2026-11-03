#!/usr/bin/env node
// Measure the session card's real geometry, in the lab or in the running app.
//
// The card's layout is SOLVED at runtime (see src/lib/cardLayout.ts), so you
// cannot review it by reading CSS - the numbers only exist once a browser has
// laid it out. This is the instrument for that: it drives a real Chromium, waits
// for the solver to settle, and reports what the card actually did.
//
// It exists because eyeballing screenshots repeatedly got the wrong answer during
// the layout work. A card that "looks centred" was 33px off; a probe that agreed
// with itself was adding half-leading to an element that renders no glyphs. If
// you are changing the card, change it here first and read the table.
//
//   node tools/measure.mjs --lab dist-lab/lab-standalone.html
//   node tools/measure.mjs --lab http://localhost:5173/lab --fixtures video-vertical,news-portrait
//   node tools/measure.mjs --app http://localhost:5173
//   node tools/measure.mjs --lab dist-lab/lab-standalone.html --shots /tmp/cards
//
// --lab  permutes fixtures x devices against the layout lab. Use this to design.
// --app  walks a real session in the running app. Use this to verify what ships.
//        (--app needs the Go server + a seeded DB; see CLAUDE.md "Local dev".)
//
// Exit code is 1 if any card clipped, overflowed, or put an action out of reach,
// so this can gate a change rather than just describe one.

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1] ?? true;
};

const LAB = arg("lab");
const APP = arg("app");
const SHOTS = arg("shots");
const SESSION = arg("session");
const SHORTS_MODE = argv.includes("--shorts-mode");
// #205/#206: the session's one view is full screen: the header floats and every
// ordinary card is padded clear of it. The lab keeps a knob for comparison; this
// instrument measures what ships, so it is always on (`--immersive` is accepted
// for old command lines, `--framed` measures the retired pill layout).
const IMMERSIVE = !argv.includes("--framed");
// --app only: force Shorts mode on or off for the pass ("on" is the default).
const VIEWING = arg("viewing");
const sessionSnapshot = SESSION ? JSON.parse(readFileSync(resolve(SESSION), "utf8")) : null;
if (!LAB && !APP) {
  console.error("need --lab <file|url> or --app <url>. See the header of this file.");
  process.exit(2);
}

// Phone viewports plus the Palma e-ink target; 320px is the narrow floor.
const DEVICES = [
  { name: "Palma 2", w: 412, h: 824, index: 7 },
  { name: "iPhone", w: 390, h: 664, index: 0 },
  { name: "iPhone SE", w: 375, h: 667, index: 0 },
  { name: "narrow", w: 320, h: 568, index: 0 },
  { name: "tall phone", w: 430, h: 932, index: 3 },
];

// What ships. Keep in sync with SHIPPED_LAYOUT/SHIPPED_VARS in lib/cardLayout.ts:
// the lab reads this off the URL hash, so a drift here silently measures a card
// nobody has.
const SHIPPED = {
  shortsMode: SHORTS_MODE,
  immersive: IMMERSIVE,
  solve: true, title: "ramp", titleMin: 16, hero: "cap", heroCap: 0.46,
  video: "budget", videoTarget: 0.6, mediaWidth: 0.95, density: "tight",
  align: "center", hierarchy: "taxonomy-credit", menu: "actions", actions: "current",
  chrome: "full", reason: "hidden", blurbLines: 3, gutter: 20, notes: "icon",
  showByline: false, themeToggle: "wordmark", topGap: 18, bottomGap: 16, rhythm: 13,
};

const ALL_FIXTURES = [
  "news-portrait", "news-wide", "news-bare", "video-vertical", "video-wide",
  "audio", "link-only", "no-meta", "unbroken", "cjk",
  "short-square", "short-wide", "long-vertical",
  "bsky-quote", "bsky-image", "substack-comments", "video-wide-comments",
  "news-vtdigger", "bsky-text-short", "bsky-text-long", "bsky-link-avatar",
  "bsky-otm", "bsky-images", "bsky-quoted", "bsky-thread",
  "bsky-link-only", "substack-short", "substack-long", "medium-short",
];
const FIXTURES = (arg("fixtures") ? String(arg("fixtures")).split(",") : ALL_FIXTURES).map((s) => s.trim());

/**
 * Everything worth knowing about one laid-out card, measured in CSS pixels.
 *
 * `above`/`below` are the whole point of the centring pass: the space over the
 * first line and under the action row. They should match within a pixel or two
 * when the card has slack, and `below` should equal bottomGap when it does not.
 */
function readCard() {
  const stage = document.querySelector(".lab-reel, .stage");
  if (!stage) return { error: "no stage" };
  const cards = [...stage.querySelectorAll(".snap")];
  const idx = stage.classList.contains("stage") ? Math.round(stage.scrollTop / stage.clientHeight) : 0;
  const card = cards[idx];
  if (!card) return { error: "no card" };
  const compact = card.classList.contains("shorts-card");
  if (!card.querySelector(".card-title, .card-post") && !compact) return { endCard: true };

  // Rects are transform-scaled in the lab's device frame and unscaled in the
  // app. offsetHeight never is, so derive the factor and divide rather than
  // mixing the two - that once reported media at 119% of a card it filled 81% of.
  const k = card.offsetHeight ? card.getBoundingClientRect().height / card.offsetHeight : 1;
  const R = (el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top / k, bottom: r.bottom / k, width: r.width / k, height: r.height / k };
  };
  // Half-leading: a text row carries (lineHeight - fontSize) / 2 of empty space
  // above and below its glyphs, so equal MARGINS do not read as equal GAPS.
  const half = (el) => {
    if (!el || el.classList.contains("bsky-post")) return 0; // #207: a box, not a line
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    const lh = parseFloat(cs.lineHeight) || fs * 1.2;
    return Math.max(0, (lh - fs) / 2);
  };

  const first = compact ? card.querySelector(".im-frame") : card.querySelector(".card-hier, .card-title");
  const title = card.querySelector(".card-title, .card-post");
  const post = card.querySelector(".card-post");
  // #207: a post's text sits inside its own card; the card is the header row.
  const postBox = card.querySelector(".bsky-post");
  const credit = card.querySelector(".card-credit");
  const tax = card.querySelector(".ch-tax");
  const actions = card.querySelector(".shorts-card-footer, .im-actions, .card-callout");
  const media = card.querySelector(".card-media .im-frame, .media");
  const details = card.querySelector(".shorts-details");
  const conv = card.querySelector(".card-conv"); // #200

  // Optical gap between two rows. The media container inherits a font but
  // renders no glyphs, so it contributes no half-leading - counting it there
  // over-reported every gap ending at the media by ~4px.
  const gap = (a, b) => (!a || !b ? null : Math.round(R(b).top - R(a).bottom + half(a) + (b === media ? 0 : half(b))));

  // #205: centring, net of the chrome the card is padded clear of. The top
  // reserve is the card's padding without the solver's pad; the bottom one is
  // what the solver holds back (bottomGap, or full screen's larger padding).
  const cs = getComputedStyle(card);
  const centerPad = parseFloat(cs.getPropertyValue("--card-center-pad")) || 0;
  const above = Math.round(R(first).top - R(card).top);
  const below = actions ? Math.round(R(card).bottom - Math.max(R(actions).bottom, conv ? R(conv).bottom : 0)) : null;
  const topReserve = parseFloat(cs.paddingTop) - centerPad;
  const bottomReserve = Math.max(16, parseFloat(cs.paddingBottom));
  // Rows in DOM order: an article is title then credit, a post credit then text.
  const order = [tax, postBox ?? title, credit].filter(Boolean).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const rows = [...order, media].filter(Boolean);

  return {
    compact,
    // Full-screen Shorts draw the clip edge to edge under a top bar whose ···
    // replaces Details; verify-shorts-playback covers that geometry, not this.
    fullScreenShort: compact && document.documentElement.dataset.immersive === "on",
    kind: post ? "post" : compact ? "short" : "card",
    title: (title?.textContent || card.getAttribute("aria-label") || "").slice(0, 30),
    above,
    below,
    // A full card (no pad, nothing spare at the bottom) has nothing to centre.
    offCentre: compact || below === null || (centerPad === 0 && below - bottomReserve <= 4) ? 0 : Math.round(above - topReserve - (below - bottomReserve)),
    replies: card.querySelectorAll(".cv-card-replies > .cv-row").length
      ? [...card.querySelectorAll(".cv-card-replies > .cv-row")].filter((r) => r.offsetParent !== null).length : "-",
    titlePx: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
    // Header gaps, top to bottom. Expect the configured rhythm on every one; a
    // media card reads ~2 high on the last because the gap is measured to the
    // player's border box, and the frame has a 1px border.
    rhythm: rows.slice(1).map((b, i) => gap(rows[i], b)).filter((v) => v !== null).join("/"),
    postLines: post ? Math.round(R(post).height / parseFloat(getComputedStyle(post).lineHeight)) : "-",
    postClamped: post ? post.scrollHeight > post.clientHeight + 1 : "-",
    avatarHero: !!post && [...card.querySelectorAll(".media img, .bp-images img")].some((im) =>
      im.getAttribute("src") === (card.querySelector(".card-credit img.src-avatar, .bp-head img.bp-avatar")?.getAttribute("src") ?? "-")),
    // #207: a post's links must be live, and a link card must stay compact.
    deadLinks: [...card.querySelectorAll(".card-post a")].filter((a) => !/^https?:/.test(a.getAttribute("href") || "")).length,
    linkCard: card.querySelector(".bp-linkcard") ? Math.round(R(card.querySelector(".bp-linkcard")).height) : "-",
    // #210: a compact link card (beside pictures, in a quote, or solved down from
    // large) stays compact; a large one is the post's only attachment.
    compactLink: Math.max(0, ...[...card.querySelectorAll(".bp-linkcard-compact, [data-solved-link] .bp-linkcard-large")].map((l) => Math.round(R(l).height))),
    // #210: the link card and the quoted post are on the card and must be whole.
    // Medium has no counts, so no row.
    solved: (() => {
      const v = card.closest("[data-solved-conv],[data-solved-link],[data-solved-quote]") || card.closest("[style*='--card-hero-cap']");
      if (!v) return "-";
      return ["conv", "link", "quote"].map((k) => v.getAttribute(`data-solved-${k}`) && `${k}:${v.getAttribute(`data-solved-${k}`)}`).filter(Boolean).join(" ") + " cap:" + (v.style.getPropertyValue("--card-hero-cap") || "?");
    })(),
    attachments: card.querySelectorAll(".bsky-post > .bp-linkcard, .bsky-post > .bp-quote").length,
    attachClipped: [...card.querySelectorAll(".bsky-post > .bp-linkcard, .bsky-post > .bp-quote")].filter((a) => R(a).bottom > R(card).bottom + 1 || a.offsetParent === null).length,
    zeroRow: card.querySelector(".bp-medium .bp-engagement") ? 1 : 0,
    media: media ? `${Math.round(R(media).width)}x${Math.round(R(media).height)} (${Math.round((R(media).height / card.offsetHeight) * 100)}%)` : "-",
    overflow: Math.max(0, card.scrollHeight - card.clientHeight),
    horizontalOverflow: Math.max(0, card.scrollWidth - card.clientWidth),
    actionsInView: actions ? R(actions).bottom <= R(card).bottom + 1 : true,
    mediaAspectError: compact && media ? Math.abs(R(media).width / R(media).height - Number(getComputedStyle(media).getPropertyValue("--ar"))) : 0,
    compactChromeHidden: !compact || !card.querySelector(".card-title, .card-hier, .card-byline, .card-blurb, .im-actions"),
    detailsReachable: !compact || !!details && Math.round(R(details).width) >= 44 && Math.round(R(details).height) >= 44, // rounded: the lab frame is scaled
    actions: actions ? [...actions.children].map((c) => c.getAttribute("aria-label") || c.textContent.trim()).join(" ") : "-",
  };
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
const rows = [];
const problems = [];
const errors = [];

function record(where, m) {
  if (m.error || m.endCard) return;
  const { actions, ...cols } = m; // the action row is checked, not tabulated
  rows.push({ where, ...cols });
  // A full-screen Short is covered by verify-shorts-playback; it has neither the
  // compact footer checked here nor an ordinary action row.
  if (m.compact && m.fullScreenShort) { /* skip */ }
  else if (m.compact) {
    // #206/#208: the compact card's ··· opens actions for this item (which link to Details).
    if (!actions.includes("Actions for this item")) problems.push(`${where}: compact card is missing its actions ···`);
    if (m.mediaAspectError > 0.01) problems.push(`${where}: compact video aspect was distorted`);
    if (!m.compactChromeHidden) problems.push(`${where}: ordinary card chrome remains in compact mode`);
    if (!m.detailsReachable) problems.push(`${where}: the actions ··· is smaller than its touch target`);
  } else if (actions && !actions.includes("Save")) problems.push(`${where}: action row is missing Save - ${actions}`);
  if (m.overflow > 0) problems.push(`${where}: content overflows by ${m.overflow}px`);
  if (Math.abs(m.offCentre) > 4) problems.push(`${where}: card is ${m.offCentre}px off centre (above ${m.above}, below ${m.below})`);
  if (m.avatarHero) problems.push(`${where}: a post shows its author's avatar as the hero`);
  if (m.deadLinks > 0) problems.push(`${where}: ${m.deadLinks} post link(s) without an http(s) target`);
  if (m.compactLink > 130) problems.push(`${where}: compact link card is ${m.compactLink}px tall`);
  if (m.attachClipped > 0) problems.push(`${where}: a quoted post or link card is cut off or hidden`);
  if (m.zeroRow > 0) problems.push(`${where}: a Medium post shows a counts row`);
  if (m.compact && m.horizontalOverflow > 0) problems.push(`${where}: content overflows horizontally by ${m.horizontalOverflow}px`);
  if (!m.actionsInView) problems.push(`${where}: action row is out of reach`);
}

const labUrl = (fixture, device) => {
  const base = /^https?:/.test(LAB) ? LAB : "file://" + resolve(LAB);
  const state = { view: "single", device: device.index, w: device.w, h: device.h, fixture, layout: SHIPPED };
  return `${base}#${encodeURIComponent(JSON.stringify(state))}`;
};

if (LAB) {
  for (const device of DEVICES) {
    for (const fixture of FIXTURES) {
      const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: SHOTS ? 2 : 1 });
      // Layout fixtures use posters and never contact YouTube. Playback behavior
      // is covered by the app's media regression, not this geometry instrument.
      await page.addInitScript(() => {
        window.YT = {
          PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 },
          Player: class {
            getPlayerState() { return 2; }
            getCurrentTime() { return 0; }
            destroy() {}
          },
        };
      });
      page.on("pageerror", (e) => errors.push(`${device.name}/${fixture}: ${e.message}`));
      await page.goto(labUrl(fixture, device));
      // the solver waits on image decode, then settles over a few frames
      await page.waitForTimeout(1800);
      record(`${device.name} ${fixture}`, await page.evaluate(readCard));
      if (SHOTS) {
        const el = await page.$(".lab-device");
        if (el) await el.screenshot({ path: `${SHOTS}/${device.name.replace(/\W+/g, "-")}-${fixture}.png` });
      }
      await page.close();
    }
  }
}

if (APP) {
  // Walk a real session. The intent flow is length -> scope -> begin; if a
  // session is already active the app resumes it and those steps are absent.
  for (const device of DEVICES) {
    const firstRow = rows.length;
    const page = await browser.newPage({ viewport: { width: device.w, height: device.h }, deviceScaleFactor: SHOTS ? 2 : 1 });
    page.on("pageerror", (e) => errors.push(e.message));
    if (VIEWING) {
      // Viewing choices are per account in this browser; set them for every id.
      await page.addInitScript((v) => {
        for (let id = 0; id < 10; id++) localStorage.setItem(`otium:shorts-mode:${id}`, v);
        localStorage.setItem("otium:shorts-mode:unknown", v);
      }, VIEWING);
    }
    if (sessionSnapshot) {
      // Real API payload captured from an isolated dev server. Keep concurrent
      // browser passes from replacing each other's queue or advancing its cursor.
      await page.route("**/api/v1/**", (route) => {
        if (route.request().url().endsWith("/sessions/current")) {
          return route.fulfill({ json: { ...sessionSnapshot, cursor: 0 } });
        }
        if (route.request().method() !== "GET") return route.fulfill({ json: { ok: true } });
        return route.continue();
      });
    }
    const appURL = sessionSnapshot ? new URL(`/session/${sessionSnapshot.session_id}`, APP).href : APP;
    await page.goto(appURL, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    for (const step of ["20 min", "Everything you follow"]) {
      const el = await page.$(`text=${step}`);
      if (el) {
        await el.click();
        await page.waitForTimeout(1500);
      }
    }
    const begin = page.locator("button", { hasText: /^Begin session$/i }).first();
    if (await begin.count()) {
      await begin.click({ force: true });
      await page.waitForTimeout(3500);
    }
    await page.evaluate(() => {
      const stage = document.querySelector(".stage");
      if (stage) stage.scrollTop = 0;
    });
    await page.waitForTimeout(1800);
    for (let i = 0; i < 12; i++) {
      const m = await page.evaluate(readCard);
      if (m.endCard || m.error) break;
      record(`${device.name} app #${i}`, m);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${device.name.replace(/\W+/g, "-")}-app-${i}.png` });
      await page.evaluate(() => {
        const s = document.querySelector(".stage");
        s.scrollTop += s.clientHeight;
      });
      await page.waitForTimeout(2000);
    }
    if (rows.length === firstRow) problems.push(`${device.name}: no session cards measured`);
    await page.close();
  }
}

await browser.close();

if (rows.length === 0) {
  console.error("measured nothing - is the target up, and does it have a session to show?");
  process.exit(2);
}
console.table(rows);
if (errors.length) console.log("\npage errors:\n  " + errors.join("\n  "));
if (problems.length) {
  console.log("\nPROBLEMS:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`\n${rows.length} cards, no vertical overflow, every action reachable; compact geometry checks passed.`);
