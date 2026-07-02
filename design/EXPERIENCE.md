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
3. **Explicit signals only.** Like / skip / open / weight are deliberate taps. No
   dwell-time tracking, no scroll-velocity inference, nothing implicit.
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
  Intent  ──build──▶  Session  ──▶  act on items (open / like / skip)
    ▲                    │
    │                    ├── "More like this" → appends the next fresh batch
    └────── Done ────────┘         (never an infinite auto-load)
```

Notice what's absent: there's no "for you" landing feed, no home timeline that
loads on launch. Launch lands on **Intent** - a question, not content. You must
express an intent to get anything, and what you get is bounded.

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

Purpose: present a finite, ordered, explainable set; let the user act with
minimum friction.

- A quiet header: `4 items - ~58 min` (+ themes). This is the *whole* session -
  a knowable quantity, not a scroll into the void.
- A vertical stack of **item cards** (spec below), in ranked order.
- A **calm footer**, always reachable by scrolling to the end:
  - "That's your session." (affirming closure, not "keep going")
  - **More like this** - appends the next fresh batch *below* (items already
    shown are marked seen server-side, so more = genuinely new). This is
    opt-in load-more, never auto-infinite.
  - **Done** - back to Intent, no guilt.
- When the well is dry: "That's everything new" - a *good* outcome, framed as
  being caught up.

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
- **Vertical** = session length. Down = quick (≈5 min), up = long (≈60 min).
- **Horizontal** = variety/spread. Left = focused (tight range, fewer sources),
  right = varied (wide range, more sources).

**Feedback (this is what makes it teach itself):**
- Four corner labels name the moods: `quick·focused`, `quick·varied`,
  `long·focused`, `long·varied`. The corner **nearest the knob brightens**.
- A plain-language **descriptor** updates live ("A quick, focused skim" → "A
  long, wide-ranging session"), so the abstract 2-axis space is always narrated
  in words.
- The **readout** (minutes + item estimate) updates continuously.
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

- Land on an infinite/auto-loading feed.
- Show unread counts, badges, or red notification dots.
- Auto-play or auto-advance content.
- Use streaks, daily goals, or FOMO nudges.
- Track or act on implicit signals (dwell, scroll speed).
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
