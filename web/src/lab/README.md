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

The standalone build inlines everything into one HTML file with no external
requests, so it can be opened from disk, attached to a message, or published as an
artifact for review. `dist-lab/` is gitignored.

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

## Measuring

Screenshots are not enough - this layout is solved at runtime, so the numbers only
exist once a browser has laid it out, and eyeballing them got the wrong answer
repeatedly. Use the instrument:

```sh
npm run measure -- --lab dist-lab/lab-standalone.html      # design against this
npm run measure -- --app http://localhost:5173             # verify what ships
npm run measure -- --lab dist-lab/lab-standalone.html --shots /tmp/cards
```

It reports, per card: the space above the first line and below the action row
(these should match within a pixel or two when the card has slack), the header
rhythm, the resolved title size, the media's size and share of the card, any
overflow, and whether the actions are reachable. It exits non-zero if anything
clipped, so it can gate a change.

`--app` needs the Go server and a seeded database (see the repo `CLAUDE.md`), and
walks a real session rather than fixtures.

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
