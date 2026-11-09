async function showSharedRanking() {
  const el = id => document.getElementById(id);
  const status = el('rankingStatus');
  const panel = el('rankingPanel');
  const period = el('rankingPeriod');
  const token = location.hash.slice(1);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(token)) {
    status.textContent = 'ランキングの共有リンクを確認してください。';
    return;
  }
  const db = window.supabase.createClient(
    'https://aexmoblpehhcqptvagxh.supabase.co',
    'sb_publishable_USpY-tMqtrFiUCK_ISwqjw_F0z2r1ha',
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const currentMonth = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit',
  }).format(new Date());
  const mode = el('rankingMode');
  const content = el('rankingContent');
  const navigation = el('rankingNavigation');
  let activeSection;
  let personalRequest = 0;
  function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function formatted(key, value) {
    if (value == null) return '—';
    if (key === 'placements') return value.map((count, i) => (i + 1) + '着 ' + count + '回').join(' ／ ');
    if (['top','topTwo','last','winRate'].includes(key)) return value + '%';
    return typeof value === 'number' ? value.toLocaleString('ja-JP') : value;
  }
  function table(parent, rows, fields, { id, renderCell } = {}) {
    const wrapper = element('div');
    wrapper.style.overflowX = 'auto';
    const grid = element('table');
    grid.className = 'history-table';
    if (id) grid.id = id;
    const header = grid.createTHead().insertRow();
    for (const title of Object.values(fields)) {
      const cell = element('th', title);
      cell.scope = 'col';
      header.append(cell);
    }
    const body = grid.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      for (const key of Object.keys(fields)) {
        const cell = tr.insertCell();
        if (!renderCell?.(cell, key, row)) cell.textContent = formatted(key, row[key]);
        if (typeof row[key] === 'number' && row[key] < 0) cell.classList.add('negative');
      }
    }
    wrapper.append(grid);
    parent.append(wrapper);
  }
  function metrics(parent, values, fields) {
    const grid = element('table');
    grid.className = 'history-table';
    const body = grid.createTBody();
    for (const [key, label] of Object.entries(fields)) {
      const row = body.insertRow();
      const title = element('th', label);
      title.scope = 'row';
      const value = element('td', formatted(key, values[key]));
      value.className = 'metric-value';
      if (typeof values[key] === 'number' && values[key] < 0) value.classList.add('negative');
      row.append(title, value);
    }
    parent.append(grid);
  }
  function render(data) {
    const sections = Object.keys(rankingSections).filter(key => Array.isArray(data[key]));
    if (sections.length > 1 && data.personal) sections.splice(sections.indexOf('personal'), 1);
    if (!sections.includes(activeSection)) activeSection = sections[0];
    navigation.replaceChildren();
    navigation.hidden = sections.length < 2;
    const buttons = sections.map(section => {
      const button = element('button', rankingSections[section]);
      button.type = 'button';
      button.classList.toggle('active', section === activeSection);
      button.setAttribute('aria-pressed', String(section === activeSection));
      button.setAttribute('aria-controls', 'rankingContent');
      button.onclick = () => {
        activeSection = section;
        for (const item of navigation.children) {
          item.classList.toggle('active', item === button);
          item.setAttribute('aria-pressed', String(item === button));
        }
        renderSection(data, section);
      };
      return button;
    });
    navigation.append(...buttons);
    renderSection(data, activeSection);
  }
  function filterCaption() {
    return [period.selectedOptions[0]?.textContent, mode.closest('label').hidden ? '' : mode.selectedOptions[0]?.textContent]
      .filter(Boolean).join(' ・ ');
  }
  function renderSection(data, section) {
    content.replaceChildren();
    if (!section) {
      content.append(element('p', '公開されている成績項目はありません。'));
      return;
    }
    const rows = data[section];
    const selected = data.options[section];
    const fields = Object.fromEntries(Object.entries(rankingFields[section])
      .filter(([key]) => selected.includes(key) && !['trend','opponents'].includes(key)));
    const heading = element('h2', rankingSections[section]);
    const caption = element('p', filterCaption());
    caption.className = 'hint';
    content.append(heading, caption);
    if (!rows.length) {
      content.append(element('p', 'この条件の成績はまだありません。'));
      return;
    }
    const showRank = rows.some(row => Object.hasOwn(row, 'rank'));
    const columns = {
      name:'プレイヤー', ...(showRank ? {rank:'順位'} : {}), ...(section === 'personal' ? {} : fields),

    };
    const ratingTrend = element('div');
    table(content, rows, columns, {
      id: section === 'rating' ? 'ratingTable' : 'statsTable',
      renderCell(cell, key, row) {
        if (key === 'name') {
          const personalRows = data.personal?.filter(player => player.name === row.name) ?? [];
          const hasTrend = section === 'rating' && row.trend?.length;
          if (!personalRows.length && !hasTrend) return false;
          const link = element('button', row.name);
          link.type = 'button';
          link.className = 'player-stats-link';
          link.setAttribute('aria-label', row.name + (personalRows.length ? 'の個人成績を開く' : 'のレート推移を見る'));
          const arrow = element('span', ' ›');
          arrow.setAttribute('aria-hidden', 'true');
          link.append(arrow);
          link.onclick = () => {
            if (hasTrend) {
              ratingTrend.replaceChildren();
              const points = row.trend.map((point, index) => ({
                ...point,
                date: point.date.replaceAll('-', '/'),
                before: point.before ?? row.trend[Math.max(0, index - 1)].rating,
              }));
              ratingTrend.innerHTML = rankingCharts.rating(row.name, points);
            }
            if (personalRows.length) openPersonal(data, row.name, personalRows, section === 'rating' ? mode.value : 'all');
          };
          cell.append(link);
          return true;
        }
        return false;
      },
    });
    if (section === 'rating') content.append(ratingTrend);
  }
  function renderPersonal(body, data, rows, trend) {
    body.replaceChildren();
    if (!rows.length) {
      body.append(element('p', 'この条件の成績はまだありません。'));
      return;
    }
    if (rows.length > 1) body.append(element('p', '同じ表示名の選手が複数います。'));
    const fields = Object.fromEntries(Object.entries(rankingFields.personal)
      .filter(([key]) => data.options.personal.includes(key) && key !== 'opponents'));
    rows.forEach((row, index) => {
      const card = element('article');
      if (rows.length > 1) card.append(element('h3', '同名の選手 ' + (index + 1)));
      if (!trend && Object.keys(fields).length) metrics(card, row, fields);
      if (!trend && Array.isArray(row.opponents)) {
        const detail = element('details');
        detail.append(element('summary', '対戦相手別成績'));
        const opponentFields = {rounds:'同卓数',wins:'勝',losses:'負',ties:'分',winRate:'勝率',
          ...(Object.hasOwn(fields, 'averagePoints') ? {averagePoints:'自分の平均pt'} : {})};
        detail.className = 'score-reference';
        if (row.opponents.length) table(detail, row.opponents, {name:'相手', ...opponentFields});
        if (!row.opponents.length) detail.append(element('p', '該当する対戦相手はいません。'));
        card.append(detail);
      }
      if (trend && row.progress?.length) {
        const detail = element('div');
        const hint = element('p', '全ルールのセットごとの累計。選択期間の開始時点を0として表示します。');
        hint.className = 'hint';
        detail.append(hint);
        for (const [key, label, unit] of [['points','ポイント','pt'], ['chips','チップ','枚'], ['balance','収支','pt']]) {
          if (!Object.hasOwn(row.progress[0], key)) continue;
          const points = row.progress.map(point => ({date:point.date.replaceAll('-', '/'),value:point[key]}));
          detail.insertAdjacentHTML('beforeend', rankingCharts.personal(label, unit, points));
        }
        card.append(detail);
      }
      if (trend && !row.progress?.length) card.append(element('p', 'この期間の推移データはありません。'));
      body.append(card);
    });
  }
  function openPersonal(data, name, rows, initialMode) {
    const dialog = el('playerStatsDialog');
    const body = el('playerStatsResults');
    const nav = el('playerStatsTabs');
    const tabs = [...nav.querySelectorAll('button')];
    const month = period.value;
    const datasets = new Map([[mode.value, Promise.resolve({data, rows})]]);
    el('playerStatsTitle').textContent = name + 'の個人成績';
    tabs.find(tab => tab.dataset.mode === 'trend').hidden =
      !data.options.personal.some(key => ['points','chips','balance'].includes(key));
    async function select(tab) {
      const current = ++personalRequest;
      const target = tab.dataset.mode === 'trend' ? 'all' : tab.dataset.mode;
      for (const item of tabs) {
        const active = item === tab;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
        item.tabIndex = active ? 0 : -1;
      }
      body.setAttribute('aria-labelledby', tab.id);
      el('playerStatsPeriod').textContent = period.selectedOptions[0].textContent + ' ・ ' + tab.textContent;
      if (!datasets.has(target)) {
        datasets.set(target, (async () => {
          const response = await db.rpc('get_shared_group_stats', {
            share_token: token, target_month: month ? month + '-01' : null, target_mode: target,
          });
          if (response.error) throw response.error;
          return {data:response.data, rows:response.data?.personal?.filter(player => player.name === name) ?? []};
        })());
      }
      body.textContent = '成績を読み込み中…';
      try {
        const result = await datasets.get(target);
        if (current === personalRequest && dialog.open) renderPersonal(body, result.data, result.rows, tab.dataset.mode === 'trend');
      } catch {
        datasets.delete(target);
        if (current === personalRequest && dialog.open) body.textContent = '成績を取得できませんでした。もう一度タブを選んでください。';
      }
    }
    for (const tab of tabs) tab.onclick = () => select(tab);
    nav.onkeydown = event => {
      const visible = tabs.filter(tab => !tab.hidden);
      const index = visible.indexOf(event.target);
      const next = {ArrowLeft:index-1,ArrowRight:index+1,Home:0,End:visible.length-1}[event.key];
      if (index < 0 || next === undefined) return;
      event.preventDefault();
      const tab = visible[(next+visible.length)%visible.length];
      tab.focus();
      select(tab);
    };
    dialog.showModal();
    select(tabs.find(tab => tab.dataset.mode === initialMode) || tabs[0]);
  }
  async function refresh(month) {
    period.disabled = mode.disabled = true;
    navigation.replaceChildren();
    navigation.hidden = true;
    content.replaceChildren();
    status.textContent = '成績を読み込み中…';
    try {
      const target_month = month ? month + '-01' : null;
      let { data, error } = await db.rpc('get_shared_group_stats', {
        share_token: token, target_month, target_mode: mode.value,
      });
      if (error?.code === 'PGRST202') {
        const legacy = await db.rpc('get_shared_group_ranking', {share_token: token, target_month});
        error = legacy.error;
        data = legacy.data && {...legacy.data, totals:legacy.data.rows, options:defaultRankingOptions};
        mode.closest('label').hidden = true;
      }
      if (error) throw error;
      if (!data) {
        panel.hidden = true;
        el('rankingTitle').textContent = '卓上反省会';
        status.textContent = 'このランキングの共有リンクは無効です。';
        return;
      }
      el('rankingTitle').textContent = data.group;
      const months = [...new Set([currentMonth, ...data.months])].sort().reverse();
      period.replaceChildren(...months.map(value =>
        new Option(value === currentMonth ? value + '（今月）' : value, value)), new Option('通算', ''));
      period.value = month;
      render(data);
      panel.hidden = false;
      status.textContent = '';
    } catch {
      status.textContent = 'ランキングを取得できませんでした。時間をおいて開き直してください。';
    } finally { period.disabled = mode.disabled = false; }
  }
  period.onchange = mode.onchange = () => refresh(period.value);
  await refresh(currentMonth);
}
showSharedRanking().catch(() => {
  document.getElementById('rankingStatus').textContent = 'ランキング画面を読み込めませんでした。';
});
