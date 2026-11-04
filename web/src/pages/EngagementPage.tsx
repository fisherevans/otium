import { ArrowLeft, ChevronRight, Heart, ThumbsDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBack } from "@/lib/navigation";
import { api, type EngagementReport, type EngagementRow } from "@/api/client";
import { PlatformMark } from "@/components/PlatformMark";
import "./engagement.css";

// Engagement (#196): what happened when each channel (or tag) came up over a
// period - shown, opened, skipped at once, how much of its videos you watched,
// likes and dislikes, shares and saves. For deciding what to keep following, so
// a channel row links to the source page where its representation and follow
// live. Descriptive only: no score, no streaks, and nothing here changes a
// session.

const RANGES = [7, 30, 90] as const;
const SORTS = [
  { key: "shown", label: "Most shown" },
  { key: "skipped", label: "Most skipped" },
  { key: "liked", label: "Most liked" },
] as const;
type Sort = (typeof SORTS)[number]["key"];

function sortRows(rows: EngagementRow[], sort: Sort): EngagementRow[] {
  const by: Record<Sort, (r: EngagementRow) => number> = {
    shown: (r) => r.shown,
    // Share of views gone at once, then dislikes; a channel shown once is not a pattern.
    skipped: (r) => (r.shown >= 3 ? r.instant_skips / r.shown : 0) * 1000 + r.dislikes,
    liked: (r) => r.likes * 1000 + r.shares * 10 + r.saves,
  };
  return [...rows].sort((a, b) => by[sort](b) - by[sort](a) || b.shown - a.shown);
}

function minutes(m: number): string {
  if (m < 1) return `${Math.round(m * 60)}s`;
  if (m < 60) return `${Math.round(m)} min`;
  return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
}

function facts(r: EngagementRow): string[] {
  const out = [`${r.shown} shown`];
  if (r.opened) out.push(`${r.opened} opened`);
  if (r.instant_skips) out.push(`${r.instant_skips} skipped at once`);
  if (r.median_watch !== undefined) out.push(`watched ${Math.round(r.median_watch * 100)}% typically`);
  if (r.completed) out.push(`${r.completed} finished`);
  if (r.active_min >= 0.1) out.push(`${minutes(r.active_min)} reading or watching`);
  if (r.shares) out.push(`${r.shares} shared`);
  if (r.saves) out.push(`${r.saves} saved`);
  return out;
}

export default function EngagementPage() {
  const back = useBack("/you");
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const days = RANGES.find((d) => String(d) === params.get("days")) ?? 30;
  const by = params.get("by") === "tag" ? "tag" : "source";
  const sort = (SORTS.find((s) => s.key === params.get("sort"))?.key ?? "shown") as Sort;
  const [rep, setRep] = useState<EngagementReport | null>(null);
  const [err, setErr] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setErr("");
    api.engagement(days, by).then((r) => { if (!cancelled) setRep(r); })
      .catch((e) => { if (!cancelled) setErr(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [days, by, retry]);

  const rows = useMemo(() => (rep && rep.by === by ? sortRows(rep.rows, sort) : null), [rep, by, sort]);
  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  }

  return (
    <div className="engagement-page">
      <button className="lib-back" onClick={back}>
        <ArrowLeft size={18} className="inline-icon" aria-hidden /> Back
      </button>
      <div className="lib-topbar">
        <h1 className="display">Engagement</h1>
      </div>
      <p className="sub">What you did when each {by === "tag" ? "tag" : "channel"} came up. For deciding what to keep.</p>

      <div className="lib-filter" role="group" aria-label="Period">
        {RANGES.map((d) => (
          <button key={d} className={`lib-fchip ${days === d ? "on" : ""}`} aria-pressed={days === d} onClick={() => set("days", String(d))}>
            {d} days
          </button>
        ))}
      </div>
      <div className="lib-filter" role="group" aria-label="Group by">
        <button className={`lib-fchip ${by === "source" ? "on" : ""}`} aria-pressed={by === "source"} onClick={() => set("by", "source")}>Channels</button>
        <button className={`lib-fchip ${by === "tag" ? "on" : ""}`} aria-pressed={by === "tag"} onClick={() => set("by", "tag")}>Tags</button>
      </div>
      <div className="lib-filter" role="group" aria-label="Order">
        {SORTS.map((s) => (
          <button key={s.key} className={`lib-fchip ${sort === s.key ? "on" : ""}`} aria-pressed={sort === s.key} onClick={() => set("sort", s.key)}>
            {s.label}
          </button>
        ))}
      </div>

      {err && <div><p className="err" role="alert">{err}</p><button className="btn ghost" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>}
      {!rows && !err && <p className="sub" role="status">Loading…</p>}
      {rows && rows.length === 0 && (
        <p className="sub">Nothing recorded in the last {days} days yet. Views are recorded from sessions as you use them.</p>
      )}
      {rows && rows.length > 0 && (
        <ul className="eng-list">
          {rows.map((r) => {
            const body = (
              <>
                <span className="eng-name">
                  {r.label || "Removed source"}
                  {r.kind && <PlatformMark kind={r.kind} size={12} />}
                </span>
                <span className="eng-facts">{facts(r).join(" · ")}</span>
                {(r.likes > 0 || r.dislikes > 0) && (
                  <span className="eng-signals">
                    {r.likes > 0 && <span><Heart size={14} fill="currentColor" aria-hidden /> {r.likes} liked</span>}
                    {r.dislikes > 0 && <span><ThumbsDown size={14} aria-hidden /> {r.dislikes} didn't like</span>}
                  </span>
                )}
              </>
            );
            const source = by === "source" && r.kind ? Number(r.key) : 0;
            return (
              <li key={r.key}>
                {source ? (
                  <button className="eng-row" onClick={() => nav(`/sources/${source}`)}>
                    <span className="eng-copy">{body}</span>
                    <ChevronRight size={18} className="inline-icon" aria-hidden />
                  </button>
                ) : (
                  <div className="eng-row"><span className="eng-copy">{body}</span></div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
