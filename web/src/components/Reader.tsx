import { useState, type ComponentProps } from "react";
import type { Item } from "@/api/client";
import { ReaderPage } from "./ReaderPage";
import { SavePicker } from "./SavePicker";

// Existing lists use the same full-text reader as a session. Keeping the list
// mounted preserves its selected collection, filters, and scroll position.
export function Reader(props: Omit<ComponentProps<typeof ReaderPage>, "onNext" | "preloaded">) {
  const [saveItem, setSaveItem] = useState<Item | null>(null);
  return (
    <>
      <ReaderPage {...props} onSave={props.onSave ?? (() => setSaveItem(props.item))} />
      <SavePicker item={saveItem} open={saveItem !== null} onClose={() => setSaveItem(null)} />
    </>
  );
}
