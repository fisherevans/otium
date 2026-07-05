import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Feed, type Source } from "@/api/client";
import { feedIcon } from "@/lib/feedIcons";
import { WeightIndicator } from "@/components/WeightIndicator";
import { FeedIconPicker } from "@/components/FeedIconPicker";
import { BottomSheet } from "@/components/BottomSheet";

// Behavioral signal a source exhibits, derived per-render relative to the
// currently-visible set (not absolute) so "noisy"/"most-skipped" mean "loud
// compared to what else you follow right now". #35.
type Sig = { skipped: boolean; noisy: boolean; dormant: boolean };
type SigKey = "most-skipped" | "noisy" | "dormant";
const SIG_LABEL: Record<SigKey, string> = {
  "most-skipped": "most-skipped",
  noisy: "noisy",
  dormant: "dormant",
};

type SortKey = "weight" | "alpha" | "feed" | "skipped" | "noisy";
const SORTS: { k: SortKey; label: string }[] = [
  { k: "weight", label: "weight" },
  { k: "alpha", label: "a-z" },
  { k: "feed", label: "feed" },
  { k: "skipped", label: "skipped" },
  { k: "noisy", label: "noisy" },
];

// p-th percentile of the positive values (skip zeros, which mean "no sample").
function pctl(vals: number[], p: number): number {
  const v = vals.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  return v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
}

export default function SourcesPage() {
  const nav = useNavigate();
  const [sources, setSources] = useState<Source[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [ffeed, setFfeed] = useState<string | null>(null);
  const [fstate, setFstate] = useState<"followed" | "archived" | "all">("followed");
  const [fsignal, setFsignal] = useState<SigKey | null>(null);
  const [sort, setSort] = useState<SortKey>("weight");
  const [group, setGroup] = useState(false);
  // #66: rows navigate to a dedicated source page instead of a drill-in sheet.
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("rss");
  const [err, setErr] = useState("");
  const [fetching, setFetching] = useState(false);
  const [iconsOpen, setIconsOpen] = useState(false);
  // #55: signal / sort / group collapse into a bottom sheet so the always-on
  // control stack is just feed chips + state and the list keeps the screen.
  const [ctrlOpen, setCtrlOpen] = useState(false);
  // #64: the secondary actions (import / add / refresh / feed mix / feed
  // settings) collapse behind one "Manage" affordance so the list starts high.
  const [manageOpen, setManageOpen] = useState(false);
  const filtersActive = fsignal !== null || sort !== "weight" || group;

  function reload() {
    api.sources().then(setSources).catch((e) => setErr(String(e.message ?? e)));
  }
  function reloadFeeds() {
    api.feeds().then(setFeeds).catch(() => {});
  }
  useEffect(() => {
    reload();
    reloadFeeds();
  }, []);

  const median = useMemo(() => {
    const v = sources
      .map((s) => s.posts_per_day ?? 0)
      .filter((x) => x > 0)
      .sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : 0;
  }, [sources]);

  // Feed + state filtered set. Signal thresholds are computed over THIS set so
  // they're relative to what you're currently looking at, then the signal
  // filter (if any) narrows further - all three axes AND together.
  const base = useMemo(
    () =>
      sources.filter((s) => {
        if (fstate === "followed" && s.state === "archived") return false;
        if (fstate === "archived" && s.state !== "archived") return false;
        if (ffeed && s.feed_slug !== ffeed) return false;
        return true;
      }),
    [sources, ffeed, fstate],
  );

  const p75ppd = useMemo(() => pctl(base.map((s) => s.posts_per_day ?? 0), 0.75), [base]);
  const p75skip = useMemo(() => pctl(base.map((s) => s.skip_pct ?? 0), 0.75), [base]);

  function classify(s: Source): Sig {
    const ppd = s.posts_per_day ?? 0;
    const skip = s.skip_pct ?? 0;
    // dormant: has history but nothing in the freshness window.
    const dormant = ppd === 0 && (s.item_count ?? 0) > 0;
    // noisy: top quartile of posts/day AND at least 1.5x the median, so the
    // word stays honest in a set where everything posts at a similar rate.
    const noisy = !dormant && ppd > 0 && p75ppd > 0 && ppd >= p75ppd && ppd >= median * 1.5;
    // most-skipped: top quartile of skip rate, floored at 30% so it means "you
    // genuinely pass on this a lot", not just "highest of a low-skip set".
    const skipped = skip > 0 && skip >= Math.max(p75skip, 0.3);
    return { skipped, noisy, dormant };
  }

  const shown = useMemo(
    () =>
      base.filter((s) => {
        if (!fsignal) return true;
        const c = classify(s);
        if (fsignal === "most-skipped") return c.skipped;
        if (fsignal === "noisy") return c.noisy;
        return c.dormant;
      }),
    // classify closes over median + percentiles which derive from base.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, fsignal, p75ppd, p75skip, median],
  );

  const feedBySlug = useMemo(() => {
    const m = new Map<string, Feed>();
    feeds.forEach((f) => m.set(f.slug, f));
    return m;
  }, [feeds]);

  // A source belongs to exactly one feed (#86); this resolves it for feed-sort
  // and grouping. Feedless sources return null (the trailing "No feed" bucket).
  function primaryFeed(s: Source): Feed | null {
    return s.feed_slug ? feedBySlug.get(s.feed_slug) ?? null : null;
  }

  const sorted = useMemo(() => {
    const arr = [...shown];
    const byTitle = (a: Source, b: Source) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    arr.sort((a, b) => {
      switch (sort) {
        case "alpha":
          return byTitle(a, b);
        case "skipped":
          return (b.skip_pct ?? 0) - (a.skip_pct ?? 0) || byTitle(a, b);
        case "noisy":
          return (b.posts_per_day ?? 0) - (a.posts_per_day ?? 0) || byTitle(a, b);
        case "feed": {
          const fa = primaryFeed(a);
          const fb = primaryFeed(b);
          const ra = fa ? fa.sort : Infinity;
          const rb = fb ? fb.sort : Infinity;
          return ra - rb || (fa?.name ?? "~").localeCompare(fb?.name ?? "~") || byTitle(a, b);
        }
        case "weight":
        default:
          return b.weight - a.weight || byTitle(a, b);
      }
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, sort, feedBySlug]);

  // When grouping, bucket the already-sorted list by primary feed; feedless
  // sources fall into a trailing "No feed" group.
  const groups = useMemo(() => {
    if (!group) return null;
    const m = new Map<string, { feed: Feed | null; items: Source[] }>();
    for (const s of sorted) {
      const f = primaryFeed(s);
      const key = f?.slug ?? "__none";
      if (!m.has(key)) m.set(key, { feed: f, items: [] });
      m.get(key)!.items.push(s);
    }
    return [...m.values()].sort((a, b) => {
      if (!a.feed) return 1;
      if (!b.feed) return -1;
      return a.feed.sort - b.feed.sort || a.feed.name.localeCompare(b.feed.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, sorted, feedBySlug]);

  async function add() {
    if (!url.trim()) return;
    setErr("");
    try {
      await api.createSource({ title: title.trim() || url, feed_url: url.trim(), kind });
      setUrl("");
      setTitle("");
      setAdding(false);
      reload();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }
  async function fetchNow() {
    setFetching(true);
    await api.fetchNow().catch(() => {});
    setFetching(false);
    reload();
  }

  // Row signal line. Uses the same classify() thresholds as the signal filter
  // so what a row is labelled matches what the filter selects.
  function signal(s: Source): string {
    const c = classify(s);
    const ppd = s.posts_per_day ?? 0;
    const parts = [`${s.unseen_count ?? 0} unseen`];
    if (c.dormant) parts.push("dormant");
    else if (c.noisy) parts.push(median > 0 && ppd > 0 ? `${(ppd / median).toFixed(1)}× noisy` : "noisy");
    if (c.skipped) parts.push(`${Math.round((s.skip_pct ?? 0) * 100)}% skip`);
    return parts.join(" · ");
  }

  return (
    <div>
      {/* #54: explicit way back to the intent page to start a session - the
          bottom nav is easy to miss, so mirror the session's back affordance. */}
      <button className="lib-back" onClick={() => nav("/")}>
        <span aria-hidden>←</span> Start a session
      </button>
      {/* #64: compact top - title + one "Manage" affordance. The secondary
          actions live behind the Manage sheet so the list starts high. */}
      {/* #84 Model-A: the Library is just the library now. Collections + History
          moved to the Saved tab; Import / Feed mix / Settings to the You tab. The
          header keeps only the source-level "Manage" affordance, so it no longer
          overflows at phone width. */}
      <div className="lib-topbar">
        <h1 className="display">Your library</h1>
        <div className="lib-topbar-actions">
          <button className="lib-fsbtn" onClick={() => setManageOpen(true)}>
            Manage
          </button>
        </div>
      </div>
      <p className="sub">The sources you follow. Weight = how often they surface; turn down instead of unfollowing.</p>

      {/* filter by feed */}
      <div className="lib-filter">
        <button className={`lib-fchip ${!ffeed ? "on" : ""}`} onClick={() => setFfeed(null)}>All feeds</button>
        {feeds.map((f) => {
          const Ic = feedIcon(f.icon);
          return (
            <button key={f.slug} className={`lib-fchip ${ffeed === f.slug ? "on" : ""}`} onClick={() => setFfeed(f.slug)}>
              {Ic && <Ic size={13} strokeWidth={1.75} aria-hidden />}
              {f.name}
            </button>
          );
        })}
      </div>
      {/* #66: with a single feed in focus, offer an explicit, visible path to its
          dedicated page (settings + its sources + its posts). The chip still
          filters this list; this line is the browse-into affordance. */}
      {ffeed && feedBySlug.get(ffeed) && (
        <button className="lib-feedlink" onClick={() => nav(`/feeds/${ffeed}`)}>
          Open {feedBySlug.get(ffeed)!.name} page <span aria-hidden>▸</span>
        </button>
      )}
      {/* #55: state (primary axis) stays visible; signal / sort / group collapse
          behind the "Filter & sort" sheet trigger so the stack fits a phone. */}
      <div className="lib-controls">
        <div className="lib-segs">
          {(["followed", "archived", "all"] as const).map((st) => (
            <button key={st} className={`lib-seg ${fstate === st ? "on" : ""}`} onClick={() => setFstate(st)}>
              {st}
            </button>
          ))}
        </div>
        <button className={`lib-fsbtn ${filtersActive ? "on" : ""}`} onClick={() => setCtrlOpen(true)}>
          Filter &amp; sort{filtersActive && <span className="dot" aria-hidden />}
        </button>
        <span className="lib-count">{shown.length} of {sources.length}</span>
      </div>

      {(groups ?? [{ feed: null as Feed | null, items: sorted }]).map((g) => {
        const GIc = g.feed ? feedIcon(g.feed.icon) : null;
        return (
        <div key={g.feed ? g.feed.slug : "__flat"}>
          {group &&
            (g.feed ? (
              // #66: grouped headers browse into the feed's dedicated page.
              <button className="lib-group as-link" onClick={() => nav(`/feeds/${g.feed!.slug}`)}>
                {GIc && <GIc size={14} strokeWidth={1.75} aria-hidden />}
                <span>{g.feed.name}</span>
                <span className="cnt">{g.items.length}</span>
                <span className="chev" aria-hidden>▸</span>
              </button>
            ) : (
              <div className="lib-group">
                <span>No feed</span>
                <span className="cnt">{g.items.length}</span>
              </div>
            ))}
          {g.items.map((s) => {
        return (
          // #66: the whole row navigates to the source's dedicated page - no
          // inline expansion, no sheet. Rows stay scannable: weight · name · signal · ▸.
          <div className="lib-row" key={s.id}>
            <div className="lib-head" onClick={() => nav(`/sources/${s.id}`)}>
              <WeightIndicator weight={s.weight} className="wtag" />
              <div className="nm">
                <b>{s.title}</b>
                <span>{s.kind} · {signal(s)}{s.fetch_error ? " · fetch error" : ""}</span>
              </div>
              <span className="chev">▸</span>
            </div>
          </div>
        );
      })}
        </div>
        );
      })}

      {/* #64/#84: the collapsed source-level actions - full behavior, just
          off-screen until asked for. Add-a-source form lives inside the sheet
          too. Import / Feed mix / Settings moved to their own tabs (You), so
          this sheet is now just add / refresh / feed settings. */}
      <BottomSheet open={manageOpen} onClose={() => setManageOpen(false)} kicker="Manage">
        <div className="lib-sheet">
          <div className="sheet-rows">
            <button className="sheet-row" onClick={() => setAdding((a) => !a)}>
              <span>{adding ? "Cancel add" : "Add a source"}</span>
              <span className="sheet-chev">{adding ? "▾" : "▸"}</span>
            </button>
            {adding && (
              <div className="lib-add">
                <input className="field" placeholder="Feed URL (RSS / Atom / YouTube)" value={url} onChange={(e) => setUrl(e.target.value)} />
                <input className="field" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
                <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="rss">RSS / blog / news</option>
                  <option value="youtube">YouTube channel</option>
                  <option value="podcast">Podcast</option>
                </select>
                {err && <p className="err">{err}</p>}
                <button className="btn" onClick={add}>Add</button>
              </div>
            )}
            <button className="sheet-row" onClick={fetchNow} disabled={fetching}>
              <span>{fetching ? "Refreshing…" : "Refresh now"}</span>
              <span className="sheet-chev">↻</span>
            </button>
            {feeds.length > 0 && (
              <button className="sheet-row" onClick={() => { setManageOpen(false); setIconsOpen(true); }}>
                <span>Feed settings</span>
                <span className="sheet-chev">▸</span>
              </button>
            )}
            {/* #86: groups gather feeds under one name. Managed on their own page
                so the library header stays uncluttered. */}
            <button className="sheet-row" onClick={() => { setManageOpen(false); nav("/groups"); }}>
              <span>Groups</span>
              <span className="sheet-chev">▸</span>
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* #55: the collapsed secondary controls - full behavior, just off-screen
          until asked for. */}
      <BottomSheet open={ctrlOpen} onClose={() => setCtrlOpen(false)} kicker="Filter & sort">
        <div className="lib-sheet">
          <div className="ctl-label" style={{ marginTop: 4 }}>Signal</div>
          <div className="lib-sheet-row">
            <button className={`lib-seg ${!fsignal ? "on" : ""}`} onClick={() => setFsignal(null)}>any</button>
            {(["most-skipped", "noisy", "dormant"] as const).map((sg) => (
              <button key={sg} className={`lib-seg ${fsignal === sg ? "on" : ""}`} onClick={() => setFsignal((c) => (c === sg ? null : sg))}>
                {SIG_LABEL[sg]}
              </button>
            ))}
          </div>

          <div className="ctl-label">Sort</div>
          <div className="lib-sheet-row">
            {SORTS.map((o) => (
              <button key={o.k} className={`lib-seg ${sort === o.k ? "on" : ""}`} onClick={() => setSort(o.k)}>
                {o.label}
              </button>
            ))}
          </div>

          <div className="ctl-label">Grouping</div>
          <div className="lib-sheet-row">
            <button className={`lib-seg ${group ? "on" : ""}`} onClick={() => setGroup((g) => !g)}>
              group by feed
            </button>
          </div>

          <div className="lib-sheet-foot">
            <button
              className="btn ghost"
              disabled={!filtersActive}
              onClick={() => { setFsignal(null); setSort("weight"); setGroup(false); }}
            >
              Reset
            </button>
            <button className="btn" onClick={() => setCtrlOpen(false)}>Done</button>
          </div>
        </div>
      </BottomSheet>

      <FeedIconPicker
        feeds={feeds}
        open={iconsOpen}
        onClose={() => setIconsOpen(false)}
        onChanged={reloadFeeds}
      />
    </div>
  );
}
