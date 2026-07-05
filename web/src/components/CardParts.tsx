import type { Item, Selected } from "@/api/client";
import { feedIcon } from "@/lib/feedIcons";
import { clock, mins, relTime } from "@/lib/format";

// CardParts holds the session card's building blocks (media, date, identity),
// extracted from SessionPage so the Appearance live preview (#80) renders from
// the exact same markup as the real card - no drift between preview and app.
//
// Hero show/hide and grayscale-vs-color are driven entirely by CSS vars
// (--pref-hero-display, --pref-hero-filter on .media / .media img), so these
// components carry no appearance props: the preview and the app both reflow from
// whatever is on :root (or an overriding preview scope).

// Media preview, rendered as e-ink: real thumbnail (grayscaled) when we have one,
// otherwise a dithered placeholder, with the right aspect + affordances per type.
export function Media({ item }: { item: Item }) {
  const t = item.media_type;
  if (t === "audio") {
    return (
      <div className="wave" aria-label="audio">
        {Array.from({ length: 40 }, (_, i) => (
          <i key={i} style={{ height: `${20 + Math.abs(Math.sin(i * 1.7)) * 60}%` }} />
        ))}
      </div>
    );
  }
  if (t === "short" || t === "long" || t === "live") {
    const vertical = t === "short";
    return (
      <div className={`media ${vertical ? "v" : "h"}`}>
        {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" loading="lazy" /> : <div className="dither" />}
        <div className="dither" />
        <div className="play" />
        {item.duration_sec > 0 && <span className="dur">{clock(item.duration_sec)}</span>}
      </div>
    );
  }
  if (t === "article" && item.thumbnail_url) {
    return (
      <div className="media h">
        <img src={item.thumbnail_url} alt="" loading="lazy" />
        <div className="dither" />
      </div>
    );
  }
  return null; // quote / plain text: no media
}

// The prominent date above the hero (#73). The item's relative age reads first,
// larger and clearer than the mono identity line, so "when" lands at a glance
// before the media. relTime returns "" for a missing stamp, in which case we
// omit the cue rather than fabricate one.
export function CardDate({ item }: { item: Item }) {
  const age = relTime(item.published_at || item.fetched_at);
  if (!age) return null;
  return <div className="card-date">{age}</div>;
}

// The card's identity line (#44/#48): feed as the emphasized anchor (icon +
// name), then the source and the media descriptor. The source name is tappable
// (#75): it opens the source context menu, and stops propagation so it doesn't
// also trigger the card-body tap-to-open. A feedless source (e.g. YouTube) has
// no feed ref, so the line degrades to source-only. Icons inherit ink via
// currentColor; when a feed has no icon set we fall back to its color swatch.
export function Identity({ sel, onSource }: { sel: Selected; onSource: () => void }) {
  const f = sel.feed;
  const Ic = feedIcon(f?.icon);
  const type = sel.item.media_type === "audio" ? mins(sel.item.duration_sec || sel.est_duration_sec) : sel.item.media_type;
  return (
    <div className="identity">
      {f && (
        <span className="id-feed">
          {Ic ? (
            <Ic size={15} strokeWidth={1.75} aria-hidden />
          ) : (
            <span className="id-swatch" style={{ background: f.color || "var(--ink-mute)" }} />
          )}
          <span className="id-feed-name">{f.name}</span>
        </span>
      )}
      <button
        type="button"
        className={f ? "id-source" : "id-source lead"}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onSource();
        }}
      >
        {sel.source_title}
      </button>
      {type && <span className="id-type">{type}</span>}
    </div>
  );
}
