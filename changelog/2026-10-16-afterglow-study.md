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

## Familiar session types

The start screen now leads with a default, saved presets and recent unsaved setups. Starter presets demonstrate ten minutes of news and forty minutes of video. Each starts directly. Custom setup combines time, section and media type on one phone screen; advanced topic exclusions and other durations stay in optional sheets. Longer saved/recent lists open separately so the common path does not require scrolling.

Recent setups are deduplicated and persisted locally, with actions to reuse or promote them. A second consecutive use of an unsaved setup prompts gently at the ending or next start. Any unsaved ending can be promoted; the reading session is never interrupted by a save prompt. Saving supports naming and default selection, and presets can be edited or removed. Extensions preserve the original session type for saving.

Fisher repeatedly uses the same session types and wants an obvious default instead of repeating a setup survey. This pass makes familiarity the fast path while keeping custom choices available. It changes the design prototype only.

## Factual copy and a visible custom action

Removed meditative slogans, affirmations, permission-giving and emotional validation throughout the active prototype, including menus, empty states, type specimens and utility bars. The ending now states Session complete and lists Saved articles, New session and Extend session. Natural-language remaining-time status stays; commentary on the user's choices does not. Original starter preset labels migrate to News and Video without changing user-defined names.

Custom session is now the first prominent action in the launcher's main content, above the default preset. The default card is compact and secondary. This addresses Fisher's rejection of the interface's generated filler and the custom workflow being hidden in a utility bar. Compact phone layouts retain the no-scroll start requirement.

## Review the completed session

Replaced the ending's Saved articles action with Review session. The condensed list contains items actually shown, with independent bookmark controls for assigning collections or creating one. Reopening an item returns to the same list position.

Fisher wants to review and save from the session as a whole, including items not saved while browsing. Stats therefore live beside this list: articles opened, video plays, skips and visible session time. Opening is not labelled as completed reading. The ending freezes those measurements so later review actions cannot rewrite them. Extensions retain activity and new sessions reset it. This changes the prototype only.
