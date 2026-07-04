import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Feed, type Item, type Source } from "@/api/client";
import { BLABEL, bucketOf } from "@/lib/weight";
import { FEED_ICONS, feedIcon } from "@/lib/feedIcons";
import { PostsList } from "@/components/PostsList";

// Freshness half-life presets (days). 0 = the global default (ranker uses 21d),
// so that preset reads as the neutral middle. Mirrors FeedIconPicker.
const HALF_LIVES: { days: number; label: string }[] = [
  { days: 0, label: "Default" },
  { days: 7, label: "7d" },
  { days: 14, label: "14d" },
  { days: 21, label: "21d" },
  { days: 45, label: "45d" },
  { days: 90, label: "90d" },
];

// Dedicated feed page (#66). One page shows a feed's sources, its settings
// (freshness half-life / diversity / icon), and its recent posts together, so
// "here are your feeds, see the sources in it and the settings for it" happens
// in one place with no hopping. Sources tap through to their own source pages
// (a source can be in several feeds - that's why feed→sources is the grouping).
export default function FeedPage() {
  const nav = useNavigate();
  const { slug } = useParams();

  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [posts, setPosts] = useState<Item[] | null>(null);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [err, setErr] = useState("");
  const [iconQ, setIconQ] = useState("");

  const feed = useMemo(
    () => (feeds ? feeds.find((f) => f.slug === slug) ?? null : null),
    [feeds, slug],
  );

  function reloadFeeds() {
    api.feeds().then(setFeeds).catch((e) => setErr(String(e.message ?? e)));
  }
  useEffect(() => {
    reloadFeeds();
    api.sources().then(setSources).catch(() => {});
  }, []);
  useEffect(() => {
    if (!feed) return;
    setLoadingPosts(true);
    api
      .feedItems(feed.id)
      .then(setPosts)
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setLoadingPosts(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed?.id]);

  // Sources belonging to this feed, weightiest first (matches the library's
  // default sort), archived last.
  const feedSources = useMemo(() => {
    if (!slug) return [];
    return sources
      .filter((s) => (s.feed_slugs ?? []).includes(slug))
      .sort((a, b) => {
        const aa = a.state === "archived" ? 1 : 0;
        const ba = b.state === "archived" ? 1 : 0;
        return aa - ba || b.weight - a.weight || a.title.localeCompare(b.title);
      });
  }, [sources, slug]);

  async function setHalfLife(days: number) {
    if (!feed) return;
    await api.updateFeed(feed.id, { half_life_days: days }).catch(() => {});
    reloadFeeds();
  }
  async function setDiversity(n: number) {
    if (!feed) return;
    await api.updateFeed(feed.id, { diversity: Math.max(0, Math.min(5, n)) }).catch(() => {});
    reloadFeeds();
  }
  async function chooseIcon(key: string) {
    if (!feed) return;
    const next = feed.icon === key ? "" : key; // re-tap current icon to clear
    await api.updateFeed(feed.id, { icon: next }).catch(() => {});
    reloadFeeds();
  }

  const back = (
    <button className="lib-back" onClick={() => nav("/sources")}>
      <span aria-hidden>←</span> Library
    </button>
  );

  if (feeds && !feed) {
    return (
      <div>
        {back}
        <p className="sub" style={{ padding: "16px 0" }}>That feed doesn't exist.</p>
      </div>
    );
  }
  if (!feed) {
    return (
      <div>
        {back}
        {err ? <p className="err">{err}</p> : <p className="sub">Loading…</p>}
      </div>
    );
  }

  const HeadIc = feedIcon(feed.icon);
  const div = feed.diversity ?? 0;
  const query = iconQ.trim().toLowerCase();
  const shownIcons = query
    ? FEED_ICONS.filter((d) => d.label.toLowerCase().includes(query) || d.key.includes(query))
    : FEED_ICONS;

  return (
    <div>
      {back}
      <div className="lib-topbar">
        <h1 className="display">
          {HeadIc && <HeadIc size={22} strokeWidth={1.75} aria-hidden style={{ verticalAlign: "-3px", marginRight: 8 }} />}
          {feed.name}
        </h1>
      </div>
      <p className="sub">
        {feedSources.length} {feedSources.length === 1 ? "source" : "sources"} in this feed.
      </p>
      {err && <p className="err">{err}</p>}

      {/* Sources in the feed - tap through to the source page. */}
      <div className="page-section">
        <div className="ctl-label">Sources</div>
        {feedSources.length === 0 ? (
          <p className="sub" style={{ padding: "12px 0" }}>
            No sources here yet. Add one from a source page's Feeds control.
          </p>
        ) : (
          feedSources.map((s) => (
            <div className="lib-row" key={s.id}>
              <div className="lib-head" onClick={() => nav(`/sources/${s.id}`)}>
                <span className="wtag">{BLABEL[bucketOf(s.weight)]}</span>
                <div className="nm">
                  <b>{s.title}</b>
                  <span>
                    {s.kind} · {s.unseen_count ?? 0} unseen
                    {s.state === "archived" ? " · archived" : ""}
                  </span>
                </div>
                <span className="chev">▸</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Feed settings - the ranker overrides + identity glyph. */}
      <div className="page-section">
        <div className="ctl-label">Freshness half-life</div>
        <div className="wbuckets">
          {HALF_LIVES.map((h) => (
            <button
              key={h.days}
              className={`wbucket ${(feed.half_life_days ?? 0) === h.days ? "on" : ""}`}
              onClick={() => setHalfLife(h.days)}
            >
              {h.label}
            </button>
          ))}
        </div>
        <p className="caphint">
          How fast this feed's items fade. Shorter = news; longer = evergreen. Default follows the global 21 days.
        </p>

        <div className="ctl-label">Diversity</div>
        <div className="capstep">
          <button onClick={() => setDiversity(div - 1)} aria-label="Less">−</button>
          <span className="val">{div === 0 ? "Default" : div}</span>
          <button onClick={() => setDiversity(div + 1)} aria-label="More">+</button>
        </div>
        <p className="caphint">
          {div === 0
            ? "Each source uses its own per-session cap."
            : `At most ${div} item${div === 1 ? "" : "s"} per source each session — lower spreads across more sources.`}
        </p>

        <div className="ctl-label">Icon</div>
        <input
          className="field"
          placeholder="Search icons…"
          value={iconQ}
          onChange={(e) => setIconQ(e.target.value)}
        />
        <div className="icon-grid">
          {shownIcons.map((d) => (
            <button
              key={d.key}
              className={`icon-cell ${feed.icon === d.key ? "on" : ""}`}
              title={d.label}
              aria-label={d.label}
              onClick={() => chooseIcon(d.key)}
            >
              <d.Icon size={20} strokeWidth={1.75} aria-hidden />
            </button>
          ))}
          {shownIcons.length === 0 && <p className="caphint">No icons match “{iconQ}”.</p>}
        </div>
        <p className="caphint">Tap the current icon again to clear it (falls back to the color swatch).</p>
      </div>

      {/* Recent posts across the feed. */}
      <div className="page-section">
        <div className="ctl-label">Recent posts</div>
        <PostsList items={posts} loading={loadingPosts} emptyText="No posts fetched yet." showSource />
      </div>
    </div>
  );
}
