(() => {
  const ACCOUNT_KEY = 'jivak-doctor-account-v1';
  const SESSION_KEY = 'jivak-doctor-session-v1';

  const account = () => {
    try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY)); } catch { return null; }
  };

  const loggedIn = () => sessionStorage.getItem(SESSION_KEY) === 'true' && Boolean(localStorage.getItem('jivak-api-token'));

  function displayDoctor() {
    const user = account();
    const nameEl = document.querySelector('#doctorName');
    if (nameEl && user?.name) nameEl.textContent = user.name;
  }

  function showGate() {
    document.documentElement.classList.add('auth-pending');
    document.querySelector('.auth-gate')?.remove();

    const gate = document.createElement('section');
    gate.className = 'auth-gate';
    gate.innerHTML = `
      <div class="auth-card">
        <img class="auth-logo" src="assets/jivak-logo.png" alt="Jivak Chikitsalay logo">
        <p class="eyebrow">Secure clinic workspace</p>
        <h1>Welcome back</h1>
        <p>Sign in to access Jivak Chikitsalay patient records.</p>
        <form class="auth-form" id="loginForm">
          <label class="field">Doctor
            <input id="loginUsername" value="doctor" placeholder="Username" required autocomplete="username">
          </label>
          <label class="field">Password
            <input id="loginPassword" required type="password" autocomplete="current-password" placeholder="Enter your password">
          </label>
          <p class="auth-error" id="authError"></p>
          <button class="primary" type="submit">Sign in securely</button>
        </form>
        <p class="auth-footnote">This workspace locks again when you log out or close this browser tab.</p>
      </div>`;
    document.body.append(gate);

    const error = message => {
      const el = document.querySelector('#authError');
      if (el) {
        el.textContent = message;
        el.classList.add('visible');
      }
    };

    document.querySelector('#loginForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const username = document.querySelector('#loginUsername')?.value.trim() || 'doctor';
      const password = document.querySelector('#loginPassword').value;

      try {
        const res = await API.login(username, password);
        if (res.token) {
          API.setToken(res.token);
          sessionStorage.setItem(SESSION_KEY, 'true');

          const userObj = { name: res.name || 'Disha Shelke' };
          localStorage.setItem(ACCOUNT_KEY, JSON.stringify(userObj));

          unlock();
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } else {
          error(res.error || 'Incorrect credentials.');
        }
      } catch (err) {
        error(err.message || 'Could not connect to server.');
      }
    });
  }

  function unlock() {
    document.querySelector('.auth-gate')?.remove();
    document.documentElement.classList.remove('auth-pending');
    displayDoctor();
  }

  function boot() {
    if (loggedIn()) {
      unlock();
    } else {
      showGate();
    }

    document.querySelector('#logoutBtn')?.addEventListener('click', () => {
      API.clearToken();
      sessionStorage.removeItem(SESSION_KEY);
      showGate();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();