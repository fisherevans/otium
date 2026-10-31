import { ChevronRight, Download, ExternalLink, Info, Link2, Share2, Tv, Bookmark, BookOpen, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Item, type Selected, type Source } from "@/api/client";
import { BottomSheet } from "./BottomSheet";
import { ManualCopy } from "./ReaderActions";
import { ShortsModeToggle } from "./ShortsModeToggle";
import { canWebShare, copyText, shareOrCopy } from "@/lib/share";
import { isMedia } from "@/lib/render";
import { parseYouTubeId } from "@/lib/youtube";

// What to do with the current session item, and where to go from it (#180): the
// pill's ··· opens this. Share the clip itself or its link, download it, open it
// or its channel on YouTube, jump to the source in Otium, save it; then session
// controls (Shorts mode, End session). Where the item came from and why it
// surfaced is ItemDetails, a separate sheet. Nothing here emits an engagement
// event.
export function ItemActions({
  selected,
  open,
  onClose,
  onRead,
  onSave,
  onDetails,
  onOpenOriginal,
  onEnd,
  shortsMode,
  onShortsModeChange,
  nativeControls,
  onNativeControls,
  immersive,
  onImmersiveChange,
  status,
}: {
  selected: Selected | null;
  open: boolean;
  onClose: () => void;
  onRead: () => void;
  onSave?: (item: Item) => void;
  onDetails?: () => void;
  onOpenOriginal?: () => void;
  onEnd?: () => void;
  shortsMode?: boolean;
  onShortsModeChange?: (enabled: boolean) => void;
  // #182: YouTube's own controls (quality, caption tracks, scrubbing), moved
  // here from the row under the video.
  nativeControls?: boolean;
  onNativeControls?: () => void;
  immersive?: boolean;
  onImmersiveChange?: (value: boolean) => void;
  // #186: the session's time phrase, when the pill that usually shows it is hidden.
  status?: string;
}) {
  const nav = useNavigate();
  const item = selected?.item ?? null;
  const sourceId = item?.source_id ?? 0;
  const [source, setSource] = useState<Source | null>(null);
  const [toast, setToast] = useState("");
  const [manual, setManual] = useState(false);

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
    <BottomSheet open={open} onClose={onClose} kicker={selected?.source_title ?? "Item"}>
      <div className="ia-title">{item.title}</div>
      {status && <p className="ia-sub">{status}</p>}

      {clip && <VideoFileActions item={item} />}

      <div className="sheet-rows">
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

      {(onShortsModeChange || onEnd || onNativeControls || onImmersiveChange) && (
        <div className="sheet-rows">
          {onShortsModeChange && <ShortsModeToggle enabled={shortsMode ?? false} onChange={onShortsModeChange} />}
          {status && (
            <button className="sheet-row" onClick={() => { onClose(); window.dispatchEvent(new Event("otium:app-menu")); }}>
              <span>Library, Saved and settings</span>
              <ChevronRight size={18} className="sheet-chev inline-icon" aria-hidden />
            </button>
          )}
          {immersive !== undefined && onImmersiveChange && (
            <button className="sheet-row" role="switch" aria-checked={immersive} aria-label="Full-screen Shorts"
              onClick={() => onImmersiveChange(!immersive)}>
              <span>Full-screen Shorts</span>
              <span className="shorts-mode-state">{immersive ? "On" : "Off"}</span>
            </button>
          )}
          {onNativeControls && (
            <button className="sheet-row" onClick={onNativeControls} aria-pressed={!!nativeControls}
              aria-label={nativeControls ? "Use simple controls" : "Use YouTube controls"}>
              <span>{nativeControls ? "Use simple controls" : "Use YouTube's player controls"}</span>
              <ChevronRight size={18} className="sheet-chev inline-icon" aria-hidden />
            </button>
          )}
          {onEnd && <button className="sheet-row" onClick={onEnd}><span>End session</span><ChevronRight size={18} className="sheet-chev inline-icon" aria-hidden /></button>}
        </div>
      )}

      {manual && <ManualCopy url={item.url} onClose={() => setManual(false)} />}
      {toast && <div className="toast over-sheet"><Check size={15} strokeWidth={2} aria-hidden /> {toast}</div>}
    </BottomSheet>
  );
}

// Share the clip itself (#180). The server fetches the MP4 on first request
// (several seconds), then serves it from cache. iOS only opens the share sheet
// close to a tap, so a slow first fetch can leave the file ready but unshared -
// the row then reads "Share video" and the next tap shares instantly. In the
// share sheet, Save Video puts it in Photos.
function VideoFileActions({ item }: { item: Item }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState("");
  const file = useRef<File | null>(null);
  useEffect(() => { file.current = null; setState("idle"); setMessage(""); }, [item.id]);

  const href = `/api/v1/items/${item.id}/video`;
  const name = fileName(item.title);

  async function share() {
    if (file.current) return shareFile(file.current);
    setState("loading");
    setMessage("");
    try {
      const res = await fetch(href);
      if (!res.ok) {
        let msg = "Couldn't get this video.";
        try { msg = (await res.json()).message || msg; } catch { /* keep default */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      file.current = new File([blob], name, { type: "video/mp4" });
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "Couldn't get this video.");
      return;
    }
    await shareFile(file.current);
  }
  async function shareFile(f: File) {
    const files = [f];
    if (typeof navigator.share !== "function" || !navigator.canShare?.({ files })) {
      setState("ready");
      setMessage("This browser can't share files. Use Download video.");
      return;
    }
    try {
      await navigator.share({ files });
      setState("ready");
    } catch (e) {
      setState("ready");
      const reason = e instanceof DOMException ? e.name : "";
      if (reason === "NotAllowedError") setMessage("Video ready. Tap Share video to open the share sheet.");
      else if (reason !== "AbortError") setMessage("Couldn't open the share sheet. Try again, or use Download video.");
    }
  }

  return (
    <div className="sheet-rows">
      <button className="sheet-row" onClick={share} disabled={state === "loading"} aria-busy={state === "loading"}>
        <span className="sheet-row-label"><Share2 size={18} aria-hidden />
          {state === "loading" ? "Preparing video…" : state === "ready" ? "Share video" : "Save or share video"}
        </span>
      </button>
      <a className="sheet-row" href={`${href}?download=1`} download={name}>
        <span className="sheet-row-label"><Download size={18} aria-hidden /> Download video</span>
      </a>
      <p className="ia-sub" role="status">{message || "Save or share opens the share sheet. Choose Save Video for Photos."}</p>
    </div>
  );
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
