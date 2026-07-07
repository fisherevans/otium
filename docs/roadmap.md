# otium - roadmap

A narrative of where the product is headed. **Open work lives in GitHub
issues + milestones, not here** - this doc is orientation, not a task list. See
[CLAUDE.md - Tracking & work definition](../CLAUDE.md#tracking--work-definition-github-issues).

    gh issue list                          # the whole backlog
    gh issue list --milestone "…"          # a single stream

## Where things stand

The **session engine** is built and works end to end locally: ingest
(RSS/YouTube/podcast) → rank → a time-boxed, paced, single-item stream. "How
much time" is a wall-clock budget, not a summed item duration; the ranker stages
a queue and the client paces it against elapsed time, with pacing check-ins and
skip-rate + predicted-items feedback into ranking. Follow-import (OPML + YouTube
Takeout CSV) is in. Auth is a confidential OIDC client of auth.fisher.sh with a
local dev bypass.

What it is **not** yet: deployed (the whole `Deploy to homelab` milestone -
k3s, the Hydra client, the Cloudflare route, observability), themed (the
`Design system` milestone - 18 candidate directions sit in [`design/`](../design/)
awaiting a pick), or fleshed out on curation/discovery/intelligence.

## The milestones

- **Session engine** - the core loop; mostly built, with refinements open
  (behavioral pace, cadence fix, interest↔source UI, drill-in).
- **Curation & controls** - weights, interest health, tuning, "why this item".
- **Discovery & trials** - trial sources, like-based recs, the discovery queue,
  mapping locked-down platforms (TikTok/IG/Patreon) to real feeds.
- **Intelligence & agent** - user-facing stats, a JSON/agent API, the LLM
  operator that tunes interests conversationally.
- **Deploy to homelab** - stand it up gated at `otium.fisher.sh`, phone flow end
  to end. The original mandate.
- **Design system** - pick a visual language and wire it in.

The product thesis these serve is in [product.md](product.md); the
theme-independent experience rules are in
[../design/EXPERIENCE.md](../design/EXPERIENCE.md).
