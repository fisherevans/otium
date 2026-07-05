import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Feed, type Item, type Source } from "@/api/client";
import { BUCKETS, BLABEL, bucketOf, type Bucket } from "@/lib/weight";
import { feedIcon } from "@/lib/feedIcons";
import { PostsList } from "@/components/PostsList";

// Per-source freshness half-life presets (days). 0 = inherit (the source falls
// back to its feed's half-life, then the global 21d). Mirrors the feed control's
// row so the two read the same; the source override wins over the feed (#76).
const HALF_LIVES: { days: number; label: string }[] = [
  { days: 0, label: "Default" },
  { days: 7, label: "7d" },
  { days: 14, label: "14d" },
  { days: 21, label: "21d" },
  { days: 45, label: "45d" },
  { days: 90, label: "90d" },
];

// Dedicated source page (#66, supersedes the SourceDetail modal in the library).
// One page carries every management control the old sheet had - weight, per-
// session cap, feed membership, archive, visit, delete - AND the source's actual
// recent posts, so you tune it and see what it produces together. Reached by
// tapping a source in the library; also the target of the session's "Source
// details" path.
export default function SourcePage() {
  const nav = useNavigate();
  const { id } = useParams();
  const sourceId = Number(id);

  const [sources, setSources] = useState<Source[] | null>(null);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [posts, setPosts] = useState<Item[] | null>(null);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);

  // Local control state, seeded from the source and updated optimistically.
  const [bucket, setBucket] = useState<Bucket>("normal");
  const [cap, setCap] = useState(3);
  const [halfLife, setHalfLife] = useState(0);
  const [state, setState] = useState("followed");
  const [feedSlug, setFeedSlug] = useState<string>(""); // #86: a source has one feed
  const [confirmDel, setConfirmDel] = useState(false);

  const source = useMemo(
    () => (sources ? sources.find((s) => s.id === sourceId) ?? null : null),
    [sources, sourceId],
  );

  function reload() {
    api.sources().then(setSources).catch((e) => setErr(String(e.message ?? e)));
  }
  useEffect(() => {
    reload();
    api.feeds().then(setFeeds).catch(() => {});
  }, []);
  useEffect(() => {
    if (!sourceId) return;
    setLoadingPosts(true);
    api
      .sourceItems(sourceId)
      .then(setPosts)
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setLoadingPosts(false));
  }, [sourceId]);

  // Re-seed controls only when the source identity resolves, so an optimistic
  // toggle isn't stomped by the reload it triggers.
  useEffect(() => {
    if (!source) return;
    setBucket(bucketOf(source.weight));
    setCap(source.per_session_cap);
    setHalfLife(source.half_life_days ?? 0);
    setState(source.state);
    setFeedSlug(source.feed_slug ?? "");
    setConfirmDel(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id]);

  function showToast(msg: string, undo?: () => void) {
    setToast({ msg, undo });
    window.setTimeout(() => setToast((t) => (t && t.msg === msg ? null : t)), 4500);
  }

  async function setWeight(b: Bucket) {
    const prev = bucket;
    setBucket(b);
    await api.updateSource(sourceId, { weight_bucket: b }).catch(() => {});
    reload();
    if (b !== prev) {
      showToast(`${source?.title} → ${BLABEL[b]}`, async () => {
        setBucket(prev);
        await api.updateSource(sourceId, { weight_bucket: prev }).catch(() => {});
        reload();
      });
    }
  }
  async function setCapV(n: number) {
    const v = Math.max(1, n);
    setCap(v);
    await api.updateSource(sourceId, { per_session_cap: v }).catch(() => {});
    reload();
  }
  async function setHalfLifeV(days: number) {
    setHalfLife(days);
    await api.updateSource(sourceId, { half_life_days: days }).catch(() => {});
    reload();
  }
  async function setArchived(archived: boolean) {
    const next = archived ? "archived" : "followed";
    setState(next);
    await api.updateSource(sourceId, { state: next }).catch(() => {});
    reload();
    if (archived) {
      showToast(`${source?.title} archived`, async () => {
        setState("followed");
        await api.updateSource(sourceId, { state: "followed" }).catch(() => {});
        reload();
      });
    }
  }
  async function chooseFeed(slug: string) {
    // Single-feed pick (#86): tapping a feed makes it the source's one feed;
    // re-tapping the current one clears it (feedless).
    const next = feedSlug === slug ? "" : slug;
    setFeedSlug(next);
    await api.setSourceFeed(sourceId, next).catch(() => {});
    reload();
  }
  async function del() {
    await api.deleteSource(sourceId).catch(() => {});
    nav("/sources");
  }

  const back = (
    <button className="lib-back" onClick={() => nav("/sources")}>
      <span aria-hidden>←</span> Library
    </button>
  );

  if (sources && !source) {
    return (
      <div>
        {back}
        <p className="sub" style={{ padding: "16px 0" }}>That source isn't here anymore.</p>
      </div>
    );
  }
  if (!source) {
    return (
      <div>
        {back}
        {err ? <p className="err">{err}</p> : <p className="sub">Loading…</p>}
      </div>
    );
  }

  const ppd = source.posts_per_day ?? 0;
  const skip = source.skip_pct ?? 0;
  const unseen = source.unseen_count ?? 0;
  const hasStats = ppd > 0 || skip > 0 || (source.item_count ?? 0) > 0;

  return (
    <div>
      {back}
      <div className="lib-topbar">
        <h1 className="display">{source.title}</h1>
      </div>
      <div className="reader-meta" style={{ marginTop: -2 }}>
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
      {source.fetch_error && <p className="err">Fetch error: {source.fetch_error}</p>}

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
        <button onClick={() => setCapV(cap - 1)} aria-label="Fewer">−</button>
        <span className="val">{cap}</span>
        <button onClick={() => setCapV(cap + 1)} aria-label="More">+</button>
      </div>
      <p className="caphint">Keeps the freshest {cap} per session.</p>

      <div className="ctl-label">Freshness half-life</div>
      <div className="wbuckets">
        {HALF_LIVES.map((h) => (
          <button
            key={h.days}
            className={`wbucket ${halfLife === h.days ? "on" : ""}`}
            onClick={() => setHalfLifeV(h.days)}
          >
            {h.label}
          </button>
        ))}
      </div>
      <p className="caphint">
        How fast this source's items fade. Overrides the feed's half-life. Default inherits the feed, then the global 21
        days.
      </p>

      {feeds.length > 0 && (
        <>
          <div className="ctl-label">Feed</div>
          <div className="feed-assign">
            {feeds.map((f) => {
              const Ic = feedIcon(f.icon);
              return (
                <button
                  key={f.slug}
                  className={`fa-chip ${feedSlug === f.slug ? "on" : ""}`}
                  onClick={() => chooseFeed(f.slug)}
                >
                  {Ic && <Ic size={13} strokeWidth={1.75} aria-hidden />}
                  {f.name}
                </button>
              );
            })}
          </div>
          <p className="caphint">
            A source belongs to one feed. Tap a feed to move it here{feedSlug ? "; tap the current feed to clear it" : ""}.
          </p>
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
            <button onClick={() => window.open(source.homepage_url, "_blank", "noopener")}>Visit site</button>
          )}
          <button onClick={() => setConfirmDel(true)}>Delete</button>
        </div>
      )}

      <div className="page-section">
        <div className="ctl-label">Recent posts</div>
        <PostsList items={posts} loading={loadingPosts} emptyText="No posts fetched yet." />
      </div>

      {toast && (
        <div className="toast">
          <span>{toast.msg}</span>
          {toast.undo && <button onClick={toast.undo}>Undo</button>}
        </div>
      )}
    </div>
  );
}
