import { useMemo, type CSSProperties } from "react";
import { ExternalLink, Bookmark, Heart } from "lucide-react";
import type { Item } from "@/api/client";
import { BottomSheet } from "./BottomSheet";
import { ReaderHeaderActions } from "./ReaderActions";
import { fmtDate, authorRedundant } from "@/lib/format";
import { renderSummary } from "@/lib/html";
import { parseYouTubeId, embedUrl } from "@/lib/youtube";

// Inline media player (#51). A video/audio item is consumed IN the session -
// an embedded youtube-nocookie iframe or a native <audio> element in a tall
// sheet - rather than bouncing to youtube.com. The video is the one place
// full-color content is intentional (function over the grayscale aesthetic);
// the card's preview thumbnail stays dithered, the player is the real thing
// once invoked. "Open original" is the secondary path (source page / app).
//
// The open engagement signal is owned by SessionPage (recordOpen fires it once
// when the surface is invoked); this component emits nothing itself. Liking IS
// owned here now (#1): the heart in the header/foot mirrors the reader's.
//
// #4: video maximizes the viewing area. The sheet widens past the reading column
// (wide) so a landscape frame gets far more width than the old 640px column; a
// portrait frame goes as tall as fits. Audio stays compact (a short sheet, not the
// tall video treatment).
//
// The frame stays inside the sheet's padding (no negative-margin bleed): .reader
// is overflow-y:auto, which per the CSS overflow spec forces overflow-x to auto -
// so a child wider than the container would spawn a horizontal scrollbar. Full
// viewport width comes from the wider sheet instead.
const frameH: CSSProperties = {
  position: "relative",
  overflow: "hidden",
  background: "var(--paper-3)",
  border: "1.5px solid var(--rule-hard)",
  width: "100%",
  aspectRatio: "16 / 9",
  margin: "2px 0 18px",
};
// Portrait (shorts): a tall centered frame that takes most of the viewport height.
const frameV: CSSProperties = {
  position: "relative",
  overflow: "hidden",
  background: "var(--paper-3)",
  border: "1.5px solid var(--rule-hard)",
  aspectRatio: "9 / 16",
  height: "min(78dvh, 78vh)",
  maxWidth: "100%",
  margin: "6px auto 16px",
};
const iframeStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  border: 0,
  display: "block",
};

export function Player({
  item,
  sourceTitle,
  open,
  onClose,
  onOpenOriginal,
  onSave,
  liked,
  onLike,
}: {
  item: Item | null;
  sourceTitle?: string;
  open: boolean;
  onClose: () => void;
  onOpenOriginal: () => void;
  // When present, a "Save" affordance opens the collection picker (#57).
  onSave?: () => void;
  // Like from within the player (#1); omitted on surfaces that don't wire it.
  liked?: boolean;
  onLike?: () => void;
}) {
  const isVideo = item ? ["short", "long", "live"].includes(item.media_type) : false;
  const isAudio = item?.media_type === "audio";
  const vertical = item?.media_type === "short";
  const ytId = useMemo(() => (isVideo ? parseYouTubeId(item?.url) : null), [isVideo, item?.url]);

  // The feed body (#3): audio (podcasts) usually ships a real description; video
  // usually ships nothing (YouTube's media:description isn't ingested), so the
  // text section is omitted entirely rather than leaving an empty double rule.
  const desc = useMemo(
    () => renderSummary(item?.content?.trim() ? item.content : item?.summary),
    [item?.content, item?.summary],
  );
  const hasBody = !desc.empty;

  // #2: drop the author when it just repeats the source (a YouTube channel is both).
  const showAuthor = !!item?.author && !authorRedundant(item.author, sourceTitle);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      variant={isVideo ? "tall" : undefined}
      wide={isVideo && !vertical}
      swipeClose
      kicker={item?.media_type ?? ""}
      headActions={
        item ? (
          <ReaderHeaderActions
            item={item}
            onSave={onSave}
            onOpen={onOpenOriginal}
            liked={onLike ? !!liked : undefined}
            onLike={onLike}
          />
        ) : undefined
      }
    >
      {item && (
        <div className="reader">
          {isVideo && ytId ? (
            <div style={vertical ? frameV : frameH}>
              <iframe
                style={iframeStyle}
                src={embedUrl(ytId, { autoplay: true })}
                title={item.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          ) : isAudio ? (
            <audio style={{ width: "100%", margin: "8px 0 16px" }} src={item.url} controls preload="none" autoPlay />
          ) : (
            <div className="reader-empty">
              <p className="reader-empty-lead">Can't play this one in place.</p>
              <p>It lives somewhere that won't embed - open it at the source.</p>
              <button className="btn" onClick={onOpenOriginal}>
                Open original
              </button>
            </div>
          )}

          <h3 className="reader-title">{item.title}</h3>
          {/* No body text -> drop the meta's bottom rule so the foot's top rule is
              the single separator (avoids the empty double-rule, #3). */}
          <div className="reader-meta" style={hasBody ? undefined : { borderBottom: "none", paddingBottom: 0, marginBottom: 8 }}>
            {sourceTitle && <span>{sourceTitle}</span>}
            {sourceTitle && showAuthor && <span>·</span>}
            {showAuthor && <span>{item.author}</span>}
            {(sourceTitle || showAuthor) && item.published_at && <span>·</span>}
            {item.published_at && <span>{fmtDate(item.published_at)}</span>}
          </div>

          {hasBody && <div className="reader-body" dangerouslySetInnerHTML={{ __html: desc.html }} />}

          <div className="reader-foot">
            {onLike && (
              <button className={`reader-open ${liked ? "on" : ""}`} onClick={onLike}>
                <Heart size={15} strokeWidth={1.75} fill={liked ? "currentColor" : "none"} aria-hidden />
                {liked ? "Liked" : "Like"}
              </button>
            )}
            {onSave && (
              <button className="reader-open" onClick={onSave}>
                <Bookmark size={15} strokeWidth={1.75} aria-hidden />
                Save
              </button>
            )}
            <button className="reader-open" onClick={onOpenOriginal}>
              <ExternalLink size={15} strokeWidth={1.75} aria-hidden />
              Open original
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
