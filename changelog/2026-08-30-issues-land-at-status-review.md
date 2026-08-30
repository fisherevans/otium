# Issues land at `status:review`, not closed

**Date:** 2026-08-30
**Type:** decision
**Author:** claude-code

## What changed

`CLAUDE.md`'s tracking section no longer says to close an issue when the change lands. It
says to move it to `status:review` with a handover comment and leave it open until Fisher
closes it.

## Why

The pass that adopted the homelab issue lifecycle added a pointer block saying **only Fisher
closes an issue** while leaving "close it when the change lands" in the section below,
reconciled only by a "that supersedes the closing step below" sentence. Reading order is not
a resolution: an agent that reaches the older line follows it. The supersede sentence is gone
now that the line it covered has been fixed.

## Related

- `nottingham-cloud/agent/issue-lifecycle.md` (the contract)
- `nottingham-cloud` issue #245
