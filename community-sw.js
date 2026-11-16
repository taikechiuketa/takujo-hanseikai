/* No fetch/cache handler: existing score data and offline behavior are unchanged. */
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{};}catch{}
 const base=new URL('./',self.location.href),url=new URL(data.url||'community.html',base);
 const safe=url.origin===base.origin&&url.pathname===base.pathname+'community.html'?url.href:new URL('community.html',base).href;
 event.waitUntil(self.registration.showNotification(String(data.title||'卓上反省会からのお知らせ'),{body:String(data.body||'新しいお知らせがあります。'),icon:new URL('community-icon-192.png',base).href,badge:new URL('community-icon-192.png',base).href,data:{url:safe}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const target=new URL(event.notification.data?.url||'community.html',self.location.href),base=new URL('./',self.location.href);
 const safe=target.origin===base.origin&&target.pathname===base.pathname+'community.html'?target.href:new URL('community.html',base).href;
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{const existing=clients.find(c=>{const url=new URL(c.url);return url.origin===base.origin&&url.pathname===base.pathname+'community.html';});if(existing){await existing.navigate(safe);return existing.focus();}return self.clients.openWindow(safe);}));
});
