import { useSyncExternalStore } from "react";
import { Volume2, VolumeX, Captions, CaptionsOff } from "lucide-react";
import { formatClock, type ShortsBus } from "@/lib/shortsBus";

// #182: the Shorts card's playback controls, folded into its footer instead of a
// labelled row under the video. Sound and CC are bare icons that read as state
// (struck through when off); time left rides on the date line. Only the card
// hosting the player is connected; the rest show the clip's length.
export function ShortsMeta({ bus, age, duration }: { bus?: ShortsBus; age: string; duration: number }) {
    const state = useSyncExternalStore(bus?.subscribe ?? noopSubscribe, bus?.get ?? nullState, nullState);
    const total = state?.total || duration;
    const time = !total ? "" : state && state.at > 0 ? `${formatClock(total - state.at)} left` : formatClock(total);
    return <span className="shorts-age">{[age, time].filter(Boolean).join(" · ")}</span>;
}

export function ShortsQuietControls({ bus }: { bus: ShortsBus }) {
    const state = useSyncExternalStore(bus.subscribe, bus.get, bus.get);
    if (state.native) return null; // YouTube's own controls are showing
    return (
        <span className="shorts-quiet" role="group" aria-label="Playback">
            <button type="button" className="shorts-quiet-btn" onClick={bus.controls.toggleSound}
                aria-label={state.muted ? "Turn sound on" : "Mute video"} aria-pressed={!state.muted} data-on={!state.muted}>
                {state.muted ? <VolumeX size={19} strokeWidth={1.7} aria-hidden /> : <Volume2 size={19} strokeWidth={1.7} aria-hidden />}
            </button>
            <button type="button" className="shorts-quiet-btn" onClick={bus.controls.toggleCaptions}
                aria-label="Captions" aria-pressed={state.captions} data-on={state.captions}>
                {state.captions ? <Captions size={19} strokeWidth={1.7} aria-hidden /> : <CaptionsOff size={19} strokeWidth={1.7} aria-hidden />}
            </button>
        </span>
    );
}

const noopSubscribe = () => () => {};
const nullState = () => null;
