# Keep the layout lab and its measuring instrument

**Date:** 2026-08-19
**Type:** infra
**Author:** claude-code

## What changed

`web/tools/measure.mjs` drives a real Chromium against either the layout lab or a
running session and reports what the card actually did: space above the first line
and below the action row, the header rhythm, the resolved title size, the media's
share of the card, any overflow, and whether the actions are reachable. It exits
non-zero if a card clipped, so it can gate a change rather than only describe one.
`npm run lab` and `npm run measure` wire it up; `web/src/lab/README.md` documents
the loop and CLAUDE.md points at it.

## Why

The session card's layout is solved at runtime, so it cannot be reviewed by
reading a stylesheet - the numbers only exist once a browser has laid it out. That
makes the lab and this instrument the only way to change the card safely, and
neither is discoverable from the source alone.

Screenshots are not a substitute, which is the part worth writing down. During the
layout work a card that "looked centred" was 33px off; a probe that agreed with
itself was adding half-leading to an element that renders no glyphs, over-reporting
one gap by 4px; another mixed transform-scaled rects with unscaled offsetHeight and
reported media at 119% of a card it filled 81% of. Every one of those was caught by
measuring, and none of them by looking. The instrument encodes the corrections so
the next person does not rediscover them.

The lab itself was already committed. What was missing was the thing that told us
whether a permutation was actually good, which lived in a scratch directory and
would have been lost.

## Context / alternatives

The scratch scripts were five overlapping one-offs. They are consolidated into one
tool with two modes - `--lab` to design against fixtures, `--app` to verify what
ships - because the split is real: the lab covers content shapes that break
layouts, the app covers what the server actually returns.

Playwright is now a devDependency. It is only needed to run the harness, and the
alternative (leaving it implicit) is what made the scripts unrunnable in the first
place.

## Related

- changelog/2026-08-19-solved-session-card.md
- web/src/lab/README.md
