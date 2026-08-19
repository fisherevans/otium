import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SessionCard } from "@/components/SessionCard";
import { cardRender, isVertical, isVideo } from "@/lib/render";
import { FIXTURES, FIXTURE_BY_KEY } from "./fixtures";
import {
  DEFAULT_LAYOUT,
  OPT_PROTOTYPE,
  PRESETS,
  layoutAttrs,
  layoutVars,
  measureCard,
  type LayoutOptions,
} from "./layout";
import "@/styles/global.css";
import "@/styles/lab.css";
import { forceWebShare } from "@/lib/share";
import { solveCard } from "@/lib/cardLayout";

// Render the phone's full action row here, not the desktop's. See lib/share.ts.
forceWebShare(true);

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

// Opens on the prototype: it is the current direction, so that is what the lab
// should show first. Every other option is one dropdown away.
const INITIAL: LabState = {
  view: "single",
  device: 7,
  w: 412,
  h: 824,
  fixture: "video-vertical",
  layout: { ...OPT_PROTOTYPE },
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
    let cancelled = false;
    let raf = 0;

    // Images must be decoded before any of this means anything: an <img> with no
    // intrinsic size yet measures as its borders, which both collapses the hero in
    // the readout AND makes the solver allocate space against a 2px picture.
    const run = () => {
      if (cancelled) return;
      const gaveUp = solveCard(screen, screen.querySelector<HTMLElement>(".lab-reel")!, screen.querySelector<HTMLElement>(".snap")!, layout);
      raf = requestAnimationFrame(() => {
        if (cancelled) return;
        const card = screen.querySelector<HTMLElement>(".snap");
        const m = card ? { ...measureCard(card), gaveUp } : null;
        setMetrics(m);
        onMetrics?.(m);
      });
    };

    const imgs = Array.from(screen.querySelectorAll("img"));
    const pending = imgs.filter((img) => !img.complete || img.naturalHeight === 0);
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
      });
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
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
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="lab-wordmark">otium</span>
                {layout.themeToggle === "wordmark" && <span className="lab-theme">◐</span>}
              </span>
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {layout.themeToggle === "library" && <span className="lab-theme">◐</span>}
                <span>library</span>
              </span>
            </div>
            <div className="lab-reel">
              <SessionCard
                sel={fx.sel}
                index={0}
                focused
                render={cardRender(fx.sel.item)}
                hierarchy={layout.hierarchy === "plain" ? "pill" : (layout.hierarchy as "pill" | "stack" | "breadcrumb" | "overline")}
                sectionName={fx.section}
                menuPlacement={layout.menu}
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
    ["clearance", `${m.bottomClearance}px`, m.bottomClearance < 4 ? "bad" : "good"],
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
          <button type="button" className="lab-btn" onClick={() => set({ layout: { ...OPT_PROTOTYPE } })} title="Restore the configured default layout">
            reset
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
          <select
            value={PRESETS.findIndex((p) => JSON.stringify(p.opts) === JSON.stringify(st.layout))}
            onChange={(e) => e.target.value !== "-1" && set({ layout: { ...PRESETS[+e.target.value].opts } })}
          >
            <option value="-1">custom…</option>
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
                <option value="pill">pill (today)</option>
                <option value="plain">flat pill</option>
                <option value="breadcrumb">breadcrumb</option>
                <option value="stack">overline + crumb</option>
                <option value="overline">overline only</option>
                <option value="taxonomy">section &rsaquo; topic / creator</option>
                <option value="taxonomy-credit">section &rsaquo; topic / title / credit</option>
              </select>
            </div>
            <div className="lab-row">
              <span>··· menu</span>
              <select value={st.layout.menu} onChange={(e) => setL({ menu: e.target.value as LayoutOptions["menu"] })}>
                <option value="top">own row, top (today)</option>
                <option value="hierarchy">on the hierarchy row</option>
                <option value="actions">in the actions, below</option>
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
              <span>gutter {st.layout.gutter}px</span>
              <input type="range" min={8} max={36} value={st.layout.gutter} onChange={(e) => setL({ gutter: +e.target.value })} />
            </div>
            <div className="lab-row">
              <span>media w {Math.round(st.layout.mediaWidth * 100)}%</span>
              <input type="range" min={40} max={100} value={Math.round(st.layout.mediaWidth * 100)} onChange={(e) => setL({ mediaWidth: +e.target.value / 100 })} />
            </div>
            <div className="lab-row">
              <span>byline</span>
              <button type="button" className={`lab-btn ${st.layout.showByline ? "on" : ""}`} onClick={() => setL({ showByline: !st.layout.showByline })}>
                {st.layout.showByline ? "shown" : "hidden"}
              </button>
            </div>
            <div className="lab-row">
              <span>media icons</span>
              <select value={st.layout.notes} onChange={(e) => setL({ notes: e.target.value as LayoutOptions["notes"] })}>
                <option value="labelled">as shipped</option>
                <option value="icon">bare icons</option>
              </select>
            </div>
            <div className="lab-row">
              <span>theme ctl</span>
              <select value={st.layout.themeToggle} onChange={(e) => setL({ themeToggle: e.target.value as LayoutOptions["themeToggle"] })}>
                <option value="library">by library</option>
                <option value="wordmark">by wordmark</option>
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
