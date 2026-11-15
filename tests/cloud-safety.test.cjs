const assert=require('node:assert/strict');const {environment,fixture,group,user,tick}=require('./helpers.cjs');
async function cloudApp({noUser=false,failCopy=false,failDraft=false,conflict=false,loseResponse=false}={}){
 const a=environment('index.html','https://example.test/index.html?group='+group);await tick();a.evaluate('group-recovery.js');a.evaluate('cloud-sheet.js');a.w.initTemplateGroups=()=>{};
 const f=fixture();let revision='original-revision',attempts=0;const writes=[],queries=[];
 const row={name:'テスト卓',settings:{},sheet_revision:revision,sheet_draft:f.current,sheet_players:f.master};
 function query(table){const filters={},q={action:'select'};const chain=new Proxy(q,{get(target,key){
   if(key==='then')return(resolve,reject)=>{try{resolve(result())}catch(e){reject(e)}};
   return(...args)=>{if(['select','update','delete','insert'].includes(key)){if(key!=='select'||target.action==='select')target.action=key;if(key==='update')target.payload=args[0];}if(key==='eq')filters[args[0]]=args[1];return chain;};
 }});
 function result(){queries.push({table,action:q.action,filters:{...filters}});if(q.action!=='select'){writes.push({table,...q});revision=q.payload?.sheet_revision||revision;return {data:{id:group},error:null};}
 if(table==='groups')return {data:{...row,sheet_revision:revision},error:null};
 if(table==='game_sets')return {data:f.history.map(s=>({id:'server-set-id',played_on:s.date.replaceAll('/','-'),sequence:s.sequence,details:{...s},rounds:s.rounds.map((r,i)=>({...r,position:i}))})),error:null};
 if(table==='set_shares')return {data:[],error:null};throw Error('unknown table')}
 return chain;}
 a.w.supabase={createClient(url){assert.equal(url,'https://aexmoblpehhcqptvagxh.supabase.co');return {auth:{getUser:async()=>({data:{user:noUser?null:{id:user}},error:null}),onAuthStateChange(){},signOut:async args=>{a.signout=args;return {error:null}}},from:query,rpc:async(name,payload)=>{writes.push({rpc:name,payload:structuredClone(payload)});attempts++;if(loseResponse&&attempts===1)throw Error('response lost');if(conflict)return {error:{code:'40001'},data:null};revision=payload.request_id;return {data:revision,error:null};}}}};
 if(failCopy)a.w.HanseiRecovery.checkpoint=async()=>{throw Error('quota')};
 a.w.document.getElementById('cloudSave').disabled=false;
 a.sheet=()=>a.w.openCloudSheet(group);a.writes=writes;a.queries=queries;
 const storageProto=a.w.Storage.prototype,original=storageProto.setItem;
 if(failDraft)storageProto.setItem=function(k,v){if(k.startsWith('hansei-sheet-draft:'))throw Error('quota');return original.call(this,k,v)};
 return a;
}
const tests=[];const test=(n,f)=>tests.push([n,f]);
test('認証できない場合は卓データを取得・変更しない',async()=>{const a=await cloudApp({noUser:true});await assert.rejects(a.sheet(),/ログイン/);assert.equal(a.queries.length,0);assert.equal(a.writes.length,0);a.dom.window.close()});
test('DB取得直後に卓単位の復旧コピーを保存し、起動だけでは書き込まない',async()=>{const a=await cloudApp();const s=await a.sheet();assert.equal(a.writes.length,0);const copies=await a.w.HanseiRecovery.list(user+':'+group);assert.equal(copies[0].data.history[0].archiveId,'archive-one');assert.equal(JSON.parse(s.storage.getItem('history')).length,1);a.dom.window.close()});
test('復旧用保存が失敗したらDB更新へ進まない',async()=>{const a=await cloudApp({failCopy:true});await assert.rejects(a.sheet(),/quota/);assert.equal(a.writes.length,0);a.dom.window.close()});
test('端末の未送信データを保持できなければRPC送信を止める',async()=>{const a=await cloudApp({failDraft:true});const s=await a.sheet();s.connect({current:'current',history:'history',master:'players',notify(){},onSaved(){}});s.storage.setItem('current',JSON.stringify({...fixture().current,rate:200}));await s.save();assert.equal(a.writes.length,0);assert.match(a.el('cloudStatus').textContent,/送信を止め/);a.dom.window.close()});
test('保存は既存の安定ID・所有卓・リビジョンと点数を維持する',async()=>{const a=await cloudApp();const s=await a.sheet();s.connect({current:'current',history:'history',master:'players',notify(){},onSaved(){}});const history=JSON.parse(s.storage.getItem('history'));history[0].date='2026/10/31';history[0].sequence=4;s.storage.setItem('history',JSON.stringify(history));await s.save();const rpc=a.writes.find(x=>x.rpc);assert.equal(rpc.payload.target_group,group);assert.equal(rpc.payload.expected_revision,'original-revision');assert.equal(rpc.payload.sets.length,1);assert.equal(rpc.payload.sets[0].archiveId,'archive-one');assert.deepEqual(rpc.payload.sets[0].rounds.map(({mode,scores})=>({mode,scores})),fixture().history[0].rounds.map(({mode,scores})=>({mode,scores})));assert.match(a.el('setSaveIndicator').textContent,/DB保存済み/);a.dom.window.close()});
test('別端末の競合時も端末の入力と復旧コピーを保持',async()=>{const a=await cloudApp({conflict:true});const s=await a.sheet();s.connect({current:'current',history:'history',master:'players',notify(){},onSaved(){}});const changed={...fixture().current,rate:200};s.storage.setItem('current',JSON.stringify(changed));await s.save();assert.equal(JSON.parse(s.storage.getItem('current')).rate,200);assert.match(a.el('cloudStatus').textContent,/別の画面/);assert((await a.w.HanseiRecovery.list(s.scope)).some(r=>r.kind==='before-save'));a.dom.window.close()});
test('保存応答喪失後の再試行は同じリクエストIDを使用',async()=>{const a=await cloudApp({loseResponse:true});const s=await a.sheet();s.connect({current:'current',history:'history',master:'players',notify(){},onSaved(){}});await s.save();await s.save();const writes=a.writes.filter(x=>x.rpc);assert.equal(writes.length,2);assert.equal(writes[0].payload.request_id,writes[1].payload.request_id);a.dom.window.close()});

test('ログアウトは入力を保護してこの端末の認証だけを終了する',async()=>{const a=await cloudApp();const s=await a.sheet();s.connect({current:'current',history:'history',master:'players',notify(){},onSaved(){}});s.storage.setItem('current',JSON.stringify({...fixture().current,rate:200}));await s.logout();assert.equal(a.signout.scope,'local');assert((await a.w.HanseiRecovery.list(s.scope)).some(r=>r.kind==='before-logout'));const e=new a.w.Event('beforeunload',{cancelable:true});a.w.dispatchEvent(e);assert.equal(e.defaultPrevented,false);a.dom.window.close()});
test('ログアウト前の保護に失敗した場合は認証を終了しない',async()=>{const a=await cloudApp();const s=await a.sheet();a.w.HanseiRecovery.checkpoint=async()=>{throw Error('quota')};await assert.rejects(s.logout(),/quota/);assert.equal(a.signout,undefined);a.dom.window.close()});
(async()=>{for(const [n,f]of tests){try{await f();console.log('PASS '+n)}catch(e){console.error('FAIL '+n);console.error(e);process.exitCode=1;}}})();
