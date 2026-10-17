# Afterglow production verification

The implementation uses the existing application and APIs. Test writes target a copied SQLite database or are intercepted in the browser. No production reading history, source settings or collection data was reset.

- The production frontend build and full Go suite pass, including media filtering before source allocation and durable session extension.
- Launcher flows pass in Chromium, WebKit and Firefox: default and video setup, custom scope/media/topics, empty results, preset save/default/reload, recent setup reuse, repeat suggestion and failed library load/retry. Common setup fits at 320x568 and 390x664.
- Session checks pass in Chromium and WebKit for broad article opening, image hold, explicit Next and Back, shown-only review, frozen stats, failed and successful collection saves, reload and extension. Seven gesture guards reject unintended navigation; Chromium also advances through a real touch swipe starting at the reader bottom. Native audio playback advances currentTime and records one audio play in the review.
- The committed overlay suite passes in Chromium and WebKit, including extraction retry, nested dialogs, focus/inertness, browser Back/Forward, cancelled/multitouch gestures and reduced motion.
- Appearance checks pass for live preview, account image choices, local e-ink, queued saves and failure/retry.
- Twelve secondary routes at two widths in Chromium and WebKit yield 48 checks without horizontal overflow or page errors. Source archive/order/representation and keyword changes, collections, history filters, OPML candidate selection and bottom-action reachability were exercised. Source keyword-save failures now keep the dialog and draft open.
- Back preserves source-parent navigation, collection selection and Saved query filters when returning from Appearance. Active sessions remain accessible through Resume and the app menu.

Physical iPhone keyboard/fullscreen/PWA safe-area behavior and e-ink refresh quality remain unverified. ZIP import and external YouTube channel discovery are retained from existing code; the OPML path was exercised in this pass. The live layout lab passes 40 fixtures across iPhone, SE, narrow-phone and Palma dimensions. External YouTube playback and the final real-content card measurements are recorded in the published release verification.
