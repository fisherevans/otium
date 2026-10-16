import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { Reader } from '../src/components/Reader';
import { Dialog } from '../src/components/Dialog';
import { BottomSheet } from '../src/components/BottomSheet';
import '../src/styles/global.css';
const h = React.createElement;
const item = { id: 901, title: 'A complete article', summary: 'Only the teaser', url: 'https://example.com/story', source_id: 1, media_type: 'article' };
function Harness() {
 const navigate=useNavigate();
 const [defaultSave,setDefaultSave] = React.useState(false);
 const [read,setRead] = React.useState(false), [sheet,setSheet] = React.useState(false), [edit,setEdit] = React.useState(false);
 return h(React.Fragment, null,
 h('button',{id:'reader-trigger',onClick:()=>{setDefaultSave(false);setRead(true);}},'Read article'),
 h('button',{id:'source-trigger',onClick:()=>{setDefaultSave(true);setRead(true);}},'Read source article'),
 h('button',{id:'edit-trigger',onClick:()=>setEdit(true)},'Edit section'),
 h('a',{id:'background',href:'#background'},'Background link'),
 h(Reader,{item:read?item:null,open:read,onClose:()=>setRead(false),onOpen:()=>{},onSave:defaultSave?undefined:()=>setSheet(true)}),
 h(BottomSheet,{open:sheet,kicker:'Save item',onClose:()=>setSheet(false)},h('button',{onClick:()=>setEdit(true)},'New collection'),h('button',{onClick:()=>navigate('/overlay-away')},'Navigate away'),h('button',{onClick:()=>navigate('/overlay-away',{replace:true})},'Replace route'),h('button',{onClick:()=>{setSheet(false);setEdit(true);}},'Replace sheet'),h('button',{onClick:()=>setSheet(false)},'Cancel')),
 h(Dialog,{open:edit,kicker:'Collection name',onClose:()=>setEdit(false)},h('input',{'aria-label':'Name'}),h('button',{onClick:()=>setEdit(false)},'Cancel')));
}
window.transitions=[]; document.addEventListener('transitionrun',e=>window.transitions.push({class:e.target.className,property:e.propertyName}));
function Before() { const navigate=useNavigate(); return h('button',{id:'enter',onClick:()=>navigate('/overlay-check')},'Enter reading list'); }
function Away() { const navigate=useNavigate(); return h('div',null,h('p',{id:'away'},'A different route'),h('button',{onClick:()=>navigate('/overlay-away?again=1',{replace:true})},'Replace again')); }
function HarnessRoutes() { return h(Routes,null,h(Route,{path:'/overlay-before',element:h(Before)}),h(Route,{path:'/overlay-check',element:h(Harness)}),h(Route,{path:'/overlay-away',element:h(Away)})); }
createRoot(document.getElementById('root')).render(h(React.StrictMode,null,h(BrowserRouter,null,h(HarnessRoutes))));
