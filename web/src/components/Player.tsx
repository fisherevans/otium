import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { api, type Item } from "@/api/client";
import { InlineMedia } from "./InlineMedia";
import { SavePicker } from "./SavePicker";
import { Overlay, usePresence } from "./Overlay";
import { ContextInstrument } from "./ContextInstrument";
import "./session-afterglow.css";

// The same media controls and privacy preference used in a session, presented
// over the originating list. Closing keeps that list and its position intact.
export function Player({ item, sourceTitle, open, onClose, onOpenOriginal, onSave }: {
  item: Item | null;
  sourceTitle?: string;
  open: boolean;
  onClose: () => void;
  onOpenOriginal: () => void;
  onSave?: () => void;
}) {
  const previousItem = useRef(item);
  if (item) previousItem.current = item;
  const shown = item ?? previousItem.current;
  const { mounted, visible } = usePresence(open);
  const [ytHistory, setYtHistory] = useState(false);
  const [saveItem, setSaveItem] = useState<Item | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.getSettings().then((settings) => { if (!cancelled) setYtHistory(settings.youtube_history); }).catch(() => {});
    return () => { cancelled = true; };
  }, [open]);
  if (!mounted || !shown) return null;
  return (
    <>
    <Overlay active={open} label={shown.title} onClose={onClose}>
      <div className={`readerpage afterglow-reader reader-player ${visible ? "in" : ""}`}>
        <div className="readerpage-head">
          <span className="rp-section-label">{shown.media_type === "audio" ? "Audio" : "Video"}</span>
          <span className="rp-readtime">{sourceTitle}</span>
        </div>
        <div className="readerpage-body reader-player-body">
          <h1 className="rp-title">{shown.title}</h1>
          {open && <InlineMedia key={shown.id} item={shown} onSave={onSave ?? (() => setSaveItem(shown))} onOpenOriginal={onOpenOriginal} ytHistory={ytHistory} />}
        </div>
        <ContextInstrument mode="reader" eyebrow={shown.media_type === "audio" ? "Audio" : "Video"} label={sourceTitle || "Player"}
          action={{ label: "Back", onClick: onClose, icon: <ChevronLeft size={18} aria-hidden /> }} />
      </div>
    </Overlay>
    <SavePicker item={saveItem} open={saveItem !== null} onClose={() => setSaveItem(null)} />
    </>
  );
}
