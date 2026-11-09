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
  function table(parent, rows, fields) {
    const wrapper = element('div');
    wrapper.style.overflowX = 'auto';
    const grid = element('table');
    grid.className = 'history-table';
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
        cell.textContent = formatted(key, row[key]);
        if (typeof row[key] === 'number' && row[key] < 0) cell.classList.add('negative');
      }
    }
    wrapper.append(grid);
    parent.append(wrapper);
  }
  function render(data) {
    content.replaceChildren();
    for (const [section, label] of Object.entries(rankingSections)) {
      if (!Array.isArray(data[section])) continue;
      const rows = data[section];
      const fields = Object.fromEntries(Object.entries(rankingFields[section])
        .filter(([key]) => data.options[section].includes(key) && !['trend','opponents'].includes(key)));
      content.append(element('h2', label));
      if (!rows.length) {
        content.append(element('p', 'この条件の成績はまだありません。'));
        continue;
      }
      if (section !== 'personal') {
        table(content, rows, {
          ...(Object.hasOwn(rows[0], 'rank') ? {rank:'順位'} : {}), name:'プレイヤー', ...fields,
        });
        if (section === 'rating' && data.options.rating.includes('trend')) {
          for (const row of rows) {
            if (!row.trend?.length) continue;
            const detail = element('details');
            detail.append(element('summary', row.name + 'のレート推移'));
            table(detail, row.trend, {date:'対局日',rating:'レート'});
            content.append(detail);
          }
        }
      } else {
        for (const row of rows) {
          const detail = element('details');
          detail.append(element('summary', row.name));
          if (Object.keys(fields).length) table(detail, [row], fields);
          if (Array.isArray(row.opponents)) {
            detail.append(element('h3', '対戦相手別成績'));
            table(detail, row.opponents, {name:'相手',rounds:'同卓数',wins:'勝',losses:'負',ties:'分',winRate:'勝率',
              ...(Object.hasOwn(fields, 'averagePoints') ? {averagePoints:'自分の平均pt'} : {})});
          }
          content.append(detail);
        }
      }
    }
    if (!content.childElementCount) content.append(element('p', '公開されている成績項目はありません。'));
  }
  async function refresh(month) {
    period.disabled = mode.disabled = true;
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
