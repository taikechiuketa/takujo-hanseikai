const el = id => document.getElementById(id);
const message = value => { el('status').textContent = value; };
async function start() {
  const { createClient } = window.supabase;
  const db = createClient(
    'https://aexmoblpehhcqptvagxh.supabase.co',
    'sb_publishable_USpY-tMqtrFiUCK_ISwqjw_F0z2r1ha',
  );
  const auth = el('auth');
  const form = el('groupForm');
  let selected = null;
  let userId;
  let refreshVersion = 0;

  function resetGroup() {
    selected = null;
    form.reset();
    el('groupRulesField').hidden = true;
    el('groupHeading').textContent = '新しいグループ';
  }

  async function showSession(session) {
    const version = ++refreshVersion;
    const nextUser = session?.user.id;
    if (userId !== nextUser) resetGroup();
    userId = nextUser;
    el('groupList').replaceChildren();
    el('login').hidden = !!userId;
    el('groups').hidden = !userId;
    if (!userId) return;

    const { data, error } = await db.from('groups').select('id,name,settings').order('created_at');
    if (version !== refreshVersion) return;
    if (error) throw error;
    if (!data.length) el('groupList').append(Object.assign(document.createElement('li'), { textContent: 'グループはまだありません。' }));
    for (const group of data) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.textContent = group.name;
      button.onclick = () => {
        selected = group;
        el('groupHeading').textContent = 'グループ設定を編集';
        form.elements.name.value = group.name;
        el('groupRulesField').hidden = false;
        form.elements.rules.value = group.settings.rules ?? '';
      };
      const play = document.createElement('a');
      play.textContent = '対局を入力';
      play.href = './game.html?' + new URLSearchParams({ group: group.id });
      button.textContent = group.name + 'の設定';
      item.append(button, ' ', play);
      el('groupList').append(item);
    }
  }

  function report(error) {
    message(error.code === 'PGRST205' ? '専用DBの初期設定が必要です。' : '操作に失敗しました。入力内容や接続を確認してください。');
  }

  auth.onsubmit = async event => {
    event.preventDefault();
    const signup = event.submitter?.value === 'signup';
    const buttons = [...auth.querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    try {
      const credentials = { email: auth.elements.email.value.trim(), password: auth.elements.password.value };
      const { data, error } = signup
        ? await db.auth.signUp({ ...credentials, options: { emailRedirectTo: new URL('account.html', location.href).href } })
        : await db.auth.signInWithPassword(credentials);
      if (error) throw error;
      auth.reset();
      message(data.session ? '' : '確認メールを開き、アカウントを有効にしてください。');
    } catch (error) { report(error); }
    finally { buttons.forEach(button => { button.disabled = false; }); }
  };

  el('newGroup').onclick = resetGroup;
  el('signout').onclick = async () => {
    const { error } = await db.auth.signOut({ scope: 'local' });
    if (error) report(error);
    else message('ログアウトしました。');
  };
  el('reload').onclick = async () => {
    const { data, error } = await db.auth.getSession();
    if (error) report(error);
    else { message(''); await showSession(data.session).catch(report); }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const name = form.elements.name.value.trim();
    if (!name || !userId) return;
    const button = event.submitter;
    button.disabled = true;
    try {
      const query = selected
        ? db.from('groups').update({ name, settings: { ...selected.settings, rules: form.elements.rules.value } }).eq('id', selected.id)
        : db.from('groups').insert({ name });
      const { error } = await query.select('id').single();
      if (error) throw error;
      resetGroup();
      message('グループを保存しました。');
      await el('reload').onclick();
    } catch (error) { report(error); }
    finally { button.disabled = false; }
  };

  db.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED') return;
    setTimeout(() => { showSession(session).catch(report); }, 0);
  });
}

start().catch(error => {
  console.error('Account initialization failed', error);
  message('ログイン画面を初期化できませんでした。ページを再読み込みしてください。');
});
