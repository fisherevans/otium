// Browser API fixtures only; no account writes. Run against Vite with BASE_URL.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const {chromium,webkit,firefox}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base=process.env.BASE_URL || 'http://127.0.0.1:5173';
for(const [name,type] of [['chromium',chromium],['webkit',webkit],['firefox',firefox]].filter(([name])=>(process.env.BROWSERS||'chromium,webkit').split(',').includes(name))) {
 const b=await type.launch();const p=await b.newPage({viewport:{width:390,height:664},hasTouch:true});const errors=[];p.on('pageerror',e=>errors.push(e.message));
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
 await p.getByRole('button',{name:'Start Reading',exact:true}).click();
 await p.getByRole('alert').filter({hasText:'No new items match'}).waitFor();assert.equal(requests[0].media,'read');assert.equal(requests[0].duration_min,10);
 await p.getByRole('button',{name:'Video Preset',exact:false}).click();
 await p.waitForTimeout(50);assert.equal(requests[1].media,'video');assert.equal(requests[1].duration_min,40);
 await p.getByRole('button',{name:'Custom session',exact:true}).click();
 for(const [width,height] of [[390,664],[320,568]]) {
  await p.setViewportSize({width,height});
  assert.equal(await p.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1),true,`${name} ${width} custom has no page scroll`);
  const save=await p.getByRole('button',{name:'Save preset',exact:true}).boundingBox();const bar=await p.locator('.context-instrument').boundingBox();assert.ok(save.y+save.height<=bar.y,`${name} save above instrument`);
 }
 await p.getByRole('combobox',{name:'Scope'}).selectOption('news');
 await p.getByRole('button',{name:'Reading',exact:true}).click();
 await p.getByRole('button',{name:'Topics, sections and Shorts'}).click();
 await p.getByRole('checkbox',{name:'World',exact:true}).uncheck();
 await p.getByRole('button',{name:'Done',exact:true}).click();
 await p.getByRole('button',{name:'Start',exact:true}).click();await p.waitForTimeout(50);
 assert.deepEqual(requests[2],{duration_min:10,themes:['local'],sections:[],include_shorts:true,media:'read'});
 await p.getByRole('button',{name:'Save preset',exact:true}).click();
 await p.getByRole('textbox',{name:'Name',exact:true}).fill('Local reading');
 await p.getByRole('checkbox',{name:'Use as default'}).check();
 await p.getByRole('dialog',{name:'Save preset',exact:true}).getByRole('button',{name:'Save preset',exact:true}).click();
 await p.getByRole('button',{name:'Back to sessions',exact:true}).click();await p.getByRole('button',{name:'Start Local reading',exact:true}).waitFor();
 await p.reload();await p.getByRole('button',{name:'Start Local reading',exact:true}).waitFor();
 // Populate repeated recent state and verify it stays reachable without scrolling.
 await p.evaluate(()=>{const k='otium.session-presets.v1.999';const d=JSON.parse(localStorage.getItem(k));const s={minutes:25,sections:[],excluded:[],media:'all',includeShorts:true};d.recent=[s];d.lastKey=JSON.stringify([25,[],[],'all',true]);d.consecutive=2;localStorage.setItem(k,JSON.stringify(d));});
 await p.reload();await p.getByRole('button',{name:'Used twice. Save as preset?'}).waitFor();
 assert.equal(await p.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1),true,`${name} populated start has no page scroll`);
 await p.getByRole('button',{name:'Dismiss preset suggestion'}).click();await p.reload();await p.getByRole('heading',{name:'New session'}).waitFor();assert.equal(await p.getByRole('button',{name:'Used twice. Save as preset?'}).count(),0);
 activeSession=true;await p.reload();await p.getByRole('button',{name:'Resume',exact:true}).waitFor();assert.equal(await p.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1),true,`${name} resumable start has no page scroll`);await p.getByRole('button',{name:'Resume',exact:true}).click();await p.waitForURL('**/session/resumable-session');
 assert.deepEqual(errors,[]);await b.close();console.log(name,'launcher load retry, media/scope requests, empty supply response, preset save/reload/default, repeat dismissal, compact viewport PASS');
}
