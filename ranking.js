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
  async function refresh(month) {
    period.disabled = true;
    el('rankingRows').replaceChildren();
    status.textContent = '成績を読み込み中…';
    try {
      const { data, error } = await db.rpc('get_shared_group_ranking', {
        share_token: token, target_month: month ? month + '-01' : null,
      });
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
      for (const entry of data.rows) {
        const row = el('rankingRows').insertRow();
        for (const value of [entry.rank, entry.name, entry.points, entry.rounds]) row.insertCell().textContent = value;
      }
      panel.hidden = false;
      status.textContent = data.rows.length ? '' : 'この期間の成績はまだありません。';
    } catch {
      status.textContent = 'ランキングを取得できませんでした。時間をおいて開き直してください。';
    } finally { period.disabled = false; }
  }
  period.onchange = () => refresh(period.value);
  await refresh(currentMonth);
}
showSharedRanking().catch(() => {
  document.getElementById('rankingStatus').textContent = 'ランキング画面を読み込めませんでした。';
});
