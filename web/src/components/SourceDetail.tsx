import { useEffect, useState } from "react";
import { api, type Source } from "@/api/client";
import { BottomSheet } from "./BottomSheet";
import { BUCKETS, BLABEL, bucketOf, type Bucket } from "@/lib/weight";

// Source details drill-in (#43.3 / related #9). Surfaces the current item's
// source at a glance - kind, weight, cap, and whatever stats the API returned
// (skip %, posts/day, unseen) - with the same quick weight / cap / archive
// controls the library row exposes, so you can tune without leaving the session.
// Stats degrade gracefully: a source with no behavioral sample yet just omits
// the line rather than showing a fake 0%.
export function SourceDetail({
  source,
  open,
  onClose,
  onChanged,
}: {
  source: Source | null;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [bucket, setBucket] = useState<Bucket>("normal");
  const [cap, setCap] = useState(3);
  const [state, setState] = useState("followed");

  useEffect(() => {
    if (!source) return;
    setBucket(bucketOf(source.weight));
    setCap(source.per_session_cap);
    setState(source.state);
  }, [source]);

  if (!source) return null;

  async function setWeight(b: Bucket) {
    setBucket(b);
    await api.updateSource(source!.id, { weight_bucket: b }).catch(() => {});
    onChanged?.();
  }
  async function setCapV(n: number) {
    const v = Math.max(1, n);
    setCap(v);
    await api.updateSource(source!.id, { per_session_cap: v }).catch(() => {});
    onChanged?.();
  }
  async function setArchived(archived: boolean) {
    const next = archived ? "archived" : "followed";
    setState(next);
    await api.updateSource(source!.id, { state: next }).catch(() => {});
    onChanged?.();
  }

  const ppd = source.posts_per_day ?? 0;
  const skip = source.skip_pct ?? 0;
  const unseen = source.unseen_count ?? 0;
  const hasStats = ppd > 0 || skip > 0 || (source.item_count ?? 0) > 0;

  return (
    <BottomSheet open={open} onClose={onClose} variant="tall" kicker="Source">
      <div className="src-detail">
        <h3 className="reader-title">{source.title}</h3>
        <div className="reader-meta">
          <span>{source.kind}</span>
          <span>·</span>
          <span>weight {BLABEL[bucket]}</span>
          {state === "archived" && (
            <>
              <span>·</span>
              <span>archived</span>
            </>
          )}
        </div>

        {hasStats && (
          <div className="insight">
            <b>{unseen}</b> unseen
            {ppd > 0 && (
              <>
                {" "}· <b>{ppd < 1 ? ppd.toFixed(1) : Math.round(ppd)}</b>/day
              </>
            )}
            {skip > 0 && (
              <>
                {" "}· you skip <b>{Math.round(skip * 100)}%</b>
              </>
            )}
            {ppd === 0 && (source.item_count ?? 0) > 0 && (
              <>
                {" "}· <b>dormant</b>
              </>
            )}
          </div>
        )}

        <div className="ctl-label">Weight</div>
        <div className="wbuckets">
          {BUCKETS.map((b) => (
            <button key={b} className={`wbucket ${bucket === b ? "on" : ""}`} onClick={() => setWeight(b)}>
              {BLABEL[b]}
            </button>
          ))}
        </div>

        <div className="ctl-label">Per-session cap</div>
        <div className="capstep">
          <button onClick={() => setCapV(cap - 1)} aria-label="Fewer">
            −
          </button>
          <span className="val">{cap}</span>
          <button onClick={() => setCapV(cap + 1)} aria-label="More">
            +
          </button>
        </div>
        <p className="caphint">Keeps the freshest {cap} per session.</p>

        <div className="lib-actions">
          {state === "archived" ? (
            <button onClick={() => setArchived(false)}>Unarchive</button>
          ) : (
            <button onClick={() => setArchived(true)}>Archive</button>
          )}
          {source.homepage_url && (
            <button onClick={() => window.open(source.homepage_url, "_blank", "noopener")}>Visit site ↗</button>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
