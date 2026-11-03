# ··· is the item, the session time is the session; Shorts mode moves to Settings

**Date:** 2026-11-03
**Type:** feature
**Author:** claude-code

## What changed

The session's top-bar ··· now opens actions for the item on screen and nothing else:
send on Discord, share or copy the link, open the original or the YouTube channel,
read in the app, save, go to the source, post details, and on a Short its video file,
YouTube's player controls and the Shorts mode switch. Next item, End session and the
link to the app menu ("Library, Saved and settings") moved to a new Session controls
sheet, opened by tapping the session time phrase beside the wordmark. The phrase now
carries a small chevron and is named "Session: <phrase>, open session controls".
Over a Short, where the top bar steps aside, the clip's bar gains a timer button at
its leading edge that opens the same sheet; its ··· is the Short's own. At the end
of the queue there is no item, so there is no ···.

Shorts mode is now a row in Settings, always shown, with a line saying what it does
(short videos play large and start on their own; other cards are unchanged; this
browser only). It still appears in a Short's own ··· while that Short is on screen.
It is no longer in Custom session, and nothing about the queue decides whether it is
offered.

## Why

Fisher on v0.96.0 (#208): "what do you mean that the ... menu only shows when a
session has shorts? As a user that makes no sense to me. Is the ... menu for the
post? Is it for the session?" The #206 sheet mixed item actions with session
actions, and its Shorts mode row appeared whenever the queue held any Short
(`onShortsModeChange={hasShorts ? ... : undefined}`), so the same ··· on the same
kind of card showed different rows depending on things the user could not see.

Custom session's copy put Shorts mode beside a session's setup, which read as a
per-session choice. It is a per-account browser preference, so it moved out to
Settings rather than staying in two places with different meanings.

## How

- `components/SessionControls.tsx` is the session sheet. `SessionPage` publishes
  `onLabel` (session controls) and `onMenu` (item actions, absent at the end) through
  `useInstrument`; `App` draws the phrase as a `button.topbar-status` when `onLabel`
  is set. Loading, error and review screens keep the app-menu ··· as before.
- `ItemActions` lost `status`, `onNext`, `onEnd` and the app-menu row; the Shorts
  mode switch renders only when the item is a Short. `SessionPage` passes the
  setter unconditionally.
- `SessionCard`'s Shorts footer takes `onSessionControls`/`sessionStatus` and
  renders `.shorts-session` before the creator.
- `SettingsPage` reads and writes `useShortsMode` directly; the row sits outside the
  server-settings gate because the choice is browser-local.
- The verify scripts open Next item and End session from the session controls,
  assert the item sheet carries no session rows and that two articles get the same
  rows, and assert the Short's sheet has Shorts mode but no session controls.

## Verification

`go test ./...`, `tsc`, `npm run build`; all eight `web/tools/verify-*` scripts in
Chromium and WebKit against a local Vite + API on a copy of the #207 snapshot;
`npm run lab` and `measure` on the lab. Screenshots (uidrive, iPhone viewport, both
engines) of the ··· on an article, a Bluesky post and a Short, the session controls
from the top bar and from a Short, and Settings.

Issue: #208.
