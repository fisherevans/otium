import { useEffect, useState } from "react";
import { api, type Item } from "@/api/client";
import { BottomSheet } from "./BottomSheet";
import { relDate } from "@/lib/format";

// See-in-context drill-in (#43.4 / #38 surfaced in-session). Lists the source's
// recent raw items so you can see where the current item sits in the interest -
// what came before/after it, how active the source is. Read-only: this is
// orientation, not consumption, so it emits no seen/open/skip events.
export function SourceItems({
  sourceId,
  currentItemId,
  open,
  onClose,
  onOpen,
}: {
  sourceId: number;
  currentItemId: number;
  open: boolean;
  onClose: () => void;
  onOpen: (item: Item) => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || !sourceId) return;
    setItems(null);
    setErr("");
    api
      .sourceItems(sourceId)
      .then(setItems)
      .catch((e) => setErr(String(e.message ?? e)));
  }, [open, sourceId]);

  return (
    <BottomSheet open={open} onClose={onClose} variant="tall" kicker="Raw interest">
      <div className="src-items">
        {err && <p className="err">{err}</p>}
        {!err && items === null && <p className="src-items-load">loading interest…</p>}
        {items && items.length === 0 && <p className="src-items-load">No recent items.</p>}
        {items?.map((it) => (
          <button
            key={it.id}
            className={`interest-item ${it.id === currentItemId ? "here" : ""}`}
            onClick={() => onOpen(it)}
          >
            <b>{it.title}</b>
            <span>
              {it.id === currentItemId ? "in this session · " : ""}
              {it.media_type}
              {it.published_at ? ` · ${relDate(it.published_at)}` : ""}
            </span>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
