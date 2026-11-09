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
  function appendRow(section, cells, header = false) {
    const row = section.insertRow();
    for (const value of cells) {
      const cell = document.createElement(header ? 'th' : 'td');
      cell.textContent = value;
      row.append(cell);
    }
  }
  const totals = data.players.map((player, i) => ({
    ...player,
    points: data.rounds.reduce((sum, round) => sum + (Number(round.scores?.[i]) || 0), 0),
  })).sort((a, b) => b.points - a.points);
  const table = document.createElement('table');
  table.className = 'history-table';
  appendRow(table.createTHead(), ['順位', 'プレイヤー', '合計pt', 'チップ'], true);
  const body = table.createTBody();
  totals.forEach(player => appendRow(body, [
    totals.findIndex(row => row.points === player.points) + 1, player.name, player.points, player.chips || '0',
  ]));
  const labels = { normal: '三麻', north: '四人三麻', yonma: '四麻' };
  data.rounds.forEach((round, index) => {
    const line = document.createElement('p');
    line.textContent = (index + 1) + '半荘目（' + (labels[round.mode] || round.mode) + '） ' +
      data.players.map((player, i) => {
        const score = round.scores?.[i];
        return player.name + ' ' + (score == null || score === '' || score === 'skip' ? '—' : score);
      }).join(' ／ ');
    el('shareRounds').append(line);
  });
  el('shareTitle').textContent = data.group;
  el('shareDate').textContent = data.date + ' · 伝票 ' + data.sequence;
  el('shareRanking').append(table);
  el('shareResults').hidden = false;
  el('shareStatus').textContent = '';
}
loadSharedSet().catch(() => {
  document.getElementById('shareStatus').textContent = '結果を取得できませんでした。時間をおいて開き直してください。';
});
