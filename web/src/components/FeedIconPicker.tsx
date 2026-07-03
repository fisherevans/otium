import { useState } from "react";
import { api, type Feed } from "@/api/client";
import { BottomSheet } from "./BottomSheet";
import { FEED_ICONS, feedIcon } from "@/lib/feedIcons";

// Freshness half-life presets (days). 0 = use the global default; the ranker's
// global is 21d (three weeks), so that preset reads as the neutral middle.
const HALF_LIVES: { days: number; label: string }[] = [
  { days: 0, label: "Default" },
  { days: 7, label: "7d" },
  { days: 14, label: "14d" },
  { days: 21, label: "21d" },
  { days: 45, label: "45d" },
  { days: 90, label: "90d" },
];

// The feed-settings sheet (#45 icons, #17 ranker overrides): pick a feed, then
// tune its freshness half-life, diversity, and identity glyph. Persists via
// PATCH /feeds/{id}; no engagement signal - this is pure curation. Tapping the
// currently-set icon again clears it, so a feed falls back to its color swatch.
export function FeedIconPicker({
  feeds,
  open,
  onClose,
  onChanged,
}: {
  feeds: Feed[];
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [feedId, setFeedId] = useState<number | null>(null);
  const [q, setQ] = useState("");

  const active = feeds.find((f) => f.id === feedId) ?? feeds[0] ?? null;
  const query = q.trim().toLowerCase();
  const shown = query
    ? FEED_ICONS.filter((d) => d.label.toLowerCase().includes(query) || d.key.includes(query))
    : FEED_ICONS;

  async function choose(key: string) {
    if (!active) return;
    const next = active.icon === key ? "" : key; // re-tap the current icon to clear
    await api.updateFeed(active.id, { icon: next }).catch(() => {});
    onChanged();
  }
  async function setHalfLife(days: number) {
    if (!active) return;
    await api.updateFeed(active.id, { half_life_days: days }).catch(() => {});
    onChanged();
  }
  async function setDiversity(n: number) {
    if (!active) return;
    await api.updateFeed(active.id, { diversity: Math.max(0, Math.min(5, n)) }).catch(() => {});
    onChanged();
  }

  const div = active?.diversity ?? 0;

  return (
    <BottomSheet open={open} onClose={onClose} variant="tall" kicker="Feed settings">
      <div className="sheet-title">Feed settings</div>
      {feeds.length === 0 ? (
        <p className="caphint">Create a feed first to tune it.</p>
      ) : (
        <>
          <div className="ctl-label">Feed</div>
          <div className="feed-assign">
            {feeds.map((f) => {
              const Ic = feedIcon(f.icon);
              return (
                <button
                  key={f.id}
                  className={`fa-chip ${active?.id === f.id ? "on" : ""}`}
                  onClick={() => setFeedId(f.id)}
                >
                  {Ic && <Ic size={13} strokeWidth={1.75} aria-hidden />}
                  {f.name}
                </button>
              );
            })}
          </div>

          <div className="ctl-label">Freshness half-life{active ? ` · ${active.name}` : ""}</div>
          <div className="wbuckets">
            {HALF_LIVES.map((h) => (
              <button
                key={h.days}
                className={`wbucket ${(active?.half_life_days ?? 0) === h.days ? "on" : ""}`}
                onClick={() => setHalfLife(h.days)}
              >
                {h.label}
              </button>
            ))}
          </div>
          <p className="caphint">How fast this feed's items fade. Shorter = news; longer = evergreen. Default follows the global 21 days.</p>

          <div className="ctl-label">Diversity</div>
          <div className="capstep">
            <button onClick={() => setDiversity(div - 1)}>−</button>
            <span className="val">{div === 0 ? "Default" : div}</span>
            <button onClick={() => setDiversity(div + 1)}>+</button>
          </div>
          <p className="caphint">
            {div === 0
              ? "Each source uses its own per-session cap."
              : `At most ${div} item${div === 1 ? "" : "s"} per source each session — lower spreads across more sources.`}
          </p>

          <div className="ctl-label">Icon{active ? ` · ${active.name}` : ""}</div>
          <input
            className="field"
            placeholder="Search icons…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="icon-grid">
            {shown.map((d) => (
              <button
                key={d.key}
                className={`icon-cell ${active?.icon === d.key ? "on" : ""}`}
                title={d.label}
                aria-label={d.label}
                onClick={() => choose(d.key)}
              >
                <d.Icon size={20} strokeWidth={1.75} aria-hidden />
              </button>
            ))}
            {shown.length === 0 && <p className="caphint">No icons match “{q}”.</p>}
          </div>
          <p className="caphint">Tap the current icon again to clear it (falls back to the color swatch).</p>
        </>
      )}
    </BottomSheet>
  );
}
