// Run against a local dev server: node tools/verify-appearance.mjs http://127.0.0.1:5173
// Preference requests are intercepted; these checks never modify account data.
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.argv[2] || "http://127.0.0.1:5173";
const response = await fetch(`${base}/api/v1/preferences`);
assert.ok(response.ok, "local preferences endpoint must be available");
const stored = await response.json();
const browser = await chromium.launch();
try {
    const page = await browser.newPage({ viewport: { width: 390, height: 664 } });
    let fail = false;
    const writes = [];
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/v1/preferences", route => {
        if (route.request().method() === "GET") return route.fulfill({ json: stored });
        const patch = route.request().postDataJSON();
        writes.push(patch);
        if (fail) return route.fulfill({ status: 503, json: { error: "test failure" } });
        return route.fulfill({ json: {
            ...stored, reader: { ...stored.reader, ...patch.reader },
            card: { ...stored.card, ...patch.card }, presets: patch.presets ?? stored.presets,
        } });
    });
    await page.goto(`${base}/settings/appearance`);
    await page.getByText("Account preferences saved", { exact: true }).waitFor();
    assert.equal(await page.locator("html").getAttribute("data-presentation"), "standard");
    const oldChoice = stored.card.hero_color ? "Natural color" : "Grayscale";
    assert.equal(await page.getByRole("button", { name: oldChoice, exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Natural color", exact: true }).click();
    await page.getByText("Account preferences saved", { exact: true }).waitFor();
    assert.equal(await page.locator(".reader-body img").evaluate(e => getComputedStyle(e).filter), "none");
    const count = writes.length;
    await page.getByRole("button", { name: "E-ink", exact: true }).click();
    assert.match(await page.locator(".reader-body img").evaluate(e => getComputedStyle(e).filter), /grayscale/);
    await page.waitForTimeout(450);
    assert.equal(writes.length, count, "device choice must not write account preferences");
    await page.reload();
    await page.getByText("Account preferences saved", { exact: true }).waitFor();
    assert.equal(await page.locator("html").getAttribute("data-presentation"), "eink");
    await page.getByRole("button", { name: "Standard", exact: true }).click();
    await page.getByRole("button", { name: "Session card", exact: true }).click();
    await page.getByLabel("Long headline", { exact: true }).check();
    await page.waitForTimeout(300);
    const geometry = await page.locator(".appearance-card-frame").evaluate(frame => ({
        credit: !!frame.querySelector(".card-credit"), taxonomy: !!frame.querySelector(".ch-taxonomy"),
        actionsBottom: frame.querySelector(".card-callout").getBoundingClientRect().bottom,
        frameBottom: frame.getBoundingClientRect().bottom,
    }));
    assert.ok(geometry.credit && geometry.taxonomy);
    assert.ok(geometry.actionsBottom <= geometry.frameBottom + 1, JSON.stringify(geometry));
    await page.getByRole("button", { name: "Reader", exact: true }).click();
    fail = true;
    await page.getByRole("button", { name: "Natural color", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Changes could not be saved" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Natural color", exact: true }).getAttribute("aria-pressed"), "true");
    fail = false;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.getByText("Account preferences saved", { exact: true }).waitFor();
    assert.equal(writes.at(-1).card.hero_color, true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByText("Your device requests reduced motion.", { exact: false }).waitFor();
    await page.setViewportSize({ width: 320, height: 568 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await page.close();

    const queue = await browser.newPage();
    let getFails = true;
    let firstWrite = true;
    let release;
    const queued = [];
    await queue.route("**/api/v1/preferences", async route => {
        if (route.request().method() === "GET") return route.fulfill(getFails
            ? { status: 503, json: { error: "test load failure" } } : { json: stored });
        queued.push(route.request().postDataJSON());
        if (firstWrite) {
            firstWrite = false;
            await new Promise(resolve => { release = resolve; });
            return route.fulfill({ status: 503, json: { error: "test write failure" } });
        }
        return route.fulfill({ json: stored });
    });
    await queue.goto(`${base}/settings/appearance`);
    await queue.getByText("Saved preferences could not be loaded.", { exact: false }).waitFor();
    await queue.getByRole("button", { name: "Grayscale", exact: true }).click();
    await queue.waitForTimeout(500);
    assert.equal(queued.length, 1);
    await queue.getByLabel("Show images in articles", { exact: true }).uncheck();
    await queue.waitForTimeout(500);
    assert.equal(queued.length, 1, "new edits must queue behind the in-flight write");
    release();
    await queue.waitForTimeout(100);
    getFails = false;
    await queue.getByRole("button", { name: "Retry", exact: true }).click();
    await queue.getByText("Account preferences saved", { exact: true }).waitFor();
    assert.equal(queued.length, 2);
    assert.equal(queued[1].card.hero_color, false);
    assert.equal(queued[1].reader.images, false);
    assert.equal(await queue.getByLabel("Show images in articles", { exact: true }).isChecked(), false,
        "a retried GET must not undo newer edits");
    console.log("PASS: live preview, device presentation, reduced motion, save retry, queued edits and load failure recovery");
} finally {
    await browser.close();
}
