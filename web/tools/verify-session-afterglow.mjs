// Afterglow session parity. Uses a real app shell with intercepted session and
// collection APIs; no account data is modified.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:18972';
const shotDir = process.env.SHOTS || '/home/dev/.cache/otium-afterglow/production';
await mkdir(shotDir, {recursive:true});
const photo = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="650"><rect width="1000" height="650" fill="#a9b79d"/><path d="M0 600L300 170 540 420 730 200 1000 600" fill="#607854"/></svg>');
const make = (id,title) => ({item:{id,source_id:42,url:`https://example.com/article-${id}`,title,summary:'The planning commission approved a revised proposal following public hearings. The changes affect transportation, housing and access to local services.',content:'',content_source:'rss',author:'Reporter',thumbnail_url:photo,media_type:'article',duration_sec:120,published_at:'2026-10-16T12:00:00Z',fetched_at:'2026-10-16T12:00:00Z'},source_title:'VTDigger',topic:{name:'Vermont',section_name:'News',slug:'vermont'},score:1,est_duration_sec:120,reason:'',breakdown:{}});
const items=[make(101,'Vermont towns consider changes to housing and public transportation'),make(102,'A shorter headline for the second article'),make(103,'Third article: a local update'),make(104,'Fourth article that has not been shown')];
for (const [engine,browserType] of [['chromium',chromium],['webkit',webkit]].filter(([engine])=>(process.env.BROWSERS||'chromium,webkit').split(',').includes(engine))) {
 const browser=await browserType.launch();
 const page=await browser.newPage({viewport:{width:390,height:664},hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let cursor=0, ended=false, duration=10;
 const events=[];let membership=new Map();let failSave=false;
 try {
  await page.route('**/api/v1/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname;
   if(path.endsWith('/sessions/current'))return route.fulfill({json:{session_id:'afterglow-test',cursor,duration_min:duration,themes:['News'],items}});
   if(path.endsWith('/sessions/afterglow-test')){const patch=req.postDataJSON();if(patch.cursor!=null)cursor=patch.cursor;if(patch.status==='ended')ended=true;if(patch.extend_min){ended=false;duration+=patch.extend_min;}return route.fulfill({json:{ok:true}});}
   if(path.match(/\/items\/\d+\/content$/)) return route.fulfill({json:{render:'full_text',content:'<p>'+('This is the extracted article body. It has enough words to scroll on a phone. '.repeat(100))+'</p>'}});
   if(path.endsWith('/event')){events.push(req.postDataJSON());return route.fulfill({json:{ok:true}});}
   if(path==='/api/v1/collections'&&req.method()==='GET') {const id=Number(url.searchParams.get('item_id'));return route.fulfill({json:[{id:1,name:'Read later',kind:'custom',item_count:membership.size,contains:!!membership.get(id)}]});}
   if(path.match(/\/collections\/1\/items/)){if(failSave)return route.fulfill({status:500,json:{message:'save failed'}});const body=req.postDataJSON();const id=body?.item_id??Number(path.split('/').at(-1));membership.set(id,req.method()!=='DELETE');return route.fulfill({json:{ok:true}});}
   if(req.method()!=='GET') return route.fulfill({json:{ok:true}});
   return route.continue();
  });
  await page.goto(base+'/session/afterglow-test');
  await page.locator('.afterglow-card:not(.away) .card-title').filter({hasText:items[0].item.title}).waitFor();
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.context-instrument-wrap').count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`${shotDir}/${engine}-session.png`});
  // Holding a hero opens its full image and does not open the article.
  const img=page.locator('.afterglow-card:not(.away) .media img');const box=await img.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(560);await page.mouse.up();
  await page.getByRole('dialog',{name:'Image viewer',exact:true}).waitFor();
  assert.equal(await page.locator('.readerpage').count(),0);
  await page.getByRole('button',{name:'Close',exact:true}).click();await page.waitForTimeout(300);
  // The headline opens the reader; its contextual Back restores the same card.
  await page.locator('.afterglow-card:not(.away) .card-title').click();
  await page.locator('.reader-body').waitFor();await page.waitForTimeout(1100);
  await page.screenshot({path:`${shotDir}/${engine}-reader.png`});
  await page.getByRole('button',{name:'Back',exact:true}).click();await page.waitForTimeout(350);
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.waitForTimeout(700);
  assert.equal(await page.locator('.afterglow-card:not(.away)').getAttribute('data-idx'),'1');
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.waitForTimeout(700);
  await page.waitForFunction(()=>document.querySelector('.afterglow-card:not(.away)')?.dataset.idx==='2');
  await page.getByRole('button',{name:'Article and session actions'}).click();
  await page.getByRole('button',{name:'End session',exact:true}).click();
  await page.getByRole('heading',{name:'Session complete'}).waitFor();
  assert.equal(ended,true);
  await page.getByRole('button',{name:'Review session',exact:true}).first().click();
  await page.getByRole('heading',{name:'Review session',exact:true}).waitFor();
  assert.equal(await page.locator('.session-review-item').count(),3,'unseen queue item omitted');
  const stats=await page.locator('.session-review-stats').innerText();
  assert.match(stats,/Articles opened\s+1/);assert.match(stats,/Skips\s+1/);
  await page.screenshot({path:`${shotDir}/${engine}-review.png`});
  // Failed save stays in the picker, then succeeds for the selected review row.
  const bookmark=page.getByRole('button',{name:`Save to collection: ${items[1].item.title}`,exact:true});
  await bookmark.click();await page.getByRole('dialog',{name:'Save to',exact:true}).waitFor();
  failSave=true;await page.getByRole('button',{name:/Read later/}).click();await page.getByText(/save failed/).waitFor();
  failSave=false;await page.getByRole('button',{name:/Read later/}).click();
  await page.getByRole('button',{name:'Close',exact:true}).click();await page.waitForTimeout(400);
  assert.equal(await bookmark.getAttribute('aria-pressed'),'true');assert.equal(membership.get(102),true);
  await page.locator('.session-review-open').nth(1).click();await page.locator('.reader-body').waitFor();
  await page.getByRole('button',{name:'Back',exact:true}).click();await page.waitForTimeout(350);
  assert.equal(await page.locator('.session-review-stats').innerText(),stats,'reviewing does not mutate snapshot');
  await page.getByRole('dialog',{name:'Review session',exact:true}).getByRole('button',{name:'Done',exact:true}).click();await page.waitForTimeout(350);
  await page.reload();await page.getByRole('heading',{name:'Session complete'}).waitFor();
  await page.getByRole('button',{name:'Review session',exact:true}).first().click();await page.getByRole('heading',{name:'Review session'}).waitFor();
  assert.equal(await page.locator('.session-review-stats').innerText(),stats,'review survives reload');
  await page.getByRole('dialog',{name:'Review session',exact:true}).getByRole('button',{name:'Done',exact:true}).click();await page.waitForTimeout(350);
  await page.getByRole('button',{name:'+5 min',exact:true}).click();await page.locator('.afterglow-card:not(.away)').waitFor();await page.waitForTimeout(650);
  assert.equal(duration,15);assert.equal(ended,false);assert.equal(await page.locator('.afterglow-card:not(.away)').getAttribute('data-idx'),'2');
  await page.setViewportSize({width:320,height:568});await page.waitForTimeout(400);
  const geometry=await page.locator('.afterglow-card:not(.away)').evaluate(e=>({scroll:e.scrollHeight,height:e.clientHeight,title:e.querySelector('.card-title').getBoundingClientRect().toJSON(),actions:e.querySelector('.card-callout').getBoundingClientRect().toJSON()}));
  assert.ok(geometry.scroll<=geometry.height+2,JSON.stringify(geometry));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`${shotDir}/${engine}-narrow.png`});
  await page.setViewportSize({width:390,height:664});
  await page.locator('.afterglow-card:not(.away) .card-title').click();await page.locator('.reader-body').waitFor();await page.waitForTimeout(350);
  async function syntheticGesture(points, options={}) {
    await page.evaluate(async ({points,options}) => {
      const target=document.querySelector('.reader-body p');
      const send=(type,point,end=false)=>{
        const touch={identifier:12,target,clientX:point[0],clientY:point[1]};
        const touches=end?[]:[touch];if(options.multi&&!end)touches.push({identifier:13,target,clientX:point[0]+30,clientY:point[1]});
        const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperties(event,{touches:{value:touches},changedTouches:{value:[touch]}});target.dispatchEvent(event);
      };
      if(options.selection){const range=document.createRange();range.selectNodeContents(target);getSelection().addRange(range);}
      send('touchstart',points[0]);for(const point of points.slice(1))send('touchmove',point);
      if(options.slow)await new Promise(resolve=>setTimeout(resolve,950));
      send(options.cancel?'touchcancel':'touchend',points.at(-1),true);getSelection().removeAllRanges();
    },{points,options});await page.waitForTimeout(100);
  }
  await syntheticGesture([[70,400],[70,280]]);
  assert.equal(await page.locator('.readerpage').count(),1,'normal article scroll never advances');
  await page.locator('.readerpage-body').evaluate(e=>e.scrollTop=e.scrollHeight);await page.waitForTimeout(100);
  for(const [label,points,options] of [
    ['short',[[70,400],[70,360]],{}],['diagonal',[[70,400],[150,320]],{}],['axis change',[[70,400],[70,370],[230,390]],{}],
    ['slow',[[70,400],[70,280]],{slow:true}],['cancel',[[70,400],[70,280]],{cancel:true}],
    ['multi',[[70,400],[70,280]],{multi:true}],['selection',[[70,400],[70,280]],{selection:true}],
  ]) {await syntheticGesture(points,options);assert.equal(await page.locator('.readerpage').count(),1,label+' does not advance');}
  if(engine==='chromium') {
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:150,y:300}]});
    for(let y=280;y>=160;y-=20){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:150,y}]});await page.waitForTimeout(20);}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  } else await syntheticGesture([[150,430],[150,290]]);
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.readerpage').count(),0,'bottom-start forceful swipe returns to feed');
  assert.equal(await page.locator('.afterglow-card:not(.away)').getAttribute('data-idx'),'3','reader swipe advances one item');
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(400);
  assert.equal(await page.locator('.instrument-action').evaluate(e=>getComputedStyle(e).color),'rgb(37, 33, 25)');
  await page.screenshot({path:`${shotDir}/${engine}-dark.png`});
  await page.evaluate(()=>{localStorage.setItem('otium-presentation','eink');});await page.reload();await page.locator('.afterglow-card:not(.away)').waitFor();await page.waitForTimeout(500);
  assert.equal(await page.locator('html').getAttribute('data-presentation'),'eink');
  assert.match(await page.locator('.afterglow-card:not(.away) .media img').evaluate(e=>getComputedStyle(e).filter),/grayscale/);
  assert.equal(await page.locator('.context-instrument').evaluate(e=>getComputedStyle(e).animationDuration),'0s');
  await page.screenshot({path:`${shotDir}/${engine}-eink.png`});
  const pcm=Buffer.alloc(8000*2);for(let sample=0;sample<8000;sample++)pcm.writeInt16LE(Math.round(Math.sin(sample/8000*Math.PI*880)*3000),sample*2);
  const wav=Buffer.alloc(44);wav.write('RIFF');wav.writeUInt32LE(36+pcm.length,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);
  items[3].item.media_type='audio';items[3].item.url='data:audio/wav;base64,'+Buffer.concat([wav,pcm]).toString('base64');
  await page.reload();await page.locator('audio').waitFor();await page.locator('audio').evaluate(audio=>audio.play());await page.waitForTimeout(400);
  assert.ok(await page.locator('audio').evaluate(audio=>audio.currentTime>0),'real native audio playback');
  await page.getByRole('button',{name:'Article and session actions'}).click();await page.getByRole('button',{name:'End session',exact:true}).click();
  await page.getByRole('button',{name:'Review session',exact:true}).first().click();await page.getByRole('heading',{name:'Review session'}).waitFor();
  assert.match(await page.locator('.session-review-stats').innerText(),/Audio played\s+1/);
  items[3].item.media_type='article';items[3].item.url='https://example.com/article-104';
  assert.deepEqual(errors,[]);
  console.log(`${engine}: hold image, broad open, Back/Next, seen-only review, frozen stats, failed/successful saves, reload, extension, 320px, seven gesture guards, bottom continuation, dark/e-ink and native audio playback PASS`);
 } finally { await browser.close(); }
}
