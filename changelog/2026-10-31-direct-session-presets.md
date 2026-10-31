# Direct starts for News, Shorts and Long videos

Creating a Shorts session still required walking through custom setup. Fisher wanted
ready choices for news, short-video scrolling, and finding longer videos to watch.

The start page now exposes all three as direct, large tap targets: News for ten
minutes of articles in the existing News section, Shorts for ten minutes of short
videos across sources, and Long videos for forty minutes of long videos across
sources. A separate control customizes each choice. Custom setup and management
sit below them; recent unsaved setups and their save prompt remain in Recent sessions.
A custom default stays visible with the starters.

Presets are browser-local, so changing one agent browser would not reach Fisher's
phone. A one-time account-keyed migration adds the starters on the next load. It
replaces only untouched stock Reading/Video choices, preserving edits, custom
presets, default intent, recents and session history. A removed starter is not
recreated on subsequent loads. The News preset resolves the actual News section;
when there is no such section it covers article sources generally.

No session starts automatically, and the current session is not replaced until a
start is explicitly tapped. The existing Shorts viewing preference stays separate.

Tracking: #176 and nottingham-cloud#963.
