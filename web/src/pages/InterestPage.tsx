import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Interest, type Item, type Source } from "@/api/client";
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

// Dedicated interest page (#66). One page shows a interest's sources, its settings
// (freshness half-life / diversity / icon), and its recent posts together, so
// "here are your interests, see the sources in it and the settings for it" happens
// in one place with no hopping. Sources tap through to their own source pages
// (a source belongs to exactly one interest - #86 - so interest→sources is a clean tree).
export default function InterestPage() {
  const nav = useNavigate();
  const { slug } = useParams();

  const [interests, setInterests] = useState<Interest[] | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [posts, setPosts] = useState<Item[] | null>(null);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [err, setErr] = useState("");
  const [iconQ, setIconQ] = useState("");

  const interest = useMemo(
    () => (interests ? interests.find((f) => f.slug === slug) ?? null : null),
    [interests, slug],
  );

  function reloadInterests() {
    api.interests().then(setInterests).catch((e) => setErr(String(e.message ?? e)));
  }
  useEffect(() => {
    reloadInterests();
    api.sources().then(setSources).catch(() => {});
  }, []);
  useEffect(() => {
    if (!interest) return;
    setLoadingPosts(true);
    api
      .feedItems(interest.id)
      .then(setPosts)
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setLoadingPosts(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interest?.id]);

  // Sources belonging to this interest, weightiest first (matches the library's
  // default sort), archived last.
  const interestSources = useMemo(() => {
    if (!slug) return [];
    return sources
      .filter((s) => s.interest_slug === slug)
      .sort((a, b) => {
        const aa = a.state === "archived" ? 1 : 0;
        const ba = b.state === "archived" ? 1 : 0;
        return aa - ba || b.weight - a.weight || a.title.localeCompare(b.title);
      });
  }, [sources, slug]);

  async function setHalfLife(days: number) {
    if (!interest) return;
    await api.updateInterest(interest.id, { half_life_days: days }).catch(() => {});
    reloadInterests();
  }
  async function setDiversity(n: number) {
    if (!interest) return;
    await api.updateInterest(interest.id, { diversity: Math.max(0, Math.min(5, n)) }).catch(() => {});
    reloadInterests();
  }
  async function chooseIcon(key: string) {
    if (!interest) return;
    const next = interest.icon === key ? "" : key; // re-tap current icon to clear
    await api.updateInterest(interest.id, { icon: next }).catch(() => {});
    reloadInterests();
  }

  const back = (
    <button className="lib-back" onClick={() => nav("/sources")}>
      <span aria-hidden>←</span> Library
    </button>
  );

  if (interests && !interest) {
    return (
      <div>
        {back}
        <p className="sub" style={{ padding: "16px 0" }}>That interest doesn't exist.</p>
      </div>
    );
  }
  if (!interest) {
    return (
      <div>
        {back}
        {err ? <p className="err">{err}</p> : <p className="sub">Loading…</p>}
      </div>
    );
  }

  const HeadIc = feedIcon(interest.icon);
  const div = interest.diversity ?? 0;
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
          {interest.name}
        </h1>
      </div>
      <p className="sub">
        {interestSources.length} {interestSources.length === 1 ? "source" : "sources"} in this interest.
      </p>
      {err && <p className="err">{err}</p>}

      {/* Sources in the interest - tap through to the source page. */}
      <div className="page-section">
        <div className="ctl-label">Sources</div>
        {interestSources.length === 0 ? (
          <p className="sub" style={{ padding: "12px 0" }}>
            No sources here yet. Set a source's interest from its page's Interest control.
          </p>
        ) : (
          interestSources.map((s) => (
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

      {/* Interest settings - the ranker overrides + identity glyph. */}
      <div className="page-section">
        <div className="ctl-label">Freshness half-life</div>
        <div className="wbuckets">
          {HALF_LIVES.map((h) => (
            <button
              key={h.days}
              className={`wbucket ${(interest.half_life_days ?? 0) === h.days ? "on" : ""}`}
              onClick={() => setHalfLife(h.days)}
            >
              {h.label}
            </button>
          ))}
        </div>
        <p className="caphint">
          How fast this interest's items fade. Shorter = news; longer = evergreen. Default follows the global 21 days.
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
              className={`icon-cell ${interest.icon === d.key ? "on" : ""}`}
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

      {/* Recent posts across the interest. */}
      <div className="page-section">
        <div className="ctl-label">Recent posts</div>
        <PostsList items={posts} loading={loadingPosts} emptyText="No posts fetched yet." showSource />
      </div>
    </div>
  );
}
