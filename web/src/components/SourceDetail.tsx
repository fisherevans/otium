import { useEffect, useState } from "react";
import { api, type Source, type Feed } from "@/api/client";
import { BottomSheet } from "./BottomSheet";
import { BUCKETS, BLABEL, bucketOf, type Bucket } from "@/lib/weight";
import { feedIcon } from "@/lib/feedIcons";

// Source details drill-in (#43.3 / related #9). Surfaces the current item's
// source at a glance - kind, weight, cap, and whatever stats the API returned
// (skip %, posts/day, unseen) - with the same quick weight / cap / archive
// controls the library row exposes, so you can tune without leaving the session.
// Stats degrade gracefully: a source with no behavioral sample yet just omits
// the line rather than showing a fake 0%.
//
// #65: this is now also the library's drill-in (replacing the old inline
// row-expansion), so it carries everything that form did. Optional props switch
// on the library-only capabilities so the session's use of this sheet stays
// lean:
//   - `feeds`    → renders feed-membership chips (assign source to feeds).
//   - `onToast`  → weight change / archive emit an undoable toast.
//   - `onDelete` → renders a Delete action (with a confirm step); the parent
//                  handles closing + reloading after the source is gone.
export function SourceDetail({
  source,
  open,
  onClose,
  onChanged,
  feeds,
  onToast,
  onDelete,
}: {
  source: Source | null;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
  feeds?: Feed[];
  onToast?: (msg: string, undo?: () => void) => void;
  onDelete?: () => void;
}) {
  const [bucket, setBucket] = useState<Bucket>("normal");
  const [cap, setCap] = useState(3);
  const [state, setState] = useState("followed");
  const [feedSlugs, setFeedSlugs] = useState<string[]>([]);
  const [confirmDel, setConfirmDel] = useState(false);

  // Re-seed local state only when the source identity changes (opening a
  // different source), not on every parent reload - otherwise an optimistic
  // toggle would be stomped by the reload it triggers.
  useEffect(() => {
    if (!source) return;
    setBucket(bucketOf(source.weight));
    setCap(source.per_session_cap);
    setState(source.state);
    setFeedSlugs(source.feed_slugs ?? []);
    setConfirmDel(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id]);

  if (!source) return null;

  async function setWeight(b: Bucket) {
    const prev = bucket;
    setBucket(b);
    await api.updateSource(source!.id, { weight_bucket: b }).catch(() => {});
    onChanged?.();
    if (onToast && b !== prev) {
      onToast(`${source!.title} → ${BLABEL[b]}`, async () => {
        setBucket(prev);
        await api.updateSource(source!.id, { weight_bucket: prev }).catch(() => {});
        onChanged?.();
      });
    }
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
    if (onToast && archived) {
      onToast(`${source!.title} archived`, async () => {
        setState("followed");
        await api.updateSource(source!.id, { state: "followed" }).catch(() => {});
        onChanged?.();
      });
    }
  }
  async function toggleFeed(slug: string) {
    const cur = new Set(feedSlugs);
    cur.has(slug) ? cur.delete(slug) : cur.add(slug);
    const next = [...cur];
    setFeedSlugs(next);
    await api.setSourceFeeds(source!.id, next).catch(() => {});
    onChanged?.();
  }
  async function del() {
    await api.deleteSource(source!.id).catch(() => {});
    setConfirmDel(false);
    onDelete?.();
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

        {feeds && feeds.length > 0 && (
          <>
            <div className="ctl-label">Feeds</div>
            <div className="feed-assign">
              {feeds.map((f) => {
                const Ic = feedIcon(f.icon);
                return (
                  <button
                    key={f.slug}
                    className={`fa-chip ${feedSlugs.includes(f.slug) ? "on" : ""}`}
                    onClick={() => toggleFeed(f.slug)}
                  >
                    {Ic && <Ic size={13} strokeWidth={1.75} aria-hidden />}
                    {f.name}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {confirmDel ? (
          <div className="confirm">
            Delete {source.title} for good? This can't be undone.
            <div className="lib-actions">
              <button onClick={() => setConfirmDel(false)}>Cancel</button>
              <button onClick={del}>Delete</button>
            </div>
          </div>
        ) : (
          <div className="lib-actions">
            {state === "archived" ? (
              <button onClick={() => setArchived(false)}>Unarchive</button>
            ) : (
              <button onClick={() => setArchived(true)}>Archive</button>
            )}
            {source.homepage_url && (
              <button onClick={() => window.open(source.homepage_url, "_blank", "noopener")}>Visit site ↗</button>
            )}
            {onDelete && <button onClick={() => setConfirmDel(true)}>Delete</button>}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
