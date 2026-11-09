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
    if (appearance) enableGroupDelete(appearance);
    const playLink = document.getElementById('playLink');
    playLink.href = './index.html' + location.search;
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
