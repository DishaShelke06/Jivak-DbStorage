(() => {
  const ACCOUNT_KEY = 'jivak-doctor-account-v1';
  const SESSION_KEY = 'jivak-doctor-session-v1';
  const escapeHtml = (value = '') => { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; };
  const hash = async value => {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  };
  const account = () => { try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY)); } catch { return null; } };
  const loggedIn = () => sessionStorage.getItem(SESSION_KEY) === 'true';

  function displayDoctor() {
    const user = account(); const name = document.querySelector('#doctorName');
    if (name && user) name.textContent = user.name;
  }
  function showGate() {
    document.documentElement.classList.add('auth-pending');
    document.querySelector('.auth-gate')?.remove();
    const isSetup = !account();
    const gate = document.createElement('section'); gate.className = 'auth-gate';
    gate.innerHTML = isSetup ? `
      <div class="auth-card"><img class="auth-logo" src="assets/jivak-logo.png" alt="Jivak Chikitsalay logo"><p class="eyebrow">Secure clinic workspace</p><h1>Set up doctor access</h1><p>Create the credentials that will protect this clinic workspace on this browser.</p><form class="auth-form" id="setupForm"><label class="field">Doctor's name <input id="setupName" required maxlength="80" autocomplete="name" placeholder="e.g. Dr. Priya Sharma"></label><label class="field">Create password <input id="setupPassword" required type="password" minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></label><label class="field">Confirm password <input id="confirmPassword" required type="password" minlength="8" autocomplete="new-password" placeholder="Repeat your password"></label><p class="auth-error" id="authError"></p><button class="primary" type="submit">Create secure access</button></form><p class="auth-footnote">Keep this password private. It cannot be recovered from this offline app.</p></div>` : `
      <div class="auth-card"><img class="auth-logo" src="assets/jivak-logo.png" alt="Jivak Chikitsalay logo"><p class="eyebrow">Secure clinic workspace</p><h1>Welcome back</h1><p>Sign in to access Jivak Chikitsalay patient records.</p><form class="auth-form" id="loginForm"><label class="field">Doctor <input value="${escapeHtml(account().name)}" disabled></label><label class="field">Password <input id="loginPassword" required type="password" autocomplete="current-password" placeholder="Enter your password"></label><p class="auth-error" id="authError"></p><button class="primary" type="submit">Sign in securely</button></form><p class="auth-footnote">This workspace locks again when you log out or close this browser tab.</p></div>`;
    document.body.append(gate);
    const error = message => { const el = document.querySelector('#authError'); el.textContent = message; el.classList.add('visible'); };
    document.querySelector('#setupForm')?.addEventListener('submit', async event => {
      event.preventDefault(); const name = document.querySelector('#setupName').value.trim(); const password = document.querySelector('#setupPassword').value; const confirmation = document.querySelector('#confirmPassword').value;
      if (password !== confirmation) return error('The passwords do not match.');
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ name, passwordHash: await hash(password) })); sessionStorage.setItem(SESSION_KEY, 'true'); unlock();
    });
    document.querySelector('#loginForm')?.addEventListener('submit', async event => {
      event.preventDefault(); const password = document.querySelector('#loginPassword').value; const user = account();
      if ((await hash(password)) !== user.passwordHash) return error('Incorrect password. Please try again.');
      sessionStorage.setItem(SESSION_KEY, 'true'); unlock();
    });
  }
  function unlock() { document.querySelector('.auth-gate')?.remove(); document.documentElement.classList.remove('auth-pending'); displayDoctor(); }
  function boot() {
    if (loggedIn()) unlock(); else showGate();
    document.querySelector('#logoutBtn')?.addEventListener('click', () => { sessionStorage.removeItem(SESSION_KEY); showGate(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
