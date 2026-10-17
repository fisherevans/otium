# Use SVG icons for app controls

**Date:** 2026-10-17
**Type:** decision
**Version:** v0.78.3
**Author:** codex

The Afterglow card hid its existing action SVG and inserted a Unicode northeast arrow with CSS. iPhone rendered that arrow as a blue emoji. Restore the existing action-specific SVG (book for Read, external link for Open original) and remove the pseudo-element. Replace the same arrow in source setup, item actions and YouTube settings with Lucide SVGs.

Control icons must remain monochrome and consistent across iPhone and e-ink. The experience contract now explicitly excludes emoji and Unicode pictographs as icons, including CSS-generated content. Action labels, handlers and destinations are unchanged.

Tracking: #167.
