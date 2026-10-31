import { Check, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Selected, type Source } from "@/api/client";
import { BottomSheet } from "./BottomSheet";
import { bucketOf, REP_LABEL } from "@/lib/represent";
import { RepDots } from "./RepDots";
import { renderSummary } from "@/lib/html";

// Details for the current session item (#180): where it came from and why it
// surfaced - source and topic, the selection reason, its rank score, the source's
// representation (read-only, as the source page shows it) - plus the filter that
// keeps this kind of post out of future sessions. What to DO with the item (share,
// download, open elsewhere) lives in ItemActions, a separate sheet. Nothing here
// emits an engagement event.
export function ItemDetails({
  selected,
  open,
  onClose,
  onWhy,
  onActions,
}: {
  selected: Selected | null;
  open: boolean;
  onClose: () => void;
  onWhy: () => void;
  onActions?: () => void;
}) {
  const nav = useNavigate();
  const item = selected?.item ?? null;
  const sourceId = item?.source_id ?? 0;
  const [source, setSource] = useState<Source | null>(null);

  // #142: "filter this out" - mute the item's RSS categories or add a word filter
  // to its source, straight from the card. `muted` tracks what's been muted this
  // open so the chip shows confirmed; `note` is the calm confirmation line.
  const [muted, setMuted] = useState<string[]>([]);
  const [kwOpen, setKwOpen] = useState(false);
  const [kw, setKw] = useState("");
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (note) noteRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [note]);

  useEffect(() => {
    if (!open || !sourceId) return;
    api
      .sources()
      .then((list) => setSource(list.find((x) => x.id === sourceId) ?? null))
      .catch(() => {});
  }, [open, sourceId]);

  // Reset the filter UI each time the sheet opens on a fresh item.
  useEffect(() => {
    setMuted([]);
    setKwOpen(false);
    setKw("");
    setNote("");
  }, [open, item?.id]);

  if (!item) return null;

  const sourceLabel = selected?.source_title ?? source?.title ?? "this source";
  async function muteCategory(cat: string) {
    if (!item || muted.includes(cat)) return;
    setNote("");
    setMuted((m) => [...m, cat]);
    try {
      await api.filterFromItem(item.id, { categories: [cat] });
      setNote(`Muted “${cat}” from ${sourceLabel} - new posts in it won't surface.`);
    } catch {
      setMuted((m) => m.filter((c) => c !== cat));
      setNote("Couldn't save that filter - try again.");
    }
  }
  async function addKeyword() {
    const word = kw.trim();
    if (!item || !word) return;
    setNote("");
    try {
      await api.filterFromItem(item.id, { keywords: [word] });
      setNote(`Muted posts from ${sourceLabel} with “${word}” in the title.`);
      setKw("");
      setKwOpen(false);
    } catch {
      setNote("Couldn't save that filter - try again.");
    }
  }

  const categories = item.categories ?? [];

  const bucket = source ? bucketOf(source.weight) : "normal";
  const score = selected?.score ?? 0;

  return (
    <BottomSheet open={open} onClose={onClose} kicker="Details">
      <div className="ia-title">{item.title}</div>
      <p className="ia-sub">{[selected?.source_title, selected?.topic?.name, formatDate(item.published_at)].filter(Boolean).join(" · ")}</p>
      {item.media_type === "short" && <div className="shorts-details-copy" dangerouslySetInnerHTML={{ __html: renderSummary(item.content?.trim() ? item.content : item.summary).html }} />}

      {/* Score + chronological note, mirroring the source drill-down. */}
      <div className="ia-scoreline">
        <span className="va-bar" aria-hidden>
          <span className="va-bar-fill" style={{ width: `${Math.round(Math.min(1, score) * 100)}%` }} />
        </span>
        <span className="va-score">{score.toFixed(2)}</span>
        <button className="va-explore" onClick={onWhy}>
          Explore score
        </button>
      </div>
      <p className="ia-sub">Surfaced by recency - a source's articles come up newest first.</p>

      {/* Representation, read-only, exactly as the source page renders it. */}
      <div className="ia-rep">
        <RepDots bucket={bucket} />
        <span className="ia-rep-label">{REP_LABEL[bucket]}</span>
      </div>

      {selected?.reason && <p className="ia-sub">{selected.reason}</p>}

      <div className="sheet-rows">
        <button className="sheet-row" onClick={() => nav(`/sources/${sourceId}`)}>
          <span>About {sourceLabel}</span>
          <ChevronRight size={18} className="sheet-chev inline-icon" aria-hidden />
        </button>
        {onActions && (
          <button className="sheet-row" onClick={onActions}>
            <span>Share, download and open</span>
            <ChevronRight size={18} className="sheet-chev inline-icon" aria-hidden />
          </button>
        )}
      </div>

      {/* #142: filter this kind of post out of future sessions. Tap a category to
          mute it, or add a word from the title - both apply to this source going
          forward (obituaries, legal notices, and the like). */}
      <div className="ia-filter">
        <div className="ia-filter-label">Filter out of future sessions</div>
        {categories.length > 0 ? (
          <div className="ia-filter-chips">
            {categories.map((c) => {
              const done = muted.includes(c);
              return (
                <button
                  key={c}
                  className={`ia-fchip ${done ? "done" : ""}`}
                  disabled={done}
                  onClick={() => muteCategory(c)}
                >
                  {done && <Check size={15} className="inline-icon" aria-hidden />} {c}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="ia-filter-empty">This post carries no category tags to filter on.</p>
        )}
        {!kwOpen ? (
          <button className="ia-filter-word" onClick={() => setKwOpen(true)}>
            or filter by a word in the title…
          </button>
        ) : (
          <div className="ia-kw">
            <input
              className="field"
              placeholder="word or phrase in the title"
              value={kw}
              autoFocus
              onChange={(e) => setKw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addKeyword()}
            />
            <button className="btn" onClick={addKeyword} disabled={!kw.trim()}>
              Mute
            </button>
          </div>
        )}
        {note && <p className="ia-filter-note" ref={noteRef} role="status">{note}</p>}
      </div>
    </BottomSheet>
  );
}

function formatDate(iso: string) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
}
