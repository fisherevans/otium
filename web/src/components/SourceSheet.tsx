import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Source } from "@/api/client";
import { BottomSheet } from "./BottomSheet";
import { SourceItems } from "./SourceItems";
import { bucketOf, type Bucket } from "@/lib/represent";
import { RepresentationPicker } from "./RepresentationPicker";

// #75: the source context menu, reached by tapping the source name on a session
// card. A calm bottom sheet that keeps you in the session while you dig into or
// tune a source:
//   - Quick representation change - the same 5-bucket selector the library uses, applied
//     inline via api.updateSource (an explicit curation signal).
//   - View source history - the source's raw recent items (reuses SourceItems),
//     so you can see what else it puts out without leaving the session.
//   - Manage source settings - navigates to the full source page (/sources/:id)
//     for cap, topic membership, archive, delete.
//
// The internal `source` state seeds the weight bucket and also backstops the
// title through the sheet's exit animation (the parent clears the passed title
// on close, but this state persists), so the label doesn't blank as it slides.
export function SourceSheet({
  sourceId,
  sourceTitle,
  currentItemId,
  open,
  onClose,
}: {
  sourceId: number;
  sourceTitle?: string;
  currentItemId: number;
  open: boolean;
  onClose: () => void;
}) {
  const nav = useNavigate();
  const [source, setSource] = useState<Source | null>(null);
  const [bucket, setBucket] = useState<Bucket>("normal");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [history, setHistory] = useState(false);

  useEffect(() => {
    if (!open || !sourceId) return;
    let cancelled = false;
    setSource(null);
    setLoading(true);
    setError("");
    api
      .sources()
      .then((list) => {
        if (cancelled) return;
        const s = list.find((x) => x.id === sourceId) ?? null;
        setSource(s);
        if (s) setBucket(bucketOf(s.weight));
        else setError("This source is no longer available.");
      })
      .catch(() => { if (!cancelled) setError("Could not load this source. Try again."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, sourceId, loadAttempt]);

  // Collapse the history sub-sheet when the whole menu is dismissed.
  useEffect(() => {
    if (!open) setHistory(false);
  }, [open]);

  async function setWeight(b: Bucket) {
    if (saving) return;
    setSaving(true);
    setError("");
    try { await api.updateSource(sourceId, { weight_bucket: b }); setBucket(b); }
    catch (error: any) { setError(error.message || "Could not save representation. Try again."); }
    finally { setSaving(false); }
  }

  const title = sourceTitle || source?.title || "Source";

  return (
    <>
      {/* The menu hides while its history sub-sheet is up, then returns on back. */}
      <BottomSheet open={open && !history} onClose={onClose} kicker="Source">
        <div className="sheet-title">{title}</div>

        <div className="sheet-rep">
          <div className="ctl-label" style={{ margin: "0 0 6px" }}>
            Quick representation
          </div>
          <RepresentationPicker value={bucket} onChange={setWeight} disabled={saving || loading || !source} />
          {loading && <p role="status">Loading source…</p>}
          {error && <p className="err" role="alert">{error}</p>}
          {!loading && !source && <button className="btn ghost" onClick={() => setLoadAttempt((n) => n + 1)}>Retry</button>}
        </div>

        <div className="sheet-rows">
          <button className="sheet-row" onClick={() => setHistory(true)}>
            <span>View source history</span>
            <ChevronRight size={18} className="sheet-chev inline-icon" aria-hidden />
          </button>
          <button
            className="sheet-row"
            onClick={() => {
              onClose();
              nav(`/sources/${sourceId}`);
            }}
          >
            <span>Manage source settings</span>
            <ChevronRight size={18} className="sheet-chev inline-icon" aria-hidden />
          </button>
        </div>
      </BottomSheet>

      <SourceItems
        sourceId={sourceId}
        currentItemId={currentItemId}
        open={open && history}
        onClose={() => setHistory(false)}
        onOpen={(it) => window.open(it.url, "_blank", "noopener")}
      />
    </>
  );
}
