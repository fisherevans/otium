import { useMemo, type CSSProperties } from "react";
import type { Item } from "@/api/client";
import { BottomSheet } from "./BottomSheet";
import { fmtDate } from "@/lib/format";
import { parseYouTubeId, embedUrl } from "@/lib/youtube";

// Inline media player (#51). A video/audio item is consumed IN the session -
// an embedded youtube-nocookie iframe or a native <audio> element in a tall
// sheet - rather than bouncing to youtube.com. The video is the one place
// full-color content is intentional (function over the grayscale aesthetic);
// the card's preview thumbnail stays dithered, the player is the real thing
// once invoked. "Open original" is the secondary path (source page / app).
//
// The open engagement signal is owned by SessionPage (recordOpen fires it once
// when the surface is invoked); this component emits nothing itself.
//
// Frame styling is inline (not in global.css) on purpose: a parallel agent is
// editing global.css, so #51 keeps its own small footprint out of the contended
// file. Everything else reuses the existing .reader-* / .btn classes.

const frameBase: CSSProperties = {
  position: "relative",
  overflow: "hidden",
  background: "var(--paper-3)",
  border: "1.5px solid var(--rule-hard)",
  margin: "6px 0 16px",
};
const frameH: CSSProperties = { ...frameBase, width: "100%", aspectRatio: "16 / 9" };
const frameV: CSSProperties = {
  ...frameBase,
  aspectRatio: "9 / 16",
  height: "min(70dvh, 70vh)",
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
}: {
  item: Item | null;
  sourceTitle?: string;
  open: boolean;
  onClose: () => void;
  onOpenOriginal: () => void;
  // When present, a "Save" affordance opens the collection picker (#57).
  onSave?: () => void;
}) {
  const isVideo = item ? ["short", "long", "live"].includes(item.media_type) : false;
  const isAudio = item?.media_type === "audio";
  const vertical = item?.media_type === "short";
  const ytId = useMemo(() => (isVideo ? parseYouTubeId(item?.url) : null), [isVideo, item?.url]);

  return (
    <BottomSheet open={open} onClose={onClose} variant="tall" kicker={item?.media_type ?? ""}>
      {item && (
        <div className="reader">
          {isVideo && ytId ? (
            <div style={vertical ? frameV : frameH}>
              <iframe
                style={iframeStyle}
                src={embedUrl(ytId)}
                title={item.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                loading="lazy"
              />
            </div>
          ) : isAudio ? (
            <audio style={{ width: "100%", margin: "8px 0 16px" }} src={item.url} controls preload="none" />
          ) : (
            <div className="reader-empty">
              <p className="reader-empty-lead">Can't play this one in place.</p>
              <p>It lives somewhere that won't embed - open it at the source.</p>
              <button className="btn" onClick={onOpenOriginal}>
                Open original ↗
              </button>
            </div>
          )}

          <h3 className="reader-title">{item.title}</h3>
          <div className="reader-meta">
            {sourceTitle && <span>{sourceTitle}</span>}
            {sourceTitle && item.author && <span>·</span>}
            {item.author && <span>{item.author}</span>}
            {(sourceTitle || item.author) && item.published_at && <span>·</span>}
            {item.published_at && <span>{fmtDate(item.published_at)}</span>}
          </div>

          <div className="reader-foot">
            <span>otium · playing in place</span>
            <span className="reader-foot-actions">
              {onSave && (
                <button className="reader-open" onClick={onSave}>
                  Save
                </button>
              )}
              <button className="reader-open" onClick={onOpenOriginal}>
                Open original ↗
              </button>
            </span>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
