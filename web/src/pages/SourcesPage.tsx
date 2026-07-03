import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Feed, type Source } from "@/api/client";
import { BUCKETS, BLABEL, bucketOf, type Bucket } from "@/lib/weight";
import { feedIcon } from "@/lib/feedIcons";
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
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("rss");
  const [err, setErr] = useState("");
  const [fetching, setFetching] = useState(false);
  const [confirmA, setConfirmA] = useState<number | null>(null);
  const [confirmD, setConfirmD] = useState<number | null>(null);
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const [iconsOpen, setIconsOpen] = useState(false);
  // #55: signal / sort / group collapse into a bottom sheet so the always-on
  // control stack is just feed chips + state and the list keeps the screen.
  const [ctrlOpen, setCtrlOpen] = useState(false);
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
        if (ffeed && !(s.feed_slugs ?? []).includes(ffeed)) return false;
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

  // A source can belong to several feeds; its "primary" feed (for feed-sort and
  // for grouping) is the one that sorts first in the feed order.
  function primaryFeed(s: Source): Feed | null {
    let best: Feed | null = null;
    for (const sl of s.feed_slugs ?? []) {
      const f = feedBySlug.get(sl);
      if (!f) continue;
      if (!best || f.sort < best.sort || (f.sort === best.sort && f.name < best.name)) best = f;
    }
    return best;
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

  function showToast(msg: string, undo?: () => void) {
    setToast({ msg, undo });
    window.setTimeout(() => setToast((t) => (t && t.msg === msg ? null : t)), 4500);
  }

  async function setWeight(s: Source, bucket: Bucket) {
    const prev = bucketOf(s.weight);
    await api.updateSource(s.id, { weight_bucket: bucket }).catch(() => {});
    reload();
    if (bucket !== prev) {
      showToast(`${s.title} → ${BLABEL[bucket]}`, async () => {
        await api.updateSource(s.id, { weight_bucket: prev }).catch(() => {});
        reload();
        setToast(null);
      });
    }
  }
  async function setCap(s: Source, cap: number) {
    await api.updateSource(s.id, { per_session_cap: Math.max(1, cap) }).catch(() => {});
    reload();
  }
  async function toggleFeed(s: Source, slug: string) {
    const cur = new Set(s.feed_slugs ?? []);
    cur.has(slug) ? cur.delete(slug) : cur.add(slug);
    await api.setSourceFeeds(s.id, [...cur]).catch(() => {});
    reload();
  }
  async function archive(s: Source) {
    await api.updateSource(s.id, { state: "archived" }).catch(() => {});
    setConfirmA(null);
    reload();
    showToast(`${s.title} archived`, async () => {
      await api.updateSource(s.id, { state: "followed" }).catch(() => {});
      reload();
      setToast(null);
    });
  }
  async function remove(s: Source) {
    await api.deleteSource(s.id).catch(() => {});
    setConfirmD(null);
    reload();
  }
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
      <h1 className="display">Your library</h1>
      <p className="sub">The sources you follow. Weight = how often they surface; turn down instead of unfollowing.</p>

      <button className="btn" style={{ marginTop: 0 }} onClick={() => nav("/import")}>
        Import your follows
      </button>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn ghost" style={{ marginTop: 0 }} onClick={() => setAdding((a) => !a)}>
          {adding ? "Cancel" : "+ Add one"}
        </button>
        <button className="btn ghost" style={{ marginTop: 0 }} onClick={fetchNow} disabled={fetching}>
          {fetching ? "Refreshing…" : "Refresh"}
        </button>
        <button className="btn ghost" style={{ marginTop: 0 }} onClick={() => nav("/mix")}>
          Feed mix
        </button>
        {feeds.length > 0 && (
          <button className="btn ghost" style={{ marginTop: 0 }} onClick={() => setIconsOpen(true)}>
            Feed settings
          </button>
        )}
      </div>

      {adding && (
        <div style={{ marginTop: 14 }}>
          <input className="field" placeholder="Feed URL (RSS / Atom / YouTube)" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input className="field" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="rss">RSS / blog / news</option>
            <option value="youtube">YouTube channel</option>
            <option value="podcast">Podcast</option>
          </select>
          <button className="btn" onClick={add}>Add</button>
        </div>
      )}
      {err && <p className="err">{err}</p>}

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
          {group && (
            <div className="lib-group">
              {GIc && <GIc size={14} strokeWidth={1.75} aria-hidden />}
              <span>{g.feed ? g.feed.name : "No feed"}</span>
              <span className="cnt">{g.items.length}</span>
            </div>
          )}
          {g.items.map((s) => {
        const isOpen = open === s.id;
        const b = bucketOf(s.weight);
        const ppd = s.posts_per_day ?? 0;
        const rel = median > 0 && ppd > 0 ? ppd / median : 0;
        return (
          <div className="lib-row" key={s.id}>
            <div className="lib-head" onClick={() => setOpen(isOpen ? null : s.id)}>
              <span className="wtag">{BLABEL[b]}</span>
              <div className="nm">
                <b>{s.title}</b>
                <span>{s.kind} · {signal(s)}{s.fetch_error ? " · fetch error" : ""}</span>
              </div>
              <span className="chev">{isOpen ? "▾" : "▸"}</span>
            </div>

            {isOpen && (
              <div className="lib-expand">
                <div className="insight">
                  <b>{s.unseen_count ?? 0}</b> unseen
                  {rel >= 1.3 && <> · posts <b>{rel.toFixed(1)}×</b> your typical source</>}
                  {ppd === 0 && (s.item_count ?? 0) > 0 && <> · <b>dormant</b> (no recent posts)</>}
                  {(s.skip_pct ?? 0) > 0 && <> · you skip <b>{Math.round((s.skip_pct ?? 0) * 100)}%</b> of it</>}
                </div>

                <div className="ctl-label">Weight</div>
                <div className="wbuckets">
                  {BUCKETS.map((bk) => (
                    <button key={bk} className={`wbucket ${b === bk ? "on" : ""}`} onClick={() => setWeight(s, bk)}>
                      {BLABEL[bk]}
                    </button>
                  ))}
                </div>

                <div className="ctl-label">Per-session cap</div>
                <div className="capstep">
                  <button onClick={() => setCap(s, s.per_session_cap - 1)}>−</button>
                  <span className="val">{s.per_session_cap}</span>
                  <button onClick={() => setCap(s, s.per_session_cap + 1)}>+</button>
                </div>
                <p className="caphint">Keeps the freshest {s.per_session_cap} per session.</p>

                {feeds.length > 0 && (
                  <>
                    <div className="ctl-label">Feeds</div>
                    <div className="feed-assign">
                      {feeds.map((f) => {
                        const Ic = feedIcon(f.icon);
                        return (
                          <button
                            key={f.slug}
                            className={`fa-chip ${(s.feed_slugs ?? []).includes(f.slug) ? "on" : ""}`}
                            onClick={() => toggleFeed(s, f.slug)}
                          >
                            {Ic && <Ic size={13} strokeWidth={1.75} aria-hidden />}
                            {f.name}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                {confirmA === s.id ? (
                  <div className="confirm">
                    Archive {s.title}? It stops surfacing but keeps its history and weight.
                    <div className="lib-actions">
                      <button onClick={() => setConfirmA(null)}>Cancel</button>
                      <button onClick={() => archive(s)}>Archive</button>
                    </div>
                  </div>
                ) : confirmD === s.id ? (
                  <div className="confirm">
                    Delete {s.title} for good? This can't be undone.
                    <div className="lib-actions">
                      <button onClick={() => setConfirmD(null)}>Cancel</button>
                      <button onClick={() => remove(s)}>Delete</button>
                    </div>
                  </div>
                ) : (
                  <div className="lib-actions">
                    {s.state === "archived" ? (
                      <button onClick={() => { api.updateSource(s.id, { state: "followed" }).then(reload); }}>Unarchive</button>
                    ) : (
                      <button onClick={() => setConfirmA(s.id)}>Archive</button>
                    )}
                    <button onClick={() => setConfirmD(s.id)}>Delete</button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
        </div>
        );
      })}

      {toast && (
        <div className="toast">
          <span>{toast.msg}</span>
          {toast.undo && <button onClick={toast.undo}>Undo</button>}
        </div>
      )}

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
