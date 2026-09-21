(function () {
  'use strict';

  const FALLBACK_API_BASE = 'http://localhost:3000';
  const AUTH_POLL_MS = window.ADVENTURE_AUTH_POLL_MS || 60000;
  const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f43f5e'];

  let apiBase;
  let currentUser = null;
  let loggedIn = false;

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
    const send = (base) => fetch(base + path, {
      credentials: 'include',
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) },
    });
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
      const res = await api('/api/auth/me');
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      return data.user ?? null;
    } catch {
      return null;
    }
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch { /* ignore network errors, still reset the UI */ }
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
    const res = await api('/api/auth/users');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to load users (HTTP ' + res.status + ')');
    return data.users || [];
  }

  async function createUser(payload) {
    const res = await api('/api/auth/users', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to create user (HTTP ' + res.status + ')');
    return data.user;
  }

  async function updateUser(id, payload) {
    const res = await api('/api/auth/users/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to update user (HTTP ' + res.status + ')');
    return data.user;
  }

  async function deleteUser(id) {
    const res = await api('/api/auth/users/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to delete user (HTTP ' + res.status + ')');
    }
  }

  async function listRoles() {
    const res = await api('/api/auth/roles');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to load roles (HTTP ' + res.status + ')');
    return data.roles || [];
  }

  async function createRole(payload) {
    const res = await api('/api/auth/roles', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to create role (HTTP ' + res.status + ')');
    return data.role;
  }

  async function updateRole(id, payload) {
    const res = await api('/api/auth/roles/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to update role (HTTP ' + res.status + ')');
    return data.role;
  }

  async function deleteRole(id) {
    const res = await api('/api/auth/roles/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to delete role (HTTP ' + res.status + ')');
    }
  }

  async function setUserRoles(id, roles) {
    const res = await api('/api/auth/users/' + encodeURIComponent(id) + '/roles', { method: 'PUT', body: JSON.stringify({ roles }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to assign roles (HTTP ' + res.status + ')');
    return data.user;
  }

  function isAdmin(user) {
    return !!user && Array.isArray(user.roles) && user.roles.includes('admin');
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