import { forwardRef, type PointerEvent as ReactPointerEvent } from "react";
import { Bookmark, BookOpen, Play, ExternalLink } from "lucide-react";
import type { Item, ItemRender, Selected } from "@/api/client";
import { TopicPill, CardSource, Byline, Blurb, Media } from "@/components/CardParts";
import { InlineMedia } from "@/components/InlineMedia";
import { ShareActions } from "@/components/ReaderActions";
import { isMedia, isVertical } from "@/lib/render";

// SessionCard is one item in the session reel, lifted out of SessionPage so the
// layout lab (`/lab`) renders the EXACT card the session renders - same markup,
// same classes, same components. It follows CardParts' rule: if a surface shows a
// card, it shows this one, so a preview can never drift from the real thing.
//
// It is presentational. Every behaviour (advance, open, save, the source sheet)
// arrives as a prop, so the lab can pass no-ops and still get a truthful render.
//
// Fixed top->bottom order (#96): TopicPill -> CardSource -> Title -> Byline ->
// Hero -> Blurb -> callout. On the focused card, media plays inline and owns its
// own action row; off-screen cards stay lightweight thumbnails.

export interface SessionCardProps {
  sel: Selected;
  /** Index in the reel; used for the data-idx hook the observer reads. */
  index: number;
  /** The focused card gets the inline player and the interactive callout row. */
  focused: boolean;
  /** Synchronous render guess for this item (drives the primary action). */
  render: ItemRender;
  onOpenContent: (sel: Selected) => void;
  onOpenExternal: (sel: Selected) => void;
  onSave: (sel: Selected) => void;
  onSource: (sel: Selected) => void;
  onMenu: () => void;
  onFirstPlay?: (sel: Selected) => void;
  onNext?: () => void;
  onPrev?: () => void;
  ytHistory?: boolean;
  onPointerDown?: (e: ReactPointerEvent) => void;
  onPointerMove?: (e: ReactPointerEvent) => void;
  onPointerUp?: (e: ReactPointerEvent) => void;
  onClick?: () => void;
}

// The primary callout per render state (#96): label + icon + action. Exported so
// the lab can label a variant without duplicating the rule.
export function primaryFor(
  item: Item,
  render: ItemRender,
): { label: string; Icon: typeof BookOpen; action: "content" | "external" } {
  if (render === "full_text") return { label: "Read", Icon: BookOpen, action: "content" };
  if (item.media_type === "short" || item.media_type === "long" || item.media_type === "live")
    return { label: "Watch", Icon: Play, action: "content" };
  if (item.media_type === "audio") return { label: "Listen", Icon: Play, action: "content" };
  return { label: "Open original", Icon: ExternalLink, action: "external" };
}

export const SessionCard = forwardRef<HTMLDivElement, SessionCardProps>(function SessionCard(
  {
    sel,
    index,
    focused,
    render,
    onOpenContent,
    onOpenExternal,
    onSave,
    onSource,
    onMenu,
    onFirstPlay,
    onNext,
    onPrev,
    ytHistory,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onClick,
  },
  ref,
) {
  const it = sel;
  const primary = primaryFor(it.item, render);
  // Media on the focused card plays inline (no modal); off-screen cards stay
  // lightweight thumbnails. A vertical frame gets the compact chrome layout.
  const activeMedia = focused && isMedia(it.item);
  const vert = activeMedia && isVertical(it.item);
  const audioCard = activeMedia && it.item.media_type === "audio";

  return (
    <div
      className={`snap ${focused ? "" : "away"} ${activeMedia ? "media-card" : ""} ${vert ? "vertical" : ""} ${audioCard ? "audio-card" : ""}`}
      data-idx={index}
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
      role="link"
    >
      {/* Quiet reason line (de-noised, no box) + the ··· overflow. */}
      <div className="card-top" onClick={(e) => e.stopPropagation()}>
        {it.reason && <span className="reason">{it.reason}</span>}
        {focused && (
          <button
            className="item-more"
            onClick={(e) => {
              e.stopPropagation();
              onMenu();
            }}
            aria-label="More actions"
          >
            ···
          </button>
        )}
      </div>

      <TopicPill topic={it.topic} />
      <CardSource sel={it} onSource={() => onSource(it)} />
      <h3 className="card-title">{it.item.title}</h3>
      <Byline item={it.item} sourceTitle={it.source_title} />

      {activeMedia ? (
        // The focused media card: the player is embedded and paused (one tap to
        // play), sized by real aspect ratio; it owns its own action row.
        <div
          className="card-media"
          // #149: fully isolate the media area from the card's swipe/tap handlers.
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <InlineMedia
            item={it.item}
            onSave={() => onSave(it)}
            onOpenOriginal={() => onOpenExternal(it)}
            onFirstPlay={() => onFirstPlay?.(it)}
            onNext={onNext}
            onPrev={onPrev}
            ytHistory={ytHistory}
          />
        </div>
      ) : (
        <>
          <Media item={it.item} />
          <Blurb item={it.item} />
        </>
      )}

      {focused && !isMedia(it.item) && (
        <div className="card-callout" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <button
            className="callout-primary"
            onClick={() => (primary.action === "content" ? onOpenContent(it) : onOpenExternal(it))}
          >
            <primary.Icon size={16} strokeWidth={1.9} aria-hidden />
            {primary.label}
          </button>
          <button className="callout-act" onClick={() => onSave(it)} aria-label="Save">
            <Bookmark size={18} strokeWidth={1.75} aria-hidden />
          </button>
          <ShareActions item={it.item} />
          {/* full_text keeps a quiet path to the original alongside Read. */}
          {render === "full_text" && (
            <button className="callout-orig" onClick={() => onOpenExternal(it)}>
              Open original
            </button>
          )}
        </div>
      )}
    </div>
  );
});
