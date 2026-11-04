import { ChevronRight, VideoOff } from "lucide-react";
import { BottomSheet } from "./BottomSheet";

// Session controls (#208): what you can do with the session as a whole. Opened by
// tapping the session time phrase in the top bar (or, over a Short, the session
// button in the clip's bar). The ··· beside it is only ever about the item on
// screen (ItemActions); nothing here depends on which item that is, apart from
// Next item disappearing at the end of the queue.
export function SessionControls({
  open,
  status,
  onClose,
  onNext,
  onEnd,
  onSkipVideos,
}: {
  open: boolean;
  status: string;
  onClose: () => void;
  onNext?: () => void;
  onEnd: () => void;
  // #213: shown while videos remain ahead in the queue.
  onSkipVideos?: () => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} kicker="Session controls">
      <p className="ia-sub">{status}</p>
      <div className="sheet-rows">
        {onNext && (
          <button className="sheet-row" onClick={onNext}>
            <span>Next item</span>
            <ChevronRight size={18} className="sheet-chev inline-icon" aria-hidden />
          </button>
        )}
        {onSkipVideos && (
          <button className="sheet-row" onClick={onSkipVideos}>
            <span className="sheet-row-label"><VideoOff size={18} aria-hidden /> Skip videos this session</span>
          </button>
        )}
        <button className="sheet-row" onClick={() => { onClose(); window.dispatchEvent(new Event("otium:app-menu")); }}>
          <span>Library, Saved and settings</span>
          <ChevronRight size={18} className="sheet-chev inline-icon" aria-hidden />
        </button>
        <button className="sheet-row" onClick={onEnd}>
          <span>End session</span>
          <ChevronRight size={18} className="sheet-chev inline-icon" aria-hidden />
        </button>
      </div>
    </BottomSheet>
  );
}
