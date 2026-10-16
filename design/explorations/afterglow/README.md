# Afterglow: a closer look

Second-round design prototype for [#163](https://github.com/fisherevans/otium/issues/163), following Fisher's selection of Afterglow from the ten independent studies. This is an interactive, local-state exploration, not the production application.

Open `index.html?audition=0#start` for the complete new-session walkthrough: Start, choose time, choose scope/topics, Begin, read/save/return, then end or extend. Time and topics select a finite subset of the sample fixtures; natural-language time advances as you move through them, so the entire flow can be reviewed quickly. An empty topic selection disables Begin. Changing setup does not alter the active session until Begin.

Fraunces is the selected title face, with Newsreader for reading. Existing study preferences migrate to this pairing once. `Aa` opens reading size and appearance controls. The study guide is under Your Otium > About this study.

## What this round demonstrates

- One centered brief per vertical swipe, dedicated Next, article context menu and natural-language time phases.
- The whole non-video brief opens the reader. Its linked headline also works by keyboard; video controls remain independent.
- Complete images inside their frames, with natural proportions where space permits. Long titles lose lines before the image is squeezed below its comfortable height. Full titles appear in the reader.
- Hold a photograph to open the full-image viewer. The article menu and reader's Full image button provide explicit alternatives. Dragging cancels the tap; holding does not also open the reader.
- A deliberate upward swipe that begins at the bottom of a session article advances to the next brief. Ordinary scrolling does not. Back, swipe-right Back and the tappable continuation cue coexist. Saved articles do not advance the session.
- A persistent bottom instrument on every page, with a folded O mark, explicit role label, distinct session/reader/app treatment, and short content transitions. E-ink and reduced-motion settings suppress these transitions.
- Local multi-collection saving, collection management, source preferences, add/import previews and a complete finite new-session walkthrough.

## Scope

There is no account API, ingestion, extraction or production session generation. Four real article fixtures from the earlier measured sample are shared by every font. Teasers are labelled, length-matched paraphrases. The reader links to the publisher rather than copying its full article. The landscape clip is illustrative. Setup selects matching fixtures by scope and exclusions and limits the short sample by duration. It is a deterministic mock, not the production representation/eligibility engine. The active plan and article IDs are snapshotted separately from setup drafts and persist across reloads.

Source/topic structural edits are explicitly labelled simulations that retain the comparison fixtures. Production's YouTube, Shorts, audio, extraction retry, full appearance controls, history pagination, import discovery and account flows remain requirements for an implementation; this study does not replace or remove them.

Assets and fonts are local; all six font licenses are included. Content measurements and credits are in `content.js`, `measurements.json` and `notes.html`. All account-like changes stay in browser localStorage under `otium-afterglow-study`.

## Review

- [Start a new session](https://quiver.fisher.sh/static/reports/otium/2026-10-16-afterglow/?audition=0#start)
- [Interactive prototype](https://quiver.fisher.sh/static/reports/otium/2026-10-16-afterglow/)
- [Flow feedback](https://quiver.fisher.sh/static/reports/otium/2026-10-16-afterglow-feedback/?annotate)
- [Original ten directions](https://quiver.fisher.sh/static/reports/otium/2026-10-16-analog-directions/)

Browser verification and its limits are recorded in `validation.md`. Physical iPhone and e-ink checks remain part of choosing and implementing the design.
