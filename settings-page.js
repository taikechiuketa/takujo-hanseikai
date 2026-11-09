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
