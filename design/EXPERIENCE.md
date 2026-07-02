# otium - experience guidelines

The durable layer beneath any visual theme. A chosen design language (see
`prototypes/`) supplies the *skin* - palette, type, texture, ornament. This
document is the *skeleton* - how the app is shaped, how it flows, how it feels to
touch. The skin changes; this shouldn't drift.

## North star

> Make spending attention *on purpose* feel good.

otium is the anti-doomscroll. It never optimizes for time-in-app. Every design
decision is judged against one question: does this help the user allocate their
attention intentionally? If a pattern would increase engagement at the cost of
intent, it's wrong here by definition.

### The five commitments

1. **Sessions, not feeds.** The unit is a finite, time-boxed session you asked
   for - never an infinite timeline, never pull-to-refresh-for-more.
2. **Explainable, always.** If something is on screen, the app can say why in one
   human phrase. The "reason" is a first-class UI element, not a debug detail.
3. **Explicit signals drive curation.** Like / skip / open / weight are
   deliberate taps, and only these shape ranking. The one allowed *implicit*
   read is pace: if you're clearly flicking past items, otium may surface a
   **visible check-in** ("want a different mix?"). The boundary is strict - pace
   can trigger a question that serves your intent, but it never silently
   re-ranks or feeds you more. No dwell-time-for-engagement, no behavioral
   surveillance.
4. **Calm, not urgent.** No badges, no unread counts, no red dots, no streaks, no
   "you're missing out." End-states are restful, not nagging.
5. **The user is the editor.** Weight, caps, trials, and (later) the LLM operator
   put the user in the chair. otium ranks transparently; it never decides *for*
   you behind glass.

## Information architecture

Three primary surfaces, reachable from a fixed bottom nav (thumb-zone):

- **Intent** (home) - state what you want right now. The front door.
- **Library** - the sources you follow, their weights, and import.
- *(Session is not a nav tab)* - it's the result of an Intent, a transient
  destination you enter and leave.

Secondary surfaces (not in the primary nav):
- **Import** - onboarding bulk-add (reached from Library).
- **Session** - the built result (reached by building from Intent).
- *(Later)* **Discovery** - a separate, intentional review queue. **Never**
  interleaved into a session. **Insights** - your own usage stats.

The IA rule: consumption (Session) and curation (Library/Import) and discovery
are kept in separate rooms. You never trip over "here are 3 creators you might
like" while consuming - that's discovery's job, on its own terms.

## The core loop

```
  Intent  ──build──▶  Session (a time-boxed, paced stream)
    ▲                    │
    │                    ├── items served one at a time, you open / like / skip
    │                    ├── refills as you go — but only until your time budget
    │                    ├── low-end: "keep going or wrap up?"  high-end: winds down
    │                    ├── flicking past fast: "want a different mix?"
    └────── Done ────────┘
```

Notice what's absent: there's no "for you" landing feed, no home timeline that
loads on launch. Launch lands on **Intent** - a question, not content. You must
express an intent to get anything, and what you get is bounded - not by a fixed
item count, but by *your clock*.

## Screen specs

### Intent (home)

Purpose: capture "how much time + what mood" in one gesture, then build.

Hierarchy, top to bottom:
1. Wordmark + tagline (quiet, identity).
2. Prompt: **"How much time?"**
3. **The intent pad** (the signature control - full spec below).
4. Live readout: duration range + honest item estimate (`18-26 min - ~5 items`),
   the estimate capped by real unseen supply.
5. Theme chips (multi-select; "nothing selected = everything you follow").
6. Primary action: **Build my session** (disabled if the selection has nothing
   unseen - it says so rather than lying).

One primary action per screen. The pad is the hero; everything else supports it.

### Session

Purpose: a **time-boxed, paced stream** of ranked, explainable items - consumed
one at a time until *your elapsed time* hits the budget. Not a fixed batch: you
skim or skip most items, so a set sized to "20 minutes of reading" is wrong. The
budget is *your* wall-clock, and the server just supplies a good ranked queue.

- A quiet **time bar + label** (`~8 min of 5-25 min`) instead of an item count.
  It measures *elapsed active time* (paused while the phone is locked), so it
  reflects attention actually spent.
- A ranked **queue of item cards** (spec below), served in order and **refilled
  as you approach the end** - so it feels like a continuous one-at-a-time flow,
  not a batch that runs out. Refill happens *only while inside the time budget*.
- **Seen-on-view:** an item is marked seen (and won't recur) only when it
  actually scrolls into view - not when it's staged. Staging a queue never burns
  items you didn't reach.
- **Pacing check-ins** (a visible banner, dismissible):
  - *Low end of the range:* "You've spent ~X min - keep going or wrap up?"
  - *High end:* winds down - "that's about your time. Done, or a few more?"
  - *Fast-flicking:* several quick skips in a row → "want a different mix?"
    (the one allowed implicit signal - see principle 3).
- **Done** is always reachable, no guilt. When the well is dry: "That's
  everything new" - a *good* outcome, being caught up.

**Presentation: one item at a time.** The session shows a *single* focused card,
not a scrollable list - you can't blur past a dozen items. You Open it, or Skip
(a real negative signal, because you actually looked at this one thing), or
advance to Next. This is what makes the behavioral signal trustworthy: in a
scroll list a "skip" is ambiguous; one-at-a-time, it means you rejected *that*
item.

### Prediction & behavioral signals

The time budget and the user's behavior feed back into ranking - transparently,
never as engagement optimization.

- **Predicted items seen.** From the budget and the mix's empirical *time per
  item*, otium estimates how many items the user will actually get through, and
  **sharpens selectivity when that number is small** (a short session's few
  slots go to the best items; a long session flattens to admit more variety).
  `score = (weight·rarity)^selectivity · freshness · skipPenalty`.
- **Time per item** starts from content duration over a feed's recent ~100 items
  (`SourceAvgDuration`), blended with a skim factor (content length overstates
  time - you skim). Caveat: RSS gives duration for podcasts, rarely for YouTube,
  never for articles. The **truer** source is behavioral - now that we show one
  item at a time we can measure real per-feed dwell (item shown → advanced).
  That measured pace should supersede content duration; it's the next step the
  single-item view unlocks.
- **Skip rate.** A source the user consistently skips is downweighted
  (`skipPenalty`, once there's a real sample). Explicit skips only, and only
  because single-item presentation makes each skip meaningful.

These are deliberate, legible adjustments to a transparent formula - not a black
box. The user can always be told why an item ranked where it did.

### Library

Purpose: see and tune what you follow.

- Prominent **Import your follows** (the big onboarding win).
- **Source rows**: name, sub-line (kind + unseen count), and a **weight pill**
  (very low → favorite) that's tappable to cycle. Weight is the primary knob and
  must be one tap from here.
- Add-one and Refresh as secondary actions.
- *(Later)* group by feed/theme; per-source feed assignment; trial-state review.

## The signature interaction: the intent pad

This is otium's most distinctive control and deserves to be gorgeous in every
theme. It replaces a boring "duration dropdown + settings" with a single
expressive gesture.

**Model:** an analog stick. It **rests at center** (the middle-ground of both
axes). You **drag the knob out** from center; a **tether line** connects the
center origin to the knob so displacement is legible. Release holds the value
(it does not spring back - you're setting an intent, not firing a control).

**Axes:**
- **Horizontal** = session length. Left ≈ 5 min, right ≈ 60 min. This is the
  primary choice: how long do you want to be here.
- **Vertical** = flexibility of that length. Bottom = an *exact* target ("just 5
  minutes"); dragging up *fans the range out* around the center (e.g. center 15
  min at full flex → ~5-25 min). At the short end there's little room to fan, so
  short sessions are inherently near-exact.

We do **not** show a predicted item count. Content length varies too much (a
30s skit vs a 40-min longform) to gauge items honestly, and the choice the user
is actually making is *time*, not quantity. The readout is a **minute range**.

**Why flexibility is a real knob (it changes the builder's job):** an exact
target is a hard constraint - to land near a precise duration the builder may be
forced to include a weaker short item just to fill the gap, trading content
quality for precision. A wide range is slack - the builder takes the
best-scoring items that fit anywhere in the window and stops when it's in range,
optimizing rank instead of hitting a number. So flexibility trades
duration-precision for content-quality. (v1 does greedy-by-score within the
window; treating it as "maximize value subject to fitting the window" - a small
knapsack - is a clean later refinement.)

**Feedback (this is what makes it teach itself):**
- Edge labels name the axes: `5 min`↔`1 hr` (left/right) and `exact`/`flexible`
  (bottom/top). The label the knob is nearest **brightens** on each axis.
- A plain-language **descriptor** updates live ("Exactly 5 minutes" → "About 15
  minutes, give or take" → "Anywhere from 5 to 25 minutes"), narrating the
  gesture in words.
- The **readout** is the minute range (a single number when exact), updating
  continuously.
- **Tap the descriptor (or center) to recenter.**

**Touch requirements:**
- Handlers live on the pad element with pointer capture, so a drag survives the
  finger sliding off the pad edge (mobile Safari drops window-listener drags).
- `touch-action: none` on the pad so the page doesn't scroll mid-drag.
- Knob ≥ 44px, with an active/pressed state (scale + shadow) so it feels
  physically grabbed.

**Accessibility fallback:** the pad must have a non-gesture path (tap a corner to
jump to that mood, or a hidden pair of sliders) so it's not drag-only. A theme
may style this differently but must provide it.

## Touch & gesture principles

- **Thumb-first.** Primary actions and nav sit in the lower two-thirds
  (reachable one-handed). Destructive/rare actions sit higher.
- **≥44px targets**, ≥8px between them. Never rely on precise taps.
- **Every tappable thing has a visible pressed state.** On touch there's no
  hover; the press *is* the affordance. Buttons inset/darken, cards depress
  slightly, pills fill.
- **No hover-dependent information.** Anything a desktop would reveal on hover
  (the "why", a tooltip) is either always visible or revealed by tap.
- **One primary action per screen**, visually dominant. Secondary actions are
  quieter (ghost/outline), tertiary are text.
- **Gestures are additive, never required.** The pad drag is the delight; a
  tap-based fallback always exists. No hidden swipe you must discover.
- **Momentum where it's honest.** Scrolling is native/inertial. But we do *not*
  add dopamine-bounce or celebratory confetti - motion is calm and functional.

## Motion & feedback

Motion should read as *considered*, not *excited*.

- Transitions 120-220ms, ease-out. Enough to feel physical, not enough to make
  you wait.
- The pad knob tracks the finger 1:1 (no lag); the tether and corner-highlight
  ease.
- Screen changes are quiet cross-fades or slides, not flashy.
- Liking an item gives a small, satisfying but *contained* confirmation (fill +
  subtle scale) - acknowledgment, not a slot-machine payout.
- **Never** use motion to pull attention back (no pulsing "new!", no jitter).

## Component inventory

The chosen theme restyles these, but the set is fixed:

- **Intent pad** + knob + tether + corner labels + descriptor + readout.
- **Theme chip** (toggle; on/off states).
- **Item card**: reason pill, title, source·duration·media-type meta line,
  optional summary, action row (Open / Like / Skip).
- **Reason pill**: the one-phrase "why this is here."
- **Weight pill**: 5 states (very low → favorite), tappable to cycle.
- **Buttons**: primary (filled), secondary (ghost/outline), text.
- **Source row**: name, sub-line, trailing control.
- **Bottom nav**: 2 items now (intent / library), fixed, thumb-zone.
- **Calm footer**: closure + More + Done.
- **Empty/caught-up state**: affirming, never nagging.

## Voice & content

- Plain, warm, unhurried. "How much time?" not "Start browsing."
- The "reason" phrases are honest and specific: "Rare - posts seldom," "Fresh -
  posted today," "Favorite source."
- End-states affirm rest: "That's your session." / "You're caught up."
- No growth-hack copy: no "Don't miss…", no "N people…", no streak language.
- Numbers serve *self-knowledge*, not pressure: "~58 min" tells you the size of
  the commitment; it is never a score to beat.

## Anti-patterns (otium must never)

- Land on an infinite/auto-loading feed. (A *session* refills, but only within
  your chosen time budget, then winds down - that's bounded, not infinite.)
- Show unread counts, badges, or red notification dots.
- Auto-play or auto-advance content.
- Use streaks, daily goals, or FOMO nudges.
- Use implicit signals to rank or feed you more. (Pace may trigger a *visible
  check-in* that offers to stop or pivot - never a silent re-rank.)
- Interleave discovery/recommendations into a consumption session.
- Hide the "why" behind an unexplained algorithm.
- Nag on exit. Leaving satisfied is a success, not churn.

## What a theme must define (the token contract)

Any visual direction, to drop into the real app, supplies:

- **Color**: `bg`, `surface`/`card`, `ink` (+ soft/faint), `accent` (+ soft),
  `border/line`, semantic `good`/`warn`. Must pass contrast on a phone in
  daylight and at night (dark themes: watch AMOLED smearing on scroll).
- **Type**: a display face + a body/UI face (iOS-available, no network fonts) and
  a scale (wordmark, h1, card title, body, label, meta).
- **Shape**: corner radius, card treatment, rule/hairline weight.
- **Motion**: the durations/easings above, themed but within the calm envelope.
- **The pad**: its themed rendering (surface, grid/rings, knob, tether) while
  keeping the interaction spec intact.
- **Texture/ornament** (optional): grain, rules, engraving - as the language
  calls for, never as noise.
