# Mobile visual QA pass: nav gap, settings row, orphaned ···

**Date:** 2026-08-15
**Type:** fix
**Version:** v0.72.2
**Author:** claude-code

## What changed

A visual QA sweep of every page at iPhone dimensions (393×852), driving the app and
reviewing screenshots. Fixes:

- **Bottom nav dead margin.** `safe-area-inset-bottom` was applied twice - on `.app`
  and again on `.nav` - so an installed PWA showed a big empty band below the tab
  bar. Removed it from `.app`; the bottom-most element (nav, or session-foot) carries
  it once.
- **Settings "App version" row.** The RELOAD control was a full-width `.btn`, which
  crushed the description into a one-word-per-line column. Made it a compact
  auto-width button.
- **Orphaned ··· menu.** The card overflow button was absolutely pinned to the card's
  top-right, so on a vertically-centered card with shorter content it floated alone in
  the empty band above the content. It now flows within `.card-top` (top of the
  content block), traveling with the metadata.
- **Import copy + textarea.** Replaced an em dash (house-rule) with a spaced hyphen;
  added `overflow-wrap: anywhere` so a long URL wraps cleanly instead of orphaning a
  character.

Pages verified clean: Library, You, Settings, Appearance (live preview), Saved,
Collections, History, Import, and the session surfaces (article card, landscape/
portrait video, reader, session-over hub, check-in).

## Why

Fisher asked for a full responsiveness/fit pass at iPhone format after spotting the
nav gap. The double safe-area was the reported bug; the rest surfaced from screenshot
review (two review sub-agents plus direct inspection).

## Note

Cards are vertically centered (per Fisher's earlier request), which leaves top/bottom
margin on shorter content while the portrait video fills the frame. Left as-is; a
switch to top-aligned is a one-line change if the margins read as too empty on the
taller Palma screen.

Part of issue #150.
