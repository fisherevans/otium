// Archive-After vocabulary (session engine v2, #115). A source/interest expires an
// item from eligibility once it's older than this window. The value is stored as
// an int: N days, plus two sentinels - 0 means "inherit" (the source falls back to
// its interest, the interest to the global default) and -1 means "evergreen" (never
// archive). One place so the interest page, the source page, and their modals all
// speak the same options and labels.

export type ArchiveScope = "interest" | "source";

// The picker options, longest-lived last. `0` (inherit) is offered per-scope with
// scope-specific copy, so it's added by the picker, not listed here.
export const ARCHIVE_PRESETS: { days: number; label: string }[] = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "1 week" },
  { days: 30, label: "1 month" },
  { days: -1, label: "Never" },
];

// The plain-English label for a stored value. `inherit` (0) reads differently
// depending on scope: an interest with no override follows the global default; a
// source with no override follows its interest.
export function archiveLabel(days: number | undefined, scope: ArchiveScope): string {
  const v = days ?? 0;
  if (v === 0) return scope === "interest" ? "the global default" : "its interest's default";
  if (v === -1) return "never archived";
  const preset = ARCHIVE_PRESETS.find((p) => p.days === v);
  if (preset) return preset.label;
  return `${v} days`;
}

// The short form for a chip/badge (no scope framing) - "1 week", "Never", "Default".
export function archiveShort(days: number | undefined): string {
  const v = days ?? 0;
  if (v === 0) return "Default";
  if (v === -1) return "Never";
  const preset = ARCHIVE_PRESETS.find((p) => p.days === v);
  return preset ? preset.label : `${v}d`;
}
