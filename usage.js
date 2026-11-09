async function startUsageDashboard() {
  const el = id => document.getElementById(id);
  const status = el('usageStatus');
  const db = window.supabase.createClient(
    'https://aexmoblpehhcqptvagxh.supabase.co',
    'sb_publishable_USpY-tMqtrFiUCK_ISwqjw_F0z2r1ha',
  );
  const stages = {unconfirmed:'メール未確認',registered:'登録済み',created:'卓作成済み',first:'初回利用済み',returning:'再利用あり'};
  const stage = el('usageStage');
  for (const [key, name] of Object.entries(stages)) stage.add(new Option(name, key));
  const from = el('usageFrom');
  const to = el('usageTo');
  const today = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const start = new Date(today + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate()-29);
  from.value = start.toISOString().slice(0,10);
  to.value = today;
  function node(tag, text) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function cards(id, entries) {
    el(id).replaceChildren(...entries.map(([label,value]) => {
      const card = node('div');
      card.append(node('dt',label),node('dd',value ?? '—'));
      return card;
    }));
  }
  function table(id, columns, rows) {
    const target = el(id);
    if (!rows.length) {
      target.replaceChildren(node('p','該当する記録はありません。'));
      return;
    }
    const table = node('table');
    table.className = 'history-table';
    const header = table.createTHead().insertRow();
    for (const label of columns) {
      const th = node('th',label);
      th.scope = 'col';
      header.append(th);
    }
    const body = table.createTBody();
    for (const values of rows) {
      const row = body.insertRow();
      for (const value of values) {
        const cell = row.insertCell();
        if (value instanceof Node) cell.append(value);
        else cell.textContent = value ?? '—';
      }
    }
    target.replaceChildren(table);
  }
  const groupHeadings = ['卓名','初回対局日','最終対局日','終了セット','半荘数','利用段階'];
  const groupRows = groups => groups.map(group => [
    group.name,group.first_day,group.last_day,group.sets,group.rounds,
    stages[group.days>1?'returning':group.days?'first':'created'],
  ]);
  function renderUsers(report) {
    const users = report.users.filter(user => !stage.value || user.stage === stage.value);
    table('usageUsers',['ユーザー','登録日','メール確認','管理卓','終了セット','半荘数','最終対局日','利用段階'],users.map(user => {
      const link = node('button','詳細');
      link.type = 'button';
      link.className = 'secondary';
      const label = 'ユーザー ' + user.id.slice(0,8);
      link.setAttribute('aria-label',label+'の詳細');
      link.onclick = () => {
        el('userDetailTitle').textContent = label;
        el('userDetailEmail').textContent = user.email || 'メールアドレスなし';
        table('userDetailGroups',groupHeadings,groupRows(report.groups.filter(group => group.owner_id===user.id)));
        el('userDetail').showModal();
      };
      const identity = node('span',label+' ');
      identity.append(link);
      return [identity,user.registered,user.confirmed?'確認済み':'未確認',user.tables,user.sets,user.rounds,user.last_day,stages[user.stage]];
    }));
  }
  let request = 0;
  async function load() {
    const current = ++request;
    status.textContent = '利用状況を集計しています…';
    const {data,error} = await db.rpc('get_usage_dashboard',{date_from:from.value,date_to:to.value});
    if (current !== request) return;
    if (error) {
      if (error.code === '42501') el('usageDashboard').hidden = true;
      status.textContent = error.code === '42501' ? '運営者アカウントでログインしてください。'
        : error.code === 'PGRST202' ? '利用状況ダッシュボードのDB設定が必要です。'
        : error.code === '22023' ? '集計期間は開始日から366日以内で指定してください。' : '利用状況を取得できませんでした。';
      return;
    }
    const {totals,funnel,retention} = data;
    cards('usageKpis',[['累計登録ユーザー',totals.registered],['新規登録',totals.newUsers],
      ['利用ユーザー',totals.activeUsers],['稼働卓',totals.activeGroups],['終了セット',totals.sets],['半荘数',totals.rounds]]);
    cards('usageFunnel',[['登録',funnel.registered],['メール確認',funnel.confirmed],
      ['卓作成',funnel.created],['初回セット終了',funnel.finished],
      ['初回までの中央値',funnel.medianDays == null ? null : funnel.medianDays + '日']]);
    el('usageRetention').textContent = '30日以内の再利用　'+retention.eligible+'卓中'+retention.returned+'卓（観測中 '+retention.observing+'卓）';
    table('usageWeeks',['週の開始日','新規登録','稼働卓','終了セット'],data.weeks.map(w=>[w.week,w.registrations,w.tables,w.sets]));
    table('usageGroups',groupHeadings,groupRows(data.groups));
    stage.onchange = () => renderUsers(data);
    renderUsers(data);
    el('usageDashboard').hidden = false;
    status.textContent = '';
  }
  el('usageFilters').onsubmit = event => {
    event.preventDefault();
    if (to.value < from.value || (Date.parse(to.value)-Date.parse(from.value))/86400000 > 365) {
      status.textContent = '終了日を開始日から366日以内で指定してください。';
      return;
    }
    load().catch(showUsageError);
  };
  db.auth.onAuthStateChange((event) => {
    if (event !== 'SIGNED_OUT') return;
    ++request;
    el('usageDashboard').hidden = true;
    if (el('userDetail').open) el('userDetail').close();
    el('userDetailEmail').textContent = '';
    el('userDetailGroups').replaceChildren();
    for (const id of ['usageUsers','usageGroups','usageKpis','usageFunnel','usageWeeks','usageRetention']) el(id).replaceChildren();
    stage.onchange = null;
    status.textContent = '運営者アカウントでログインしてください。';
  });
  const {data:{user}} = await db.auth.getUser();
  if (!user) {
    status.textContent = '運営者アカウントでログインしてください。';
    return;
  }
  await load();
}
function showUsageError() {
  document.getElementById('usageStatus').textContent = '利用状況を取得できませんでした。';
}
startUsageDashboard().catch(showUsageError);
