# The layout lab

`/lab` is a harness for the session card. It renders the **real** `SessionCard`
through the **real** layout engine (`src/lib/cardLayout.ts`) and exposes every
layout decision as a control, so you can permute the card without editing it.

It exists because the alternative failed. Hand-drawn mockups of this card drifted
from the app - one grew a "Watch" button that has never existed - and a mockup you
cannot trust is worse than none. The lab imports the same component the session
imports, so the two cannot disagree: if a change breaks the card, it breaks the
preview too, which is the point.

## Running it

```sh
npm run dev        # then open http://localhost:5173/lab
npm run lab        # build a standalone single-file lab -> dist-lab/lab-standalone.html
```

The standalone build inlines the app, styles, fonts and fixture images into one
HTML file, so it can be opened from disk or published as an artifact for review.
The interactive player can still contact YouTube. The measurement command stubs
that player and measures the fixture posters without external media requests;
it verifies geometry, not playback. `dist-lab/` is gitignored.

State lives in the URL hash (device, fixture, and the full layout object), so any
view you reach is a link you can send or script. `reset` restores the shipped
configuration; the preset list carries the alternatives that were considered.

## Files

| file | what it is |
|---|---|
| `LabPage.tsx` | the harness UI - device frame, controls, live readout |
| `layout.ts` | the knobs, the presets, and the lab-only measurement helpers |
| `fixtures.ts` | the content shapes that break layouts, as real `Selected` payloads |
| `../styles/lab.css` | lab chrome, plus the non-default knob values as CSS |
| `../lib/cardLayout.ts` | the engine. **Shared with the session** - not lab code |

## Fixtures

The fixture list is not a sample, it is the set of shapes that have actually
broken this card: a portrait hero that got cropped to a band, a 9:16 player that
pushed its actions off screen, a four-line headline that got an ellipsis, an item
with no author and no topic, unbreakable tokens, and a Japanese headline whose
line-breaking and glyph height differ. Images are inline SVG data URIs so a run is
deterministic and needs no network.

Add a fixture whenever you find a new way to break it. That is how the list earns
its keep.

#205 added the shapes from Fisher's Everything-mix review: `news-vtdigger` (a
short local-news card that must centre with full-screen Shorts on and off),
`bsky-text-short` and `bsky-text-long` (text posts with nothing but an avatar),
and `bsky-link-avatar` (a link card whose picture is a profile avatar, which must
never become the hero). `bsky-image` and `bsky-quote` are posts now too.

#207 added structured posts (`post_body`): `bsky-otm` (Fisher's On the Media post -
a mention, a display-shortened link and a link card whose description must not take
over), `bsky-images` (two pictures and a hashtag), `bsky-quoted` (a quote that arrives with
the post, not the conversation) and `bsky-thread` (212 replies, nested in the reader).
`measure` fails a post link without an http(s) target and a link card over 130px tall.

The Shorts mode switch uses the real compact card and solver. Portrait, square
and landscape short videos exercise its contained frame, compact creator/date
and the ··· that opens item and session actions (#206). A long portrait video verifies that geometry alone does
not activate this mode.

## Measuring

Screenshots are not enough - this layout is solved at runtime, so the numbers only
exist once a browser has laid it out, and eyeballing them got the wrong answer
repeatedly. Use the instrument:

The harness drives a real Chromium via Playwright. Playwright is a devDependency,
but the browser binary is fetched separately - run `npx playwright install chromium`
once after `npm install`. It lands in Playwright's own cache; you do not need to
point `PLAYWRIGHT_CHROMIUM` at a system Chrome (that env var is an override for
sandboxes that ship a preinstalled binary, not a normal-machine requirement).

```sh
npm run measure -- --lab dist-lab/lab-standalone.html      # design against this
npm run measure -- --lab dist-lab/lab-standalone.html --shorts-mode
npm run measure -- --app http://localhost:5173             # verify what ships
npm run measure -- --lab dist-lab/lab-standalone.html --shots /tmp/cards
```

It reports, per card: the space above the first line and below the action row
(these should match within a pixel or two when the card has slack; `offCentre`
is their difference net of the chrome the card is padded clear of, and anything
over 4px fails the run), the header
rhythm, the resolved title size, the media's size and share of the card, any
overflow, and whether the actions are reachable. It exits non-zero if anything
clipped, so it can gate a change.

The lab's "full screen" knob is on by default: since #206 it is the only session
view (the header floats over the reel, there is no bottom pill, and ordinary cards
are padded clear of the chrome by the same rule the app uses - #205, when this rule
once dropped the centring pad and every article in a session with Shorts sat at
the top). `measure` always measures it; `--framed` measures the retired pill layout
for comparison, and `--immersive` is accepted as a no-op. Shorts themselves are not
drawn edge to edge in the lab. `--viewing on|off` sets Shorts mode for an `--app`
pass, and full-screen Shorts skip the compact-card checks (verify-shorts-playback
covers that geometry).

`--app` needs the Go server and a seeded database (see the repo `CLAUDE.md`), and
walks a real session rather than fixtures. Both modes cover 412, 390, 375 and
320px widths. The app pass resets to the first card for each viewport and accepts
a direct active-session URL. The lab imports the shared appearance and interface
styles so typography and action sizes stay aligned with production. For concurrent
local checks, capture a real `/api/v1/sessions/current` JSON response and pass
`--session /path/to/session.json` alongside `--app`. This replays that queue in
the actual app and suppresses writes, so another browser cannot change the
measured content or cursor mid-pass. Article-content GETs still use the server.

## Changing the card

1. Permute in the lab until it looks right, on the Palma frame and at 320px.
2. `npm run measure -- --lab …` across every fixture. Read the table, not the vibes.
3. Move the decision into `cardLayout.ts` (if it needs measurement) or `global.css`
   (if it does not), and set the lab's shipped defaults to match.
4. `npm run measure -- --app …` against the running app to confirm what ships.

Step 3 has a trap worth knowing: several long-standing rules in `global.css` match
the card's rules at equal specificity and win on source order - the portrait-video
one-line title clamp, the audio two-line clamp, the vertical card's own padding.
If a change works in the lab and not in the app, look there first.
