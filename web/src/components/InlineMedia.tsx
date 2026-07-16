import { useMemo, useRef, useState, type CSSProperties } from "react";
import { ExternalLink, Bookmark, Heart, FileText, ChevronLeft } from "lucide-react";
import type { Item } from "@/api/client";
import { ShareActions } from "./ReaderActions";
import { renderSummary } from "@/lib/html";
import { parseYouTubeId, embedUrl } from "@/lib/youtube";
import { videoAspect, isVertical, isVideo } from "@/lib/render";

// InlineMedia is the in-feed player (multimedia overhaul). Media is consumed IN
// the card - the real nocookie iframe / native <audio> is embedded, pre-loaded and
// paused, so one tap on the player starts it right there. No modal, nothing jumps.
//
// Layout keys off the REAL frame aspect ratio (item.aspect_ratio), not the
// short/long duration bucket: landscape goes edge-to-edge for max width; a vertical
// frame gets a tall centered player with stripped-down chrome so the video is as
// large as possible without going fullscreen.
//
// Description / transcript lives behind a "Show notes" toggle that keeps the iframe
// a STABLE DOM node (never remounts, so the video never pauses): opening notes just
// adds a class that sticks the player to the top and reveals a scrollable text panel
// below. Back returns to the plain player.
//
// onFirstPlay fires once when the user first interacts with the player, so the
// session can count the watch as an `open` and start the active-time timer (#135)
// without needing the cross-origin YouTube IFrame API.
export function InlineMedia({
  item,
  liked,
  onLike,
  onSave,
  onOpenOriginal,
  onFirstPlay,
}: {
  item: Item;
  liked?: boolean;
  onLike?: () => void;
  onSave?: () => void;
  onOpenOriginal: () => void;
  onFirstPlay?: () => void;
}) {
  const [notes, setNotes] = useState(false);
  const played = useRef(false);

  const video = isVideo(item);
  const audio = item.media_type === "audio";
  const ytId = useMemo(() => (video ? parseYouTubeId(item.url) : null), [video, item.url]);
  const vertical = isVertical(item);
  const ar = videoAspect(item);

  const desc = useMemo(
    () => renderSummary(item.content?.trim() ? item.content : item.summary),
    [item.content, item.summary],
  );
  const hasNotes = !desc.empty;

  // The frame's aspect ratio is a CSS var; orientation classes (.h / .v) drive the
  // sizing (landscape bleeds to full card width, vertical is height-bounded).
  const frameStyle = { ["--ar" as string]: String(ar) } as CSSProperties;

  function markPlayed() {
    if (played.current) return;
    played.current = true;
    onFirstPlay?.();
  }

  const notesLabel = notes ? "Back" : video ? "Show notes" : "Transcript";

  return (
    <div className={`inline-media ${vertical ? "v" : "h"} ${notes ? "notes" : ""}`}>
      <div className="im-stage">
        {video && ytId ? (
          <div className="im-frame" style={frameStyle} onPointerDownCapture={markPlayed}>
            <iframe
              src={embedUrl(ytId)}
              title={item.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        ) : audio ? (
          <div className="im-audio">
            {item.thumbnail_url && <img className="im-audio-art" src={item.thumbnail_url} alt="" loading="lazy" />}
            <audio src={item.url} controls preload="none" onPlay={markPlayed} />
            {!notes && item.summary?.trim() && <p className="im-audio-blurb">{item.summary}</p>}
          </div>
        ) : (
          <div className="im-frame im-nofit">
            <button className="btn" onClick={onOpenOriginal}>
              Open original
            </button>
          </div>
        )}

        <div className="im-actions">
          {hasNotes && (
            <button className={`im-act im-notes-toggle ${notes ? "on" : ""}`} onClick={() => setNotes((n) => !n)}>
              {notes ? <ChevronLeft size={16} strokeWidth={1.9} aria-hidden /> : <FileText size={16} strokeWidth={1.75} aria-hidden />}
              {notesLabel}
            </button>
          )}
          {onLike && (
            <button className={`im-act ${liked ? "on" : ""}`} onClick={onLike} aria-label={liked ? "Unlike" : "Like"}>
              <Heart size={18} strokeWidth={1.75} fill={liked ? "currentColor" : "none"} aria-hidden />
            </button>
          )}
          {onSave && (
            <button className="im-act" onClick={onSave} aria-label="Save">
              <Bookmark size={18} strokeWidth={1.75} aria-hidden />
            </button>
          )}
          <ShareActions item={item} />
          <button className="im-act im-orig" onClick={onOpenOriginal} aria-label="Open original">
            <ExternalLink size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>

      {notes && hasNotes && (
        <div className="im-notes-panel">
          <div className="im-notes-title">{video ? "Show notes" : "Transcript"}</div>
          <div className="reader-body" dangerouslySetInnerHTML={{ __html: desc.html }} />
        </div>
      )}
    </div>
  );
}
