# Saved presets and mixes live on the server

Mixes (#201) shipped as browser-local presets, like every saved preset before them. When
Fisher asked an agent to make an "Everything" mix it could not: there was nothing on the
server to write to. His ruling: "Mixes should be in the back end. Fully manageable by
agents." (#203)

Saved presets and the default now live in a `session_presets` table and kv, with owner
routes the browser syncs through and agent routes behind the #202 token
(`docs/agent-api.md`). The browser keeps localStorage as a cache: it pulls the server list
when the app loads, pushes every change after that, and pushes nothing until a sync has
succeeded, so a stale cache cannot overwrite an agent's edit. The first sync for an account
uploads the browser's own presets, merged with any an agent added before it, so nothing is
lost in the switch-over. Recent setups and the repeat-suggestion state stay local; they are
the device's history, not configuration.

The sync lives in `web/src/lib/presetSync.ts` behind a store hook, so
`sessionPresets.ts` stays free of the API client and its standalone test keeps working.
