# Complete the Afterglow surface refresh

**Date:** 2026-10-20
**Type:** refactor
**Version:** v0.79.0
**Author:** Codex

## What changed

Shared typography, spacing, SVG controls and rounded controls now cover Library organization, source setup and settings, topic edits, Saved, History, Import, Insights, Appearance and account activity. Presets use the same sheets and edit dialogs, including their backdrop and nested focus handling. The fast-scroll prompt uses a contextual sheet without shrinking the article. List and session-review media use the same player with the persistent Back instrument.

Visual review also caught and fixed null collection/history responses, clipped long menus, overflowing article titles, duplicated Insights errors, silent failed source representation changes and a retired desktop navigation grid that offset the content. Media notes use explicit Hide notes/Hide transcript labels to distinguish them from Back.

## Why

The main reading flow had adopted Afterglow while less frequent controls retained the old typography, geometry and interaction patterns. Reviewing rendered states, including failures and nested overlays, exposed inconsistencies that a route-level screenshot or build would not catch.

## Verification

Reviewed mobile, compact mobile, desktop, dark and e-ink presentations. Browser regressions cover the session/read/save/review loop, gestures, native audio, modal focus/history, launcher presets, appearance persistence and the newly found secondary-surface failures. The layout lab measures the production card component. Physical iPhone keyboard and e-ink refresh behavior require the corresponding devices.

## Related

- [Visual refresh #168](https://github.com/fisherevans/otium/issues/168)
- [Afterglow production](2026-10-16-afterglow-production.md)
