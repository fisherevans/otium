import { Volume2, VolumeX, VideoOff } from "lucide-react";
import "./sound-gate.css";

// The sound card (#213). The first time a session in Shorts mode reaches a Short,
// this covers it and holds playback until a tap: keep audio off, keep audio on,
// or skip the session's videos. The last choice on this device is highlighted to
// draw the eye; nothing is picked on its own. The tap that chooses also starts
// the clip (iOS only allows sound inside a tap), so the choice is the play.
export function SoundGate({ highlightMuted, ready, error, onChoose, onSkipVideos }: {
  highlightMuted: boolean;
  error?: string;
  // The Short's player has taken this card; a choice before then could not start it.
  ready: boolean;
  onChoose: (muted: boolean) => void;
  onSkipVideos: () => void;
}) {
  return (
    <div className="sound-gate" role="dialog" aria-modal="true" aria-labelledby="sound-gate-title">
      <div className="sound-gate-inner">
        <div className="sound-gate-eyebrow">Up next · a video</div>
        <h2 id="sound-gate-title">The next one plays sound</h2>
        <div className="sound-gate-choices">
          <button type="button" className="sound-gate-choice" data-default={highlightMuted || undefined} disabled={!ready} onClick={() => onChoose(true)}>
            <VolumeX size={44} strokeWidth={1.5} aria-hidden />
            Keep audio off
          </button>
          <button type="button" className="sound-gate-choice" data-default={!highlightMuted || undefined} disabled={!ready} onClick={() => onChoose(false)}>
            <Volume2 size={44} strokeWidth={1.5} aria-hidden />
            Keep audio on
          </button>
        </div>
        <p className="sound-gate-note">For the rest of this session. The speaker in the clip's bar still switches it.</p>
        {error && <p className="err" role="alert">{error}</p>}
        <button type="button" className="sound-gate-skip" onClick={onSkipVideos}>
          <VideoOff size={20} aria-hidden />
          <span>Skip videos this session<small>Only articles and posts until it ends</small></span>
        </button>
      </div>
    </div>
  );
}
