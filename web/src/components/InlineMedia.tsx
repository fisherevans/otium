import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ExternalLink, Bookmark, FileText, ChevronLeft, Play, SlidersHorizontal } from "lucide-react";
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
// native inline controls are hidden (a full overlay would cover them anyway).
//
// A subtle toggle (#149) flips to YouTube's OWN controls when you want them -
// scrubber, captions, quality, the YouTube link, and native fullscreen (which,
// unlike our removed div-fullscreen, actually works on iOS because it's YouTube's
// player doing it). The `controls` playerVar is fixed at construction and the
// IFrame API can't change it live, so the toggle recreates the player, preserving
// position and play state. In native mode the gesture overlay steps aside so
// YouTube receives the taps (swipe-to-navigate is traded away for that session).
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
  onSave,
  onOpenOriginal,
  onFirstPlay,
  onNext,
  onPrev,
}: {
  item: Item;
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

  // #149: native-controls mode. Default off (our clean overlay). Toggling recreates
  // the player with controls:1. resume carries the playhead + playing state across
  // the recreate so the swap is seamless.
  const [nativeControls, setNativeControls] = useState(false);
  const resume = useRef<{ at: number; playing: boolean }>({ at: 0, playing: false });

  const mountRef = useRef<HTMLDivElement>(null); // stable container React owns
  const frameRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  function markPlayed() {
    if (played.current) return;
    played.current = true;
    onFirstPlay?.();
  }

  // Create the YT player for the focused video card; destroy it on unmount (the card
  // losing focus unmounts InlineMedia, so the player is torn down and audio stops).
  // Recreated when `nativeControls` flips, since `controls` is construction-time only.
  // The player is mounted into an imperatively-created child of mountRef (not a
  // React-managed node) because YT.Player REPLACES its target element with an iframe;
  // letting React own that node would break on the recreate. onReady restores the
  // saved playhead so a toggle mid-watch resumes in place.
  useEffect(() => {
    if (!video || !ytId) return;
    let cancelled = false;
    let player: any = null;
    loadYouTubeIframeAPI().then((YT) => {
      if (cancelled || !mountRef.current) return;
      const host = document.createElement("div");
      host.className = "im-yt";
      mountRef.current.appendChild(host);
      player = new YT.Player(host, {
        videoId: ytId,
        host: "https://www.youtube-nocookie.com",
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, controls: nativeControls ? 1 : 0 },
        events: {
          onReady: () => {
            const { at, playing: wasPlaying } = resume.current;
            if (at > 0) player.seekTo?.(at, true);
            if (wasPlaying) player.playVideo?.(); // may be blocked without a gesture; native controls are right there
          },
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
      // Save the playhead so the recreate resumes in place.
      try {
        const p = playerRef.current;
        if (p?.getCurrentTime) resume.current = { at: p.getCurrentTime() || 0, playing: p.getPlayerState?.() === 1 };
      } catch {
        /* player may not have initialized */
      }
      try {
        player?.destroy?.();
      } catch {
        /* player may not have initialized */
      }
      playerRef.current = null;
      if (mountRef.current) mountRef.current.innerHTML = ""; // drop the iframe YT left behind
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, ytId, nativeControls]);

  function togglePlay() {
    const p = playerRef.current;
    if (!p) return;
    if (playing) p.pauseVideo?.();
    else p.playVideo?.();
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
    const tap = Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP;
    if (tap) {
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
          <div ref={frameRef} className="im-frame" style={frameStyle}>
            {/* Stable container; the YT iframe is appended imperatively inside it. */}
            <div ref={mountRef} className="im-yt-mount" />
            {/* Custom mode: our poster + gesture overlay keep the frame clean and give
                one-tap play/pause + swipe navigation. Native mode: both step aside so
                YouTube's own poster and controls take over. */}
            {!nativeControls && (
              <>
                {/* Our own poster covers YouTube's unstarted branding (title / channel /
                    "Watch on YouTube" / big button) so the pre-play state is clean. The
                    player is loaded underneath, so a tap plays straight into it. */}
                {!started && (
                  <div
                    className="im-poster"
                    style={item.thumbnail_url ? { backgroundImage: `url(${item.thumbnail_url})` } : undefined}
                  >
                    <span className="im-play" aria-hidden>
                      <Play size={30} strokeWidth={1.5} fill="currentColor" />
                    </span>
                  </div>
                )}
                <div
                  className="im-gesture"
                  style={notes ? { touchAction: "pan-y" } : { touchAction: "none" }}
                  onPointerDown={onDown}
                  onPointerUp={onUp}
                  role="button"
                  aria-label={playing ? "Pause" : "Play"}
                >
                  {/* Calm play affordance for the paused-mid-video state (controls:0 shows
                      nothing there); the unstarted poster keeps YouTube's own button. */}
                  {!playing && started && (
                    <span className="im-play" aria-hidden>
                      <Play size={30} strokeWidth={1.5} fill="currentColor" />
                    </span>
                  )}
                </div>
              </>
            )}
            {/* Subtle toggle to YouTube's native controls (#149): captions, quality,
                the YouTube link, native fullscreen. Sits top-right, clear of YouTube's
                bottom control bar. */}
            <button
              className={`im-ctltoggle ${nativeControls ? "on" : ""}`}
              onClick={() => setNativeControls((v) => !v)}
              aria-pressed={nativeControls}
              aria-label={nativeControls ? "Use simple controls" : "Use YouTube controls"}
              title={nativeControls ? "Simple controls" : "YouTube controls"}
            >
              <SlidersHorizontal size={15} strokeWidth={2} aria-hidden />
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
