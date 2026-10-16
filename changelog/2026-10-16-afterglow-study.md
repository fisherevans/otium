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
