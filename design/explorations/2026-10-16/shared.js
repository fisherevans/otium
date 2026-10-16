(() => {
    'use strict';
    const paths = {
        book:'M3 5c3-1 6-1 9 1v15c-3-2-6-2-9-1V5Zm18 0c-3-1-6-1-9 1v15c3-2 6-2 9-1V5Z',
        library:'M5 4v16M10 4v16M15 5l4 14',
        bookmark:'M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1Z',
        person:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
        more:'M5 12h.01M12 12h.01M19 12h.01',
        chevron:'m9 5 7 7-7 7',back:'m14 5-7 7 7 7',close:'m6 6 12 12M6 18 18 6',
        play:'m9 5 11 7-11 7V5Z',share:'M12 15V2m-4 4 4-4 4 4M5 10v10h14V10',
        plus:'M12 5v14M5 12h14',clock:'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
        check:'m5 12 4 4L19 6',sun:'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
        arrowup:'M12 20V4m-6 6 6-6 6 6',sliders:'M4 7h16M4 17h16M8 4v6M16 14v6'
    };
    const mark='<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" transform="translate(0 64) scale(1 -1)" d="M32 6C17 6 7 17 7 32s10 26 25 26l25-25C57 17 47 6 32 6Zm0 9c10 0 16 7 16 17H33v17c-10 1-17-6-17-17 0-10 6-17 16-17Z"/></svg>';
    function icons(root=document) {
        root.querySelectorAll('[data-icon]').forEach(el=>{
            const stroke=el.dataset.icon==='more'?3.4:1.8;
            el.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="'+stroke+'" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[el.dataset.icon]||paths.more)+'"/></svg>';
        });
        root.querySelectorAll('[data-logo]').forEach(el=>el.innerHTML=mark);
    }
    const feed=document.querySelector('.feed');
    const pages=[...document.querySelectorAll('.page')];
    const saved=new Set();
    const realArticles=window.OTIUM_CONTENT?.articles||[];
    const articleFor=p=>realArticles.find(a=>a.id===p?.dataset.article);
    let current=pages[0], previousFocus=null, toastTimer, duration='10 min', scope='Everything';
    const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const icon=n=>'<span data-icon="'+n+'"></span>';
    const row=(label,action,kind='chevron',sub='')=>'<button class="group-row" data-action="'+action+'">'+icon(kind)+'<span class="grow">'+label+'</span>'+(sub?'<small>'+sub+'</small>':'')+icon('chevron')+'</button>';
    const dialog=document.createElement('dialog');dialog.className='detail';document.body.append(dialog);
    function pause(){document.querySelectorAll('video').forEach(v=>v.pause());}
    function close(){dialog.close();pause();if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}
    function show(title,body) {
        pause();
        if(!dialog.open)previousFocus=document.activeElement;
        dialog.innerHTML='<header class="detail-head"><button data-action="close" aria-label="Back">'+icon('back')+'</button><span class="detail-title">'+esc(title)+'</span></header><div class="detail-body">'+body+'</div>';
        icons(dialog);if(!dialog.open)dialog.showModal();dialog.querySelector('button')?.focus({preventScroll:true});
    }
    function toast(text) {
        document.querySelector('.toast')?.remove();clearTimeout(toastTimer);
        const el=document.createElement('div');el.className='toast';el.role='status';el.textContent=text;document.body.append(el);
        toastTimer=setTimeout(()=>el.remove(),2000);
    }
    function reading() {
        const p=current||pages[0],title=p.dataset.title,source=p.dataset.source;
        const item=articleFor(p);
        if(item){
            show(source,'<article class="reader-copy"><div class="reader-meta">'+esc(item.author)+' · '+esc(item.dateLabel)+'</div><h1>'+esc(title)+'</h1><img class="reader-hero" src="'+esc(item.image)+'" alt="'+esc(item.imageAlt||'Article image')+'"><p class="real-note">Photo: '+esc(item.imageCredit)+'</p><p>'+esc(item.teaser)+'</p><p class="real-note">Preview paraphrase matched to the feed description length. This is an excerpt preview, not the publisher’s full article.</p><a class="publisher-link" href="'+esc(item.url)+'" target="_blank" rel="noopener noreferrer">Read the original at '+esc(source)+' ↗</a><div class="choices"><button class="pill" data-action="save">'+icon('bookmark')+'Save</button><button class="pill" data-action="share">'+icon('share')+'Share</button></div><p class="real-note">Original headline: '+item.titleChars+' characters. Feed teaser after Otium’s ingestion limit: '+item.summaryChars+' characters. Source image: '+item.imageWidth+' × '+item.imageHeight+'. '+esc(item.selection)+'</p></article>');return;
        }
        show(source,'<article class="reader-copy"><div class="reader-meta">'+esc(source)+' · '+(p.dataset.kind==='video'?'Alex Morgan · 8 min watch':source==='Small Hours'?'Sam Rivera · 3 min read':'Maya Chen · 4 min read')+'</div><h1>'+esc(title)+'</h1><img class="reader-hero" src="'+(p.querySelector('img')?.getAttribute('src')||'assets/landscape.jpg')+'" alt="A place to pause"><p>Some places seem to ask nothing of us. We pass through them a little more slowly, notice the light, and find ourselves looking up.</p><p>It rarely takes a grand gesture. A tree provides shade. A bench faces the street. The distance between one doorway and the next gives the walk its rhythm.</p><p>These small details make room for ordinary life. They offer a choice to linger, without turning the choice into an obligation.</p><p>The useful question is not how much a place can show us. It is how comfortably it lets us pay attention.</p><div class="choices"><button class="pill" data-action="save">'+icon('bookmark')+'Save</button><button class="pill" data-action="share">'+icon('share')+'Share</button></div><p class="muted">Illustrative article for comparing design directions.</p></article>');
    }
    function screen(action) {
        if(action==='brief'){close();const selected=pages.find(p=>p.dataset.article===new URLSearchParams(location.search).get('sample'))||pages[0];current=selected;selected.scrollIntoView({block:'start',behavior:'instant'});return;}
        if(action==='video'){close();pages.find(p=>p.dataset.kind==='video')?.scrollIntoView({block:'start',behavior:'instant'});return;}
        if(action.startsWith('read:')){current=pages.find(p=>p.dataset.article===action.slice(5))||current;reading();return;}
        if(action==='reader'||action==='read'){reading();return;}
        if(realArticles.length&&action==='library'){
            show('Library','<h1>Your sources, at your pace.</h1><p class="muted">Real article samples used by all ten directions.</p><div class="group">'+[...new Set(realArticles.map(a=>a.source))].map(source=>row(esc(source),'source:'+source,'book')).join('')+'</div><p class="real-note">This source list is the comparison fixture. Your account is unchanged.</p>');return;
        }
        if(realArticles.length&&(action==='source'||action.startsWith('source:'))){
            const source=action.startsWith('source:')?action.slice(7):current.dataset.source;
            show(source,'<h1>'+esc(source)+'</h1><div class="group">'+realArticles.filter(a=>a.source===source).map(a=>row(esc(a.title),'read:'+a.id,'book')).join('')+'</div>');return;
        }
        if(realArticles.length&&action==='why'){
            const a=articleFor(current);show('Why this sample','<h1>A measured comparison.</h1><p class="reader-copy">'+esc(a?.selection||'Illustrative video retained for media comparison.')+'</p><p class="real-note">The same sample appears in every direction. Read the sampling notes in the gallery for the date window and coverage limits.</p>');return;
        }
        if(action==='library'){
            show('Library','<h1>Your sources, at your pace.</h1><p class="muted">Choose what makes up a session.</p><div class="choices"><button class="primary" data-action="add">'+icon('plus')+'Add source</button><button class="pill" data-action="import">Import</button></div><div class="group">'+row('Places','topic','library','3 sources')+row('Outdoors','topic','library','2 sources')+row('Living','topic','library','4 sources')+'</div><div class="group">'+row('Organize sections','organize','sliders')+'</div>');return;
        }
        if(action==='topic'){show('Places','<h1>Places</h1><p class="muted">Streets, spaces, and the way we live.</p><div class="group">'+row('Field Notes','source','book')+row('Open Frame','source','play')+row('Small Hours','source','book')+'</div><button class="primary" data-action="add">Add source</button>');return;}
        if(action==='source'){show('Field Notes','<h1>Field Notes</h1><p class="muted">Maya Chen · Articles · Places</p><div class="group">'+row('Browse articles','read','book')+row('Representation','representation','sliders','Normal')+row('Archive after','archive','clock','30 days')+'</div>');return;}
        if(action==='saved'){
            const list=[...saved];
            show('Saved','<h1>For another moment.</h1><div class="choices"><button class="pill" data-action="collections">All saved</button><button class="pill" data-action="collections">Read later</button></div>'+(list.length?'<div class="group">'+list.map(t=>row(esc(t),'read:'+(realArticles.find(a=>a.title===t)?.id||''),'bookmark')).join('')+'</div>':'<p class="muted">Save a brief and it will wait here. Nothing is marked unread.</p>'));return;
        }
        if(action==='you'){show('You','<h1>A little more your own.</h1><div class="group">'+row('Appearance','appearance','sun')+row('Reading history','history','clock')+row('Insights','insights','sliders')+row('Settings','settings','person')+'</div>');return;}
        if(action==='appearance'){show('Appearance','<h1>Make room for reading.</h1><p class="muted">This preview changes only this concept.</p><div class="group">'+row('E-ink preview','eink','sun',document.body.dataset.eink==='true'?'On':'Off')+'</div><p class="muted">The production app retains type size, reading measure, font, image and card controls. This exploration is about the visual direction.</p>');return;}
        if(action==='eink'){document.body.dataset.eink=document.body.dataset.eink==='true'?'false':'true';screen('appearance');return;}
        if(action==='session'){show('Your session','<h1>How much time is yours?</h1><div class="choices">'+['5 min','10 min','20 min','40 min'].map(d=>'<button class="pill" data-duration="'+d+'" aria-pressed="'+(d===duration)+'">'+d+'</button>').join('')+'</div><p class="muted">What would you like to spend it with?</p><div class="choices">'+['Everything','Places','Outdoors'].map(s=>'<button class="pill" data-scope="'+s+'" aria-pressed="'+(s===scope)+'">'+s+'</button>').join('')+'</div><button class="primary" data-action="begin">Begin session</button><div class="group">'+row('End this session','end','check')+'</div>');return;}
        if(action==='begin'){close();feed?.scrollTo({top:0,behavior:'instant'});toast(duration+' · '+scope);return;}
        if(action==='end'){show('A good place to stop','<div class="end-page"><span data-logo style="width:48px;height:48px"></span><h1>That is your moment.</h1><p>'+pages.length+' briefs. Time spent on purpose.</p><button class="primary" data-action="session">New session</button><button class="pill" data-action="saved">Visit Saved</button></div>');return;}
        if(action==='more'){show('This brief','<h1>'+esc(current.dataset.title)+'</h1><div class="group">'+row('Why this appeared','why','sliders')+row('About this source','source','book')+row('Save to collection','collections','bookmark')+row('Share','share','share')+'</div>');return;}
        if(action==='why'){show('Why this appeared','<h1>Because you chose it.</h1><p class="reader-copy">This source belongs to Places, which is included in your session. Its representation is Normal. The session draws from the sources and topics you choose.</p><button class="pill" data-action="representation">Change representation</button>');return;}
        if(action==='collections'){show('Save to','<h1>A place to return to.</h1><div class="group">'+row('Saved','save-close','bookmark')+row('Read later','save-close','book')+row('Watch later','save-close','play')+'</div>');return;}
        if(action==='representation'||action==='archive'){show(action==='archive'?'Archive after':'Representation','<h1>'+ (action==='archive'?'Keep it current.':'Choose the balance.')+'</h1><div class="choices">'+(action==='archive'?['7 days','30 days','Evergreen']:['Less','Normal','More']).map(t=>'<button class="pill" data-demo-choice="'+t+'">'+t+'</button>').join('')+'</div>');return;}
        if(action==='add'||action==='import'){show(action==='add'?'Add source':'Import sources','<h1>'+(action==='add'?'Something worth following.':'Bring your sources.')+'</h1><p class="muted">'+(action==='add'?'Feed URL or YouTube channel':'An OPML file from your current reader')+'</p><form data-demo-form><input '+(action==='add'?'type="url" placeholder="https://" required':'type="file" accept=".opml,.xml"')+' aria-label="'+(action==='add'?'Source URL':'OPML file')+'"><div class="choices"><button class="primary" type="submit">'+(action==='add'?'Add source':'Import')+'</button></div></form><p class="muted">Design prototype. No account data will change.</p>');return;}
        if(action==='history'){show('Reading history','<h1>Where your attention went.</h1><div class="group">'+pages.filter(p=>p.dataset.kind==='article').map(p=>row(esc(p.dataset.title),'read:'+(p.dataset.article||''),'book','Sample')).join('')+'</div>');return;}
        if(action==='insights'){show('Insights','<h1>A view of your choices.</h1><p class="muted">Descriptive, never a target.</p><div class="group"><div class="group-row">Places <span class="grow"></span>40%</div><div class="group-row">Outdoors <span class="grow"></span>35%</div><div class="group-row">Living <span class="grow"></span>25%</div></div><p class="muted">Illustrative session composition.</p>');return;}
        if(action==='settings'||action==='organize'){show(action==='settings'?'Settings':'Sections','<h1>'+(action==='settings'?'Your reading, your way.':'Keep your interests together.')+'</h1><div class="group">'+row('Session defaults','session','clock')+row('Sources and topics','library','library')+row('Appearance','appearance','sun')+'</div>');return;}
    }
    document.addEventListener('click',e=>{
        const el=e.target.closest('[data-action],[data-duration],[data-scope],[data-demo-choice]');if(!el)return;
        const page=el.closest('.page');if(page)current=page;
        if(el.dataset.duration){duration=el.dataset.duration;screen('session');return;}
        if(el.dataset.scope){scope=el.dataset.scope;screen('session');return;}
        if(el.dataset.demoChoice){toast(el.dataset.demoChoice+' selected');close();return;}
        const action=el.dataset.action;
        if(action==='close'){close();return;}
        if(action==='next'){const i=pages.indexOf(current);if(i<pages.length-1)pages[i+1].scrollIntoView({behavior:'smooth',block:'start'});else screen('end');return;}
        if(action==='save'||action==='save-close'){
            const title=current.dataset.title;
            if(saved.has(title)&&action==='save')saved.delete(title);else saved.add(title);
            pages.forEach(p=>p.querySelectorAll('[data-action=save]').forEach(b=>{b.classList.toggle('saved-on',saved.has(p.dataset.title));b.setAttribute('aria-pressed',String(saved.has(p.dataset.title)));}));
            toast(saved.has(title)?'Saved for later':'Removed from Saved');if(action==='save-close')close();return;
        }
        if(action==='share'){navigator.clipboard?.writeText(articleFor(current)?.url||location.href).then(()=>toast('Preview link copied')).catch(()=>toast('Use your browser to share this preview'));return;}
        screen(action);
    });
    document.addEventListener('submit',e=>{if(e.target.matches('[data-demo-form]')){e.preventDefault();close();toast('Preview only. Your sources are unchanged.');}});
    dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
    window.addEventListener('message',e=>{if(e.data?.type==='preview')screen(e.data.state);});
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){current=entry.target;document.querySelectorAll('[data-current]').forEach(el=>el.textContent=String(pages.indexOf(current)+1));}else entry.target.querySelectorAll('video').forEach(v=>v.pause());}),{root:feed,threshold:.6});
    pages.forEach(p=>observer.observe(p));
    icons();
    const query=new URLSearchParams(location.search);const selected=pages.find(p=>p.dataset.article===query.get('sample'));if(selected)current=selected;const state=query.get('state')||'brief';setTimeout(()=>{if(selected){current=selected;selected.scrollIntoView({block:'start',behavior:'instant'});}screen(state);},100);
    if(new URLSearchParams(location.search).get('eink')==='1')document.body.dataset.eink='true';
    window.otiumPreview={screen,pages,saved};
})();
