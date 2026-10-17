# Serve native home-screen icon discovery paths

**Issue:** #166
**Version:** v0.78.1
**Author:** codex

The iPhone install sheet showed a generic letter tile. Access logs confirmed its NetworkingExtension requested the linked 180px PNG successfully, then also requested `/apple-touch-icon.png`, `/apple-touch-icon-precomposed.png` and `/favicon.ico`. All three root paths incorrectly returned the SPA HTML with HTTP 200.

Serve the existing folded-O artwork at those root paths, declare the touch icon's size/type explicitly and use a versioned link to avoid the earlier HTML response. Root icon locations revalidate and return 404 if absent instead of falling through to the app shell. The favicon is an ICO container holding the existing 32px PNG.

The linked PNG was already valid, opaque and accessible, so the missing fallbacks are a verified deployment defect rather than proof of the native sheet's entire failure cause. Validate the deployed responses and retain the issue for physical iPhone rechecking. Apple's documented discovery contract: https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html

## v0.78.2: inline the icon

The physical Safari recheck still showed a monogram. Native requests fetched the corrected PNG with 200 and then revalidated it with 304, so root fallback discovery was not the entire cause. Embed the same small PNG directly in the HTML touch-icon declaration, using the same transport workaround already deployed in Buffer (nottingham-cloud `0d26431c`). Root PNGs and manifest icons remain available. This bypasses separate icon fetching without changing the app, manifest identity or sessions. Buffer's original issue involved Access cookies; Otium's icon endpoints are public, so this is a targeted workaround to verify on the phone, not an established diagnosis or confirmed fix.
