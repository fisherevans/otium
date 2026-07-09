import type { CSSProperties } from "react";
import type { Item, Selected } from "@/api/client";
import { feedIcon } from "@/lib/feedIcons";
import { clock, relTime, authorRedundant } from "@/lib/format";

// CardParts holds the session card's building blocks, extracted from SessionPage
// so the Appearance live preview (#80/#90) renders from the exact same markup as
// the real card - no drift between preview and app.
//
// The card's fixed top->bottom order (#96): TopicPill -> CardSource -> Title ->
// Byline (author · date) -> Media (hero) -> Blurb -> callout buttons. The pieces
// here are that stack minus the title (a plain <h3>) and the interactive callout
// row (SessionPage-only). #90 card prefs drive size/weight/ink of the topic tag,
// source, and byline via CSS vars, so these components carry no styling props.
//
// Hero show/hide and grayscale-vs-color are driven by CSS vars
// (--pref-hero-display, --pref-hero-filter on .media / .media img).

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

// TopicPill (#96): the topic identity as a stylized pill at the top of the card -
// the one deliberately-distinctive element on an otherwise quiet surface. Icon
// (or the topic's color swatch when it has no glyph) + name, faintly tinted by the
// topic color. A topicless source (e.g. a YouTube channel) renders no pill; the
// source name then leads (CardSource's `lead` styling).
export function TopicPill({ topic }: { topic?: Selected["topic"] }) {
  if (!topic) return null;
  const Ic = feedIcon(topic.icon);
  return (
    <span className="topic-pill" style={{ "--topic-color": topic.color || "var(--ink)" } as CSSProperties}>
      {Ic ? <Ic size={13} strokeWidth={1.9} aria-hidden /> : <span className="topic-pill-dot" aria-hidden />}
      <span className="topic-pill-name">{topic.name}</span>
    </span>
  );
}

// CardSource (#96/#75): the source name (e.g. "VTDigger"). Tappable - it opens
// the source context menu and stops propagation so it doesn't also trigger the
// card-body tap-to-open. `lead` styles it as the anchor when there's no topic.
export function CardSource({ sel, onSource }: { sel: Selected; onSource: () => void }) {
  return (
    <button
      type="button"
      className={`card-source ${sel.topic ? "" : "lead"}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onSource();
      }}
    >
      {sel.source_title}
    </button>
  );
}

// Byline (#96): author before date; date is relative (relTime). Either may be
// absent - render only what exists, with a delimiter between when both are
// present. Returns null when there's neither, so the card omits the line entirely.
// #97: the separator glyph + spacing are user-tunable; the .card-dot span is empty
// and its glyph comes from `--pref-card-delim` via CSS (::before), so the delimiter
// control drives it without any prop drilling.
export function Byline({ item, sourceTitle }: { item: Item; sourceTitle?: string }) {
  const age = relTime(item.published_at || item.fetched_at);
  // #2: for YouTube the channel is both source and author, so the byline author
  // just repeats the source name above it - omit it when redundant.
  const author = authorRedundant(item.author, sourceTitle) ? "" : item.author?.trim();
  if (!author && !age) return null;
  return (
    <div className="card-byline">
      {author && <span className="card-author">{author}</span>}
      {author && age && <span className="card-dot" aria-hidden />}
      {age && <span className="card-age">{age}</span>}
    </div>
  );
}

// Blurb (#96): an enticing summary teaser (item.summary), clamped to a few lines
// in CSS - NOT the full body and NOT a bare snippet. Omitted when empty.
export function Blurb({ item }: { item: Item }) {
  const s = item.summary?.trim();
  if (!s) return null;
  return <p className="card-blurb">{s}</p>;
}
