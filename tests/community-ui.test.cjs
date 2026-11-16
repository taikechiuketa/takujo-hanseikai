const {JSDOM}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('community.html','utf8'),code=fs.readFileSync('community.js','utf8');
const fixture={id:'event-one',name:'たけち',title:'土曜の募集',date:'2026-11-21',start:'18:00',end:'',place:'たけちゃお',rule:'normal',existing:2,vacancies:1,remaining:1,participants:[],note:'<img src=x onerror=alert(1)>',mine:false,joined:false,following:false,closed:0,version:1};
const calls=[];let failPost=false;let deleted=false;let actorEvent=structuredClone(fixture);let messages=[];
const dom=new JSDOM(html,{url:'https://taikechiuketa.github.io/takujo-hanseikai/community.html',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.HanseiCommunityContext=async()=>({share:'11111111-1111-4111-8111-111111111111'});w.scrollTo=()=>{};w.confirm=()=>true;w.AbortSignal.timeout=()=>new w.AbortController().signal;
w.fetch=async(url,options)=>{const path=new URL(url).pathname.replace('/api/community','');calls.push([path,options.method]);const body=options.body?JSON.parse(options.body):{};let data={};let status=200;
if(path==='/config')data={group:'卓A',room:'group-test'};else if(path==='/events'&&options.method==='GET')data={events:deleted?[]:[actorEvent]};else if(path==='/events/event-one'&&options.method==='GET')data=actorEvent;
else if(path==='/events/event-one'&&options.method==='DELETE'){deleted=true;}
else if(path==='/events/event-one/messages'&&options.method==='GET')data={messages};
else if(path==='/events/event-one/join'){actorEvent={...actorEvent,joined:true,remaining:0,participants:[{name:body.name,mine:true}]};}
else if(path==='/events/event-one/messages'&&options.method==='POST'){if(failPost){status=500;data={error:'テスト通信失敗'};}else messages=[{id:'msg',name:body.name,body:body.body,mine:true,host:false,canDelete:true,created:Date.now()}];}
else if(path==='/events'&&options.method==='POST'){data={id:'event-one'};actorEvent={...actorEvent,...body,mine:true};}
return {ok:status<400,status,json:async()=>data};};
const tick=()=>new Promise(r=>setTimeout(r,20));
(async()=>{w.eval(code);await tick();assert.match(w.document.getElementById('eventList').textContent,/土曜の募集/);assert.equal(w.localStorage.getItem('hansei-community-device-v1').length,64);
w.document.querySelector('[data-open]').click();await tick();assert.equal(w.document.querySelector('#eventDetail img'),null,'untrusted HTML is text');
assert.equal(w.document.getElementById('deleteEvent'),null);w.document.getElementById('joinName').value='かなめ';w.document.getElementById('joinEvent').click();await tick();assert.match(w.document.getElementById('eventDetail').textContent,/満員/);
w.document.getElementById('chatBody').value='18時半からでいい？';failPost=true;w.document.getElementById('chatForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.equal(w.document.getElementById('chatBody').value,'18時半からでいい？');assert.match(w.document.getElementById('chatStatus').textContent,/テスト通信失敗/);
failPost=false;w.document.getElementById('chatForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.equal(w.document.getElementById('chatBody').value,'');assert.match(w.document.getElementById('messages').textContent,/18時半/);
w.document.getElementById('backToList').click();await tick();w.document.getElementById('newEvent').click();assert.equal(w.document.getElementById('eventPlace').value,'いつもの場所');w.document.getElementById('hostName').value='かなめ';w.document.getElementById('eventTitle').value='別の場所で';w.document.getElementById('eventPlace').value='赤羽の雀荘';w.document.getElementById('eventForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.match(w.document.getElementById('eventDetail').textContent,/赤羽の雀荘/);
assert.ok(w.document.getElementById('deleteEvent'));w.confirm=()=>false;w.document.getElementById('deleteEvent').click();await tick();assert.equal(deleted,false);w.confirm=()=>true;w.document.getElementById('deleteEvent').click();await tick();assert.equal(deleted,true);assert.equal(w.document.getElementById('detailPage').hidden,true);assert.match(w.document.getElementById('globalStatus').textContent,/募集を削除しました/);
assert.equal(calls.some(([p])=>p.includes('takechao_private')),false);dom.window.close();console.log('Community UI: create, join, chat, failed-send preservation, HTML escaping and separate storage passed.');})().catch(e=>{dom.window.close();console.error(e);process.exitCode=1;});
