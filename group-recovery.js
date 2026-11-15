// Recovery copies are isolated by account and group. No credentials are stored.
window.HanseiRecovery=(()=>{
  let database;
  function open(){
    if(!database)database=new Promise((resolve,reject)=>{
      const r=indexedDB.open('hansei-recovery-v1',1);
      r.onupgradeneeded=()=>r.result.createObjectStore('copies',{keyPath:'id'});
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
      r.onblocked=()=>reject(Error('復旧用の保存領域を開けません。'));
    });return database;
  }
  async function access(mode,action){
    const db=await open();return new Promise((resolve,reject)=>{
      const tx=db.transaction('copies',mode),request=action(tx.objectStore('copies'));
      let value;request.onsuccess=()=>{value=request.result};
      tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(tx.error||Error('復旧用コピーを保存できません。'));
    });
  }
  async function checkpoint(scope,kind,data){
    const saved=JSON.parse(JSON.stringify(data));
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(saved)))),n=>n.toString(16).padStart(2,'0')).join('');
    const id=scope+':'+kind+':'+digest;
    const existing=await access('readonly',s=>s.get(id));
    if(existing)return existing;
    const record={id,scope,kind,savedAt:new Date().toISOString(),data:saved};
    await access('readwrite',s=>s.put(record));return record;
  }
  async function list(scope){return (await access('readonly',s=>s.getAll())).filter(record=>record.scope===scope).sort((a,b)=>b.savedAt.localeCompare(a.savedAt));}
  async function download(scope){
    const snapshots=await list(scope);
    const url=URL.createObjectURL(new Blob([JSON.stringify({format:'hansei-recovery',version:1,snapshots})],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='hansei-recovery-'+new Date().toISOString().replaceAll(':','-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return {checkpoint,list,download};
})();
