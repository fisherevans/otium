# Afterglow: reading and movement

[Try the updated prototype](https://quiver.fisher.sh/static/reports/otium/2026-10-16-afterglow/?audition=0#start).

Custom session now leads the main screen, above the default and saved presets. Start a news or video preset with one tap. Custom keeps time, library selection and media type on one screen. Both common paths fit without scrolling at the tested phone sizes.

Recent unsaved setups appear below presets. Start one again or save it. Repeating the same custom setup twice offers a quiet save prompt at the ending and next start. You can also save any unsaved setup when you finish, name it, and make it your default. Nothing is saved as a preset automatically.

Interface copy now uses state and action labels. The ending says Session complete and offers Saved articles, New session and Extend session. Affirmations, permission-giving and meditative filler have been removed from screens, dialogs, empty states and utility bars.

```ask
type: text
id: afterglow-copy
label: Is any interface copy still unnecessary, or is Custom session still hard to find?
help: Try the default, video preset, custom setup and promoting a recent setup. The default and custom paths should not require scrolling.
```

This is a local design prototype; production is unchanged. Browser checks include Firefox, Chromium and WebKit, but physical iPhone, home-screen PWA and e-ink feel still need device verification. [Notes, recordings and sources](https://quiver.fisher.sh/static/reports/otium/2026-10-16-afterglow/notes.html).
