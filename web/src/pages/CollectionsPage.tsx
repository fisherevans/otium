import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Collection, type Item } from "@/api/client";
import { BottomSheet } from "@/components/BottomSheet";
import { Reader } from "@/components/Reader";
import { Player } from "@/components/Player";
import { relTime } from "@/lib/format";

// Which in-app surface an item opens into (mirrors SessionPage): video/audio
// play in the Player, everything else reads in the Reader.
function contentKind(item: Item): "video" | "audio" | "read" {
  if (item.media_type === "short" || item.media_type === "long" || item.media_type === "live") return "video";
  if (item.media_type === "audio") return "audio";
  return "read";
}

// Collections view (#57): the deliberate saved-content surface, reached from the
// library. Lists collections + counts; tap one to browse its items newest-first.
// Each item opens the in-app reader/player and can be removed. User lists can be
// created, renamed, and deleted; builtins (Saved / Watch Later / Liked) can't.
//
// This is organization, not consumption: opening an item here doesn't build a
// session or emit engagement events. Calm by default - a quiet count, no badges.
// `embedded` renders the body without its own back link / page title, so the
// Saved tab can host it under a shared header + segmented control (#84). The
// standalone /collections route renders it non-embedded for deep links.
export default function CollectionsPage({ embedded = false }: { embedded?: boolean }) {
  const nav = useNavigate();
  const [cols, setCols] = useState<Collection[]>([]);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<Collection | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [manage, setManage] = useState<Collection | null>(null); // rename/delete sheet
  const [renameVal, setRenameVal] = useState("");

  const [content, setContent] = useState<Item | null>(null);
  const shownKind = content ? contentKind(content) : null;

  function reload() {
    api.collections().then(setCols).catch((e) => setErr(String(e.message ?? e)));
  }
  useEffect(() => { reload(); }, []);

  // The live version of the open collection, so counts/name reflect edits.
  const selectedLive = useMemo(
    () => (selected ? cols.find((c) => c.id === selected.id) ?? selected : null),
    [selected, cols],
  );

  function openCollection(c: Collection) {
    setSelected(c);
    setLoadingItems(true);
    api
      .collectionItems(c.id)
      .then(setItems)
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setLoadingItems(false));
  }

  async function createCollection() {
    const n = newName.trim();
    if (!n) return;
    try {
      await api.createCollection(n);
      setNewName("");
      setCreating(false);
      reload();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }

  async function removeItem(it: Item) {
    if (!selectedLive) return;
    try {
      await api.removeFromCollection(selectedLive.id, it.id);
      setItems((prev) => prev.filter((x) => x.id !== it.id));
      setCols((prev) => prev.map((c) => (c.id === selectedLive.id ? { ...c, item_count: Math.max(0, c.item_count - 1) } : c)));
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }

  async function doRename() {
    if (!manage) return;
    const n = renameVal.trim();
    if (!n) return;
    try {
      await api.renameCollection(manage.id, n);
      setManage(null);
      reload();
      if (selected?.id === manage.id) setSelected({ ...selected, name: n });
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }

  async function doDelete() {
    if (!manage) return;
    try {
      await api.deleteCollection(manage.id);
      const wasOpen = selected?.id === manage.id;
      setManage(null);
      if (wasOpen) setSelected(null);
      reload();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }

  // ---- item browse view ----
  if (selectedLive) {
    return (
      <div>
        <button className="lib-back" onClick={() => setSelected(null)}>
          <span aria-hidden>←</span> All collections
        </button>
        <div className="lib-topbar">
          <h1 className="display">{selectedLive.name}</h1>
          {selectedLive.kind === "user" && (
            <button className="lib-fsbtn" onClick={() => { setManage(selectedLive); setRenameVal(selectedLive.name); }}>
              Edit
            </button>
          )}
        </div>
        <p className="sub">{selectedLive.item_count} {selectedLive.item_count === 1 ? "item" : "items"} · newest first</p>

        {err && <p className="err">{err}</p>}
        {loadingItems ? (
          <p className="sub">Loading…</p>
        ) : items.length === 0 ? (
          <p className="sub" style={{ padding: "16px 0" }}>Nothing here yet. Save items from a session to fill this list.</p>
        ) : (
          items.map((it) => (
            <div className="lib-row" key={it.id}>
              <div className="lib-head">
                <div className="nm" onClick={() => setContent(it)} style={{ cursor: "pointer" }}>
                  <b>{it.title}</b>
                  <span>{it.media_type}{it.published_at ? ` · ${relTime(it.published_at)}` : ""}</span>
                </div>
                <button className="coll-x" onClick={() => removeItem(it)} aria-label="Remove from collection">×</button>
              </div>
            </div>
          ))
        )}

        <RenameDeleteSheet
          manage={manage}
          renameVal={renameVal}
          setRenameVal={setRenameVal}
          onClose={() => setManage(null)}
          onRename={doRename}
          onDelete={doDelete}
        />
        <ContentSurfaces content={content} shownKind={shownKind} onClose={() => setContent(null)} />
      </div>
    );
  }

  // ---- collections list view ----
  return (
    <div>
      {!embedded && (
        <button className="lib-back" onClick={() => nav("/sources")}>
          <span aria-hidden>←</span> Library
        </button>
      )}
      <div className="lib-topbar">
        {embedded ? <span /> : <h1 className="display">Collections</h1>}
        <button className="lib-fsbtn" onClick={() => setCreating((c) => !c)}>{creating ? "Cancel" : "New"}</button>
      </div>
      <p className="sub">Lists you've set items aside into. Saved and Watch Later are always here; Liked fills as you like.</p>

      {err && <p className="err">{err}</p>}

      {creating && (
        <div className="lib-add">
          <input
            className="field"
            placeholder="Collection name"
            value={newName}
            autoFocus
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createCollection()}
          />
          <button className="btn" onClick={createCollection} disabled={!newName.trim()}>Create</button>
        </div>
      )}

      {cols.map((c) => (
        <div className="lib-row" key={c.id}>
          <div className="lib-head" onClick={() => openCollection(c)}>
            <div className="nm">
              <b>{c.name}</b>
              <span>{c.item_count} {c.item_count === 1 ? "item" : "items"}{c.kind === "builtin" ? " · built-in" : ""}</span>
            </div>
            <span className="chev">▸</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function RenameDeleteSheet({
  manage,
  renameVal,
  setRenameVal,
  onClose,
  onRename,
  onDelete,
}: {
  manage: Collection | null;
  renameVal: string;
  setRenameVal: (s: string) => void;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => { if (!manage) setConfirmDel(false); }, [manage]);
  return (
    <BottomSheet open={manage !== null} onClose={onClose} kicker="Edit collection">
      <div className="lib-sheet">
        <div className="ctl-label" style={{ marginTop: 4 }}>Name</div>
        <input className="field" value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onRename()} />
        <div className="lib-sheet-foot">
          <button className="btn" onClick={onRename} disabled={!renameVal.trim()}>Rename</button>
        </div>
        <div className="ctl-label" style={{ marginTop: 22 }}>Delete</div>
        {confirmDel ? (
          <div className="lib-sheet-foot" style={{ marginTop: 6 }}>
            <button className="btn ghost" onClick={() => setConfirmDel(false)}>Keep</button>
            <button className="btn" onClick={onDelete}>Delete for good</button>
          </div>
        ) : (
          <button className="btn ghost" style={{ marginTop: 6 }} onClick={() => setConfirmDel(true)}>Delete this collection</button>
        )}
      </div>
    </BottomSheet>
  );
}

function ContentSurfaces({
  content,
  shownKind,
  onClose,
}: {
  content: Item | null;
  shownKind: "video" | "audio" | "read" | null;
  onClose: () => void;
}) {
  return (
    <>
      <Reader
        item={content && shownKind === "read" ? content : null}
        open={content !== null && shownKind === "read"}
        onClose={onClose}
        onOpen={() => content && window.open(content.url, "_blank", "noopener")}
      />
      <Player
        item={content && shownKind !== "read" ? content : null}
        open={content !== null && shownKind !== "read"}
        onClose={onClose}
        onOpenOriginal={() => content && window.open(content.url, "_blank", "noopener")}
      />
    </>
  );
}
