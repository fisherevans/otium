import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Interest, type Source, type SourceItem } from "@/api/client";
import { relTime } from "@/lib/format";
import { Dialog } from "@/components/Dialog";
import { Reader } from "@/components/Reader";
import { Player } from "@/components/Player";

// Per-source article list (session engine v2, mockup #5). Splits the source's
// items into "On Deck" (unseen + still within the archival window) and "Archived"
// (seen, or aged/keyword-archived). Each row shows title, the mockup's
// "{relative} · {date} · {duration}" meta, an age-based explore score with a bar,
// and its engagement status badges. Opening an item is orientation only.
const GLOBAL_HALF_LIFE = 21;
const GLOBAL_ARCHIVE = 21;

function contentKind(it: SourceItem): "video" | "audio" | "read" {
  if (it.media_type === "short" || it.media_type === "long" || it.media_type === "live") return "video";
  if (it.media_type === "audio") return "audio";
  return "read";
}
function durType(it: SourceItem): string {
  const k = contentKind(it);
  if (k === "video") {
    if (it.duration_sec > 0) return `${Math.max(1, Math.round(it.duration_sec / 60))} min video`;
    return it.media_type === "short" ? "short" : "video";
  }
  if (k === "audio") return it.duration_sec > 0 ? `${Math.round(it.duration_sec / 60)} min audio` : "audio";
  return it.content_source === "external" || !it.content ? "linked article" : "article";
}
function longDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}
function ageDays(iso?: string): number {
  if (!iso) return Infinity;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return Infinity;
  return (Date.now() - d) / 86_400_000;
}
function freshness(iso?: string): number {
  const a = ageDays(iso);
  if (!Number.isFinite(a)) return 0;
  return Math.pow(0.5, a / GLOBAL_HALF_LIFE);
}

type Filter = "none" | "unread" | "read" | "skipped";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "none", label: "none" },
  { key: "unread", label: "unread" },
  { key: "read", label: "read" },
  { key: "skipped", label: "skipped" },
];

export default function SourceArticlesPage() {
  const nav = useNavigate();
  const { id } = useParams();
  const sourceId = Number(id);

  const [source, setSource] = useState<Source | null>(null);
  const [interest, setInterest] = useState<Interest | null>(null);
  const [items, setItems] = useState<SourceItem[] | null>(null);
  const [content, setContent] = useState<SourceItem | null>(null);
  const [filter, setFilter] = useState<Filter>("none");
  const [filterOpen, setFilterOpen] = useState(false);
  const [explain, setExplain] = useState<SourceItem | null>(null);

  useEffect(() => {
    api.sources().then((ss) => {
      const s = ss.find((x) => x.id === sourceId) ?? null;
      setSource(s);
      if (s?.interest_slug) api.interests().then((is) => setInterest(is.find((i) => i.slug === s.interest_slug) ?? null)).catch(() => {});
    }).catch(() => {});
    api.sourceItems(sourceId).then(setItems).catch(() => {});
  }, [sourceId]);

  const keywords = (source?.archive_keywords ?? "").split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
  const srcDays = source?.archive_after_days ?? 0;
  const intDays = interest?.archive_after_days ?? 0;
  const resolvedDays = srcDays !== 0 ? srcDays : intDays !== 0 ? intDays : GLOBAL_ARCHIVE;

  function eligible(it: SourceItem): boolean {
    const hay = (it.title + " " + it.summary).toLowerCase();
    if (keywords.some((k) => hay.includes(k))) return false;
    if (resolvedDays === -1) return true;
    return ageDays(it.published_at) <= resolvedDays;
  }
  function badges(it: SourceItem): string[] {
    switch (it.state) {
      case "opened":
        return ["presented", "read"];
      case "liked":
        return ["presented", "liked"];
      case "skipped":
        return ["presented", "skipped"];
      case "surfaced":
        return ["presented"];
      case "saved":
        return ["saved"];
      default:
        return eligible(it) ? ["unread"] : ["auto archived"];
    }
  }
  function matchesFilter(it: SourceItem): boolean {
    if (filter === "none") return true;
    if (filter === "unread") return it.state === "" && eligible(it);
    if (filter === "read") return it.state === "opened" || it.state === "liked";
    if (filter === "skipped") return it.state === "skipped";
    return true;
  }

  const { onDeck, archived } = useMemo(() => {
    const list = [...(items ?? [])]
      .filter(matchesFilter)
      .sort((a, b) => ageDays(a.published_at) - ageDays(b.published_at));
    const on: SourceItem[] = [];
    const arch: SourceItem[] = [];
    for (const it of list) (it.state === "" && eligible(it) ? on : arch).push(it);
    return { onDeck: on, archived: arch };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, filter, resolvedDays, source?.archive_keywords]);

  const shownKind = content ? contentKind(content) : null;

  function Row(it: SourceItem) {
    const score = freshness(it.published_at);
    const bs = badges(it);
    return (
      <div className="va-row" key={it.id}>
        <button className="va-title" onClick={() => setContent(it)}>
          {it.title}
        </button>
        <div className="va-meta">
          {relTime(it.published_at)} · {longDate(it.published_at)} · {durType(it)}
        </div>
        <div className="va-scoreline">
          <span className="va-bar" aria-hidden>
            <span className="va-bar-fill" style={{ width: `${Math.round(score * 100)}%` }} />
          </span>
          <span className="va-score">{score.toFixed(2)}</span>
          <button className="va-explore" onClick={() => setExplain(it)}>
            explore score
          </button>
          <span className="va-badges">
            {bs.map((b) => (
              <span key={b} className={`art-badge st-${b.replace(/\s+/g, "-")}`}>
                {b}
              </span>
            ))}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mgmt va-page">
      <button className="mgmt-back" onClick={() => nav(`/sources/${sourceId}`)}>
        ← {source ? source.title : "Source"}
      </button>
      <div className="mgmt-kicker">View Articles</div>
      <h1 className="mgmt-title">{source?.title ?? "Articles"}</h1>

      <button className="va-filter" onClick={() => setFilterOpen(true)}>
        Filter: {FILTERS.find((f) => f.key === filter)!.label}
      </button>

      {items === null ? (
        <p className="lib2-subtitle">Loading…</p>
      ) : items.length === 0 ? (
        <p className="lib2-empty">No articles fetched yet.</p>
      ) : (
        <>
          {onDeck.length > 0 && (
            <>
              <div className="mgmt-sechead">
                <span className="mgmt-seclabel">On Deck</span>
                <span className="va-count">{onDeck.length}</span>
              </div>
              {onDeck.map(Row)}
            </>
          )}
          {archived.length > 0 && (
            <>
              <div className="mgmt-sechead">
                <span className="mgmt-seclabel">Archived</span>
                <span className="va-count">{archived.length}</span>
              </div>
              {archived.map(Row)}
            </>
          )}
          {onDeck.length === 0 && archived.length === 0 && <p className="lib2-empty">Nothing matches this filter.</p>}
        </>
      )}

      <Dialog open={filterOpen} onClose={() => setFilterOpen(false)} kicker="Filter articles">
        <div className="dlg-opts">
          {FILTERS.map((f) => (
            <button key={f.key} className={`dlg-opt ${filter === f.key ? "on" : ""}`} onClick={() => (setFilter(f.key), setFilterOpen(false))}>
              <span className="dlg-radio" aria-hidden />
              <span className="dlg-name">{f.label}</span>
            </button>
          ))}
        </div>
      </Dialog>

      <Dialog open={explain !== null} onClose={() => setExplain(null)} kicker="Explore score">
        {explain && (
          <>
            <p className="dlg-copy">
              This article scores <b>{freshness(explain.published_at).toFixed(2)}</b>.
            </p>
            <p className="dlg-copy">
              Right now the score is age-based freshness: published {relTime(explain.published_at)} ({Math.round(ageDays(explain.published_at))} days
              old), so it decays on a {GLOBAL_HALF_LIFE}-day half-life. Newer articles score higher.
            </p>
            <p className="caphint">More scoring signals (keywords, topics, quality) are coming - freshness is just the first.</p>
          </>
        )}
      </Dialog>

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
