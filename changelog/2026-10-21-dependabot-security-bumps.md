# Security dependency bumps and nginx 1.30 for otium-web

**Date:** 2026-10-21
**Type:** infra
**Version:** v0.79.2
**Author:** claude-code

## What changed

Go: `golang.org/x/oauth2` 0.23 -> 0.37, `github.com/go-jose/go-jose/v4` 4.0.2 -> 4.1.6, `golang.org/x/net` 0.35 -> 0.61, `github.com/go-chi/chi/v5` 5.1 -> 5.5. `golang.org/x/crypto` drops out of the module graph entirely (go-jose 4.1 uses the stdlib pbkdf2). Web: `react-router-dom` 7.18.4, `dompurify` 3.4.17, `vite` 6.4.5 (pulls patched postcss, browserslist, baseline-browser-mapping). otium-web's runtime moves from `nginx:1.27-alpine` (EOL) to `nginx:1.30-alpine`.

## Why

Dependabot alerts enabled under fisherevans/nottingham-cloud#800 flagged 39 open alerts (8 critical, 10 high). Reachability in the deployed images:

- **x/crypto** (all 8 criticals): only `pbkdf2` was linked, via go-jose. Every advisory is in `x/crypto/ssh`, which otium never imports. Unreachable.
- **go-jose** (JWE decrypt panic, compact-parse DoS): go-oidc verifies the ID token with go-jose, but the token only ever arrives from auth.fisher.sh's token endpoint over TLS, and otium never decrypts JWE. Reachable only by the trusted issuer.
- **x/oauth2** (jws malformed-input): the `jws` package is not used; otium uses the `oauth2.Config` code exchange only. Unreachable.
- **x/net/html** (parser DoS, XSS): reachable - gofeed parses untrusted RSS/Atom with it. Medium severity, now fixed.
- **chi** RedirectSlashes open redirect: middleware not mounted. Unreachable.
- **react-router** RSC CSRF: otium-web is a client-only SPA, no RSC/SSR. Unreachable.
- **dompurify**: used to sanitize untrusted article HTML, but the advisories need `IN_PLACE` or `CUSTOM_ELEMENT_HANDLING`, neither of which otium sets. Bumped anyway since this is the real XSS boundary.
- **vite/postcss/source-map-js/browserslist/launch-editor**: dev and build tooling, not in the nginx image.

## Related

- fisherevans/nottingham-cloud#800
