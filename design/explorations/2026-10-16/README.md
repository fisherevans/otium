# Otium analog directions

Ten independent design studies for [#163](https://github.com/fisherevans/otium/issues/163). This directory is a design artifact, not production UI. The deployed app remains unchanged.

Fisher requested a substantial visual overhaul, with iPhone first and e-ink retained. Buffer supplies the interaction polish reference; Otium is the analog counterpart, led by serif typography. The core remains a centered brief per vertical swipe, deliberate entry into reading, and inset inline video. The folded O has its fold at the upper right.

Each concept was created by a separate cold agent from the same brief and a distinct design perspective. Agents did not inspect each other's outputs. The shared script supplies consistent illustrative interactions, and the comparison gallery puts identical content across every direction. Root review corrected narrow-screen control spacing without combining the visual directions.

Open `index.html` for the gallery, or any `concept-NN.html` directly. Everything loads locally, including fonts, photos and the illustrative MP4. `?sample=vtdigger|politico|404media|long-title` chooses the starting article. `?state=reader`, `?state=video`, `?state=library` select capture states. `?eink=1` is a grayscale preview, not physical-device validation. `window.otiumPreview.screen()` exposes those states for capture.

The prototypes contain four real article fixtures and one illustrative video, reader overlays, source and library navigation, Saved, session setup and finish, history, insights and appearance. Account actions are local simulations. The article picker in the gallery switches the same fixture across all ten styles. Actual headlines, authors, dates and publisher images are used; teasers are explicitly labelled original paraphrases within 2% of measured feed-description length. The reader links to the original article rather than reproducing its full body. They do not implement production persistence, the existing curation engine, every settings control, or actual YouTube embeds. No production functionality is authorized for removal by these mockups.

Validation: Chromium 149 and WebKit 26.5, 390x844 and 320x740; all ten loaded without script errors, videos played and paused when leaving the frame, and the narrow first-brief layouts had no horizontal or vertical overflow. Reviewed brief, reader, video and library screenshots for each. Physical iPhone and e-ink validation belongs to the selected implementation.

## Files and publication

- `concept-*.html` and `.json`: individual styles and their rationale/tradeoff.
- `shared.css` and `shared.js`: shared prototype behavior and typography assets.
- `concepts.js`: combined metadata for the gallery.
- `shots/`: Chromium previews used by the gallery.
- `content.js`, `real-content.js`, `measurements.json`: selected fixture data, rendering and per-item numeric evidence.
- `feedback.md`: the separately published Quiver review form.

Publish this directory with `quiver report <directory> --project otium --as analog-directions`. Publish the feedback markdown separately as `analog-directions-feedback`.

Gallery: https://quiver.fisher.sh/static/reports/otium/2026-10-16-analog-directions/

## Asset provenance

The video remains fictional comparison content. Article fixtures are drawn from 79 public feed/listing entries dated October 10-16, 2026 UTC (October 16 partial). See the gallery sampling section and `measurements.json` for scope and numeric evidence. Article images retain the publisher credits recorded in `content.js`; the Barre story is syndicated from Vermont Public. POLITICO page retrieval was robots-blocked, so its metadata comes from its official politics RSS. No full article bodies are included. The street photograph comes from https://images.unsplash.com/photo-1449824913935-59a10b8d2000 and the landscape from https://images.unsplash.com/photo-1470770841072-f978cf4d019e. The MP4 is a ten-second slow pan/zoom of that landscape, an illustrative motion sample rather than a publisher's video.

Newsreader, Fraunces, Source Serif 4 and Bodoni Moda are bundled from the official google/fonts repository. Each family has its SIL Open Font License in `assets/`. No Buffer data or private screenshots are included.

## Real-content fitting

The prototype fitting rule starts with each independently designed layout. When content overflows, it clamps the teaser, reduces image height, then reduces headline size. It preserves the complete headline and 44px controls. This is intentionally scoped to the prototypes; it does not claim fidelity to the existing production card solver. The selected design must be integrated and measured with that solver before shipping.

Fisher's follow-up on the real stories: headlines occupied too much of the brief. All directions now start at 28px (26px on narrow screens), with 1.18 line height. Descriptions remain 17px (16px narrow); the fitting rule trims visible summary lines before making text smaller. The original serif families and layout treatments remain distinct.

Real-content verification: all four fixtures in all ten styles at 390x844 and 320x740 in Chromium and WebKit (160 layout cases), with no detected content overflow, clipped headlines, missing images or undersized article controls. The gallery checks every article/reader image, comparison selection, direct reader links, video playback and offscreen pause. The published artifact was checked again after upload.
