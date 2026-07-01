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

## Signals are explicit only

No dwell-time or scroll tracking, by design (principle 2). The `events` table is
append-only and captures explicit actions (open/like/skip/save) plus
session_build. It's the raw material for user-owned stats and the future
LLM/agent surface - so it's generous with what it records, but never implicit
behavioral surveillance.
