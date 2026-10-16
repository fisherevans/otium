(() => {
    'use strict';
    const app=window.afterglow,main=document.querySelector('#main');
    const blocked='button,a,input,select,textarea,video,audio,[contenteditable]';
    const selected=()=>Boolean(window.getSelection()?.toString());
    const zoomed=()=>Math.abs((window.visualViewport?.scale||1)-1)>.02;
    const modalOpen=()=>Boolean(document.querySelector('dialog[open]'));
    let hold=null,tap=null,readerTouch=null,suppressUntil=0;
    const points=new Set();

    function cancelHold(){if(hold)clearTimeout(hold.timer);hold=null;}
    function clearReader(){readerTouch=null;document.querySelector('.reader-next')?.classList.remove('ready');}
    function suppressClick(){suppressUntil=performance.now()+700;}
    document.addEventListener('pointerdown',event=>{
        points.add(event.pointerId);
        if(points.size>1&&tap)tap.cancelled=true;
        if(points.size===1&&event.button===0&&event.target.closest(".brief-page[data-open],.reader-image"))tap={id:event.pointerId,x:event.clientX,y:event.clientY,cancelled:false};
        if(points.size!==1||!event.isPrimary||event.button!==0){cancelHold();return;}
        const image=event.target.closest('[data-full-image]');
        if(!image||modalOpen()||zoomed())return;
        const pending={id:event.pointerId,x:event.clientX,y:event.clientY,timer:null,route:location.hash};
        pending.timer=setTimeout(()=>{
            if(hold!==pending||points.size!==1||!image.isConnected||pending.route!==location.hash||modalOpen())return;
            if(tap)tap.cancelled=true;
            suppressClick();app.revealImage(image.dataset.fullImage);cancelHold();
        },500);
        hold=pending;
    },{passive:true});
    document.addEventListener('pointermove',event=>{
        if(tap&&event.pointerId===tap.id&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>10)tap.cancelled=true;
        if(hold&&event.pointerId===hold.id&&Math.hypot(event.clientX-hold.x,event.clientY-hold.y)>10)cancelHold();
    },{passive:true});
    for(const name of ['pointerup','pointercancel'])document.addEventListener(name,event=>{if(tap?.id===event.pointerId){if(tap.cancelled||name==="pointercancel")suppressClick();tap=null;}points.delete(event.pointerId);cancelHold();},{passive:true});
    document.addEventListener('contextmenu',event=>{
        const image=event.target.closest('[data-full-image]');
        if(image){event.preventDefault();cancelHold();suppressClick();if(!modalOpen())app.revealImage(image.dataset.fullImage);}
    });

    // Reader continuation must begin at the bottom; ordinary scrolling never arms it.
    document.addEventListener('touchstart',event=>{
        clearReader();
        if(event.touches.length!==1||modalOpen()||zoomed()||selected())return;
        if(!location.hash.startsWith('#reader/'))return;
        const target=event.target,point=event.touches[0],cue=target.closest('.reader-next');
        if(!main.contains(target)||target.closest('[data-full-image],video,audio')||(target.closest(blocked)&&!cue))return;
        readerTouch={id:point.identifier,x:point.clientX,y:point.clientY,dx:0,dy:0,axis:null,at:performance.now(),bottom:main.scrollHeight-main.clientHeight-main.scrollTop<=4,route:location.hash};
    },{passive:true});
    document.addEventListener('touchmove',event=>{
        if(!readerTouch)return;
        if(event.touches.length!==1||zoomed()||selected()||modalOpen()){clearReader();return;}
        const point=event.touches[0];
        if(point.identifier!==readerTouch.id){clearReader();return;}
        readerTouch.dx=point.clientX-readerTouch.x;readerTouch.dy=point.clientY-readerTouch.y;
        const {dx,dy,bottom}=readerTouch;
        if(!readerTouch.axis&&Math.hypot(dx,dy)>12){
            readerTouch.axis=Math.abs(dy)>Math.abs(dx)*1.2?(dy<0?'up':'down'):Math.abs(dx)>Math.abs(dy)*1.2?(dx>0?'right':'left'):'scroll';
        }
        const upward=readerTouch.axis==='up'&&bottom&&app.canAdvanceReader()&&dy<-12&&-dy>Math.abs(dx)*1.5;
        const backward=readerTouch.axis==='right'&&readerTouch.x>24&&dx>14&&dx>Math.abs(dy)*1.5;
        if((upward||backward)&&event.cancelable)event.preventDefault();
        document.querySelector('.reader-next')?.classList.toggle('ready',upward&&-dy>=90);
    },{passive:false});
    document.addEventListener('touchend',event=>{
        const gesture=readerTouch;clearReader();
        if(!gesture||event.touches.length||gesture.route!==location.hash||modalOpen()||selected()||zoomed())return;
        const point=[...event.changedTouches].find(t=>t.identifier===gesture.id);if(!point)return;
        const dx=point.clientX-gesture.x,dy=point.clientY-gesture.y,elapsed=performance.now()-gesture.at;
        if(elapsed>900)return;
        if(gesture.axis==='up'&&gesture.bottom&&app.canAdvanceReader()&&dy<=-90&&-dy>Math.abs(dx)*1.5){suppressClick();app.advanceReader();}
        else if(gesture.axis==='right'&&gesture.x>24&&dx>=90&&dx>Math.abs(dy)*1.5){suppressClick();app.goBack();}
    },{passive:true});
    document.addEventListener('touchcancel',()=>{clearReader();cancelHold();},{passive:true});
    for(const event of ['hashchange','otium:navigate'])window.addEventListener(event,()=>{clearReader();cancelHold();points.clear();tap=null;});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){clearReader();cancelHold();points.clear();}});

    // A normal image tap reads; holding opens the whole image. Media owns its controls.
    document.addEventListener('click',event=>{
        const page=event.target.closest('.brief-page[data-open]');
        if((page||event.target.closest('.reader-image'))&&performance.now()<suppressUntil&&event.detail!==0){event.preventDefault();event.stopImmediatePropagation();return;}
        if(page&&!event.target.closest(blocked)&&!selected()&&!modalOpen()){
            event.preventDefault();app.action('read:'+page.dataset.open);
        }
    },{capture:true});
})();
