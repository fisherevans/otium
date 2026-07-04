import { useEffect, useState } from "react";
import { api, LIKED_SLUG, type Collection, type Item } from "@/api/client";
import { BottomSheet } from "./BottomSheet";

// Save picker (#57): the deliberate "set this aside" path. A calm sheet of
// collections with a checkmark per membership; tapping toggles it. "+ New
// collection" creates one inline and drops the item straight in. Saving here
// is organization only - it fires no engagement event and never re-ranks.
//
// The Liked collection is intentionally omitted: liking is the separate one-tap
// path on the action bar, not a save target. Everything else (Saved, Watch
// Later, and user lists) is a valid destination.
export function SavePicker({
  item,
  open,
  onClose,
}: {
  item: Item | null;
  open: boolean;
  onClose: () => void;
}) {
  const [cols, setCols] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || !item) return;
    setErr("");
    setCreating(false);
    setName("");
    setLoading(true);
    api
      .collections(item.id)
      .then((list) => setCols(list.filter((c) => c.slug !== LIKED_SLUG)))
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [open, item]);

  async function toggle(c: Collection) {
    if (!item || busy !== null) return;
    setBusy(c.id);
    const isIn = !!c.contains;
    try {
      if (isIn) await api.removeFromCollection(c.id, item.id);
      else await api.addToCollection(c.id, item.id);
      setCols((prev) =>
        prev.map((x) =>
          x.id === c.id ? { ...x, contains: !isIn, item_count: x.item_count + (isIn ? -1 : 1) } : x,
        ),
      );
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  async function createAndAdd() {
    if (!item) return;
    const n = name.trim();
    if (!n) return;
    setBusy(-1);
    try {
      const c = await api.createCollection(n);
      await api.addToCollection(c.id, item.id);
      setCols((prev) => [...prev, { ...c, contains: true, item_count: 1 }]);
      setCreating(false);
      setName("");
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} kicker="Save to">
      <div className="sheet-title" style={{ WebkitLineClamp: 2, display: "-webkit-box", WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {item?.title}
      </div>

      {err && <p className="err">{err}</p>}
      {loading ? (
        <p className="sub" style={{ padding: "10px 0" }}>Loading your collections…</p>
      ) : (
        <div className="sheet-rows">
          {cols.map((c) => (
            <button key={c.id} className="sheet-row" onClick={() => toggle(c)} disabled={busy !== null}>
              <span className="save-check" aria-hidden>{c.contains ? "◉" : "○"}</span>
              <span className="save-name">
                {c.name}
                {c.kind === "builtin" && <span className="save-kind"> · built-in</span>}
              </span>
              <span className="lib-count">{c.item_count}</span>
            </button>
          ))}

          {creating ? (
            <div className="lib-add">
              <input
                className="field"
                placeholder="New collection name"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createAndAdd()}
              />
              <div className="save-newrow">
                <button className="btn ghost" onClick={() => { setCreating(false); setName(""); }}>Cancel</button>
                <button className="btn" onClick={createAndAdd} disabled={!name.trim() || busy === -1}>
                  {busy === -1 ? "Creating…" : "Create & save"}
                </button>
              </div>
            </div>
          ) : (
            <button className="sheet-row" onClick={() => setCreating(true)}>
              <span className="save-check" aria-hidden>+</span>
              <span className="save-name">New collection</span>
              <span className="sheet-chev">▸</span>
            </button>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
