# Dark mode: high-contrast for e-ink

**Date:** 2026-08-14
**Type:** fix
**Version:** v0.71.1
**Author:** claude-code

## What changed

Reworked the dark palette for e-ink instead of OLED. The paper went near-black and
the whole foreground was pushed high-luminance: even "muted" text is now a clearly
light grey, not a mid grey, and the rules were lightened so hairlines are visible.
Topic-pill text and the source-avatar monogram no longer take the topic's own color
(they use the light ink, with the color kept only as a subtle accent), since a dark
topic color read as grey-on-black.

## Why

Fisher, on his actual e-ink device: "the colors are very hard to read in dark mode
on my e-ink screen. Dark greys on black just don't work well." E-ink can't render
the tonal gap between a dark grey and black, so the subtle muted greys that read
fine on a phone (even after the v0.71.0 lift) disappeared on the display otium is
actually built for. otium is e-ink-first by design, so dark mode has to be
genuinely high-contrast - legibility from luminance, not from color or subtle tonal
steps (which is also why the semantic and topic colors were pushed light or dropped
in favor of the ink: on greyscale e-ink the hue is lost anyway).

Follow-up to v0.71.0; part of issue #149.
