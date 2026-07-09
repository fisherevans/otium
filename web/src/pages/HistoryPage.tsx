import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type HistoryFilter, type HistoryItem, type Item, type Source } from "@/api/client";
import { Reader } from "@/components/Reader";
import { Player } from "@/components/Player";
import { relTime } from "@/lib/format";

// Personal history (#83): "articles I've read versus just articles I've been
// shown." A findability/lookup surface reached from the library - NOT a topic.
// It reads item_state (shown vs engaged) and never writes it, so browsing here
// can't perturb ranking. Bounded list + explicit "load more"; calm, no infinite
// scroll, no counts-as-pressure.

// Which in-app surface an item opens into (mirrors SessionPage / CollectionsPage):
// video/audio play in the Player, everything else reads in the Reader.
function contentKind(item: Item): "video" | "audio" | "read" {
  if (item.media_type === "short" || item.media_type === "long" || item.media_type === "live") return "video";
  if (item.media_type === "audio") return "audio";
  return "read";
}

const FILTERS: { key: HistoryFilter; label: string }[] = [
  { key: "shown", label: "Shown" },
  { key: "read", label: "Read" },
  { key: "liked", label: "Liked" },
  { key: "saved", label: "Saved" },
];

// Human label for the raw item_state.state on each row.
const STATE_LABEL: Record<string, string> = {
  surfaced: "Shown",
  opened: "Read",
  liked: "Liked",
  skipped: "Skipped",
  saved: "Saved",
  dismissed: "Dismissed",
};

const PAGE = 50;

const SUB: Record<HistoryFilter, string> = {
  shown: "Everything that's surfaced in a session, newest first.",
  read: "Items you opened, liked, or saved - what you actually engaged with.",
  liked: "Items you liked.",
  saved: "Items you set aside to save.",
};

// `embedded` drops the back link + page title so the Saved tab can host this
// body under its shared header + segmented control (#84). The standalone
// /history route renders it non-embedded for deep links.
export default function HistoryPage({ embedded = false }: { embedded?: boolean }) {
  const nav = useNavigate();
  const [filter, setFilter] = useState<HistoryFilter>("shown");
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [err, setErr] = useState("");

  const [content, setContent] = useState<Item | null>(null);
  const shownKind = content ? contentKind(content) : null;

  // Source id -> title, so a row can say which source it came from.
  const sourceTitle = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of sources) m.set(s.id, s.title);
    return m;
  }, [sources]);

  useEffect(() => {
    api.sources().then(setSources).catch(() => {/* non-fatal: rows fall back to no source */});
  }, []);

  // Reload the first page whenever the filter changes.
  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr("");
    setAtEnd(false);
    api
      .history(filter, PAGE, 0)
      .then((rows) => {
        if (!live) return;
        setItems(rows);
        setAtEnd(rows.length < PAGE);
      })
      .catch((e) => live && setErr(String(e.message ?? e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [filter]);

  function loadMore() {
    setLoadingMore(true);
    api
      .history(filter, PAGE, items.length)
      .then((rows) => {
        setItems((prev) => [...prev, ...rows]);
        if (rows.length < PAGE) setAtEnd(true);
      })
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setLoadingMore(false));
  }

  return (
    <div>
      {!embedded && (
        <>
          <button className="lib-back" onClick={() => nav("/sources")}>
            <span aria-hidden>←</span> Library
          </button>
          <div className="lib-topbar">
            <h1 className="display">History</h1>
          </div>
        </>
      )}
      <p className="sub">{SUB[filter]}</p>

      {/* filter chips - reuse the library's chip row (#83) */}
      <div className="lib-filter">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`lib-fchip ${filter === f.key ? "on" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {err && <p className="err">{err}</p>}

      {loading ? (
        <p className="sub">Loading…</p>
      ) : items.length === 0 ? (
        <p className="sub" style={{ padding: "16px 0" }}>Nothing here yet.</p>
      ) : (
        <>
          {items.map((it) => {
            const src = sourceTitle.get(it.source_id);
            return (
              <div className="lib-row" key={`${it.id}-${it.state}`}>
                <div className="lib-head" onClick={() => setContent(it)} style={{ cursor: "pointer" }}>
                  <div className="nm">
                    <b>{it.title}</b>
                    <span>
                      <span className="hist-tag">{STATE_LABEL[it.state] ?? it.state}</span>
                      {src ? ` · ${src}` : ""}
                      {it.interacted_at ? ` · ${relTime(it.interacted_at)}` : ""}
                    </span>
                  </div>
                  <span className="chev">▸</span>
                </div>
              </div>
            );
          })}
          {!atEnd && (
            <button className="btn ghost" style={{ marginTop: 14 }} onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
          {atEnd && items.length > 0 && (
            <p className="sub" style={{ padding: "16px 0", textAlign: "center" }}>That's everything.</p>
          )}
        </>
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
