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
- **v0.6.0** - score transparency (#18/#40): hairline score cue on the card →
  tap → per-factor "why this item" breakdown, factors multiply back to the score
  (test-locked).
- **v0.7.0** - library sort/group (#16) + signal filters most-skipped/noisy/
  dormant (#35). Reduced scope after finding feed/state filters + undo already
  existed.

### Reconciled without building (v0.7.x)
- **#36 closed** - the v0.7.0 library "N× noisy" (posts/day vs set median) + the
  mix view's share already give the "Nx the average source" read.
- **#34 (store RSS categories) held** - genuine work, but it's enabling infra for
  #33 content rules (which needs direction). Not churning the schema for an
  unplanned feature; categories aren't privacy-sensitive so capturing early is an
  option if #33 gets greenlit.

### In flight
- **Batch 7 - input robustness:** #10 swipe-to-advance (session), #3 pad
  accessibility fallback (non-gesture path on HomePage). Frontend only.

- **v0.8.0** - swipe-to-advance (#10) + non-gesture pad fallback / a11y (#3).

## Autonomous runway complete (v0.8.0)

18 issues closed across 8 verified releases (v0.1 → v0.8) in one push. **Every
scoped, no-direction-needed issue is shipped.** #4 (desktop/e-ink) turned out to
be a vague "someday" design-direction placeholder, not a scoped task - building a
desktop redesign across all pages is a design bet, so it joins the needs-direction
list rather than getting guessed at.

### Everything remaining needs Fisher's direction (holding - won't guess)
**Quick decisions that unblock work:**
- **#6 dwell logging** - reverses the explicit-signals-only principle; gates #5
  behavioral pace. The single highest-leverage unblock.
- **#11 session fill** - confirm the reframe (flexibility widens selectivity +
  diversity, not a duration knapsack).
- **#12 long-end fan width** - a tuning number.

**Design calls:**
- **#4 desktop / e-ink mode** - what should desktop even look like; is a literal
  e-ink device mode wanted.
- **#33 content rules**, **#39 splittable sources**, **#19 adjust prompts** -
  each a "how should curation work" choice. **#34** (store RSS categories) is
  cheap enabling infra for #33, held until #33 is greenlit.
- **#13 more source types** (Reddit/Mastodon/Bluesky) - scope/priority.

**The big bets (whole milestones, pick a direction):**
- **Discovery & trials (#20-23)** - how new sources get found, trialed, and
  recommended.
- **Intelligence & agent (#24-26)** - user stats surface, an agent/JSON API, and
  the LLM "talk to your feed" operator.

Plan: **stopped auto-shipping** - the queue of scoped work is empty. Resume when
Fisher steers one of the above.

### Reconciled without building (v0.6.x)
- **#37 (confirm + undo) closed** - already delivered by the List+Expand
  management surface (archive/delete confirms + undo toast were live since
  v0.1.0). Checked before dispatching, avoided rebuilding it.
- **#35/#16 scoped down** - feed/state filters + inline stats already exist;
  batch 6 only adds the *signal* filter (noisy/dormant/most-skipped) and
  sort/group. Frontend only.

### Deferred - needs Fisher's direction (won't guess)
- **#11 (smarter session fill)** - its duration-knapsack framing conflicts with
  the settled "paced stream, not duration-batch" model (decisions.md), and
  YouTube has no durations. Reframe I proposed on the issue: flexibility widens
  *selectivity + diversity*, not a duration fit. Awaiting confirmation.
- **#6 (dwell logging)** + **#5 (behavioral pace)** - reverse the explicit-
  signals-only principle. Fisher's call.
- **#12 (long-end fan width)** - tuning better decided against real usage.

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
- **Batch 6 (in flight) - library sort + signal filters:** #16 sort/group, #35
  signal filter (noisy/dormant/most-skipped). Reduced scope - feed/state filters
  + undo already exist. Frontend only.

### Remaining, after batch 6

**Safe to auto-ship (clear, no model/direction conflict) - will continue:**
- #10 single-card swipe-to-advance gesture (session UX)
- #34 store RSS item categories (enabling; unlocks #33 content rules)
- #36 relative-to-average insight (Nx the average source)
- #3 pad accessibility fallback, #4 desktop/e-ink mode (design system)

**Needs Fisher's direction before building (product bets - won't guess):**
- #11 session fill reframe · #6/#5 dwell · #12 fan width (above)
- #33 intra-source content rules, #39 splittable sources, #19 adjust prompts -
  each a real design choice about how curation should work
- **Whole milestones:** Discovery & trials (#20-23 - how new sources get found
  and trialed) and Intelligence & agent (#24 stats surface, #25 agent API, #26
  the LLM "talk to your feed" operator). These are the big bets - direction
  first.
- #13 more source types (Reddit/Mastodon/Bluesky) - scope/priority call
- #9 catch-up-on-a-creator, #38 raw-feed drill-in - partially delivered by the
  ··· menu; remaining scope worth a look before more build
- **Later / bigger bets:** Discovery milestone (#20-23, finding *new* sources),
  Intelligence (#24 stats, #25 agent API, #26 LLM operator).

### Gated on the dwell decision (#6)
Both **#5 (behavioral per-feed pace)** and **#6** depend on measuring per-item
dwell, which the "explicit signals only" principle forbids. Neither can proceed
until Fisher decides whether to relax that principle. Everything else in the
ranker batch (#7/#17/#11) is independent of it, so the ranker work isn't blocked
overall - only the behavioral-pace half is.
