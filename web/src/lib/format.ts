// Small formatting helpers shared across the reader + drill-in surfaces.

// clock renders a duration as m:ss (media badge on the card).
export function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// mins renders a duration as a coarse "N min" label ("<1 min" under a minute).
export function mins(sec: number): string {
  const m = Math.round(sec / 60);
  return m < 1 ? "<1 min" : `${m} min`;
}

export function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// relTime is the prominent relative age shown above the card's hero (#73). It
// stays human and readable at a glance: minutes/hours while fresh, then
// "yesterday" / "X days ago", then "X weeks ago" past a week, and once it's past
// a month it drops to an absolute date ("Mar 4", with the year only when it's
// not the current year - a stamp that old reads better as a real date than as an
// ever-growing "N weeks ago"). Returns "" for a missing/unparseable timestamp so
// the caller can omit the cue rather than fabricate one.
export function relTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const ms = Date.now() - d.getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return `${w} week${w === 1 ? "" : "s"} ago`;
  }
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(
    undefined,
    sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" },
  );
}

export function relDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return fmtDate(iso);
}
