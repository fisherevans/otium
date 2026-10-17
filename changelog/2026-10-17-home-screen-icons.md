# Serve native home-screen icon discovery paths

**Issue:** #166
**Version:** v0.78.1
**Author:** codex

The iPhone install sheet showed a generic letter tile. Access logs confirmed its NetworkingExtension requested the linked 180px PNG successfully, then also requested `/apple-touch-icon.png`, `/apple-touch-icon-precomposed.png` and `/favicon.ico`. All three root paths incorrectly returned the SPA HTML with HTTP 200.

Serve the existing folded-O artwork at those root paths, declare the touch icon's size/type explicitly and use a versioned link to avoid the earlier HTML response. Root icon locations revalidate and return 404 if absent instead of falling through to the app shell. The favicon is an ICO container holding the existing 32px PNG.

The linked PNG was already valid, opaque and accessible, so the missing fallbacks are a verified deployment defect rather than proof of the native sheet's entire failure cause. Validate the deployed responses and retain the issue for physical iPhone rechecking. Apple's documented discovery contract: https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html
