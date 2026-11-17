const {JSDOM}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {webcrypto}=require('node:crypto');
const html=fs.readFileSync('community.html','utf8'),code=fs.readFileSync('community.js','utf8');
const SHARE='11111111-1111-4111-8111-111111111111';
const fixture={id:'event-one',name:'たけち',title:'土曜の募集',date:'2099-11-21',start:'18:00',end:'',place:'たけちゃお',rule:'normal',existing:2,vacancies:1,remaining:1,participants:[],note:'<img src=x onerror=alert(1)>',mine:false,joined:false,following:false,closed:0,version:1};
const tick=()=>new Promise(r=>setTimeout(r,10));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const response=(data,status=200)=>({ok:status<400,status,json:async()=>structuredClone(data)});
function server(){
 const s={events:new Map([[fixture.id,structuredClone(fixture)]]),messages:new Map(),requests:[],receipts:new Map(),override:null};
 s.normal=async(path,options,body)=>{
  const method=options.method,[,resource,id,child]=path.split('/');
  if(resource==='config')return response({group:'卓A',room:'group-test'});
  if(resource!=='events')throw Error('Unexpected '+path);
  if(!id&&method==='GET')return response({events:[...s.events.values()]});
  if(!id&&method==='POST'){
   if(s.receipts.has(body.request_id))return response({id:s.receipts.get(body.request_id),replayed:true},201);
   const eid='created-'+s.receipts.size;s.receipts.set(body.request_id,eid);s.events.set(eid,{...structuredClone(fixture),...body,id:eid,mine:true});return response({id:eid},201);
  }
  if(!s.events.has(id))return response({error:'見つかりません。'},404);
  const event=s.events.get(id);
  if(child==='messages'){
   if(method==='GET')return response({messages:s.messages.get(id)||[]});
   if(method==='POST'){
    if(s.receipts.has(body.request_id))return response({id:s.receipts.get(body.request_id),replayed:true},201);
    const mid='message-'+s.receipts.size;s.receipts.set(body.request_id,mid);s.messages.set(id,[...(s.messages.get(id)||[]),{id:mid,name:body.name,body:body.body,mine:true,host:false,canDelete:true,created:Date.now()}]);return response({id:mid},201);
   }
   if(method==='DELETE')return response({ok:true});
  }
  if(child==='join'){Object.assign(event,{joined:method==='POST',remaining:method==='POST'?0:1,participants:method==='POST'?[{name:body.name,mine:true}]:[]});return response({ok:true});}
  if(child==='follow'){event.following=body.enabled;return response({ok:true});}
  if(method==='DELETE'){s.events.delete(id);return response({ok:true});}
  if(method==='PATCH'){Object.assign(event,body);return response({ok:true});}
  return response(event);
 };
 return s;
}
async function app({backend=server(),saved={}}={}){
 const dom=new JSDOM(html,{url:'https://taikechiuketa.github.io/takujo-hanseikai/community.html',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,intervals=[];Object.defineProperty(w,'crypto',{value:webcrypto});w.HanseiCommunityContext=async()=>({share:SHARE});w.scrollTo=()=>{};w.confirm=()=>true;
 w.AbortSignal.timeout=()=>new w.AbortController().signal;w.setInterval=(fn,ms)=>{intervals.push({fn,ms});return intervals.length;};
 for(const [key,value]of Object.entries(saved))w.localStorage.setItem(key,value);
 w.fetch=async(url,options)=>{const path=new URL(url).pathname.replace('/api/community',''),body=options.body?JSON.parse(options.body):{};backend.requests.push({path,method:options.method,body});return backend.override?backend.override(path,options,body,()=>backend.normal(path,options,body)):backend.normal(path,options,body);};
 w.eval(code);await tick();
 const a={dom,w,backend,el:id=>w.document.getElementById(id),intervals,close:()=>w.close(),storage:()=>Object.fromEntries([...Array(w.localStorage.length)].map((_,i)=>{const k=w.localStorage.key(i);return [k,w.localStorage.getItem(k)];}))};
 a.open=async(id=fixture.id)=>{w.document.querySelector('[data-open="'+id+'"]').click();await tick();};
 a.chat=async text=>{a.el('chatName').value='かなめ';a.el('chatBody').value=text;a.el('chatForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();};
 a.newForm=()=>{a.el('newEvent').click();a.el('hostName').value='かなめ';a.el('eventTitle').value='別の場所で';a.el('eventPlace').value='赤羽の雀荘';};
 a.publish=async()=>{a.el('eventForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();};
 return a;
}
(async()=>{
 let a=await app();try{
  assert.match(a.el('eventList').textContent,/土曜の募集/);assert.equal(a.w.localStorage.getItem('hansei-community-device-v1').length,64);await a.open();assert.equal(a.el('eventDetail').querySelector('img'),null);
  a.el('joinName').value='かなめ';a.el('joinEvent').click();await tick();assert.match(a.el('eventDetail').textContent,/満員/);
  a.backend.override=(path,options,body,next)=>path.endsWith('/messages')&&options.method==='POST'?response({error:'テスト通信失敗'},500):next();await a.chat('18時半からでいい？');assert.equal(a.el('chatBody').value,'18時半からでいい？');assert.match(a.el('chatStatus').textContent,/テスト通信失敗/);
  a.backend.override=null;await a.chat('18時半からでいい？');assert.equal(a.el('chatBody').value,'');assert.match(a.el('messages').textContent,/18時半/);
  a.newForm();assert.equal(a.el('eventPlace').value,'赤羽の雀荘');await a.publish();assert.match(a.el('eventDetail').textContent,/赤羽の雀荘/);assert.ok(a.el('deleteEvent'));a.w.confirm=()=>false;a.el('deleteEvent').click();await tick();assert.equal(a.backend.events.size,2);a.w.confirm=()=>true;a.el('deleteEvent').click();await tick();assert.equal(a.backend.events.size,1);assert.equal(a.el('detailPage').hidden,true);
 }finally{a.close();}
 // Polling cannot replace a focused input, including an in-progress Japanese composition.
 a=await app();try{
  await a.open();const input=a.el('joinName');input.value='かな';input.focus();input.setSelectionRange(2,2);input.dispatchEvent(new a.w.CompositionEvent('compositionstart',{bubbles:true}));a.backend.events.get(fixture.id).title='内容が更新された';
  a.intervals.find(i=>i.ms===5000).fn();await tick();assert.equal(a.el('joinName'),input);assert.equal(input.value,'かな');assert.equal(a.w.document.activeElement,input);assert.equal(input.selectionStart,2);
  input.dispatchEvent(new a.w.CompositionEvent('compositionend',{bubbles:true}));a.intervals.find(i=>i.ms===5000).fn();await tick();assert.equal(a.el('joinName'),input);a.el('refreshChat').focus();await tick();assert.equal(a.el('joinName').value,'かな');assert.match(a.el('eventDetail').textContent,/内容が更新された/);
 }finally{a.close();}
 // A successful earlier send must leave a newly typed message intact.
 a=await app();try{
  await a.open();const gate=deferred();a.backend.override=async(path,options,body,next)=>{if(path.endsWith('/messages')&&options.method==='POST')await gate.promise;return next();};
  await a.chat('最初のメッセージ');a.el('chatBody').value='次のメッセージを書き始めた';gate.resolve();await tick();assert.equal(a.el('chatBody').value,'次のメッセージを書き始めた');assert.match(a.el('chatStatus').textContent,/下書きは残して/);assert.equal(a.backend.messages.get(fixture.id).length,1);
 }finally{a.close();}
 // A stale 404 must not navigate away from a form opened after the request began.
 a=await app();try{
  const gate=deferred();a.backend.override=async(path,options,body,next)=>path==='/events/'+fixture.id&&options.method==='GET'?gate.promise:next();
  a.w.document.querySelector('[data-open]').click();await tick();a.newForm();gate.resolve(response({error:'削除済み'},404));await tick();assert.equal(a.el('formPage').hidden,false);assert.equal(a.el('eventTitle').value,'別の場所で');
 }finally{a.close();}
 // An old send response cannot clear a different event's draft or move the current page.
 a=await app();try{
  a.backend.events.set('event-two',{...structuredClone(fixture),id:'event-two',title:'もう一つの募集'});await a.open();const gate=deferred();a.backend.override=async(path,options,body,next)=>{if(path==='/events/event-one/messages'&&options.method==='POST')await gate.promise;return next();};
  await a.chat('一つ目への送信');a.el('backToList').click();await tick();await a.open('event-two');a.el('chatBody').value='二つ目への下書き';gate.resolve();await tick();assert.equal(a.el('chatBody').value,'二つ目への下書き');assert.match(a.el('eventDetail').textContent,/もう一つの募集/);
 }finally{a.close();}
 // Server commit followed by a lost response: resolve the old operation before sending edited content.
 a=await app();try{
  a.newForm();let first=true;a.backend.override=async(path,options,body,next)=>{const result=await next();if(path==='/events'&&options.method==='POST'&&first){first=false;throw Error('応答が失われました');}return result;};await a.publish();assert.equal(a.backend.events.size,2);a.el('eventTitle').value='変更後の募集';
  a.w.confirm=()=>false;await a.publish();assert.equal(a.backend.requests.filter(r=>r.path==='/events'&&r.method==='POST').length,1);a.w.confirm=()=>true;await a.publish();let posts=a.backend.requests.filter(r=>r.path==='/events'&&r.method==='POST');assert.equal(posts[0].body.request_id,posts[1].body.request_id);assert.equal(posts[1].body.title,'別の場所で');assert.equal(a.backend.events.size,2);assert.equal(a.el('eventTitle').value,'変更後の募集');assert.equal(a.el('formPage').hidden,false);
  await a.publish();posts=a.backend.requests.filter(r=>r.path==='/events'&&r.method==='POST');assert.notEqual(posts[2].body.request_id,posts[1].body.request_id);assert.equal(a.backend.events.size,3);
 }finally{a.close();}
 // Durable pending IDs survive page reload and malformed successful response JSON.
 const backend=server();let saved;
 a=await app({backend});try{
  await a.open();let first=true;backend.override=async(path,options,body,next)=>{const result=await next();if(path.endsWith('/messages')&&options.method==='POST'&&first){first=false;return {ok:true,status:201,json:async()=>{throw Error('broken JSON');}};}return result;};await a.chat('保存済みか未確認');saved=a.storage();assert.equal(backend.messages.get(fixture.id).length,1);assert.ok(Object.keys(saved).some(k=>k.startsWith('hansei-community-pending-v1:')));
 }finally{a.close();}
 a=await app({backend,saved});try{
  await a.open();await a.chat('保存済みか未確認');const posts=backend.requests.filter(r=>r.path.endsWith('/messages')&&r.method==='POST');assert.equal(posts[0].body.request_id,posts[1].body.request_id);assert.equal(backend.messages.get(fixture.id).length,1);assert.equal(a.el('chatBody').value,'');
 }finally{a.close();}
 console.log('Community UI: baseline flows, IME/polling preservation, delayed-send drafts, stale page responses and durable idempotent retries passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
