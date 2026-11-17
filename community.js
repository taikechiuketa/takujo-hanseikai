/* Community storage is separate from score/auth storage. No score credentials leave this page. */
(()=>{'use strict';
const API='https://hansei-community.finepumpkin4.chatgpt.site/api/community';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const NAME='hansei-community-name-v1',TOKEN='hansei-community-device-v1';let PUSH='hansei-community-push-v1',share,context,room;
const rules={normal:'三麻',north:'四人三麻',yonma:'四麻',undecided:'未定'};
let token,events=[],selected=null,page='list',editing=null,busy=false,pushBusy=false,pushCanTest=false,testCooldownUntil=0,detailGeneration=0,lastMessages='',lastDetail='',joinComposing=false,detailLoading=0;
function status(text){$('globalStatus').textContent=text;}
function storedName(){return localStorage.getItem(NAME)||'';}
function rememberName(value){const name=value.trim();if(!name||name.length>24)throw Error('表示名を1〜24文字で入力してください。');localStorage.setItem(NAME,name);return name;}
async function api(path,method='GET',body,activeShare=share){
 const response=await fetch(API+path,{method,headers:{Authorization:'Bearer '+activeShare+'.'+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(20000)});
 let data;try{data=await response.json();}catch{throw Error('サーバーの応答を確認できませんでした。同じ内容で再試行してください。');}if(!response.ok){const error=Error(data.error||'接続に失敗しました。');error.status=response.status;error.code=data.code;error.retryAfter=data.retryAfter;throw error;}return data;
}
function pendingKey(slot){return 'hansei-community-pending-v1:'+room+':'+token+':'+slot;}
function readPending(slot){try{const raw=localStorage.getItem(pendingKey(slot));if(!raw)return null;const value=JSON.parse(raw);if(typeof value.id!=='string'||!value.payload||typeof value.payload!=='object')throw Error();return value;}catch{throw Error('前回の送信情報を読み込めません。端末のデータを消さずに管理者へ相談してください。');}}
async function postOnce(slot,path,payload){
 let pending=readPending(slot);
 if(pending&&JSON.stringify(pending.payload)!==JSON.stringify(payload)&&!confirm('前の送信結果が未確認です。まず変更前の内容で再送して結果を確認します。現在の入力は残します。続けますか？'))return null;
 if(!pending){pending={id:crypto.randomUUID(),payload};try{localStorage.setItem(pendingKey(slot),JSON.stringify(pending));}catch{throw Error('再送用の情報を端末に保存できません。まだ送信していません。');}}
 try{
  const result=await api(path,'POST',{...pending.payload,request_id:pending.id});
  if(!result||typeof result.id!=='string')throw Error('保存結果を確認できませんでした。同じ内容で再試行してください。');
  localStorage.removeItem(pendingKey(slot));return {result,sent:pending.payload};
 }catch(error){
  if(error.status>=400&&error.status<500&&![408,429].includes(error.status)&&error.code!=='IDEMPOTENCY_CONFLICT')localStorage.removeItem(pendingKey(slot));
  throw error;
 }
}
function detailInputActive(){return joinComposing||document.activeElement?.id==='joinName';}
function drawDetail(e){
 if(!e||!Array.isArray(e.participants))return;
 const serialized=JSON.stringify(e);if(serialized===lastDetail||detailInputActive())return;
 const old=$('joinName'),draft=old?.value;renderDetail(e);lastDetail=serialized;
 if(draft!==undefined&&$('joinName'))$('joinName').value=draft;
}
$('eventDetail').addEventListener('compositionstart',event=>{if(event.target.id==='joinName')joinComposing=true;});
$('eventDetail').addEventListener('compositionend',event=>{if(event.target.id==='joinName')joinComposing=false;});
$('eventDetail').addEventListener('focusout',()=>{queueMicrotask(()=>{if(page==='detail'&&selected&&!detailInputActive())drawDetail(selected);});});
function navigate(next){page=next;detailGeneration++;['list','detail','form','notifications'].forEach(p=>$(p+'Page').hidden=p!==next);status('');window.scrollTo(0,0);}
function setUrl(id){const url=new URL('./community.html',location.href);if(id)url.searchParams.set('event',id);url.hash=share;history.replaceState(null,'',url);}
function day(date){return new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Tokyo'}).format(new Date(date+'T12:00:00+09:00'));}
function today(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());}
function state(e){return e.closed?'締切済み':e.remaining===0?'満員':'あと'+e.remaining+'人募集中';}
function seats(e){return `<div class="seats"><span>${esc(e.name)}（募集者）</span>${e.existing>1?'<span>決まっている仲間 '+(e.existing-1)+'人</span>':''}${e.participants.map(p=>`<span>${esc(p.name)}${p.mine?'（あなた）':''}</span>`).join('')}${!e.closed&&e.remaining?`<span class="empty">あと${e.remaining}人</span>`:''}</div>`;}
function renderList(){
 const visible=events.filter(e=>$('showPast').checked||(!e.closed&&e.date>=today())).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
 $('eventList').innerHTML=visible.length?visible.map(e=>`<article class="card"><div class="heading"><span class="tag ${e.closed||!e.remaining?'closed':''}">${state(e)}</span><span class="hint">${rules[e.rule]}</span></div><h3 class="event-title">${esc(e.title)}</h3><div class="event-meta"><span>${day(e.date)} ${e.start||'時間未定'}${e.end?'〜'+e.end:''}</span><span>${esc(e.place)}</span></div>${seats(e)}<p class="hint">${e.joined?'参加予定 · ':''}${e.mine?'あなたの募集':'募集者：'+esc(e.name)}</p><button type="button" data-open="${e.id}" class="wide">詳細・チャットを開く</button></article>`).join(''):'<section class="card"><h3>現在、募集中の予定はありません</h3><p class="hint">「＋ 募集する」から、仲間に声をかけてみましょう。</p></section>';
 $('eventList').querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openEvent(b.dataset.open));
}
async function loadList(quiet=false){try{const result=await api('/events');events=result.events;if(page==='list')renderList();if(!quiet)status('');}catch(e){if(!quiet)status(e.message);}}
function renderDetail(e){
 $('eventDetail').innerHTML=`<section class="card"><span class="tag ${e.closed||!e.remaining?'closed':''}">${state(e)}</span><h2 class="event-title" style="margin-top:12px">${esc(e.title)}</h2><p class="hint">募集者：${esc(e.name)}${e.mine?'（あなた）':''}</p><dl><div><dt>日時</dt><dd>${day(e.date)}<br>${e.start||'時間未定'}${e.end?'〜'+e.end:''}</dd></div><div><dt>場所</dt><dd>${esc(e.place)}</dd></div><div><dt>ルール</dt><dd>${rules[e.rule]}</dd></div><div><dt>人数</dt><dd>${e.existing+e.participants.length}人参加予定／${e.existing+e.vacancies}人</dd></div></dl>${seats(e)}${e.note?'<p style="white-space:pre-wrap">'+esc(e.note)+'</p>':''}${!e.mine&&!e.joined&&!e.closed&&e.remaining?'<label for="joinName">参加する名前</label><input id="joinName" maxlength="24" autocomplete="nickname" placeholder="好きな名前" value="'+esc(storedName())+'">':''}<div class="buttons">${e.mine?'<button id="editEvent">募集内容を編集</button><button id="toggleClosed" class="secondary">'+(e.closed?'募集を再開する':'募集を締め切る')+'</button><button id="deleteEvent" class="secondary">募集を削除する</button>':e.joined?'<button id="leaveEvent" class="secondary">参加を取り消す</button>':!e.closed&&e.remaining?'<button id="joinEvent">この募集に参加する</button>':''}<button id="shareEvent" class="secondary">募集リンクをコピー</button></div><p id="actionStatus" role="status"></p></section>`;
 $('followChat').checked=e.following;
 $('chatNotificationHint').textContent='端末の通知もONにしてください。参加・募集したときは、この募集の新着通知が自動でONになります。';
 if($('joinEvent'))$('joinEvent').onclick=()=>action(async()=>{const name=rememberName($('joinName').value);$('chatName').value=name;await api('/events/'+e.id+'/join','POST',{name});});
 if($('leaveEvent'))$('leaveEvent').onclick=()=>{if(confirm('この募集への参加を取り消しますか？'))action(()=>api('/events/'+e.id+'/join','DELETE'));};
 if($('editEvent'))$('editEvent').onclick=()=>openForm(e);
 if($('deleteEvent'))$('deleteEvent').onclick=async()=>{
  if(busy||!confirm('この募集を削除しますか？参加者一覧とチャットも見られなくなります。'))return;
  busy=true;$('eventDetail').querySelectorAll('button').forEach(b=>b.disabled=true);
  try{await api('/events/'+e.id,'DELETE',{version:e.version});selected=null;navigate('list');setUrl(null);await loadList();status('募集を削除しました。');}
  catch(error){status(error.message);}finally{busy=false;$('eventDetail').querySelectorAll('button').forEach(b=>b.disabled=false);}
 };
 if($('toggleClosed'))$('toggleClosed').onclick=()=>action(()=>api('/events/'+e.id,'PATCH',{...e,closed:!e.closed}));
 $('shareEvent').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);$('actionStatus').textContent='募集リンクをコピーしました。';}catch{$('actionStatus').textContent='このページのURLをコピーして共有してください。';}};
}
async function loadDetail(id,quiet=false){const gen=detailGeneration;detailLoading++;
 try{const [e,chat]=await Promise.all([api('/events/'+id),api('/events/'+id+'/messages')]);if(page!=='detail'||gen!==detailGeneration)return;selected=e;drawDetail(e);const serialized=JSON.stringify(chat.messages);
 if(serialized!==lastMessages){lastMessages=serialized;$('messages').innerHTML=chat.messages.map(m=>`<article class="chat-message ${m.mine?'mine':''}"><div class="chat-meta"><span><b>${esc(m.name)}</b> ${m.host?'〈募集者〉':''}${m.mine?'〈あなた〉':''} · ${new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Tokyo'}).format(m.created)}</span>${m.canDelete?'<button class="text" type="button" data-delete="'+m.id+'">削除</button>':''}</div><p>${esc(m.body)}</p></article>`).join('');$('messages').querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{if(confirm('この投稿を削除しますか？'))action(()=>api('/events/'+id+'/messages','DELETE',{id:b.dataset.delete}));});}
 if(!quiet)status('');
 }catch(e){if(page!=='detail'||gen!==detailGeneration)return;if(e.status===404){selected=null;navigate('list');setUrl(null);await loadList();status('募集が削除されたか、見つかりません。');}else if(!quiet)status(e.message);}finally{detailLoading--;}}
async function openEvent(id){selected={id};lastMessages='';lastDetail='';joinComposing=false;$('eventDetail').replaceChildren();$('messages').replaceChildren();$('chatName').value=storedName();$('chatBody').value='';$('chatStatus').textContent='';navigate('detail');setUrl(id);await loadDetail(id);}
async function action(fn){if(busy)return;busy=true;detailGeneration++;const gen=detailGeneration,id=selected.id;$('eventDetail').querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();if(page==='detail'&&gen===detailGeneration)await loadDetail(id);}catch(e){if(page==='detail'&&gen===detailGeneration)status(e.message);}finally{busy=false;$('eventDetail').querySelectorAll('button').forEach(b=>b.disabled=false);}}
function openForm(e=null){editing=e;navigate('form');$('eventForm').reset();$('formStatus').textContent='';$('formTitle').textContent=e?'募集内容を編集':'新しく募集する';$('publishEvent').textContent=e?'変更を保存する':'募集を公開する';$('notifyLabel').hidden=$('notifyHelp').hidden=!!e;const form=$('eventForm');const data=e||{name:storedName(),date:today(),place:'いつもの場所',title:'',start:'',end:'',note:'',rule:'normal',vacancies:2,existing:1};for(const key of ['name','title','date','start','end','place','rule','vacancies','existing','note']){const field=form.elements.namedItem(key);if(field instanceof HTMLSelectElement&&!Array.from(field.options).some(o=>o.value===String(data[key]))){field.add(new Option(String(data[key])+'人',String(data[key])));}field.value=data[key];}}
$('eventForm').onsubmit=async event=>{
 event.preventDefault();if(busy)return;busy=true;const gen=detailGeneration;$('publishEvent').disabled=true;$('formStatus').textContent='保存しています…';
 try{
  const form=$('eventForm'),data=Object.fromEntries(new FormData(form));data.name=rememberName(data.name);data.vacancies=Number(data.vacancies);data.existing=Number(data.existing);data.notify=form.elements.namedItem('notify').checked;
  let id;if(editing){id=editing.id;await api('/events/'+id,'PATCH',{...data,version:editing.version,closed:editing.closed});}
  else{
   const outcome=await postOnce('event-create','/events',data);if(!outcome){if(page==='form'&&gen===detailGeneration)$('formStatus').textContent='送信を中止しました。前の送信情報と現在の入力は残っています。';return;}
   id=outcome.result.id;
   const current=Object.fromEntries(new FormData(form));current.name=current.name.trim();current.vacancies=Number(current.vacancies);current.existing=Number(current.existing);current.notify=form.elements.namedItem('notify').checked;
   if(JSON.stringify(current)!==JSON.stringify(outcome.sent)){
    if(page==='form'&&gen===detailGeneration){$('formStatus').textContent='前回の募集は保存済みです。現在の入力は残しました。別の募集として公開する場合は、もう一度「募集を公開する」を押してください。';const link=document.createElement('a');link.href='./community.html?'+new URLSearchParams({event:id})+'#'+share;link.textContent='保存済みの募集を開く';$('formStatus').append(' ',link);}return;
   }
  }
  if(page==='form'&&gen===detailGeneration)await openEvent(id);
 }catch(e){if(page==='form'&&gen===detailGeneration)$('formStatus').textContent=e.message;}
 finally{busy=false;$('publishEvent').disabled=false;}
};
$('chatForm').onsubmit=async event=>{
 event.preventDefault();if(busy||!selected)return;busy=true;detailGeneration++;const gen=detailGeneration,button=$('chatForm').querySelector('button'),id=selected.id;button.disabled=true;
 try{
  const name=rememberName($('chatName').value),body=$('chatBody').value;
  const outcome=await postOnce('message:'+id,'/events/'+id+'/messages',{name,body});
  if(!outcome){if(page==='detail'&&gen===detailGeneration)$('chatStatus').textContent='送信を中止しました。前の送信情報と現在の入力は残っています。';return;}
  if(page==='detail'&&gen===detailGeneration&&selected?.id===id){
   const unchanged=$('chatBody').value===outcome.sent.body&&$('chatName').value.trim()===outcome.sent.name;
   if(unchanged)$('chatBody').value='';
   $('chatStatus').textContent=unchanged?'送信しました。':'前回の送信は完了しました。現在の下書きは残しています。';await loadDetail(id);
  }
 }catch(e){if(page==='detail'&&gen===detailGeneration&&selected?.id===id)$('chatStatus').textContent=e.message;}
 finally{busy=false;button.disabled=false;}
};
$('followChat').onchange=async()=>{if(!selected)return;const enabled=$('followChat').checked;try{await api('/events/'+selected.id+'/follow','POST',{enabled});status(enabled?'この募集の新着通知をONにしました。端末の通知もONにしてください。':'この募集の新着通知をOFFにしました。');}catch(e){$('followChat').checked=!enabled;status(e.message);}};
$('newEvent').onclick=()=>openForm();$('showPast').onchange=renderList;$('refreshEvents').onclick=()=>loadList();$('refreshChat').onclick=()=>selected&&loadDetail(selected.id);
function toList(){navigate('list');setUrl(null);loadList();} $('backToList').onclick=$('closeNotifications').onclick=toList;
$('cancelForm').onclick=()=>{if(editing)openEvent(editing.id);else toList();};
const guides={iphone:'<h3>iPhone・iPad</h3><ol><li>iOS／iPadOS 16.4以降が必要です。Safariで卓上反省会の閲覧共有ページから「参加募集」を開きます。</li><li>共有メニューから「ホーム画面に追加」を選びます。「Webアプリとして開く」がある場合はONにします。</li><li>ホーム画面に追加した「卓上反省会」を開きます。卓が未選択なら共有リンクを貼り付けて開き、「通知設定・ガイド」に進みます。</li><li>「募集通知をONにする」を押し、端末の確認で「許可」を選びます。</li><li>「テスト通知を送る」で動作確認します。</li></ol><p class="hint">許可しなかった場合は、端末の「設定」→「通知」から追加したアプリを探して通知を許可してください。見つからなければホーム画面に追加したアプリ内で登録し直してください。</p>',android:'<h3>Android</h3><ol><li>ChromeなどWeb通知に対応したブラウザで卓上反省会を開きます。</li><li>必要ならブラウザメニューの「ホーム画面に追加」または「アプリをインストール」を選びます。</li><li>「参加募集」→「通知設定・ガイド」→「募集通知をONにする」を押します。</li><li>ブラウザ・Androidの確認で通知を許可します。</li><li>「テスト通知を送る」で確認します。</li></ol><p class="hint">ブロックしている場合は、Chromeの「設定」→「サイトの設定」→「通知」でこのサイトを許可します。端末の「設定」→「アプリ」→利用ブラウザや卓上反省会→「通知」も確認してください。</p>',other:'<h3>パソコン・その他</h3><ol><li>Chrome・Edge・Firefox・Safariなど、Web通知対応ブラウザで開きます。</li><li>「募集通知をONにする」を押し、通知を許可します。</li><li>「テスト通知を送る」で確認します。</li></ol><p class="hint">ブラウザとOS両方の通知設定を確認してください。非対応ブラウザでも、募集一覧とチャットは利用できます。</p>'};
function guide(kind){$('guideContent').innerHTML=guides[kind];document.querySelectorAll('[data-guide]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.guide===kind)));}
document.querySelectorAll('[data-guide]').forEach(b=>b.onclick=()=>guide(b.dataset.guide));
const iphone=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
guide(iphone?'iphone':/Android/.test(navigator.userAgent)?'android':'other');
async function registration(){if(!('serviceWorker'in navigator))throw Error('このブラウザは通知に対応していません。');await navigator.serviceWorker.register('./community-sw.js',{scope:'./'});return navigator.serviceWorker.ready;}
async function pushState(){try{
 pushCanTest=false;updateTestButton();
 if(!('Notification'in window)||!('PushManager'in window)){$('pushStatus').textContent=iphone?'ホーム画面に追加したアプリから開いてください。':'このブラウザはプッシュ通知に対応していません。';return;}
 const reg=await registration(),sub=await reg.pushManager.getSubscription();pushCanTest=!!sub&&localStorage.getItem(PUSH)==='on'&&Notification.permission==='granted';
 $('pushStatus').textContent=Notification.permission==='denied'?'通知がブロックされています。下のガイドから端末・ブラウザ設定を確認してください。':pushCanTest?'この卓の募集通知：ON':'この卓の募集通知：OFF';
 }catch(e){$('pushStatus').textContent=e.message;}finally{updateTestButton();}}
$('openNotifications').onclick=()=>{navigate('notifications');setUrl(null);pushState();};
function updateTestButton(){const remaining=Math.max(0,Math.ceil((testCooldownUntil-Date.now())/1000));$('testPush').disabled=pushBusy||!pushCanTest||remaining>0;$('testPush').textContent=remaining?'テスト通知（あと'+remaining+'秒）':'テスト通知を送る';}
function cooldown(seconds){testCooldownUntil=Date.now()+Math.max(1,Number(seconds)||30)*1000;try{sessionStorage.setItem('hansei-push-test-retry-v2',String(testCooldownUntil));}catch{}updateTestButton();}
function pushButtons(disabled){pushBusy=disabled;['enablePush','disablePush'].forEach(id=>$(id).disabled=disabled);updateTestButton();}
try{testCooldownUntil=Number(sessionStorage.getItem('hansei-push-test-retry-v2'))||0;}catch{}
setInterval(updateTestButton,1000);updateTestButton();
const pushRestoreKey='hansei-push-restore-pending-v1';
function visitedPushGroups(){try{const groups=JSON.parse(localStorage.getItem('hansei-community-visited')||'[]');return Array.isArray(groups)?groups.filter(g=>typeof g.share==='string'&&typeof g.room==='string'):[];}catch{return [];}}
async function renewSubscription(reg,old,config){
 localStorage.setItem(pushRestoreKey,'on');localStorage.setItem(PUSH,'off');
 if(old){
  localStorage.setItem('hansei-push-expired-endpoint',old.endpoint);
  if(await old.unsubscribe()!==true)throw Error('古い通知登録を解除できませんでした。ブラウザを開き直して、もう一度ONにしてください。');
 }
 const raw=atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/'));
 const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,c=>c.charCodeAt(0))});
 if(old&&sub.endpoint===old.endpoint)throw Error('新しい通知先を発行できませんでした。ブラウザの通知設定を確認し、開き直してから再試行してください。');
 return sub;
}
async function restorePushGroups(sub){
 const groups=visitedPushGroups().filter(g=>g.share!==share&&localStorage.getItem('hansei-community-push-v1:'+g.room)==='on');
 const results=await Promise.allSettled(groups.map(g=>api('/subscription','POST',{subscription:sub.toJSON(),recruit:true},g.share)));
 results.forEach((result,i)=>{if(result.status==='rejected')localStorage.setItem('hansei-community-push-v1:'+groups[i].room,'off');});
 if(results.some(r=>r.status==='rejected'))status('一部の卓の通知を再接続できませんでした。該当する卓で通知をONにし直してください。');
 localStorage.removeItem(pushRestoreKey);localStorage.removeItem('hansei-push-expired-endpoint');
}
$('enablePush').onclick=async()=>{if(pushBusy)return;pushButtons(true);try{
 if(!('Notification'in window)||!('PushManager'in window))throw Error(iphone?'先にホーム画面に追加し、そのアイコンから開いてください。':'Web通知対応のブラウザで開いてください。');
 // Permission prompt starts directly in the user gesture, before network work.
 const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();if(permission!=='granted')throw Error('通知が許可されませんでした。設定ガイドを確認してください。');
 const [reg,config]=await Promise.all([registration(),api('/config')]);if(!config.publicKey||config.push?.ready===false)throw Error('サーバー側の通知設定を確認しています。端末の再登録は不要です。');
 let sub=await reg.pushManager.getSubscription();const expired=localStorage.getItem('hansei-push-expired-endpoint');
 if(sub&&sub.endpoint===expired)sub=await renewSubscription(reg,sub,config);
 if(!sub){
  const raw=atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/'));
  sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,c=>c.charCodeAt(0))});
 }
 try{await api('/subscription','POST',{subscription:sub.toJSON(),recruit:true});}
 catch(error){
  if(error.status!==409||error.code!=='PUSH_OWNERSHIP_CHANGED')throw error;
  // Never claim an endpoint registered by another anonymous identity. Only this
  // browser can invalidate its current subscription and obtain a different one.
  sub=await renewSubscription(reg,sub,config);
  await api('/subscription','POST',{subscription:sub.toJSON(),recruit:true});
 }
 localStorage.setItem(PUSH,'on');
 if(localStorage.getItem(pushRestoreKey)==='on')await restorePushGroups(sub);
 await pushState();
 }catch(e){$('pushStatus').textContent=e.message;}finally{pushButtons(false);}};
$('disablePush').onclick=async()=>{if(pushBusy)return;pushButtons(true);try{const reg=await registration(),sub=await reg.pushManager.getSubscription();if(sub){await api('/subscription','DELETE',{endpoint:sub.endpoint});/* The browser subscription can be shared by other groups; only remove this room's server registration. */}localStorage.setItem(PUSH,'off');await pushState();}catch(e){$('pushStatus').textContent=e.message;}finally{pushButtons(false);}};
$('testPush').onclick=async()=>{if(pushBusy||!pushCanTest||Date.now()<testCooldownUntil)return;pushButtons(true);let attempted=false,testedSubscription;try{const reg=await registration(),sub=await reg.pushManager.getSubscription();if(!sub||localStorage.getItem(PUSH)!=='on')throw Error('先に募集通知をONにしてください。');testedSubscription=sub;attempted=true;const result=await api('/test','POST',{endpoint:sub.endpoint});cooldown(result.retryAfter||30);$('pushStatus').textContent='通知サービスに送信しました。端末に表示されるか確認してください。';}catch(e){if(attempted)cooldown(e.retryAfter||30);if(e.code==='PUSH_EXPIRED'){pushCanTest=false;localStorage.setItem(PUSH,'off');if(testedSubscription)localStorage.setItem('hansei-push-expired-endpoint',testedSubscription.endpoint);}$('pushStatus').textContent=e.message;}finally{pushButtons(false);}};

async function boot(){try{context=await window.HanseiCommunityContext();share=context.share;token=localStorage.getItem(TOKEN);if(!/^[a-f0-9]{64}$/.test(token||'')){token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');localStorage.setItem(TOKEN,token);}if(localStorage.getItem(TOKEN)!==token)throw Error('保存できません');const config=await api('/config');room=config.room;if(window.HanseiGroupPwa)window.HanseiGroupPwa(share,config.group);PUSH+=':'+room;$('communityGroupTitle').textContent=config.group;document.title=config.group+'｜参加募集・卓上反省会';$('communityRankingLink').href='./ranking.html#'+share;if(context.group)$('communityAdminLink').href='./index.html?'+new URLSearchParams({group:context.group});
localStorage.setItem('hansei-community-last-share',share);let visited=[];try{visited=JSON.parse(localStorage.getItem('hansei-community-visited')||'[]');}catch{}if(!Array.isArray(visited))visited=[];visited=[{share,name:config.group,room},...visited.filter(v=>v.share!==share)].slice(0,20);localStorage.setItem('hansei-community-visited',JSON.stringify(visited));$('visitedGroupsLabel').hidden=visited.length<2;$('visitedGroups').replaceChildren(...visited.map(v=>new Option(v.name,v.share)));$('visitedGroups').value=share;$('visitedGroups').onchange=()=>{location.href='./community.html?switch=1#'+$('visitedGroups').value;};
$('communityApp').inert=false;const id=new URL(location.href).searchParams.get('event');setUrl(id);if(id)await openEvent(id);else await loadList();}catch(error){status(error.message||'卓を開けません。閲覧共有リンクから開き直してください。');$('communityApp').inert=false;$('listPage').hidden=true;$('sharedEntry').hidden=false;for(const section of ['listPage','detailPage','formPage','notificationsPage'])$(section).querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=true);}}
boot();
setInterval(()=>{if(document.hidden||busy||detailLoading)return;if(page==='detail'&&selected)loadDetail(selected.id,true);},5000);
setInterval(()=>{if(!document.hidden&&!busy&&page==='list')loadList(true);},15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!busy&&!detailLoading){if(page==='detail'&&selected)loadDetail(selected.id);else if(page==='list')loadList();}});
})();
