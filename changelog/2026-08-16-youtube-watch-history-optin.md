# YouTube watch history: opt-in youtube.com embed

**Date:** 2026-08-16
**Type:** feature
**Version:** v0.73.0
**Author:** claude-code

## What changed

Added a Settings toggle **"Let YouTube log my watches"** (default OFF). When off, the
in-card player embeds from `youtube-nocookie.com` as before (private, no history).
When on, it embeds from `youtube.com`, so a watch can reach the user's YouTube
history if they're signed in and the browser sends YouTube's cookies. The setting is
server-persisted (kv store), returned by `GET /settings`, and threaded to
`InlineMedia`'s player host (toggling recreates the player). The video's external-open
button is relabeled "Open on YouTube".

## Why

Fisher: in-app YouTube watches never showed up in his YouTube account, so he couldn't
find a video later by going to his history. Root cause: otium embeds via
`youtube-nocookie.com`, which deliberately never touches the account. The honest
constraints (documented in the Settings copy and issue #151):

- `youtube.com` embedding is the only lever that *can* log a watch, and even then only
  when signed in with third-party cookies allowed - unreliable in an installed PWA on
  a different origin.
- There is no API to write watch history (the planned account integration #143 reads
  subscriptions/playlists; it can't push history).
- The only guaranteed path is opening the video on YouTube proper - which the Settings
  copy points at ("Open on YouTube always logs it").

Made it a **setting** (Fisher's choice) rather than default-on: it trades the embed's
privacy for history and isn't guaranteed, so it's opt-in with a clear disclaimer.

Issue #151.
