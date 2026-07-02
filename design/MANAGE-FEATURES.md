# otium - managing feeds & sources (feature exploration)

The "what" for the management surface, before the "how". This is the library
side of otium - not consuming a session, but shaping what *goes into* one:
adjusting weights, organizing sources into themes, adding/removing, and
understanding what you follow. Read this, then the UX variations in
`design/prototypes/manage/` explore different ways to deliver it.

The guiding idea from the interview: you rarely want to *unfollow* someone - you
want to **turn them down**. Management is mostly about frequency and emphasis,
not binary follow/unfollow. And it should surface *why* ("this source is 60% of
your comedy") so tuning is informed, not guesswork.

## The feature palette

Grouped by intent. Tiers: **[core]** = the management MVP, **[next]** = clearly
wanted soon, **[later]** = real but not first.

### Understand what you follow
- **[core]** See every source with its live signal: weight, unseen count, how
  noisy it is (posts/day), and how often you skip it (% skipped).
- **[core]** Sort the library - by weight, alphabetical, by feed, by noise, by
  most-skipped.
- **[next]** Group by feed/theme.
- **[next]** Feed health per theme: source count, noisiest sources, dormant
  sources (stopped posting), average % skipped.
- **[next]** Flag the outliers: "BBC is 40% of your News and you skip 40% of it."
- **[later]** Search / filter the library (matters once it's big).

### Adjust emphasis (the core knobs)
- **[core]** Weight: very low -> low -> normal -> high -> favorite. The primary
  control. Turn a source down without unfollowing.
- **[core]** Per-source cap: max items from this source in one session (stops a
  30-a-day source from flooding).
- **[next]** Quick nudge: "more / less of this" as a one-tap or gesture, in the
  library *and* in-session (long-press an item).
- **[later]** Mute/pause temporarily (reduce to ~zero for a while, auto-restore).

### Organize into themes
- **[core]** Put a source in one or more feeds/themes (the assignment UI that's
  missing today - feeds exist but nothing lets you populate them).
- **[next]** Create / rename / delete a feed; give it a name (and maybe an
  e-ink-appropriate mark, not color).
- **[next]** Reorder feeds.
- **[later]** Feeds as saved *rules* (auto-include sources matching a query),
  not just manual groupings.

### Add / remove / modify
- **[core]** Add a source (paste a URL; import; the flows already exist).
- **[core]** Remove or **archive** a source (archive = keep the history/weight,
  stop surfacing - reversible; delete = gone).
- **[core]** Edit a source: title, kind.
- **[next]** Trial state: add-as-trial, and a review prompt once you've seen
  enough ("you've seen 40 from X - keep / turn down / drop"). Schema already has
  suggested/trial/followed/archived.

### Behavioral tuning (the otium-specific part)
- **[next]** Occasional, informed prompts rather than manual fiddling: "X
  accounts for 60% of your comedy surfacing - lower it?" Driven by the stats we
  already log.
- **[later]** Conversational tuning ("make my comedy less noisy") - the LLM
  operator; separate milestone, but the management data model should be ready
  for it.

## Cross-cutting principles
- **Turn down, don't cut off.** Weight and cap are the default gestures;
  archive/delete are deliberate, secondary.
- **Always show the why.** Any weight suggestion or "noisy" flag cites the number
  behind it. No black-box nudging (matches the consumption side).
- **In-context beats settings.** The best place to reweight a source is often
  while looking at its item in a session (long-press), not in a settings screen.
  The library is for the deliberate pass; the session for the in-the-moment nudge.
- **e-ink constraints.** No color to lean on - weight/noise/health must read
  through type weight, ink density, rules, marks, and position, not hue.

## Open questions for you
1. **How much weight granularity?** The 5 buckets (very low -> favorite), or a
   finer slider? Buckets are legible and e-ink-friendly; a slider is precise but
   fussy on a phone.
2. **Archive vs delete** - do you want a distinct "archive" (mute + keep) as a
   first-class thing, or is "very low weight" enough and delete is delete?
3. **Feeds: manual only, or eventually rules?** Manual grouping first is simple;
   rule-based feeds are powerful but a bigger build.
4. **Where does reweighting mostly happen** - a dedicated library screen, or
   mostly in-session (long-press the item)? Changes what we invest in.
5. **Per-source cap** - worth exposing in the UI now, or keep it an internal
   default and only expose weight?
