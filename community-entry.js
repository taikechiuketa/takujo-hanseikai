window.HanseiSharedEntryUrl=(text,base=location.href)=>{
 const url=new URL(text.trim()),current=new URL(base),uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
 if(url.origin!==current.origin||!['/takujo-hanseikai/ranking.html','/takujo-hanseikai/community.html'].includes(url.pathname)||!uuid.test(url.hash.slice(1)))throw Error('卓上反省会の閲覧共有リンクか募集リンクを貼り付けてください。');
 const target=new URL('./community.html',base);const event=url.searchParams.get('event');if(event&&uuid.test(event))target.searchParams.set('event',event);target.searchParams.set('open',String(Date.now()));target.hash=url.hash;return target.href;
};
const sharedEntryForm=document.getElementById('sharedEntryForm');if(sharedEntryForm)sharedEntryForm.onsubmit=event=>{event.preventDefault();try{location.href=window.HanseiSharedEntryUrl(document.getElementById('sharedEntryUrl').value);}catch{document.getElementById('sharedEntryStatus').textContent='リンクを確認してください。卓上反省会の閲覧共有リンクか募集リンクを貼り付けてください。';}};
