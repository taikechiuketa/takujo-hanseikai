function initTemplateGroups(cloud) {
  const catalogKey = 'mahjong-business-prototype-groups-v1';
  const groups = cloud ? null : JSON.parse(localStorage.getItem(catalogKey) || '{"demo":{"name":"おためし卓"}}');
  const requested = new URLSearchParams(location.search).get('group');
  const id = cloud?.id ?? (Object.hasOwn(groups, requested) ? requested : 'demo');
  const prefix = 'mahjong-business-prototype-v1:' + id + ':';
  const settingsKey = prefix + 'settings';
  const defaults = { name: cloud?.name ?? groups[id].name, theme: 'red', headerColor: '#171b21', rules: '', logo: '', score: null };
  const settings = cloud
    ? { ...defaults, theme: cloud.settings.theme || defaults.theme,
        headerColor: cloud.settings.headerColor || defaults.headerColor, rules: cloud.settings.rules || '' }
    : { ...defaults, ...JSON.parse(localStorage.getItem(settingsKey) || '{}') };
  const themes = {
    red: ['紅', '#a51d3b', '#fff1f3', '#fffafb', '#fce4e9', '#e8c4cc', '#351d25'],
    blue: ['藍', '#254db6', '#eef4ff', '#fbfdff', '#dce8ff', '#bfceed', '#192e54'],
    green: ['深緑', '#197053', '#eaf7ef', '#fafffb', '#d8efe2', '#b9daca', '#183a2c'],
    amber: ['琥珀', '#8b4b12', '#fff6e8', '#fffdfa', '#f9e9cf', '#e5cfaa', '#3c2a18'],
    plum: ['梅紫', '#794181', '#f8effa', '#fffaff', '#f0def4', '#dec7e4', '#38253d'],
    slate: ['墨青', '#40546e', '#eef2f7', '#fafcff', '#e0e7f0', '#c7d1df', '#263749'],
    teal: ['青磁', '#21666d', '#eaf7f6', '#f9fefd', '#d7eeeb', '#b8d8d5', '#193d40'],
    cocoa: ['珈琲', '#79503b', '#f7efe9', '#fffaf6', '#eee0d5', '#ddcaba', '#3b2c25'],
    indigo: ['藤紺', '#51478d', '#f2effb', '#fcfbff', '#e7e1fa', '#d2c9ed', '#302849'],
    rose: ['薄紅', '#943758', '#fbf0f4', '#fffafb', '#f7e0eb', '#e4c3d1', '#402632'],
    olive: ['若草', '#52672a', '#f3f6e9', '#fdfff8', '#e8efd8', '#ccd8b3', '#313b22'],
    mono: ['墨白', '#353535', '#f0f0f0', '#fff', '#e9e9e9', '#d0d0d0', '#242424'],
  };
  const el = name => document.getElementById(name);
  const form = el('groupSettings');
  let logoUrl, scoreUrl;
  let database;

  function accessSettings(mode, action) {
    database ||= new Promise((resolve, reject) => {
      const request = indexedDB.open('takujo-hanseikai-settings', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('groups');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return database.then(db => new Promise((resolve, reject) => {
      const transaction = db.transaction('groups', mode);
      const request = action(transaction.objectStore('groups'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    }));
  }

  function applyTheme(key) {
    const names = ['accent', 'theme-bg', 'theme-surface', 'theme-muted', 'theme-border', 'theme-text'];
    (themes[key] || themes.red).slice(1).forEach((color, index) => {
      document.documentElement.style.setProperty('--' + names[index], color);
    });
    document.querySelector('meta[name="theme-color"]').content = (themes[key] || themes.red)[1];
  }

  function applyHeaderColor(color) {
    const hex = /^#[0-9a-f]{6}$/i.test(color) ? color : '#171b21';
    const [red, green, blue] = hex.slice(1).match(/../g).map(channel => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    document.documentElement.style.setProperty('--header-bg', hex);
    document.documentElement.style.setProperty('--header-text', luminance > 0.179 ? '#000' : '#fff');
  }

  const headerColor = el('headerColor');
  headerColor.oninput = () => applyHeaderColor(headerColor.value);
  el('resetHeaderColor').onclick = () => {
    headerColor.value = defaults.headerColor;
    applyHeaderColor(headerColor.value);
  };

  for (const [key, [name, accent]] of Object.entries(themes)) {
    const label = document.createElement('label');
    label.className = 'theme-choice';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'theme';
    radio.value = key;
    radio.onchange = () => applyTheme(key);
    const dot = document.createElement('span');
    dot.className = 'theme-dot';
    dot.style.backgroundColor = accent;
    label.append(radio, dot, name);
    el('themeChoices').append(label);
  }

  function openGroup(groupId) {
    const url = new URL(location.href);
    url.searchParams.set('group', groupId);
    location.assign(url);
  }

  function render() {
    el('groupTitle').textContent = settings.name;
    el('groupName').value = settings.name;
    form.elements.theme.value = settings.theme;
    el('groupRules').value = settings.rules;
    el('groupRulesPreview').textContent = settings.rules || 'ルールは未設定です。';
    applyTheme(settings.theme);
    headerColor.value = settings.headerColor;
    applyHeaderColor(headerColor.value);

    if (logoUrl) URL.revokeObjectURL(logoUrl);
    if (scoreUrl) URL.revokeObjectURL(scoreUrl);
    logoUrl = settings.logo instanceof Blob ? URL.createObjectURL(settings.logo) : null;
    scoreUrl = settings.score?.file ? URL.createObjectURL(settings.score.file) : null;

    const logo = el('groupLogo');
    logo.hidden = !settings.logo;
    if (settings.logo) logo.src = logoUrl || settings.logo;
    else logo.removeAttribute('src');
    el('logoSelection').textContent = settings.logo ? '画像を登録済み' : '未登録';

    const score = el('groupScoreLink');
    const preview = el('groupScorePreview');
    score.hidden = !settings.score;
    preview.hidden = !(settings.score?.file?.type.startsWith('image/') || settings.score?.url?.startsWith('data:image/'));
    if (settings.score) {
      score.href = scoreUrl || settings.score.url;
      score.download = settings.score.name;
      if (!preview.hidden) preview.src = score.href;
      else preview.removeAttribute('src');
    } else {
      score.removeAttribute('href');
      preview.removeAttribute('src');
    }
    el('scoreSelection').textContent = settings.score?.name || '未登録';
    if (!cloud) el('groupPicker').replaceChildren(...Object.entries(groups).map(([key, group]) =>
      new Option(key === id ? settings.name : group.name, key, false, key === id)
    ));
  }

  function validateAttachment(file, allowPdf) {
    const types = ['image/png', 'image/jpeg', 'image/webp'];
    if (allowPdf) types.push('application/pdf');
    if (!types.includes(file.type) || file.size > 10_000_000 || file.size === 0) {
      throw new Error('対応形式のファイルを選んでください。上限は10 MBです。');
    }
  }

  for (const [field, status, allowPdf] of [
    ['groupLogoFile', 'logoSelection', false],
    ['groupScoreFile', 'scoreSelection', true],
  ]) {
    el(field).onchange = () => {
      const file = el(field).files[0];
      if (!file) return;
      try {
        validateAttachment(file, allowPdf);
        el(status).textContent = file.name + ' を選択しました。設定を保存してください。';
      } catch (error) {
        el(field).value = '';
        el(status).textContent = error.message;
      }
    };
  }

  if (!cloud) {
    el('groupPicker').onchange = event => openGroup(event.target.value);
    el('createGroup').onclick = () => {
      const name = prompt('新しいグループ名')?.trim().slice(0, 60);
      if (!name) return;
      const key = crypto.randomUUID();
      try {
        localStorage.setItem(catalogKey, JSON.stringify({ ...groups, [key]: { name } }));
      } catch {
        el('groupStatus').textContent = 'グループを保存できませんでした。';
        alert('グループを保存できませんでした。');
        return;
      }
      openGroup(key);
    };
  }
  form.onsubmit = async event => {
    event.preventDefault();
    const name = el('groupName').value.trim();
    if (!name) return;
    const submit = event.submitter;
    submit.disabled = true;
    try {
      const next = { ...settings, name, theme: form.elements.theme.value, headerColor: headerColor.value, rules: el('groupRules').value };
      const logoFile = el('groupLogoFile').files[0];
      const scoreFile = el('groupScoreFile').files[0];
      if (logoFile) {
        validateAttachment(logoFile, false);
        next.logo = logoFile;
      }
      else if (el('removeLogo').checked) next.logo = '';
      if (scoreFile) {
        validateAttachment(scoreFile, true);
        next.score = { name: scoreFile.name, file: scoreFile };
      }
      else if (el('removeScore').checked) next.score = null;
      if (cloud) {
        await cloud.save(next);
        Object.assign(settings, { name: next.name, theme: next.theme, headerColor: next.headerColor, rules: next.rules });
        await accessSettings('readwrite', records => records.put({ logo: next.logo, score: next.score }, id));
      } else {
        await accessSettings('readwrite', records => records.put(next, id));
        groups[id].name = name;
        try { localStorage.setItem(catalogKey, JSON.stringify(groups)); } catch {}
      }
      Object.assign(settings, next);
      for (const field of ['groupLogoFile', 'groupScoreFile']) el(field).value = '';
      for (const field of ['removeLogo', 'removeScore']) el(field).checked = false;
      render();
      el('groupStatus').textContent = '保存しました。';
    } catch (error) {
      el('groupStatus').textContent = error.name === 'QuotaExceededError'
        ? '端末の保存容量が不足しています。'
        : error.message;
    } finally {
      submit.disabled = false;
    }
  };
  render();
  const submit = form.querySelector('button[type=submit]');
  submit.disabled = true;
  accessSettings('readonly', records => records.get(id))
    .then(saved => {
      if (saved) Object.assign(settings, cloud ? { logo: saved.logo, score: saved.score } : saved);
      render();
    })
    .catch(() => { el('groupStatus').textContent = 'ブラウザのファイル保存領域を開けませんでした。'; })
    .finally(() => { submit.disabled = false; });
  return prefix;
}
