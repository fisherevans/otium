# Faster session build: one cadence pass, narrow pool sort, lazy bodies

**Date:** 2026-10-31
**Type:** refactor
**Author:** claude-code

## What changed

`store.Candidates` (the session builder's pool query) now aggregates each source's
cadence window once instead of per row, resolves the newest-`limit` cut and
`recency_rank` on narrow rows before joining back to the item columns, and no
longer reads item bodies. `buildSessionQueue` loads bodies for the queued items
only, through the new `store.ItemContents`. `InsightsItems` and `CandidatesByIDs`
share the per-source cadence join.

## Why

Starting the Shorts starter (all sources, `content_types: ["short"]`) took about
five seconds on the phone. Measured against a copy of the production database, the
build spent almost all of it in `Candidates`, which pulls up to 20,000 unseen
items across every source:

- `win_count` and `win_span` were correlated subqueries evaluated per result row,
  so each of a source's items re-scanned that source's whole 400-day window - about
  4.9M index steps for the 20k-row pool.
- The `ORDER BY ... LIMIT` sort carried every wide row, and every row read its body
  (about 55 MB in total, most of it article full text), although a session keeps at
  most 45 items.

Local timings on the copy (modernc SQLite, same machine; production is slower in
absolute terms):

| Starter | `Candidates` before | after | full build before | after |
| --- | --- | --- | --- | --- |
| Shorts (all sources, 20k-row pool) | 3.1-3.4 s | 0.8-1.2 s | 3.1-3.2 s | 0.9-1.3 s |
| News (13 sources, 3.9k rows) | 1.3-1.8 s | 0.2 s | 1.4-1.5 s | 0.35 s |

## Context / alternatives

Behaviour is unchanged: on the production copy the new query returns the same rows
in the same order with the same fields (bodies compared after `ItemContents`),
for both starters and both pool limits, so `Allocate` sees an identical pool.

Pushing the content-type filter into SQL would cut the Shorts pool further, but it
would change which items reach the allocator (the 20k cut and `recency_rank` are
currently taken across all media before the Go-side filter), so it is left as a
separate decision. `CandidatesByIDs` (session resume) now aggregates the window over
all sources rather than per row, which costs about 7 ms more on 45 ids.

## Related

- #186
