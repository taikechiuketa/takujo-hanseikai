const {JSDOM}=require('jsdom');const assert=require('node:assert/strict');const fs=require('node:fs');
const html=fs.readFileSync('community.html','utf8'),code=fs.readFileSync('community.js','utf8');
const SHARE='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',FAILED='33333333-3333-4333-8333-333333333333',OFF='44444444-4444-4444-8444-444444444444';
const tick=()=>new Promise(r=>setTimeout(r,15));
async function run(enabled){const dom=new JSDOM(html,{url:'https://taikechiuketa.github.io/takujo-hanseikai/community.html',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;let tests=0;w.HanseiCommunityContext=async()=>({share:SHARE});w.scrollTo=()=>{};w.AbortSignal.timeout=()=>new w.AbortController().signal;
Object.defineProperty(w,'Notification',{value:{permission:'granted'}});w.PushManager=function(){};const reg={pushManager:{getSubscription:async()=>enabled?{endpoint:'https://fcm.googleapis.com/test'}:null}};Object.defineProperty(w.navigator,'serviceWorker',{value:{register:async()=>reg,ready:Promise.resolve(reg)}});if(enabled)w.localStorage.setItem('hansei-community-push-v1:group-test','on');
w.fetch=async(url)=>{if(url.endsWith('/config'))return {ok:true,status:200,json:async()=>({group:'卓A',room:'group-test'})};if(url.endsWith('/test')){tests++;return {ok:false,status:503,json:async()=>({error:'サーバー側の通知送信処理に問題があります。端末の再登録は不要です。',code:'PUSH_DELIVERY',retryAfter:30})};}return {ok:true,status:200,json:async()=>({events:[]})};};
try{w.eval(code);await tick();w.document.getElementById('openNotifications').click();await tick();const button=w.document.getElementById('testPush');assert.equal(button.disabled,!enabled);if(enabled){button.click();await tick();assert.equal(tests,1);assert.equal(button.disabled,true);assert.match(button.textContent,/あと30秒|あと29秒/);assert.match(w.document.getElementById('pushStatus').textContent,/再登録は不要/);button.click();await tick();assert.equal(tests,1);assert.ok(Number(w.sessionStorage.getItem('hansei-push-test-retry-v2'))>Date.now());}}finally{w.close();}}
async function repairApp(mode='ok'){
 const dom=new JSDOM(html,{url:'https://taikechiuketa.github.io/takujo-hanseikai/community.html',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 const oldEndpoint='https://fcm.googleapis.com/old',newEndpoint='https://fcm.googleapis.com/new';
 const state={requests:[],unsubscribes:0,subscribes:0};let active;
 const makeSub=endpoint=>({endpoint,toJSON:()=>({endpoint,keys:{p256dh:'A'.repeat(87),auth:'A'.repeat(22)}}),unsubscribe:async()=>{state.unsubscribes++;if(mode==='unsubscribe-fails')return false;active=null;return true;}});
 active=makeSub(oldEndpoint);const reg={pushManager:{getSubscription:async()=>active,subscribe:async()=>{state.subscribes++;if(mode==='subscribe-fails-once'&&state.subscribes===1)throw Error('購読の発行に失敗しました');active=makeSub(mode==='same-endpoint'?oldEndpoint:newEndpoint);return active;}}};
 Object.defineProperty(w,'Notification',{value:{permission:'granted'}});w.PushManager=function(){};w.HanseiCommunityContext=async()=>({share:SHARE});w.scrollTo=()=>{};w.AbortSignal.timeout=()=>new w.AbortController().signal;w.setInterval=()=>1;
 Object.defineProperty(w.navigator,'serviceWorker',{value:{register:async()=>reg,ready:Promise.resolve(reg)}});
 w.localStorage.setItem('hansei-community-visited',JSON.stringify([{share:OTHER,name:'卓B',room:'other'},{share:FAILED,name:'卓C',room:'failed'},{share:OFF,name:'卓D',room:'off'}]));for(const room of ['group-test','other','failed'])w.localStorage.setItem('hansei-community-push-v1:'+room,'on');
 w.fetch=async(url,options)=>{
  const path=new URL(url).pathname.replace('/api/community',''),body=options.body?JSON.parse(options.body):{};state.requests.push({path,method:options.method,body,authorization:options.headers.Authorization});let status=200,data={events:[]};
  if(path==='/config')data={group:'卓A',room:'group-test',publicKey:'A'.repeat(87),push:{ready:true}};
  if(path==='/subscription'&&options.method==='POST'){
   if(body.subscription.endpoint===oldEndpoint){status=409;data={error:'通知登録の識別情報が変わっています。',...(mode==='generic-conflict'?{}:{code:'PUSH_OWNERSHIP_CHANGED'})};}
   else if(mode==='other-fails'&&options.headers.Authorization.startsWith('Bearer '+FAILED+'.')){status=403;data={error:'共有が無効です。'};}
   else data={ok:true};
  }
  return {ok:status<400,status,json:async()=>data};
 };
 w.eval(code);await tick();w.document.getElementById('openNotifications').click();await tick();w.document.getElementById('enablePush').click();await tick();await tick();
 return {w,dom,state,oldEndpoint,newEndpoint,el:id=>w.document.getElementById(id),close:()=>w.close()};
}
(async()=>{
 await run(false);await run(true);
 let a=await repairApp();try{
  assert.equal(a.state.unsubscribes,1);assert.equal(a.state.subscribes,1);const posts=a.state.requests.filter(r=>r.path==='/subscription'&&r.method==='POST');assert.equal(posts.filter(r=>r.body.subscription.endpoint===a.oldEndpoint).length,1);assert.equal(posts.filter(r=>r.body.subscription.endpoint===a.newEndpoint).length,3);assert.equal(posts.some(r=>r.authorization.startsWith('Bearer '+OFF+'.')),false);assert.match(a.el('pushStatus').textContent,/ON/);
  a.el('disablePush').click();await tick();assert.equal(a.state.unsubscribes,1,'turning off one room must leave shared browser subscription alive');assert.equal(a.w.localStorage.getItem('hansei-community-push-v1:other'),'on');assert.equal(a.state.requests.filter(r=>r.method==='DELETE').length,1);
 }finally{a.close();}
 a=await repairApp('unsubscribe-fails');try{assert.equal(a.state.unsubscribes,1);assert.equal(a.state.subscribes,0);assert.match(a.el('pushStatus').textContent,/解除できません/);assert.equal(a.w.localStorage.getItem('hansei-community-push-v1:group-test'),'off');}finally{a.close();}
 a=await repairApp('same-endpoint');try{assert.equal(a.state.subscribes,1);assert.equal(a.state.requests.filter(r=>r.path==='/subscription'&&r.method==='POST').length,1);assert.match(a.el('pushStatus').textContent,/新しい通知先を発行できません/);}finally{a.close();}
 a=await repairApp('generic-conflict');try{assert.equal(a.state.unsubscribes,0);assert.equal(a.state.subscribes,0);}finally{a.close();}
 a=await repairApp('other-fails');try{assert.equal(a.w.localStorage.getItem('hansei-community-push-v1:other'),'on');assert.equal(a.w.localStorage.getItem('hansei-community-push-v1:failed'),'off');assert.equal(a.w.localStorage.getItem('hansei-community-push-v1:group-test'),'on');assert.match(a.el('globalStatus').textContent,/一部の卓/);}finally{a.close();}
 a=await repairApp('subscribe-fails-once');try{assert.equal(a.state.subscribes,1);assert.equal(a.w.localStorage.getItem('hansei-push-restore-pending-v1'),'on');a.el('enablePush').click();await tick();await tick();assert.equal(a.state.subscribes,2);assert.match(a.el('pushStatus').textContent,/ON/);assert.equal(a.state.requests.filter(r=>r.path==='/subscription'&&r.method==='POST'&&r.body.subscription.endpoint===a.newEndpoint).length,3);assert.equal(a.w.localStorage.getItem('hansei-push-restore-pending-v1'),null);}finally{a.close();}
 console.log('Push UI: cooldown, ownership-safe endpoint renewal, unsubscribe/same-endpoint failures and per-group recovery passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
