import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ExternalLink, Bookmark, Heart, FileText, ChevronLeft, Play, Maximize2 } from "lucide-react";
import type { Item } from "@/api/client";
import { ShareActions } from "./ReaderActions";
import { renderSummary } from "@/lib/html";
import { parseYouTubeId, loadYouTubeIframeAPI } from "@/lib/youtube";
import { videoAspect, isVertical, isVideo } from "@/lib/render";

// InlineMedia is the in-feed player (multimedia overhaul). Media is consumed IN the
// card - no modal. Video runs through the YouTube IFrame Player API (not a raw
// embed) so we own play/pause, which unlocks two things a raw cross-origin iframe
// can't do (it consumes every pointer event and can't be told to play):
//   - one tap on the video plays/pauses it (single tap, with sound)
//   - swipe up/down over the video navigates the feed (the Reels muscle memory)
// A transparent gesture overlay sits over the player and interprets tap-vs-swipe;
// native inline controls are hidden (a full overlay would cover them anyway), with a
// fullscreen button handing off to the native player for scrubbing.
//
// Layout keys off the REAL frame aspect ratio (item.aspect_ratio): landscape bleeds
// edge-to-edge, a vertical frame is height-bounded with stripped chrome. The "Show
// notes"/"Transcript" toggle sticks the player to the top and scrolls the text below
// WITHOUT remounting the player node, so playback never pauses.
//
// onFirstPlay fires once, on the first real PLAYING state, so the session counts the
// watch as an `open` and starts the active-time timer (#135). onNext/onPrev advance
// the feed from a swipe over the video.
export function InlineMedia({
  item,
  liked,
  onLike,
  onSave,
  onOpenOriginal,
  onFirstPlay,
  onNext,
  onPrev,
}: {
  item: Item;
  liked?: boolean;
  onLike?: () => void;
  onSave?: () => void;
  onOpenOriginal: () => void;
  onFirstPlay?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
}) {
  const [notes, setNotes] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false); // has playback ever begun
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

  const frameStyle = { ["--ar" as string]: String(ar) } as CSSProperties;

  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  function markPlayed() {
    if (played.current) return;
    played.current = true;
    onFirstPlay?.();
  }

  // Create the YT player for the focused video card; destroy it on unmount (the card
  // losing focus unmounts InlineMedia, so the player is torn down and audio stops).
  useEffect(() => {
    if (!video || !ytId) return;
    let cancelled = false;
    let player: any = null;
    loadYouTubeIframeAPI().then((YT) => {
      if (cancelled || !hostRef.current) return;
      player = new YT.Player(hostRef.current, {
        videoId: ytId,
        host: "https://www.youtube-nocookie.com",
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, controls: 0 },
        events: {
          onStateChange: (e: any) => {
            const s = e.data;
            if (s === YT.PlayerState.PLAYING) {
              setPlaying(true);
              setStarted(true);
              markPlayed();
            } else if (s === YT.PlayerState.PAUSED || s === YT.PlayerState.ENDED) {
              setPlaying(false);
            }
          },
        },
      });
      playerRef.current = player;
    });
    return () => {
      cancelled = true;
      try {
        player?.destroy?.();
      } catch {
        /* player may not have initialized */
      }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, ytId]);

  function togglePlay() {
    const p = playerRef.current;
    if (!p) return;
    if (playing) p.pauseVideo?.();
    else p.playVideo?.();
  }

  function goFullscreen() {
    const el = playerRef.current?.getIframe?.() as HTMLIFrameElement | undefined;
    (el?.requestFullscreen ?? (el as any)?.webkitRequestFullscreen)?.call(el);
  }

  // Gesture overlay: distinguish a tap (play/pause) from a swipe (navigate). A raw
  // iframe can't do this - it eats the events - which is the whole reason for the
  // IFrame API. In notes mode we only tap-toggle and let vertical drags scroll the
  // notes (touch-action: pan-y), so navigation is disabled there.
  const TAP_SLOP = 10; // px of movement under which it's a tap, not a swipe
  const SWIPE = 45; // px past which a drag navigates
  const g = useRef<{ x: number; y: number } | null>(null);
  function onDown(e: ReactPointerEvent) {
    g.current = { x: e.clientX, y: e.clientY };
    // Capture the pointer so a swipe that leaves the overlay still delivers pointerup
    // here. Touch has implicit capture; mouse/desktop does not - without this a
    // swipe-off-the-element loses the release and never navigates.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
  }
  function onUp(e: ReactPointerEvent) {
    const d = g.current;
    g.current = null;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) {
      togglePlay();
      return;
    }
    if (notes) return; // notes mode: no navigation, drags scroll the text
    if (Math.abs(dy) >= Math.abs(dx)) {
      if (dy <= -SWIPE) onNext?.(); // swipe up -> next
      else if (dy >= SWIPE) onPrev?.(); // swipe down -> previous
    } else if (dx <= -SWIPE) {
      onNext?.(); // swipe left -> next (feed consistency)
    }
  }

  const notesLabel = notes ? "Back" : video ? "Show notes" : "Transcript";

  return (
    <div className={`inline-media ${vertical ? "v" : "h"} ${notes ? "notes" : ""}`}>
      <div className="im-stage">
        {video && ytId ? (
          <div className="im-frame" style={frameStyle}>
            <div ref={hostRef} className="im-yt" />
            <div
              className="im-gesture"
              style={notes ? { touchAction: "pan-y" } : { touchAction: "none" }}
              onPointerDown={onDown}
              onPointerUp={onUp}
              role="button"
              aria-label={playing ? "Pause" : "Play"}
            >
              {/* Our calm play affordance is for the paused-mid-video state (controls:0
                  shows nothing there). The unstarted poster keeps YouTube's own button,
                  so we don't stack two. */}
              {!playing && started && (
                <span className="im-play" aria-hidden>
                  <Play size={30} strokeWidth={1.5} fill="currentColor" />
                </span>
              )}
            </div>
            <button className="im-fs" onClick={goFullscreen} aria-label="Fullscreen">
              <Maximize2 size={17} strokeWidth={1.9} aria-hidden />
            </button>
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
