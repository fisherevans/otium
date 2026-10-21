# Refresh the runtime CA store after the eMudhra intermediate compromise

**Date:** 2026-10-21
**Type:** infra
**Version:** v0.79.1
**Author:** claude-code

## What changed

The server runtime stage moves from `alpine:3.21` to `alpine:3.22` and runs `apk upgrade` before installing `ca-certificates`, so the image gets `ca-certificates 20261020-r0` even when the 3.22 base tag predates it. No code change.

## Why

eMudhra's intermediate CAs were compromised on 2026-10-20. The Go server verifies against the system store in `/etc/ssl/certs`, and it fetches arbitrary RSS feeds, so the fixed Alpine package (which drops `emSign ECC Root CA - G3`) is the whole fix. Alpine 3.21 also goes EOL on 2026-11-01, so the base bump lands in the same release. `apk upgrade` is there because the `alpine:3.22` tag was last rebuilt 2026-09-18 and `apk add` does not upgrade an already-installed `ca-certificates-bundle`.

## Related

- fisherevans/nottingham-cloud#800
