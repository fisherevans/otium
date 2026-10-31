// Run against a Vite dev server: BASE_URL=http://127.0.0.1:5173 node tools/verify-surface-refresh.mjs
// PLAYWRIGHT_MODULE can point at an existing index.mjs. BROWSERS defaults to chromium,webkit.
// Every API request is intercepted; synthetic fixtures never read or change account data.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const stamp = new Date().toISOString();
const source = { id: 71, kind: 'rss', title: 'Test Gazette', feed_url: 'https://example.test/feed', homepage_url: 'https://example.test', icon_url: '', weight: 1, state: 'active', per_session_cap: 0, half_life_days: 0, added_at: stamp };
const item = {
    id: 901, source_id: source.id, url: 'https://example.test/story', title: 'The library extends its opening hours',
    summary: 'The new schedule adds evening hours on two weekdays.', content: '<p>A synthetic story used only by the browser checks.</p>',
    content_source: 'rss', author: 'Test reporter', thumbnail_url: '', media_type: 'article', duration_sec: 180,
    aspect_ratio: 0, categories: Array.from({ length: 18 }, (_, i) => `Category ${i + 1}`), published_at: stamp, fetched_at: stamp, added_at: stamp,
};
const preferences = {
    reader: { font_size: 17, line_height: 1.62, measure: 66, images: true, font_family: 'newsreader', font_weight: 400, ink: 'soft' },
    card: { meta_size: 11, source_size: 15, topic_tag_size: 13, date_size: 13, hero_show: true, hero_color: true, topic_weight: 600, topic_ink: 'topic', source_weight: 600, source_ink: 'soft', author_weight: 500, author_ink: 'mute', date_weight: 400, date_ink: 'mute', delim: 'dot', delim_gap: 7, meta_weight: 400, meta_ink: 'mute' },
    presets: [5, 10, 20, 40],
};
const collection = { id: 21, name: 'Test collection', slug: 'test-collection', kind: 'user', sort: 0, created_at: stamp, item_count: 0 };
const mediaItems = [
    { ...item, id: 950, title: 'A video on its original site', media_type: 'long', url: 'https://example.test/video' },
    { ...item, id: 951, title: 'An audio episode without an enclosure', media_type: 'audio', url: 'https://example.test/episode' },
];
const queue = Array.from({ length: 36 }, (_, i) => ({
    item: { ...item, id: 1000 + i, title: `Library report ${i + 1}` }, source_title: source.title,
    score: 0.9, est_duration_sec: 180, reason: 'Recent article',
    breakdown: { weight: 1, rarity: 1, freshness: 0.9, effective_score: 0.9, cadence_per_day: 1, age_days: 0.1 },
}));

for (const [name, engine] of Object.entries({ chromium, webkit }).filter(([name]) => (process.env.BROWSERS || 'chromium,webkit').split(',').includes(name))) {
    const browser = await engine.launch({ headless: true });
    try {
        async function scenario(label, run) {
            const context = await browser.newContext({ viewport: { width: 390, height: 664 }, hasTouch: true });
            const page = await context.newPage();
            page.setDefaultTimeout(10000);
            page.setDefaultNavigationTimeout(30000);
            const errors = [];
            const unexpected = [];
            const state = { collectionItems: null, active: true, cursor: 0, ended: 0, failFilter: false, failWeight: true, weightPatches: [], filters: [] };
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/api/v1/**', async route => {
                const request = route.request();
                const path = new URL(request.url()).pathname.replace('/api/v1', '');
                const method = request.method();
                const json = body => route.fulfill({ json: body });
                if (method === 'GET') {
                    if (path === '/users/me') return json({ id: 1, username: 'surface-test', email: '', name: 'Surface test' });
                    if (path === '/preferences') return json(preferences);
                    if (path === '/settings') return json({ fast_scroll_checkin: true, youtube_history: false });
                    if (path === '/sources') return json([source]);
                    if (path === '/collections') return json([{ ...collection, item_count: state.collectionItems?.length || 0 }]);
                    if (path === '/collections/21/items') return json(state.collectionItems);
                    if (path === '/sessions/current') return state.active
                        ? json({ session_id: 'surface-test', duration_min: 40, cursor: state.cursor, themes: [], items: queue })
                        : route.fulfill({ status: 204 });
                    if (/^\/items\/\d+\/content$/.test(path)) return json({ content: item.content, content_source: 'rss', has_full_text: true, render: 'full_text' });
                }
                if (method === 'PATCH' && path === '/sessions/surface-test') {
                    const patch = request.postDataJSON();
                    state.cursor = patch.cursor ?? state.cursor;
                    if (patch.status === 'ended') { state.active = false; state.ended++; }
                    return json({ ok: true });
                }
                if (method === 'PATCH' && path === '/sources/71') {
                    state.weightPatches.push(request.postDataJSON());
                    if (state.failWeight) return route.fulfill({ status: 503, json: { message: 'Representation could not be saved. Try again.' } });
                    return json({ ok: true });
                }
                if (method === 'POST' && /^\/items\/\d+\/filter$/.test(path)) {
                    if (state.failFilter) return route.fulfill({ status: 503, json: { message: "Filter could not be saved." } });
                    state.filters.push(request.postDataJSON());
                    return json({ ok: true, source_id: source.id });
                }
                if (method === 'POST' && /^\/items\/\d+\/(event|dwell|read)$/.test(path)) return json({ ok: true });
                unexpected.push(`${method} ${path}`);
                return route.fulfill({ status: 500, json: { message: 'Unmocked API request in surface test' } });
            });
            try {
                await run(page, state);
                assert.deepEqual(errors, [], `${name}: ${label} has no page errors`);
                assert.deepEqual(unexpected, [], `${name}: ${label} only uses mocked APIs`);
                console.log(`${name}: ${label} PASS`);
            } catch (error) {
                console.error(`${name}: ${label}`, { errors, unexpected, body: await page.locator('body').innerText() });
                throw error;
            } finally { await context.close(); }
        }

        await scenario('empty collection accepts a null item list', async page => {
            await page.goto(`${base}/saved?collection=21`);
            await page.getByText('Nothing here yet. Save items from a session to fill this list.').waitFor();
            assert.equal(await page.getByRole('heading', { name: collection.name, exact: true }).count(), 1);
            assert.equal(await page.getByRole('tab', { name: 'Saved date', exact: true }).count(), 1);
        });

        await scenario('fast-scroll modal preserves the feed and supports both choices', async (page, state) => {
            await page.goto(`${base}/session/surface-test`);
            await page.locator('.afterglow-card:not(.away)').waitFor();
            await page.waitForTimeout(400);
            const initialHeight = await page.locator('.stage').evaluate(el => el.clientHeight);
            const checkin = page.getByRole('dialog', { name: 'Session', exact: true });
            async function advanceUntilCheckin() {
                let advanced = 0;
                while (advanced < 10 && !await checkin.count()) {
                    await page.getByRole('button', { name: 'Next', exact: true }).click();
                    await page.waitForTimeout(400);
                    advanced++;
                }
                await checkin.waitFor();
                assert.ok(advanced >= 8 && advanced <= 9, `${name}: check-in after a fresh fast streak, got ${advanced}`);
                assert.equal(await page.locator('.stage').evaluate(el => el.clientHeight), initialHeight, 'opening the check-in does not shrink or displace the card');
            }
            await advanceUntilCheckin();
            await checkin.getByRole('button', { name: 'Keep going', exact: true }).click();
            await checkin.waitFor({ state: 'detached' });
            await advanceUntilCheckin();
            await checkin.getByRole('button', { name: 'End session', exact: true }).click();
            await page.getByRole('heading', { name: 'Session complete', exact: true }).waitFor();
            await page.waitForFunction(() => !document.querySelector('.stage'));
            assert.equal(state.ended, 1, 'End session persists exactly one ending');
            assert.equal(await page.getByRole('button', { name: 'Review session', exact: true }).count(), 1);
        });

        await scenario('long article details sheet scrolls to working final controls', async (page, state) => {
            await page.goto(`${base}/session/surface-test`);
            // #180: filters live in Details (provenance), reached from the actions sheet.
            await page.getByRole('button', { name: 'Article and session actions', exact: true }).click();
            await page.getByRole('dialog', { name: source.title, exact: true }).getByRole('button', { name: /Details and why/ }).click();
            const menu = page.getByRole('dialog', { name: 'Details', exact: true });
            const sheet = menu.locator('.sheet');
            await page.waitForTimeout(300);
            assert.ok(await sheet.evaluate(el => el.scrollHeight > el.clientHeight + 100), 'fixture requires menu scrolling');
            await menu.getByRole('button', { name: 'or filter by a word in the title…', exact: true }).click();
            assert.ok(await sheet.evaluate(el => el.scrollTop > 0), 'last control is reached inside the menu');
            await menu.getByPlaceholder('word or phrase in the title').fill('notices');
            state.failFilter = true;
            await menu.getByRole('button', { name: 'Mute', exact: true }).click();
            const status = menu.getByRole('status');
            await status.filter({ hasText: "Couldn't save that filter" }).waitFor();
            const noteBox = await status.boundingBox();
            const sheetBox = await sheet.boundingBox();
            assert.ok(noteBox.y >= sheetBox.y && noteBox.y + noteBox.height <= sheetBox.y + sheetBox.height, 'failed filter feedback is visible without another scroll');
            assert.equal(await menu.getByPlaceholder('word or phrase in the title').inputValue(), 'notices');
            state.failFilter = false;
            await menu.getByRole('button', { name: 'Mute', exact: true }).click();
            await menu.getByText(/Muted posts from Test Gazette with/).waitFor();
            assert.deepEqual(state.filters, [{ categories: [], keywords: ['notices'] }]);
            await menu.getByRole('button', { name: 'Close', exact: true }).click();
            await menu.waitFor({ state: 'detached' });
            assert.equal(await page.getByRole('button', { name: 'Next', exact: true }).count(), 1);
        });

        await scenario('collection video and audio keep a working contextual Back', async (page, state) => {
            state.collectionItems = mediaItems;
            await page.goto(`${base}/saved?collection=21`);
            for (const media of mediaItems) {
                await page.getByRole('button', { name: new RegExp(media.title) }).click();
                const player = page.getByRole('dialog', { name: media.title, exact: true });
                await player.waitFor();
                const instrument = player.locator('.context-instrument');
                assert.equal(await instrument.count(), 1);
                await instrument.getByRole('button', { name: 'Back', exact: true }).click();
                await player.waitFor({ state: 'detached' });
                await page.getByRole('heading', { name: collection.name, exact: true }).waitFor();
            }
        });

        await scenario('failed source representation stays selected and can be retried', async (page, state) => {
            await page.goto(`${base}/session/surface-test`);
            await page.locator('.afterglow-card:not(.away)').getByRole('button', { name: source.title, exact: true }).click();
            const sheet = page.getByRole('dialog', { name: 'Source', exact: true });
            const picker = sheet.getByRole('group', { name: 'Representation', exact: true });
            const normal = picker.getByRole('button', { name: 'Normal', exact: true });
            const more = picker.getByRole('button', { name: 'More', exact: true });
            assert.equal(await normal.getAttribute('aria-pressed'), 'true');
            await more.click();
            await sheet.getByRole('alert').waitFor();
            assert.equal(await normal.getAttribute('aria-pressed'), 'true', 'failed save retains confirmed selection');
            assert.equal(await more.getAttribute('aria-pressed'), 'false');
            state.failWeight = false;
            await more.click();
            await page.waitForFunction(() => document.querySelector('[aria-label="Representation"] .rep-seg.on')?.textContent === 'More');
            assert.equal(await more.getAttribute('aria-pressed'), 'true');
            assert.equal(await sheet.getByRole('alert').count(), 0);
            assert.deepEqual(state.weightPatches, [{ weight_bucket: 'high' }, { weight_bucket: 'high' }]);
        });
    } finally { await browser.close(); }
}
