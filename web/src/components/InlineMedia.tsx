import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ExternalLink, Bookmark, FileText, ChevronUp, Play, SlidersHorizontal, MoreHorizontal, Volume2, VolumeX } from "lucide-react";
import type { Item } from "@/api/client";
import { ShareActions } from "./ReaderActions";
import { renderSummary } from "@/lib/html";
import { parseYouTubeId, loadYouTubeIframeAPI } from "@/lib/youtube";
import "./shorts-mode.css";
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
// onFirstPlay distinguishes observed playback from the first explicit play
// interaction; autoplay never creates an open. onPlaybackChange owns playing-time
// accounting. onNext/onPrev advance the feed from a swipe over the video.
export function InlineMedia({
  item,
  onSave,
  onOpenOriginal,
  onMenu,
  onFirstPlay,
  onNext,
  onPrev,
  ytHistory = false,
  compact = false,
  autoPlay = false,
  active = true,
  muted = true,
  onMutedChange,
  onPlaybackChange,
}: {
  item: Item;
  onSave?: () => void;
  onOpenOriginal: () => void;
  // The card's ··· overflow, when it lives in this row rather than above the card.
  // Optional so the shipped placement stays untouched.
  onMenu?: () => void;
  onFirstPlay?: (explicit: boolean) => void;
  onNext?: () => void;
  onPrev?: () => void;
  // #151: when true, embed from youtube.com (not nocookie) so a watch can reach the
  // user's YouTube history. Opt-in via Settings; default private.
  ytHistory?: boolean;
  compact?: boolean;
  autoPlay?: boolean;
  active?: boolean;
  muted?: boolean;
  onMutedChange?: (muted: boolean) => void;
  onPlaybackChange?: (playing: boolean) => void;
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
  const mediaRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  const explicitPlayed = useRef(false);
  const explicitIntent = useRef(false);
  const playingRef = useRef(false);
  const ready = useRef(false);
  const autoTried = useRef(false);
  const resumeAfterSuspend = useRef(false);
  const suspended = useRef(false);
  const sound = useRef(autoPlay ? muted : false);
  const [soundMuted, setSoundMuted] = useState(sound.current);
  const [blocked, setBlocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const latest = useRef({ active, autoPlay, onFirstPlay, onPlaybackChange, onMutedChange });
  latest.current = { active, autoPlay, onFirstPlay, onPlaybackChange, onMutedChange };

  function markPlayed(explicit: boolean) {
    if (explicit && !explicitPlayed.current) {
      explicitPlayed.current = true;
      played.current = true;
      latest.current.onFirstPlay?.(true);
    } else if (!played.current) {
      played.current = true;
      latest.current.onFirstPlay?.(false);
    }
  }
  function reportPlaying(value: boolean) {
    if (playingRef.current === value) return;
    playingRef.current = value;
    setPlaying(value);
    latest.current.onPlaybackChange?.(value);
  }
  function available() {
    const root = mediaRef.current;
    // Shared Overlay portals mount in opening order; a review can remain open
    // underneath its player. Only the top dialog owns interaction.
    const topDialog = Array.from(document.querySelectorAll("dialog[open]")).at(-1);
    return latest.current.active && !document.hidden && !!root?.isConnected &&
      (!topDialog || topDialog.contains(root));
  }
  function setSound(value: boolean) {
    sound.current = value;
    setSoundMuted(value);
    if (latest.current.autoPlay) latest.current.onMutedChange?.(value);
    const player = playerRef.current;
    if (value) player?.mute?.(); else player?.unMute?.();
  }
  function requestPlay(explicit = false) {
    if (!ready.current || !available()) return;
    explicitIntent.current = explicitIntent.current || explicit;
    setBlocked(false);
    setSound(sound.current);
    playerRef.current?.playVideo?.();
  }
  function syncPlayback() {
    if (!available()) {
      if (!suspended.current) resumeAfterSuspend.current = playingRef.current;
      suspended.current = true;
      playerRef.current?.pauseVideo?.();
      audioRef.current?.pause();
      reportPlaying(false);
      return;
    }
    const shouldResume = suspended.current && resumeAfterSuspend.current;
    suspended.current = false;
    resumeAfterSuspend.current = false;
    if (!ready.current) return;
    if (latest.current.autoPlay && (!autoTried.current || shouldResume)) {
      autoTried.current = true;
      requestPlay();
    }
  }
  const sync = useRef(syncPlayback);
  sync.current = syncPlayback;

  useEffect(() => {
    const change = () => sync.current();
    const hide = () => {
      playerRef.current?.pauseVideo?.();
      audioRef.current?.pause();
      reportPlaying(false);
    };
    document.addEventListener("visibilitychange", change);
    window.addEventListener("pagehide", hide);
    // Also covers shared header dialogs whose state is outside SessionPage.
    const observer = new MutationObserver(change);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"], childList: true });
    return () => {
      document.removeEventListener("visibilitychange", change);
      window.removeEventListener("pagehide", hide);
      observer.disconnect();
    };
  }, []);

  const previousAutoPlay = useRef(autoPlay);
  useEffect(() => {
    if (previousAutoPlay.current !== autoPlay) {
      previousAutoPlay.current = autoPlay;
      autoTried.current = false;
      resumeAfterSuspend.current = false;
      if (!autoPlay) {
        setSound(false);
        playerRef.current?.pauseVideo?.();
        reportPlaying(false);
      }
    }
    sync.current();
  }, [active, autoPlay]);
  useEffect(() => {
    if (autoPlay) setSound(muted);
  }, [muted, autoPlay]);

  // One player for the focused card. Native controls require a rebuild; retain
  // its playhead, but always recheck focus, dialogs and visibility before playing.
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
        host: ytHistory ? "https://www.youtube.com" : "https://www.youtube-nocookie.com",
        playerVars: { rel: 0, playsinline: 1, controls: nativeControls ? 1 : 0, origin: window.location.origin },
        events: {
          onReady: () => {
            if (cancelled || playerRef.current !== player) return;
            ready.current = true;
            player.getIframe?.()?.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
            setSound(sound.current);
            const { at, playing: wasPlaying } = resume.current;
            if (at > 0) player.seekTo?.(at, true);
            if (wasPlaying && available()) requestPlay();
            else sync.current();
          },
          onStateChange: (e: any) => {
            if (cancelled || playerRef.current !== player) return;
            if (e.data === YT.PlayerState.PLAYING) {
              if (!available()) { player.pauseVideo?.(); reportPlaying(false); return; }
              setBlocked(false);
              setStarted(true);
              reportPlaying(true);
              markPlayed(explicitIntent.current || !latest.current.autoPlay);
            } else {
              reportPlaying(false);
            }
          },
          onAutoplayBlocked: () => {
            if (cancelled || playerRef.current !== player || !available()) return;
            reportPlaying(false);
            if (!sound.current && latest.current.autoPlay) {
              // A following clip may lose the previous tap's audio permission.
              setSound(true);
              requestPlay();
            } else setBlocked(true);
          },
          onError: () => {
            if (cancelled || playerRef.current !== player) return;
            setFailed(true);
            reportPlaying(false);
          },
        },
      });
      playerRef.current = player;
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      ready.current = false;
      try {
        if (player?.getCurrentTime) resume.current = { at: player.getCurrentTime() || 0, playing: playingRef.current || resumeAfterSuspend.current };
        player?.destroy?.();
      } catch { /* A player can be removed before its API is ready. */ }
      if (playerRef.current === player) playerRef.current = null;
      reportPlaying(false);
      if (mountRef.current) mountRef.current.innerHTML = "";
    };
  }, [video, ytId, nativeControls, ytHistory]);

  function togglePlay() {
    if (!available()) return;
    if (playingRef.current) {
      resumeAfterSuspend.current = false;
      playerRef.current?.pauseVideo?.();
      reportPlaying(false);
    } else requestPlay(true);
  }
  function toggleSound() {
    explicitIntent.current = true;
    setSound(!sound.current);
    if (playingRef.current) markPlayed(true);
    else requestPlay(true);
  }

  // Gesture overlay: distinguish a tap (play/pause) from a swipe (navigate). A raw
  // iframe can't do this - it eats the events - which is the whole reason for the
  // IFrame API. In notes mode we only tap-toggle and let vertical drags scroll the
  // notes (touch-action: pan-y), so navigation is disabled there.
  //
  // #149: navigation requires a deliberate *flick* - far enough AND fast enough.
  // Distance alone misfired: pressing play janks the page while YouTube buffers,
  // and if the finger drifts up during that freeze the release carried a big dy and
  // got read as swipe-up -> next, so "press play" jumped to the next item. A flick
  // is a quick gesture (< FLICK_MS); a slow drift over the same distance is not, and
  // anything that isn't a flick is treated as a tap (play/pause). Tapping always
  // plays; only an intentional fast swipe navigates.
  const TAP_SLOP = 10; // px of movement under which it's unambiguously a tap
  const SWIPE = 45; // px a flick must travel to navigate
  const FLICK_MS = 400; // a navigation flick must complete within this
  const g = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  function onDown(e: ReactPointerEvent) {
    g.current = null;
    if (!e.isPrimary || e.button !== 0 || (window.visualViewport?.scale ?? 1) > 1) return;
    g.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
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
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const dt = e.timeStamp - d.t;
    // Notes mode: taps toggle play, vertical drags scroll the transcript (pan-y).
    if (notes) {
      if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) togglePlay();
      return;
    }
    // A navigation gesture must be a genuine flick: past the distance threshold AND
    // quick. Everything else - a tap, a sloppy tap, or a slow freeze-drift - is
    // play/pause, never an accidental jump to the next item.
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    const flick = dist >= SWIPE && dt <= FLICK_MS;
    if (!flick) {
      togglePlay();
      return;
    }
    if (Math.abs(dy) >= Math.abs(dx)) {
      if (dy <= -SWIPE) onNext?.(); // flick up -> next
      else onPrev?.(); // flick down -> previous
    } else if (dx <= -SWIPE) {
      onNext?.(); // flick left -> next (feed consistency)
    } else {
      togglePlay(); // rightward flick has no nav target; treat as play/pause
    }
  }

  const notesLabel = notes ? (video ? "Hide notes" : "Hide transcript") : video ? "Show notes" : "Transcript";

  return (
    <div ref={mediaRef} className={`inline-media ${vertical ? "v" : "h"} ${notes ? "notes" : ""} ${compact ? "im-compact" : ""}`}>
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
                  onPointerCancel={() => { g.current = null; }}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePlay(); } }}
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
              onClick={() => { explicitIntent.current = true; setNativeControls((v) => !v); }}
              aria-pressed={nativeControls}
              aria-label={nativeControls ? "Use simple controls" : "Use YouTube controls"}
              title={nativeControls ? "Simple controls" : "YouTube controls"}
            >
              <SlidersHorizontal size={15} strokeWidth={2} aria-hidden />
            </button>
            {autoPlay && <button type="button" className="im-sound" onClick={toggleSound}
              aria-label={soundMuted ? "Turn sound on" : "Mute video"}>
              {soundMuted ? <VolumeX size={17} aria-hidden /> : <Volume2 size={17} aria-hidden />}
              {soundMuted ? "Sound on" : "Mute"}
            </button>}
            {(blocked || failed) && <div className="im-playback-message" role="status">
              {failed ? <>Video unavailable here.<button onClick={onOpenOriginal}>Open original</button></> : "Tap the video to play"}
            </div>}
          </div>
        ) : audio ? (
          <div className="im-audio">
            {item.thumbnail_url && <img className="im-audio-art" src={item.thumbnail_url} alt="" loading="lazy" />}
            <audio ref={audioRef} src={item.url} controls preload="none" onPlay={() => { if (!available()) { audioRef.current?.pause(); return; } markPlayed(true); reportPlaying(true); }} onPause={() => reportPlaying(false)} onEnded={() => reportPlaying(false)} />
            {!notes && item.summary?.trim() && <p className="im-audio-blurb">{item.summary}</p>}
          </div>
        ) : (
          <div className="im-frame im-nofit">
            <button className="btn" onClick={onOpenOriginal}>
              Open original
            </button>
          </div>
        )}

        {!compact && <div className="im-actions">
          {hasNotes && (
            <button className={`im-act im-notes-toggle ${notes ? "on" : ""}`} onClick={() => setNotes((n) => !n)}>
              {notes ? <ChevronUp size={16} strokeWidth={1.9} aria-hidden /> : <FileText size={16} strokeWidth={1.75} aria-hidden />}
              {notesLabel}
            </button>
          )}
          {onSave && (
            <button className="im-act" onClick={onSave} aria-label="Save">
              <Bookmark size={18} strokeWidth={1.75} aria-hidden />
            </button>
          )}
          <ShareActions item={item} compact />
          <button className="im-act im-orig" onClick={onOpenOriginal} aria-label={video ? "Open on YouTube" : "Open original"}>
            <ExternalLink size={18} strokeWidth={1.75} aria-hidden />
          </button>
          {onMenu && (
            <button className="im-act im-more-act" onClick={onMenu} aria-label="More actions">
              <MoreHorizontal size={18} strokeWidth={1.75} aria-hidden />
            </button>
          )}
        </div>}
      </div>

      {!compact && notes && hasNotes && (
        <div className="im-notes-panel">
          <div className="im-notes-title">{video ? "Show notes" : "Transcript"}</div>
          <div className="reader-body" dangerouslySetInnerHTML={{ __html: desc.html }} />
        </div>
      )}
    </div>
  );
}
