# otium

*otium* (Latin): leisure spent well - reading, thought, things chosen on
purpose. Its opposite is *negotium*, busywork. A feed that consumes your time
without your intent is negotium wearing leisure's clothes. otium is the machine
for the other thing.

It is not an RSS reader and not a social feed. It answers one question:

> Given the sources you follow, how you've weighted them, and how much attention
> you want to spend right now - what should you consume, and why each thing?

You don't get an infinite timeline. You say "I have 15-30 minutes, in the mood
for comedy and music," and otium composes a finite, ordered, **explainable**
session from your unseen items - capping the creator who posts 30 times a day,
never burying the one who posts once a week, and telling you exactly why each
item made the cut.

## How it works

- **Sources** - creators/channels you follow (RSS, YouTube channel feeds,
  podcasts). Each carries a **weight** (very low → favorite) and a per-session
  cap.
- **Interests** - themes ("Comedy", "Local News") that group sources; a session
  targets one or more.
- **Session** - the core object. A duration range + themes → a ranked, capped,
  time-boxed set. Score = `weight × freshness-decay × rarity-boost`, all
  deterministic. Every item shows its reason.
- **Signals** - explicit only (open / like / skip / save). No dwell-time, no
  scroll tracking. Your data is yours; it feeds *your* stats and tuning, not an
  ad model.

See [docs/product.md](docs/product.md) for the full product thesis (distilled
from the design interview) and [docs/roadmap.md](docs/roadmap.md) for what's
built vs. next.

## Stack

- **otium-server** - Go API + feed ingest, one binary. State in SQLite.
- **otium-web** - TypeScript + React + Vite, nginx-served. Mobile-first.
- **Auth** - confidential OIDC client of `auth.fisher.sh` (Ory Hydra), gated to
  an allowed group. Deployed to the homelab k3s cluster behind a Cloudflare
  tunnel at `otium.fisher.sh`.

## Local dev

Two processes. The Go server runs with an auth bypass; Vite proxies `/api` and
`/auth` to it.

```sh
make server   # :8080, dev user, on-demand fetch
make web      # :5173, proxies to :8080
```

Open http://localhost:5173, go to **library**, add a feed URL (try a YouTube
channel feed: `https://www.youtube.com/feeds/videos.xml?channel_id=...`), then
build a session from the **intent** screen.

Config is env-driven; see [.env.example](.env.example). In prod, set
`OTIUM_OIDC_*` instead of `OTIUM_DEV_USER`.
