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
- **v0.4.0** - feed mix view (#49): `GET /api/v1/mix` (JIT effective + intended
  share per source, skip%), donut header + ranked share-bars with the "wants X%"
  ghost gap, inefficiency sort, downweight/archive from the row.
- **v0.5.0** - ranker accuracy (#7 cadence from accumulated publish history,
  fixing the truncated-feed rarity bug) + per-feed tunable freshness half-life &
  diversity (#17, "Feed settings" in the library).

### Decisions made (my call) - v0.5.0, worth a glance
- **Cadence thin-history floor** (#7): a source with <3 items in the window gets
  no rarity boost (biased against false boosts on brand-new sources). Side effect:
  a *genuinely* very-rare source also gets no boost until it accrues history.
  Deliberate, matches the issue's priority - flag if it feels wrong once feeds
  have more history.
- **Diversity control is a per-source cap** (#17): "higher number = fewer items
  per source = more spread," which inverts the intuitive "higher = more diverse."
  Labeled with a caption; it's a UI-mapping change only if you'd rather the number
  climb with diversity. Tell me if the inversion bugs you.
- **Perf note:** per-candidate feed resolution adds correlated subqueries per row
  - fine at single-user scale (indexed), flagged if the pool ever grows.

### Decisions made (my call) - v0.4.0
- **Mix share = all known items, freshness-decayed** (#49), not just-unseen.
  Reflects a source's content *production* decayed by recency, independent of
  what you've consumed. "Only unseen" (what's left to pull) is a one-line
  alternative if the current framing feels off in use.
- **Mix entry = a Library link, not a 3rd nav tab** (#49). EXPERIENCE.md caps the
  primary nav at Intent/Library and lists Insights as a secondary surface; kept
  that. Easy to promote if you want it one tap closer.
- **`effective == ranker scoreOf` locked by a unit test** so the mix can never
  silently drift from what sessions actually surface.

### Tooling friction (noted, not blocking)
- This machine's `gofmt` is a shell function that shells to goimports/`go vet`
  without `GOWORK=off` and chokes on the parent `~/dev/go.work`. Use the real
  binary: `$(go env GOROOT)/bin/gofmt`. (Agents building otium should do the same
  rather than trust `make fmt`.)

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
- **Batch 5 (in flight) - score transparency:** #18 why-this-item breakdown,
  #40 per-item score cue + click-in. Card cue → tap → per-factor breakdown
  (weight/freshness/rarity/skip); needs the backend to expose the score factors.
- **Batch 6 - smarter session fill:** #11 fill within the flexible window.
- **Batch 7 - library:** #16 sort/group + per-source stats, #35 library filters,
  #37 undo on management changes. Mostly surfacing data that already exists.
- **Later / bigger bets:** Discovery milestone (#20-23, finding *new* sources),
  Intelligence (#24 stats, #25 agent API, #26 LLM operator).

### Gated on the dwell decision (#6)
Both **#5 (behavioral per-feed pace)** and **#6** depend on measuring per-item
dwell, which the "explicit signals only" principle forbids. Neither can proceed
until Fisher decides whether to relax that principle. Everything else in the
ranker batch (#7/#17/#11) is independent of it, so the ranker work isn't blocked
overall - only the behavioral-pace half is.
