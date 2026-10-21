# Weekly rebuild on a fresh base image

**Date:** 2026-10-21
**Type:** infra
**Author:** claude-code

## What changed

`build.yml` gains a weekly `schedule:` trigger (Saturdays, 09:xx UTC). The scheduled run
builds the default branch with the layer cache off and the base re-pulled, and publishes only
the rolling tags (:main, :latest and :sha-<short>). Manual `workflow_dispatch` runs take the same uncached path.

## Why

The eMudhra CA compromise review
([nottingham-cloud#800](https://github.com/fisherevans/nottingham-cloud/issues/800)) found that
images only rebuilt when a feature shipped, so a patched base (a new `ca-certificates`, a
runtime security fix) never landed on its own. With a weekly rebuild, a fresh-base image of
`main` is always in ghcr, and cutting a patch tag picks it up.

The cache is off on those runs on purpose: with `cache-from: type=gha` a
`RUN apk add ca-certificates` layer is a cache hit as long as the base digest is unchanged,
so a cached rebuild can republish the exact stale package it was meant to replace.

A scheduled run never touches a version tag (it runs on the branch ref, not a tag), so a
deploy pinned to `vX.Y.Z` cannot move. Releases stay manual. nottingham-cloud's reconcile
freshness check flags a package whose newest build is older than two weeks, which catches
this schedule being disabled or failing.
