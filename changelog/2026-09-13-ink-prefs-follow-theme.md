# Ink preferences resolve to theme tokens

**Date:** 2026-09-13
**Type:** refactor
**Author:** claude-code

## What changed

`INK_SHADES` in `web/src/context/PreferencesContext.tsx` maps the ink keys to
palette tokens (`var(--ink)`, `var(--ink-graphite)`, `var(--ink-soft)`,
`var(--ink-mute)`) instead of light-mode hex. `--ink-graphite` is a new token in
both palettes (light `#3a352d`, dark `#ede9df`, between `--ink` and `--ink-soft`).

## Why

The table held fixed light-mode hex and `prefsToVars` always writes it into
`--pref-reader-ink` and the card byline inks. The dark palette only overrides
tokens, so those five variables stayed near-black on near-black paper: the reader
body was unreadable in dark mode on the Palma, and the card's source / author /
date went dim. The CSS fallbacks were theme-aware but never reached, because the
pref vars are always set.

Resolving to tokens keeps the "two themes, one palette" rule: no JS theme
awareness, and the Appearance swatches (which use the same table) follow the theme
for free.

## Context / alternatives

A second hex table keyed off `data-theme`, or lightening the literals, would both
fix the symptom but put colour outside the palette again, which is how this broke.

Same change restores the Appearance font/segmented pickers' styling: they still
used the `.wbucket` classes whose CSS was renamed to `.repbucket` in #120, so they
rendered as unstyled browser buttons (light text on a light chip in dark mode).

## Related

- #159, #149 (dark palette tuned for e-ink), #90/#97 (ink preferences)
