window.HanseiCommunityContext=async()=>{
 const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i,params=new URLSearchParams(location.search);
 let share=location.hash.slice(1),group=params.get('group');
 if(group){
  if(!uuid.test(group))throw Error('マイグループから卓を開いてください。');
  const db=window.supabase.createClient('https://aexmoblpehhcqptvagxh.supabase.co','sb_publishable_USpY-tMqtrFiUCK_ISwqjw_F0z2r1ha');
  const auth=await db.auth.getUser();if(auth.error||!auth.data.user)throw Error('管理者はログインしてからマイグループの「参加募集」を開いてください。');
  const selected=await db.from('groups').select('id,name').eq('id',group).maybeSingle();if(selected.error||!selected.data)throw Error('この卓を開けません。マイグループから開き直してください。');
  const access=await db.from('group_ranking_shares').select('token').eq('group_id',group).maybeSingle();
  if(access.error)throw Error('閲覧共有の設定を確認できませんでした。');
  if(!access.data){const link=document.createElement('a');link.href='./settings.html?'+new URLSearchParams({group});link.textContent='卓の設定を開く';document.getElementById('globalStatus').after(link);throw Error('先に卓の設定で「ランキングページの共有」を有効にしてください。仲間はその閲覧共有リンクから募集と通知を利用できます。');}
  share=access.data.token;
 }else if(!share){share=localStorage.getItem('hansei-community-last-share')||'';}
 if(!uuid.test(share))throw Error('卓の閲覧共有リンクから「参加募集・通知」を開いてください。管理者はマイグループから卓を選べます。');
 return {share:share.toLowerCase(),group};
};
