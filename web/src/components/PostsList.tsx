import { useState } from "react";
import type { Item } from "@/api/client";
import { Reader } from "./Reader";
import { Player } from "./Player";
import { relTime } from "@/lib/format";

// The posts section shared by the source page and feed page (#66). Lists an
// item set newest-first and opens each into the in-app reader/player (mirroring
// CollectionsPage), so you can see a source/feed's actual content next to its
// settings. This is orientation, not consumption: opening here builds no session
// and emits no engagement events.
function contentKind(item: Item): "video" | "audio" | "read" {
  if (item.media_type === "short" || item.media_type === "long" || item.media_type === "live") return "video";
  if (item.media_type === "audio") return "audio";
  return "read";
}

export function PostsList({
  items,
  loading,
  emptyText = "No recent posts.",
  showSource = false,
}: {
  items: Item[] | null;
  loading: boolean;
  emptyText?: string;
  showSource?: boolean;
}) {
  const [content, setContent] = useState<Item | null>(null);
  const shownKind = content ? contentKind(content) : null;

  return (
    <>
      {loading ? (
        <p className="sub">Loading posts…</p>
      ) : !items || items.length === 0 ? (
        <p className="sub" style={{ padding: "12px 0" }}>{emptyText}</p>
      ) : (
        items.map((it) => (
          <div className="lib-row" key={it.id}>
            <div className="lib-head" onClick={() => setContent(it)} style={{ cursor: "pointer" }}>
              <div className="nm">
                <b>{it.title}</b>
                <span>
                  {it.media_type}
                  {showSource && it.author ? ` · ${it.author}` : ""}
                  {it.published_at ? ` · ${relTime(it.published_at)}` : ""}
                </span>
              </div>
              <span className="chev">▸</span>
            </div>
          </div>
        ))
      )}

      <Reader
        item={content && shownKind === "read" ? content : null}
        open={content !== null && shownKind === "read"}
        onClose={() => setContent(null)}
        onOpen={() => content && window.open(content.url, "_blank", "noopener")}
      />
      <Player
        item={content && shownKind !== "read" ? content : null}
        open={content !== null && shownKind !== "read"}
        onClose={() => setContent(null)}
        onOpenOriginal={() => content && window.open(content.url, "_blank", "noopener")}
      />
    </>
  );
}
