async function loadSharedSet() {
  const el = id => document.getElementById(id);
  const token = location.hash.slice(1);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(token)) {
    el('shareStatus').textContent = '共有リンクを確認してください。';
    return;
  }
  const db = window.supabase.createClient(
    'https://aexmoblpehhcqptvagxh.supabase.co',
    'sb_publishable_USpY-tMqtrFiUCK_ISwqjw_F0z2r1ha',
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const { data, error } = await db.rpc('get_shared_set', { share_token: token });
  if (error) throw error;
  if (!data) {
    el('shareStatus').textContent = 'このリンクは無効か、セットが削除されています。';
    return;
  }
  const ratesAvailable = Object.hasOwn(data, 'rate') && Object.hasOwn(data, 'chipRate');
  const rate = Number(data.rate || 0);
  const chipRate = Number(data.chipRate || 0);
  const format = value => (value > 0 ? '+' : '') + value.toLocaleString('ja-JP');
  const scoreAt = (round, i) => {
    const score = round.scores?.[i];
    return score == null || score === '' || score === 'skip' || !Number.isInteger(Number(score))
      ? null : Number(score);
  };
  function appendRow(section, cells, header = false) {
    const row = section.insertRow();
    cells.forEach((value, index) => {
      const cell = document.createElement(header || index === 0 ? 'th' : 'td');
      if (header || index === 0) cell.scope = header ? 'col' : 'row';
      cell.textContent = typeof value === 'number' ? format(value) : value;
      if (typeof value === 'number' && value < 0) cell.classList.add('negative');
      row.append(cell);
    });
  }
  function makeTable(container, headers) {
    const table = document.createElement('table');
    table.className = 'history-table';
    appendRow(table.createTHead(), headers, true);
    el(container).append(table);
    return table.createTBody();
  }
  const summary = makeTable('shareRanking', ['プレイヤー', 'ポイント', 'チップ', '精算額']);
  data.players.forEach((player, i) => {
    const points = data.rounds.reduce((sum, round) => sum + (scoreAt(round, i) ?? 0), 0);
    const chips = Number(player.chips) || 0;
    const amount = points * rate + chips * chipRate;
    appendRow(summary, [player.name, points, chips, ratesAvailable ? format(amount) + ' pt' : '—']);
    summary.lastElementChild.lastElementChild.classList.toggle('negative', ratesAvailable && amount < 0);
  });
  const rounds = makeTable('shareRounds', ['半荘', ...data.players.map(player => player.name)]);
  const labels = { normal: '三麻', north: '四人三麻', yonma: '四麻' };
  data.rounds.forEach((round, index) => {
    appendRow(rounds, [
      (index + 1) + ' ・ ' + (labels[round.mode] || round.mode),
      ...data.players.map((_, i) => scoreAt(round, i) ?? '—'),
    ]);
  });
  document.title = data.group + '｜セット結果';
  el('shareGroup').textContent = data.group;
  el('shareTitle').textContent = 'セット結果';
  el('shareDate').textContent = data.date.replaceAll('-', '/') + ' ・ 伝票 ' + data.sequence;
  el('shareRates').textContent = ratesAvailable
    ? 'ポイント倍率 ' + rate + ' ／ チップレート ' + chipRate + ' pt/枚'
    : 'このセットの精算額は現在表示できません。';
  el('copyShareLink').onclick = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      el('copyShareStatus').textContent = '共有リンクをコピーしました。';
    } catch {
      el('copyShareStatus').textContent = 'コピーできませんでした。ブラウザのアドレス欄からコピーしてください。';
    }
  };
  el('shareResults').hidden = false;
  el('shareStatus').textContent = '';
}
loadSharedSet().catch(() => {
  document.getElementById('shareStatus').textContent = '結果を取得できませんでした。時間をおいて開き直してください。';
});
