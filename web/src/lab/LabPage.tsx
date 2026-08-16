import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SessionCard } from "@/components/SessionCard";
import { cardRender, isVertical, isVideo } from "@/lib/render";
import { FIXTURES, FIXTURE_BY_KEY } from "./fixtures";
import {
  DEFAULT_LAYOUT,
  PRESETS,
  TITLE_RAMP,
  layoutAttrs,
  layoutVars,
  measureCard,
  type LayoutOptions,
} from "./layout";
import "@/styles/lab.css";

// The layout lab. A dev-only surface for permuting card layout against the REAL
// SessionCard - same component the session renders, same CSS, same CardParts.
// Nothing here forks the card; every variant is an override scoped to
// .lab-screen[data-*] in lab.css, so what you see is the shipped card behaving
// under a different rule, not a drawing of one.
//
// Three views:
//   single   - one device, one fixture, full readout
//   fixtures - one variant across every content shape (does it hold up?)
//   variants - one fixture across several variants (which do I prefer?)
//
// State lives in the URL hash, so a configuration is a link and a screenshot
// harness can drive it without clicking.

const DEVICES: [string, number, number][] = [
  ["iPhone SE", 375, 667],
  ["iPhone 13 mini", 375, 812],
  ["iPhone 15", 390, 844],
  ["iPhone 15 Pro Max", 430, 932],
  ["Pixel 7", 412, 915],
  ["Galaxy S23", 360, 780],
  ["Z Fold (folded)", 344, 882],
  ["Boox Palma 2", 412, 824],
  ["iPad mini", 744, 1133],
];

type View = "single" | "fixtures" | "variants";

interface LabState {
  view: View;
  device: number;
  w: number;
  h: number;
  fixture: string;
  layout: LayoutOptions;
}

const INITIAL: LabState = {
  view: "single",
  device: 7,
  w: 412,
  h: 824,
  fixture: "video-vertical",
  layout: { ...DEFAULT_LAYOUT },
};

function readHash(): LabState {
  try {
    const raw = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (!raw) return INITIAL;
    const p = JSON.parse(raw);
    return { ...INITIAL, ...p, layout: { ...DEFAULT_LAYOUT, ...(p.layout || {}) } };
  } catch {
    return INITIAL;
  }
}

/**
 * The budget solver, applied to a rendered card.
 *
 * The card is exactly one screen (`height:100%; overflow:hidden`), which means
 * `scrollHeight` CLAMPS - it can never report the overflow we are trying to
 * measure. So every measurement here temporarily lets the card size to its
 * content, reads it, and puts it back. Getting this wrong silently collapses the
 * media to nothing, which is exactly what it did the first time.
 */
function contentHeight(card: HTMLElement): number {
  const h = card.style.height;
  const o = card.style.overflow;
  card.style.height = "auto";
  card.style.overflow = "visible";
  const measured = card.offsetHeight;
  card.style.height = h;
  card.style.overflow = o;
  return measured;
}

function solveCard(screen: HTMLElement, opts: LayoutOptions): string[] {
  const reel = screen.querySelector<HTMLElement>(".lab-reel");
  const card = screen.querySelector<HTMLElement>(".snap");
  if (!reel || !card) return [];
  const title = card.querySelector<HTMLElement>(".card-title");
  const frame = card.querySelector<HTMLElement>(".im-frame");
  const budget = reel.clientHeight;

  // clear anything a previous pass wrote
  screen.style.removeProperty("--lab-title-size");
  screen.style.removeProperty("--lab-frame-h");
  screen.removeAttribute("data-solved-blurb");
  if (frame) frame.style.removeProperty("height");
  if (!opts.solve) return [];

  const gaveUp: string[] = [];
  let cap = opts.heroCap;
  let ti = 0;

  // Media takes the residual: measure the card with the frame collapsed, then
  // hand the frame whatever is left (bounded by its own aspect ratio).
  const sizeMedia = () => {
    if (!frame) return;
    // Chrome by subtraction, not by collapsing the frame: the player sits inside
    // two nested flex containers, and zeroing its height does not reliably shrink
    // them, which silently reported "no room" and collapsed the media to 2px.
    const chrome = contentHeight(card) - frame.offsetHeight;
    const ar = parseFloat(getComputedStyle(frame).getPropertyValue("--ar")) || 0.5625;
    const widthBound = card.clientWidth / ar;
    const room = Math.max(0, budget - chrome - 6);
    const target = opts.video === "bleed" ? widthBound : Math.min(room, widthBound);
    screen.style.setProperty("--lab-frame-h", `${Math.round(target)}px`);
    frame.style.height = `${Math.round(target)}px`;
  };

  const apply = () => {
    // In PIXELS, deliberately. As a percentage this resolves against the card's
    // height - and contentHeight() makes that height auto while measuring, which
    // turns the percentage indefinite, drops the cap, and inflates every reading.
    screen.style.setProperty("--lab-hero-cap", `${Math.round(cap * budget)}px`);
    if (opts.title === "ramp" && title) {
      screen.style.setProperty("--lab-title-size", `${TITLE_RAMP[ti]}px`);
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
    if (screen.getAttribute("data-solved-blurb") === "off") return false;
    screen.setAttribute("data-solved-blurb", "off");
    return true;
  }

  for (let i = 0; i < 16; i++) {
    apply();
    if (contentHeight(card) <= budget + 1) break;
    const next = knobs.find(([, fn]) => fn());
    if (!next) break;
    gaveUp.push(next[0]);
  }
  apply();

  // Last resort: take any remaining spill out of the media rather than let the
  // card clip an action.
  if (frame) {
    const spill = contentHeight(card) - budget;
    if (spill > 0) {
      const h = Math.max(0, frame.offsetHeight - spill);
      frame.style.height = `${h}px`;
      screen.style.setProperty("--lab-frame-h", `${h}px`);
    }
  }
  return gaveUp;
}

function Screen({
  fixtureKey,
  w,
  h,
  k,
  layout,
  caption,
  onMetrics,
}: {
  fixtureKey: string;
  w: number;
  h: number;
  k: number;
  layout: LayoutOptions;
  caption: string;
  onMetrics?: (m: (ReturnType<typeof measureCard> & { gaveUp: string[] }) | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fx = FIXTURE_BY_KEY[fixtureKey] ?? FIXTURES[0];
  const [metrics, setMetrics] = useState<(ReturnType<typeof measureCard> & { gaveUp: string[] }) | null>(null);

  useLayoutEffect(() => {
    const screen = ref.current;
    if (!screen) return;
    let raf = requestAnimationFrame(() => {
      const gaveUp = solveCard(screen, layout);
      raf = requestAnimationFrame(() => {
        const card = screen.querySelector<HTMLElement>(".snap");
        const m = card ? { ...measureCard(card), gaveUp } : null;
        setMetrics(m);
        onMetrics?.(m);
      });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureKey, w, h, JSON.stringify(layout)]);

  const vertical = isVertical(fx.sel.item);

  return (
    <figure className="lab-cell" style={{ margin: 0 }}>
      <div className="lab-device" style={{ "--dw": `${w}px`, "--dh": `${h}px`, "--k": k } as React.CSSProperties}>
        <div className="lab-scale">
          <div
            className="lab-screen"
            ref={ref}
            {...layoutAttrs(layout)}
            data-vertical={vertical ? "1" : "0"}
            style={{ ...layoutVars(layout), ["--lab-vh" as string]: `${h / 100}px` }}
          >
            <div className="lab-topbar">
              <span>&larr; intent</span>
              <span className="lab-wordmark">otium</span>
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span className="lab-theme">◐</span>
                <span>library</span>
              </span>
            </div>
            <div className="lab-reel">
              <SessionCard
                sel={fx.sel}
                index={0}
                focused
                render={cardRender(fx.sel.item)}
                onOpenContent={() => {}}
                onOpenExternal={() => {}}
                onSave={() => {}}
                onSource={() => {}}
                onMenu={() => {}}
              />
            </div>
            <div className="lab-foot">End session</div>
          </div>
        </div>
      </div>
      <figcaption>{caption}</figcaption>
      {metrics && <Readout m={metrics} isVid={isVideo(fx.sel.item)} />}
    </figure>
  );
}

function Readout({ m, isVid }: { m: ReturnType<typeof measureCard> & { gaveUp: string[] }; isVid: boolean }) {
  const rows: [string, string, "good" | "bad" | ""][] = [
    ["title", `${m.titlePx}px${m.titleTruncated ? " · TRUNCATED" : ""}`, m.titleTruncated ? "bad" : "good"],
    ["media", m.mediaW ? `${m.mediaW}×${m.mediaH} · ${m.mediaPct}%` : "none", isVid && m.mediaPct < 40 ? "bad" : ""],
    ["clipped", m.clipped.length ? m.clipped.join(", ") : "nothing", m.clipped.length ? "bad" : "good"],
    ["fits", m.fits ? "yes" : "no", m.fits ? "good" : "bad"],
    ["gave up", m.gaveUp.length ? m.gaveUp.join(", ") : "nothing", m.gaveUp.length ? "bad" : ""],
  ];
  return (
    <div className="lab-read">
      {rows.map(([k, v, cls]) => (
        <div className={`r ${cls}`} key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}

export function LabPage() {
  const [st, setSt] = useState<LabState>(readHash);
  const set = useCallback((patch: Partial<LabState>) => setSt((s) => ({ ...s, ...patch })), []);
  const setL = useCallback(
    (patch: Partial<LayoutOptions>) => setSt((s) => ({ ...s, layout: { ...s.layout, ...patch } })),
    [],
  );

  // The hash IS the state, both ways: we write it on every change, and we adopt
  // it when something else changes it (a pasted link, a screenshot harness, the
  // back button). `own` guards the round-trip so our own writes don't re-enter.
  const own = useRef("");
  useEffect(() => {
    own.current = encodeURIComponent(JSON.stringify(st));
    if (location.hash.replace(/^#/, "") !== own.current) location.replace(`#${own.current}`);
  }, [st]);
  useEffect(() => {
    const onHash = () => {
      const raw = location.hash.replace(/^#/, "");
      if (raw && raw !== own.current) setSt(readHash());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const scale = useMemo(() => {
    const perCol = st.view === "single" ? 620 : 300;
    return Math.min(1, perCol / st.w, (st.view === "single" ? 760 : 560) / st.h) || 0.5;
  }, [st.view, st.w, st.h]);

  const opt = <T extends string>(v: T, on: T, fn: (v: T) => void, label = String(v)) => (
    <button type="button" key={v} className={`lab-btn ${v === on ? "on" : ""}`} onClick={() => fn(v)}>
      {label}
    </button>
  );

  return (
    <div className="lab">
      <div className="lab-bar">
        <h1>layout lab</h1>
        <div className="lab-group">
          <label>view</label>
          {(["single", "fixtures", "variants"] as View[]).map((v) => opt(v, st.view, (x) => set({ view: x })))}
        </div>
        <div className="lab-group">
          <label>device</label>
          <select
            value={st.device}
            onChange={(e) => {
              const i = +e.target.value;
              set({ device: i, w: DEVICES[i][1], h: DEVICES[i][2] });
            }}
          >
            {DEVICES.map((d, i) => (
              <option key={d[0]} value={i}>
                {d[0]} {d[1]}×{d[2]}
              </option>
            ))}
          </select>
          <button type="button" className="lab-btn" onClick={() => set({ w: st.h, h: st.w })}>
            rotate
          </button>
        </div>
        <div className="lab-group">
          <label>w</label>
          <input type="range" min={280} max={1200} value={st.w} onChange={(e) => set({ w: +e.target.value })} />
          <span className="lab-num">{st.w}</span>
        </div>
        <div className="lab-group">
          <label>h</label>
          <input type="range" min={380} max={1400} value={st.h} onChange={(e) => set({ h: +e.target.value })} />
          <span className="lab-num">{st.h}</span>
        </div>
        <div className="lab-group">
          <label>preset</label>
          <select value="" onChange={(e) => e.target.value && setL(PRESETS[+e.target.value].opts)}>
            <option value="">choose…</option>
            {PRESETS.map((p, i) => (
              <option key={p.key} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="lab-body">
        <aside className="lab-panel">
          <div className="lab-fieldset">
            <h2>content</h2>
            <select value={st.fixture} onChange={(e) => set({ fixture: e.target.value })} style={{ width: "100%" }}>
              {FIXTURES.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
            <p style={{ fontSize: 11, color: "var(--ink-mute)", margin: "7px 0 0", lineHeight: 1.45 }}>
              {(FIXTURE_BY_KEY[st.fixture] ?? FIXTURES[0]).note}
            </p>
          </div>

          <div className="lab-fieldset">
            <h2>layout</h2>
            <div className="lab-row">
              <span>solve</span>
              <button type="button" className={`lab-btn ${st.layout.solve ? "on" : ""}`} onClick={() => setL({ solve: !st.layout.solve })}>
                {st.layout.solve ? "on" : "off"}
              </button>
            </div>
            <div className="lab-row">
              <span>title</span>
              <select value={st.layout.title} onChange={(e) => setL({ title: e.target.value as LayoutOptions["title"] })}>
                <option value="clamp3">clamp 3</option>
                <option value="clamp2">clamp 2</option>
                <option value="full">full</option>
                <option value="ramp">ramp</option>
              </select>
            </div>
            <div className="lab-row">
              <span>min {st.layout.titleMin}px</span>
              <input type="range" min={13} max={21} value={st.layout.titleMin} onChange={(e) => setL({ titleMin: +e.target.value })} />
            </div>
            <div className="lab-row">
              <span>hero</span>
              <select value={st.layout.hero} onChange={(e) => setL({ hero: e.target.value as LayoutOptions["hero"] })}>
                <option value="fixed">fixed 30vh</option>
                <option value="aspect">true aspect</option>
                <option value="cap">aspect + cap</option>
              </select>
            </div>
            <div className="lab-row">
              <span>cap {Math.round(st.layout.heroCap * 100)}%</span>
              <input type="range" min={15} max={70} value={Math.round(st.layout.heroCap * 100)} onChange={(e) => setL({ heroCap: +e.target.value / 100 })} />
            </div>
            <div className="lab-row">
              <span>video</span>
              <select value={st.layout.video} onChange={(e) => setL({ video: e.target.value as LayoutOptions["video"] })}>
                <option value="fixed72">fixed 72dvh</option>
                <option value="budget">from budget</option>
                <option value="bleed">full bleed</option>
              </select>
            </div>
            <div className="lab-row">
              <span>blurb</span>
              <select value={st.layout.blurbLines} onChange={(e) => setL({ blurbLines: +e.target.value })}>
                <option value={0}>off</option>
                <option value={2}>2 lines</option>
                <option value={3}>3 lines</option>
                <option value={4}>4 lines</option>
              </select>
            </div>
          </div>

          <div className="lab-fieldset">
            <h2>style</h2>
            <div className="lab-row">
              <span>density</span>
              <select value={st.layout.density} onChange={(e) => setL({ density: e.target.value as LayoutOptions["density"] })}>
                <option value="roomy">roomy</option>
                <option value="normal">normal</option>
                <option value="tight">tight</option>
              </select>
            </div>
            <div className="lab-row">
              <span>align</span>
              <select value={st.layout.align} onChange={(e) => setL({ align: e.target.value as LayoutOptions["align"] })}>
                <option value="center">center</option>
                <option value="top">top</option>
              </select>
            </div>
            <div className="lab-row">
              <span>hierarchy</span>
              <select value={st.layout.hierarchy} onChange={(e) => setL({ hierarchy: e.target.value as LayoutOptions["hierarchy"] })}>
                <option value="pill">pill</option>
                <option value="plain">plain type</option>
              </select>
            </div>
            <div className="lab-row">
              <span>actions</span>
              <select value={st.layout.actions} onChange={(e) => setL({ actions: e.target.value as LayoutOptions["actions"] })}>
                <option value="current">as shipped</option>
                <option value="icons">icons only</option>
                <option value="labels">outlined</option>
              </select>
            </div>
            <div className="lab-row">
              <span>chrome</span>
              <select value={st.layout.chrome} onChange={(e) => setL({ chrome: e.target.value as LayoutOptions["chrome"] })}>
                <option value="full">full</option>
                <option value="slim">slim</option>
                <option value="none">none</option>
              </select>
            </div>
            <div className="lab-row">
              <span>reason</span>
              <select value={st.layout.reason} onChange={(e) => setL({ reason: e.target.value as LayoutOptions["reason"] })}>
                <option value="top">shown</option>
                <option value="hidden">hidden</option>
              </select>
            </div>
          </div>
        </aside>

        <div className="lab-stage" id="labStage">
          {st.view === "single" && (
            <Screen
              fixtureKey={st.fixture}
              w={st.w}
              h={st.h}
              k={scale}
              layout={st.layout}
              caption={`${st.w} × ${st.h}`}
            />
          )}
          {st.view === "fixtures" &&
            FIXTURES.map((f) => (
              <Screen key={f.key} fixtureKey={f.key} w={st.w} h={st.h} k={scale} layout={st.layout} caption={f.label} />
            ))}
          {st.view === "variants" &&
            PRESETS.map((p) => (
              <Screen
                key={p.key}
                fixtureKey={st.fixture}
                w={st.w}
                h={st.h}
                k={scale}
                layout={p.opts}
                caption={p.label}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

export default LabPage;
