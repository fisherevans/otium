import { useEffect, useMemo, useState } from "react";
import { api, type Topic, type InsightsResponse, type InsightsSource } from "@/api/client";
import { BUCKETS, REP_BLABEL, bucketOf, type Bucket } from "@/lib/represent";
import { feedIcon } from "@/lib/feedIcons";
import { BottomSheet } from "@/components/BottomSheet";

// The insights view (#49): each source's live effective share of the topic, paired
// with how much of it you skip. A source that is a big slice you mostly skip is
// the prune candidate. Read-only insight - the only writes are the explicit
// weight/archive actions from a row.

type Sort = "share" | "inefficiency";

// A source counts as a prune candidate when it is a meaningful slice of the topic
// AND you skip most of it. Kept deliberately subtle (no alarm) per EXPERIENCE.
const PRUNE_SHARE = 0.05;
const PRUNE_SKIP = 0.5;

// Grayscale ramp for the donut, dark -> light. Single-ink; slices are told apart
// by shade + a labelled legend, never by hue.
const SHADES = ["#1a1815", "#3c372f", "#5c554a", "#7d7566", "#9d9585", "#bcb4a2", "#d5cdba"];
const OTHER_SHADE = "#e2dccb";

function pct(x: number): string {
  if (x <= 0) return "0%";
  if (x < 0.01) return "<1%";
  return `${Math.round(x * 100)}%`;
}

// donutArc returns an SVG path for one ring segment between two angles (radians).
function donutArc(cx: number, cy: number, rO: number, rI: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0 = cx + rO * Math.cos(a0);
  const y0 = cy + rO * Math.sin(a0);
  const x1 = cx + rO * Math.cos(a1);
  const y1 = cy + rO * Math.sin(a1);
  const xi1 = cx + rI * Math.cos(a1);
  const yi1 = cy + rI * Math.sin(a1);
  const xi0 = cx + rI * Math.cos(a0);
  const yi0 = cy + rI * Math.sin(a0);
  return `M${x0} ${y0} A${rO} ${rO} 0 ${large} 1 ${x1} ${y1} L${xi1} ${yi1} A${rI} ${rI} 0 ${large} 0 ${xi0} ${yi0} Z`;
}

interface Slice {
  label: string;
  share: number;
  shade: string;
}

function Donut({ sources }: { sources: InsightsSource[] }) {
  const top = sources.slice(0, 6);
  const rest = sources.slice(6);
  const slices: Slice[] = top.map((s, i) => ({
    label: s.source_title,
    share: s.effective_share,
    shade: SHADES[i] ?? SHADES[SHADES.length - 1],
  }));
  const otherShare = rest.reduce((a, s) => a + s.effective_share, 0);
  if (otherShare > 0.0001) slices.push({ label: `${rest.length} more`, share: otherShare, shade: OTHER_SHADE });

  const total = slices.reduce((a, s) => a + s.share, 0);
  const size = 150;
  const cx = size / 2;
  const cy = size / 2;
  const rO = 66;
  const rI = 40;

  // A single slice covering the whole ring can't be drawn as an arc; render it
  // as a plain ring instead.
  const single = slices.length === 1;

  let a = -Math.PI / 2;
  const paths = single
    ? []
    : slices.map((s) => {
        const frac = total > 0 ? s.share / total : 0;
        const a0 = a;
        const a1 = a + frac * Math.PI * 2;
        a = a1;
        return { d: donutArc(cx, cy, rO, rI, a0, Math.max(a0 + 0.0001, a1 - 0.012)), shade: s.shade };
      });

  return (
    <div className="insights-donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Topic share by source">
        {single ? (
          <circle cx={cx} cy={cy} r={(rO + rI) / 2} fill="none" stroke={slices[0].shade} strokeWidth={rO - rI} />
        ) : (
          paths.map((p, i) => <path key={i} d={p.d} fill={p.shade} stroke="var(--paper)" strokeWidth={1} />)
        )}
      </svg>
      <ul className="insights-legend">
        {slices.map((s, i) => (
          <li key={i}>
            <span className="insights-swatch" style={{ background: s.shade }} aria-hidden />
            <span className="insights-legend-nm">{s.label}</span>
            <span className="insights-legend-pct">{pct(s.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function InsightsPage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [scope, setScope] = useState<string | null>(null); // null = all topics; else topic slug
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [sort, setSort] = useState<Sort>("share");
  const [err, setErr] = useState("");
  const [sheet, setSheet] = useState<InsightsSource | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function load() {
    api
      .insights(scope ?? undefined)
      .then(setData)
      .catch((e) => setErr(String(e.message ?? e)));
  }
  useEffect(() => {
    api.topics().then(setTopics).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const sources = useMemo(() => {
    const list = [...(data?.sources ?? [])];
    if (sort === "inefficiency") {
      // Inefficiency = how big it wants to be × how much you reject it. Uses
      // intended_share (before the skip penalty self-suppresses) so a wanted-but-
      // skipped source rises to the top.
      list.sort((a, b) => b.intended_share * b.skip_pct - a.intended_share * a.skip_pct);
    } else {
      list.sort((a, b) => b.effective_share - a.effective_share);
    }
    return list;
  }, [data, sort]);

  // Bar axis: scale to the largest share on screen so the ranking reads clearly;
  // the printed % carries the absolute value.
  const maxShare = useMemo(
    () => Math.max(0.0001, ...sources.map((s) => Math.max(s.effective_share, s.intended_share))),
    [sources],
  );

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  }

  async function setWeight(s: InsightsSource, bucket: Bucket) {
    await api.updateSource(s.source_id, { weight_bucket: bucket }).catch(() => {});
    setSheet(null);
    showToast(`${s.source_title} → ${REP_BLABEL[bucket]}`);
    load();
  }
  async function archive(s: InsightsSource) {
    await api.updateSource(s.source_id, { state: "archived" }).catch(() => {});
    setSheet(null);
    showToast(`${s.source_title} archived`);
    load();
  }

  const isPrune = (s: InsightsSource) => s.effective_share >= PRUNE_SHARE && s.skip_pct >= PRUNE_SKIP;

  return (
    <div>
      <h1 className="display">Topic insights</h1>
      <p className="sub">
        What each source actually is in your topic right now, next to how much of it you skip. A big slice you mostly
        skip is worth turning down.
      </p>

      {/* scope: all topics <-> within one topic */}
      <div className="lib-filter">
        <button className={`lib-fchip ${!scope ? "on" : ""}`} onClick={() => setScope(null)}>
          All topics
        </button>
        {topics.map((f) => {
          const Ic = feedIcon(f.icon);
          return (
            <button key={f.slug} className={`lib-fchip ${scope === f.slug ? "on" : ""}`} onClick={() => setScope(f.slug)}>
              {Ic && <Ic size={13} strokeWidth={1.75} aria-hidden />}
              {f.name}
            </button>
          );
        })}
      </div>

      {err && <p className="err">{err}</p>}

      {data && sources.length === 0 && (
        <p className="insights-empty">No live content in this scope yet. Fetch some sources, then check back.</p>
      )}

      {sources.length > 0 && (
        <>
          <Donut sources={sources} />

          <div className="lib-sub">
            {(["share", "inefficiency"] as const).map((s) => (
              <button key={s} className={`lib-seg ${sort === s ? "on" : ""}`} onClick={() => setSort(s)}>
                {s === "share" ? "by share" : "by inefficiency"}
              </button>
            ))}
            <span className="lib-count">{data?.totals.source_count ?? 0} sources</span>
          </div>

          <div className="insights-list">
            {sources.map((s) => {
              const Ic = feedIcon(s.topic?.icon);
              const prune = isPrune(s);
              const fillW = (s.effective_share / maxShare) * 100;
              // The "ghost" extension shows where the source *wants* to be (intended)
              // when the skip penalty has dragged its effective share below that -
              // the visible gap is what skipping costs it.
              const ghost = s.intended_share > s.effective_share * 1.15;
              const ghostW = ghost ? (Math.min(s.intended_share, maxShare) / maxShare) * 100 - fillW : 0;
              return (
                <button className={`insights-row ${prune ? "prune" : ""}`} key={s.source_id} onClick={() => setSheet(s)}>
                  <div className="insights-row-top">
                    <span className="insights-ico" aria-hidden>
                      {Ic ? <Ic size={15} strokeWidth={1.75} /> : <span className="insights-dot" />}
                    </span>
                    <span className="insights-name">{s.source_title}</span>
                    <span className="insights-share">{pct(s.effective_share)}</span>
                  </div>
                  <div className="insights-bar">
                    <div className="insights-fill" style={{ width: `${fillW}%` }} />
                    {ghostW > 0.5 && <div className="insights-ghost" style={{ left: `${fillW}%`, width: `${ghostW}%` }} />}
                  </div>
                  <div className="insights-meta">
                    <span>{s.item_count} items</span>
                    <span>·</span>
                    <span>{pct(s.skip_pct)} skip</span>
                    {ghost && (
                      <>
                        <span>·</span>
                        <span className="insights-wants">wants {pct(s.intended_share)}</span>
                      </>
                    )}
                    {prune && <span className="insights-prune-tag">prune?</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      <BottomSheet open={!!sheet} onClose={() => setSheet(null)} kicker={sheet?.source_title}>
        {sheet && (
          <div className="insights-sheet">
            <div className="insight">
              <b>{pct(sheet.effective_share)}</b> of your topic
              {sheet.intended_share > sheet.effective_share * 1.15 && (
                <>
                  {" "}
                  · wants <b>{pct(sheet.intended_share)}</b>
                </>
              )}
              {sheet.skip_pct > 0 && (
                <>
                  {" "}
                  · you skip <b>{pct(sheet.skip_pct)}</b> of it
                </>
              )}
            </div>

            <div className="ctl-label">Representation</div>
            <div className="repbuckets">
              {BUCKETS.map((bk) => (
                <button
                  key={bk}
                  className={`repbucket ${bucketOf(sheet.weight) === bk ? "on" : ""}`}
                  onClick={() => setWeight(sheet, bk)}
                >
                  {REP_BLABEL[bk]}
                </button>
              ))}
            </div>

            <div className="lib-actions">
              <button onClick={() => archive(sheet)}>Archive</button>
            </div>
          </div>
        )}
      </BottomSheet>

      {toast && (
        <div className="toast">
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
