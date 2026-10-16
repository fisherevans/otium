# Otium analog directions

Ten independent design studies for [#163](https://github.com/fisherevans/otium/issues/163). This directory is a design artifact, not production UI. The deployed app remains unchanged.

Fisher requested a substantial visual overhaul, with iPhone first and e-ink retained. Buffer supplies the interaction polish reference; Otium is the analog counterpart, led by serif typography. The core remains a centered brief per vertical swipe, deliberate entry into reading, and inset inline video. The folded O has its fold at the upper right.

Each concept was created by a separate cold agent from the same brief and a distinct design perspective. Agents did not inspect each other's outputs. The shared script supplies consistent illustrative interactions, and the comparison gallery puts identical content across every direction. Root review corrected narrow-screen control spacing without combining the visual directions.

Open `index.html` for the gallery, or any `concept-NN.html` directly. Everything loads locally, including fonts, photos and the illustrative MP4. `?state=reader`, `?state=video`, `?state=library` select capture states. `?eink=1` is a grayscale preview, not physical-device validation. `window.otiumPreview.screen()` exposes those states for capture.

The prototypes contain three briefs, reader overlays, source and library navigation, Saved, session setup and finish, history, insights and appearance. Account actions are local simulations. They do not implement production persistence, the existing curation engine, every settings control, or actual YouTube embeds. No production functionality is authorized for removal by these mockups.

Validation: Chromium 149 and WebKit 26.5, 390x844 and 320x740; all ten loaded without script errors, videos played and paused when leaving the frame, and the narrow first-brief layouts had no horizontal or vertical overflow. Reviewed brief, reader, video and library screenshots for each. Physical iPhone and e-ink validation belongs to the selected implementation.

## Files and publication

- `concept-*.html` and `.json`: individual styles and their rationale/tradeoff.
- `shared.css` and `shared.js`: shared prototype behavior and typography assets.
- `concepts.js`: combined metadata for the gallery.
- `shots/`: Chromium previews used by the gallery.
- `feedback.md`: the separately published Quiver review form.

Publish this directory with `quiver report <directory> --project otium --as analog-directions`. Publish the feedback markdown separately as `analog-directions-feedback`.

Gallery: https://quiver.fisher.sh/static/reports/otium/2026-10-16-analog-directions/

## Asset provenance

The publishers, creators and copy are fictional comparison content. The street photograph comes from https://images.unsplash.com/photo-1449824913935-59a10b8d2000 and the landscape from https://images.unsplash.com/photo-1470770841072-f978cf4d019e. The MP4 is a ten-second slow pan/zoom of that landscape, an illustrative motion sample rather than a publisher's video.

Newsreader, Fraunces, Source Serif 4 and Bodoni Moda are bundled from the official google/fonts repository. Each family has its SIL Open Font License in `assets/`. No Buffer data or private screenshots are included.
