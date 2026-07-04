# otium - decisions

Key choices and why, so the next person (or the next me) doesn't re-litigate
them.

## Storage: SQLite, not Postgres

bloom (the template app) uses in-cluster Postgres. otium uses a single SQLite
file. Reasons:

- otium runs a single replica (sessions are in-memory OIDC sessions; see below),
  so there's no multi-writer contention to design around.
- The data is self-contained and modest (sources, items, per-item state, an
  event log). No cross-app joins, no need for a shared DB.
- Zero external dependency: local dev is `go run`, prod is one file on a PVC,
  backup is copying a file. Matches the homelab's "as simple as it can be" bias.

Driver is `modernc.org/sqlite` (pure Go) so the server image stays `CGO_ENABLED=0`
and static, like the other homelab Go apps. `SetMaxOpenConns(1)` + WAL avoids
`SQLITE_BUSY` under homelab load.

If otium ever needs multiple replicas or genuinely concurrent write load, revisit
- but that's a scale this app is unlikely to hit.

## Ranking is deterministic and explainable, on purpose

The product thesis is "an algorithm you own and can audit," not "no algorithm."
So the ranker is a transparent formula - `weight × freshness-decay ×
rarity-boost` - and every surfaced item carries a human-readable reason derived
from the same factors. No ML, no embeddings in the core loop. An LLM shows up
later only as an *operator* (a tool you converse with to retune), never as the
ranking black box.

## Freshness half-life resolves source > feed > global (#76)

The freshness-decay half-life is tunable at three levels, resolved in strict
precedence: a per-source override wins, else the item's resolved feed half-life,
else the global default (21 days). Feed-level came first (#17); the per-source
override (#76) sits on top so you can single out one noisy or one evergreen
source without reshaping its whole feed. 0 means "inherit" at both the source and
feed level, so the neutral setting reads as the middle, not as zero days.

A source can belong to several feeds, so "which feed's half-life?" is ambiguous.
The rule is a user preference (Settings > Preferences), with three options:

- **primary feed** (default) - the source's lowest-sorted feed, matching how feed
  *identity* already resolves elsewhere. Consistent and predictable.
- **shortest / longest half-life** - the min/max *effective* half-life among the
  source's feeds. "Effective" is load-bearing: a feed that inherits the global
  default counts as 21 in the comparison, not 0, so "shortest" doesn't collapse to
  always-picking an inheriting feed.

The resolution runs in SQL (in `candidateCols`, shared by the session pool, the
mix view, and resume-rehydration) so all three surfaces decay identically, which
is what keeps the `ItemEffectiveScore == scoreOf(sel=1)` invariant intact. The
one shared Go chokepoint is `session.halfLifeOf` - every scoring path funnels the
source/feed pick through it, so the breakdown the card shows is still the *actual*
ranking, never an approximation.

## Auth reuses bloom's OIDC client verbatim

otium is a confidential OIDC client of auth.fisher.sh (Ory Hydra), copied from
bloom's `internal/oidc` with only the cookie names and env prefix changed. The
no-discovery design (public issuer for browser redirects, in-cluster URL for the
back-channel token/JWKS exchange to avoid the Cloudflare hairpin) is load-bearing
and matches how bloom/ramble already work. Sessions are in-memory: the server is
otherwise stateless, and a restart triggers a silent SSO re-auth, not a password
prompt. This is why otium-server is single-replica.

## Two images (server + web), like bloom

otium ships `otium-server` (Go API) and `otium-web` (nginx + React build), built
by a matrix in one `build.yml`, both pinned together on a `vX.Y.Z` tag. This
deviates from the one-image contract exactly the way bloom does, and for the same
reason: a Go API and a static SPA have different runtimes. nginx proxies `/api/`,
`/healthz`, and `/auth/` to `otium-server`; everything else is the SPA.

## Intentionality & transparency, not anti-data (refined 2026-07-04, Fisher)

otium is **not** anti-data or anti-tracking. It's about **intentionality,
transparency, and privacy**. The earlier "no dwell tracking at all" framing was
too rigid. The real line is *what the data is used for*:

- **Dwell IS measured** - time genuinely engaging with an item: reading the
  description, opening the in-app reader/browser, clicking through and being away
  for a while. That's a signal you're actually consuming what you *intended* to.
- It is **never** used to optimize/maximize engagement, and **never** silently
  re-ranks the feed. It powers one thing: a **check-in**. Fast-swiping without
  engaging → "you're scrolling fast - want to keep going, or do something else?"
  A nudge toward self-honesty, not a feed change.
- **User-toggleable** in settings (off = the old explicit-only behavior).
- Data stays **local and transparent** (single SQLite file, the user's own),
  surfaced back to the user (stats/insights), never sold or used to grow time-on-app.

The refusal is **engagement optimization**, not measurement: don't use behavior
to maximize consumption or covertly re-rank. Measuring to help the user notice
when they've drifted from their own intention is on-thesis. This supersedes #6/#5
being "gated" - dwell-for-check-in is a go, with the settings toggle.

The `events` table stays append-only (open/like/skip/save/session_build, + dwell
under this policy) - raw material for user-owned stats and the future LLM/agent
surface.

## Deliberate non-goals (what otium refuses)

From the 2026-07 competitive UX audit (docs/ux-audit.html). These are "table
stakes" in mainstream readers that otium *proudly* omits - naming them is part of
the product's identity, not a backlog:

- **Unread counts / badges / "mark all read."** The thesis. The new Reeder (2024)
  independently killed read/unread state too - otium is on the leading edge, not
  out on a limb. The absence is a feature.
- **Infinite / algorithmic "For You" feed.** Artifact (Instagram's founders) died
  in this space after bolting on social/link-posting to chase growth. The finite,
  explainable session is the whole point.
- **AI auto-summaries, dedupe, gamified catch-up triage.** All optimize throughput;
  otium optimizes intention. Summaries specifically undermine "you actually read
  the thing you chose."
- **Rules/automation engines and per-item tags.** Librarian tooling. Source-weight
  buckets + collections (#57) are the right altitude.
- **In-app social / commentary / link-posting.** Share-out is a link (#56), not a
  network. This is the exact scope creep that killed Artifact.
- **Engagement *optimization*.** Measuring dwell to help you notice you've drifted
  (a check-in) is fine and wanted; using behavior to *maximize* consumption or
  covertly re-rank the feed is the refusal. See "Intentionality & transparency"
  above - the app measures to serve your intention, never to grow time-on-app.

The risk for otium isn't under-featuring - it's getting talked into the features
that killed the incumbents.
