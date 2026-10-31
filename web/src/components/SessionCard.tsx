import { forwardRef, type PointerEvent as ReactPointerEvent } from "react";
import { ShortsMeta, ShortsQuietControls } from "./ShortsQuietControls";
import type { ShortsBus } from "@/lib/shortsBus";
import { Bookmark, BookOpen, Play, ExternalLink, MoreHorizontal, ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import type { Item, ItemRender, Selected } from "@/api/client";
import { TopicPill, CardSource, SourceAvatar, Byline, Blurb, Media } from "@/components/CardParts";
import { InlineMedia, type MediaPosition } from "@/components/InlineMedia";
import { ShareActions } from "@/components/ReaderActions";
import { isMedia, isVertical, videoAspect } from "@/lib/render";
import "./session-afterglow.css";
import { relTime } from "@/lib/format";

// SessionCard is one item in the session reel, lifted out of SessionPage so the
// layout lab (`/lab`) renders the EXACT card the session renders - same markup,
// same classes, same components. It follows CardParts' rule: if a surface shows a
// card, it shows this one, so a preview can never drift from the real thing.
//
// It is presentational. Every behaviour (advance, open, save, the source sheet)
// arrives as a prop, so the lab can pass no-ops and still get a truthful render.
//
// Fixed top->bottom order (#96): TopicPill -> CardSource -> Title -> Byline ->
// Hero -> Blurb -> callout. Focused media plays inline. Shorts mode replaces the
// ordinary text and action rows with a compact credit and Details control;
// off-screen cards stay lightweight thumbnails.

/**
 * How the Section -> Topic -> Source hierarchy is presented. This is a real
 * structural choice, not a skin: the variants emit different markup, which is why
 * it lives here and not in a stylesheet.
 *
 *  pill        what ships today - tinted topic pill, then the source on its own row
 *  stack       section as an overline, then "topic > source" as one quiet line
 *  breadcrumb  one line, chevron-separated: Section > Topic > Source
 *  overline    section overline only; the source drops into the byline
 *  taxonomy-credit
 *              "Section > Topic", then the TITLE, then the creator and date
 *              together below it. Puts the headline second - the thing you
 *              actually read - and treats the credit as a caption on the media.
 *  taxonomy    "Section > Topic" on one line, the creator on the next. Splits the
 *              two questions a reader actually asks - what shelf is this on, and
 *              who made it - onto their own lines, and is shorter than `stack`
 *              because the topic no longer competes with the source for width.
 */
export type HierarchyStyle = "pill" | "stack" | "breadcrumb" | "overline" | "taxonomy" | "taxonomy-credit";

/**
 * Where the ··· overflow lives.
 *
 *  top         what ships today - its own row above the card, opposite the reason
 *  hierarchy   on the Section > Topic row, centred against it
 *  actions     in the action row under the post, as one more bare icon. Keeps the
 *              top of the card to content only, and puts the menu where the thumb
 *              already is for save/share/open.
 */
export type MenuPlacement = "top" | "hierarchy" | "actions";

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
  // #180: the Shorts footer's Details opens provenance, not actions.
  onDetails?: () => void;
  onFirstPlay?: (sel: Selected, explicit: boolean) => void;
  /** Video-first presentation applies only to short videos. */
  shortsMode?: boolean;
  persistentShorts?: boolean;
  // #182: this card's slot currently hosts the shared player; its footer
  // carries the live sound/CC/time controls from the bus.
  hostsPlayer?: boolean;
  // #184: full-screen Shorts, toggled from this card's footer.
  immersive?: boolean;
  onImmersiveChange?: (value: boolean) => void;
  shortsBus?: ShortsBus;
  shortsPosition?: React.RefObject<MediaPosition | null>;
  playbackActive?: boolean;
  muted?: boolean;
  onMutedChange?: (muted: boolean) => void;
  onPlaybackChange?: (playing: boolean) => void;
  onNext?: () => void;
  onPrev?: () => void;
  ytHistory?: boolean;
  onPointerDown?: (e: ReactPointerEvent) => void;
  onPointerMove?: (e: ReactPointerEvent) => void;
  onPointerCancel?: (e: ReactPointerEvent) => void;
  onPointerUp?: (e: ReactPointerEvent) => void;
  onClick?: () => void;
  /** Defaults to what ships today. */
  hierarchy?: HierarchyStyle;
  /**
   * Section name for the hierarchy line. The session payload does not carry this
   * yet - TopicRef is name/slug/colour/icon only - so adopting anything but
   * `pill` means adding section_name to TopicRef server-side.
   */
  sectionName?: string;
  /** Where the ··· menu sits. Defaults to what ships today. */
  menuPlacement?: MenuPlacement;
}

/** The hierarchy block. Every variant renders the same three facts, differently. */
function CardHierarchy({
  sel,
  style,
  sectionName,
  onSource,
  menu,
}: {
  sel: Selected;
  style: HierarchyStyle;
  sectionName?: string;
  onSource: () => void;
  menu?: React.ReactNode;
}) {
  const topic = sel.topic;
  const section = sectionName;

  if (style === "pill") {
    return (
      <>
        <TopicPill topic={topic} />
        <CardSource sel={sel} onSource={onSource} />
      </>
    );
  }

  const source = (
    <button
      type="button"
      className="ch-source"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onSource();
      }}
    >
      {sel.source_title}
    </button>
  );
  const avatar = <SourceAvatar url={sel.source_icon_url} title={sel.source_title} color={topic?.color} />;
  const chev = <ChevronRight size={12} className="ch-sep inline-icon" aria-hidden />;

  if (style === "breadcrumb") {
    return (
      <div className="card-hier ch-breadcrumb">
        <span className="ch-line">
          {avatar}
          {section && (
            <>
              <span className="ch-section">{section}</span>
              {chev}
            </>
          )}
          {topic && (
            <>
              <span className="ch-topic">{topic.name}</span>
              {chev}
            </>
          )}
          {source}
        </span>
        {menu}
      </div>
    );
  }

  if (style === "overline") {
    return (
      <div className="card-hier ch-overline">
        <span className="ch-section">{section || topic?.name || sel.source_title}</span>
        <span className="ch-line ch-right">
          {source}
          {menu}
        </span>
      </div>
    );
  }

  if (style === "taxonomy-credit") {
    return (
      <div className="card-hier ch-taxonomy ch-taxonomy-only">
        <div className="ch-rows">
          <span className="ch-line ch-tax">
            <span className="ch-section">{section || topic?.name || ""}</span>
            {section && topic && (
              <>
                {chev}
                <span className="ch-topic">{topic.name}</span>
              </>
            )}
          </span>
        </div>
        {menu}
      </div>
    );
  }

  if (style === "taxonomy") {
    return (
      <div className="card-hier ch-taxonomy">
        <div className="ch-rows">
          <span className="ch-line ch-tax">
            <span className="ch-section">{section || topic?.name || ""}</span>
            {section && topic && (
              <>
                {chev}
                <span className="ch-topic">{topic.name}</span>
              </>
            )}
          </span>
          <span className="ch-line">
            {avatar}
            {source}
          </span>
        </div>
        {menu}
      </div>
    );
  }

  // stack: section overline, then avatar + topic > source. The menu is a sibling
  // of BOTH rows so it centres against the block rather than riding the top line.
  return (
    <div className="card-hier ch-stack">
      <div className="ch-rows">
        <span className="ch-section">{section || topic?.name || ""}</span>
        <span className="ch-line">
          {avatar}
          {section && topic && (
            <>
              <span className="ch-topic">{topic.name}</span>
              {chev}
            </>
          )}
          {source}
        </span>
      </div>
      {menu}
    </div>
  );
}

/** Avatar + source + relative date, as one caption line under the title. */
function CardCredit({ sel, onSource }: { sel: Selected; onSource: () => void }) {
  const age = relTime(sel.item.published_at || sel.item.fetched_at);
  return (
    <div className="card-credit">
      <SourceAvatar url={sel.source_icon_url} title={sel.source_title} color={sel.topic?.color} />
      {/* Name + date share a baseline; the avatar centres against this text block
          (see .card-credit / .cc-text in global.css). */}
      <span className="cc-text">
        <button
          type="button"
          className="cc-source"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSource();
          }}
        >
          {sel.source_title}
        </button>
        {age && <span className="cc-age">{age}</span>}
      </span>
    </div>
  );
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
    onDetails,
    onFirstPlay,
    shortsMode = false,
    persistentShorts = false,
    hostsPlayer = false,
    immersive = false,
    onImmersiveChange,
    shortsBus,
    shortsPosition,
    playbackActive = true,
    muted = true,
    onMutedChange,
    onPlaybackChange,
    onNext,
    onPrev,
    ytHistory,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClick,
    hierarchy = "pill",
    sectionName,
    menuPlacement = "top",
  },
  ref,
) {
  const it = sel;
  const primary = primaryFor(it.item, render);
  // Media on the focused card plays inline (no modal); off-screen cards stay
  // lightweight thumbnails. A vertical frame gets the compact chrome layout.
  // #182: every Shorts card keeps the media layout whether or not it is focused,
  // so a card never reflows as the reel's focus passes over it mid-swipe.
  const stableShort = shortsMode && persistentShorts && it.item.media_type === "short";
  const activeMedia = (focused || stableShort) && isMedia(it.item);
  const vert = activeMedia && isVertical(it.item);
  const audioCard = activeMedia && it.item.media_type === "audio";
  const compactShort = shortsMode && it.item.media_type === "short";
  const age = compactShort ? relTime(it.item.published_at || it.item.fetched_at) : "";

  return (
    <div
      className={`snap afterglow-card ${focused ? "" : "away"} ${activeMedia ? "media-card" : ""} ${vert ? "vertical" : ""} ${audioCard ? "audio-card" : ""} ${compactShort ? "shorts-card" : ""}`}
      data-idx={index}
      data-player={hostsPlayer || undefined}
      ref={ref}
      onPointerDownCapture={(e) => { if (!e.isPrimary || (window.visualViewport?.scale ?? 1) > 1) onPointerCancel?.(e); }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
      role="article"
      aria-label={compactShort ? it.item.title : undefined}
    >
      {!compactShort && <>
      {/* Quiet reason line (de-noised, no box) + the ··· overflow. */}
      {(menuPlacement === "top" || it.reason) && (
        <div className="card-top" onClick={(e) => e.stopPropagation()}>
          {it.reason && <span className="reason">{it.reason}</span>}
          {focused && menuPlacement === "top" && (
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
      )}

      <CardHierarchy
        sel={it}
        style={hierarchy}
        sectionName={sectionName}
        onSource={() => onSource(it)}
        menu={
          focused && menuPlacement === "hierarchy" ? (
            <button
              className="item-more ch-more"
              onClick={(e) => {
                e.stopPropagation();
                onMenu();
              }}
              aria-label="More actions"
            >
              ···
            </button>
          ) : null
        }
      />
      <h3 className="card-title">{it.item.title}</h3>
      {hierarchy === "taxonomy-credit" ? (
        <CardCredit sel={it} onSource={() => onSource(it)} />
      ) : (
        <Byline item={it.item} sourceTitle={it.source_title} />
      )}
      </>}

      {stableShort ? (
        // The shared player floats over this slot while the card hosts it; the
        // poster underneath is what you see while scrolling in or out.
        <div className="card-media shorts-player-slot" aria-hidden="true">
          <div className="inline-media im-compact"><div className="im-stage">
            <div className="im-frame" style={{ "--ar": String(videoAspect(it.item)) } as React.CSSProperties}>
              {/* The incoming clip's poster, framed exactly like the player's. */}
              {it.item.thumbnail_url && <span className="im-slot-poster" style={{ backgroundImage: `url(${it.item.thumbnail_url})` }} />}
            </div>
          </div></div>
        </div>
      ) : activeMedia ? (
        // The focused player uses its real aspect ratio. Shorts mode requests
        // autoplay and moves secondary actions into Details.
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
            onMenu={menuPlacement === "actions" ? onMenu : undefined}
            onFirstPlay={(explicit) => onFirstPlay?.(it, explicit)}
            compact={compactShort}
            autoPlay={compactShort}
            active={playbackActive}
            muted={muted}
            onMutedChange={onMutedChange}
            positionMemory={it.item.media_type === "short" ? shortsPosition : undefined}
            onPlaybackChange={onPlaybackChange}
            onNext={onNext}
            onPrev={onPrev}
            ytHistory={ytHistory}
          />
        </div>
      ) : (
        <>
          <Media item={it.item} />
          {!compactShort && <Blurb item={it.item} />}
        </>
      )}

      {compactShort && (
        <div
          className="shorts-card-footer"
          onPointerDown={(e) => { onPointerCancel?.(e); e.stopPropagation(); }}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="shorts-creator" type="button" onClick={() => onSource(it)}>
            <SourceAvatar url={it.source_icon_url} title={it.source_title} color={it.topic?.color} />
            <span className="shorts-credit-text">
              <span className="shorts-creator-name">{it.source_title}</span>
              <ShortsMeta bus={hostsPlayer ? shortsBus : undefined} age={age} duration={it.item.duration_sec} />
            </span>
          </button>
          {hostsPlayer && shortsBus && <ShortsQuietControls bus={shortsBus} />}
          {hostsPlayer && onImmersiveChange && (
            <button type="button" className="shorts-quiet-btn" onClick={() => onImmersiveChange(!immersive)}
              aria-label={immersive ? "Exit full screen" : "Full screen"} aria-pressed={immersive} data-on={immersive}>
              {immersive ? <Minimize2 size={18} strokeWidth={1.7} aria-hidden /> : <Maximize2 size={18} strokeWidth={1.7} aria-hidden />}
            </button>
          )}
          <button className="shorts-details" type="button" onClick={immersive ? onMenu : (onDetails ?? onMenu)} disabled={!focused}
            aria-label={immersive ? "Article and session actions" : "Details"}>
            <MoreHorizontal size={18} aria-hidden />
            <span className="shorts-details-label">Details</span>
          </button>
        </div>
      )}

      {focused && !isMedia(it.item) && (
        <div className="card-callout" onPointerDown={(e) => { onPointerCancel?.(e); e.stopPropagation(); }} onPointerUp={(e) => e.stopPropagation()} onPointerMove={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          {/* The solid button appears only when there is something to open IN the
              app. Without full text there is nothing to read here, so the row is
              icons alone and "open original" carries the weight. */}
          {(
            <button className="callout-primary" onClick={() => primary.action === "content" ? onOpenContent(it) : onOpenExternal(it)}>
              <primary.Icon size={16} strokeWidth={1.9} aria-hidden />
              {primary.label}
            </button>
          )}
          <button className="callout-act" onClick={() => onSave(it)} aria-label="Save">
            <Bookmark size={18} strokeWidth={1.75} aria-hidden />
          </button>
          <ShareActions item={it.item} compact />
          {/* Same icon, same order as the media row - one action set everywhere. */}
          <button className="callout-act" onClick={() => onOpenExternal(it)} aria-label="Open original">
            <ExternalLink size={18} strokeWidth={1.75} aria-hidden />
          </button>
          {menuPlacement === "actions" && (
            <button className="callout-act" onClick={onMenu} aria-label="More actions">
              <MoreHorizontal size={18} strokeWidth={1.75} aria-hidden />
            </button>
          )}
        </div>
      )}
    </div>
  );
});
