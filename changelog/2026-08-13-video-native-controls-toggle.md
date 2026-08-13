# Video: subtle toggle to YouTube's native controls

**Date:** 2026-08-13
**Type:** feature
**Version:** v0.69.0
**Author:** claude-code

## What changed

Added a subtle top-right toggle on embedded YouTube videos that flips between
otium's custom gesture overlay (the default) and YouTube's own native controls.
Native mode exposes the scrubber, captions, quality, the YouTube link, and native
fullscreen. The toggle recreates the player (the `controls` playerVar is
construction-time only) and restores the playhead so the swap is seamless; in
native mode the gesture overlay steps aside so YouTube receives the taps.

## Why

Removing the broken fullscreen button (v0.68.0) left no in-card path to captions,
quality, or the YouTube link - Fisher had no way to reach them without leaving
otium. The div-wrapped iframe + `controls:0` exists so vertical scroll and
tap-to-play work cleanly, and that's the right default. But the escape hatch was
missing. This toggle is that hatch: keep the clean, gesture-driven default, and
flip to full native controls (including native fullscreen, which *does* work on
iOS because it's YouTube's own player doing it) when you actually need them. The
tradeoff, only while native controls are on, is that swipe-to-navigate is handed
to YouTube.

Part of issue #149.
