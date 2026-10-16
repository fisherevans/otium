// Run against a Vite dev server: BASE_URL=http://127.0.0.1:5173 node tools/verify-overlays.mjs
// Playwright uses this project's dependency by default. PLAYWRIGHT_MODULE can
// point at an existing installation's index.mjs; BROWSERS defaults to both engines.
// Install engines once: npx playwright install chromium webkit
// Content and collection APIs are mocked; this does not change account data.
import { pathToFileURL } from 'node:url';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
import assert from 'node:assert/strict';
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Overlay checks</title></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;
await import('/tools/overlay-harness.jsx');
</script></body></html>`;
for (const [name, browserType] of [['chromium',chromium],['webkit',webkit]].filter(([name]) => (process.env.BROWSERS || 'chromium,webkit').split(',').includes(name))) {
 const browser=await browserType.launch({headless:true}); const page=await browser.newPage({viewport:{width:390,height:664},hasTouch:true});
 try {
 let failContent = true;
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(name,e.message);});
 await page.route(/\/overlay-(before|check|away)(\?.*)?$/,r=>r.fulfill({contentType:'text/html',body:html}));
 await page.route('**/api/v1/collections*',r=>r.fulfill({json:[]}));
 await page.route('**/broken-reader-image',r=>r.fulfill({status:404,body:'missing'}));
 await page.route('**/api/v1/items/901/content',r=> failContent ? r.fulfill({status:503,body:'temporary failure'}) : r.fulfill({json:{content:'<p>The complete extracted story is available.</p><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="Sample photo"><img src="/broken-reader-image" alt="A missing landscape" width="1200" height="900">'}}));
 await page.goto(base+'/overlay-before');
 await page.locator('#enter').click();
 const originState=await page.evaluate(()=>window.history.state);
 const initialLength=await page.evaluate(()=>window.history.length);
 await page.locator('#reader-trigger').click();
 await page.getByText('The full text could not load. Showing the available text.').waitFor();
 await page.getByText('Only the teaser').waitFor();
 failContent=false; await page.getByRole('button',{name:'Retry',exact:true}).click();
 await page.getByText('The complete extracted story is available.').waitFor();
 assert.equal(await page.evaluate(()=>window.history.length),initialLength+1,name+' StrictMode adds exactly one history entry');
 assert.equal(await page.evaluate(()=>window.history.state.idx),originState.idx,name+' router index retained');
 await page.waitForTimeout(350);
 assert.equal(await page.locator('dialog[open]').count(),1);
 assert.equal(await page.locator('.readerpage').evaluate(e=>getComputedStyle(e).touchAction),'pan-y pinch-zoom');
 assert.ok((await page.evaluate(()=>window.transitions)).some(e=>e.class.includes('readerpage')&&e.property==='transform'),name+' reader entrance');
 await page.getByRole('button',{name:'Save',exact:true}).first().click();await page.waitForTimeout(350);
 assert.equal(await page.locator('dialog[open]').count(),2);
 assert.ok((await page.evaluate(()=>window.transitions)).some(e=>e.class.includes('sheet')&&e.property==='transform'),name+' sheet entrance');
 await page.getByRole('button',{name:'New collection'}).click();
 assert.equal(await page.locator('dialog[open]').count(),3);
 await page.getByRole('textbox',{name:'Name'}).fill('Draft survives');
 for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.closest('dialog')?.getAttribute('aria-label')),'Collection name');}
 await page.evaluate(()=>document.getElementById('background').focus());
 assert.equal(await page.evaluate(()=>document.activeElement.closest('dialog')?.getAttribute('aria-label')),'Collection name');
 await page.keyboard.press('Escape'); assert.equal(await page.locator('dialog[open]').count(),2);
 assert.equal(await page.evaluate(()=>document.activeElement.textContent),'New collection');
 await page.keyboard.press('Escape');await page.waitForTimeout(350); assert.equal(await page.locator('dialog[open]').count(),1);
 assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Save');
 await page.locator('.reader-body img:not([data-load-failed])').click();assert.equal(await page.locator('dialog[open]').count(),2);
 await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),1);
 // Cancellation and a second touch must never turn into Back.
 await page.locator('.readerpage').evaluate(el=>{
  const emit=(type,id,x,primary=true)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',isPrimary:primary,clientX:x,clientY:300,button:0}));
  emit('pointerdown',1,50);emit('pointermove',1,160);emit('pointercancel',1,160);
  emit('pointerdown',2,50);emit('pointerdown',3,90,false);emit('pointermove',2,190);emit('pointerup',2,190);emit('pointerup',3,90,false);
 });await page.waitForTimeout(100);assert.equal(await page.locator('dialog[open]').count(),1);
 await page.goBack();await page.waitForTimeout(350);assert.equal(await page.locator('dialog[open]').count(),0);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'reader-trigger');
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
 await page.locator('#reader-trigger').click();await page.waitForTimeout(350);await page.getByRole('button',{name:'Back',exact:true}).click();await page.waitForTimeout(350);
 assert.equal(await page.locator('dialog[open]').count(),0);
 // A list without an onSave callback still has a working shared picker.
 await page.locator('#source-trigger').click();await page.waitForTimeout(350);
 await page.getByText('Image unavailable: A missing landscape').waitFor();
 assert.equal(await page.locator('img[data-load-failed]').evaluate(e=>e.getBoundingClientRect().height),0);
 await page.getByRole('button',{name:'Save',exact:true}).first().click();
 await page.getByRole('dialog',{name:'Save to',exact:true}).waitFor();await page.waitForTimeout(350);
 await page.goBack();await page.waitForTimeout(350);assert.equal(await page.locator('dialog[open]').count(),1);
 await page.goBack();await page.waitForTimeout(350);assert.equal(await page.locator('dialog[open]').count(),0);
 // Nested browser Back closes only the top sheet, then its reader.
 await page.locator('#reader-trigger').click();await page.waitForTimeout(350);
 await page.getByRole('button',{name:'Save',exact:true}).first().click();await page.waitForTimeout(350);
 assert.equal(await page.locator('dialog[open]').count(),2);
 await page.goBack();await page.waitForTimeout(350);
 assert.equal(await page.locator('dialog[open]').count(),1,name+' nested Back leaves reader open');
 await page.goBack();await page.waitForTimeout(350);
 assert.equal(await page.locator('dialog[open]').count(),0);
 assert.deepEqual(await page.evaluate(()=>{const {otiumPosition,...state}=window.history.state;return state;}),originState);
 // Closing via UI consumes only that modal entry. The next Back is normal routing.
 await page.locator('#reader-trigger').click();await page.waitForTimeout(350);
 await page.getByRole('button',{name:'Save',exact:true}).first().click();await page.waitForTimeout(350);
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.waitForTimeout(350);
 assert.equal(await page.locator('dialog[open]').count(),1,name+' internal close pop leaves reader open');
 await page.getByRole('button',{name:'Back',exact:true}).click();await page.waitForTimeout(350);
 await page.goBack();await page.locator('#enter').waitFor();
 assert.ok(page.url().endsWith('/overlay-before'),name+' UI close then route Back');
 await page.locator('#enter').click();
 // Replacing a closing sheet queues its history push until the internal pop ends.
 await page.locator('#reader-trigger').click();await page.waitForTimeout(350);
 await page.getByRole('button',{name:'Save',exact:true}).first().click();await page.waitForTimeout(350);
 await page.getByRole('button',{name:'Replace sheet',exact:true}).click();await page.waitForTimeout(350);
 assert.equal(await page.locator('dialog[open]').count(),2);
 await page.goBack();await page.waitForTimeout(350);
 assert.equal(await page.locator('dialog[open]').count(),1,name+' replacing sheet preserves reader history');
 await page.goBack();await page.waitForTimeout(350);
 assert.equal(await page.locator('dialog[open]').count(),0);
 // A new route can unmount several overlays at once. Skip their buried entries.
 await page.locator('#reader-trigger').click();await page.waitForTimeout(350);
 await page.getByRole('button',{name:'Save',exact:true}).first().click();await page.waitForTimeout(350);
 await page.getByRole('button',{name:'Navigate away',exact:true}).click();await page.locator('#away').waitFor();
 assert.equal(await page.locator('dialog[open]').count(),0);
 await page.goBack();await page.locator('#reader-trigger').waitFor();await page.waitForTimeout(350);
 assert.equal(await page.locator('dialog[open]').count(),0,name+' route Back skips unmounted overlays');
 await page.goForward();await page.locator('#away').waitFor();
 assert.equal(await page.locator('dialog[open]').count(),0,name+' Forward skips retired overlays toward later route');
 await page.goBack();await page.locator('#reader-trigger').waitFor();await page.waitForTimeout(350);
 await page.goBack();await page.locator('#enter').waitFor();
 assert.ok(page.url().endsWith('/overlay-before'),name+' no duplicate modal route left behind');
 await page.locator('#enter').click();
 // Replace navigation has the same Router idx as the modal it replaces.
 await page.locator('#reader-trigger').click();await page.waitForTimeout(350);
 await page.getByRole('button',{name:'Save',exact:true}).first().click();await page.waitForTimeout(350);
 await page.getByRole('button',{name:'Replace route',exact:true}).click();await page.locator('#away').waitFor();
 await page.getByRole('button',{name:'Replace again',exact:true}).click();await page.waitForURL('**/overlay-away?again=1');
 await page.goBack();await page.locator('#reader-trigger').waitFor();await page.waitForTimeout(350);
 await page.goForward();await page.locator('#away').waitFor();
 await page.goBack();await page.locator('#reader-trigger').waitFor();await page.waitForTimeout(350);
 // Forward to a closed final modal cannot strand pending history operations.
 await page.locator('#reader-trigger').click();await page.waitForTimeout(350);
 await page.getByRole('button',{name:'Back',exact:true}).click();await page.waitForTimeout(350);
 await page.goForward();await page.waitForTimeout(350);
 assert.equal(await page.locator('dialog[open]').count(),0);
 await page.locator('#reader-trigger').click();await page.waitForTimeout(350);
 assert.ok(await page.evaluate(()=>window.history.state.otiumOverlay),name+' Forward boundary permits a new overlay');
 await page.getByRole('button',{name:'Back',exact:true}).click();await page.waitForTimeout(350);
 await page.evaluate(()=>{document.documentElement.dataset.presentation='eink'; window.transitions=[];});
 await page.locator('#reader-trigger').click();await page.waitForTimeout(100);
 assert.equal(await page.locator('.readerpage').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
 await page.keyboard.press('Escape');await page.waitForTimeout(100);assert.equal(await page.locator('dialog[open]').count(),0);
 await page.evaluate(()=>{delete document.documentElement.dataset.presentation;});await page.emulateMedia({reducedMotion:'reduce'});
 await page.locator('#reader-trigger').click();await page.waitForTimeout(100);
 assert.equal(await page.locator('.readerpage').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
 assert.deepEqual(errors,[]);console.log(name+': full text, reader and sheet entrance, native modal nesting, Tab/inertness/restoration, Escape, image viewer, cancelled/multi-touch, nested Back/Forward, route push/replace, forward boundary, StrictMode, e-ink/reduced-motion PASS');

 } finally { await browser.close(); }
}
