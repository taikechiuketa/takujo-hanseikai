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
  function metrics(parent, values, fields) {
    const list = element('dl');
    list.className = 'ranking-metrics';
    for (const [key, label] of Object.entries(fields)) {
      const metric = element('div');
      const value = element('dd', formatted(key, values[key]));
      if (typeof values[key] === 'number' && values[key] < 0) value.classList.add('negative');
      metric.append(element('dt', label), value);
      list.append(metric);
    }
    parent.append(list);
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
      button.setAttribute('aria-pressed', String(section === activeSection));
      button.setAttribute('aria-controls', 'rankingContent');
      button.onclick = () => {
        activeSection = section;
        for (const item of navigation.children) item.setAttribute('aria-pressed', String(item === button));
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
    heading.className = 'ranking-heading';
    const caption = element('p', filterCaption());
    caption.className = 'ranking-context';
    content.append(heading, caption);
    if (!rows.length) {
      content.append(element('p', 'この条件の成績はまだありません。'));
      return;
    }
    const cards = element('div');
    cards.className = 'ranking-cards';
    for (const row of rows) {
      const card = element('article');
      card.className = 'ranking-player';
      const title = element('h3');
      if (Object.hasOwn(row, 'rank') || (section === 'rating' && selected.includes('rating'))) {
        const badge = element('span', (row.rank ?? rows.findIndex(item => item.rating === row.rating) + 1) + '位');
        badge.className = 'ranking-position';
        title.append(badge);
      }
      const personalRows = data.personal?.filter(player => player.name === row.name) ?? [];
      if (personalRows.length) {
        const link = element('button', row.name);
        link.type = 'button';
        link.className = 'ranking-player-link';
        link.setAttribute('aria-label', row.name + 'の個人成績を開く');
        const arrow = element('span', '›');
        arrow.setAttribute('aria-hidden', 'true');
        link.append(arrow);
        link.onclick = () => openPersonal(data, row.name, personalRows);
        title.append(link);
      } else {
        title.append(element('span', row.name));
      }
      card.append(title);
      if (section === 'personal') {
        cards.append(card);
        continue;
      }
      const primary = section === 'rating' ? 'rating' : 'points';
      if (Object.hasOwn(fields, primary)) {
        const highlight = element('p');
        highlight.className = 'ranking-highlight';
        const number = element('strong', formatted(primary, row[primary]));
        if (row[primary] < 0) number.classList.add('negative');
        highlight.append(number, element('span', primary === 'points' ? 'pt' : '現在のレート'));
        card.append(highlight);
      }
      const otherFields = Object.fromEntries(Object.entries(fields).filter(([key]) => key !== primary));
      if (Object.keys(otherFields).length) metrics(card, row, otherFields);
      if (section === 'rating' && row.trend?.length) {
        const detail = element('details');
        detail.append(element('summary', 'レート推移'));
        table(detail, row.trend, {date:'対局日',rating:'レート'});
        card.append(detail);
      }
      cards.append(card);
    }
    content.append(cards);
  }
  function openPersonal(data, name, rows) {
    const dialog = el('rankingPlayerDialog');
    const body = el('rankingPlayerContent');
    el('rankingPlayerTitle').textContent = name + 'の個人成績';
    const caption = element('p', filterCaption());
    caption.className = 'ranking-context';
    body.replaceChildren(caption);
    if (rows.length > 1) body.append(element('p', '同じ表示名の選手が複数います。'));
    const fields = Object.fromEntries(Object.entries(rankingFields.personal)
      .filter(([key]) => data.options.personal.includes(key) && key !== 'opponents'));
    rows.forEach((row, index) => {
      const card = element('article');
      card.className = 'ranking-player';
      if (rows.length > 1) card.append(element('h3', '同名の選手 ' + (index + 1)));
      if (Object.keys(fields).length) metrics(card, row, fields);
      if (Array.isArray(row.opponents)) {
        const detail = element('details');
        detail.append(element('summary', '対戦相手別成績'));
        const opponentFields = {rounds:'同卓数',wins:'勝',losses:'負',ties:'分',winRate:'勝率',
          ...(Object.hasOwn(fields, 'averagePoints') ? {averagePoints:'自分の平均pt'} : {})};
        for (const opponent of row.opponents) {
          detail.append(element('h4', opponent.name));
          metrics(detail, opponent, opponentFields);
        }
        if (!row.opponents.length) detail.append(element('p', '該当する対戦相手はいません。'));
        card.append(detail);
      }
      body.append(card);
    });
    dialog.showModal();
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
