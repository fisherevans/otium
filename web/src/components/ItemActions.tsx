import { ChevronRight, Send, Download, ExternalLink, Info, Link2, Share2, Tv, Bookmark, BookOpen, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Item, type Selected, type Source } from "@/api/client";
import { BottomSheet } from "./BottomSheet";
import { ManualCopy } from "./ReaderActions";
import { ShortsModeToggle } from "./ShortsModeToggle";
import { SharePicker } from "./SharePicker";
import { useShareAvailable } from "@/lib/sharing";
import { canWebShare, copyText, shareOrCopy } from "@/lib/share";
import { isMedia } from "@/lib/render";
import { parseYouTubeId } from "@/lib/youtube";

// What to do with the item on screen (#180, #208). The ··· in the session's top
// bar (or in a Short's own bar) opens this, and its contents depend only on that
// item: send or share it, copy or open its link, its channel, read it in the app,
// save it, go to its source, its details; a Short adds its video file, YouTube's
// player controls and the Shorts mode switch. Session controls (Next item, End
// session, the app menu) are SessionControls, opened from the session time phrase,
// never this sheet. Where the item came from and why it surfaced is ItemDetails,
// a separate sheet. Nothing here emits an engagement event.
export function ItemActions({
  selected,
  open,
  onClose,
  onRead,
  onSave,
  onDetails,
  onOpenOriginal,
  shortsMode,
  onShortsModeChange,
  nativeControls,
  onNativeControls,
}: {
  selected: Selected | null;
  open: boolean;
  onClose: () => void;
  onRead: () => void;
  onSave?: (item: Item) => void;
  onDetails?: () => void;
  onOpenOriginal?: () => void;
  // #208: shown only while a Short is the item on screen, where it obviously
  // applies. Its home is Settings.
  shortsMode?: boolean;
  onShortsModeChange?: (enabled: boolean) => void;
  // #182: YouTube's own controls (quality, caption tracks, scrubbing), moved
  // here from the row under the video.
  nativeControls?: boolean;
  onNativeControls?: () => void;
}) {
  const nav = useNavigate();
  const item = selected?.item ?? null;
  const sourceId = item?.source_id ?? 0;
  const [source, setSource] = useState<Source | null>(null);
  const [toast, setToast] = useState("");
  const [manual, setManual] = useState(false);
  const shareOn = useShareAvailable();
  const [shareItem, setShareItem] = useState<Item | null>(null);

  useEffect(() => {
    if (!open || !sourceId) return;
    api
      .sources()
      .then((list) => setSource(list.find((x) => x.id === sourceId) ?? null))
      .catch(() => {});
  }, [open, sourceId]);
  useEffect(() => { setToast(""); setManual(false); }, [open, item?.id]);

  if (!item) return null;
  const youTube = parseYouTubeId(item.url) !== null;
  const channel = youTube ? channelURL(source) : "";
  const short = item.media_type === "short";
  const clip = youTube && (item.media_type === "short" || (item.duration_sec > 0 && item.duration_sec <= 180));

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? "" : t)), 1800);
  }
  async function shareLink() {
    if (!item) return;
    const r = await shareOrCopy({ title: item.title, url: item.url });
    if (r === "copied") flash("Link copied");
    else if (r === "failed") setManual(true);
  }
  async function copyLink() {
    if (!item) return;
    if (await copyText(item.url)) flash("Link copied");
    else setManual(true);
  }

  return (
    <>
    <BottomSheet open={open} onClose={onClose} kicker={selected?.source_title ?? "Item"}>
      <div className="ia-title">{item.title}</div>

      {clip && <VideoFileActions item={item} />}

      <div className="sheet-rows">
        {shareOn && (
          <button className="sheet-row" onClick={() => { onClose(); setShareItem(item); }}>
            <span className="sheet-row-label"><Send size={18} aria-hidden /> Send on Discord</span>
          </button>
        )}
        {canWebShare() && (
          <button className="sheet-row" onClick={shareLink}>
            <span className="sheet-row-label"><Share2 size={18} aria-hidden /> Share link</span>
          </button>
        )}
        <button className="sheet-row" onClick={copyLink}>
          <span className="sheet-row-label"><Link2 size={18} aria-hidden /> Copy link</span>
        </button>
        {onOpenOriginal && (
          <button className="sheet-row" onClick={onOpenOriginal}>
            <span className="sheet-row-label"><ExternalLink size={18} aria-hidden /> {youTube ? "Open in YouTube" : "Open original"}</span>
          </button>
        )}
        {channel && (
          <a className="sheet-row" href={channel} target="_blank" rel="noopener noreferrer">
            <span className="sheet-row-label"><Tv size={18} aria-hidden /> Open channel on YouTube</span>
          </a>
        )}
      </div>

      <div className="sheet-rows">
        {!isMedia(item) && (
          <button className="sheet-row" onClick={onRead}>
            <span className="sheet-row-label"><BookOpen size={18} aria-hidden /> Read in app</span>
          </button>
        )}
        {onSave && (
          <button className="sheet-row" onClick={() => onSave(item)}>
            <span className="sheet-row-label"><Bookmark size={18} aria-hidden /> Save to collection</span>
          </button>
        )}
        <button className="sheet-row" onClick={() => nav(`/sources/${sourceId}`)}>
          <span>Go to {selected?.source_title ?? "source"} in Otium</span>
          <ChevronRight size={18} className="sheet-chev inline-icon" aria-hidden />
        </button>
        {onDetails && (
          <button className="sheet-row" onClick={onDetails}>
            <span className="sheet-row-label"><Info size={18} aria-hidden /> Post details</span>
            <ChevronRight size={18} className="sheet-chev inline-icon" aria-hidden />
          </button>
        )}
      </div>

      {((short && onShortsModeChange) || onNativeControls) && (
        <div className="sheet-rows">
          {short && onShortsModeChange && <ShortsModeToggle enabled={shortsMode ?? false} onChange={onShortsModeChange} />}
          {onNativeControls && (
            <button className="sheet-row" onClick={onNativeControls} aria-pressed={!!nativeControls}>
              <span className="sheet-row-text">
                <span>{nativeControls ? "Use simple controls" : "Use YouTube's player controls"}</span>
                <small>{nativeControls ? "Tap to play, swipe to move on" : "Seek, quality and full screen"}</small>
              </span>
              <ChevronRight size={18} className="sheet-chev inline-icon" aria-hidden />
            </button>
          )}
        </div>
      )}

      {manual && <ManualCopy url={item.url} onClose={() => setManual(false)} />}
      {toast && <div className="toast over-sheet"><Check size={15} strokeWidth={2} aria-hidden /> {toast}</div>}
    </BottomSheet>
    <SharePicker item={shareItem} open={shareItem !== null} onClose={() => setShareItem(null)} />
    </>
  );
}

// Share or download the clip itself (#180). The server fetches the MP4 on first
// request (several seconds), then serves it from cache. Both rows fetch it with
// the app's session and check the response before handing it on: a plain link
// left the PWA's cookies behind and saved whatever error page came back as the
// "video" (#211). iOS only opens the share sheet close to a tap, so a slow first
// fetch can leave the file ready but unshared - the row then reads "Share video"
// and the next tap shares instantly. In the share sheet, Save Video puts it in
// Photos.
function VideoFileActions({ item }: { item: Item }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [busy, setBusy] = useState<"share" | "download" | null>(null);
  const [message, setMessage] = useState("");
  const file = useRef<File | null>(null);
  useEffect(() => { file.current = null; setState("idle"); setBusy(null); setMessage(""); }, [item.id]);

  const href = `/api/v1/items/${item.id}/video`;
  const name = fileName(item.title);

  async function load(kind: "share" | "download"): Promise<File | null> {
    if (file.current) return file.current;
    setState("loading");
    setBusy(kind);
    setMessage("");
    try {
      const res = await fetch(href);
      if (!res.ok) {
        let msg = "Couldn't get this video.";
        try { msg = (await res.json()).message || msg; } catch { /* keep default */ }
        throw new Error(msg);
      }
      if (!(res.headers.get("Content-Type") || "").startsWith("video/")) throw new Error("Couldn't get this video.");
      const blob = await res.blob();
      file.current = new File([blob], name, { type: "video/mp4" });
      return file.current;
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "Couldn't get this video.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    const f = await load("share");
    if (f) await shareFile(f);
  }
  async function shareFile(f: File) {
    const files = [f];
    if (typeof navigator.share !== "function" || !navigator.canShare?.({ files })) {
      setState("ready");
      setMessage("This browser can't share files.");
      return;
    }
    try {
      await navigator.share({ files });
      setState("ready");
    } catch (e) {
      setState("ready");
      const reason = e instanceof DOMException ? e.name : "";
      if (reason === "NotAllowedError") setMessage("Video ready. Tap Share video to open the share sheet.");
      else if (reason !== "AbortError") setMessage("Couldn't open the share sheet. Try again.");
    }
  }

  async function download() {
    const f = await load("download");
    if (!f) return;
    setState("ready");
    const url = URL.createObjectURL(f);
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const loading = state === "loading";
  return (
    <div className="sheet-rows">
      <button className="sheet-row" onClick={share} disabled={loading} aria-busy={busy === "share"}>
        <span className="sheet-row-label"><Share2 size={18} aria-hidden />
          {busy === "share" ? "Preparing video…" : state === "ready" ? "Share video" : "Save or share video"}
        </span>
      </button>
      {!canShareFiles() && (
        <button className="sheet-row" onClick={download} disabled={loading} aria-busy={busy === "download"}>
          <span className="sheet-row-label"><Download size={18} aria-hidden />
            {busy === "download" ? "Preparing video…" : "Download video"}
          </span>
        </button>
      )}
      <p className="ia-sub" role="status">{message || (canShareFiles()
        ? "Opens the share sheet. Choose Save Video for Photos, or Save to Files."
        : "Save or share opens the share sheet. Choose Save Video for Photos.")}</p>
    </div>
  );
}

// Where the share sheet takes files (iPhone), it is the only save path: a
// download in the installed app opens a full-screen preview with no way back
// but closing the app (#211). Download is for browsers that can't share files.
function canShareFiles() {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([], "video.mp4", { type: "video/mp4" })] });
  } catch {
    return false;
  }
}

function fileName(title: string) {
  const base = title.replace(/[^A-Za-z0-9 ._-]+/g, "").trim().slice(0, 60).trim();
  return `${base || "video"}.mp4`;
}

// The source's YouTube channel page: its homepage when that is a YouTube URL,
// otherwise derived from the channel feed's channel_id.
function channelURL(source: Source | null) {
  if (!source) return "";
  try {
    const home = new URL(source.homepage_url);
    if (/(^|\.)youtube\.com$/.test(home.hostname)) return home.toString();
  } catch { /* fall through */ }
  try {
    const id = new URL(source.feed_url).searchParams.get("channel_id");
    if (id) return `https://www.youtube.com/channel/${id}`;
  } catch { /* none */ }
  return "";
}
