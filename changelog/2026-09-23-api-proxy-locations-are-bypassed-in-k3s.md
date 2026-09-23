# otium-web's proxy locations are bypassed in k3s

**Date:** 2026-09-23
**Type:** docs
**Author:** claude-code

## What changed

`web/nginx.conf` gains a header note, and its `/api/` and `/auth/` locations each
gain a one-line pointer to it. No directive changed; the file behaves identically.

## Why

As of nottingham-cloud#521, Caddy splits `/api/*` and `/auth/*` off to `otium-server`
before a request reaches this container. Those two locations are now dead in the
homelab - editing them moves nothing at otium.fisher.sh - and nothing in this repo
said so, which is exactly the kind of thing someone debugging an API path at 1am
loses an hour to.

The reason the split moved up is worth having here too: otium-server is a
single-replica `Recreate` pod, so it is genuinely absent for the length of an image
pull on every deploy, and nginx open source cannot hold a request across that.
`proxy_next_upstream` means "try the next server in the group", and a `proxy_pass` to
one host has no next server. Caddy's `lb_try_duration` does hold, so the split moved
to where the hold lives. Measured on the real image before the move: across two
rollouts, 38 instant 502s, 9 that hung ~38 seconds on a stale conntrack entry before
502ing, and 14 that never answered. After: zero failures, longest request held 4.3s.

The locations stay, deliberately - otium-web plus otium-server should still work as a
standalone pair for anyone running the two images without an edge proxy in front.

## Context / alternatives

The obvious fix - give nginx a retry - was tried on paper and dropped. Listing the
same backend twice in an `upstream` block does enable `proxy_next_upstream`, but the
retries are back-to-back with no interval, and against a connection refused in
microseconds that is a busy loop in the worker for the length of the gap, which would
stall the static serving that this container exists for.

## Related

- nottingham-cloud#521 - the Caddy split and the measurements
- nottingham-cloud#520 - the deploy hold on every other Recreate route, which scoped otium out
