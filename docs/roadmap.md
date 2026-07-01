# otium - roadmap

Milestones mirror the interview's staging. "Built" = works end to end in the
current code; "Next" = nearest unbuilt work.

## Milestone 1 - Session engine (in progress)

The core loop: ingest → normalize → rank → time-boxed session.

Built:
- SQLite store + schema (sources, feeds, items, item_state, sessions, events).
- Feed ingest (`internal/server/feeds`): RSS/Atom, YouTube channel feeds,
  podcasts; media-type classification + duration.
- Session builder (`internal/server/session`): deterministic
  `weight × freshness × rarity` scoring, per-source caps, diversity, greedy fill
  to a duration range, per-item reason strings.
- API: sources CRUD, feeds, `POST /session`, item events, on-demand + interval
  fetch.
- Web: intent screen with the two-axis duration pad, theme chips, session cards
  with reasons + open/like/skip, source library with in-place weight cycling.
- OIDC auth (auth.fisher.sh) + dev bypass.

Next (still M1):
- **Feed ↔ source assignment UI.** Feeds exist server-side and drive theme
  chips, but there's no UI yet to put a source in a feed (the API replaces a
  feed's whole source set; per-source toggle needs a read-modify-write or a new
  add/remove endpoint). Until then, sessions run against "everything you follow."
- **Cadence over a real window.** Rarity currently derives cadence from the
  items currently in a source's feed, but RSS truncates to ~10-15 recent
  entries, so a high-volume source reads as "rare." Fix: compute cadence from
  observed publish timestamps accumulated over time (we now store every item),
  not from a single feed snapshot.
- Per-source drill-in view ("catch up on this creator": recent / most-recent
  ordering). API exists (`GET /sources/{id}/items`); no UI.
- Session persistence/resume in the UI (session_id is returned + stored).

## Milestone 2 - Better curation

- Per-source weights already land; add long-press "more/less of this" in the
  session cards (Reddit-style nudge).
- Tunable freshness half-life + diversity per feed (constants today).
- Feed health dashboard (sources, active/dormant, uploads/day, % skipped).
- "Why this item?" expanded panel (score breakdown, not just the one-line
  reason).

## Milestone 3 - Discovery

- Trial source state machine (schema has `state`/`trial_until`); trial review
  surfaced in-flow at an exposure threshold.
- Like-based recommendations with explanations ("because you liked X").
- Discovery as a contextual review queue, per-feed or global.

## Milestone 4 - Intelligence

- LLM operator: conversational feed tuning, natural-language rules, agent-driven
  discovery, feed audits. Reads the events/stats JSON surface, proposes changes
  via the same API, user approves.

## Cross-cutting / ops (not yet done)

- k3s deploy manifests in nottingham-cloud (`k3s/projects/otium/`), OIDC client
  registration with Hydra, Cloudflare route for `otium.fisher.sh`, Datadog
  http_check. Tracked in the nottingham-cloud onboarding issue.
- Stats/insights views + the JSON/agent export endpoint.
