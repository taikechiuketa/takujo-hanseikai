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
    params.set('ui', 'history-actions-1');
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
  const save = el('saveRankingOptions');
  const form = el('rankingOptions');
  const controls = [enable, disable, preview, copy, retry, save];
  const sections = Object.entries(rankingFields).map(([section, fields]) => {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    const label = document.createElement('label');
    label.append(toggle, ' ' + rankingSections[section] + 'を公開');
    legend.append(label);
    fieldset.append(legend);
    const inputs = Object.entries(fields).map(([key, title]) => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      const item = document.createElement('label');
      item.style.display = 'block';
      item.append(input, ' ' + title);
      fieldset.append(item);
      return [key, input];
    });
    function update() {
      for (const [key, input] of inputs) {
        const requiresRating = section === 'rating' && ['change', 'trend'].includes(key);
        input.disabled = !toggle.checked || (requiresRating && !inputs[0][1].checked);
      }
    }
    fieldset.onchange = update;
    form.append(fieldset);
    return { section, toggle, inputs, update };
  });
  function showOptions(options) {
    for (const { section, toggle, inputs, update } of sections) {
      toggle.checked = options[section].length > 0;
      for (const [key, input] of inputs) input.checked = options[section].includes(key);
      update();
    }
  }
  function selectedOptions() {
    return Object.fromEntries(sections.map(({ section, inputs }) =>
      [section, inputs.filter(([, input]) => input.checked && !input.disabled).map(([key]) => key)]));
  }

  async function refresh(action, options) {
    form.hidden = true;
    controls.forEach(control => { control.hidden = true; });
    preview.removeAttribute('href');
    status.textContent = '共有状態を確認中…';
    try {
      const share = await appearance.rankingShare(action, options);
      const token = share?.token;
      showOptions(share?.options ?? defaultRankingOptions);
      form.hidden = false;
      save.hidden = !token;
      status.textContent = token ? (action === 'save' ? '公開項目を保存しました。' : '共有中') : '共有オフ';
      enable.hidden = Boolean(token);
      if (token) {
        const url = new URL('./ranking.html', location.href);
        url.hash = token;
        preview.href = url.href;
        preview.hidden = copy.hidden = disable.hidden = false;
      }
    } catch (error) {
      status.textContent = ['PGRST205', 'PGRST204', '42703'].includes(error.code)
        ? 'ランキング共有のDB設定が必要です。'
        : '共有状態を確認できませんでした。';
      retry.hidden = false;
    }
  }

  enable.onclick = () => {
    if (confirm('卓名とランキングを、リンクを知っている人に公開しますか？')) refresh('enable', selectedOptions());
  };
  save.onclick = () => refresh('save', selectedOptions());
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
