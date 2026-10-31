// Deterministic Shorts lifecycle checks against a Vite server. All account APIs
// and the YouTube player are fake; this does not validate browser autoplay policy.
// BASE_URL=http://127.0.0.1:5180 node tools/verify-shorts-playback.mjs
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const target = new URL(process.env.BASE_URL || 'http://127.0.0.1:5180');
assert.ok(['http:', 'https:'].includes(target.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    && !target.username && !target.password && target.pathname === '/' && !target.search && !target.hash,
    'Playback fixtures require a localhost BASE_URL; production and remote targets are forbidden');
const base = target.origin;
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const stamp = '2026-10-31T12:00:00Z';
const source = { id: 42, title: 'Test creator', kind: 'youtube', weight: 1, state: 'active', feed_url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCsynthetic0000000000000', added_at: stamp };
const make = (n, media = 'short') => ({
    item: { id: 100 + n, source_id: source.id, url: `https://www.youtube.com/shorts/test${String(n).padStart(7, '0')}`, title: `Synthetic clip ${n}`, summary: 'Notes for the synthetic clip.', content: '', content_source: 'rss', author: source.title, thumbnail_url: '', media_type: media, duration_sec: media === 'long' ? 1200 : 45, aspect_ratio: media === 'long' ? 16 / 9 : 9 / 16, published_at: stamp, fetched_at: stamp },
    source_title: source.title, topic: { name: 'Comedy', section_name: 'Shorts', slug: 'comedy' }, score: 1, est_duration_sec: 45, reason: '', breakdown: {},
});

function installFakeYT({ mode, held, blocked }) {
    const clock = Date.now.bind(Date);
    const state = window.__yt = { players: [], log: [], holdReady: held, holdLoads: false, blockPlay: blocked, clockOffset: 0, hidden: false };
    state.current = () => state.players.findLast(p => !p.destroyed && p.iframe.isConnected && !p.iframe.closest('[inert]') && getComputedStyle(p.iframe).visibility !== 'hidden');
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
            this.reportedVideoId = null;
            this.captionAvailable = true;
            this.captionTrack = { languageCode: 'en' };
            this.captionModules = new Set(options.playerVars?.cc_load_policy === 1 ? ['captions'] : []);
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
            if (state.blockPlay === true || (state.blockPlay === 'audible' && !this.muted)) this.options.events.onAutoplayBlocked?.({ target: this });
            else this.emit(1);
        }
        changeVideo(value, autoPlay) {
            this.videoId = typeof value === 'string' ? value : value.videoId;
            this.iframe.dataset.video = this.videoId;
            this.position = typeof value === 'object' ? value.startSeconds || 0 : 0;
            this.state = -1;
            state.log.push({ action: autoPlay ? 'load' : 'cue', id: this.videoId });
            this.captionModules.clear();
            this.options.events.onApiChange?.({ target: this });
            if (state.holdLoads) return;
            if (autoPlay) this.playVideo(); else this.emit(5);
        }
        loadVideoById(value) { this.changeVideo(value, true); }
        cueVideoById(value) { this.changeVideo(value, false); }
        getVideoData() { return { video_id: this.reportedVideoId || this.videoId }; }
        getVideoUrl() { return `https://www.youtube.com/watch?v=${this.getVideoData().video_id}`; }
        stale(next, videoId) {
            this.reportedVideoId = videoId;
            this.options.events.onStateChange?.({ target: this, data: next });
            this.reportedVideoId = null;
        }
        staleError(videoId) {
            this.reportedVideoId = videoId;
            this.options.events.onError?.({ target: this, data: 150 });
            this.reportedVideoId = null;
        }
        loadModule(module) {
            if (module !== 'captions' || !this.captionAvailable) return;
            const changed = !this.captionModules.has(module);
            this.captionModules.add(module);
            state.log.push({ action: 'load-module', id: this.videoId, module });
            if (changed) queueMicrotask(() => this.apiChange());
        }
        unloadModule(module) {
            const changed = this.captionModules.delete(module);
            state.log.push({ action: 'unload-module', id: this.videoId, module });
            if (changed) queueMicrotask(() => this.apiChange());
        }
        getOptions(module) { return module === 'captions' ? ['track', 'fontSize', 'reload'] : [...this.captionModules]; }
        getOption(module, option) { return module === 'captions' && option === 'track' ? this.captionTrack : undefined; }
        setOption(module, option, value) {
            if (module === 'captions' && option === 'track') this.captionTrack = value;
            state.log.push({ action: 'option', id: this.videoId, module, option, value });
        }
        apiChange() { this.options.events.onApiChange?.({ target: this }); }
        pauseVideo() { if (this.state !== -1 && this.state !== 5 && this.state !== 2) this.emit(2); }
        mute() { this.muted = true; }
        unMute() { this.muted = false; }
        isMuted() { return this.muted; }
        getIframe() { return this.iframe; }
        getCurrentTime() { return this.position + (this.state === 1 ? (Date.now() - this.startedAt) / 1000 : 0); }
        getPlayerState() { return this.state; }
        seekTo(position) {
            this.position = position;
            this.startedAt = Date.now();
            if (this.state === -1 || this.state === 5) this.playVideo();
        }
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
            const context = await browser.newContext({ viewport: { width: 390, height: 664 }, hasTouch: true, serviceWorkers: 'block' });
            const page = await context.newPage();
            page.setDefaultTimeout(10000);
            const errors = [], unexpected = [];
            const state = { accountId: 1, sessionId: 'shorts-test', cursor: 0, events: [], reads: [], dwells: [], ended: false };
            const items = options.items || Array.from({ length: 10 }, (_, i) => make(i + 1));
            await page.addInitScript(installFakeYT, { mode: options.mode, held: !!options.held, blocked: !!options.blocked });
            // #184: full-screen Shorts default on; the card-view scenarios opt out.
            await page.addInitScript(on => { for (const id of [1, 2]) localStorage.setItem(`otium:shorts-immersive:${id}`, on ? 'on' : 'off'); }, !!options.immersive);
            page.on('pageerror', error => errors.push(error.message));
            await context.route('**/*', route => {
                const request = route.request(), url = new URL(request.url());
                if (url.origin === base && request.method() === 'GET' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/auth/')) return route.continue();
                unexpected.push(`Blocked passthrough: ${request.method()} ${url.origin}${url.pathname}`);
                return route.abort();
            });
            await page.route('**/api/v1/**', route => {
                const request = route.request(), path = new URL(request.url()).pathname.replace('/api/v1', ''), method = request.method();
                const json = body => route.fulfill({ json: body });
                if (method === 'GET') {
                    if (path === '/users/me') return json({ id: state.accountId, username: 'shorts-test', name: 'Shorts test' });
                    if (path === '/preferences') return json({});
                    if (path === '/settings') return json({ fast_scroll_checkin: true, youtube_history: false });
                    if (path === '/sources') return json([source]);
                    if (path === '/collections') return json([]);
                    if (path === '/sessions/current') return json({ session_id: state.sessionId, cursor: state.cursor, duration_min: 40, themes: ['Shorts'], items });
                    if (/^\/items\/\d+\/video$/.test(path)) { state.videoFetches = (state.videoFetches || 0) + 1; return route.fulfill({ contentType: 'video/mp4', body: Buffer.alloc(2048) }); }
                    if (/^\/items\/\d+\/content$/.test(path)) return json({ render: 'external', content: '', content_source: 'rss' });
                }
                if (method === 'PATCH' && path === `/sessions/${state.sessionId}`) {
                    const patch = request.postDataJSON();
                    state.cursor = patch.cursor ?? state.cursor;
                    state.ended = patch.status === 'ended' || state.ended;
                    return json({ ok: true });
                }
                if (method === 'POST' && path === '/client-metrics') return route.fulfill({ status: 204, body: '' });
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
                const player = window.__yt.current();
                return !!player && (player.state === 1) === expected;
            }, playing);
            const advance = async (index, loaded = true) => {
                await page.getByRole('button', { name: 'Next', exact: true }).click();
                await page.waitForFunction(i => document.querySelector('.afterglow-card:not(.away)')?.dataset.idx === String(i), index);
                // #182: the shared player moves to a Shorts card once the scroll settles.
                await page.waitForFunction(i => !document.querySelector('.session-shorts-player[data-active="true"]') || document.querySelector('[data-player]')?.dataset.idx === String(i), index);
                if (loaded) await page.waitForFunction(videoId => window.__yt.current()?.videoId === videoId, new URL(items[index].item.url).pathname.split('/').at(-1));
            };
            const menu = () => page.getByRole('button', { name: 'Article and session actions', exact: true }).click();
            const native = async name => { await menu(); await page.locator('dialog[open]').getByRole('button', { name, exact: true }).click(); await page.waitForFunction(() => !document.querySelector('dialog[open]')); };
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
                await run({ page, state, waitPlaying, advance, menu, close, setMode, count, native });
                assert.ok(await page.evaluate(() => window.__yt.players.filter(p => !p.destroyed && p.state === 1).length <= 1), 'no hidden standby playback');
                assert.deepEqual(errors, [], `${name}: ${label}: no page errors`);
                assert.deepEqual(unexpected, [], `${name}: ${label}: only mocked APIs`);
                console.log(`${name}: ${label} PASS`);
            } catch (error) {
                console.error(`${name}: ${label}`, JSON.stringify({ errors, unexpected, events: state.events, reads: state.reads, player: await page.evaluate(() => ({ log: window.__yt.log, focused: document.querySelector('.afterglow-card:not(.away)')?.dataset.idx, stage: document.querySelector('.stage')?.scrollTop, cards: [...document.querySelectorAll('.snap')].map(e => ({ index: e.dataset.idx, top: e.offsetTop, height: e.clientHeight })) })), text: await page.locator('body').innerText() }, null, 2));
                throw error;
            } finally { await context.close(); }
        }

        await scenario('autoplay, explicit intent, pause timing, visibility, dialogs and controls', async ({ page, state, waitPlaying, menu, close, setMode, count, native }) => {
            await waitPlaying(true);
            assert.equal(count('open'), 0, 'autoplay is not an explicit open');
            assert.equal(await page.evaluate(() => window.__yt.current().muted), true, 'default autoplay is muted');
            await page.evaluate(() => { window.__yt.clockOffset += 5000; });
            await page.getByRole('button', { name: 'Pause', exact: true }).click();
            await waitPlaying(false);
            await page.waitForFunction(() => window.__yt.current().state === 2);
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
            await page.evaluate(() => { window.__yt.clockOffset += 2000; window.__yt.current().emit(3); });
            await waitPlaying(false); await page.waitForTimeout(50);
            const buffered = state.reads.reduce((sum, r) => sum + r.ms, 0);
            assert.ok(buffered - first >= 2000 && buffered - first < 3000, 'paused time is excluded');
            await page.evaluate(() => { window.__yt.clockOffset += 10000; window.__yt.current().emit(1); });
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
            await page.evaluate(() => window.__yt.current().seekTo(17, true));
            await native('Use YouTube controls');
            await waitPlaying(true);
            assert.equal(await page.locator('.im-gesture').count(), 0, 'native controls own their gestures');
            assert.ok(await page.evaluate(() => window.__yt.current().getCurrentTime() >= 17), 'rebuild retains position');
            assert.equal(await page.evaluate(() => window.__yt.players.filter(p => !p.destroyed).length), 1, 'one live player');
            await native('Use simple controls');
            await waitPlaying(true);
            await page.evaluate(() => window.__yt.current().emit(0));
            await menu(); await close(); await waitPlaying(false);
            assert.equal(await page.locator('.afterglow-card:not(.away)').getAttribute('data-idx'), '0', 'ended video does not advance the queue');
            await setMode(false); await waitPlaying(false);
            await page.reload(); await waitPlaying(false);
            assert.equal(await page.locator('.shorts-card').count(), 0, 'mode choice survives reload');
        });

        await scenario('passive watches never manufacture opens, skips or fast-scroll nudges', async ({ page, state, waitPlaying, advance, menu, count, native }) => {
            await waitPlaying(true);
            await page.evaluate(() => { window.__originalFrame = window.__yt.current().iframe; });
            for (let index = 1; index <= 8; index++) {
                await advance(index); await waitPlaying(true);
                assert.equal(await page.locator('dialog[open]').count(), 0, 'autoplayed clips do not trigger a check-in');
                assert.equal(await page.evaluate(() => window.__yt.players.filter(p => !p.destroyed).length), 1);
                assert.equal(await page.evaluate(() => window.__yt.current().iframe === window.__originalFrame), true, 'clip navigation keeps the same iframe connected');
            }
            assert.equal(await page.evaluate(() => window.__yt.log.filter(e => e.action === 'create').length), 1, 'one player construction across nine clips');
            assert.equal(count('open'), 0);
            assert.equal(count('skip'), 0);
            assert.ok(state.dwells.length >= 8);
            assert.ok(state.dwells.every(d => d.engaged === false), 'dwell keeps passive playback separate from engagement');
            await menu(); await page.getByRole('button', { name: 'End session', exact: true }).click();
            await page.getByRole('heading', { name: 'Session complete', exact: true }).waitFor();
            assert.equal(await page.evaluate(() => window.__yt.players.filter(p => !p.destroyed && p.state === 1).length), 0, 'ending leaves no player running');
            await page.getByRole('button', { name: 'Review session', exact: true }).first().click();
            const stats = await page.locator('.session-review-stats').innerText();
            assert.match(stats, /Videos played\s+9/);
            assert.match(stats, /Skips\s+0/);
        });

        await scenario('blocked autoplay, manual recovery and unavailable video', async ({ page, waitPlaying, advance, count, native }) => {
            await page.getByText('Tap the video to play', { exact: true }).waitFor();
            await waitPlaying(false);
            assert.equal(count('open'), 0);
            await page.evaluate(() => { window.__yt.blockPlay = false; });
            await page.getByRole('button', { name: 'Play', exact: true }).click();
            await waitPlaying(true); await page.waitForTimeout(50);
            assert.equal(count('open'), 1);
            await advance(1); await waitPlaying(true);
            await page.evaluate(() => window.__yt.current().error());
            await page.getByText('Video unavailable here.', { exact: false }).waitFor();
            assert.equal(await page.getByRole('button', { name: 'Open original', exact: true }).count(), 1);
            assert.equal(count('open'), 1, 'error feedback does not open the original');
        }, { blocked: true });

        await scenario('review player can play above its own dialog and pauses for a nested picker', async ({ page, waitPlaying, menu, count, native }) => {
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

        await scenario('late player callbacks cannot revive old or hidden cards', async ({ page, waitPlaying, advance, count, native }) => {
            assert.equal(await page.evaluate(() => window.__yt.log.filter(e => e.action === 'play').length), 0);
            await advance(1, false);
            await page.evaluate(() => { window.__yt.visibility(true); window.__yt.current().ready(); });
            await waitPlaying(false);
            assert.equal(await page.evaluate(() => window.__yt.log.filter(e => e.action === 'play').length), 0, 'hidden ready callback waits');
            assert.equal(await page.evaluate(() => window.__yt.current().videoId), 'test0000002', 'late ready selects the current card rather than the construction-time card');
            await page.evaluate(() => window.__yt.visibility(false));
            await waitPlaying(true);
            await page.evaluate(() => { window.__yt.current().stale(2, 'test0000001'); window.__yt.current().stale(1, 'test0000001'); window.__yt.current().staleError('test0000001'); window.__yt.clockOffset += 2000; });
            await waitPlaying(true);
            assert.equal(await page.getByText('Video unavailable here.', { exact: false }).count(), 0, 'old video errors do not replace the current player');
            assert.equal(count('open'), 0);
            await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
            await waitPlaying(false);
            assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('otium:session:1')).played), [102], 'stale callbacks do not count old video playback');
        }, { held: true });

        await scenario('only Shorts autoplay and mode-off keeps manual playback', async ({ page, waitPlaying, advance, setMode, count, native }) => {
            await waitPlaying(false);
            assert.equal(await page.locator('.afterglow-card:not(.away).shorts-card').count(), 0, 'long video keeps full card');
            await advance(1); await waitPlaying(true);
            await page.evaluate(() => { window.__originalFrame = window.__yt.current().iframe; window.__yt.current().seekTo(17); });
            await page.getByRole('button', { name: 'Captions', exact: true }).click();
            await setMode(false); await waitPlaying(false);
            const offPosition = await page.evaluate(() => window.__yt.current().getCurrentTime());
            assert.ok(offPosition >= 17 && offPosition < 19, `mode off retains the current playhead: ${offPosition}`);
            assert.equal(count('open'), 0, 'restoring the ordinary player does not manufacture an open');
            await page.getByRole('button', { name: 'Play', exact: true }).click();
            await waitPlaying(true); await page.waitForTimeout(50);
            await page.evaluate(() => window.__yt.current().seekTo(33));
            assert.equal(count('open'), 1);
            assert.equal(await page.evaluate(() => window.__yt.current().muted), false, 'ordinary manual playback retains its sound');
            await setMode(true); await waitPlaying(true);
            const onPosition = await page.evaluate(() => window.__yt.current().getCurrentTime());
            assert.ok(onPosition >= 33 && onPosition < 35, `mode on retains the ordinary player playhead: ${onPosition}`);
            assert.equal(await page.evaluate(() => window.__yt.current().iframe === window.__originalFrame), true, 'mode on returns to the same persistent iframe');
            await advance(2); await waitPlaying(false);
            assert.equal(count('skip'), 1, 'only the untouched long video was skipped');
            assert.equal(await page.evaluate(() => window.__yt.players.filter(p => !p.destroyed && p.state === 1).length), 0, 'retained Shorts iframe cannot play behind a long-video card');
            await advance(3); await waitPlaying(true);
            assert.equal(await page.evaluate(() => window.__yt.current().iframe === window.__originalFrame), true, 'returning from a long video reuses the retained Shorts iframe');
            assert.ok(await page.evaluate(() => window.__yt.current().getCurrentTime() < 2), 'a different clip does not inherit the previous playhead');
            assert.equal(await page.getByRole('button', { name: 'Captions', exact: true }).getAttribute('aria-pressed'), 'false');
            assert.equal(await page.evaluate(() => window.__yt.current().captionModules.has('captions')), false, 'captions choice survives mixed content and mode changes');
            assert.equal(count('skip'), 2, 'both untouched long videos remain ordinary skips');
        }, { items: [make(1, 'long'), make(2), make(3, 'long'), make(4)] });

        await scenario('autoplay provenance survives reload and turning mode off', async ({ page, waitPlaying, setMode, advance, count, native }) => {
            await waitPlaying(true);
            await setMode(false); await waitPlaying(false);
            await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
            await page.reload(); await waitPlaying(false);
            await page.waitForTimeout(350); // Let the existing resume-scroll reassertion finish.
            await advance(1); await waitPlaying(false);
            assert.equal(count('open'), 0);
            assert.equal(count('skip'), 0, 'reloaded passive watch is not a rejection');
        });

        await scenario('toolbar stays outside video and sound/captions survive navigation and reload', async ({ page, state, waitPlaying, advance, count, native }) => {
            await waitPlaying(true);
            assert.equal(await page.getByRole('button', { name: 'Captions', exact: true }).getAttribute('aria-pressed'), 'true');
            assert.equal(await page.evaluate(() => window.__yt.current().captionModules.has('captions')), true, 'captions requested by default');
            for (const width of [320, 390]) {
                await page.setViewportSize({ width, height: 664 });
                await page.waitForTimeout(100);
                const geometry = await page.evaluate(() => {
                    const frame = document.querySelector('.session-shorts-player[data-active="true"] .im-frame').getBoundingClientRect();
                    return [...document.querySelectorAll('.afterglow-card:not(.away) .shorts-quiet button')].map(button => {
                        const rect = button.getBoundingClientRect();
                        return { name: button.getAttribute('aria-label'), below: rect.top >= frame.bottom - 1, left: rect.left, right: rect.right, height: rect.height };
                    });
                });
                assert.equal(geometry.length, 2, 'sound and captions only; player controls live in Actions');
                for (const control of geometry) {
                    assert.ok(control.below, `${width}px ${control.name} does not cover video pixels`);
                    assert.ok(control.left >= -1 && control.right <= width + 1, `${width}px ${control.name} fits the viewport`);
                    assert.ok(control.height >= 44, `${width}px ${control.name} keeps a 44px target`);
                }
            }
            await page.getByRole('button', { name: 'Turn sound on', exact: true }).click();
            await page.getByRole('button', { name: 'Captions', exact: true }).click();
            await page.waitForFunction(() => !window.__yt.current().muted && !window.__yt.current().captionModules.has('captions'));
            assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem('otium:playback:1'))), { sessionId: 'shorts-test', muted: false, captions: false });
            await page.evaluate(() => { window.__originalFrame = window.__yt.current().iframe; });
            await advance(1); await waitPlaying(true);
            assert.equal(await page.evaluate(() => window.__yt.current().iframe === window.__originalFrame), true);
            assert.equal(await page.evaluate(() => window.__yt.current().muted), false, 'sound remains on for next clip');
            assert.equal(await page.evaluate(() => window.__yt.current().captionModules.has('captions')), false, 'captions remain off for next clip');
            assert.equal(count('open'), 1, 'carried sound preference does not make later autoplay explicit');
            await page.waitForTimeout(350);
            await page.reload(); await waitPlaying(true);
            assert.equal(await page.evaluate(() => window.__yt.current().muted), false, 'same-session reload keeps sound');
            assert.equal(await page.getByRole('button', { name: 'Captions', exact: true }).getAttribute('aria-pressed'), 'false');
            assert.equal(await page.evaluate(() => window.__yt.current().captionModules.has('captions')), false);
            await native('Use YouTube controls');
            await waitPlaying(true);
            assert.equal(await page.evaluate(() => window.__yt.current().muted), false, 'native control rebuild keeps sound');
            assert.equal(await page.evaluate(() => window.__yt.current().captionModules.has('captions')), false, 'native control rebuild keeps captions');
            await native('Use simple controls');
            await waitPlaying(true);
            await page.getByRole('button', { name: 'Captions', exact: true }).click();
            await page.waitForFunction(() => window.__yt.current().captionModules.has('captions'));
            await page.evaluate(() => { const p = window.__yt.current(); p.captionAvailable = false; p.captionModules.clear(); p.apiChange(); });
            assert.equal(await page.getByRole('button', { name: 'Captions', exact: true }).getAttribute('aria-pressed'), 'true', 'missing module does not erase desired captions');
            await page.evaluate(() => { const p = window.__yt.current(); p.captionAvailable = true; p.apiChange(); });
            await page.waitForFunction(() => window.__yt.current().captionModules.has('captions'));
            await page.getByRole('button', { name: 'Captions', exact: true }).click();
            state.accountId = 2;
            await page.reload(); await waitPlaying(true);
            assert.equal(await page.evaluate(() => window.__yt.current().muted), true, 'another account starts muted');
            assert.equal(await page.getByRole('button', { name: 'Captions', exact: true }).getAttribute('aria-pressed'), 'true', 'another account starts with captions');
            state.accountId = 1;
            await page.reload(); await waitPlaying(true);
            assert.equal(await page.evaluate(() => window.__yt.current().muted), false, 'other account did not overwrite this account');
            assert.equal(await page.getByRole('button', { name: 'Captions', exact: true }).getAttribute('aria-pressed'), 'false');
            state.sessionId = 'another-shorts-test'; state.cursor = 0;
            await page.goto(`${base}/session/${state.sessionId}`); await waitPlaying(true);
            assert.equal(await page.evaluate(() => window.__yt.current().muted), true, 'new session starts muted');
            assert.equal(await page.getByRole('button', { name: 'Captions', exact: true }).getAttribute('aria-pressed'), 'true', 'new session starts with captions');
        });

        await scenario('blocked audible autoplay preserves the desired sound choice', async ({ page, waitPlaying, advance, count, native }) => {
            await waitPlaying(true);
            await page.getByRole('button', { name: 'Turn sound on', exact: true }).click();
            await page.waitForFunction(() => window.__yt.current().muted === false);
            await page.evaluate(() => { window.__yt.blockPlay = 'audible'; });
            await advance(1); await waitPlaying(true);
            assert.equal(await page.evaluate(() => window.__yt.current().muted), true, 'blocked clip falls back to muted playback');
            assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('otium:playback:1')).muted), false, 'fallback does not save a new sound preference');
            assert.equal(count('open'), 1, 'automatic fallback does not open another item');
            await page.evaluate(() => { window.__yt.blockPlay = false; });
            await advance(2); await waitPlaying(true);
            assert.equal(await page.evaluate(() => window.__yt.current().muted), false, 'following clip retries the desired audible playback');
            await page.getByRole('button', { name: 'Mute video', exact: true }).click();
            assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('otium:playback:1')).muted), true, 'deliberate mute updates the preference');
            await advance(3); await waitPlaying(true);
            assert.equal(await page.evaluate(() => window.__yt.current().muted), true, 'deliberate mute stays in effect');
        });

        await scenario('delayed old-video events cannot count a newly loaded clip', async ({ page, waitPlaying, advance, count, native }) => {
            await waitPlaying(true);
            await page.evaluate(() => { window.__yt.holdLoads = true; });
            await advance(1); await waitPlaying(false);
            await page.evaluate(() => { const p = window.__yt.current(); p.stale(1, 'test0000001'); p.stale(0, 'test0000001'); p.staleError('test0000001'); window.dispatchEvent(new Event('pagehide')); });
            assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('otium:session:1')).played), [101], 'old state events cannot mark the pending clip played');
            assert.equal(await page.getByText('Video unavailable here.', { exact: false }).count(), 0);
            assert.equal(count('open'), 0);
            await page.evaluate(() => { window.__yt.holdLoads = false; window.__yt.current().emit(1); });
            await waitPlaying(true);
            await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
            assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('otium:session:1')).played), [101, 102], 'only a matching current-video PLAYING event counts');
        });
        await scenario('actions and details are separate sheets; clip file shares; time readout', async ({ page, waitPlaying, menu, close, count, state, native }) => {
            await waitPlaying(true);
            await page.waitForFunction(() => /· 0:\d\d left$/.test(document.querySelector('.afterglow-card:not(.away) .shorts-age')?.textContent ?? ''));
            assert.equal(await page.locator('.session-shorts-player .im-progress').count(), 1, 'progress hairline');
            const shot = async label => { if (process.env.SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: `${process.env.SHOTS}/${name}-${page.viewportSize().width}-${label}.png` }); } };
            for (const width of process.env.SHOTS ? [320, 390] : []) {
                await page.setViewportSize({ width, height: 700 }); await shot('card');
                const row = await page.locator('.afterglow-card:not(.away) .shorts-card-footer').evaluate(el => ({ fits: el.scrollWidth <= el.clientWidth + 1, right: el.getBoundingClientRect().right }));
                assert.ok(row.fits && row.right <= width + 1, `${width}px footer fits`);
            }
            await menu();
            await shot('actions');
            const sheet = page.locator('dialog[open]');
            for (const name of ['Save or share video', 'Copy link', 'Open in YouTube', 'Details and why it\'s here', 'End session'])
                assert.equal(await sheet.getByRole('button', { name, exact: false }).count() > 0, true, `actions: ${name}`);
            assert.equal(await sheet.getByRole('link', { name: 'Download video' }).getAttribute('href'), '/api/v1/items/101/video?download=1');
            assert.equal(await sheet.getByRole('link', { name: 'Open channel on YouTube' }).getAttribute('href'), 'https://www.youtube.com/channel/UCsynthetic0000000000000');
            assert.equal(await sheet.getByRole('switch', { name: 'Shorts viewing mode' }).count(), 1, 'session controls live in actions');
            assert.equal(await sheet.getByText('Explore score').count(), 0, 'no provenance in actions');
            await page.evaluate(() => {
                Object.defineProperty(navigator, 'canShare', { configurable: true, value: data => Array.isArray(data?.files) });
                Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.__shared = data.files.map(f => [f.name, f.type, f.size]); } });
            });
            await sheet.getByRole('button', { name: 'Save or share video' }).click();
            await page.waitForFunction(() => window.__shared);
            assert.deepEqual(await page.evaluate(() => window.__shared), [['Synthetic clip 1.mp4', 'video/mp4', 2048]]);
            await sheet.getByRole('button', { name: 'Share video' }).click();
            assert.equal(state.videoFetches, 1, 'a second share reuses the fetched file');
            await sheet.getByRole('button', { name: /Details and why/ }).click();
            await page.waitForFunction(() => document.querySelector('dialog[open]')?.textContent.includes('Explore score'));
            const details = page.locator('dialog[open]');
            await shot('details');
            assert.equal(await details.getByText('Filter out of future sessions').count(), 1);
            assert.equal(await details.getByRole('button', { name: 'Save or share video' }).count(), 0, 'no actions in details');
            await close();
            await page.locator('.afterglow-card:not(.away) .shorts-details').click();
            await page.waitForFunction(() => document.querySelector('dialog[open]')?.textContent.includes('Explore score'));
            await close();
            await waitPlaying(true);
            assert.equal(count('open'), 0, 'sheets and sharing are not opens');
        });
        await scenario('full screen: clip fills the screen, chrome floats over it, aura instead of Play while loading', async ({ page, state, waitPlaying, advance, count }) => {
            await waitPlaying(true);
            const view = await page.evaluate(() => {
                const frame = document.querySelector('.session-shorts-player[data-active="true"] .im-frame').getBoundingClientRect();
                const footer = document.querySelector('.afterglow-card:not(.away) .shorts-card-footer').getBoundingClientRect();
                const pill = document.querySelector('.context-instrument').getBoundingClientRect();
                const header = document.querySelector('.topbar').getBoundingClientRect();
                return { frame: [frame.top, frame.left, frame.width, frame.height], footerBottom: footer.bottom, pillTop: pill.top, header: [header.top, header.bottom],
                    root: [document.documentElement.dataset.immersive, document.documentElement.dataset.overVideo], w: innerWidth, h: innerHeight };
            });
            assert.deepEqual(view.frame, [0, 0, view.w, view.h], 'the clip fills the viewport');
            assert.ok(view.footerBottom <= view.pillTop, 'creator line sits above the pill');
            assert.equal(view.header[0], 0, 'header floats over the clip');
            assert.deepEqual(view.root, ['on', 'on']);
            assert.equal(await page.locator('.session-shorts-player .im-aura').getAttribute('data-on'), 'false', 'no aura while playing');
            // A held load is "about to play": aura on, no Play glyph to tap.
            await page.evaluate(() => { window.__yt.holdLoads = true; });
            await advance(1, false);
            await page.waitForFunction(() => document.querySelector('.session-shorts-player .im-aura')?.dataset.on === 'true');
            assert.equal(await page.locator('.session-shorts-player .im-play').count(), 0, 'no Play button while it is about to play');
            assert.equal(await page.locator('.afterglow-card[data-idx="2"] .shorts-player-slot .im-aura').getAttribute('data-on'), 'true', 'incoming cards show the aura too');
            await page.evaluate(() => { window.__yt.holdLoads = false; window.__yt.current().emit(1); });
            await waitPlaying(true);
            await page.waitForFunction(() => document.querySelector('.session-shorts-player .im-aura')?.dataset.on === 'false');
            // Buffering mid-play is waiting too; a deliberate pause shows Play instead.
            await page.evaluate(() => window.__yt.current().emit(3));
            await page.waitForFunction(() => document.querySelector('.session-shorts-player .im-aura')?.dataset.on === 'true');
            await page.evaluate(() => window.__yt.current().emit(1));
            await waitPlaying(true);
            await page.getByRole('button', { name: 'Pause', exact: true }).click();
            await waitPlaying(false);
            assert.equal(await page.locator('.session-shorts-player .im-aura').getAttribute('data-on'), 'false', 'a deliberate pause is not loading');
            assert.equal(await page.locator('.session-shorts-player .im-gesture .im-play').count(), 1, 'Play shows after a deliberate pause');
            await page.getByRole('button', { name: 'Play', exact: true }).click();
            await waitPlaying(true);
            // Toggle back to the card view and again; the choice persists.
            await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
            await page.waitForFunction(() => !document.documentElement.dataset.immersive);
            const card = await page.locator('.session-shorts-player[data-active="true"] .im-frame').boundingBox();
            assert.ok(card.height < 664 - 100, 'card view gives the chrome its space back');
            assert.equal(await page.evaluate(() => localStorage.getItem('otium:shorts-immersive:1')), 'off');
            await page.getByRole('button', { name: 'Full screen', exact: true }).click();
            await page.waitForFunction(() => document.documentElement.dataset.immersive === 'on');
            await waitPlaying(true);
            assert.ok(count('open') <= 1, 'full screen and the aura do not count as opens');
        }, { immersive: true });
    } finally { await browser.close(); }
}
