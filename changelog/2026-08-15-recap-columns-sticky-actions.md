# Session recap: aligned columns + always-visible actions

**Date:** 2026-08-15
**Type:** fix
**Version:** v0.72.1
**Author:** claude-code

## What changed

- The recap stats are now a fixed 3-column grid (label | count | time). Counts share
  one right-aligned column and durations another, with continuous row hairlines, so
  numbers no longer ping-pong left/right as rows do or don't carry a time.
- The recap actions (Start a new session / back to reading) are a sticky footer, so a
  tall recap (all stat rows on a short e-ink screen) can scroll its stats without the
  buttons scrolling out of reach.

## Why

Fisher, on the Palma 2: the end-session stat numbers jumped horizontally row to row
(count-only rows put the number at the far right; count+time rows put it left of the
time), and the buttons at the bottom could be "lost" below the fold when the recap was
tall - the internal scroll isn't obvious on e-ink. A real grid fixes the alignment; a
sticky footer keeps the actions in view regardless of height.

Part of issue #150.
