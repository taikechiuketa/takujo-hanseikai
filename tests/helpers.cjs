const {JSDOM,VirtualConsole}=require('jsdom');
const {IDBFactory}=require('fake-indexeddb');
const {webcrypto}=require('node:crypto');const fs=require('node:fs');const vm=require('node:vm');
const tick=()=>new Promise(r=>setTimeout(r,10));
const group='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
const players=['a','b','c'].map(id=>({id,masterId:'m'+id,name:id.toUpperCase(),chips:0}));
const set={archiveId:'archive-one',date:'2026/11/01',sequence:1,rate:100,chipRate:100,players,rounds:[{id:'r1',mode:'normal',scores:{a:10,b:0,c:-10}}]};
const idle={idle:true,date:'',sequence:0,rate:100,chipRate:100,players:[],rounds:[]};
const fixture=()=>({current:structuredClone(idle),history:[structuredClone(set)],master:players.map(p=>({id:p.masterId,name:p.name}))});
function environment(file,url){
 const html=fs.readFileSync(file,'utf8');const dom=new JSDOM(html,{url,runScripts:'outside-only',virtualConsole:new VirtualConsole()});const w=dom.window;
 Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.indexedDB=new IDBFactory();w.AbortSignal=AbortSignal;
 w.scrollTo=()=>{};w.alert=()=>{};w.confirm=()=>true;w.prompt=()=>null;w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
 const evaluate=file=>vm.runInContext(fs.readFileSync(file,'utf8'),dom.getInternalVMContext());
 return {dom,w,html,evaluate,el:id=>w.document.getElementById(id)};
}
async function mainApp({data=fixture(),cloud=false,readOnly=false}={}){
 const a=environment('index.html','https://example.test/index.html?'+(cloud?'group='+group+(readOnly?'&view=results':''):'local=1'));
 await tick();const {w}=a;const prefix=cloud?'':'test-local:';const map=new Map();
 for(const [key,value]of [['current',data.current],['history',data.history],['players',data.master]]){if(cloud)map.set(key,JSON.stringify(value));else w.localStorage.setItem(prefix+key,JSON.stringify(value));}
 a.saved=[];a.savedPlayers=0;
 const storage=cloud?{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}:w.localStorage;
 const fake={scope:user+':'+group,storage,conflict:false,isShared:()=>false,displayAppearance(){},protect:(kind,d)=>w.HanseiRecovery.checkpoint(user+':'+group,kind,d),hasUnsavedPlayers:()=>false,hasUnsaved:()=>false,hasPending:()=>false,
  connect(keys){a.keys=keys;w.document.getElementById('cloudControls').hidden=false;},save(){a.saved.push(Object.fromEntries([...map].map(([k,v])=>[k,JSON.parse(v)])));},async savePlayers(){a.savedPlayers++;return '';},async logout(){a.loggedOut=true;},shareSet:async()=> 'https://example.test/share.html#token'};
 w.initTemplateGroups=()=>prefix;w.openCloudSheet=async()=>fake;
 a.evaluate('group-recovery.js');a.evaluate('set-analysis.js');a.evaluate('ranking-charts.js');
 for(const m of a.html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(m[1],a.dom.getInternalVMContext());
 w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 for(let i=0;i<100&&a.el('sheetApp').hidden;i++)await tick();
 if(a.el('sheetApp').hidden)throw Error('App did not open: '+a.el('cloudStatus').textContent);
 a.data=()=>({current:JSON.parse(storage.getItem(prefix+'current')),history:JSON.parse(storage.getItem(prefix+'history')),master:JSON.parse(storage.getItem(prefix+'players'))});
 a.scope=cloud?fake.scope:'local:'+prefix;return a;
}
module.exports={environment,mainApp,tick,group,user,players,set,idle,fixture};
