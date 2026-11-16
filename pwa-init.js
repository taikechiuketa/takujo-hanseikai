/* Register notifications without caching or changing score requests. */
(()=>{
 const button=document.getElementById('installApp'),status=document.getElementById('pwaInstallStatus');let prompt;
 if('serviceWorker'in navigator)navigator.serviceWorker.register('./community-sw.js',{scope:'./'}).catch(()=>{if(status)status.textContent='アプリの準備に失敗しました。通信を確認して再読み込みしてください。';});
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event;if(button)button.hidden=false;});
 if(button)button.onclick=async()=>{if(!prompt)return;button.disabled=true;try{await prompt.prompt();const choice=await prompt.userChoice;if(status)status.textContent=choice.outcome==='accepted'?'インストールを受け付けました。端末のホーム画面を確認してください。':'インストールをキャンセルしました。';}catch{if(status)status.textContent='インストールを開始できませんでした。Chromeのメニューから「ホーム画面に追加」も試してください。';}finally{prompt=undefined;button.hidden=true;button.disabled=false;}};
 window.addEventListener('appinstalled',()=>{prompt=undefined;if(button)button.hidden=true;if(status)status.textContent='アプリをインストールしました。';});
})();
