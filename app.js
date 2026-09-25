(function () {
  'use strict';

  const FALLBACK_API_BASE = 'http://localhost:3000';
  const APPLICATION_ID = 'mainsite';
  const OIDC_CLIENT_ID = 'mainsite';
  const OIDC_ISSUER = '/iam';
  const OIDC_REDIRECT_URI = new URL('login.html', window.location.href).href;
  const OIDC_TOKEN_KEY = 'adventure.mainsite.oidc.tokens';
  const OIDC_TRANSACTION_KEY = 'adventure.mainsite.oidc.transaction';
  const AUTH_POLL_MS = window.ADVENTURE_AUTH_POLL_MS || 60000;
  const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f43f5e'];

  let apiBase;
  let currentUser = null;
  let loggedIn = false;

  /* ---------- OIDC / PKCE ---------- */

  function base64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function randomString(size = 32) {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return base64Url(bytes);
  }

  async function pkceChallenge(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64Url(new Uint8Array(digest));
  }

  function readOidcTokens() {
    try {
      const value = sessionStorage.getItem(OIDC_TOKEN_KEY);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function saveOidcTokens(tokens) {
    const value = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      token_type: tokens.token_type || 'Bearer',
      scope: tokens.scope || '',
      id_token: tokens.id_token || null,
      expires_at: Date.now() + Number(tokens.expires_in || 3600) * 1000,
    };
    sessionStorage.setItem(OIDC_TOKEN_KEY, JSON.stringify(value));
    return value;
  }

  function clearOidcTokens() {
    try {
      sessionStorage.removeItem(OIDC_TOKEN_KEY);
      sessionStorage.removeItem(OIDC_TRANSACTION_KEY);
    } catch { /* storage may be disabled */ }
  }

  function safeReturnTo(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return 'index.html';
    return value;
  }

  async function beginLogin(returnTo = `${location.pathname}${location.search}${location.hash}`) {
    const verifier = randomString(48);
    const state = randomString(24);
    const nonce = randomString(24);
    sessionStorage.setItem(OIDC_TRANSACTION_KEY, JSON.stringify({ verifier, state, nonce, returnTo: safeReturnTo(returnTo) }));
    const params = new URLSearchParams({
      client_id: OIDC_CLIENT_ID,
      redirect_uri: OIDC_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid profile email mainsite:profile:read mainsite:profile:update mainsite:users:manage mainsite:roles:manage',
      state,
      nonce,
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: 'S256',
    });
    location.assign(`${OIDC_ISSUER}/oauth/authorize?${params.toString()}`);
  }

  async function completeLogin() {
    const query = new URLSearchParams(location.search);
    if (query.get('error')) throw new Error(query.get('error_description') || query.get('error'));
    const code = query.get('code');
    if (!code) return null;
    let transaction;
    try { transaction = JSON.parse(sessionStorage.getItem(OIDC_TRANSACTION_KEY) || 'null'); } catch { transaction = null; }
    if (!transaction || !transaction.state || transaction.state !== query.get('state')) {
      throw new Error('The sign-in request could not be verified. Please try again.');
    }
    const response = await fetch(`${OIDC_ISSUER}/oauth/token`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: OIDC_CLIENT_ID,
        code,
        redirect_uri: OIDC_REDIRECT_URI,
        code_verifier: transaction.verifier,
      }),
    });
    const tokens = await response.json().catch(() => ({}));
    if (!response.ok || !tokens.access_token) throw new Error(tokens.error_description || tokens.error || 'IAM sign-in failed');
    saveOidcTokens(tokens);
    sessionStorage.removeItem(OIDC_TRANSACTION_KEY);
    return safeReturnTo(transaction.returnTo);
  }

  async function refreshOidcToken(tokens = readOidcTokens()) {
    if (!tokens?.refresh_token) return null;
    const response = await fetch(`${OIDC_ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: OIDC_CLIENT_ID, refresh_token: tokens.refresh_token }),
    });
    const next = await response.json().catch(() => ({}));
    if (!response.ok || !next.access_token) {
      clearOidcTokens();
      return null;
    }
    return saveOidcTokens(next);
  }

  function userFromUserinfo(data) {
    const roles = Array.isArray(data.roles) ? data.roles : [];
    return {
      id: data.sub,
      username: data.username || data.name || data.sub,
      display_name: data.name || data.username || data.sub,
      email: data.email || null,
      status: 'active',
      roles,
      grants: { [APPLICATION_ID]: roles },
      permissions: Array.isArray(data.permissions) ? data.permissions : [],
    };
  }

  /* ---------- helpers ---------- */

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    const first = (parts[0] || '?').charAt(0);
    const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (first + last).toUpperCase() || '?';
  }

  function makeAvatar(name) {
    const color = PALETTE[hashStr(name) % PALETTE.length];
    const i = initials(name);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">' +
      '<rect width="96" height="96" fill="' + color + '"/>' +
      '<text x="48" y="48" dy=".35em" font-family="sans-serif" font-size="38" ' +
      'font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="middle">' + i + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), 4000);
  }

  /* ---------- api ---------- */

  async function api(path, options = {}) {
    const send = (base, retry = true) => {
      const tokens = readOidcTokens();
      const headers = {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers ?? {}),
        ...(tokens?.access_token ? { Authorization: `Bearer ${tokens.access_token}` } : {}),
      };
      return fetch(base + path, { credentials: 'include', ...options, headers }).then(async (res) => {
        if (res.status === 401 && retry && tokens?.refresh_token) {
          const refreshed = await refreshOidcToken(tokens);
          if (refreshed) return send(base, false);
        }
        return res;
      });
    };
    if (apiBase !== undefined) return send(apiBase);
    try {
      const res = await send('');
      const ct = res.headers.get('content-type') ?? '';
      if (res.ok || ct.includes('application/json')) {
        apiBase = '';
        return res;
      }
      apiBase = FALLBACK_API_BASE;
      return send(apiBase);
    } catch {
      apiBase = FALLBACK_API_BASE;
      return send(apiBase);
    }
  }

  async function fetchMe() {
    try {
      let tokens = readOidcTokens();
      if (tokens?.access_token && tokens.expires_at <= Date.now() + 30_000) {
        tokens = await refreshOidcToken(tokens);
      }
      if (tokens?.access_token) {
        const res = await fetch(`${OIDC_ISSUER}/oauth/userinfo`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (res.ok) return userFromUserinfo(await res.json());
      }

      // Compatibility fallback while existing IAM sessions are being migrated.
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      return data.user ?? null;
    } catch {
      return null;
    }
  }

  async function logout() {
    const tokens = readOidcTokens();
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch { /* ignore network errors, still reset the UI */ }
    for (const token of [tokens?.access_token, tokens?.refresh_token].filter(Boolean)) {
      try {
        await fetch(`${OIDC_ISSUER}/oauth/revoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: OIDC_CLIENT_ID, token }),
        });
      } catch { /* token cleanup is best effort */ }
    }
    clearOidcTokens();
  }

  /* ---------- api helpers ---------- */

  async function changePassword(currentPassword, newPassword) {
    const res = await api('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to change password (HTTP ' + res.status + ')');
    return data;
  }

  async function listUsers() {
    const res = await api('/api/auth/users?client_id=' + encodeURIComponent(APPLICATION_ID));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to load users (HTTP ' + res.status + ')');
    return data.users || [];
  }

  async function createUser(payload) {
    const res = await api('/api/auth/clients/' + APPLICATION_ID + '/users', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to create user (HTTP ' + res.status + ')');
    return data.user;
  }

  async function updateUser(id, payload) {
    const res = await api('/api/auth/clients/' + APPLICATION_ID + '/users/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to update user (HTTP ' + res.status + ')');
    return data.user;
  }

  async function deleteUser(id) {
    const res = await api('/api/auth/clients/' + APPLICATION_ID + '/users/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to delete user (HTTP ' + res.status + ')');
    }
  }

  async function listRoles() {
    const res = await api('/api/auth/clients/' + APPLICATION_ID + '/roles');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to load roles (HTTP ' + res.status + ')');
    return data.roles || [];
  }

  async function createRole(payload) {
    const res = await api('/api/auth/clients/' + APPLICATION_ID + '/roles', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to create role (HTTP ' + res.status + ')');
    return data.role;
  }

  async function updateRole(id, payload) {
    const res = await api('/api/auth/clients/' + APPLICATION_ID + '/roles/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to update role (HTTP ' + res.status + ')');
    return data.role;
  }

  async function deleteRole(id) {
    const res = await api('/api/auth/clients/' + APPLICATION_ID + '/roles/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to delete role (HTTP ' + res.status + ')');
    }
  }

  async function setUserRoles(id, roles) {
    const res = await api('/api/auth/clients/' + APPLICATION_ID + '/users/' + encodeURIComponent(id) + '/roles', { method: 'PUT', body: JSON.stringify({ roles }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to assign roles (HTTP ' + res.status + ')');
    return data.user;
  }

  function isAdmin(user) {
    return !!user && Array.isArray(user.grants?.[APPLICATION_ID]) && user.grants[APPLICATION_ID].includes('admin');
  }

  /* ---------- nav state ---------- */

  function closeDropdown() {
    const d = document.getElementById('userDropdown');
    if (d) d.style.display = 'none';
  }

  function showUserNav(user) {
    const navAvatar = document.getElementById('navAvatar');
    const navUsername = document.getElementById('navUsername');
    const signIn = document.getElementById('navSignIn');
    const menu = document.getElementById('userMenuBtn');
    if (navAvatar) navAvatar.src = makeAvatar(user.display_name || user.username);
    if (navUsername) navUsername.textContent = user.username;
    if (signIn) signIn.style.display = 'none';
    if (menu) menu.style.display = '';
    closeDropdown();
  }

  function hideUserNav() {
    const signIn = document.getElementById('navSignIn');
    const menu = document.getElementById('userMenuBtn');
    if (signIn) signIn.style.display = '';
    if (menu) menu.style.display = 'none';
    closeDropdown();
  }

  function setUser(user) {
    currentUser = user;
    loggedIn = !!user;
    if (user) showUserNav(user); else hideUserNav();
  }

  /* ---------- auth flow ---------- */

  function runHook(name) {
    const hook = window.Adventure && window.Adventure[name];
    if (typeof hook === 'function') return hook(currentUser);
    return undefined;
  }

  async function refreshAuth() {
    const user = await fetchMe();
    setUser(user);
    runHook('onAuth');
    return user;
  }

  async function checkSession() {
    const user = await fetchMe();
    if (user) {
      if (!loggedIn) setUser(user);
      return;
    }
    if (loggedIn) {
      await logout();
      setUser(null);
      showToast('Your session has expired. Please sign in again.');
      const fired = runHook('onSessionExpired');
      if (!fired) runHook('onLogout');
    }
  }

  /* ---------- background ---------- */

  function randomBg() {
    const img = document.getElementById('bgImage');
    if (!img) return;
    img.src = 'https://picsum.photos/1920/1080?r=' + Math.random().toString(36).slice(2) + new Date().getTime();
    img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
  }

  /* ---------- boot ---------- */

  document.addEventListener('DOMContentLoaded', () => {
    randomBg();

    const signInBtn = document.getElementById('navSignIn');
    if (signInBtn && signInBtn.tagName === 'BUTTON') {
      signInBtn.addEventListener('click', (e) => {
        e.preventDefault();
        runHook('onSignIn');
      });
    }

    const menuBtn = document.getElementById('userMenuBtn');
    const dropdown = document.getElementById('userDropdown');
    if (menuBtn && dropdown) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'none' ? '' : 'none';
      });
      document.addEventListener('click', closeDropdown);
    }

    const navToggle = document.getElementById('navToggle');
    const mobileNav = document.getElementById('mobileNav');
    if (navToggle && mobileNav) {
      const closeMobileNav = () => {
        mobileNav.classList.remove('open');
        navToggle.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      };
      navToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !mobileNav.classList.contains('open');
        mobileNav.classList.toggle('open', open);
        navToggle.classList.toggle('open', open);
        navToggle.setAttribute('aria-expanded', String(open));
      });
      document.addEventListener('click', (e) => {
        if (!mobileNav.contains(e.target) && !navToggle.contains(e.target)) closeMobileNav();
      });
      mobileNav.addEventListener('click', closeMobileNav);
    }

    const ddProfile = document.getElementById('ddProfile');
    if (ddProfile) {
      ddProfile.addEventListener('click', (e) => {
        e.preventDefault();
        closeDropdown();
        const fired = runHook('onProfile');
        if (!fired) location.href = 'profile.html';
      });
    }

    const ddSignOut = document.getElementById('ddSignOut');
    if (ddSignOut) {
      ddSignOut.addEventListener('click', async (e) => {
        e.preventDefault();
        closeDropdown();
        await logout();
        setUser(null);
        const fired = runHook('onLogout');
        if (!fired) location.href = 'index.html';
      });
    }

    setInterval(checkSession, AUTH_POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkSession();
    });

    refreshAuth();
  });

  window.Adventure = {
    api,
    fetchMe,
    beginLogin,
    completeLogin,
    refreshOidcToken,
    logout,
    makeAvatar,
    setUser,
    refreshAuth,
    checkSession,
    changePassword,
    listUsers,
    createUser,
    updateUser,
    deleteUser,
    listRoles,
    createRole,
    updateRole,
    deleteRole,
    setUserRoles,
    isAdmin,
    get user() { return currentUser; },
    get isLoggedIn() { return !!currentUser; },
  };
})();
