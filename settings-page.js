async function showSettingsPage() {
  const params = new URLSearchParams(location.search);
  const local = params.has('local');
  const groupId = params.get('group');
  const status = document.getElementById('settingsLoadStatus');
  try {
    if (!local && !groupId) throw new Error('グループ一覧から卓の設定を開いてください。');
    const appearance = local ? null : await openCloudSheet(groupId, true);
    document.getElementById('localGroupControls').hidden = !local;
    document.getElementById('cloudAttachmentNote').hidden = local;
    initTemplateGroups(appearance);
    if (appearance) {
      enableGroupDelete(appearance);
      enableRankingShare(appearance);
    }
    const playLink = document.getElementById('playLink');
    params.set('ui', 'entry-flow-3');
    playLink.href = './index.html?' + params;
    playLink.hidden = false;
    document.getElementById('settingsApp').hidden = false;
    status.hidden = true;
  } catch (error) {
    status.textContent = error.message;
  }
}
showSettingsPage();

function enableGroupDelete(appearance) {
  const el = id => document.getElementById(id);
  const dialog = el('groupDeleteDialog');
  const form = el('groupDeleteForm');
  const confirmation = form.elements.confirmation;
  const status = el('groupDeleteStatus');
  let expectedName;
  let busy = false;

  el('groupDeleteSection').hidden = false;
  el('openGroupDelete').onclick = () => {
    expectedName = el('groupTitle').textContent;
    form.reset();
    status.textContent = '';
    el('groupDeletePrompt').textContent = '「' + expectedName + '」の対局とプレイヤーマスターも削除されます。';
    dialog.showModal();
  };
  el('cancelGroupDelete').onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });

  form.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    if (confirmation.value !== expectedName) {
      status.textContent = '表示された卓名をそのまま入力してください。';
      return;
    }
    busy = true;
    const buttons = form.querySelectorAll('button');
    buttons.forEach(button => { button.disabled = true; });
    status.textContent = '削除中…';
    try {
      await appearance.remove(expectedName);
      location.replace('./account.html?notice=group-deleted');
    } catch (error) {
      status.textContent = error.message;
      busy = false;
      buttons.forEach(button => { button.disabled = false; });
    }
  };
}

function enableRankingShare(appearance) {
  const el = id => document.getElementById(id);
  const status = el('rankingShareStatus');
  const enable = el('enableRankingShare');
  const disable = el('disableRankingShare');
  const preview = el('previewRankingShare');
  const copy = el('copyRankingShare');
  const retry = el('retryRankingShare');
  const controls = [enable, disable, preview, copy, retry];

  async function refresh(action) {
    controls.forEach(control => { control.hidden = true; });
    preview.removeAttribute('href');
    status.textContent = '共有状態を確認中…';
    try {
      const token = await appearance.rankingShare(action);
      status.textContent = token ? '共有中' : '共有オフ';
      enable.hidden = Boolean(token);
      if (token) {
        const url = new URL('./ranking.html', location.href);
        url.hash = token;
        preview.href = url.href;
        preview.hidden = copy.hidden = disable.hidden = false;
      }
    } catch (error) {
      status.textContent = error.code === 'PGRST205'
        ? 'ランキング共有のDB設定が必要です。'
        : '共有状態を確認できませんでした。';
      retry.hidden = false;
    }
  }

  enable.onclick = () => {
    if (confirm('卓名とランキングを、リンクを知っている人に公開しますか？')) refresh('enable');
  };
  disable.onclick = () => {
    if (confirm('このランキングの共有リンクを無効にしますか？')) refresh('disable');
  };
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(preview.href);
      status.textContent = '共有中 · リンクをコピーしました。';
    } catch { prompt('ランキング共有リンクをコピーしてください。', preview.href); }
  };
  retry.onclick = () => refresh();
  el('rankingShareSection').hidden = false;
  refresh();
}
