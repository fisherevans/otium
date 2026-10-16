import { useSearchParams } from "react-router-dom";
import CollectionsPage from "@/pages/CollectionsPage";
import HistoryPage from "@/pages/HistoryPage";

// The Saved tab (#84, Model A). One calm home for the two "things I've set aside
// or already seen" surfaces: Collections and History. A segmented control swaps
// between them; each renders the existing page body in embedded mode (no back
// link, no duplicate title) so this is pure re-homing, not a rebuild. The
// standalone /collections and /history routes still exist for deep links.
type Seg = "collections" | "history";

const SEGS: { key: Seg; label: string }[] = [
  { key: "collections", label: "Collections" },
  { key: "history", label: "History" },
];

export default function SavedPage() {
  const [params, setParams] = useSearchParams();
  const seg: Seg = params.get("view") === "history" ? "history" : "collections";

  return (
    <div>
      <div className="lib-topbar">
        <h1 className="display">Saved</h1>
      </div>

      <div className="lib-filter" role="tablist" aria-label="Saved view">
        {SEGS.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={seg === s.key}
            className={`lib-fchip ${seg === s.key ? "on" : ""}`}
            onClick={() => { const next = new URLSearchParams(params); next.set("view", s.key); setParams(next); }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {seg === "collections" ? <CollectionsPage embedded /> : <HistoryPage embedded />}
    </div>
  );
}
