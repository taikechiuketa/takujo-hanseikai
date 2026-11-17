(async()=>{
 const $=id=>document.getElementById(id),status=$('membersStatus');
 const db=window.supabase.createClient('https://aexmoblpehhcqptvagxh.supabase.co','sb_publishable_USpY-tMqtrFiUCK_ISwqjw_F0z2r1ha');
 const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
 let group=new URLSearchParams(location.search).get('group'),invite=location.hash.slice(1),busy=false,sessionUser,selectedMember,generation=0;
 const fail=e=>{if(e?.stale)return;status.textContent=e?.code==='PGRST202'?'入力メンバー機能のDB設定が必要です。管理者に確認してください。':e?.code==='42501'?'この操作の権限がありません。ログイン状態とグループを確認してください。':e?.code==='22023'?'招待リンクは期限切れ・使用済み・無効のいずれかです。管理者に新しいリンクを依頼してください。':'操作を完了できませんでした。通信を確認して再試行してください。';};
 async function rpc(name,args){const version=generation;const r=await db.rpc(name,args);if(version!==generation)throw {stale:true};if(r.error)throw r.error;return r.data;}
 async function action(fn){if(busy)return;busy=true;status.textContent='処理中…';document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){fail(e);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
 function clear(){generation++;sessionUser=null;$('membersPanel').hidden=$('inviteControls').hidden=$('acceptInvite').hidden=$('createdInvite').hidden=true;$('membersList').replaceChildren();$('inviteUrl').value='';$('membersPlay').hidden=true;if($('removeMemberDialog').open)$('removeMemberDialog').close();}
 db.auth.onAuthStateChange?.((event,session)=>{if(event==='SIGNED_OUT'||(sessionUser&&session?.user&&session.user.id!==sessionUser)){clear();status.textContent='ログインし直してページを開き直してください。';}});
 async function load(){
  const data=await rpc('get_group_members',{target_group:group});
  $('membersTitle').textContent=data.group+'｜入力メンバー';$('memberSummary').textContent='登録 '+data.count+'人（管理者を含む）／あなたは'+(data.role==='owner'?'管理者':'入力メンバー')+'です。';
  $('membersList').replaceChildren();for(const person of data.members||[]){const li=document.createElement('li');li.textContent=(person.email||person.id)+' — '+(person.role==='owner'?'管理者':'入力メンバー');if(person.role!=='owner'){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='入力権限を解除';button.onclick=()=>{selectedMember=person.id;$('removeMemberPrompt').textContent=(person.email||person.id)+'の入力権限を解除しますか？';$('removeMemberDialog').showModal();};li.append(' ',button);}$('membersList').append(li);}
  $('membersPanel').hidden=false;$('inviteControls').hidden=data.role!=='owner';$('membersPlay').href='./index.html?'+new URLSearchParams({group});$('membersPlay').hidden=false;status.textContent='';
 }
 $('confirmRemove').onclick=()=>action(async()=>{await rpc('remove_group_editor',{target_group:group,target_user:selectedMember});$('removeMemberDialog').close();await load();status.textContent='入力権限を解除しました。';});
 $('createInvite').onclick=()=>action(async()=>{const data=await rpc('create_group_editor_invite',{target_group:group});if(!sessionUser)return;const url=new URL('./members.html',location.href);url.hash=data.token;$('inviteUrl').value=url.href;$('inviteExpiry').textContent='有効期限：'+new Date(data.expires).toLocaleString('ja-JP');$('createdInvite').hidden=false;status.textContent='招待リンクを作成しました。参加してほしい人に共有してください。';});
 $('copyInvite').onclick=()=>action(async()=>{await navigator.clipboard.writeText($('inviteUrl').value);status.textContent='招待リンクをコピーしました。';});
 $('revokeInvites').onclick=()=>action(async()=>{await rpc('revoke_group_editor_invites',{target_group:group});$('createdInvite').hidden=true;$('inviteUrl').value='';status.textContent='未使用の招待リンクをすべて無効化しました。参加済みのメンバーは変わりません。';});
 $('acceptInvite').onclick=()=>action(async()=>{const gid=await rpc('accept_group_editor_invite',{invite_token:invite});if(!sessionUser)return;group=gid;invite='';history.replaceState(null,'','./members.html?'+new URLSearchParams({group}));$('invitation').hidden=true;await load();status.textContent='入力メンバーとして参加しました。';});
 try{const initialGeneration=generation;const auth=await db.auth.getUser();if(initialGeneration!==generation)return;sessionUser=auth.data?.user?.id;
  if(invite){if(!/^[a-f0-9]{64}$/.test(invite))throw {code:'22023'};$('invitation').hidden=false;if(!sessionUser){$('inviteLogin').hidden=false;status.textContent='招待に参加するにはログインが必要です。';return;}const data=await rpc('preview_group_editor_invite',{invite_token:invite});$('inviteHeading').textContent='「'+data.group+'」への招待';$('acceptInvite').hidden=false;status.textContent='グループ名と入力権限を確認して、参加してください。';}
  else {if(!sessionUser){status.textContent='マイグループからログインしてください。';return;}if(!uuid.test(group||''))throw {code:'42501'};await load();}
 }catch(e){fail(e);}
})().catch(()=>{document.getElementById('membersStatus').textContent='画面を開けませんでした。再読み込みしてください。';});
