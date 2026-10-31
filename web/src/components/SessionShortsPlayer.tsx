import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Item } from "@/api/client";
import { InlineMedia } from "./InlineMedia";
import { setDriftProbe } from "@/lib/perf";

type Props = ComponentProps<typeof InlineMedia> & {
    stage: RefObject<HTMLDivElement | null>;
    index: number;
    visible: boolean;
    nextItem?: Item;
};

// The iframe stays in one DOM location for the whole session. Moving an iframe
// between cards reloads it in WebKit and loses the user's sound permission.
//
// #182: that location is inside the reel's scroll content, absolutely positioned
// over the hosting card's measured slot. It scrolls with the card on the
// compositor, so a swipe moves video and card together even while YouTube keeps
// the main thread busy. (It used to be position: fixed in <body>, re-aligned from
// scroll events, which lagged behind the card on iOS.) It only re-measures when
// the hosting card or the layout changes, never per scroll frame. The page moves
// the player to a new card only once the scroll settles.
export function SessionShortsPlayer({ stage, index, visible, nextItem, ...media }: Props) {
    const root = useRef<HTMLDivElement>(null);
    const [host, setHost] = useState<HTMLElement | null>(null);
    useLayoutEffect(() => { setHost(stage.current); }, [stage]);

    useLayoutEffect(() => {
        const reel = stage.current;
        const container = root.current;
        const slot = reel?.querySelector<HTMLElement>(`[data-idx="${index}"] .shorts-player-slot`);
        if (!reel || !container || !slot || !visible) {
            if (container) container.style.visibility = "hidden";
            return;
        }
        const align = () => {
            const bounds = reel.getBoundingClientRect();
            const box = slot.getBoundingClientRect();
            const frame = slot.querySelector<HTMLElement>(".im-frame");
            Object.assign(container.style, {
                top: `${box.top - bounds.top + reel.scrollTop}px`,
                left: `${box.left - bounds.left + reel.scrollLeft}px`,
                width: `${box.width}px`,
                visibility: "visible",
            });
            container.style.setProperty("--shorts-frame-height", `${frame?.offsetHeight ?? 0}px`);
            // Full-screen Shorts (#184) fill the whole slot, i.e. the card.
            container.style.setProperty("--shorts-slot-height", `${box.height}px`);
        };
        align();
        setDriftProbe(() => {
            const frame = container.querySelector(".im-frame")?.getBoundingClientRect();
            const target = slot.querySelector(".im-frame")?.getBoundingClientRect();
            return frame && target ? Math.abs(frame.top - target.top) : 0;
        });
        const observer = new ResizeObserver(align);
        observer.observe(slot);
        observer.observe(reel);
        return () => {
            setDriftProbe(null);
            observer.disconnect();
        };
    }, [stage, host, index, visible, media.item.id]);

    useEffect(() => {
        if (!visible || !nextItem?.thumbnail_url) return;
        // YouTube's cue API does not buffer video bytes. Warm the next poster
        // while the current clip plays; the already-live player loads its video.
        const poster = new Image();
        poster.src = nextItem.thumbnail_url;
        void poster.decode?.().catch(() => {});
    }, [visible, nextItem?.thumbnail_url]);

    if (!host) return null;
    return createPortal(<div ref={root} className="session-shorts-player" data-active={visible} inert={!visible}
        style={{ visibility: "hidden" }}>
        <InlineMedia {...media} active={visible && media.active} compact autoPlay />
    </div>, host);
}
