// Reliable copy-link + share, tuned for the Palma e-ink Android browser (#92).
//
// The async Clipboard API only works in a secure context and isn't present on
// every Android WebView; navigator.share is likewise spotty. So every path here
// degrades: clipboard -> legacy execCommand -> the caller shows a manual-select
// fallback. Callers surface a visible "copied" confirmation off the boolean/tag
// these return - the old buried-in-a-··· behavior is what #92 is replacing.

export function canWebShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

// Copy text to the clipboard, returning whether it landed. Tries the async
// Clipboard API first, then a hidden-textarea execCommand for older WebViews.
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* secure-context/permission failure - fall through to the legacy path */
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export type ShareResult = "shared" | "copied" | "failed";

// Share the link via the native sheet when available, otherwise copy it. A user
// dismissing the native sheet counts as handled ("shared") - no noisy fallback.
export async function shareOrCopy(data: { title?: string; url: string }): Promise<ShareResult> {
  if (canWebShare()) {
    try {
      await navigator.share({ title: data.title, url: data.url });
      return "shared";
    } catch (e: unknown) {
      if (e && typeof e === "object" && (e as { name?: string }).name === "AbortError") return "shared";
      /* share unsupported/failed at call time - fall through to copy */
    }
  }
  return (await copyText(data.url)) ? "copied" : "failed";
}
