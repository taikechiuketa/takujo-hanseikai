const el = id => document.getElementById(id);
const message = value => { el('status').textContent = value; };
const modes = { normal: '三麻', north: '四人三麻', yonma: '四人麻雀' };
const groupId = new URLSearchParams(location.search).get('group');

async function start() {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(groupId ?? '')) {
    message('グループ一覧から対局画面を開いてください。');
    return;
  }
  const db = window.supabase.createClient(
    'https://aexmoblpehhcqptvagxh.supabase.co',
    'sb_publishable_USpY-tMqtrFiUCK_ISwqjw_F0z2r1ha',
  );
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth.user) {
    message('グループ一覧からログインしてください。');
    return;
  }
  const { data: group, error } = await db.from('groups').select('name').eq('id', groupId).maybeSingle();
  if (error || !group) {
    message('このグループを開けませんでした。');
    return;
  }
  el('title').textContent = group.name;
  const form = el('gameForm');
  const playerInputs = Array.from({ length: 4 }, (_, index) => {
    const label = document.createElement('label');
    label.textContent = 'プレイヤー ' + (index + 1);
    const input = document.createElement('input');
    input.maxLength = 60;
    input.required = index < 3;
    label.append(input);
    el('players').append(label);
    return input;
  });
  const rounds = [];
  function addRound() {
    if (rounds.length >= 100) return;
    const row = document.createElement('fieldset');
    const title = document.createElement('legend');
    title.textContent = '半荘 ' + (rounds.length + 1);
    const mode = document.createElement('select');
    mode.setAttribute('aria-label', '対局種目');
    for (const [value, name] of Object.entries(modes)) mode.add(new Option(name, value));
    row.append(title, mode);
    const scores = playerInputs.map((_, index) => {
      const label = document.createElement('label');
      label.textContent = 'プレイヤー ' + (index + 1) + ' の点数';
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '1';
      label.append(input);
      row.append(label);
      return input;
    });
    rounds.push({ mode, scores });
    el('rounds').append(row);
  }
  function resetRounds() {
    rounds.length = 0;
    el('rounds').replaceChildren();
    addRound();
  }
  async function loadHistory() {
    const { data, error } = await db.from('game_sets')
      .select('played_on,sequence,details,rounds(position,mode,scores)')
      .eq('group_id', groupId).order('played_on', { ascending: false }).order('sequence', { ascending: false }).limit(30);
    if (error) throw error;
    const nodes = data.map(set => {
      const detail = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = set.played_on + ' · 伝票 ' + set.sequence;
      detail.append(summary);
      for (const round of set.rounds.sort((a, b) => a.position - b.position)) {
        const line = document.createElement('p');
        const players = Array.isArray(set.details.players) ? set.details.players : [];
        line.textContent = round.position + '半荘目 · ' + modes[round.mode] + ' · ' +
          players.map((name, index) => name + ' ' + (round.scores[index] ?? '抜け')).join(' / ');
        detail.append(line);
      }
      return detail;
    });
    el('history').replaceChildren(...(nodes.length ? nodes : ['まだ記録がありません。']));
  }

  form.elements.date.value = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  el('addRound').onclick = addRound;
  resetRounds();
  let requestId = crypto.randomUUID();
  let pendingPayload;
  form.onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    const names = playerInputs.map(input => input.value.trim());
    if (names.slice(0, 3).some(name => !name) || new Set(names.filter(Boolean)).size !== names.filter(Boolean).length) {
      message('プレイヤー名を3人以上、重複なしで入力してください。');
      return;
    }
    const games = rounds.map(({ mode, scores }) => ({
      mode: mode.value,
      scores: Object.fromEntries(scores.flatMap((input, index) => input.value === '' ? [] : [[index, Number(input.value)]])),
    }));
    if (games.some(game => {
      const scores = Object.entries(game.scores);
      return scores.length !== (game.mode === 'normal' ? 3 : 4) ||
        scores.some(([index, value]) => !names[index] || !Number.isSafeInteger(value)) ||
        scores.reduce((sum, [, value]) => sum + value, 0) !== 0;
    })) {
      message('各半荘の人数と点数を確認してください。合計は0点にしてください。');
      return;
    }
    const payload = { target_group: groupId, game_date: form.elements.date.value, player_names: names.filter(Boolean), game_rounds: games };
    const fingerprint = JSON.stringify(payload);
    if (pendingPayload && pendingPayload !== fingerprint) {
      message('前回の保存結果が未確認です。前回と同じ内容で再試行してください。');
      return;
    }
    pendingPayload = fingerprint;
    button.disabled = true;
    try {
      const { error } = await db.rpc('save_game_set', { ...payload, request_id: requestId });
      if (error) {
        if (error.code === 'PGRST202') {
          pendingPayload = undefined;
          message('対局保存用のDB設定がまだ反映されていません。');
          return;
        }
        throw error;
      }
      requestId = crypto.randomUUID();
      pendingPayload = undefined;
      resetRounds();
      message('セットを保存しました。');
      await loadHistory().catch(() => message('保存しました。履歴の表示に失敗したため、再読み込みしてください。'));
    } catch {
      message('保存結果を確認できませんでした。同じ内容で再試行してください。');
    } finally { button.disabled = false; }
  };
  el('entry').hidden = false;
  el('historySection').hidden = false;
  message('');
  await loadHistory().catch(() => message('履歴を読み込めませんでした。'));
}
start().catch(() => message('対局画面を開けませんでした。'));
