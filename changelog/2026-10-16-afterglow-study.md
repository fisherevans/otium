# Afterglow typography and surrounding experiences

**Date:** 2026-10-16
**Type:** decision
**Author:** codex

## What changed

Added a second-round interactive Afterglow prototype under `design/explorations/afterglow`. Six bundled serif fonts can be cycled on the current article or compared in a specimen sheet. The same contextual bottom instrument carries into setup, reader, Library, source controls, Saved, appearance and the session ending. Local-state interactions demonstrate saving, preferences, source addition and import. A light e-ink view preserves the hierarchy.

## Why

Fisher selected Afterglow and specifically endorsed the bottom bar as a contextual instrument. The reading experience should stay focused on the article, with natural-language time, a dedicated Next action and an article menu. This round tests the typography and the rest of the app before production implementation, retaining the smaller headline scale requested after the real-content comparison.

The existing production app already separates session navigation from its surrounding app. This exploration gives that separation a coherent Afterglow visual identity. It changes no production code, account data or deployed app behavior.

## Related

- [#163](https://github.com/fisherevans/otium/issues/163)
- [Interactive study](https://quiver.fisher.sh/static/reports/otium/2026-10-16-afterglow/)
- [Typography and flow feedback](https://quiver.fisher.sh/static/reports/otium/2026-10-16-afterglow-feedback/?annotate)

## Complete new-session walkthrough

The study now starts before a session, with time selection followed by scope and optional topic exclusions. Begin builds a deterministic, finite sample using those choices. Draft setup stays separate from the active session plan, so changing the next session does not mutate the current one. The selected article IDs, cursor and plan survive reload.

Fisher asked to feel the start experience all the way through, rather than see isolated setup screens. The walkthrough advances its natural-language time with each story, making the ending reachable without waiting for a full real-time session. Reading, saving, returning, ending and explicitly extending all use the same contextual instrument. An empty selection disables Begin and explains how to include a topic. This remains a local prototype with real metadata and illustrative media.

## Reading refinement

Fisher selected Fraunces for titles and Newsreader for reading. The study now defaults and migrates to that pair. Brief photographs retain their complete contents in a contained frame; long headlines truncate before demanding excessive image compression. Holding an image opens a full-image dialog, also available through explicit buttons. The whole brief is a reading target, with drag cancellation and a keyboard-accessible headline link.

The bottom instrument remains visible on every route, including Settings and History. A persistent folded O mark, role labels and distinct session/article/app treatments make its role changes recognizable; short transitions are disabled for reduced motion and e-ink. Reader continuation requires an upward gesture that starts at the bottom, with distance, duration, axis and selection/zoom/multi-touch guards. Back, swipe-right Back and tap-to-continue remain available. Route changes dismiss transient sheets.

These changes address cramped imagery, narrow reading targets and the jarring disappearance of navigation identified in review. They remain prototype changes; the production app is unchanged.
