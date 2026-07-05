import { useState } from "react";
import { ExternalLink, Bookmark, MoreHorizontal, Link2, Share2 } from "lucide-react";
import type { Item } from "@/api/client";
import { BottomSheet } from "./BottomSheet";

// Header action cluster for the reader/player title bar (#77, delivers #56).
// The two primary actions (Save, Open source) sit as flat icons next to the X so
// they're reachable without scrolling; a "···" overflow parks Copy link (#56
// clipboard) and Share (Web Share API - the Android system share sheet on the
// Palma). Sharing the original `item.url` is not an engagement signal, so nothing
// here fires an item event.
export function ReaderHeaderActions({
  item,
  onSave,
  onOpen,
}: {
  item: Item;
  onSave?: () => void;
  onOpen: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState("");
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? "" : t)), 1800);
  }
  async function copyLink() {
    setMenu(false);
    try {
      await navigator.clipboard.writeText(item.url);
      flash("Link copied");
    } catch {
      flash("Couldn't copy the link");
    }
  }
  async function share() {
    setMenu(false);
    try {
      await navigator.share({ title: item.title, url: item.url });
    } catch {
      // user dismissed the share sheet, or it's unsupported - stay calm, no toast.
    }
  }

  return (
    <div className="head-actions">
      {onSave && (
        <button className="head-act" onClick={onSave} aria-label="Save">
          <Bookmark size={18} strokeWidth={1.75} aria-hidden />
        </button>
      )}
      <button className="head-act" onClick={onOpen} aria-label="Open source">
        <ExternalLink size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <button className="head-act" onClick={() => setMenu(true)} aria-label="More actions">
        <MoreHorizontal size={18} strokeWidth={1.75} aria-hidden />
      </button>

      <BottomSheet open={menu} onClose={() => setMenu(false)} kicker="Share">
        <div className="sheet-rows">
          <button className="sheet-row" onClick={copyLink}>
            <span>Copy link</span>
            <Link2 size={17} strokeWidth={1.75} aria-hidden />
          </button>
          {canShare && (
            <button className="sheet-row" onClick={share}>
              <span>Share…</span>
              <Share2 size={17} strokeWidth={1.75} aria-hidden />
            </button>
          )}
        </div>
      </BottomSheet>

      {toast && <div className="toast over-sheet">{toast}</div>}
    </div>
  );
}
