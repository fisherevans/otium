import { useMemo } from "react";
import type { Item } from "@/api/client";
import { BottomSheet } from "./BottomSheet";
import { renderSummary } from "@/lib/html";
import { fmtDate } from "@/lib/format";

// In-app reader (#41). Renders the item's stored text inline so a session
// doesn't have to bounce to a browser tab. Prefers the full body (`content`,
// content:encoded stored raw at ingest - #58) and falls back to the short
// `summary` when a feed ships no full body. Both go through the same DOMPurify
// sanitizer, which whitelists formatting tags so paragraphs/links/lists/quotes
// render. When there's no text at all (e.g. YouTube), it degrades to a calm
// "open externally" state. Reading in place is deliberately NOT an engagement
// signal; only the explicit external-open handoff calls onOpen.
export function Reader({
  item,
  sourceTitle,
  open,
  onClose,
  onOpen,
}: {
  item: Item | null;
  sourceTitle?: string;
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
}) {
  // Prefer the full body; fall back to the short summary when content is empty
  // (old items pre-#58, or feeds that ship no full body).
  const rendered = useMemo(
    () => renderSummary(item?.content?.trim() ? item.content : item?.summary),
    [item?.content, item?.summary],
  );

  return (
    <BottomSheet open={open} onClose={onClose} variant="tall" kicker={item?.media_type ?? ""}>
      {item && (
        <div className="reader">
          <h3 className="reader-title">{item.title}</h3>
          <div className="reader-meta">
            {sourceTitle && <span>{sourceTitle}</span>}
            {sourceTitle && item.author && <span>·</span>}
            {item.author && <span>{item.author}</span>}
            {(sourceTitle || item.author) && item.published_at && <span>·</span>}
            {item.published_at && <span>{fmtDate(item.published_at)}</span>}
          </div>

          {rendered.empty ? (
            <div className="reader-empty">
              <p className="reader-empty-lead">No text came with this one.</p>
              <p>It's likely audio or video - open it where it lives.</p>
              <button className="btn" onClick={onOpen}>
                Open externally
              </button>
            </div>
          ) : (
            <>
              <div className="reader-body" dangerouslySetInnerHTML={{ __html: rendered.html }} />
              <div className="reader-foot">
                <span>otium · reading in place · no tracking</span>
                <button className="reader-open" onClick={onOpen}>
                  Open source ↗
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
