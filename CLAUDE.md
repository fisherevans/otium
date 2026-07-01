# otium - agent context

otium is an intentional media-consumption app: it assembles finite, time-boxed,
explainable **sessions** from weighted feeds instead of serving an infinite
timeline. Read [docs/product.md](docs/product.md) for the thesis before changing
behavior; [docs/decisions.md](docs/decisions.md) for why things are the way they
are.

This is a standalone public repo deployed to Fisher's homelab k3s cluster. It
follows the nottingham-cloud app contract (own repo, GHCR images, semver-tag
release, deploy pinned from nottingham-cloud). It is **not** the ops repo - deploy
manifests and the managed-repos registry live in nottingham-cloud.

## Architecture

Two processes, one repo:

- **otium-server** (`cmd/server`, `internal/…`) - Go API + background feed
  ingest, one binary. State in a single SQLite file.
- **otium-web** (`web/`) - React + Vite SPA, nginx-served in prod.

Server layout:
- `internal/server/store` - SQLite persistence + schema (embedded, applied on
  boot). All SQL lives here.
- `internal/server/feeds` - fetch + normalize a source's feed into items
  (gofeed; RSS/Atom, YouTube channel feeds, podcasts).
- `internal/server/session` - the ranker. `weight × freshness × rarity`, greedy
  fill to a duration range, per-source caps, per-item reasons. **This is the
  core; keep it deterministic and explainable.**
- `internal/server/handler` - thin HTTP handlers.
- `internal/server/middleware` - auth gate (OIDC session or dev bypass).
- `internal/oidc` - confidential OIDC client of auth.fisher.sh (copied from
  bloom; don't diverge without reason).

## Local dev

Two terminals. Server runs with an auth bypass; Vite proxies to it.

```sh
make server   # :8080  OTIUM_DEV_USER=fisher, on-demand fetch
make web      # :5173  proxies /api + /auth -> :8080
```

The Go module is standalone (not in `~/dev/go.work`). Build/test/run it with
`GOWORK=off` - the Makefile already does. Data lands in `./data/otium.db`
(gitignored).

## Conventions

- Go: 4-space indent via gofmt, same-line braces, explicit errors, short names
  in tight scopes. `make fmt` before committing.
- TS/React: mobile-first (Fisher tests on his phone). The visual language is
  warm ink-on-paper, serif display; keep it calm - no urgency, no badges, no
  infinite scroll. Styles are hand-written CSS vars in `web/src/styles/global.css`.
- The SPA calls relative `/api/v1` and `/auth/*` - never a build-time base URL.
  Dev proxy and prod nginx both do the split.
- Explicit signals only. Never add dwell-time or scroll tracking (product
  principle 2).

## Release + deploy

- Push to `main` publishes `:main`/`:latest`/`:sha-…` for both images.
- Cut a release: `git tag vX.Y.Z && git push --tags` → GHCR gets
  `ghcr.io/fisherevans/{otium-server,otium-web}:vX.Y.Z`.
- Deploy is a pin bump in **nottingham-cloud** (`k3s/projects/otium/`), not here.

## Gotchas

- otium-server is **single-replica** (in-memory OIDC sessions). Don't scale it
  without adding a shared session store.
- Rarity/cadence is currently underestimated for high-volume RSS sources (feeds
  truncate to ~10-15 entries). Real fix is cadence from accumulated publish
  timestamps - see roadmap M1.
- The `db/` schema is embedded into the `store` package (`schema.sql`), applied
  idempotently on boot. There is no migrate Job - just additive
  `CREATE … IF NOT EXISTS`. A destructive migration would need real thought.
