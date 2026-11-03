# Faster app start and session build

Fisher: starting the app, then picking a mix and starting a session, took seconds each
(#204). Measured on a copy of production data, then traced in a headless phone browser
from page load to the first card.

**Every request waited on the disk.** The auth path upserted the user on every API
call - an `INSERT ... ON CONFLICT DO UPDATE`, so a write transaction and a WAL sync per
request - and with one SQLite connection those queued behind each other. A request that
touches nothing (`/share/status`) took ~200 ms; the home screen's six parallel requests
took up to 650 ms each. The user is now read first and written only when new or when
the email changed, and SQLite runs `synchronous=NORMAL`, the setting SQLite recommends
under WAL (no corruption risk; a power cut can drop only the last commits). Simple
requests now take under a millisecond server-side.

**The source list** computed each source's skip rate with a subquery that re-walked the
user's item_state per source: 0.7 s of a 1.2 s request with 310 sources. It is aggregated
once and joined now; the JSON is byte-identical to before. 1.17 s -> 0.08 s.

**Session build** read 20,000 candidate rows, most of them long past their archive
window. The pool query now drops items more than a day past their resolved Archive-After
window (source > topic > global), keeping everything for evergreen and keep-latest-N
sources so their recency ranks are unchanged. Checked on the production copy: no
eligible item is lost, and 127 eligible items that the old 20,000-row cap had silently cut
are now included. Candidate building 0.92 s -> 0.44 s.

**Production specifics:** the page cache is 128 MiB (was SQLite's 2 MiB default), since
every miss is an NFS read and the file is ~80 MB; and the pod's CPU limit went from 0.5 to
2 cores in nottingham-cloud, because modernc SQLite is CPU-bound and the half-core cap
doubled every query's wall time.

**Client:** concurrent `/sessions/current` calls on load share one request, and the
preset sync no longer re-uploads an unchanged list.

Locally, home presets visible 2.07 s -> 0.26 s after load; tap to first card 1.41 s -> 0.89 s.
