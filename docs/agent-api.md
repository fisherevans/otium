# Agent API

A small set of routes an agent can call with a static bearer token instead of a browser
login. The token is `OTIUM_AGENT_TOKEN` (homelab: BW `nottingham-cloud` / `otium-agent-token`)
and acts as `OTIUM_INGEST_USER`. Only routes under `/api/v1/agent/` accept it.

```sh
curl -H "Authorization: Bearer $TOKEN" https://otium.fisher.sh/api/v1/agent/presets
```

| Route | What |
| --- | --- |
| `GET /agent/profile?days=90` | Engagement per followed/trial source, the topic list, and existing suggestions (#202). |
| `POST /agent/suggestions` | Add follow suggestions; `trial: true` starts one as a trial source (#202). |
| `GET /agent/presets` | Saved session presets and mixes, the default id (#203). |
| `PUT /agent/presets/{id}` | Create or replace one preset; `?default=1` also makes it the default. |
| `DELETE /agent/presets/{id}` | Remove one preset. |

## Presets and mixes

A preset is `{ "name": "...", "setup": {...} }`. A plain preset's setup:

```json
{ "minutes": 10, "sections": ["news"], "excluded": [], "contentTypes": ["article"] }
```

A mix adds `mix` and spans every section, so `sections`/`excluded`/`contentTypes` are
derived and can be omitted:

```json
{ "minutes": 30, "mix": { "formats": { "article": 40, "post": 10, "short": 20, "long": 30 },
                          "sections": { "news": 2, "videos": 0.5 } } }
```

`formats` are relative shares of session time (any scale, 0-1000 each, at least one > 0):
`article`, `post` (Bluesky), `short`, `long`. `sections` maps a section slug to a weight:
0 off, 0.5 less, 1 even (the default for anything unlisted), 2 more. Invalid setups get a
400 naming the problem. Browsers pull the list on load, so an agent's change shows up the
next time the app opens.
