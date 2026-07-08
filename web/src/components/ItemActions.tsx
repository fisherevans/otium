import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Item, type Selected, type Source } from "@/api/client";
import { BottomSheet } from "./BottomSheet";
import { bucketOf } from "@/lib/weight";
import { REP_LABEL } from "@/lib/represent";
import { RepDots } from "./RepDots";

// The "…" overflow for the current session item (#43), restyled to match the
// management surfaces (#120): the item's rank score with a chronological note (a
// source's articles are surfaced newest-first), the source's representation shown
// read-only exactly as the source page shows it, then the plain actions. Editing
// representation now lives on the source page - "View source" jumps straight there
// (the session is durable, so it resumes). Nothing here emits an engagement event.
export function ItemActions({
  selected,
  open,
  onClose,
  onRead,
  onSave,
  onWhy,
}: {
  selected: Selected | null;
  open: boolean;
  onClose: () => void;
  onRead: () => void;
  onSave?: (item: Item) => void;
  onWhy: () => void;
}) {
  const nav = useNavigate();
  const item = selected?.item ?? null;
  const sourceId = item?.source_id ?? 0;
  const [source, setSource] = useState<Source | null>(null);

  useEffect(() => {
    if (!open || !sourceId) return;
    api
      .sources()
      .then((list) => setSource(list.find((x) => x.id === sourceId) ?? null))
      .catch(() => {});
  }, [open, sourceId]);

  if (!item) return null;

  const bucket = source ? bucketOf(source.weight) : "normal";
  const score = selected?.score ?? 0;

  return (
    <BottomSheet open={open} onClose={onClose} kicker={selected?.source_title ?? "Item"}>
      <div className="ia-title">{item.title}</div>

      {/* Score + chronological note, mirroring the source drill-down. */}
      <div className="ia-scoreline">
        <span className="va-bar" aria-hidden>
          <span className="va-bar-fill" style={{ width: `${Math.round(Math.min(1, score) * 100)}%` }} />
        </span>
        <span className="va-score">{score.toFixed(2)}</span>
        <button className="va-explore" onClick={onWhy}>
          explore score
        </button>
      </div>
      <p className="ia-sub">Surfaced by recency - a source's articles come up newest first.</p>

      {/* Representation, read-only, exactly as the source page renders it. */}
      <div className="ia-rep">
        <RepDots bucket={bucket} />
        <span className="ia-rep-label">{REP_LABEL[bucket]}</span>
      </div>

      <div className="sheet-rows">
        <button className="sheet-row" onClick={onRead}>
          <span>Read in app</span>
          <span className="sheet-chev">▸</span>
        </button>
        {onSave && (
          <button className="sheet-row" onClick={() => onSave(item)}>
            <span>Save to collection</span>
            <span className="sheet-chev">▸</span>
          </button>
        )}
        <button className="sheet-row" onClick={() => nav(`/sources/${sourceId}`)}>
          <span>View source</span>
          <span className="sheet-chev">▸</span>
        </button>
      </div>
    </BottomSheet>
  );
}
