// Deterministic Shorts lifecycle checks against a Vite server. All account APIs
// and the YouTube player are fake; this does not validate browser autoplay policy.
// BASE_URL=http://127.0.0.1:5180 node tools/verify-shorts-playback.mjs
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:5180';
const stamp = '2026-10-31T12:00:00Z';
const source = { id: 42, title: 'Test creator', kind: 'youtube', weight: 1, state: 'active', feed_url: 'https://example.test/feed', added_at: stamp };
const make = (n, media = 'short') => ({
    item: { id: 100 + n, source_id: source.id, url: `https://www.youtube.com/shorts/test${String(n).padStart(7, '0')}`, title: `Synthetic clip ${n}`, summary: 'Notes for the synthetic clip.', content: '', content_source: 'rss', author: source.title, thumbnail_url: '', media_type: media, duration_sec: media === 'long' ? 1200 : 45, aspect_ratio: media === 'long' ? 16 / 9 : 9 / 16, published_at: stamp, fetched_at: stamp },
    source_title: source.title, topic: { name: 'Comedy', section_name: 'Shorts', slug: 'comedy' }, score: 1, est_duration_sec: 45, reason: '', breakdown: {},
});

function installFakeYT({ mode, held, blocked }) {
    const clock = Date.now.bind(Date);
    const state = window.__yt = { players: [], log: [], holdReady: held, blockPlay: blocked, clockOffset: 0, hidden: false };
    if (mode) localStorage.setItem('otium:shorts-mode:1', mode);
    Date.now = () => clock() + state.clockOffset;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => state.hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state.hidden ? 'hidden' : 'visible' });
    state.visibility = hidden => {
        state.hidden = hidden;
        document.dispatchEvent(new Event('visibilitychange'));
    };
    class Player {
        constructor(node, options) {
            this.options = options;
            this.videoId = options.videoId;
            this.state = -1;
            this.position = 0;
            this.startedAt = 0;
            this.muted = false;
            this.destroyed = false;
            this.iframe = document.createElement('iframe');
            this.iframe.title = 'Synthetic YouTube player';
            this.iframe.className = node.className;
            this.iframe.dataset.video = this.videoId;
            this.iframe.src = `${options.host}/embed/${this.videoId}`;
            this.iframe.style.cssText = 'width:100%;height:100%;border:0';
            node.replaceWith(this.iframe);
            state.players.push(this);
            state.log.push({ action: 'create', id: this.videoId });
            if (!state.holdReady) setTimeout(() => this.ready(), 0);
        }
        ready() { this.options.events.onReady?.({ target: this }); }
        emit(next) {
            if (this.state === 1) this.position = this.getCurrentTime();
            this.state = next;
            this.startedAt = Date.now();
            state.log.push({ action: 'state', id: this.videoId, state: next });
            this.options.events.onStateChange?.({ target: this, data: next });
        }
        playVideo() {
            state.log.push({ action: 'play', id: this.videoId, muted: this.muted, destroyed: this.destroyed });
            if (state.blockPlay) this.options.events.onAutoplayBlocked?.({ target: this });
            else this.emit(1);
        }
        pauseVideo() { if (this.state !== 2) this.emit(2); }
        mute() { this.muted = true; }
        unMute() { this.muted = false; }
        isMuted() { return this.muted; }
        getIframe() { return this.iframe; }
        getCurrentTime() { return this.position + (this.state === 1 ? (Date.now() - this.startedAt) / 1000 : 0); }
        getPlayerState() { return this.state; }
        seekTo(position) { this.position = position; this.startedAt = Date.now(); }
        destroy() { this.destroyed = true; this.state = 2; this.iframe.remove(); state.log.push({ action: 'destroy', id: this.videoId }); }
        error() { this.options.events.onError?.({ target: this, data: 150 }); }
    }
    window.YT = { Player, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
}

for (const [name, engine] of Object.entries({ chromium, webkit }).filter(([name]) => (process.env.BROWSERS || 'chromium,webkit').split(',').includes(name))) {
    const browser = await engine.launch({ headless: true });
    try {
        async function scenario(label, run, options = {}) {
            if (process.env.SCENARIO && !label.includes(process.env.SCENARIO)) return;
            const context = await browser.newContext({ viewport: { width: 390, height: 664 }, hasTouch: true });
            const page = await context.newPage();
            page.setDefaultTimeout(10000);
            const errors = [], unexpected = [];
            const state = { cursor: 0, events: [], reads: [], dwells: [], ended: false };
            const items = options.items || Array.from({ length: 10 }, (_, i) => make(i + 1));
            await page.addInitScript(installFakeYT, { mode: options.mode, held: !!options.held, blocked: !!options.blocked });
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/api/v1/**', route => {
                const request = route.request(), path = new URL(request.url()).pathname.replace('/api/v1', ''), method = request.method();
                const json = body => route.fulfill({ json: body });
                if (method === 'GET') {
                    if (path === '/users/me') return json({ id: 1, username: 'shorts-test', name: 'Shorts test' });
                    if (path === '/preferences') return json({});
                    if (path === '/settings') return json({ fast_scroll_checkin: true, youtube_history: false });
                    if (path === '/sources') return json([source]);
                    if (path === '/collections') return json([]);
                    if (path === '/sessions/current') return json({ session_id: 'shorts-test', cursor: state.cursor, duration_min: 40, themes: ['Shorts'], items });
                    if (/^\/items\/\d+\/content$/.test(path)) return json({ render: 'external', content: '', content_source: 'rss' });
                }
                if (method === 'PATCH' && path === '/sessions/shorts-test') {
                    const patch = request.postDataJSON();
                    state.cursor = patch.cursor ?? state.cursor;
                    state.ended = patch.status === 'ended' || state.ended;
                    return json({ ok: true });
                }
                const event = path.match(/^\/items\/(\d+)\/(event|read|dwell)$/);
                if (method === 'POST' && event) {
                    state[{ event: 'events', read: 'reads', dwell: 'dwells' }[event[2]]].push({ itemId: Number(event[1]), ...request.postDataJSON() });
                    return json({ ok: true });
                }
                unexpected.push(`${method} ${path}`);
                return route.fulfill({ status: 500, json: { message: 'Unexpected test API' } });
            });
            // No test accidentally loads a real player or sends account data.
            await page.route(/^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|i\.ytimg\.com)\//, route => new URL(route.request().url()).pathname.startsWith('/embed/')
                ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic video</title>' })
                : route.abort());
            const waitPlaying = playing => page.waitForFunction(expected => {
                const live = window.__yt.players.filter(p => !p.destroyed);
                return live.length === 1 && (live[0].state === 1) === expected;
            }, playing);
            const advance = async index => {
                await page.getByRole('button', { name: 'Next', exact: true }).click();
                await page.waitForFunction(i => document.querySelector('.afterglow-card:not(.away)')?.dataset.idx === String(i), index);
                await page.waitForFunction(videoId => window.__yt.players.some(p => !p.destroyed && p.videoId === videoId), new URL(items[index].item.url).pathname.split('/').at(-1));
            };
            const menu = () => page.getByRole('button', { name: 'Article and session actions', exact: true }).click();
            const close = async () => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog[open]')); };
            const setMode = async enabled => {
                await menu();
                const toggle = page.getByRole('switch', { name: 'Shorts viewing mode', exact: true });
                if ((await toggle.getAttribute('aria-checked') === 'true') !== enabled) await toggle.click();
                await close();
            };
            const count = type => state.events.filter(e => e.type === type).length;
            try {
                await page.goto(`${base}/session/shorts-test`);
                await page.locator('.afterglow-card:not(.away)').waitFor();
                await page.waitForFunction(() => window.__yt.players.some(p => !p.destroyed));
                await page.waitForTimeout(350);
                await run({ page, state, waitPlaying, advance, menu, close, setMode, count });
                assert.deepEqual(errors, [], `${name}: ${label}: no page errors`);
                assert.deepEqual(unexpected, [], `${name}: ${label}: only mocked APIs`);
                console.log(`${name}: ${label} PASS`);
            } catch (error) {
                console.error(`${name}: ${label}`, JSON.stringify({ errors, unexpected, events: state.events, reads: state.reads, player: await page.evaluate(() => ({ log: window.__yt.log, focused: document.querySelector('.afterglow-card:not(.away)')?.dataset.idx, stage: document.querySelector('.stage')?.scrollTop, cards: [...document.querySelectorAll('.snap')].map(e => ({ index: e.dataset.idx, top: e.offsetTop, height: e.clientHeight })) })), text: await page.locator('body').innerText() }, null, 2));
                throw error;
            } finally { await context.close(); }
        }

        await scenario('autoplay, explicit intent, pause timing, visibility, dialogs and controls', async ({ page, state, waitPlaying, menu, close, setMode, count }) => {
            await waitPlaying(true);
            assert.equal(count('open'), 0, 'autoplay is not an explicit open');
            assert.equal(await page.evaluate(() => window.__yt.players.at(-1).muted), true, 'default autoplay is muted');
            await page.evaluate(() => { window.__yt.clockOffset += 5000; });
            await page.getByRole('button', { name: 'Pause', exact: true }).click();
            await waitPlaying(false);
            await page.waitForFunction(() => window.__yt.players.at(-1).state === 2);
            await page.waitForTimeout(50);
            const first = state.reads.reduce((sum, r) => sum + r.ms, 0);
            assert.ok(first >= 5000 && first < 6500, `active time ${first}`);
            await page.evaluate(() => { window.__yt.clockOffset += 10000; });
            await menu(); await close();
            await waitPlaying(false);
            assert.equal(count('open'), 0, 'pause and menus are not opens');
            await page.getByRole('button', { name: 'Play', exact: true }).click();
            await waitPlaying(true);
            await page.waitForTimeout(50);
            assert.equal(count('open'), 1, 'manual resume after autoplay counts once');
            await page.evaluate(() => { window.__yt.clockOffset += 2000; window.__yt.players.at(-1).emit(3); });
            await waitPlaying(false); await page.waitForTimeout(50);
            const buffered = state.reads.reduce((sum, r) => sum + r.ms, 0);
            assert.ok(buffered - first >= 2000 && buffered - first < 3000, 'paused time is excluded');
            await page.evaluate(() => { window.__yt.clockOffset += 10000; window.__yt.players.at(-1).emit(1); });
            await waitPlaying(true);
            await page.getByRole('button', { name: 'Turn sound on', exact: true }).click();
            assert.equal(count('open'), 1, 'sound and replay do not duplicate opens');
            await page.evaluate(() => window.__yt.visibility(true));
            await waitPlaying(false);
            await page.evaluate(() => window.__yt.visibility(false));
            await waitPlaying(true);
            await menu(); await waitPlaying(false);
            await close(); await waitPlaying(true);
            await page.evaluate(() => { const dialog = document.createElement('dialog'); dialog.id = 'external-dialog'; document.body.append(dialog); dialog.showModal(); });
            await waitPlaying(false);
            await page.evaluate(() => document.getElementById('external-dialog').remove());
            await waitPlaying(true);
            await page.evaluate(() => window.__yt.players.at(-1).seekTo(17, true));
            await page.getByRole('button', { name: 'Use YouTube controls', exact: true }).click();
            await waitPlaying(true);
            assert.equal(await page.locator('.im-gesture').count(), 0, 'native controls own their gestures');
            assert.ok(await page.evaluate(() => window.__yt.players.at(-1).getCurrentTime() >= 17), 'rebuild retains position');
            assert.equal(await page.evaluate(() => window.__yt.players.filter(p => !p.destroyed).length), 1, 'one live player');
            await page.getByRole('button', { name: 'Use simple controls', exact: true }).click();
            await waitPlaying(true);
            await page.evaluate(() => window.__yt.players.at(-1).emit(0));
            await menu(); await close(); await waitPlaying(false);
            assert.equal(await page.locator('.afterglow-card:not(.away)').getAttribute('data-idx'), '0', 'ended video does not advance the queue');
            await setMode(false); await waitPlaying(false);
            await page.reload(); await waitPlaying(false);
            assert.equal(await page.locator('.shorts-card').count(), 0, 'mode choice survives reload');
        });

        await scenario('passive watches never manufacture opens, skips or fast-scroll nudges', async ({ page, state, waitPlaying, advance, menu, count }) => {
            await waitPlaying(true);
            for (let index = 1; index <= 8; index++) {
                await advance(index); await waitPlaying(true);
                assert.equal(await page.locator('dialog[open]').count(), 0, 'autoplayed clips do not trigger a check-in');
                assert.equal(await page.evaluate(() => window.__yt.players.filter(p => !p.destroyed).length), 1);
            }
            assert.equal(count('open'), 0);
            assert.equal(count('skip'), 0);
            assert.ok(state.dwells.length >= 8);
            assert.ok(state.dwells.every(d => d.engaged === false), 'dwell keeps passive playback separate from engagement');
            await menu(); await page.getByRole('button', { name: 'End session', exact: true }).click();
            await page.getByRole('heading', { name: 'Session complete', exact: true }).waitFor();
            assert.equal(await page.evaluate(() => window.__yt.players.filter(p => !p.destroyed).length), 0, 'end destroys the player');
            await page.getByRole('button', { name: 'Review session', exact: true }).first().click();
            const stats = await page.locator('.session-review-stats').innerText();
            assert.match(stats, /Videos played\s+9/);
            assert.match(stats, /Skips\s+0/);
        });

        await scenario('blocked autoplay, manual recovery and unavailable video', async ({ page, waitPlaying, advance, count }) => {
            await page.getByText('Tap the video to play', { exact: true }).waitFor();
            await waitPlaying(false);
            assert.equal(count('open'), 0);
            await page.evaluate(() => { window.__yt.blockPlay = false; });
            await page.getByRole('button', { name: 'Play', exact: true }).click();
            await waitPlaying(true); await page.waitForTimeout(50);
            assert.equal(count('open'), 1);
            await advance(1); await waitPlaying(true);
            await page.evaluate(() => window.__yt.players.at(-1).error());
            await page.getByText('Video unavailable here.', { exact: false }).waitFor();
            assert.equal(await page.getByRole('button', { name: 'Open original', exact: true }).count(), 1);
            assert.equal(count('open'), 1, 'error feedback does not open the original');
        }, { blocked: true });

        await scenario('review player can play above its own dialog and pauses for a nested picker', async ({ page, waitPlaying, menu, count }) => {
            await waitPlaying(true);
            await menu(); await page.getByRole('button', { name: 'End session', exact: true }).click();
            await page.getByRole('heading', { name: 'Session complete', exact: true }).waitFor();
            await page.getByRole('button', { name: 'Review session', exact: true }).first().click();
            const before = await page.locator('.session-review-stats').innerText();
            await page.locator('.session-review-open').first().click();
            await page.locator('.reader-player').waitFor();
            await waitPlaying(false);
            await page.getByRole('button', { name: 'Play', exact: true }).click();
            await waitPlaying(true);
            await page.locator('.reader-player').getByRole('button', { name: 'Save', exact: true }).click();
            await page.getByRole('dialog', { name: 'Save to', exact: true }).waitFor();
            await waitPlaying(false);
            await page.keyboard.press('Escape');
            await page.getByRole('dialog', { name: 'Save to', exact: true }).waitFor({ state: 'detached' });
            await page.getByRole('button', { name: 'Play', exact: true }).click();
            await waitPlaying(true);
            await page.getByRole('button', { name: 'Back', exact: true }).click();
            await page.locator('.reader-player').waitFor({ state: 'detached' });
            assert.equal(await page.locator('.session-review-stats').innerText(), before, 'review playback leaves the completed snapshot frozen');
            assert.equal(count('open'), 0, 'review playback does not emit session engagement');
        });

        await scenario('late player callbacks cannot revive old or hidden cards', async ({ page, waitPlaying, advance, count }) => {
            assert.equal(await page.evaluate(() => window.__yt.log.filter(e => e.action === 'play').length), 0);
            await advance(1);
            await page.evaluate(() => { const old = window.__yt.players[0]; old.ready(); old.emit(1); });
            assert.equal(count('open'), 0);
            assert.equal(await page.evaluate(() => window.__yt.log.filter(e => e.action === 'play').length), 0, 'destroyed ready callback never plays');
            await page.evaluate(() => { window.__yt.visibility(true); window.__yt.players.at(-1).ready(); });
            await waitPlaying(false);
            assert.equal(await page.evaluate(() => window.__yt.log.filter(e => e.action === 'play').length), 0, 'hidden ready callback waits');
            await page.evaluate(() => window.__yt.visibility(false));
            await waitPlaying(true);
            assert.equal(count('open'), 0);
            await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
            await waitPlaying(false);
            assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('otium:session:1')).played), [102], 'stale callbacks do not count old video playback');
        }, { held: true });

        await scenario('only Shorts autoplay and mode-off keeps manual playback', async ({ page, waitPlaying, advance, setMode, count }) => {
            await waitPlaying(false);
            assert.equal(await page.locator('.afterglow-card:not(.away).shorts-card').count(), 0, 'long video keeps full card');
            await advance(1); await waitPlaying(true);
            await setMode(false); await waitPlaying(false);
            await page.getByRole('button', { name: 'Play', exact: true }).click();
            await waitPlaying(true); await page.waitForTimeout(50);
            assert.equal(count('open'), 1);
            assert.equal(await page.evaluate(() => window.__yt.players.at(-1).muted), false, 'ordinary manual playback retains its sound');
            await advance(2); await waitPlaying(false);
            assert.equal(count('skip'), 1, 'only the untouched long video was skipped');
        }, { items: [make(1, 'long'), make(2), make(3, 'long')] });

        await scenario('autoplay provenance survives reload and turning mode off', async ({ page, waitPlaying, setMode, advance, count }) => {
            await waitPlaying(true);
            await setMode(false); await waitPlaying(false);
            await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
            await page.reload(); await waitPlaying(false);
            await page.waitForTimeout(350); // Let the existing resume-scroll reassertion finish.
            await advance(1); await waitPlaying(false);
            assert.equal(count('open'), 0);
            assert.equal(count('skip'), 0, 'reloaded passive watch is not a rejection');
        });
    } finally { await browser.close(); }
}
