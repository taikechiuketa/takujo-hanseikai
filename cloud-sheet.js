async function openCloudSheet(groupId, settingsOnly = false, readOnly = false) {
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
    async rankingShare(action, options) {
      const table = () => db.from('group_ranking_shares');
      if (action === 'enable') {
        const { error } = await table().insert({ group_id: groupId, options });
        if (error && error.code !== '23505') throw error;
      }
      if (action === 'save') {
        const { error } = await table().update({ options }).eq('group_id', groupId);
        if (error) throw error;
      }
      if (action === 'disable') {
        const { error } = await table().delete().eq('group_id', groupId);
        if (error) throw error;
      }
      const { data, error } = await table().select('token,options').eq('group_id', groupId).maybeSingle();
      if (error) throw error;
      return data;
    },
    async remove(name) {
      if (name !== savedName) throw new Error('現在の卓名を確認してください。');
      const { data, error } = await db.from('groups').delete()
        .eq('id', groupId).eq('owner_id', auth.user.id).eq('name', name).select('id').maybeSingle();
      if (error || !data) throw new Error('削除を確認できませんでした。グループ一覧を開き直して確認してください。');
    },
    async save(next) {
      const settings = { ...savedSettings, theme: next.theme, headerColor: next.headerColor, headerMode: next.headerMode, rules: next.rules };
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
  const sharing = new Map();
  const shareKey = set => set.archiveId || JSON.stringify([set.date, set.sequence]);
  for (let offset = 0; ; offset += 100) {
    const { data, error: loadError } = await db.from('game_sets')
      .select('id,played_on,sequence,details,rounds(position,mode,scores)')
      .eq('group_id', groupId).order('played_on').order('sequence').range(offset, offset + 99);
    if (loadError) throw new Error('対局履歴を読み込めませんでした。');
    let sharedIds;
    if (!readOnly && data.length) {
      const { data: shares, error: shareError } = await db.from('set_shares')
        .select('set_id').in('set_id', data.map(set => set.id));
      if (!shareError) sharedIds = new Set(shares.map(share => share.set_id));
    }
    for (const set of data) {
      const players = (set.details.players || []).map((player, i) =>
        typeof player === 'string' ? { id: String(i), name: player, chips: '' } : player);
      const archiveId = set.details.archiveId || set.id;
      if (sharedIds) sharing.set(archiveId, sharedIds.has(set.id));
      history.push({
        ...set.details, archiveId, players,
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
    ['current', JSON.stringify(readOnly ? null : group.sheet_draft)],
    ['history', JSON.stringify(history)],
    ['players', JSON.stringify(group.sheet_players)],
  ]);
  const knownSets = new Set(history.map(shareKey));
  const serverSnapshot = JSON.stringify([...storageData]);
  const recoveryKey = 'hansei-sheet-draft:' + auth.user.id + ':' + groupId;
  let recovery;
  try { if (!readOnly) recovery = JSON.parse(localStorage.getItem(recoveryKey)); } catch {}
  const sameBase = recovery && recovery.revision === group.sheet_revision;
  const alreadySaved = Boolean(recovery?.pending) && recovery.pending.payload.request_id === group.sheet_revision;
  const restore = sameBase || alreadySaved;
  const conflict = recovery && !restore;
  if (restore) {
    for (const [key, value] of recovery.entries) storageData.set(key, value);
  }
  let changed = () => {};
  const storage = {
    getItem: key => storageData.get(key) ?? null,
    setItem(key, value) { storageData.set(key, value); changed(); },
    removeItem(key) { storageData.delete(key); changed(); },
  };
  return {
    storage,
    isShared: set => sharing.get(shareKey(set)),
    async shareSet(set, revoke) {
      const { data, error } = await db.from('game_sets').select('id,details')
        .eq('group_id', groupId).eq('played_on', set.date.replaceAll('/', '-'))
        .eq('sequence', set.sequence).eq('status', 'finished').maybeSingle();
      if (error || !data || (set.archiveId && set.archiveId !== (data.details.archiveId || data.id))) {
        throw new Error('セットをDBに保存してから共有してください。');
      }
      const shares = db.from('set_shares');
      if (revoke) {
        const { error: deleteError } = await shares.delete().eq('set_id', data.id);
        if (deleteError) throw new Error('リンクを無効化できませんでした。');
        sharing.set(shareKey(set), false);
        return;
      }
      if (sharing.get(shareKey(set)) !== true) {
        // A copy action must never re-enable a link revoked in another session.
        const { error: insertError } = await shares.insert({ set_id: data.id });
        if (insertError && insertError.code !== '23505') throw new Error('共有リンクを作成できませんでした。DB設定を確認してください。');
      }
      const { data: share, error: readError } = await db.from('set_shares').select('token').eq('set_id', data.id).maybeSingle();
      if (readError) throw new Error('共有リンクを取得できませんでした。');
      if (!share) {
        sharing.set(shareKey(set), false);
        throw new Error('共有リンクは無効になっています。必要なら改めて発行してください。');
      }
      const url = new URL('./share.html', location.href);
      sharing.set(shareKey(set), true);
      url.hash = share.token;
      return url.href;
    },
    displayAppearance() { initTemplateGroups(appearance); },
    save: null,
    savePlayers: null,
    hasUnsavedPlayers: () => false,
    connect(keys) {
      initTemplateGroups(appearance);
      el('cloudControls').hidden = false;
      status.hidden = false;
      const snapshot = () => JSON.stringify([...storageData]);
      let lastSaved = restore ? (alreadySaved ? recovery.pending.snapshot : serverSnapshot) : snapshot();
      let revision = group.sheet_revision;
      this.hasUnsavedPlayers = () => Boolean(conflict) ||
        new Map(JSON.parse(lastSaved)).get(keys.master) !== storage.getItem(keys.master);
      let pending = sameBase ? recovery.pending : undefined;
      const indicator = el('setSaveIndicator');
      const showSetStatus = message => {
        if (!indicator) return;
        indicator.hidden = false;
        indicator.textContent = message;
      };
      showSetStatus(conflict ? '保存できません。画面上部を確認してください。'
        : pending ? '保存結果を確認できていません。' : snapshot() === lastSaved ? 'DB保存済み' : '未保存の変更があります。');
      const button = el('cloudSave');
      function keepDraft() {
        try {
          if (!pending && snapshot() === lastSaved) localStorage.removeItem(recoveryKey);
          else localStorage.setItem(recoveryKey, JSON.stringify({ revision, pending, entries: [...storageData] }));
          return true;
        } catch { return false; }
      }
      changed = () => {
        if (conflict) return;
        const retained = keepDraft();
        status.textContent = retained ? '未保存の変更があります。' : '未保存です。この端末に下書きを残せませんでした。';
        if (!button.disabled || !pending) {
          showSetStatus(pending ? '保存結果を確認できていません。'
            : snapshot() === lastSaved ? 'DB保存済み' : status.textContent);
        }
      };
      status.textContent = restore ? 'この端末の下書きを復元しました。' : '';
      button.hidden = !pending;
      if (conflict) {
        button.hidden = false;
        status.textContent = 'DBに新しい記録があります。この端末の下書きをダウンロードしてから編集を再開してください。';
        button.textContent = '下書きをダウンロード';
        button.onclick = () => {
          const values = Object.fromEntries(recovery.entries.map(([key, value]) => [key, JSON.parse(value)]));
          const backup = { format: 'takechao-backup', version: 1, savedAt: new Date().toISOString(), current: values.current, history: values.history, master: values.players };
          const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
          const link = document.createElement('a');
          link.href = url;
          link.download = 'hansei-unsaved-backup.json';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          if (confirm('下書きをダウンロードしました。端末の下書きをクリアしてDBの記録を開き直しますか？')) {
            localStorage.removeItem(recoveryKey);
            location.reload();
          }
        };
        this.save = () => {};
        this.savePlayers = async () => '別の画面で卓が更新されています。画面上部から下書きを退避してください。';
        return;
      }
      window.addEventListener('beforeunload', event => {
        if (pending || snapshot() !== lastSaved) {
          event.preventDefault();
          event.returnValue = '';
        }
      });

      this.savePlayers = async () => {
        if (button.disabled) return '別の保存が進行中です。完了後に再試行してください。';
        if (pending) return '対局の保存結果が未確認です。画面上部から再試行してください。';
        const players = storage.getItem(keys.master);
        if (!this.hasUnsavedPlayers()) return '';
        const nextRevision = crypto.randomUUID();
        button.disabled = true;
        try {
          let confirmed = false;
          try {
            const query = db.from('groups').update({
              sheet_players: JSON.parse(players), sheet_revision: nextRevision,
            }).eq('id', groupId);
            const { data, error } = await (revision === null
              ? query.is('sheet_revision', null)
              : query.eq('sheet_revision', revision)).select('id').maybeSingle();
            confirmed = !error && Boolean(data);
          } catch {
            // The update may have committed before the response was lost.
          }
          if (!confirmed) {
            const { data, error } = await db.from('groups')
              .select('sheet_revision,sheet_players').eq('id', groupId).maybeSingle();
            if (error || !data) throw new Error('Unable to verify the write');
            if (data.sheet_revision !== nextRevision) {
              if (data.sheet_revision !== revision) return '別の画面で卓が更新されました。対局画面を開き直して下書きを確認してください。';
              return 'プレイヤーマスターを保存できませんでした。再試行してください。';
            }
          }
          revision = nextRevision;
          const saved = new Map(JSON.parse(lastSaved ?? '[]'));
          saved.set(keys.master, players);
          lastSaved = JSON.stringify(saved);
          keepDraft();
          status.textContent = snapshot() === lastSaved ? 'プレイヤーマスターをDBに保存しました。' : 'プレイヤーマスターをDBに保存しました。対局には未保存の変更があります。';
          if (!pending) showSetStatus(snapshot() === lastSaved ? 'DB保存済み' : '未保存の変更があります。');
          return '';
        } catch {
          return 'DB保存を確認できませんでした。この端末に下書きを保持しています。';
        } finally { button.disabled = false; }
      };

      this.save = button.onclick = async () => {
        if (button.disabled) return;
        if (!pending) {
          const draft = JSON.parse(storage.getItem(keys.current));
          const sets = JSON.parse(storage.getItem(keys.history)) || [];
          if (!draft || sets.some(set => !set.date || !set.sequence)) {
            status.textContent = '保存する対局の日付・伝票番号を確認してください。';
            showSetStatus(status.textContent);
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
        keepDraft();
        button.disabled = true;
        button.hidden = true;
        status.textContent = '保存中…';
        showSetStatus(status.textContent);
        try {
          const { data, error: saveError } = await db.rpc('save_sheet_workspace', pending.payload);
          if (saveError) {
            if (saveError.code === '40001') {
              pending = undefined;
              keepDraft();
              status.textContent = '別の画面から更新されています。入力内容をJSONで退避し、再読み込みしてください。';
              showSetStatus(status.textContent);
              keys.notify(status.textContent);
              return;
            }
            if (saveError.code !== 'FETCH_ERROR' && saveError.code) pending = undefined;
            keepDraft();
            button.hidden = false;
            status.textContent = '保存できませんでした。入力を確認して再試行してください。';
            showSetStatus(status.textContent);
            keys.notify(status.textContent);
            return;
          }
          revision = data;
          for (const set of pending.payload.sets) {
            const key = shareKey(set);
            if (!knownSets.has(key) && set.archiveId && !sharing.has(key)) sharing.set(key, false);
            knownSets.add(key);
          }
          lastSaved = pending.snapshot;
          pending = undefined;
          keepDraft();
          button.hidden = snapshot() === lastSaved;
          status.textContent = button.hidden ? 'DBに保存しました。' : '先ほどの保存は完了しました。残りの変更を保存してください。';
          showSetStatus(button.hidden ? 'DB保存済み' : '未保存の変更があります。');
          keys.notify(status.textContent);
          keys.onSaved();
        } catch {
          button.hidden = false;
          status.textContent = '保存結果を確認できませんでした。再試行してください。';
          showSetStatus(status.textContent);
          keys.notify(status.textContent);
        } finally { button.disabled = false; }
      };
    },
  };
}
