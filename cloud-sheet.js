async function openCloudSheet(groupId, settingsOnly = false) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(groupId)) {
    throw new Error('グループ一覧から卓を開いてください。');
  }
  const db = window.supabase.createClient(
    'https://aexmoblpehhcqptvagxh.supabase.co',
    'sb_publishable_USpY-tMqtrFiUCK_ISwqjw_F0z2r1ha',
  );
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth.user) throw new Error('ログインしてから卓を開いてください。');
  const { data: group, error } = await db.from('groups')
    .select(settingsOnly ? 'name,settings' : 'name,settings,sheet_revision,sheet_draft,sheet_players').eq('id', groupId).maybeSingle();
  if (error?.code === '42703') throw new Error('対局画面を開くには、追加のDB設定が必要です。');
  if (error || !group) throw new Error('この卓を開けませんでした。');

  let savedName = group.name;
  let savedSettings = group.settings;
  const appearance = {
    id: 'cloud:' + auth.user.id + ':' + groupId,
    name: group.name,
    settings: group.settings,
    async save(next) {
      const settings = { ...savedSettings, theme: next.theme, headerColor: next.headerColor, rules: next.rules };
      const { data, error } = await db.from('groups').update({ name: next.name, settings })
        .eq('id', groupId).eq('name', savedName).eq('settings', JSON.stringify(savedSettings))
        .select('id').maybeSingle();
      if (error) throw new Error('卓の設定をDBに保存できませんでした。');
      if (!data) throw new Error('卓の設定が更新されています。再読み込みしてください。');
      savedName = next.name;
      savedSettings = settings;
    },
  };
  if (settingsOnly) return appearance;

  const history = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error: loadError } = await db.from('game_sets')
      .select('id,played_on,sequence,details,rounds(position,mode,scores)')
      .eq('group_id', groupId).order('played_on').order('sequence').range(offset, offset + 99);
    if (loadError) throw new Error('対局履歴を読み込めませんでした。');
    for (const set of data) {
      const players = (set.details.players || []).map((player, i) =>
        typeof player === 'string' ? { id: String(i), name: player, chips: '' } : player);
      history.push({
        ...set.details, archiveId: set.details.archiveId || set.id, players,
        date: set.played_on.replaceAll('-', '/'), sequence: set.sequence,
        rounds: set.rounds.sort((a, b) => a.position - b.position).map(round => ({
          id: String(round.position), mode: round.mode, scores: round.scores,
        })),
      });
    }
    if (data.length < 100) break;
  }
  const { data: latest, error: revisionError } = await db.from('groups')
    .select('sheet_revision').eq('id', groupId).single();
  if (revisionError || latest.sheet_revision !== group.sheet_revision) {
    throw new Error('読み込み中に卓が更新されました。再読み込みしてください。');
  }
  const el = id => document.getElementById(id);
  const status = el('cloudStatus');
  const storageData = new Map([
    ['current', JSON.stringify(group.sheet_draft)],
    ['history', JSON.stringify(history)],
    ['players', JSON.stringify(group.sheet_players)],
  ]);
  const storage = {
    getItem: key => storageData.get(key) ?? null,
    setItem: (key, value) => storageData.set(key, value),
    removeItem: key => storageData.delete(key),
  };
  return {
    storage,
    connect(keys) {
      initTemplateGroups(appearance);
      el('cloudControls').hidden = false;
      status.hidden = false;
      status.textContent = '対局の変更は「この卓をDBに保存」で確定します。';

      const snapshot = () => JSON.stringify([...storageData]);
      let lastSaved = snapshot();
      let revision = group.sheet_revision;
      let pending;
      window.addEventListener('beforeunload', event => {
        if (pending || snapshot() !== lastSaved) {
          event.preventDefault();
          event.returnValue = '';
        }
      });

      const button = el('cloudSave');
      button.onclick = async () => {
        if (!pending) {
          const draft = JSON.parse(storage.getItem(keys.current));
          const sets = JSON.parse(storage.getItem(keys.history));
          if (!draft || sets.some(set => !set.date || !set.sequence)) {
            status.textContent = '保存する対局の日付・伝票番号を確認してください。';
            return;
          }
          pending = {
            snapshot: snapshot(),
            payload: {
              target_group: groupId, expected_revision: revision, request_id: crypto.randomUUID(),
              draft, players: JSON.parse(storage.getItem(keys.master)), sets,
            },
          };
        }
        button.disabled = true;
        status.textContent = '保存中…';
        try {
          const { data, error: saveError } = await db.rpc('save_sheet_workspace', pending.payload);
          if (saveError) {
            if (saveError.code === '40001') {
              pending = undefined;
              status.textContent = '別の画面から更新されています。入力内容をJSONで退避し、再読み込みしてください。';
              return;
            }
            if (saveError.code !== 'FETCH_ERROR' && saveError.code) pending = undefined;
            status.textContent = '保存できませんでした。入力を確認して再試行してください。';
            return;
          }
          revision = data;
          lastSaved = pending.snapshot;
          pending = undefined;
          status.textContent = snapshot() === lastSaved ? 'DBに保存しました。' : 'DBに保存しました。追加の変更はもう一度保存してください。';
        } catch {
          status.textContent = '保存結果を確認できませんでした。再試行してください。';
        } finally { button.disabled = false; }
      };
    },
  };
}
