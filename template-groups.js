function initTemplateGroups(cloud) {
  const catalogKey = 'mahjong-business-prototype-groups-v1';
  const groups = cloud ? null : JSON.parse(localStorage.getItem(catalogKey) || '{"demo":{"name":"おためし卓"}}');
  const requested = new URLSearchParams(location.search).get('group');
  const id = cloud?.id ?? (Object.hasOwn(groups, requested) ? requested : 'demo');
  const prefix = 'mahjong-business-prototype-v1:' + id + ':';
  const settingsKey = prefix + 'settings';
  const defaults = { name: cloud?.name ?? groups[id].name, theme: 'lavender-soda', headerColor: '', headerMode: '', rules: '', logo: '', score: null };
  const localSettings = cloud ? null : JSON.parse(localStorage.getItem(settingsKey) || '{}');
  const settings = cloud
    ? { ...defaults, theme: cloud.settings.theme || defaults.theme,
        headerColor: cloud.settings.headerColor || defaults.headerColor,
        headerMode: cloud.settings.headerMode || (cloud.settings.headerColor ? 'custom' : 'auto'), rules: cloud.settings.rules || '' }
    : { ...defaults, ...localSettings };
  const themes = {
    'lavender-soda': ['ラベンダーソーダ', '#5436ba', '#f5f2fc', '#ffffff', '#eae1ff', '#d9cfee', '#231c38'],
    'peach-fizz': ['ピーチフィズ', '#a33f47', '#fff5f1', '#fffcfa', '#f7dcd7', '#ebc7bf', '#3d2528'],
    'blue-hour': ['ブルーアワー', '#315c9b', '#eff5fc', '#ffffff', '#dce8fa', '#c5d6ec', '#1d2d44'],
    'mint-glass': ['ミントグラス', '#176b62', '#eff8f5', '#fcfefd', '#d9efe8', '#bdd9d1', '#18352f'],
    'ink-milk': ['インク＆ミルク', '#43465a', '#f4f4f7', '#ffffff', '#e7e8ef', '#cfd1dc', '#272936'],
    'lemon-tart': ['レモンタルト', '#785315', '#fffae9', '#fffefa', '#f8e9b7', '#e0ce96', '#372e1d'],
    'berry-milk': ['ベリーミルク', '#913b69', '#fcf1f7', '#fffdfd', '#f2daea', '#dec2d5', '#40243a'],
    'sea-glass': ['シーグラス', '#24627d', '#eef7fa', '#fcfeff', '#d9edf2', '#bdd6df', '#213744'],
    'sage-linen': ['セージリネン', '#4e6237', '#f5f7ee', '#fffffc', '#e4ead6', '#cbd6b8', '#303824'],
    'mocha-cream': ['モカクリーム', '#795340', '#f8f2ec', '#fffdf9', '#efded1', '#dcc5b6', '#3d2b23'],
    felt: ['深緑の雀卓', '#14604c', '#e5efdf', '#fcfaf0', '#d1e2ce', '#a5c2ae', '#19392e'],
    midnight: ['深夜の雀荘', '#20395f', '#dbe3f0', '#f5f8ff', '#cdd8ea', '#a4b5d0', '#172740'],
    ivory: ['白牌と真鍮', '#73521e', '#eee3cc', '#fffcf2', '#e8dbc0', '#cab589', '#382c1b'],
    neon: ['ネオン街', '#722a8a', '#eee0fa', '#fffbff', '#e6cdf4', '#caa7dc', '#342042'],
    lacquer: ['漆と朱', '#921e29', '#f4e4df', '#fffbf5', '#eed4cd', '#d4a8a0', '#442427'],
    porcelain: ['青花磁器', '#204c86', '#e5edf3', '#fcfdff', '#d5e3ef', '#a7bdd6', '#233b52'],
    smoke: ['墨と銀', '#424651', '#e2e5ea', '#fafbfc', '#d4d9df', '#aab2bf', '#232732'],
    sunset: ['黄昏の卓', '#87401f', '#f6e3d7', '#fff9f2', '#f1d4c4', '#d9aa91', '#452a24'],
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
  const headers = {
    'lavender-soda': {light:'#eae1ff',dark:'#413467',neutral:'#e8e5ed',auto:'#eae1ff'},
    'peach-fizz': {light:'#f7dcd7',dark:'#673943',neutral:'#efe6e3',auto:'#f7dcd7'},
    'blue-hour': {light:'#dce8fa',dark:'#304662',neutral:'#e4eaf1',auto:'#304662'},
    'mint-glass': {light:'#d9efe8',dark:'#254941',neutral:'#e5ece9',auto:'#d9efe8'},
    'ink-milk': {light:'#e7e8ef',dark:'#333647',neutral:'#e7e7e9',auto:'#333647'},
    'lemon-tart': {light:'#f8e9b7',dark:'#534327',neutral:'#eee9dc',auto:'#f8e9b7'},
    'berry-milk': {light:'#f2daea',dark:'#573549',neutral:'#ede5ea',auto:'#f2daea'},
    'sea-glass': {light:'#d9edf2',dark:'#274a5a',neutral:'#e4ebed',auto:'#d9edf2'},
    'sage-linen': {light:'#e4ead6',dark:'#3a4931',neutral:'#e9ebe3',auto:'#e4ead6'},
    'mocha-cream': {light:'#efded1',dark:'#594236',neutral:'#ece5df',auto:'#594236'},
  };
  const el = name => document.getElementById(name);
  const form = el('groupSettings');
  const palette = el('paletteSettings');
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
    (themes[key] || themes[defaults.theme]).slice(1).forEach((color, index) => {
      document.documentElement.style.setProperty('--' + names[index], color);
    });
    document.querySelector('meta[name="theme-color"]').content = (themes[key] || themes[defaults.theme])[1];
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

  const headerMode = el('headerMode');
  const sliders = ['headerHue','headerSaturation','headerLightness'].map(el);
  const colorCode = el('headerColorCode');
  const validModes = ['auto','light','dark','neutral','custom'];
  const savedMode = () => validModes.includes(settings.headerMode) ? settings.headerMode : settings.headerColor ? 'custom' : 'auto';
  let customColor;
  function headerFor(theme, mode, custom) {
    const palette = themes[theme] || themes[defaults.theme];
    const choices = headers[theme] || { light:palette[4], dark:palette[1], neutral:'#e7e7e9', auto:palette[4] };
    return mode === 'custom' ? custom || choices.auto : choices[mode];
  }
  function updateHeader() {
    const color = headerFor(palette.elements.theme.value, headerMode.value, customColor);
    el('headerSliders').hidden = headerMode.value !== 'custom';
    colorCode.value = color.toUpperCase();
    applyHeaderColor(color);
  }
  function initializeSliders(hex) {
    const [r,g,b] = hex.slice(1).match(/../g).map(channel => parseInt(channel,16)/255);
    const max = Math.max(r,g,b), min = Math.min(r,g,b), delta = max-min, light = (max+min)/2;
    const hue = !delta ? 0 : max===r ? (g-b)/delta : max===g ? (b-r)/delta+2 : (r-g)/delta+4;
    sliders[0].value = Math.round((hue*60+360)%360)%360;
    sliders[1].value = delta ? Math.round(100*delta/(1-Math.abs(2*light-1))) : 0;
    sliders[2].value = Math.round(light*100);
  }
  if (palette) {
  headerMode.onchange = updateHeader;
  for (const slider of sliders) slider.oninput = () => {
    const [h,s,l] = sliders.map(input => Number(input.value));
    const light = l/100, amplitude = s/100*Math.min(light,1-light);
    const channel = offset => {
      const k = (offset+h/30)%12;
      return Math.round(255*(light-amplitude*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');
    };
    customColor = '#'+channel(0)+channel(8)+channel(4);
    updateHeader();
  };

  }

  function renderThemeChoices(selectedTheme) {
    el('themeChoices').replaceChildren();
    for (const [key, [name, accent, background, surface]] of Object.entries(themes)) {
      if (!headers[key] && key !== selectedTheme) continue;
      const label = document.createElement('label');
      label.className = 'theme-choice';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'theme';
      radio.value = key;
      radio.checked = key === selectedTheme;
      radio.onchange = () => { applyTheme(key); updateHeader(); };
      const dot = document.createElement('span');
      dot.className = 'theme-dot';
      dot.style.background = 'linear-gradient(90deg,' + accent + ' 34%,' + background + ' 34% 67%,' + surface + ' 67%)';
      label.append(radio, dot, name);
      el('themeChoices').append(label);
    }
  }

  function openGroup(groupId) {
    const url = new URL(location.href);
    url.searchParams.set('group', groupId);
    location.assign(url);
  }

  function renderPalette() {
    const selectedTheme = Object.hasOwn(themes, settings.theme) ? settings.theme : defaults.theme;
    applyTheme(selectedTheme);
    if (palette) {
      renderThemeChoices(selectedTheme);
      headerMode.value = savedMode();
      customColor = /^#[0-9a-f]{6}$/i.test(settings.headerColor) ? settings.headerColor : headerFor(selectedTheme,'auto');
      initializeSliders(customColor);
      updateHeader();
    } else {
      applyHeaderColor(headerFor(selectedTheme,savedMode(),settings.headerColor));
    }
  }

  function render() {
    el('groupTitle').textContent = settings.name;
    if (form) {
      el('groupName').value = settings.name;
      el('groupRules').value = settings.rules;
    }
    el('groupRulesPreview').textContent = settings.rules || 'ルールは未設定です。';
    if (logoUrl) URL.revokeObjectURL(logoUrl);
    if (scoreUrl) URL.revokeObjectURL(scoreUrl);
    logoUrl = settings.logo instanceof Blob ? URL.createObjectURL(settings.logo) : null;
    scoreUrl = settings.score?.file ? URL.createObjectURL(settings.score.file) : null;

    const logo = el('groupLogo');
    logo.hidden = !settings.logo;
    if (settings.logo) logo.src = logoUrl || settings.logo;
    else logo.removeAttribute('src');
    if (form) el('logoSelection').textContent = settings.logo ? '画像を登録済み' : '未登録';

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
    if (form) el('scoreSelection').textContent = settings.score?.name || '未登録';
    if (!cloud && form) el('groupPicker').replaceChildren(...Object.entries(groups).map(([key, group]) =>
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

  if (form) for (const [field, status, allowPdf] of [
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

  if (!cloud && form) {
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
  if (form) form.onsubmit = async event => {
    event.preventDefault();
    const name = el('groupName').value.trim();
    if (!name) return;
    setSaving(true);
    try {
      const next = { ...settings, name, rules: el('groupRules').value };
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
        Object.assign(settings, { name: next.name, theme: next.theme, headerColor: next.headerColor, headerMode: next.headerMode, rules: next.rules });
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
      setSaving(false);
    }
  };
  const saveButtons = [form, palette].map(section => section?.querySelector('button[type=submit]')).filter(Boolean);
  function setSaving(disabled) {
    for (const button of saveButtons) button.disabled = disabled;
  }
  if (palette) palette.onsubmit = async event => {
    event.preventDefault();
    const theme = palette.elements.theme.value;
    const appearance = { theme, headerMode: headerMode.value, headerColor: headerFor(theme, headerMode.value, customColor) };
    const status = el('paletteStatus');
    setSaving(true);
    try {
      const next = { ...settings, ...appearance };
      if (cloud) await cloud.save(next);
      else await accessSettings('readwrite', records => records.put(next, id));
      Object.assign(settings, appearance);
      status.textContent = '配色を保存しました。';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      setSaving(false);
    }
  };
  render();
  renderPalette();
  setSaving(true);
  accessSettings('readonly', records => records.get(id))
    .then(saved => {
      if (saved) Object.assign(settings, cloud ? { logo: saved.logo, score: saved.score } : saved);
      render();
      renderPalette();
    })
    .catch(() => { if (form) el('groupStatus').textContent = 'ブラウザのファイル保存領域を開けませんでした。'; })
    .finally(() => setSaving(false));
  return prefix;
}
