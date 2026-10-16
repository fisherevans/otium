# Afterglow: a closer look

Second-round design prototype for [#163](https://github.com/fisherevans/otium/issues/163), following Fisher's selection of Afterglow from the ten independent studies. This is an interactive, local-state exploration, not the production application.

Open `index.html`. The visible typeface strip cycles six bundled serif families without moving the current article. `Aa` opens the specimens and the body-font toggle. Hide the strip to judge the unobstructed app. The study guide is under Your Otium > About this study, also accessible from the typeface sheet.

## What this round demonstrates

- One centered brief per vertical swipe, framed media, a dedicated Next button, article context menu, and natural-language time phases.
- A contextual bottom instrument across session, reader, setup, Library, source controls, Saved, appearance and ending. No destination tabs during a session.
- Reader origin and current session position retained while visiting surrounding screens.
- Six rendered choices: Newsreader, Source Serif 4, Literata, Lora, Fraunces and Crimson Pro. Headlines start at 28px (26px narrow); full long titles can fit down to 21px in the shortest comparison view. Teasers remain 16-17px.
- Local multi-collection saving, collection management, representation/archive/category/keyword controls, source-add and OPML/URL import previews.
- Paused inset video and a light, grayscale e-ink presentation.

## Scope

There is no account API, ingestion, extraction or production session generation. Four real article fixtures from the earlier measured sample are shared by every font. Teasers are labelled, length-matched paraphrases. The reader links to the publisher rather than copying its full article. The landscape clip is illustrative. The setup controls demonstrate intent but intentionally use the same fixed comparison set.

Source/topic structural edits are explicitly labelled simulations that retain the comparison fixtures. Production's YouTube, Shorts, audio, extraction retry, full appearance controls, history pagination, import discovery and account flows remain requirements for an implementation; this study does not replace or remove them.

Assets and fonts are local; all six font licenses are included. Content measurements and credits are in `content.js`, `measurements.json` and `notes.html`. All account-like changes stay in browser localStorage under `otium-afterglow-study`.

## Review

- [Interactive prototype](https://quiver.fisher.sh/static/reports/otium/2026-10-16-afterglow/)
- [Typography and flow feedback](https://quiver.fisher.sh/static/reports/otium/2026-10-16-afterglow-feedback/?annotate)
- [Original ten directions](https://quiver.fisher.sh/static/reports/otium/2026-10-16-analog-directions/)

Browser verification and its limits are recorded in `validation.md`. Physical iPhone and e-ink checks remain part of choosing and implementing the design.
