# Mixed feeds: format shares, section weights, several saved mixes

**Date:** 2026-11-03
**Type:** feature
**Author:** claude-code

## What changed

A session can be built from a **mix** (#201): a share of session time for each format -
Articles, Posts, Shorts, Long videos - and a weight for each section (Off, Less, Even,
More). Mixes are saved presets like any other, so there can be several (Morning,
Evening, Weekend), and saved mixes appear on New session as direct starts. A mix spans
every section; the section weights do the scoping.

## Why

Fisher wanted "all the things in one feed" (his r/all idea) without it turning into
whatever the highest-volume format happens to be, and with different proportions at
different times of day. The existing content toggles only include or exclude a format;
they cannot say "mostly articles, a few Shorts".

## How it works

The mix adds one level above source allocation (`session/mix.go`). For each slot it
rolls a source in every format by representation x section weight, then gives the slot
to the format whose rolled item, counted at its midpoint, leaves it furthest below its
share of the time queued so far: minimize `(used[f] + cost/2) / share[f]`. The winning
roll is taken and the others are discarded.

- **Shares are time, not slots.** A 20-minute video charges 20 minutes to the video
  share; a Short its length (60s default); an article a 40s card read (the same skim
  estimate session sizing uses); a post 20s; audio its duration. Counting the next item
  at its midpoint keeps every prefix of the queue within about half an item of the
  target, which matters because a session is consumed from the head.
- **A video longer than its share of the whole session lands past the end.** Because
  every slot re-rolls, a shorter video from another source can take the slot instead;
  this mildly favours shorter long videos inside a short mix session.
- **Empty formats drop out** and the remaining shares renormalize. A mix whose only
  shared format has nothing eligible returns no session.
- **Posts are derived from the source kind** (`bluesky`), not a new `media_type`. Posts
  keep `media_type = 'article'`, so every existing content filter, the Articles toggle
  and stored items are unchanged, and no data migration was needed.
- The queue covers twice the time budget, capped at 80 items. The server logs the
  composition of the budget's head as `mix session built`.

The default (no mix) path is unchanged: `Allocate` now draws from the same
`sourcePool` type, and a golden test pins its output for a fixed pool and seed.

## Measured

On a copy of the local database (Bluesky sources added), 10 builds each, share of
expected time within the session's own budget:

| Mix | Target | Measured |
| --- | --- | --- |
| Everything, 30 min | articles 40, posts 10, Shorts 20, long 30 | 38, 9, 18, 34 |
| Morning, 20 min | articles 70, posts 20, Shorts 10 | 71, 20, 9 |
| Evening, 60 min, News off | articles 10, Shorts 30, long 60 | 8, 29, 63 |
| Weekend, 90 min | articles 50, long 50 | 50, 50 |
