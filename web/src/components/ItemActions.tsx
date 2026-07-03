import { useEffect, useState } from "react";
import { api, type Item, type Selected, type Source } from "@/api/client";
import { BottomSheet } from "./BottomSheet";
import { Reader } from "./Reader";
import { SourceDetail } from "./SourceDetail";
import { SourceItems } from "./SourceItems";
import { BUCKETS, BLABEL, bucketOf, type Bucket } from "@/lib/weight";

type Sub = null | "reader" | "detail" | "items";

// The "…" overflow container for the current session item (#43). Keeps the four
// primary bar actions (Open/Like/Save/Next) calm by parking the deeper actions
// here: read in app (#41), change the source's weighting inline (#14), open full
// source details (#9), and see the item in its raw feed (#38). It owns the sub
// sheets so SessionPage only tracks one boolean. None of these surfaces emit
// engagement events - the only signal produced here is an explicit weight change.
export function ItemActions({
  selected,
  open,
  onClose,
  onOpen,
}: {
  selected: Selected | null;
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
}) {
  const item = selected?.item ?? null;
  const sourceId = item?.source_id ?? 0;

  const [source, setSource] = useState<Source | null>(null);
  const [bucket, setBucket] = useState<Bucket>("normal");
  const [sub, setSub] = useState<Sub>(null);

  useEffect(() => {
    if (!open || !sourceId) return;
    api
      .sources()
      .then((list) => {
        const s = list.find((x) => x.id === sourceId) ?? null;
        setSource(s);
        if (s) setBucket(bucketOf(s.weight));
      })
      .catch(() => {});
  }, [open, sourceId]);

  // Reset drill-in state when the menu is fully dismissed.
  useEffect(() => {
    if (!open) setSub(null);
  }, [open]);

  function reloadSource() {
    api
      .sources()
      .then((list) => setSource(list.find((x) => x.id === sourceId) ?? null))
      .catch(() => {});
  }

  async function setWeight(b: Bucket) {
    setBucket(b);
    await api.updateSource(sourceId, { weight_bucket: b }).catch(() => {});
    reloadSource();
  }

  if (!item) return null;

  return (
    <>
      {/* The menu itself hides while a drill-in is up, then returns on back. */}
      <BottomSheet open={open && sub === null} onClose={onClose} kicker={selected?.source_title ?? "Actions"}>
        <div className="sheet-title">{item.title}</div>

        <div className="sheet-rows">
          <button className="sheet-row" onClick={() => setSub("reader")}>
            <span>Read in app</span>
            <span className="sheet-chev">▸</span>
          </button>

          <div className="sheet-weight">
            <div className="ctl-label" style={{ margin: "0 0 6px" }}>
              Source weighting
            </div>
            <div className="wbuckets">
              {BUCKETS.map((b) => (
                <button key={b} className={`wbucket ${bucket === b ? "on" : ""}`} onClick={() => setWeight(b)}>
                  {BLABEL[b]}
                </button>
              ))}
            </div>
          </div>

          <button className="sheet-row" onClick={() => setSub("detail")}>
            <span>Source details</span>
            <span className="sheet-chev">▸</span>
          </button>

          <button className="sheet-row" onClick={() => setSub("items")}>
            <span>See in context</span>
            <span className="sheet-chev">▸</span>
          </button>
        </div>
      </BottomSheet>

      <Reader
        item={item}
        sourceTitle={selected?.source_title}
        open={open && sub === "reader"}
        onClose={() => setSub(null)}
        onOpen={onOpen}
      />

      <SourceDetail
        source={source}
        open={open && sub === "detail"}
        onClose={() => setSub(null)}
        onChanged={() => {
          reloadSource();
        }}
      />

      <SourceItems
        sourceId={sourceId}
        currentItemId={item.id}
        open={open && sub === "items"}
        onClose={() => setSub(null)}
        onOpen={(it: Item) => window.open(it.url, "_blank", "noopener")}
      />
    </>
  );
}
