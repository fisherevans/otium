# Motion + press feedback ("juice") as a default

**Date:** 2026-08-14
**Type:** feature
**Version:** v0.72.0
**Author:** claude-code

## What changed

Added a small motion system and turned it on across the app:

- Motion tokens in `global.css` (`--dur-fast` 90ms / `--dur` 170ms / `--dur-slow`
  300ms, `--ease`/`--ease-out`).
- **Global press feedback**: every enabled button dips ~0.96 scale under the finger
  (transform-only, no reflow), on top of its per-control :active state. The
  session-start tiles (time chips, section tiles) get a firmer flash (darken + hard
  rule).
- **Screen transitions**: intent-flow steps slide+fade as they mount; route
  navigation fades the new screen in (keyed `<main>` so it replays per nav); arriving
  in a session fades the reel in.
- `prefers-reduced-motion` collapses all of it to ~instant.
- Codified in `design/EXPERIENCE.md` (Motion & feedback).

## Why

otium had shipped almost no animation on the premise that slow-refresh e-ink
couldn't handle it. Fisher's panel is responsive (the real constraint was contrast,
fixed in v0.71.1), and he wants clean, tactile feedback and "juice" - a tap that
always answers, screen changes that read as transitions - as a general rule, not a
per-screen decision. The calm otium wants now comes from the *quality* of the motion
(quick, smooth, purposeful, no bounce), not its absence. Reduced-motion is honored so
the default-on stance stays accessible.

Issue #150.
