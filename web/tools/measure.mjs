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
if (!LAB && !APP) {
  console.error("need --lab <file|url> or --app <url>. See the header of this file.");
  process.exit(2);
}

// Devices worth checking. The Palma is the e-ink target; the 320 is the floor.
const DEVICES = [
  { name: "Palma 2", w: 412, h: 824, index: 7 },
  { name: "iPhone SE", w: 375, h: 667, index: 0 },
  { name: "narrow", w: 320, h: 568, index: 0 },
];

// What ships. Keep in sync with SHIPPED_LAYOUT/SHIPPED_VARS in lib/cardLayout.ts:
// the lab reads this off the URL hash, so a drift here silently measures a card
// nobody has.
const SHIPPED = {
  solve: true, title: "ramp", titleMin: 16, hero: "cap", heroCap: 0.46,
  video: "budget", videoTarget: 0.6, mediaWidth: 0.95, density: "tight",
  align: "center", hierarchy: "taxonomy-credit", menu: "actions", actions: "current",
  chrome: "full", reason: "hidden", blurbLines: 3, gutter: 20, notes: "icon",
  showByline: false, themeToggle: "wordmark", topGap: 18, bottomGap: 16, rhythm: 13,
};

const ALL_FIXTURES = [
  "news-portrait", "news-wide", "news-bare", "video-vertical", "video-wide",
  "audio", "link-only", "no-meta", "unbroken", "cjk",
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
  if (!card.querySelector(".card-title")) return { endCard: true };

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
    if (!el) return 0;
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    const lh = parseFloat(cs.lineHeight) || fs * 1.2;
    return Math.max(0, (lh - fs) / 2);
  };

  const first = card.querySelector(".card-hier, .card-title");
  const title = card.querySelector(".card-title");
  const credit = card.querySelector(".card-credit");
  const tax = card.querySelector(".ch-tax");
  const actions = card.querySelector(".im-actions, .card-callout");
  const media = card.querySelector(".card-media .im-frame, .media");

  // Optical gap between two rows. The media container inherits a font but
  // renders no glyphs, so it contributes no half-leading - counting it there
  // over-reported every gap ending at the media by ~4px.
  const gap = (a, b) => (!a || !b ? null : Math.round(R(b).top - R(a).bottom + half(a) + (b === media ? 0 : half(b))));

  return {
    title: title.textContent.slice(0, 30),
    above: Math.round(R(first).top - R(card).top),
    below: actions ? Math.round(R(card).bottom - R(actions).bottom) : null,
    titlePx: parseFloat(getComputedStyle(title).fontSize),
    // Header gaps, top to bottom. Expect the configured rhythm on every one; a
    // media card reads ~2 high on the last because the gap is measured to the
    // player's border box, and the frame has a 1px border.
    rhythm: [gap(tax, title), gap(title, credit), gap(credit, media)].filter((v) => v !== null).join("/"),
    media: media ? `${Math.round(R(media).width)}x${Math.round(R(media).height)} (${Math.round((R(media).height / card.offsetHeight) * 100)}%)` : "-",
    overflow: Math.max(0, card.scrollHeight - card.clientHeight),
    actionsInView: actions ? R(actions).bottom <= R(card).bottom + 1 : true,
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
  if (actions && !actions.includes("Save")) problems.push(`${where}: action row is missing Save - ${actions}`);
  if (m.overflow > 0) problems.push(`${where}: content overflows by ${m.overflow}px`);
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
  const device = DEVICES[0];
  const page = await browser.newPage({ viewport: { width: device.w, height: device.h }, deviceScaleFactor: SHOTS ? 2 : 1 });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  for (const step of ["20 min", "ALL YOUR SOURCES"]) {
    const el = await page.$(`text=${step}`);
    if (el) {
      await el.click();
      await page.waitForTimeout(1500);
    }
  }
  const begin = page.locator("button", { hasText: /^BEGIN$/i }).first();
  if (await begin.count()) {
    await begin.click({ force: true });
    await page.waitForTimeout(3500);
  }
  for (let i = 0; i < 12; i++) {
    const m = await page.evaluate(readCard);
    if (m.endCard || m.error) break;
    record(`app #${i}`, m);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/app-${i}.png` });
    await page.evaluate(() => {
      const s = document.querySelector(".stage");
      s.scrollTop += s.clientHeight;
    });
    await page.waitForTimeout(2000);
  }
  await page.close();
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
console.log(`\n${rows.length} cards, none clipped, every action reachable.`);
