# Per-session YouTube Shorts toggle + no sign-in flash on launch

**Date:** 2026-08-16
**Type:** feature
**Version:** v0.74.0
**Author:** claude-code

## What changed

- **Shorts toggle (#152).** The fine-tune (session-start) screen now shows a
  "YouTube Shorts" switch whenever the selected scope includes any YouTube source.
  Off drops short-form video (`media_type` "short") from the session, keeping
  long-form video and everything else. It's a per-session build choice: the intent
  flow sends `include_shorts` to `POST /sessions`, and the builder filters the
  candidate pool before allocation. Shorts-vs-videos only (no duration heuristics).
- **No sign-in flash (#152).** Opening the app when unauthenticated used to paint a
  "Sign in to continue" button for ~3s while the API client's 401 handler was already
  auto-redirecting through Google. It now shows a "signing in…" loading state during
  that redirect; the manual "Sign in" button only appears after 4s (redirect stalled
  / genuinely needs a click).

## Why

- Fisher wanted to decide, at session start, whether a video-containing scope includes
  Shorts or only longer videos - the two sides of YouTube carry different kinds of
  content. Detection is scope-aware (only shows when there's YouTube in the
  selection); the filter is server-side so the queue is built without shorts.
- The sign-in button flashing then auto-redirecting was confusing - a button you never
  press. A loading state matches what's actually happening (an in-flight redirect).

Issue #152.
