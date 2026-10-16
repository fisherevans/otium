# iPhone experience and folded O identity

**Date:** 2026-10-16
**Type:** feature
**Version:** v0.77.0
**Author:** Codex

## What changed

Unified the full-text reader and media surfaces across sessions, Saved, History and source articles. Added named native modal dialogs with nested focus containment, browser Back support, reliable entrance transitions and reduced-motion handling. Session gestures now reject stale or canceled pointers and keep action-row touches separate from navigation.

Read now confirms duration and scope before Begin, with topic customization optional. Library leads with source addition and import, You leads with utilities, and descendant navigation and Saved URL state preserve context. Failed loads and saves show actionable errors and preserve drafts. Appearance previews the shipped card and reader, reconnects current typography controls, preserves account preferences, and adds device-local Standard/E-ink presentation. New accounts default to natural-color images.

Introduced the folded O vector mark and refreshed the wordmark lockup, favicon, Apple touch icon and PWA icons. Raised shared touch areas, secondary contrast and navigation label sizes while retaining the paper palette and editorial reading typography.

## Why

The original experience treated e-ink as the main device. Daily use has moved to iPhone. That requires clear hierarchy and dependable touch behavior, while keeping e-ink a first-class presentation of the same app. A shared reader, card and modal vocabulary removes the inconsistencies that accumulated across independently built screens.

## Related

- #161, implementing the review in #160.
- [Experience contract](../design/EXPERIENCE.md).
