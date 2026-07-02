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
- `internal/server/session` - the ranker. Score is
  `(weight·rarity)^selectivity · freshness · skipPenalty`; it stages a
  count-bounded ranked **queue** (not sized to summed duration - the client
  paces it against elapsed wall-clock). Per-source caps, per-item reasons,
  budget-driven selectivity, skip-rate downweighting. **This is the core; keep
  it deterministic and explainable.**
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
  **E-Ink** - ink on paper, Charter serif, Didot display, hard hairline rules,
  dithered media, deliberately slow "e-ink refresh" transitions. Tokens +
  components live in `web/src/styles/global.css`; the reference is
  `design/prototypes/eink/eink-refined.html` (scroll-snap session + compact
  bottom bar + media reel). Keep it calm: no urgency, no badges, no unread
  counts, no infinite scroll. [design/EXPERIENCE.md](design/EXPERIENCE.md) is
  the theme-independent contract (IA, the intent-pad spec, touch rules,
  anti-patterns) the app must honor.
- The SPA calls relative `/api/v1` and `/auth/*` - never a build-time base URL.
  Dev proxy and prod nginx both do the split.
- Explicit signals drive curation - like / skip / open / weight only. The one
  allowed *implicit* read is pace: fast-flicking may trigger a **visible
  check-in**, never a silent re-rank or engagement surveillance (EXPERIENCE.md
  principle 3).

## Tracking & work definition (GitHub issues)

GitHub is where in-flight work lives; the repo is current state. Same stance as
nottingham-cloud: a file in this repo describes what *is* - anything proposed,
planned, or half-done is a GitHub **issue**, not a `TODO` comment or a prose
roadmap. Read the open issues before starting work; they're the backlog.

- **Milestones** group the work into streams: `Session engine`,
  `Curation & controls`, `Discovery & trials`, `Intelligence & agent`,
  `Deploy to homelab`, `Design system`. A new big bet gets a milestone.
- **Labels** slice it: `decision` (needs Fisher - don't guess, surface it),
  `ops`, `design`, `discovery`, `intelligence`, `ux`, `tech-debt`,
  `enhancement`.
- **Open an issue when a stream starts**, reference it in every related commit
  (`subject … (#N)`), and close it when the change lands. Reconstruct a whole
  stream later with `git log --grep '#N'` + `gh issue view N`.
- **Genuinely isolated** one-or-two-commit changes with no follow-on don't need
  an issue - mark them `[oneoff]` (or `[hotfix]`) in the message. There is no
  commit-msg hook enforcing this here (unlike nottingham-cloud), so keeping the
  history honest is on you.
- This is an app repo, not the mainline ops repo, so **feature branches are
  fine** for in-progress code (worktrees via nottingham-cloud's
  `scripts/repo-wt.sh`) and small tested changes can land straight on `main`.
  Either way, tie the work to its issue.
- `docs/roadmap.md` is a high-level narrative only; the **issues + milestones
  are the source of truth** for open work. Don't reintroduce open work as TODO
  sections - file an issue.

```sh
gh issue list --milestone "Session engine"        # what's open in a stream
gh issue list --label decision                    # what needs Fisher
gh issue create --title "…" --label ux --milestone "Curation & controls"
git log --grep '#14' --oneline                    # every commit in issue 14
```

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
  timestamps - tracked as a `tech-debt` issue.
- Content duration is unavailable from YouTube RSS (only podcasts carry it), so
  the "predicted items" math leans on a per-feed default. The truer signal is
  behavioral per-feed pace, measurable now via the single-item view - tracked in
  the Session engine milestone.
- The `db/` schema is embedded into the `store` package (`schema.sql`), applied
  idempotently on boot. There is no migrate Job - just additive
  `CREATE … IF NOT EXISTS`. A destructive migration would need real thought.
