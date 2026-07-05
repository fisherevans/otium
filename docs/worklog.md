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

## 2026-07-03 (later) · Live-use feedback round + audits

Fisher used the app and reported real friction. Filed #50-#58, shipped the fixes.

### Shipped
- **v0.9.0** - #50 card fits the viewport (clamp title/excerpt, cap media), #51
  tap opens content **in-app** (reader / inline YouTube player / audio), external
  demoted to "Original"; #54 back-to-session on the library; #55 filter/sort
  collapsed behind a sheet so controls fit. **Verified via Palma-2-res
  screenshots** before deploy.

### Process lesson (my mistake, corrected)
Ran the #50/#51 and #54/#55 agents **in parallel in the same checkout** - they
collided on the shared working tree / git HEAD (the exact hazard in the mainline
memory note). Recovered by rebuilding clean branches (cherry-pick code commits,
re-derive the one polluted CSS block) and verifying the build. **Rule going
forward: parallel otium agents get isolated git worktrees, never a shared
checkout.**

### Screenshot harness (new capability)
Established a Palma-2 (824x1648 @ 2x, 412px CSS) Playwright screenshot loop:
copy prod db -> local dev server (OTIUM_DEV_USER) + vite -> `playwright` (no-save)
drives the routes -> review PNGs. This is now the pre-deploy visual check for any
frontend change. (`/tmp/shots.js`, local `npm i --no-save playwright`.)

### Audits (Fisher asked)
- **RSS full-text audit** (18 feeds): 7 already ship full text in content:encoded,
  2 partial, 2 summary-only, 6 comics, 1 blocked (Politico). Root cause of "content
  doesn't render right" found: ingest.go:103 stores a 500-char plain-text clip of
  the *teaser* (`Description`) over the full `content:encoded`. -> **#58** (render
  full body) is the cheap high-ROI fix; **#52** reframed to just the ~3 partial
  feeds.
- **Competitive UX audit** (docs/ux-audit.html): the two real P0 gaps (#58/#52
  full-text, #57 saved view) just *complete promises the UI already makes*.
  Net-new bets filed #59-63 (offline cache, e-ink mode + volume advance, reader
  typography, session TTS, scoped search). Refuse-list recorded in decisions.md.

### Reprioritized queue (audit-informed)
1. **#58** render content:encoded (fixes 7 feeds + formatting) - highest ROI.
2. **#57** collections / saved view - needs a small model nod from Fisher first.
3. **#53** Videos feed for the untagged YouTube sources.
4. **#56** share/copy · **#52** extract the 3 partial feeds · then the e-ink/Palma
   bets (#59/#60/#61/#62).

## 2026-07-03 (later still) · Density review + content/library round

### Shipped
- **v0.10.0** - library simplification: #64 five action buttons collapsed into a
  Manage sheet, #65 rows drill into the clean SourceDetail sheet (added feeds/
  delete so nothing lost). Verified at Palma res: list starts high, 6 sources
  visible vs 2-3.
- **v0.11.0** - #58 full content:encoded body rendered in the reader (backfills
  existing items on re-fetch, isNew intact + test-locked), #53 Videos feed for
  untagged YouTube sources. Verified end-to-end: a full multi-paragraph article
  renders in the reader at Palma res (the central "content doesn't render right"
  complaint, fixed).

### Density review (Fisher asked: review every state, break apart dense pages)
Swept all workflow states at Palma-2 res. Only the **library** was overloaded
(fixed above). Everything else - session card, source-detail sheet, mix, import,
home pad - reads as one-thing-per-screen. Recorded; the mix view in particular is
a model of calm density.

### Parallelism, done right this time
Ran the content-feed and library-simplify agents concurrently in **isolated git
worktrees** (`../otium-content`, `../otium-library`) - no shared-checkout
collision. Both merged clean (near-disjoint files). This is the pattern for
parallel otium agents going forward.

### Screenshot harness is now load-bearing
Every frontend deploy this round was screenshot-verified at Palma res before
ship. It caught a real error panel (turned out to be a wrong-slug test artifact,
not a product bug - the mood chips pass lowercase feed slugs correctly) and
confirmed the content-render + library rework visually. Worth the loop.

### New net-new issues from the UX audit still open
#56 share, #57 collections (needs model nod), #59 offline cache, #60 e-ink mode +
volume advance, #61 reader typography, #62 session TTS, #63 scoped search, #52
extract-3-feeds. Plus #4 desktop, #33/#39/#19 curation design calls, Discovery
(#20-23), and the dwell gate (#6/#5).

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

## 2026-07-04 · Philosophy refine + core-loop reshaping

### Philosophy (Fisher, recorded in decisions.md)
otium is **not anti-data** - it's intentionality + transparency + privacy. Dwell
IS measured, but only to power a check-in ("scrolling fast - keep going or do
something else?") that never re-ranks the feed; toggleable. Refusal = engagement
*optimization*, not measurement. Unblocked #6/#5.

### Shipped
- **v0.12.0** collections (#57) - named lists + Saved/Watch Later/Liked, Save
  picker, Collections view. (Interview: named collections, Watch Later browse-only,
  Like stays separate.)
- **v0.13.0** feed/source management as **dedicated pages** (#66) - /sources/:id
  (settings + posts) + /feeds/:slug (its sources + settings + posts). Reverses the
  #65 modal; subsumes #38. Verified at Palma res.
- **v0.14.0** intent **one-pager** (#69, single duration slider + topics + "Start
  reading", no scroll) + **durable backend sessions** (#67, cursor/resume/
  expire-to-home). Verified at Palma res + session flow.

### Caught a prod-down bug before shipping
The session migration created an index on `sessions(status)` in schema.sql, which
runs BEFORE migrate() adds the column - fatal on the pre-existing sessions table
(prod has one). Would've crashed boot. Moved the index into migrate() after the
column; verified boot against a prod DB copy, then confirmed clean on prod.

### DB-copy gotcha (screenshot harness)
`cat`-ing a live prod SQLite mid-WAL-write yields a malformed copy. Copy
`otium.db` + `otium.db-wal` + `otium.db-shm` together so SQLite replays the WAL.

### Shore-up round COMPLETE (v0.15.0)
- **v0.15.0** - dwell engagement check-in + Settings page toggle (#68), on the
  refined intentionality policy (measure to serve intention, never re-rank;
  toggleable). Fixed a latent test-red (guarded the sessions status-index in
  migrate against a partial DB).
All four shore-ups (#69 intent one-pager, #67 durable sessions, #66 feed-mgmt
pages, #68 dwell) + collections (#57) shipped. **The "next big bet" (reader-depth
for Palma / session TTS / Discovery / LLM operator) is Fisher's to pick.**

## 2026-07-04 (evening) · Live-use polish rounds (v0.16 - v0.18)

Fisher used the app across several rounds; shipped his feedback in three deploys.
- **v0.16.0** - intent preset chips (5/15/30/1hr) -> slider with +/-5 (#70); flat
  lucide icons everywhere + bookmark Save, no emojis (#71); feed-icon set 29->115
  incl. locality cluster (#72); date above the hero, prominent + refined format
  (#73); reader swipe-close + footer cleanup (#74); clickable source -> context
  menu (#75). All Palma-verified.
- **v0.17.0** - per-source half-life + multi-feed resolution rule (source > feed >
  global) as a Settings > Preferences toggle (#76). decisions.md entry added.
- **v0.18.0** - reader header actions (Save/Open/···/X) + Copy link + Share (#77,
  delivers #56); interactive drag-to-close + Android-back closes the reader not
  the SPA (#78, back-behavior verified); session-over end-card instead of a
  mid-read redirect (#79).

Notes: caught + fixed a session-migration index-ordering bug (would've crashed
boot on the pre-existing sessions table) and a resulting red store test.
Screenshot harness + isolated worktrees are the standing pattern; the two things
not headlessly verifiable (drag feel, session-end timing) are flagged for
on-device testing. All of Fisher's feedback through this round is shipped; the
"next big bet" (reader-depth / TTS / Discovery / LLM operator) remains his to pick.

## 2026-07-04 (night) · Reader-depth start + history (v0.19 - v0.20)

Fisher greenlit "reader-depth" (appearance/typography), focused on user styling
with live preview; also asked for a personal history.
- **v0.19.0** - personal **History** view (#83): /history from the Library,
  Shown/Read/Liked/Saved filters over item_state, tappable to reopen. Read-only.
- **v0.20.0** - **appearance/preferences system + live-preview editor** (#80/#81/
  #82, delivers #61). Per-user prefs (kv JSON, /preferences, display-only/
  off-ranker) applied as CSS custom properties so the live app AND a sticky
  preview react instantly. Appearance screen (/settings/appearance): a
  pixel-identical sample card+reader (shared CardParts) on top, controls below.
  Reader: text size/spacing/measure/images. Card: sub-text/feed-tag/date sizes,
  hero show-hide, hero grayscale-vs-color. Intent presets: user-editable chips.
  Both Palma-verified.

Two parallel worktree agents (appearance + history) merged with only trivial
additive conflicts (App.tsx imports, global.css EOF blocks). CSS-var architecture
is the reusable foundation for future theming.

### Reader-depth remaining (Fisher's direction)
#60 explicit e-ink mode + volume-key page-turns, #59 offline caching. The
typography half (#61) is done; these two are the device-native half.

## 2026-07-05 · Nav redesign + data-model change (v0.21 - v0.22)

- **v0.21.0** - Model-A nav shell (#84): 4-tab bottom nav Read/Library/Saved/You;
  Saved (Collections/History segments) + You (Settings/Appearance/Insights/Import)
  homes; Library header decluttered, no overflow. Session stays tabless.
- **v0.22.0** - data model (#86): source → exactly one feed (feed_id, populated
  from feed_sources which is left intact for rollback); groups + group_feeds
  (feed↔many groups); single-feed picker + Groups management; multi-feed
  half-life rule (#76) deleted → source>feed>global. **Migration verified against
  a copy of prod** (all 160 sources populated, zero mismatch); pre-migration prod
  backup at ~/dev/otium-db-backups/otium-premodel-2026-07-05.db.

### Design deliverables (docs/, served on WiFi :8099)
- nav-redesign.html (Model A/B wireframes - Model A chosen, executing).
- visual-simplify.html (noise inventory + before/after mockups - awaiting Fisher's
  read on the bolder cuts).

### Open / pending
- Nav redesign **ch.2** (#85): reader/player + management sheets → pushed pages.
- **Visual simplification**: borders/boxes → typography; pull mgmt detail off the
  card. Overlaps ch.2's surfaces → plan to do them as ONE combined reader/card/
  sheets pass once Fisher confirms the visual cuts.
- Pre-existing: empty-DB `.map(null)` crash (guard with `?? []`) - fold into the pass.
