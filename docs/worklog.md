# Autonomous work log

A running, chronological record of what got built/deployed autonomously, the
judgment calls made along the way, and what's blocked on Fisher. GitHub issues
are still the source of truth for open work; this is the digest so Fisher can
catch up without reading every commit. Durable architectural/product decisions
graduate into [decisions.md](decisions.md); this log is the process trail.

## 2026-07-02 → 07-03 · Deploy + session-UX push

### Shipped & deployed
- **v0.1.0** - stood otium up in k3s, gated behind auth.fisher.sh, imported
  Fisher's real feeds (144 YouTube + 18 RSS, 1802 items). Deploy milestone
  #27-31 closed.
- **v0.2.0** - session escape chrome (#42), in-app reader (#41), "···" item
  action menu (#43).
- **v0.3.0** - card reorder title-above-media (#46), feed+source identity line
  (#44), flat feed icon pack (#45), tap-card-to-open (#47), relative item age
  (#48).

### Decisions made (my call)
- **Reader HTML sanitizer → DOMPurify, not hand-rolled** (#41). Rendering
  untrusted feed HTML via `dangerouslySetInnerHTML` with no CSP; a bespoke DOM
  walk can't cover mXSS. Swapped to the vetted standard before shipping. *Rule:
  untrusted HTML always goes through a real sanitizer.*
- **Feed icons → `lucide-react`, closest-glyph mapping** (#45). Headless agents
  can't reliably hand-author accurate SVG art, so v1 maps categories to the
  nearest clean Lucide glyph (comedy→theater masks, local→map-pin). Pixel-exact
  bespoke silhouettes (VT state shape, jester) deferred as a cheap follow-up.
- **Primary-feed rule** (#44): a source in multiple feeds resolves to lowest
  `feeds.sort` then `id`; feedless (YouTube) sources render source-only. Feed
  membership has no stored "primary" concept - it's synthesized at read time.
- **Schema migrations → guarded `ADD COLUMN` on boot** (#45). `feeds.icon` added
  via an idempotent `ensureColumn` (pragma check) in `store.Open()`, since
  SQLite has no `ADD COLUMN IF NOT EXISTS` and the schema is embedded/no Job.
- **Import path**: server scaled to 0 + throwaway dev-user pod on the PVC (never
  routed) rather than exposing an auth bypass. Safe because dev-auth and OIDC key
  the same `username` row.
- **Deploy cadence**: one coherent batch per release (v0.2.0, v0.3.0), reviewed
  and shipped as a unit, rather than one deploy per issue - keeps the card edited
  once per pass and gives one clean review surface.

### Blocked on Fisher (not mine to decide)
- **#6 - start logging per-item dwell?** Conflicts with the documented
  "signals are explicit only, no dwell tracking" principle (decisions.md +
  EXPERIENCE.md principle 2). Reversing a written privacy principle needs your
  call. It gates #5 (behavioral pace) having history to work with, so worth
  deciding early - but I won't flip it unilaterally.
- **#12 - long-end flex fan width.** A tuning decision better made against real
  usage data; leaving it until the mix view (#49) surfaces how sessions actually
  compose.

### In flight
- **#49 - feed "mix" view** (JIT effective share × skip rate). Dispatched.
  **Viz decision (my call):** ranked horizontal share-bars as the workhorse (one
  row per source: feed icon + name + share bar + skip%), sorted by share or by
  share×skip "inefficiency", PLUS a compact donut header (top-N + "other") to
  honor the "pie chart" instinct - a grayscale 15-slice pie alone is illegible on
  e-ink. Steerable while the agent runs.

### Queue (planned batches, sequential to avoid same-repo merge conflicts)
- **Batch 4 - ranker signal quality (no principle conflict):** #7 cadence from
  accumulated publish timestamps (fixes rarity underestimate for truncated RSS +
  the YouTube no-duration gap), #17 tunable freshness half-life + diversity per
  feed, #11 smarter session fill. All use publish timestamps / config only - no
  behavioral tracking, so safe to build without a principle decision.
- **Batch 5 - score transparency + library:** #18 why-this-item breakdown, #40
  per-item score cue + click-in, #16 library sort/group + per-source stats, #35
  library filters, #37 undo on management changes. Mostly surfacing data that
  already exists.
- **Later / bigger bets:** Discovery milestone (#20-23, finding *new* sources),
  Intelligence (#24 stats, #25 agent API, #26 LLM operator).

### Gated on the dwell decision (#6)
Both **#5 (behavioral per-feed pace)** and **#6** depend on measuring per-item
dwell, which the "explicit signals only" principle forbids. Neither can proceed
until Fisher decides whether to relax that principle. Everything else in the
ranker batch (#7/#17/#11) is independent of it, so the ranker work isn't blocked
overall - only the behavioral-pace half is.
