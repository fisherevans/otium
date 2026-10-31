// Browser API fixtures only; no account writes. Run against Vite with BASE_URL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const {chromium,webkit,firefox}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base=process.env.BASE_URL || 'http://127.0.0.1:5173';
for(const [name,type] of [['chromium',chromium],['webkit',webkit],['firefox',firefox]].filter(([name])=>(process.env.BROWSERS||'chromium,webkit').split(',').includes(name))) {
 const b=await type.launch();const p=await b.newPage({viewport:{width:390,height:664},hasTouch:true});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(() => {
  const key='otium.session-presets.v1.999';
  if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
   presets:[{id:'reading',name:'Reading',setup:{minutes:10,sections:[],excluded:[],media:'read',includeShorts:true}},
    {id:'video',name:'Video',setup:{minutes:40,sections:[],excluded:[],media:'video',includeShorts:true}}],
   defaultId:'reading',recent:[],lastKey:'',consecutive:0,dismissed:[],sessions:{}
  }));
 });
 const topics=[{id:1,name:'Local',slug:'local',section_slug:'news'},{id:2,name:'World',slug:'world',section_slug:'news'},{id:3,name:'Films',slug:'films',section_slug:'videos'}];
 const sections=[{id:1,name:'News',slug:'news',topic_count:2},{id:2,name:'Videos',slug:'videos',topic_count:1}];
 let failLoad=true, activeSession=false;const requests=[];
 await p.route('**/api/v1/**',async r=>{
  const path=new URL(r.request().url()).pathname;
  if(path.endsWith('/users/me'))return r.fulfill({json:{id:999,username:'fixture',name:'Fixture'}});
  if(path.endsWith('/topics'))return failLoad?r.fulfill({status:503,body:'Fixture unavailable'}):r.fulfill({json:topics});
  if(path.endsWith('/sections'))return r.fulfill({json:sections});
  if(path.endsWith('/sources'))return r.fulfill({json:[{id:1,title:'Local news',kind:'rss',topic_slug:'local',unseen_count:4},{id:2,title:'World news',kind:'rss',topic_slug:'world',unseen_count:5},{id:3,title:'Films',kind:'youtube',topic_slug:'films',unseen_count:3}]});
  if(path.endsWith('/sessions')&&r.request().method()==='POST'){requests.push(r.request().postDataJSON());return r.fulfill({json:{session_id:'',items:[]}});}
  if(path.endsWith('/sessions/current'))return activeSession?r.fulfill({json:{session_id:'resumable-session',duration_min:10,cursor:1,items:[],themes:[]}}):r.fulfill({status:204});
  if(path.endsWith('/preferences'))return r.fulfill({json:{presets:[5,10,20,40]}});
  return r.fulfill({json:{}});
 });
 await p.goto(base);
 await p.getByRole('heading',{name:"Couldn't load your library"}).waitFor();failLoad=false;await p.getByRole('button',{name:'Retry',exact:true}).click();
 const starters=[
  ['News',{duration_min:10,themes:[],sections:['news'],content_types:['article']}],
  ['Shorts',{duration_min:10,themes:[],sections:[],content_types:['short']}],
  ['Long videos',{duration_min:40,themes:[],sections:[],content_types:['long']}],
 ];
 await p.getByRole('button',{name:'Start News',exact:true}).waitFor();
 assert.equal(await p.getByRole('button',{name:'Start Reading',exact:true}).count(),0);
 assert.equal(await p.getByRole('button',{name:'Start Video',exact:true}).count(),0);
 if(process.env.ARTIFACT_DIR) fs.mkdirSync(process.env.ARTIFACT_DIR,{recursive:true});
 for(const [width,height] of [[320,568],[390,664]]) {
  await p.setViewportSize({width,height});await p.evaluate(()=>document.fonts.ready);
  assert.equal(await p.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1),true,`${name} ${width} starters have no page scroll`);
  for(const [label] of starters) {
   for(const action of ['Start','Customize']) {
    const button=p.getByRole('button',{name:`${action} ${label}`,exact:true});
    const bounds=await button.boundingBox();
    assert.ok(bounds&&bounds.width>=44&&bounds.height>=44&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1,`${name} ${width} ${action} ${label} visible with 44px target: ${JSON.stringify(bounds)}`);
   }
  }
  if(process.env.ARTIFACT_DIR) await p.screenshot({path:`${process.env.ARTIFACT_DIR}/${name}-home-${width}.png`,fullPage:true});
 }
 for(const [label,expected] of starters) {
  const before=requests.length;
  await Promise.all([p.waitForResponse(r=>r.url().endsWith('/sessions')&&r.request().method()==='POST'),p.getByRole('button',{name:`Start ${label}`,exact:true}).click()]);
  await p.getByRole('alert').filter({hasText:'No new items match'}).waitFor();
  assert.equal(requests.length,before+1,`${name} ${label} starts in one click`);
  assert.deepEqual(requests.at(-1),expected);
 }
 await p.getByRole('button',{name:'Customize Long videos',exact:true}).click();
 assert.equal(await p.getByRole('button',{name:'Articles',exact:true}).getAttribute('aria-pressed'),'false');
 assert.equal(await p.getByRole('button',{name:'Long videos',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await p.getByRole('button',{name:'Short videos',exact:true}).getAttribute('aria-pressed'),'false');
 await p.getByRole('button',{name:'10 min',exact:true}).click();
 for(const [width,height] of [[390,664],[320,568]]) {
  await p.setViewportSize({width,height});
  assert.equal(await p.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1),true,`${name} ${width} custom has no page scroll`);
  await p.evaluate(()=>document.fonts.ready);
  if(process.env.ARTIFACT_DIR) await p.screenshot({path:`${process.env.ARTIFACT_DIR}/${name}-custom-${width}.png`,fullPage:true});
  const save=await p.getByRole('button',{name:'Save preset',exact:true}).boundingBox();const bar=await p.locator('.context-instrument').boundingBox();assert.ok(save.y+save.height<=bar.y,`${name} ${width} save above instrument: ${JSON.stringify({save,bar})}`);
 }
 await p.getByRole('combobox',{name:'Scope'}).selectOption('news');
 await p.getByRole('button',{name:'Articles',exact:true}).click();
 await p.getByRole('button',{name:'Long videos',exact:true}).click();
 await p.getByRole('button',{name:'Topics and sections'}).click();
 await p.getByRole('checkbox',{name:'World',exact:true}).uncheck();
 await p.getByRole('button',{name:'Done',exact:true}).click();
 await Promise.all([p.waitForResponse(r=>r.url().endsWith('/sessions')&&r.request().method()==='POST'),p.getByRole('button',{name:'Start',exact:true}).click()]);
 assert.deepEqual(requests.at(-1),{duration_min:10,themes:['local'],sections:[],content_types:['article']});
 // Every nonempty combination must reach the API unchanged; no selection cannot start or save.
 const typeLabels={article:'Articles',long:'Long videos',short:'Short videos'};
 async function selectContent(selected) {
  for (const [type,label] of Object.entries(typeLabels)) {
   const button=p.getByRole('button',{name:label,exact:true});
   if ((await button.getAttribute('aria-pressed')==='true')!==selected.includes(type)) await button.click();
  }
 }
 await selectContent([]);
 assert.equal(await p.getByRole('button',{name:'Start',exact:true}).isDisabled(),true);
 assert.equal(await p.getByRole('button',{name:'Save preset',exact:true}).isDisabled(),true);
 for (const selected of [['article'],['long'],['short'],['article','long'],['article','short'],['long','short'],['article','long','short']]) {
  await selectContent(selected);
  await Promise.all([p.waitForResponse(r=>r.url().endsWith('/sessions')&&r.request().method()==='POST'),p.getByRole('button',{name:'Start',exact:true}).click()]);
  assert.deepEqual(requests.at(-1),{duration_min:10,themes:['local'],sections:[],content_types:selected});
 }
 // Inspectable artifacts use the same mocked screen, without live account data.
 if(process.env.ARTIFACT_DIR) {
  fs.mkdirSync(process.env.ARTIFACT_DIR,{recursive:true});
  await p.getByRole('button',{name:'Back to sessions',exact:true}).click();
  await p.getByRole('button',{name:'Customize Shorts',exact:true}).click();
  for (const [width,height] of [[320,568],[390,664],[1280,800]]) {
   await p.setViewportSize({width,height});await selectContent(['short']);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.equal(await p.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1),true,`${name} ${width} Shorts custom has no page scroll`);
   await p.screenshot({path:`${process.env.ARTIFACT_DIR}/${name}-shorts-${width}.png`,fullPage:true});
  }
  await p.setViewportSize({width:320,height:568});
  await p.getByRole('combobox',{name:'Scope'}).selectOption('news');
  await p.getByRole('button',{name:'Topics and sections'}).click();
  await p.getByRole('checkbox',{name:'World',exact:true}).uncheck();
  await p.getByRole('button',{name:'Done',exact:true}).click();
 }
 await selectContent(['article']);
 await p.getByRole('button',{name:'Save preset',exact:true}).click();
 await p.getByRole('textbox',{name:'Name',exact:true}).fill('Local reading');
 await p.getByRole('checkbox',{name:'Use as default'}).check();
 await p.getByRole('dialog',{name:'Save preset',exact:true}).getByRole('button',{name:'Save preset',exact:true}).click();
 await p.getByRole('button',{name:'Back to sessions',exact:true}).click();await p.getByRole('button',{name:'Start Local reading',exact:true}).waitFor();
 await p.reload();await p.getByRole('button',{name:'Start Local reading',exact:true}).waitFor();
 // Repeated recent setups remain available in their sheet, leaving the starters compact.
 await p.evaluate(()=>{const k='otium.session-presets.v1.999';const d=JSON.parse(localStorage.getItem(k));const s={minutes:25,sections:[],excluded:[],media:'all',includeShorts:true};d.recent=[s];d.lastKey=JSON.stringify([25,[],[],'all',true]);d.consecutive=2;localStorage.setItem(k,JSON.stringify(d));});
 await p.reload();await p.getByRole('button',{name:'Recent sessions',exact:true}).waitFor();
 assert.equal(await p.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1),true,`${name} populated start has no page scroll`);
 const recentBounds=await p.getByRole('button',{name:'Recent sessions',exact:true}).boundingBox();
 const homeBar=await p.locator('.context-instrument').boundingBox();
 assert.ok(recentBounds.y+recentBounds.height<=homeBar.y,`${name} populated home footer above instrument: ${JSON.stringify({recentBounds,homeBar})}`);
 for(const [label] of starters) await p.getByRole('button',{name:`Start ${label}`,exact:true}).waitFor();
 if(process.env.ARTIFACT_DIR) await p.screenshot({path:`${process.env.ARTIFACT_DIR}/${name}-populated-home-320.png`,fullPage:true});
 assert.equal(await p.getByRole('button',{name:'Used twice. Save as preset?'}).count(),0);
 await p.getByRole('button',{name:'Recent sessions',exact:true}).click();
 await p.getByRole('button',{name:'Used twice. Save as preset?'}).waitFor();
 await p.getByRole('button',{name:'Dismiss preset suggestion'}).click();
 await p.reload();await p.getByRole('button',{name:'Recent sessions',exact:true}).click();
 assert.equal(await p.getByRole('button',{name:'Used twice. Save as preset?'}).count(),0);
 await p.getByRole('button',{name:'25 min all content',exact:false}).click();
 await p.getByRole('heading',{name:'Custom session',exact:true}).waitFor();
 assert.equal(await p.getByRole('spinbutton',{name:'Minutes',exact:true}).inputValue(),'25');
 await p.getByRole('button',{name:'Back to sessions',exact:true}).click();
 await p.getByRole('button',{name:'Custom session',exact:true}).click();
 await selectContent(['short']);
 await p.getByRole('button',{name:'Save preset',exact:true}).click();
 await p.getByRole('textbox',{name:'Name',exact:true}).fill('Short break');
 await p.getByRole('checkbox',{name:'Use as default'}).check();
 await p.getByRole('dialog',{name:'Save preset',exact:true}).getByRole('button',{name:'Save preset',exact:true}).click();
 await p.getByRole('button',{name:'Back to sessions',exact:true}).click();await p.reload();
 await Promise.all([p.waitForResponse(r=>r.url().endsWith('/sessions')&&r.request().method()==='POST'),p.getByRole('button',{name:'Start Short break',exact:true}).click()]);
 assert.deepEqual(requests.at(-1).content_types,['short']);
 await p.getByRole('button',{name:'Customize Short break',exact:true}).click();
 assert.equal(await p.getByRole('button',{name:'Articles',exact:true}).getAttribute('aria-pressed'),'false');
 assert.equal(await p.getByRole('button',{name:'Long videos',exact:true}).getAttribute('aria-pressed'),'false');
 assert.equal(await p.getByRole('button',{name:'Short videos',exact:true}).getAttribute('aria-pressed'),'true');
 await p.getByRole('button',{name:'Back to sessions',exact:true}).click();
 activeSession=true;await p.reload();await p.getByRole('button',{name:'Resume',exact:true}).waitFor();assert.equal(await p.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1),true,`${name} resumable start has no page scroll`);await p.getByRole('button',{name:'Resume',exact:true}).click();await p.waitForURL('**/session/resumable-session');
 // Shared setup links preselect a custom draft without starting or replacing device defaults.
 const beforeLinkRequests=requests.length;
 const beforeLinkStorage=await p.evaluate(()=>localStorage.getItem('otium.session-presets.v1.999'));
 await p.goto(`${base}/?sections=videos&content=short&minutes=15`);
 await p.getByRole('heading',{name:'Custom session',exact:true}).waitFor();
 assert.equal(await p.getByRole('combobox',{name:'Scope'}).inputValue(),'videos');
 assert.equal(await p.getByRole('spinbutton',{name:'Minutes',exact:true}).inputValue(),'15');
 assert.equal(await p.getByRole('button',{name:'Short videos',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await p.getByRole('button',{name:'Articles',exact:true}).getAttribute('aria-pressed'),'false');
 assert.equal(await p.getByRole('button',{name:'Long videos',exact:true}).getAttribute('aria-pressed'),'false');
 assert.equal(requests.length,beforeLinkRequests);
 assert.equal(await p.evaluate(()=>localStorage.getItem('otium.session-presets.v1.999')),beforeLinkStorage);
 await p.goto(`${base}/?sections=missing&content=short&minutes=15`);
 await p.getByRole('alert').filter({hasText:'This session link has an unavailable'}).waitFor();
 assert.equal(await p.getByRole('heading',{name:'Custom session',exact:true}).count(),0);
 assert.equal(requests.length,beforeLinkRequests);
 assert.deepEqual(errors,[]);await b.close();console.log(name,'launcher load retry, three one-click starters with exact scope/content, 44px targets, all seven content combinations, legacy preset migration, scope requests, empty supply response, preset save/reload/default, recent preview and repeat dismissal, setup links without auto-start, compact viewport PASS');
}
