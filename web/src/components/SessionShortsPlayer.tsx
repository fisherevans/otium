import { useEffect, useLayoutEffect, useRef, type ComponentProps, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Item } from "@/api/client";
import { InlineMedia } from "./InlineMedia";

type Props = ComponentProps<typeof InlineMedia> & {
    stage: RefObject<HTMLDivElement | null>;
    index: number;
    visible: boolean;
    nextItem?: Item;
};

// The iframe stays in one DOM location for the whole session. Moving an iframe
// between cards reloads it in WebKit and loses the user's sound permission.
// A measured slot keeps the shared card solver in charge of its geometry.
export function SessionShortsPlayer({ stage, index, visible, nextItem, ...media }: Props) {
    const root = useRef<HTMLDivElement>(null);
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
                left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`,
                visibility: "visible",
                clipPath: `inset(${Math.max(0, bounds.top - box.top)}px 0 ${Math.max(0, box.bottom - bounds.bottom)}px 0)`,
            });
            container.style.setProperty("--shorts-frame-height", `${frame?.offsetHeight ?? 0}px`);
        };
        align();
        const observer = new ResizeObserver(align);
        observer.observe(slot);
        observer.observe(reel);
        reel.addEventListener("scroll", align, { passive: true });
        window.addEventListener("resize", align);
        window.visualViewport?.addEventListener("resize", align);
        return () => {
            observer.disconnect();
            reel.removeEventListener("scroll", align);
            window.removeEventListener("resize", align);
            window.visualViewport?.removeEventListener("resize", align);
        };
    }, [stage, index, visible, media.item.id]);

    useEffect(() => {
        if (!visible || !nextItem?.thumbnail_url) return;
        // YouTube's cue API does not buffer video bytes. Warm the next poster
        // while the current clip plays; the already-live player loads its video.
        const poster = new Image();
        poster.src = nextItem.thumbnail_url;
        void poster.decode?.().catch(() => {});
    }, [visible, nextItem?.thumbnail_url]);

    return createPortal(<div ref={root} className="session-shorts-player" data-active={visible} inert={!visible}
        style={{ visibility: "hidden" }}>
        <InlineMedia {...media} active={visible && media.active} compact autoPlay />
    </div>, document.body);
}
