import { useState } from "react";
import { ExternalLink, Bookmark, Link2, Share2, Check, Heart } from "lucide-react";
import type { Item } from "@/api/client";
import { canWebShare, copyText, shareOrCopy } from "@/lib/share";

// Share / copy-link, surfaced as visible actions (#92). These used to hide in a
// "···" overflow, which Fisher couldn't find or couldn't get to work on the
// Palma browser. Now Copy link + Share sit out in the open (reader header + card
// callout), each with a reliable fallback: clipboard -> execCommand -> a
// manual-select panel, always with a visible "copied" confirmation. Sharing the
// original url is not an engagement signal, so nothing here fires an item event.

// ManualCopy is the last-resort path when both clipboard strategies fail: show
// the url in an auto-selected readonly field so the user can long-press -> copy.
function ManualCopy({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="copy-manual-scrim" onClick={onClose}>
      <div className="copy-manual" onClick={(e) => e.stopPropagation()}>
        <p className="copy-manual-lead">Copy this link</p>
        <input
          className="copy-manual-field"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          ref={(el) => {
            if (el) {
              el.focus();
              el.select();
            }
          }}
        />
        <p className="copy-manual-hint">Press and hold to select, then Copy.</p>
        <button className="btn ghost" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

// ShareActions renders the visible Copy link + Share pair. `labeled` shows text
// beside the icons (reader header); the default is icon-only (tight rows).
export function ShareActions({ item, labeled }: { item: Item; labeled?: boolean }) {
  const [toast, setToast] = useState("");
  const [manual, setManual] = useState(false);
  const cls = labeled ? "share-act labeled" : "share-act";

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? "" : t)), 1800);
  }
  async function onCopy() {
    if (await copyText(item.url)) flash("Link copied");
    else setManual(true);
  }
  async function onShare() {
    const r = await shareOrCopy({ title: item.title, url: item.url });
    if (r === "copied") flash("Link copied");
    else if (r === "failed") setManual(true);
    // "shared" -> the native sheet handled it; no confirmation needed.
  }

  return (
    <>
      <button className={cls} onClick={onCopy} aria-label="Copy link">
        <Link2 size={18} strokeWidth={1.75} aria-hidden />
        {labeled && <span>Copy link</span>}
      </button>
      {canWebShare() && (
        <button className={cls} onClick={onShare} aria-label="Share">
          <Share2 size={18} strokeWidth={1.75} aria-hidden />
          {labeled && <span>Share</span>}
        </button>
      )}
      {manual && <ManualCopy url={item.url} onClose={() => setManual(false)} />}
      {toast && (
        <div className="toast over-sheet">
          <Check size={15} strokeWidth={2} aria-hidden /> {toast}
        </div>
      )}
    </>
  );
}

// Header action cluster for the reader/player sheet title bar (used by the Player
// and the shared Reader sheet). Save + Open source as flat icons, then the
// now-visible Copy link + Share (#92) - no more "···" overflow.
export function ReaderHeaderActions({
  item,
  onSave,
  onOpen,
  liked,
  onLike,
}: {
  item: Item;
  onSave?: () => void;
  onOpen: () => void;
  // Like lives in the header too (#1) when the surface wires it (the video/audio
  // Player). Omitted -> no heart, so the text Reader sheet is unchanged.
  liked?: boolean;
  onLike?: () => void;
}) {
  return (
    <div className="head-actions">
      {onLike && (
        <button className={`head-act ${liked ? "on" : ""}`} onClick={onLike} aria-label={liked ? "Unlike" : "Like"}>
          <Heart size={18} strokeWidth={1.75} fill={liked ? "currentColor" : "none"} aria-hidden />
        </button>
      )}
      {onSave && (
        <button className="head-act" onClick={onSave} aria-label="Save">
          <Bookmark size={18} strokeWidth={1.75} aria-hidden />
        </button>
      )}
      <button className="head-act" onClick={onOpen} aria-label="Open source">
        <ExternalLink size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <ShareActions item={item} />
    </div>
  );
}
