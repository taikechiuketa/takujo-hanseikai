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
  let userId;
  let refreshVersion = 0;

  function resetGroup() {
    form.reset();
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

    const { data, error } = await db.from('groups').select('id,name').order('created_at');
    if (version !== refreshVersion) return;
    if (error) throw error;
    if (!data.length) el('groupList').append(Object.assign(document.createElement('li'), { textContent: 'グループはまだありません。' }));
    for (const group of data) {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = group.name;
      const play = document.createElement('a');
      play.textContent = '対局を入力';
      play.href = './index.html?' + new URLSearchParams({ group: group.id });
      const settings = document.createElement('a');
      settings.textContent = '卓の設定';
      settings.href = './settings.html?' + new URLSearchParams({ group: group.id });
      item.append(name, ' ', play, ' / ', settings);
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
      const { error } = await db.from('groups').insert({ name }).select('id').single();
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
