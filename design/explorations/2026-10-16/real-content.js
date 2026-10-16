(() => {
    const data=window.OTIUM_CONTENT;
    if(!data)return;
    const feed=document.querySelector('.feed');
    const template=feed.querySelector('.page[data-kind=article]').cloneNode(true);
    const video=feed.querySelector('.page[data-kind=video]').cloneNode(true);
    const total=data.articles.length+1;
    feed.replaceChildren();
    data.articles.forEach((item,index)=>{
        const page=template.cloneNode(true);
        Object.assign(page.dataset,{title:item.title,source:item.source,article:item.id,kind:'article'});
        const walker=document.createTreeWalker(page,NodeFilter.SHOW_TEXT);
        while(walker.nextNode()){
            const t=walker.currentNode;
            t.textContent=t.textContent.replaceAll('Field Notes',item.source).replaceAll('Maya Chen',item.author||item.source).replaceAll('Places',item.topic).replaceAll('4 min read',item.dateLabel).replaceAll('4 min',item.dateLabel).replaceAll('1 / 3',`${index+1} / ${total}`).replaceAll('1 of 3',`${index+1} of ${total}`);
        }
        const position=page.querySelector('.position');if(position)position.textContent=`${index+1} of ${total}`;
        page.querySelector('h1').textContent=item.title;
        const description=page.querySelector('.description,.summary');description.textContent=item.teaser;
        description.dataset.originalChars=item.summaryChars;
        const img=page.querySelector('img');
        img.src=item.image;img.alt=item.imageAlt||`Article image from ${item.source}`;img.referrerPolicy='no-referrer';
        page.querySelectorAll('[aria-label]').forEach(el=>el.setAttribute('aria-label',el.getAttribute('aria-label').replace('The streets that make us slow down',item.title)));
        feed.append(page);
    });
    video.dataset.sample='illustrative-video';
    const walker=document.createTreeWalker(video,NodeFilter.SHOW_TEXT);
    while(walker.nextNode())walker.currentNode.textContent=walker.currentNode.textContent.replaceAll('2 / 3',`${total} / ${total}`).replaceAll('2 of 3',`${total} of ${total}`).replaceAll('Illustrative motion sample','Illustrative video');
    const videoPosition=video.querySelector('.position');if(videoPosition)videoPosition.textContent=total+' of '+total;feed.append(video);
    document.querySelectorAll('[data-current]').forEach(el=>{
        const parent=el.parentElement;
        const walk=document.createTreeWalker(parent,NodeFilter.SHOW_TEXT);
        while(walk.nextNode()){const t=walk.currentNode;if(t.parentElement!==el)t.textContent=t.textContent.replace('/ 3','/ '+total).replace('of 3','of '+total);}
        if(parent.querySelector('.slash'))parent.lastElementChild.textContent=total;
    });
    const progress=document.querySelector('.progress');if(progress){const label=progress.querySelector('span');progress.querySelectorAll('i').forEach(x=>x.remove());for(let n=0;n<total;n++)progress.insertBefore(document.createElement('i'),label);label.textContent='1 of '+total;}
    const count=document.querySelector('[data-action=end].count');if(count)count.textContent='1 / '+total;
    const style=document.createElement('style');style.textContent=`
        .page h1{overflow-wrap:anywhere;font-size:28px;line-height:1.18;letter-spacing:-.025em}
        .page[data-article] .description,.page[data-article] .summary{font-size:17px;line-height:1.45}
        .reader-copy h1{font-size:30px!important;line-height:1.2!important}
        @media(max-width:350px){.page h1{font-size:26px}.page[data-article] .description,.page[data-article] .summary{font-size:16px}.reader-copy h1{font-size:27px!important}}
        .page[data-article] [data-action=read]{white-space:nowrap}
        .page[data-article] .description,.page[data-article] .summary{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:var(--brief-lines,4);overflow:hidden;flex-shrink:0}
        .page[data-article] .byline,.page[data-article] .credit{overflow-wrap:anywhere}
        .real-note{font:400 14px/1.5 var(--font);color:var(--muted);margin:16px 0}
        .publisher-link{display:inline-flex;align-items:center;min-height:44px;color:var(--text);text-underline-offset:4px}
    `;document.head.append(style);
    function fit(){
        feed.querySelectorAll('[data-article]').forEach(page=>{
            const title=page.querySelector('h1'),img=page.querySelector('img'),desc=page.querySelector('.summary,.description');
            title.style.fontSize='';page.style.setProperty('--brief-lines',4);
            const media=img.parentElement===page||img.classList.contains('hero')?img:img.parentElement;
            media.style.height='';media.style.minHeight='';img.style.height='';img.style.maxHeight='';
            const base=parseFloat(getComputedStyle(title).fontSize);
            const overflow=()=>{const pr=page.getBoundingClientRect(),cs=getComputedStyle(page);const top=pr.top+parseFloat(cs.paddingTop),bottom=pr.bottom-parseFloat(cs.paddingBottom);return [...page.querySelectorAll('h1,img,.description,.summary,button,.byline,.credit,.source,.category,.position,.page-foot,.author')].some(el=>{const r=el.getBoundingClientRect();return r.top<top-1||r.bottom>bottom+1;});};
            for(let lines=4;lines>=2&&overflow();lines--)page.style.setProperty('--brief-lines',lines);
            let h=media.getBoundingClientRect().height;
            while(overflow()&&h>100){h-=12;media.style.height=h+'px';media.style.minHeight='0';img.style.height='100%';img.style.maxHeight='100%';}
            for(let size=base-2;size>=24&&overflow();size-=2)title.style.fontSize=size+'px';
            page.dataset.fitOverflow=String(overflow());
            desc.title='Preview paraphrase. Original feed description: '+page.querySelector('.description,.summary').dataset.originalChars+' characters.';
        });
    }
    window.fitRealContent=fit;
    document.fonts.ready.then(fit);window.addEventListener('resize',fit);
    feed.querySelectorAll('img').forEach(img=>img.addEventListener('load',fit));
})();
