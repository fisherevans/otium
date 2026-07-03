import { useState } from "react";
import { api, type Feed } from "@/api/client";
import { BottomSheet } from "./BottomSheet";
import { FEED_ICONS, feedIcon } from "@/lib/feedIcons";

// The feed-icon picker (#45): pick a feed, then choose its flat identity glyph
// from a searchable grid over the registry. Persists via PATCH /feeds/{id}; no
// engagement signal - this is pure curation. Tapping the currently-set icon
// again clears it, so a feed falls back to its color swatch.
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

  return (
    <BottomSheet open={open} onClose={onClose} variant="tall" kicker="Feed icons">
      <div className="sheet-title">Feed icons</div>
      {feeds.length === 0 ? (
        <p className="caphint">Create a feed first to give it an icon.</p>
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
