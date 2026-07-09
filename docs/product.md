# otium - product

Distilled from the design interview. This is the *why* and the *what*; the code
is the *how*.

## The problem

Algorithmic feeds (TikTok especially) do three jobs at once: subscription
management, discovery, and editorial weighting. RSS only solves the first. Move
to RSS and you keep your news but lose the fun - discovering comedians,
musicians, live performances - and you lose control over pacing: a chronological
reader drowns the once-a-week creator under the 30-a-day one.

The real problem isn't information. It's **attention allocation**. Modern media
optimizes for engagement. otium optimizes for spending attention on purpose.

Every design decision answers one question: *does this help the user spend their
attention intentionally?*

## Principles (non-negotiable)

1. **Sessions, not feeds.** The app is session-oriented. Never infinite, never
   pull-to-refresh. You state an intent; you get a finite, composed set.
2. **Explicit signals only.** No dwell time, no scroll velocity, no opaque
   loops. Like / more / less / open / skip / trial mean exactly what they say.
3. **Deterministic consumption.** If an item appears, the system can explain
   exactly why. `score = weight × freshness × rarity`, shown to the user.
4. **Discovery is isolated.** A separate, intentional workflow - never mixed
   into normal consumption.
5. **Backlogs don't exist.** Never "1,247 unread." Only "here's what deserves
   your attention right now."
6. **Your data serves you.** Capture a lot - session length, what you open,
   skip, come back to - and expose it to *you* (and to an LLM operator you
   control), never to an ad model.

## The central object is a session request

otium does not continuously rank a standing inbox waiting for you to open it. It
assembles a fresh, explainable session **on demand** from the intent:

> topics + history + attention budget → what should I consume now?

The backlog of fetched items is just raw material.

## The intent gesture

Open the app → "How much time?" A two-axis pad: drag **up** for a longer
session, **right** for more variety. "Five minutes before a timer" is a small
flick up; "half an hour on the couch" is up and to the right. You get a **range**
(e.g. 15-30 min), not a rigid commitment - at the low end the app asks if you
want more; near the top it winds down. Pick themes (or nothing = everything you
follow), and build.

## Weighting and rate-limiting

The two knobs that make it yours:

- **Weight** per source: human words (very low → favorite), mapped to
  multipliers (0.25 → 5). Adjustable in the moment (long-press "more/less of
  this," Reddit-style) - not buried in settings.
- **Per-source cap + rarity boost**: a noisy source is capped per session; a
  rare source gets boosted so its infrequent post is never missed. This is the
  feature no existing reader has.

## Discovery (later milestone)

Discovery is a review queue, not a feed, and it's contextual ("for your comedy
topic, you might like…"). Adding a creator is a **trial**, not a commitment: you
evaluate them in-feed, and once you've seen enough (a threshold, surfaced during
normal use - "you've seen 40 posts from X, keep them?") you decide to keep
(with a weight), reduce, or drop.

Discovery leans on public/legit data (RSS, YouTube, platforms with open feeds)
and your *own* explicit likes for "because you liked X" - never a scraped black
box.

## Stats and the agent surface

Capture generously, expose usefully: time per theme, most opened/liked/skipped,
sources you've stopped returning to, topic "health" (how noisy, how much you skip).
Surface it both as human insight and as a JSON/API for an LLM **operator** - not
part of the core ranking, but a tool you converse with to retune weights, audit an
topic, or drive discovery ("find more women stand-up comedians"). You stay in
control; the LLM proposes, you approve.

## What this is not

Not "anti-algorithm" - that lane (Tapestry, Reeder) means *no ranking*. otium
*is* an algorithm: one you own, audit, and rate-limit. The positioning is
control and transparency, not the absence of ranking. Market scan found no
shipping product that does the time-boxed-session-from-weighted-topics mechanic;
that's the wedge.
