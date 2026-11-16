/* Group metadata comes from the validated shared page; the server rechecks sharing. */
(()=>{
 window.HanseiGroupPwa=(share,name)=>{
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(share))return;
  const link=document.querySelector('link[rel="manifest"]');if(!link)return;
  const url='https://hansei-community.finepumpkin4.chatgpt.site/api/community/manifest?share='+encodeURIComponent(share.toLowerCase());
  if(link.href!==url){window.dispatchEvent(new Event('hansei-manifest-changed'));link.crossOrigin='anonymous';link.href=url;}
  if(typeof name!=='string'||!name.trim())return;
  for(const key of ['apple-mobile-web-app-title','application-name']){let meta=document.querySelector('meta[name="'+key+'"]');if(!meta){meta=document.createElement('meta');meta.name=key;document.head.append(meta);}meta.content=name;}
 };
 window.HanseiGroupPwa(location.hash.slice(1));
})();
