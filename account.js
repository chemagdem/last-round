import { authConfig } from './auth-config.js';

// Loading this module does not load the remote SDK unless configured.
export async function mountAccount({ readProfile, applyProfile, isPlaying }) {
  const dialog = document.getElementById('accountDialog');
  const form = document.getElementById('accountForm');
  const status = document.getElementById('accountStatus');
  const badge = document.getElementById('accountState');
  const email = document.getElementById('accountEmail');
  const password = document.getElementById('accountPassword');
  let client, userId = null, loaded = false, recovery = false, busy = false;
  let timer, queue = Promise.resolve();
  const say = message => { status.textContent = message; };
  const redirectTo = location.origin + location.pathname;
  document.getElementById('accountButton').onclick = () => dialog.showModal();
  document.getElementById('accountClose').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { password.value = ''; });
  const buttons = () => [...form.querySelectorAll('button')];
  const setBusy = value => { busy = value; buttons().forEach(b => { b.disabled = value; }); };
  const fields = profile => ({ name: String(profile.name || 'Player').slice(0,16), rating: profile.rating,
    wins: profile.wins, losses: profile.losses, matches: profile.matches, equippedSkin: profile.equippedSkin });

  // Never merge a guest's rating into an authenticated account implicitly.
  async function loadUser(session) {
    const id = session?.user?.id || null;
    if (id === userId && loaded) return;
    // Account changes in another tab must not keep the previous account's profile.
    if (userId && id !== userId) { location.reload(); return; }
    clearTimeout(timer);
    userId = id; loaded = false;
    if (!id) { badge.textContent = 'Guest · saved on this device'; return; }
    badge.textContent = 'Loading cloud profile…';
    const { data, error } = await client.from('player_profiles').select('*').eq('user_id', id).maybeSingle();
    if (error) throw error;
    let profile = data;
    if (!profile) {
      const result = await client.from('player_profiles').upsert({ user_id: id }, { onConflict: 'user_id', ignoreDuplicates: true });
      if (result.error) throw result.error;
      const fresh = await client.from('player_profiles').select('*').eq('user_id', id).single();
      if (fresh.error) throw fresh.error;
      profile = fresh.data;
    }
    if (userId !== id) return;
    applyProfile(fields(profile)); loaded = true;
    badge.textContent = 'Cloud profile · unverified statistics';
    say('Signed in. Cloud profile loaded.');
  }
  function save() {
    if (!client || !userId || !loaded) return;
    clearTimeout(timer);
    const id = userId, snapshot = fields(readProfile());
    badge.textContent = 'Saving…';
    timer = setTimeout(() => {
      queue = queue.then(async () => {
        if (id !== userId || !loaded) return;
        const { error } = await client.from('player_profiles').update(snapshot).eq('user_id', id);
        if (id === userId) badge.textContent = error ? 'Cloud save failed · retry via account' : 'Cloud saved · unverified statistics';
      }).catch(() => { badge.textContent = 'Cloud save failed · retry via account'; });
    }, 500);
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!client || busy) return;
    if (isPlaying()) { say('Return to the landing before changing accounts.'); return; }
    const action = event.submitter?.value || 'signin';
    setBusy(true);
    try {
      let result;
      if (action === 'signout') {
        clearTimeout(timer); await queue;
        if (userId && loaded) {
          const saved = await client.from('player_profiles').update(fields(readProfile())).eq('user_id', userId);
          if (saved.error) throw saved.error;
        }
        result = await client.auth.signOut({ scope: 'local' });
        if (!result.error) location.reload();
      } else if (action === 'retry') {
        if (!loaded) { const { data } = await client.auth.getSession(); await loadUser(data.session); }
        else save();
        return;
      } else if (action === 'reset') {
        result = await client.auth.resetPasswordForEmail(email.value.trim(), { redirectTo });
        say('If this account exists, a recovery email will arrive.');
      } else if (recovery) {
        result = await client.auth.updateUser({ password: password.value });
        if (!result.error) { recovery = false; say('Password updated.'); }
      } else if (action === 'signup') {
        result = await client.auth.signUp({ email: email.value.trim(), password: password.value, options: { emailRedirectTo: redirectTo } });
        say('Check your email to confirm registration.');
      } else {
        result = await client.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
        if (!result.error) await loadUser(result.data.session);
      }
      if (result?.error) throw result.error;
    } catch (error) { say(error.message || 'Account request failed. Try again.'); }
    finally { password.value = ''; setBusy(false); }
  });
  if (!authConfig.url || !authConfig.publishableKey) {
    say('Cloud accounts are not configured yet. Guest mode remains available.');
    setBusy(true);
    return { save, active: () => false };
  }
  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.102.0');
    client = createClient(authConfig.url, authConfig.publishableKey);
    client.auth.onAuthStateChange((event, session) => {
      // Run database operations outside the SDK's authentication callback lock.
      setTimeout(() => {
        if (event === 'PASSWORD_RECOVERY') {
          recovery = true; dialog.showModal(); say('Enter a new password and press SIGN IN.');
          email.required = false;
        }
        loadUser(session).catch(error => { say(error.message); badge.textContent = 'Cloud profile unavailable'; });
      }, 0);
    });
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    await loadUser(data.session);
  } catch (error) { say('Cloud connection unavailable: ' + error.message); }
  return { save, active: () => Boolean(userId) };
}
