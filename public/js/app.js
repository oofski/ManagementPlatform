// App shell: session, role-based navigation, client-side router, notifications, offline banner.
import { api, flushQueue, queueLength, onQueueChange } from './api.js';
import { html, set, $, on, toast, errToast, modal, ago, ROLE, esc } from './ui.js';

const ICONS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  check: 'M4 12l5 5L20 6',
  clipboard: 'M8 4h8v3H8zM6 6H5v15h14V6h-1M9 12h6M9 16h4',
  book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 5v16',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M17 11a3 3 0 100-6M22 21v-1a5 5 0 00-4-4.9',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  dumbbell: 'M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12',
  chat: 'M4 5h16v11H8l-4 4z',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  tasks: 'M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 005 12a7 7 0 00.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
};
const icon = (k) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[k]}"/></svg>`;

const ROUTES = [
  ['/', 'home', 'Home'],
  ['/calendar', 'calendar', 'Calendar'], ['/calendar/:id', 'calendar', 'Event'],
  ['/attendance', 'attendance', 'Attendance'], ['/attendance/reports', 'attendance', 'Attendance reports'], ['/attendance/:id', 'attendance', 'Attendance'],
  ['/practice', 'practice', 'Practice plans'], ['/practice/drills', 'practice', 'Drill library'], ['/practice/:id', 'practice', 'Practice plan'], ['/practice/:id/run', 'practice', 'Run practice'], ['/practice/:id/summary', 'practice', 'Practice summary'],
  ['/playbook', 'playbook', 'Playbook'], ['/playbook/installs', 'playbook', 'Install sheets'], ['/playbook/install/:id', 'playbook', 'Install sheet'], ['/playbook/play/:id', 'playbook', 'Play'], ['/playbook/play/:id/edit', 'playbook', 'Play designer'], ['/playbook/game', 'playbook', 'Game mode'], ['/playbook/shares', 'playbook', 'Delivery'],
  ['/players', 'players', 'Roster'], ['/players/:id', 'players', 'Player'], ['/teams', 'players', 'Teams and groups'], ['/depth', 'depth', 'Depth charts'], ['/depth/:id', 'depth', 'Depth chart'],
  ['/weights', 'weights', 'Weight room'], ['/weights/workout/:a/:w/:d', 'weights', 'Workout'], ['/weights/program/:id', 'weights', 'Lifting program'],
  ['/messages', 'messages', 'Messages'], ['/messages/chat/:id', 'messages', 'Chat'], ['/messages/announcements', 'messages', 'Announcements'], ['/messages/announcements/:id', 'messages', 'Announcement'], ['/messages/moderation', 'messages', 'Moderation'],
  ['/equipment', 'equipment', 'Equipment'],
  ['/assignments', 'assignments', 'Assignments'], ['/assignments/:id', 'assignments', 'Assignment'],
  ['/development', 'development', 'Development'], ['/development/player/:id', 'development', 'Player development'], ['/season', 'development', 'Season plan'], ['/reports/player/:id', 'development', 'Season report'], ['/reports/team', 'development', 'Team report'],
  ['/settings', 'settings', 'Program settings'], ['/settings/staff', 'settings', 'Staff and roles'], ['/settings/audit', 'settings', 'Audit log'], ['/settings/outbox', 'settings', 'Email outbox'], ['/account', 'settings', 'My account'],
  ['/checkin', 'checkin', 'Check in'],
];
const compiled = ROUTES.map(([p, mod, title]) => {
  const keys = [];
  const re = new RegExp('^' + p.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { p, mod, title, re, keys };
});

const state = { me: null, page: null, pollTimer: null };

function nav(me) {
  const c = me.caps; const role = me.user.role; const staff = c.staff;
  const items = [];
  const add = (href, label, ic, n) => items.push({ href, label, ic, n });
  add('/', 'Home', 'home');
  add('/calendar', 'Calendar', 'calendar');
  if (staff) {
    add('/attendance', 'Attendance', 'check');
    add('/practice', 'Practice', 'clipboard');
    if (c['playbook.view']) add('/playbook', 'Playbook', 'book');
    items.push({ sec: 'Roster' });
    add('/players', 'Players', 'users');
    add('/depth', 'Depth charts', 'layers');
    add('/weights', 'Weight room', 'dumbbell');
    add('/assignments', 'Assignments', 'tasks');
    if (c['season.view']) add('/development', 'Development', 'chart');
    items.push({ sec: 'Program' });
    add('/messages', 'Messages', 'chat');
    if (c['equipment.view']) add('/equipment', 'Equipment', 'box');
    add(c.admin ? '/settings' : '/account', c.admin ? 'Settings' : 'My account', 'gear');
  } else {
    if (role === 'player') {
      add('/assignments', 'Assignments', 'tasks');
      add('/playbook', 'My plays', 'book');
      add('/weights', 'Weight room', 'dumbbell');
      add('/checkin', 'Check in', 'qr');
    }
    add('/development', role === 'parent' ? 'Player progress' : 'My progress', 'chart');
    add('/depth', 'Depth chart', 'layers');
    add('/messages', 'Messages', 'chat');
    add('/equipment', role === 'parent' ? 'Equipment' : 'My gear', 'box');
    if (role === 'parent') add('/weights', 'Nutrition', 'dumbbell');
    add('/account', 'My account', 'user');
  }
  return items;
}

function shell() {
  const me = state.me;
  const app = $('#app');
  set(app, html`<div class="shell">
    <aside class="side" id="side">
      <div class="brand"><div class="mark">${(me.program.name || 'P')[0]}</div><div><b>${me.program.name}</b><span>${me.season ? me.season.name : me.program.school}</span></div></div>
      <nav id="nav">${nav(me).map((i) => (i.sec ? html`<div class="sec">${i.sec}</div>` : html`<a href="${i.href}" data-nav="${i.href}">${icon(i.ic)}<span>${i.label}</span></a>`))}</nav>
    </aside>
    <div class="main">
      <div class="top">
        <button class="ghost icon menu-btn" id="menu" aria-label="Menu">☰</button>
        <div class="title" id="title"></div>
        <div class="spacer"></div>
        <span id="queue" class="badge warn" hidden></span>
        <button class="ghost" id="bell" aria-label="Notifications">Alerts <span class="badge" id="unread">0</span></button>
        <div class="who"><b>${me.user.name}</b><br>${me.user.title || ROLE[me.user.role]}</div>
        <button class="ghost sm" id="logout">Sign out</button>
      </div>
      <div class="offline-bar" id="offline" hidden>You are offline. Attendance, notes, ratings and workout logs are saved on this device and sync when you reconnect.</div>
      <div class="content" id="content"></div>
    </div>
  </div>`);
  $('#menu').onclick = () => $('#side').classList.toggle('open');
  $('#logout').onclick = async () => { await api.post('/api/auth/logout').catch(() => {}); location.href = '/'; };
  $('#bell').onclick = openNotifications;
  updateUnread(me.unread);
  const q = () => { const n = queueLength(); const el = $('#queue'); if (!el) return; el.hidden = !n; el.textContent = `${n} waiting to sync`; };
  onQueueChange(q); q();
  const off = () => { $('#offline').hidden = navigator.onLine; };
  window.addEventListener('online', async () => { off(); const r = await flushQueue(); if (r.sent) toast(`Synced ${r.sent} offline change${r.sent > 1 ? 's' : ''}`); if (r.failed) toast(`${r.failed} offline change(s) were rejected: ${r.failures.join('; ')}`, 'bad'); q(); });
  window.addEventListener('offline', off); off();
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try { const m = await api.get('/api/me'); updateUnread(m.unread); } catch { /* offline */ }
    if (navigator.onLine && queueLength()) { await flushQueue(); q(); }
  }, 45000);
}
function updateUnread(n) { const el = $('#unread'); if (el) { el.textContent = n; el.className = `badge ${n ? 'bad' : ''}`; } }

async function openNotifications() {
  let list = [];
  try { list = await api.get('/api/notifications?limit=60'); } catch (e) { return errToast(e); }
  const m = modal({
    title: 'Notifications', wide: true,
    body: list.length ? html`<ul class="list" style="margin:-16px">${list.map((n) => html`<li class="click" data-id="${n.id}" data-link="${n.link || ''}">
      <span class="dot ${n.kind === 'urgent' ? 'bad' : n.opened_at ? '' : 'ok'}"></span>
      <div class="grow"><div class="t">${n.kind === 'urgent' ? html`<span class="badge bad">Urgent</span> ` : n.kind === 'reminder' ? html`<span class="badge">Reminder</span> ` : ''}${n.title}</div><div class="s">${n.body || ''}</div></div>
      <div class="s">${ago(n.created_at)}</div></li>`)}</ul>` : html`<div class="empty">No notifications yet.</div>`,
    actions: [{ label: 'Mark all read', onClick: async () => { await api.post('/api/notifications/open-all'); updateUnread(0); } }, { label: 'Close' }],
  });
  on(m.root, 'click', 'li[data-id]', async (e, li) => {
    await api.post(`/api/notifications/${li.dataset.id}/open`).catch(() => {});
    m.close();
    const me = await api.get('/api/me').catch(() => null); if (me) updateUnread(me.unread);
    if (li.dataset.link) navigate(li.dataset.link);
  });
}

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path);
  route();
}
window.__navigate = navigate;

async function route() {
  const url = new URL(location.href);
  const path = url.pathname;
  if (path.startsWith('/invite/')) return (await import('./pages/auth.js')).invite(path.split('/')[2]);
  if (!state.me) return (await import('./pages/auth.js')).login();
  let match = null; let params = {};
  for (const r of compiled) { const m = path.match(r.re); if (m) { match = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; } }
  if (!$('#content')) shell();
  document.querySelectorAll('#nav a').forEach((a) => {
    const h = a.dataset.nav;
    a.classList.toggle('on', h === '/' ? path === '/' : path === h || path.startsWith(h + '/') || (h === '/players' && path === '/teams'));
  });
  $('#side').classList.remove('open');
  const content = $('#content');
  if (!match) { set(content, html`<div class="empty">Page not found. <a href="/">Go home</a></div>`); return; }
  const title = match.title;
  $('#title').textContent = title;
  document.title = `${title} · Program Manager`;
  set(content, html`<div class="muted" style="padding:20px 0">Loading…</div>`);
  const token = (state.page = Symbol('page'));
  try {
    const mod = await import(`./pages/${match.mod}.js`);
    if (state.page !== token) return;
    const fresh = content.cloneNode(false); content.replaceWith(fresh);
    await mod.default(fresh, {
      me: state.me, params, query: Object.fromEntries(url.searchParams), path, route: match.p, navigate,
      setTitle: (t) => { $('#title').textContent = t; document.title = `${t} · Program Manager`; },
      reload: () => route(),
      refreshMe: async () => { state.me = await api.get('/api/me'); },
    });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error(e);
    set($('#content'), html`<div class="notice bad">${e.status === 403 ? 'You do not have access to this page.' : e.message || 'Something went wrong.'}</div>`);
  }
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('/api/') || href.startsWith('/feed/') || href.startsWith('//')) return;
  e.preventDefault();
  navigate(href);
});
window.addEventListener('popstate', route);

export async function boot() {
  try { state.me = await api.get('/api/me'); } catch (e) { state.me = null; if (e.data?.twofa) return (await import('./pages/auth.js')).verify(); }
  if ('serviceWorker' in navigator && location.hostname !== '127.0.0.1') navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (state.me) shell();
  route();
  if (state.me && navigator.onLine) flushQueue();
}
export const signedIn = async () => { state.me = await api.get('/api/me'); const c = $('#content'); if (c) c.remove(); shell(); navigate(location.pathname.startsWith('/invite') || location.pathname === '/login' ? '/' : location.pathname + location.search, { replace: true }); };
boot();
