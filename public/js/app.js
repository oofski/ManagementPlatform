// App shell: session, role-based navigation, client-side router, notifications, offline banner.
import { api, flushQueue, queueLength, onQueueChange } from './api.js';
import { html, set, $, on, toast, errToast, modal, ago, ROLE, esc, initials } from './ui.js';
import { icon as lucide } from './icons.js';

const icon = (k, size = 16) => lucide(k, size);

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
  ['/settings/integrations', 'integrations', 'Integrations'],
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
    add('/attendance', 'Attendance', 'calendar-check');
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
    add('/settings/integrations', 'Integrations', 'plug');
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
  const items = nav(me);
  set(app, html`<div class="shell">
    <aside class="side" id="side">
      <div class="brand"><div class="mark">${(me.program.name || 'P')[0]}</div><div style="min-width:0"><b>${me.program.name}</b><span>${me.season ? me.season.name : me.program.school}</span></div></div>
      <button class="search" id="cmdk">${icon('search', 14)}<span>Search or jump to…</span><kbd>${navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K'}</kbd></button>
      <nav id="nav">${items.map((i) => (i.sec ? html`<div class="sec">${i.sec}</div>` : html`<a href="${i.href}" data-nav="${i.href}" data-label="${i.label}">${icon(i.ic)}<span>${i.label}</span></a>`))}</nav>
      <div class="me"><span class="av">${initials(me.user.name)}</span><div class="who"><b>${me.user.name}</b><span>${me.user.title || ROLE[me.user.role]}</span></div>
        <button class="iconbtn" id="logout" title="Sign out" aria-label="Sign out">${icon('logout', 15)}</button></div>
    </aside>
    <div class="main">
      <div class="top">
        <button class="iconbtn menu-btn" id="menu" aria-label="Menu">${icon('menu', 18)}</button>
        <div class="crumb"><span class="prefix" id="crumbsec"></span><span class="prefix" id="crumbsep">${icon('right', 14)}</span><span class="title" id="title"></span></div>
        <span id="queue" class="badge warn" hidden></span>
        <button class="iconbtn" id="cmdk2" aria-label="Search">${icon('search', 16)}</button>
        <button class="iconbtn" id="bell" aria-label="Notifications" title="Notifications">${icon('bell', 16)}<span class="dotn" id="unread" hidden></span></button>
      </div>
      <div class="offline-bar" id="offline" hidden>You are offline. Attendance, notes, ratings and workout logs are saved on this device and sync when you reconnect.</div>
      <div class="content" id="content"></div>
    </div>
  </div>`);
  $('#menu').onclick = () => $('#side').classList.toggle('open');
  $('#logout').onclick = async () => { await api.post('/api/auth/logout').catch(() => {}); location.href = '/'; };
  $('#bell').onclick = openNotifications;
  $('#cmdk').onclick = palette; $('#cmdk2').onclick = palette;
  if (!state.keys) { state.keys = true; document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && state.me) { e.preventDefault(); palette(); } }); }
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

// Command palette: jump to any page, player or quick action.
let paletteOpen = false;
async function palette() {
  if (paletteOpen) return;
  paletteOpen = true;
  const me = state.me;
  const pages = nav(me).filter((i) => !i.sec).map((i) => ({ group: 'Pages', label: i.label, href: i.href, ic: i.ic }));
  const actions = [];
  if (me.caps['calendar.edit']) actions.push({ group: 'Actions', label: 'New event', href: '/calendar?new=1', ic: 'plus' });
  if (me.caps['messages.send']) actions.push({ group: 'Actions', label: 'New announcement', href: '/messages/announcements?new=1', ic: 'plus' });
  if (me.caps.staff) actions.push({ group: 'Actions', label: 'Take attendance', href: '/attendance', ic: 'calendar-check' }, { group: 'Actions', label: 'Season plan', href: '/season', ic: 'calendar' });
  let people = [];
  const m = modal({ title: 'Search', body: html`<div class="cmdk"><input id="cq" placeholder="Search pages, players and actions" autocomplete="off"><ul id="cl"></ul></div>` });
  m.root.classList.add('cmdk');
  const bg = m.root.closest('.modal-bg');
  new MutationObserver(() => { if (!document.body.contains(bg)) paletteOpen = false; }).observe(document.body, { childList: true });
  if (me.caps.staff) api.get('/api/players').then((list) => { people = list.map((p) => ({ group: 'Players', label: `${p.name}${p.jersey != null ? ` #${p.jersey}` : ''}`, sub: [p.team, p.positions.join('/')].filter(Boolean).join(' · '), href: `/players/${p.id}`, ic: 'user' })); draw(); }).catch(() => {});
  let sel = 0; let shown = [];
  const draw = () => {
    const q = m.root.querySelector('#cq').value.trim().toLowerCase();
    const all = [...actions, ...pages, ...people];
    shown = (q ? all.filter((x) => (x.label + ' ' + (x.sub || '')).toLowerCase().includes(q)) : [...actions, ...pages]).slice(0, 40);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    let last = '';
    set(m.root.querySelector('#cl'), shown.length ? shown.map((x, i) => { const g = x.group !== last ? html`<div class="grp">${x.group}</div>` : ''; last = x.group; return html`${g}<li data-i="${i}" class="${i === sel ? 'on' : ''}">${icon(x.ic || 'right', 15)}<span>${x.label}</span>${x.sub ? html`<span class="k">${x.sub}</span>` : ''}</li>`; }) : html`<div class="empty">No matches</div>`);
  };
  const go = (x) => { if (!x) return; m.close(); paletteOpen = false; navigate(x.href); };
  const inp = m.root.querySelector('#cq');
  inp.addEventListener('input', () => { sel = 0; draw(); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); draw(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
    if (e.key === 'Enter') { e.preventDefault(); go(shown[sel]); }
  });
  on(m.root, 'click', 'li[data-i]', (e, li) => go(shown[Number(li.dataset.i)]));
  draw();
}
function updateUnread(n) { const el = $('#unread'); if (el) { el.textContent = n > 99 ? '99+' : n; el.hidden = !n; } }

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
  const alias = { '/teams': '/players', '/season': '/development', '/reports/team': '/development', '/account': '/settings' };
  const navPath = alias[path] || (path.startsWith('/reports/') ? '/development' : path);
  let best = null;
  document.querySelectorAll('#nav a').forEach((a) => {
    const h = a.dataset.nav;
    const hit = h === '/' ? navPath === '/' : navPath === h || navPath.startsWith(h + '/');
    if (hit && (!best || h.length > best.dataset.nav.length)) best = a;
  });
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a === best));
  $('#side').classList.remove('open');
  const content = $('#content');
  if (!match) { set(content, html`<div class="empty">Page not found. <a href="/">Go home</a></div>`); return; }
  const title = match.title;
  $('#title').textContent = title;
  const onNav = document.querySelector('#nav a.on');
  const secLabel = onNav ? onNav.dataset.label : '';
  $('#crumbsec').textContent = secLabel && secLabel !== title ? secLabel : '';
  $('#crumbsep').hidden = !(secLabel && secLabel !== title);
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
