const assert=require('node:assert/strict');const {mainApp,fixture,set,tick}=require('./helpers.cjs');
const tests=[];const test=(n,f)=>tests.push([n,f]);
test('入力・成績・履歴・設定の4画面と卓設定へのリンク',async()=>{const a=await mainApp();for(const [id,panel]of [['tabSheet','sheetPage'],['tabStats','statsPage'],['tabHistory','historyPage'],['tabSettings','groupSettingsPage']]){a.el(id).click();assert(!a.el(panel).hidden)}assert(a.el('groupSettingsPage').contains(a.el('manageMaster')));assert(a.el('groupSettingsLink').href.includes('local=1'));a.dom.window.close()});
test('通算は保存済みだけを集計し、進行中セットを二重加算しない',async()=>{const d=fixture();d.current=structuredClone(set);d.current.rounds[0].scores.a=99;const a=await mainApp({data:d});a.el('tabStats').click();assert.equal(a.el('statsTable').querySelector('tbody tr').cells[1].textContent,'+10 pt');assert(a.el('historyList').querySelector('.set-rank-analysis'));a.dom.window.close()});
test('日付と連番を変更しても対局ID・点数・参加者と件数を維持',async()=>{const d=fixture();d.current=structuredClone(set);const a=await mainApp({data:d,cloud:true});a.el('editSetIdentity').click();a.el('setDate').value='2026-10-31';a.el('setSequence').value='3';await a.el('setIdentityForm').onsubmit({preventDefault(){}});assert.equal(a.data().current.archiveId,set.archiveId);assert.deepEqual(a.data().current.rounds,set.rounds);assert.equal(a.saved.length,0);a.el('saveSet').click();assert.equal(a.saved.at(-1).history.length,1);assert.equal(a.saved.at(-1).history[0].date,'2026/10/31');assert.equal(a.saved.at(-1).history[0].archiveId,set.archiveId);assert((await a.w.HanseiRecovery.list(a.scope)).some(r=>r.kind==='before-set-identity-edit'));a.dom.window.close()});
test('履歴編集を端末に保護して再開できる',async()=>{const a=await mainApp({cloud:true});a.el('tabHistory').click();a.w.document.querySelector('[data-edit-history]').click();const input=a.w.document.querySelector('input[data-score]');input.value='40';input.dispatchEvent(new a.w.Event('input',{bubbles:true}));const key='hansei-history-edit:'+a.scope;assert.equal(JSON.parse(a.w.localStorage.getItem(key)).set.rounds[0].scores.a,'40');a.dom.window.close()});
test('名前固定用の表で半荘追加時に内部末尾へ移動する',async()=>{const d=fixture();d.current=structuredClone(set);const a=await mainApp({data:d});Object.defineProperty(a.el('inputScoreScroll'),'scrollHeight',{value:1500});const names=a.w.document.querySelector('#sheet thead').textContent;a.el('addRound').click();assert.equal(a.el('inputScoreScroll').scrollTop,1500);assert.equal(a.w.document.querySelector('#sheet thead').textContent,names);a.dom.window.close()});
test('R推移の期間は通算と独立し現在Rは全期間のまま',async()=>{const a=await mainApp();a.el('tabStats').click();a.el('statsPeriod').value='range';a.el('statsFrom').value='2026-10-01';a.el('statsTo').value='2026-10-31';a.el('statsPeriod').onchange();a.el('showRating').click();const values=a.el('ratingTable').textContent;a.el('ratingTrendPeriod').value='previous';a.el('ratingTrendPeriod').onchange();assert.equal(a.el('ratingTable').textContent,values);assert.match(a.el('ratingPanelContext').textContent,/全期間/);assert.equal(a.el('statsPeriod').closest('#totalsPanel').hidden,true);a.dom.window.close()});
test('復旧領域はアカウントと卓ごとに分離',async()=>{const a=await mainApp({cloud:true});await a.w.HanseiRecovery.checkpoint('other-user:other-group','other',{private:'not-for-current-group'});const list=await a.w.HanseiRecovery.list(a.scope);assert(list.length);assert(!JSON.stringify(list).includes('not-for-current-group'));a.dom.window.close()});
test('閲覧専用の所有者画面でも履歴とセット分析へ到達する',async()=>{const a=await mainApp({cloud:true,readOnly:true});assert(a.el('tabSheet').hidden);a.el('tabHistory').click();assert(!a.el('historyPage').hidden);assert(!a.w.document.querySelector('[data-edit-history]'));assert(a.w.document.querySelector('.set-rank-analysis'));a.dom.window.close()});

test('変更前の保護に失敗したら日付・連番を変更しない',async()=>{const d=fixture();d.current=structuredClone(set);const a=await mainApp({data:d,cloud:true});a.w.HanseiRecovery.checkpoint=async()=>{throw Error('quota')};a.el('editSetIdentity').click();a.el('setDate').value='2026-10-31';a.el('setSequence').value='3';await a.el('setIdentityForm').onsubmit({preventDefault(){}});assert.equal(a.data().current.date,set.date);assert.match(a.el('identityError').textContent,/変更していません/);a.dom.window.close()});
test('既存と重複する日付・番号を拒否する',async()=>{const d=fixture();d.current={...structuredClone(set),archiveId:'new-set',sequence:2};const a=await mainApp({data:d});a.el('editSetIdentity').click();a.el('setDate').value='2026-11-01';a.el('setSequence').value='1';await a.el('setIdentityForm').onsubmit({preventDefault(){}});assert.equal(a.data().current.sequence,2);assert.match(a.el('identityError').textContent,/同じ日付/);a.dom.window.close()});
test('復旧コピーから端末に戻してもDBに自動送信しない',async()=>{const a=await mainApp({cloud:true});const d=fixture();d.history.push({...structuredClone(set),archiveId:'extra-set',sequence:2});const record=await a.w.HanseiRecovery.checkpoint(a.scope,'test-recovery',{data:d});await a.el('listRecovery').onclick();a.el('recoverySelection').value=record.id;await a.el('restoreRecovery').onclick();assert.equal(a.data().history.length,2);assert.equal(a.saved.length,0);a.dom.window.close()});
test('登録しても選択済みの人を保持し、新規登録者と一緒にセットへ追加する',async()=>{
 const a=await mainApp({cloud:true});a.el('newSet').click();
 const cb=a.el('masterList').querySelector('[data-master-check]');cb.checked=true;cb.dispatchEvent(new a.w.Event('change',{bubbles:true}));
 a.el('newMasterName').value='新しい仲間';a.el('createMaster').click();await tick();
 assert.equal(a.el('masterList').querySelectorAll('[data-master-check]:checked').length,2);
 assert.match(a.el('applyMaster').textContent,/2人/);a.el('applyMaster').click();
 assert.deepEqual(a.data().current.players.map(p=>p.name),['A','新しい仲間']);
 assert.equal(a.data().history.length,1);assert.deepEqual(a.data().history[0],set);assert.equal(a.savedPlayers,1);a.dom.window.close();
});
test('選択なしでは追加せず、参加中の人は重複追加しない',async()=>{
 const d=fixture();d.current=structuredClone(set);const a=await mainApp({data:d,cloud:true});a.el('addPlayer').click();
 assert(a.el('applyMaster').disabled);assert.equal(a.el('masterList').querySelectorAll('[data-master-check]:disabled').length,3);
 a.el('applyMaster').click();assert(a.el('masterDialog').open);assert.equal(a.data().current.players.length,3);a.dom.window.close();
});
test('保存中の登録操作は名前を保持して理由を表示し、保存後に再試行できる',async()=>{
 const a=await mainApp({cloud:true});a.el('newSet').click();a.el('newMasterName').value='待機中の仲間';a.el('cloudSave').disabled=true;a.el('createMaster').click();
 assert.match(a.el('masterCloudStatus').textContent,/保存中/);assert.equal(a.el('newMasterName').value,'待機中の仲間');assert.equal(a.data().master.length,3);
 a.el('cloudSave').disabled=false;a.el('createMaster').click();await tick();assert.equal(a.data().master.length,4);assert.equal(a.el('masterList').querySelectorAll('[data-master-check]:checked').length,1);a.dom.window.close();
});
test('選択を取り消して閉じた後は、前回のチェックを持ち越さない',async()=>{
 const a=await mainApp();a.el('newSet').click();const cb=a.el('masterList').querySelector('[data-master-check]');cb.checked=true;cb.dispatchEvent(new a.w.Event('change',{bubbles:true}));
 a.el('closeMaster').click();a.el('addPlayer').click();assert.equal(a.el('masterList').querySelectorAll('[data-master-check]:checked').length,0);assert(a.el('applyMaster').disabled);a.dom.window.close();
});
(async()=>{for(const [n,f]of tests){try{await f();console.log('PASS '+n)}catch(e){console.error('FAIL '+n);console.error(e);process.exitCode=1;}}})();
