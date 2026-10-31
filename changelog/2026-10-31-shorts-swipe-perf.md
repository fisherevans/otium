# Smoother Shorts swipes, quieter playback controls

Fisher found swiping between Shorts clunky and the Sound/CC/Player row noisy.
Instrumenting the transitions (web/src/lib/perf.ts, measured with real YouTube
embeds by web/tools/measure-shorts-transitions.mjs) showed why:

- A swipe that started on the video did not scroll at all. The gesture overlay
  was `touch-action: none` and only a fast flick (<400ms) navigated; anything
  slower toggled pause. It is now `pan-y`: vertical drags are the reel's native
  scroll, taps still play/pause, a left flick still advances.
- The shared player lived in `<body>` as `position: fixed` and re-aligned itself
  from scroll events, so it trailed its card whenever the main thread was busy.
  It now sits inside the reel's scroll content and moves with the card on the
  compositor.
- The next clip started loading when the incoming card was 60% visible, so
  ~0.6-0.8s of YouTube iframe main-thread work (4x CPU throttle) landed in the
  middle of the snap. The player now moves to the new card on `scrollend` (idle
  fallback), measured at ~0.1-0.2s after the scroll settles.
- Unfocused Shorts cards rendered a different layout and were dimmed to 35%, so
  the incoming card reflowed and looked grey. Every Shorts card now keeps the
  media layout with its poster, at full brightness; posters use `cover` so a
  vertical clip's thumbnail crops to the picture and the poster-to-video change
  is near invisible. The poster fades out on the first frame.

Controls: Sound and CC are two icons in the creator footer, time left joins the
date line, a hairline shows progress, and YouTube's native controls moved to the
Actions sheet. A small store (lib/shortsBus.ts) carries player state to the
footer so the clock never re-renders the session page; taps still call the
player synchronously, which iOS needs to unmute.

Each transition is beaconed to `POST /api/v1/client-metrics` and logged by the
server, so phone timings are visible in Datadog logs.

Issue: #182.
