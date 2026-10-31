// #186: starting a session shows the building screen at once and carries it into
// the session page until its first card renders. All API calls are mocked.
//   BASE_URL=http://127.0.0.1:5173 node tools/verify-session-building.mjs  (SHOTS=dir for screenshots)
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const stamp = new Date(Date.now() - 3600e3).toISOString();
const item = (n, media) => ({ item: { id: n, source_id: 3, url: `https://www.youtube.com/shorts/test${String(n).padStart(7, '0')}`, title: `Clip ${n}`, summary: '', content: '', content_source: 'rss', author: '', thumbnail_url: '', media_type: media, duration_sec: 40, aspect_ratio: 0.5625, published_at: stamp, fetched_at: stamp }, source_title: 'Films', topic: null, score: 1, est_duration_sec: 40, reason: '', breakdown: {} });
for (const [name, type] of [['chromium', chromium], ['webkit', webkit]].filter(([n]) => (process.env.BROWSERS || 'chromium,webkit').split(',').includes(n))) {
    const browser = await type.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
    let create = deferred(), load = deferred(), createdId = 'built-session', current = null;
    await page.route(/^https:\/\/([a-z0-9-]+\.)?(youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com)\//, r => r.abort());
    await page.route('**/api/v1/**', async r => {
        const path = new URL(r.request().url()).pathname, method = r.request().method();
        if (path.endsWith('/users/me')) return r.fulfill({ json: { id: 7, username: 'fixture' } });
        if (path.endsWith('/topics')) return r.fulfill({ json: [{ id: 3, name: 'Films', slug: 'films', section_slug: 'videos' }] });
        if (path.endsWith('/sections')) return r.fulfill({ json: [{ id: 2, name: 'Videos', slug: 'videos', topic_count: 1 }] });
        if (path.endsWith('/sources')) return r.fulfill({ json: [{ id: 3, title: 'Films', kind: 'youtube', topic_slug: 'films', unseen_count: 9 }] });
        if (path.endsWith('/preferences')) return r.fulfill({ json: { presets: [5, 10, 20, 40] } });
        if (path.endsWith('/sessions') && method === 'POST') { await create.promise; return r.fulfill({ json: { session_id: createdId, items: [] } }); }
        if (path.endsWith('/sessions/current')) {
            if (!current) return r.fulfill({ status: 204 });
            await load.promise;
            return r.fulfill({ json: { session_id: current, cursor: 0, duration_min: 10, themes: [], items: [item(1, 'short'), item(2, 'short')] } });
        }
        return r.fulfill({ status: 204, body: '' });
    });
    const shot = async label => { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}-${label}.png` }); };
    const tiles = () => page.evaluate(() => [...document.querySelectorAll('.building-tile')].map(t => t.style.transform).join('|'));
    await page.goto(base);
    const start = page.getByRole('button', { name: 'Start Shorts', exact: true });
    await start.waitFor();
    // Tap: the building screen appears at once, before the server answers.
    const t0 = Date.now();
    await start.click();
    await page.locator('.session-building').waitFor({ timeout: 1000 });
    assert.ok(Date.now() - t0 < 1000, 'building screen appears at once');
    assert.match(await page.locator('.session-building').innerText(), /Building your session/);
    const before = await tiles();
    await page.waitForFunction(b => [...document.querySelectorAll('.building-tile')].map(t => t.style.transform).join('|') !== b, before, { timeout: 3000 });
    await shot('building');
    // The server answers; the session page keeps the same screen until its queue loads.
    current = createdId; create.resolve();
    await page.waitForURL(/\/session\/built-session/);
    await page.locator('.session-building.continued').waitFor({ timeout: 2000 });
    assert.equal(await page.locator('.session-building').count(), 1, 'one building screen carries into the session page, without a second fade');
    load.resolve();
    await page.locator('.afterglow-card[data-idx="0"]').waitFor();
    await page.locator('.session-building').waitFor({ state: 'detached' });
    // An empty result returns to Home with the message, not a stuck screen.
    await page.goto(base); current = null; createdId = ''; create = deferred(); create.resolve();
    await page.getByRole('button', { name: 'Start Shorts', exact: true }).click();
    await page.getByText('No new items match this session', { exact: false }).waitFor();
    assert.equal(await page.locator('.session-building').count(), 0, 'building screen clears on an empty result');
    assert.deepEqual(errors, [], `${name}: no page errors`);
    console.log(`${name}: session building PASS`);
    await browser.close();
}
