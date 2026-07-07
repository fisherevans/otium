import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Item, type Source } from "@/api/client";
import { relTime } from "@/lib/format";
import { Reader } from "@/components/Reader";
import { Player } from "@/components/Player";

// Per-source article list (session engine v2). Splits the source's items into "On
// Deck" (recent enough to still surface in a session) and "Archived" (aged past the
// source's archival window). Each item shows its title, relative date, and a thin
// recency bar (newer = fuller). Item payloads carry no per-user state, so no read/
// skipped label is shown - the split is by recency against the archival window,
// which is the honest signal available here. Opening an item is orientation only:
// it builds no session and records no engagement (mirrors PostsList).
const DEFAULT_WINDOW_DAYS = 21; // mirrors the server's global archive window

function contentKind(item: Item): "video" | "audio" | "read" {
  if (item.media_type === "short" || item.media_type === "long" || item.media_type === "live") return "video";
  if (item.media_type === "audio") return "audio";
  return "read";
}
function ageDays(iso?: string): number {
  if (!iso) return Infinity;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return Infinity;
  return (Date.now() - d.getTime()) / 86_400_000;
}

export default function SourceArticlesPage() {
  const nav = useNavigate();
  const { id } = useParams();
  const sourceId = Number(id);

  const [source, setSource] = useState<Source | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [content, setContent] = useState<Item | null>(null);

  useEffect(() => {
    api.sources().then((ss) => setSource(ss.find((s) => s.id === sourceId) ?? null)).catch(() => {});
    api.sourceItems(sourceId).then(setItems).catch(() => {});
  }, [sourceId]);

  // Evergreen (-1) keeps everything on deck; otherwise split on the archival window.
  const windowDays = source?.archive_after_days && source.archive_after_days > 0
    ? source.archive_after_days
    : source?.archive_after_days === -1
    ? Infinity
    : DEFAULT_WINDOW_DAYS;

  const { onDeck, archived, maxAge } = useMemo(() => {
    const list = [...(items ?? [])].sort((a, b) => ageDays(a.published_at) - ageDays(b.published_at));
    const on: Item[] = [];
    const arch: Item[] = [];
    let max = 1;
    for (const it of list) {
      const age = ageDays(it.published_at);
      if (Number.isFinite(age)) max = Math.max(max, age);
      (age <= windowDays ? on : arch).push(it);
    }
    return { onDeck: on, archived: arch, maxAge: max };
  }, [items, windowDays]);

  const shownKind = content ? contentKind(content) : null;

  function row(it: Item) {
    const age = ageDays(it.published_at);
    // recency fill: newest in the list = full, oldest = near-empty.
    const fill = Number.isFinite(age) ? Math.max(0.06, 1 - age / maxAge) : 0.06;
    return (
      <button className="art-row" key={it.id} onClick={() => setContent(it)}>
        <div className="art-main">
          <b className="art-title">{it.title}</b>
          <span className="art-date">
            {it.media_type}
            {it.published_at ? ` · ${relTime(it.published_at)}` : ""}
          </span>
        </div>
        <span className="art-bar" aria-hidden>
          <span className="art-bar-fill" style={{ width: `${Math.round(fill * 100)}%` }} />
        </span>
      </button>
    );
  }

  return (
    <div>
      <button className="lib-back" onClick={() => nav(`/sources/${sourceId}`)}>
        <span aria-hidden>←</span> {source ? source.title : "Source"}
      </button>
      <div className="lib-topbar">
        <h1 className="display">Articles</h1>
      </div>
      <p className="sub">
        {items === null
          ? "Loading…"
          : `${items.length} fetched · ${onDeck.length} on deck · ${archived.length} archived`}
      </p>

      {items !== null && items.length === 0 && (
        <p className="sub" style={{ padding: "12px 0" }}>No articles fetched yet.</p>
      )}

      {onDeck.length > 0 && (
        <div className="page-section" style={{ marginTop: 18 }}>
          <div className="ctl-label">On deck</div>
          {onDeck.map(row)}
        </div>
      )}
      {archived.length > 0 && (
        <div className="page-section">
          <div className="ctl-label">Archived</div>
          {archived.map(row)}
        </div>
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
    </div>
  );
}
