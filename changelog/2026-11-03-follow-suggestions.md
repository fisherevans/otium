# Follow suggestions, as trials and a Suggestions list

Fisher wanted help finding people and publications to follow, without filling his
sessions with junk, inferred from what he already reads (#202). He chose both delivery
paths: confident picks start as trial sources, and the rest wait in a list.

The recommender runs on the devbox (`tools/otium-recs/` in nottingham-cloud), not in
otium-server, because the judgment is a model call made through the Claude CLI on the
devbox's plan. Otium exposes a two-route agent API for it, behind a static bearer token
(`OTIUM_AGENT_TOKEN`) that acts as the ingest user: `GET /api/v1/agent/profile`
(engagement per source plus the topic list) and `POST /api/v1/agent/suggestions`.
Nothing else in the API accepts the token.

Suggestions live in their own table, not as sources, so the Library only shows what was
chosen. A suggestion becomes a source when it is tried (`state = 'trial'`, placed in its
proposed topic, fetched at once; Bluesky trials get the busy-source defaults from #197).
Keep makes it `followed`; dismissing a pending suggestion records it so the same feed is
never offered again, and dropping a trial archives its source. Anything already followed
or ever suggested is skipped on insert, so reruns are safe.

The Suggestions screen (Library -> Suggestions) shows each with the recommender's reason,
trials first with how many of their items were opened so far.
