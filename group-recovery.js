// Recovery copies are isolated by account and group. No credentials are stored.
window.HanseiRecovery=(()=>{
  const limits=Object.freeze({scopeCopies:12,totalCopies:80,totalBytes:16*1024*1024,recordBytes:8*1024*1024});
  let database;
  const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
  function open(){
    if(!database)database=new Promise((resolve,reject)=>{
      const r=indexedDB.open('hansei-recovery-v1',2);
      r.onupgradeneeded=()=>{const store=r.result.objectStoreNames.contains('copies')?r.transaction.objectStore('copies'):r.result.createObjectStore('copies',{keyPath:'id'});if(!store.indexNames.contains('scope'))store.createIndex('scope','scope');};
      r.onsuccess=()=>{const db=r.result;db.onversionchange=()=>{db.close();database=undefined;};resolve(db);};r.onerror=()=>{database=undefined;reject(r.error);};
      r.onblocked=()=>{database=undefined;reject(Error('復旧用の保存領域を開けません。別のタブを閉じてください。'));};
    });return database;
  }
  async function access(mode,action){
    const db=await open();return new Promise((resolve,reject)=>{
      const tx=db.transaction('copies',mode);let request;
      try{request=action(tx.objectStore('copies'));}catch(error){tx.abort();reject(error);return;}
      let value;request.onsuccess=()=>{value=request.result};
      tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(tx.error||Error('復旧用コピーを保存できません。'));
    });
  }
  async function rotate(record){
    const db=await open();return new Promise((resolve,reject)=>{
      const tx=db.transaction('copies','readwrite'),store=tx.objectStore('copies'),cursor=store.openCursor(),metadata=[];let problem;
      tx.oncomplete=()=>resolve(record);tx.onerror=tx.onabort=()=>reject(problem||tx.error||Error('復旧用コピーを保存できません。'));
      cursor.onsuccess=()=>{
        const current=cursor.result;
        if(current){const old=current.value;if(old.id!==record.id)metadata.push({id:old.id,scope:old.scope,savedAt:old.savedAt,bytes:Number.isFinite(old.bytes)?old.bytes:bytes(old)+32});current.continue();return;}
        // Reserve the incoming copy first. Deletes and insertion commit together;
        // a quota failure rolls all of them back, preserving the previous copies.
        const counts=new Map([[record.scope,1]]),keep=new Set([record.id]);let total=record.bytes,count=1;
        metadata.sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));
        // Never silently erase the final recovery copy of another account/table.
        for(const old of metadata){if(counts.has(old.scope))continue;keep.add(old.id);counts.set(old.scope,1);total+=old.bytes;count++;}
        if(count>limits.totalCopies||total>limits.totalBytes){problem=Error('復旧コピーの保存上限です。既存のコピーは保持しています。コピーを書き出してから保存領域を整理してください。');tx.abort();return;}
        for(const old of metadata){if(keep.has(old.id)||(counts.get(old.scope)||0)>=limits.scopeCopies||count>=limits.totalCopies||total+old.bytes>limits.totalBytes)continue;keep.add(old.id);counts.set(old.scope,(counts.get(old.scope)||0)+1);total+=old.bytes;count++;}
        try{for(const old of metadata)if(!keep.has(old.id))store.delete(old.id);store.put(record);}catch(error){problem=error;tx.abort();}
      };
    });
  }
  async function checkpoint(scope,kind,data){
    const saved=JSON.parse(JSON.stringify(data));
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(saved)))),n=>n.toString(16).padStart(2,'0')).join('');
    const id=scope+':'+kind+':'+digest;
    const existing=await access('readonly',s=>s.get(id));
    if(existing)return existing;
    const record={id,scope,kind,savedAt:new Date().toISOString(),data:saved};record.bytes=bytes(record)+32;
    if(record.bytes>limits.recordBytes)throw Error('復旧コピーの上限（8MiB）を超えています。データを書き出してから整理してください。');
    return rotate(record);
  }
  async function list(scope){return (await access('readonly',s=>s.index('scope').getAll(scope))).sort((a,b)=>b.savedAt.localeCompare(a.savedAt));}
  async function download(scope){
    let snapshots=[],readError;
    try{snapshots=await list(scope);}catch(error){readError=error;}
    const deviceDrafts=[];
    for(const key of ['hansei-history-edit:'+scope,'hansei-sheet-draft:'+scope]){try{const raw=localStorage.getItem(key);if(raw)deviceDrafts.push({key,data:JSON.parse(raw)});}catch{}}
    if(readError&&!deviceDrafts.length)throw readError;
    if(!snapshots.length&&!deviceDrafts.length)throw Object.assign(Error('保存済みの復旧コピーや下書きがありません。DBの成績は削除していません。'),{code:'NO_RECOVERY_DATA'});
    const url=URL.createObjectURL(new Blob([JSON.stringify({format:'hansei-recovery',version:1,snapshots,deviceDrafts,...(readError?{notice:'復旧コピーを読み込めないため、端末の下書きだけを書き出しました。'}:{})})],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='hansei-recovery-'+new Date().toISOString().replaceAll(':','-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function addRescueExport(target,scope){
    if(!target||target.parentElement?.querySelector('[data-recovery-rescue]'))return;
    const section=document.createElement('div');section.dataset.recoveryRescue='true';const button=document.createElement('button'),status=document.createElement('p');button.type='button';button.className='secondary';button.textContent='保存済みの復旧コピー・下書きを書き出す';
    button.onclick=async()=>{button.disabled=true;try{await download(scope);status.textContent='保存済みのコピーと端末の下書きを書き出しました。';}catch(error){status.textContent=error.code==='NO_RECOVERY_DATA'?error.message:'保存領域を読み込めませんでした。サイトのデータを削除せず、別のタブを閉じて再試行してください。';}finally{button.disabled=false;}};
    section.append(button,status);target.after(section);
  }
  return {checkpoint,list,download,addRescueExport,limits};
})();
