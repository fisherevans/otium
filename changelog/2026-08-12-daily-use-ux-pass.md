# Daily-use UX pass: drop likes/favorites, reader images, calmer timer, session-end, menu, noise filters

**Date:** 2026-08-12
**Type:** feature
**Version:** v0.67.0
**Author:** claude-code

## What changed

A batch of changes from Fisher living in the app (issue #142):

- **Likes and Favorites removed entirely.** The heart is gone everywhere (session
  callout + keyboard `L`, InlineMedia, ReaderPage, Player); the `like`/`unlike`
  events and the auto "liked"/Favorites collection are retired. Curation is
  collections-only.
- **Reader renders images + safe video embeds.** `html.ts` allowed `img`/`picture`
  and a YouTube/Vimeo iframe allowlist; the pre-existing `.reader-body img` CSS and
  the reader-images preference (default on) were inert until now.
- **No visible timer during a session.** The countdown and progress bar are gone;
  when time's up the terminal card is a hub (extend +5/+10, start new, and an
  equally-prominent End session that opens the recap, now including in-app reading
  time).
- **Reader swipe-back hardened.** Decides the gesture axis once at an 8px slop and
  captures the pointer, so a back-swipe no longer dies on early vertical drift.
- **Start-session picker recomposed.** Sections are tap-to-fill tiles (like the time
  chips); topics are inline pill toggles - the checkbox-form + separate customize
  mode is gone.
- **Category-based noise filtering.** New items store their RSS `<category>` tags;
  `sources.archive_categories` blocks matching items in `eligible()` (sibling of the
  #118 keyword rule); the card `···` menu surfaces the item's categories as one-tap
  mutes plus a quick word filter (`POST /items/{id}/filter`).

Additive schema migration (`items.categories`, `sources.archive_categories`), tested
against a copy of the live DB.

## Why

The full reasoning lives in [docs/decisions.md](../docs/decisions.md#daily-use-ux-pass-v0670-142).
Headline: liking added clutter and Favorites was just its collection; the reader
should show the article's real photos, not alt text; watching the timer tick made a
calm session feel like a race; and obituaries / legal + public notices from Seven
Days and VTDigger are cleanly tagged with RSS categories, so filtering on those beats
fragile title/keyword matching - while staying a source-level noise filter (not user
tagging or a rules engine, per the "no librarian tooling" non-goal).
