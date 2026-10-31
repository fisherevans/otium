// Measure Shorts transitions with real YouTube embeds (#182).
//
//   BASE_URL=http://127.0.0.1:5181 FIXTURE=fixture.json OUT=dir node tools/measure-shorts-transitions.mjs
//
// FIXTURE is { sources, items } in the /sessions/current item shape (real public
// Shorts). Every Otium API call is mocked; only YouTube is real. Chromium runs
// on a 390x664 touch viewport with 4x CPU throttling as a rough phone stand-in,
// and moves between cards three ways: a touch swipe that starts on the video, a
// touch swipe that starts below it, and the Next button. The app's own perf
// records (window.__otiumPerf, web/src/lib/perf.ts) are the measurements; the
// run also writes a video so the transitions can be inspected frame by frame.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:5180');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('local BASE_URL only');
const fixture = JSON.parse(fs.readFileSync(process.env.FIXTURE, 'utf8'));
const out = process.env.OUT || '.';
const rounds = Number(process.env.ROUNDS || 2);
fs.mkdirSync(out, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({
    viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    recordVideo: { dir: out, size: { width: 390, height: 664 } },
});
const page = await context.newPage();
// Harness-side view of the scroll window, independent of the app's own records:
// long tasks and frame gaps that overlap [gesture start, last scroll event] are
// main-thread work competing with the moving reel.
await page.addInitScript(() => {
    const h = window.__h = { scrolls: [], tasks: [], frames: [] };
    document.addEventListener('scroll', () => h.scrolls.push(performance.now()), true);
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) h.tasks.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] }); } catch {}
    const tick = t => { h.frames.push(t); if (h.frames.length > 4000) h.frames.splice(0, 2000); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
});
const sessionId = 'perf-test';
let cursor = 0;
await page.route('**/api/v1/**', route => {
    const req = route.request(), p = new URL(req.url()).pathname.replace('/api/v1', ''), m = req.method();
    const json = body => route.fulfill({ json: body });
    if (m === 'GET') {
        if (p === '/users/me') return json({ id: 1, username: 'perf', name: 'Perf' });
        if (p === '/preferences') return json({});
        if (p === '/settings') return json({ fast_scroll_checkin: false, youtube_history: false });
        if (p === '/sources') return json(fixture.sources);
        if (p === '/collections') return json([]);
        if (p === '/sessions/current') return json({ session_id: sessionId, cursor, duration_min: 30, themes: ['Shorts'], items: fixture.items });
        if (/\/items\/\d+\/content$/.test(p)) return json({ render: 'external', content: '', content_source: 'rss' });
    }
    if (m === 'PATCH') { cursor = req.postDataJSON().cursor ?? cursor; return json({ ok: true }); }
    if (m === 'POST') return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ status: 500, json: { message: 'unexpected' } });
});
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU || 4) });

const playing = () => page.waitForFunction(() => document.querySelector('.session-shorts-player[data-active="true"] .im-gesture')?.getAttribute('aria-label') === 'Pause', null, { timeout: 15000 });
const records = () => page.evaluate(() => window.__otiumPerf.length);
async function transition(label, act) {
    const before = await records();
    const start = await page.evaluate(() => performance.now());
    await act();
    await page.waitForFunction(n => window.__otiumPerf.length > n, before, { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(600);
    const rec = await page.evaluate(n => window.__otiumPerf[n] ?? null, before);
    const win = await page.evaluate(start => {
        const h = window.__h, scrolls = h.scrolls.filter(t => t >= start);
        const end = scrolls.length ? scrolls.at(-1) : start;
        const overlap = h.tasks.reduce((sum, [s, d]) => sum + Math.max(0, Math.min(end, s + d) - Math.max(start, s)), 0);
        const frames = h.frames.filter(t => t >= start && t <= end);
        let jank = 0, worst = 0;
        for (let i = 1; i < frames.length; i++) { const g = frames[i] - frames[i - 1]; if (g > 25) jank++; worst = Math.max(worst, g); }
        return { scroll_ms: Math.round(end - start), scroll_longtask_ms: Math.round(overlap), scroll_jank: jank, scroll_worst_ms: Math.round(worst) };
    }, start);
    if (rec) Object.assign(rec, win);
    console.log(label.padEnd(14), rec ? JSON.stringify(rec) : 'NO RECORD');
    return { label, ...(rec || {}) };
}
async function videoBox() {
    return page.locator('.session-shorts-player[data-active="true"] .im-frame').boundingBox();
}
// Raw touch events: a ~200ms, 420px upward swipe. (synthesizeScrollGesture does
// not scroll in headless Chromium.)
async function swipe(x, y) {
    const at = dy => [{ x, y: y + dy }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
    for (let i = 1; i <= 12; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(-35 * i) });
        await new Promise(resolve => setTimeout(resolve, 16));
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

await page.goto(`${base.origin}/session/${sessionId}`);
await playing();
await page.waitForTimeout(1500);
// Background: long-task load from steady playback alone, per second.
const idle = await page.evaluate(async () => {
    const t0 = performance.now(); await new Promise(r => setTimeout(r, 3000)); const t1 = performance.now();
    const ms = window.__h.tasks.reduce((sum, [s, d]) => sum + Math.max(0, Math.min(t1, s + d) - Math.max(t0, s)), 0);
    return Math.round(ms / ((t1 - t0) / 1000));
});
console.log(`steady playback: ${idle} ms of long tasks per second`);
const results = [];
for (let r = 0; r < rounds; r++) {
    let box = await videoBox();
    results.push(await transition('swipe-video', () => swipe(box.x + box.width / 2, box.y + box.height * 0.6)));
    await page.waitForTimeout(1200);
    box = await videoBox();
    const footer = await page.locator('.afterglow-card:not(.away) .shorts-card-footer').boundingBox();
    const y = footer ? footer.y + footer.height / 2 : box.y + box.height + 30;
    results.push(await transition('swipe-below', () => swipe(40, y)));
    await page.waitForTimeout(1200);
    results.push(await transition('next-button', () => page.getByRole('button', { name: 'Next', exact: true }).click()));
    await page.waitForTimeout(1200);
}
fs.writeFileSync(path.join(out, 'records.json'), JSON.stringify(results, null, 1));
const video = page.video();
await context.close();
await browser.close();
if (video) fs.renameSync(await video.path(), path.join(out, 'run.webm'));
const by = {};
for (const r of results) (by[r.label] ??= []).push(r);
for (const [label, rs] of Object.entries(by)) {
    const avg = k => Math.round(rs.reduce((s, r) => s + (r[k] ?? 0), 0) / rs.length);
    console.log(`${label}: n=${rs.length} settle=${avg('settle_ms')} load=${avg('load_ms')} playing=${avg('playing_ms')} scroll=${avg('scroll_ms')}ms scroll_longtask=${avg('scroll_longtask_ms')} scroll_jank=${avg('scroll_jank')} scroll_worst=${avg('scroll_worst_ms')} | janky=${avg('janky_frames')}/${avg('frames')} max_frame=${avg('max_frame_ms')} drift=${avg('drift_px')} longtask=${avg('longtask_ms')} (iframe ${avg('longtask_iframe_ms')}) moved=${rs.filter(r => r.to > r.from).length}`);
}
