// Module 3: Playbook — v2 Playbooks dashboard (PB-1..PB-6), playbook page with Offense/Defense tabs, Group By and
// play cards (PL-1..PL-6), the animated viewer with watermark and view-only protection, versions, export (PNG/PDF),
// delivery to audiences, install sheets with view tracking, knowledge checks and game mode. The Play Designer is in
// ../playbook-designer.js; Formations, Routes, Positions and Playcaller Mode have their own page files.
import { api } from '../api.js';
import { html, set, $, $$, on, modal, toast, errToast, formData, options, checked, field, audienceField, wireAudience, fmtDT, ago, cap, empty,
  confirmDialog, raw, ROLE, esc } from '../ui.js';
import { renderPlay, thumb, svgPoint, flipPt, watermarkHtml, animator, setPositions, displayLetter, normalizePlay } from '../field.js';
import { icon } from '../icons.js';
import { pbTabs, bindMenu, inlineRename, sideLabel } from '../pb-ui.js';
import { GROUP_BY, groupPlays } from '../pb-model.js';
import { openExport } from '../export.js';

export default async function playbook(el, ctx) {
  const r = ctx.route;
  if (r === '/playbook/play/:id/edit') return (await import('../playbook-designer.js')).playDesigner(el, ctx, ctx.params.id);
  if (r === '/playbook/play/:id') return viewer(el, ctx, Number(ctx.params.id));
  if (r === '/playbook/book/:id') return book(el, ctx, Number(ctx.params.id));
  if (r === '/playbook/installs') return installs(el, ctx);
  if (r === '/playbook/install/:id') return install(el, ctx, Number(ctx.params.id));
  if (r === '/playbook/game') return gameMode(el, ctx);
  if (r === '/playbook/shares') return shares(el, ctx);
  return ctx.me.caps.staff ? dashboard(el, ctx) : library(el, ctx);
}
const staffTabs = pbTabs;
const protect = (root) => { root.addEventListener('contextmenu', (e) => e.preventDefault()); root.addEventListener('copy', (e) => e.preventDefault()); root.addEventListener('dragstart', (e) => e.preventDefault()); };
const loadPositions = () => api.get('/api/pb/positions').then(setPositions).catch(() => {});

// ---------- Playbooks dashboard (PB-1, PB-2, PB-5, PB-6, PL-6) ----------
async function dashboard(el, ctx) {
  const q = ctx.query.q || '';
  const [books, cfg, hits] = await Promise.all([api.get('/api/playbooks'), api.get('/api/playbook/config'), q ? api.get(`/api/plays?q=${encodeURIComponent(q)}`) : Promise.resolve(null)]);
  if (hits) await loadPositions();
  const edit = cfg.can_edit;
  const openSide = cfg.dc_mode ? '?side=defense' : '';
  set(el, html`<div class="page-head"><div><h1>Playbooks</h1><div class="sub">Every play lives in a playbook. Plays are view-only for players, watermarked and logged.</div></div>
    <div class="actions"><a class="btn" href="/playbook/playcaller">${icon('play', 14)} Playcaller mode</a>${edit ? html`<button class="primary" id="nb">${icon('plus', 14)} Add Playbook</button>` : ''}</div></div>
    ${staffTabs('books')}
    <div class="filters"><input type="search" id="q" placeholder="Search all plays" value="${q}">
      <label class="check" title="Open the defensive side of a playbook first"><input type="checkbox" id="dc" ${checked(cfg.dc_mode)}> Defensive Coordinator Mode</label></div>
    ${hits ? html`<div class="card" style="margin-bottom:16px"><div class="hd"><h2>${hits.length} plays match “${q}”</h2><span class="r"><a href="/playbook">Clear</a></span></div>
      ${hits.length ? html`<ul class="list">${hits.map((p) => html`<li class="click" data-href="${edit ? `/playbook/play/${p.id}/edit` : `/playbook/play/${p.id}`}"><div class="grow"><div class="t">${p.name}</div><div class="s">${[books.find((b) => b.id === p.playbook_id)?.name, sideLabel[p.side], p.formation].filter(Boolean).join(' · ')}</div></div></li>`)}</ul>` : html`<div class="bd muted">No plays match.</div>`}</div>` : ''}
    ${books.length ? html`<div class="pb-books">${books.map((b) => html`<div class="card pb-book" data-book="${b.id}" data-href="/playbook/book/${b.id}${openSide}" tabindex="0" role="link" aria-label="Open ${b.name}">
        <div class="t" data-bname>${b.name}</div>
        <div class="s muted">${b.offense_count} offense · ${b.defense_count} defense${b.special_count ? ` · ${b.special_count} special teams` : ''}</div>
        <div class="s faint">${b.last_edit ? `Last edited ${ago(b.last_edit)}` : 'No plays yet'}</div>
        ${edit ? html`<button class="sm ghost icon more" data-more aria-label="Playbook actions">⋯</button>` : ''}</div>`)}</div>`
    : empty(edit ? 'No playbooks yet. Create one with Add Playbook; plays are added inside a playbook.' : 'No playbooks yet.')}`);
  on(el, 'click', '[data-href]', (e, t) => { if (e.target.closest('input, button')) return; ctx.navigate(t.dataset.href); });
  on(el, 'keydown', '[data-href]', (e, t) => { if (e.key === 'Enter') ctx.navigate(t.dataset.href); });
  $('#q', el).onchange = (e) => ctx.navigate(e.target.value ? `/playbook?q=${encodeURIComponent(e.target.value)}` : '/playbook');
  $('#dc', el).onchange = async (e) => { await api.put('/api/pb/prefs', { dc_mode: e.target.checked }); toast(e.target.checked ? 'Playbooks open on the defense side' : 'Playbooks open on the offense side'); ctx.reload(); };
  if ($('#nb', el)) $('#nb', el).onclick = () => addBook(ctx);
  if (edit) bindMenu(el, '[data-book]', (t) => bookMenu(ctx, books.find((b) => b.id === Number(t.dataset.book)), { nameEl: t.querySelector('[data-bname]') }));
}
function addBook(ctx) {
  modal({ title: 'Add playbook', body: html`<form id="bf" onsubmit="return false">${field('Name', html`<input name="name" required placeholder="Varsity offense">`)}${field('Description', html`<input name="description">`)}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Create playbook', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#bf')); if (!f.name.trim()) { toast('Name the playbook', 'warn'); return false; } const res = await api.post('/api/playbooks', f); ctx.navigate(`/playbook/book/${res.id}`); } }] });
}
function bookMenu(ctx, b, { nameEl, onRenamed } = {}) {
  return [
    { label: 'Open', onClick: () => ctx.navigate(`/playbook/book/${b.id}`) },
    { label: 'Rename', onClick: () => (nameEl ? inlineRename(nameEl, b.name, async (v) => { await api.put(`/api/playbooks/${b.id}`, { name: v }); b.name = v; toast('Renamed'); onRenamed?.(v); }) : renameBook(ctx, b)) },
    { label: 'Add Play to Playbook', onClick: () => ctx.navigate(`/playbook/play/new/edit?book=${b.id}`) },
    { label: 'Add defensive play', onClick: () => ctx.navigate(`/playbook/play/new/edit?book=${b.id}&side=defense`) },
    { label: 'Send to players', onClick: () => shareDialog(ctx, { playbook_id: b.id }) },
    '-',
    { label: 'Delete playbook', danger: true, onClick: () => deleteBook(ctx, b) },
  ];
}
function renameBook(ctx, b) {
  modal({ title: 'Rename playbook', body: html`<form id="rf" onsubmit="return false">${field('Name', html`<input name="name" value="${b.name}" required>`)}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => { await api.put(`/api/playbooks/${b.id}`, formData(r.querySelector('#rf'))); ctx.reload(); } }] });
}
async function deleteBook(ctx, b) {
  const n = b.play_count ?? 0;
  const ok = await confirmDialog(`Delete the playbook “${b.name}”? This also deletes ${n === 1 ? 'the 1 play' : `all ${n} plays`} inside it, for everyone, including their version history. This cannot be undone.`, { title: 'Delete playbook and its plays', danger: true, ok: `Delete playbook and ${n} play${n === 1 ? '' : 's'}` });
  if (!ok) return;
  try { const r = await api.del(`/api/playbooks/${b.id}`); toast(`Deleted ${b.name} and ${r.plays_deleted} play${r.plays_deleted === 1 ? '' : 's'}`); ctx.navigate('/playbook'); } catch (e) { errToast(e); }
}

// ---------- Playbook page (PB-2..PB-6, PL-1..PL-5) ----------
async function book(el, ctx, id) {
  const [b, plays, books, cfg] = await Promise.all([api.get(`/api/playbooks/${id}`), api.get(`/api/plays?playbook_id=${id}`), api.get('/api/playbooks'), api.get('/api/playbook/config')]);
  await loadPositions();
  const edit = cfg.can_edit;
  ctx.setTitle(b.name);
  const side = ['offense', 'defense', 'special'].includes(ctx.query.side) ? ctx.query.side : (cfg.dc_mode ? 'defense' : 'offense');
  let groupBy = ctx.query.group || (() => { try { return localStorage.getItem('pb.groupBy') || 'name'; } catch { return 'name'; } })();
  let filter = '';
  const count = (s) => plays.filter((p) => p.side === s).length;
  set(el, html`<div class="page-head"><div style="min-width:0;flex:1">
      ${edit ? html`<div class="row" style="gap:6px;flex-wrap:nowrap"><input class="pb-rename" id="bname" value="${b.name}" aria-label="Playbook name"><button class="sm primary" id="bsave" hidden>Save</button></div>` : html`<h1>${b.name}</h1>`}
      <div class="sub">${b.description ? `${b.description} · ` : ''}${plays.length} play${plays.length === 1 ? '' : 's'}. ${edit ? 'Click a play to edit it; right-click for more.' : ''}</div></div>
    <div class="actions"><a class="btn" href="/playbook">All playbooks</a><a class="btn" href="/playbook/playcaller?book=${id}">${icon('play', 14)} Playcaller</a>
      ${edit ? html`<button id="share">Send to players</button><button class="primary" id="np">${icon('plus', 14)} Add Play</button>` : ''}</div></div>
    <div class="tabs" role="tablist">${['offense', 'defense', ...(count('special') ? ['special'] : [])].map((s) => html`<a href="/playbook/book/${id}?side=${s}" class="${s === side ? 'on' : ''}" role="tab" aria-selected="${s === side}">${sideLabel[s]} <span class="faint">${count(s)}</span></a>`)}</div>
    <div class="filters"><label class="muted" for="gb" style="font-size:13px">Group by</label><select id="gb">${options(GROUP_BY, groupBy)}</select><input type="search" id="pf" placeholder="Filter plays"></div>
    <div id="plist"></div>
    ${edit ? html`<div class="card" style="margin-top:28px"><div class="bd row between"><div><b>Delete playbook</b><div class="muted" style="font-size:13px">Deletes this playbook and every play inside it (${plays.length}).</div></div><button class="danger" id="delb">Delete playbook</button></div></div>` : ''}`);
  const drawList = () => {
    const mine = plays.filter((p) => p.side === side && (!filter || `${p.name} ${p.formation || ''} ${(p.tags || []).join(' ')}`.toLowerCase().includes(filter)));
    if (!mine.length) { set($('#plist', el), empty(filter ? 'No plays match.' : edit ? `No ${sideLabel[side].toLowerCase()} plays yet. Add one with Add Play.` : 'No plays here yet.')); return; }
    set($('#plist', el), groupPlays(mine, groupBy).map((g) => html`<div class="pb-group">${g.key} <span class="faint">${g.plays.length}</span></div>
      <div class="pb-plays">${g.plays.map((p) => html`<div class="card pb-card" data-play="${p.id}" tabindex="0" role="link" aria-label="${edit ? 'Edit' : 'Open'} ${p.name}">
        <div class="play-thumb no-copy">${raw(thumb(p.data))}</div>
        <div class="bd" style="padding:8px 10px"><div class="nm" data-pname>${p.name}</div><div class="s muted" style="font-size:12px">${[p.formation, ...(p.situation?.play_type || [])].filter(Boolean).join(' · ') || ' '}</div></div>
        ${edit ? html`<div class="qa"><button class="sm icon" data-qdel="${p.id}" title="Delete play" aria-label="Delete ${p.name}">✕</button><button class="sm icon" data-more aria-label="More actions">⋯</button></div>` : ''}</div>`)}</div>`));
  };
  drawList();
  const open = (pid) => ctx.navigate(edit ? `/playbook/play/${pid}/edit` : `/playbook/play/${pid}`);
  on(el, 'click', '[data-play]', (e, t) => { if (e.target.closest('button, input')) return; open(Number(t.dataset.play)); });
  on(el, 'keydown', '[data-play]', (e, t) => { if (e.key === 'Enter' && e.target === t) open(Number(t.dataset.play)); });
  $('#gb', el).onchange = (e) => { groupBy = e.target.value; try { localStorage.setItem('pb.groupBy', groupBy); } catch { /* ignore */ } drawList(); };
  $('#pf', el).oninput = (e) => { filter = e.target.value.trim().toLowerCase(); drawList(); };
  if (!edit) return;
  const nameIn = $('#bname', el); const saveB = $('#bsave', el);
  nameIn.oninput = () => { saveB.hidden = nameIn.value.trim() === b.name; };
  nameIn.onkeydown = (e) => { if (e.key === 'Enter') saveB.click(); if (e.key === 'Escape') { nameIn.value = b.name; saveB.hidden = true; } };
  saveB.onclick = async () => { const v = nameIn.value.trim(); if (!v) return toast('Name the playbook', 'warn'); try { await api.put(`/api/playbooks/${id}`, { name: v }); b.name = v; saveB.hidden = true; ctx.setTitle(v); toast('Playbook renamed'); } catch (e) { errToast(e); } };
  $('#np', el).onclick = () => ctx.navigate(`/playbook/play/new/edit?book=${id}&side=${side}`);
  $('#share', el).onclick = () => shareDialog(ctx, { playbook_id: id });
  $('#delb', el).onclick = () => deleteBook(ctx, { ...b, play_count: plays.length });
  on(el, 'click', '[data-qdel]', async (e, btn) => { e.stopPropagation(); const p = plays.find((x) => x.id === Number(btn.dataset.qdel)); await deletePlay(ctx, p); });
  bindMenu(el, '[data-play]', (t) => {
    const p = plays.find((x) => x.id === Number(t.dataset.play));
    return [
      { label: 'Edit', onClick: () => ctx.navigate(`/playbook/play/${p.id}/edit`) },
      { label: 'View and animate', onClick: () => ctx.navigate(`/playbook/play/${p.id}`) },
      { label: 'Rename', onClick: () => inlineRename(t.querySelector('[data-pname]'), p.name, async (v) => { const r = await api.put(`/api/plays/${p.id}`, { name: v, base_version: p.version, summary: 'Renamed' }); p.name = v; p.version = r.version; toast('Renamed'); }) },
      { label: 'Duplicate', onClick: () => duplicatePlay(ctx, p) },
      { label: 'Duplicate to Playbook…', onClick: () => duplicateTo(ctx, p, books) },
      ...(cfg.can_export ? [{ label: 'Export…', onClick: () => openExport(ctx, p.id, { name: p.name }) }] : []),
      '-',
      { label: 'Delete', danger: true, onClick: () => deletePlay(ctx, p) },
    ];
  });
}
async function deletePlay(ctx, p) {
  if (!(await confirmDialog(`Delete “${p.name}” for everyone?`, { danger: true, ok: 'Delete play' }))) return;
  try { await api.del(`/api/plays/${p.id}`); toast('Play deleted'); ctx.reload(); } catch (e) { errToast(e); }
}
async function duplicatePlay(ctx, p) {
  try { await api.post(`/api/plays/${p.id}/duplicate`, {}); toast(`Created ${p.name} (Copy)`); ctx.reload(); } catch (e) { errToast(e); }
}
function duplicateTo(ctx, p, books) {
  modal({ title: 'Duplicate to playbook', body: html`<form id="df" onsubmit="return false">${field('Copy “' + p.name + '” into', html`<select name="playbook_id">${options(books.map((b) => [b.id, b.name]), books.find((b) => b.id !== p.playbook_id)?.id)}</select>`)}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Duplicate', primary: true, onClick: async (r) => {
      const f = formData(r.querySelector('#df'));
      const res = await api.post(`/api/plays/${p.id}/duplicate`, { playbook_id: Number(f.playbook_id) });
      toast(`Copied to ${books.find((b) => b.id === Number(f.playbook_id))?.name}`);
      ctx.navigate(`/playbook/play/${res.id}/edit`);
    } }] });
}

// Players: the plays shared with them (view-only).
async function library(el, ctx) {
  const staff = ctx.me.caps.staff;
  const q = ctx.query;
  const [plays, books, facets, cfg] = await Promise.all([api.get(`/api/plays?${new URLSearchParams(q)}`), api.get('/api/playbooks'), api.get('/api/playbook/facets').catch(() => ({ folders: [], tags: [] })), api.get('/api/playbook/config'), loadPositions()]);
  const edit = cfg.can_edit && staff;
  set(el, html`<div class="page-head"><div><h1>${staff ? 'Playbook' : 'My plays'}</h1><div class="sub">${staff ? 'Plays are view-only inside the app, watermarked and logged.' : 'Plays your coaches assigned to you. View-only and watermarked with your name.'}</div></div>
    <div class="actions">${edit ? html`<button id="nb">New playbook</button><button class="primary" id="np">New play</button>` : ''}${!staff ? html`<a class="btn" href="/playbook/installs">Install sheets</a>` : ''}</div></div>
    ${staff ? staffTabs('plays') : ''}
    <div class="filters"><input type="search" id="q" placeholder="Search plays" value="${q.q || ''}" style="min-width:220px">
      <select id="pb"><option value="">All playbooks</option>${options(books.map((b) => [b.id, b.name]), q.playbook_id)}</select>
      <select id="side"><option value="">All sides</option>${options([['offense', 'Offense'], ['defense', 'Defense'], ['special', 'Special teams']], q.side)}</select>
      <select id="folder"><option value="">All folders</option>${options(facets.folders, q.folder)}</select>
      <select id="tag"><option value="">All tags</option>${options(facets.tags, q.tag)}</select></div>
    ${plays.length ? html`<div class="grid g4">${plays.map((p) => html`<a class="card" href="/playbook/play/${p.id}" style="color:inherit;text-decoration:none">
      <div class="play-thumb no-copy">${raw(thumb(p.data))}</div>
      <div class="bd" style="padding:9px 11px"><b>${p.name}</b><div class="s muted">${[p.formation, p.folder].filter(Boolean).join(' · ')}</div>
      <div class="row" style="margin-top:5px;gap:4px">${p.tags.slice(0, 3).map((t) => html`<span class="badge">${t}</span>`)}</div></div></a>`)}</div>`
    : empty(staff ? 'No plays match. Create one with New play.' : 'No plays have been assigned to you yet.')}
    ${staff && books.length ? html`<div class="card" style="margin-top:14px"><div class="hd"><h2>Playbooks</h2></div><ul class="list">${books.map((b) => html`<li><div class="grow"><div class="t">${b.name}</div><div class="s">${b.description || ''} · ${b.play_count} plays</div></div>${edit ? html`<button class="sm" data-share-book="${b.id}">Send to players</button>` : ''}</li>`)}</ul></div>` : ''}`);
  const go = () => ctx.navigate('/playbook?' + new URLSearchParams(Object.fromEntries(Object.entries({ q: $('#q', el).value, playbook_id: $('#pb', el).value, side: $('#side', el).value, folder: $('#folder', el).value, tag: $('#tag', el).value }).filter(([, v]) => v))));
  for (const id of ['q', 'pb', 'side', 'folder', 'tag']) $(`#${id}`, el).onchange = go;
  if ($('#np', el)) $('#np', el).onclick = () => ctx.navigate('/playbook/play/new/edit');
  if ($('#nb', el)) $('#nb', el).onclick = () => modal({ title: 'New playbook', body: html`<form id="bf">${field('Name', html`<input name="name" required>`)}${field('Side', html`<select name="side">${options([['offense', 'Offense'], ['defense', 'Defense'], ['special', 'Special teams']])}</select>`)}${field('Description', html`<input name="description">`)}</form>`, actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: async (r) => { await api.post('/api/playbooks', formData(r.querySelector('#bf'))); ctx.reload(); } }] });
  on(el, 'click', '[data-share-book]', (e, b) => shareDialog(ctx, { playbook_id: Number(b.dataset.shareBook) }));
  protect(el);
}

async function shareDialog(ctx, target) {
  const auds = await api.get('/api/audiences');
  const m = modal({
    title: 'Send to players', body: html`<p class="muted">Players see only what is assigned to them. Parents never get playbook access. Access ends automatically when a player leaves the roster or group.</p>${audienceField('audience', auds, [], { exclude: ['parents', 'coaches'] })}`,
    actions: [{ label: 'Cancel' }, { label: 'Send', primary: true, onClick: async (r) => { const f = formData(r); await api.post('/api/play-shares', { ...target, audience: f.audience || [] }); toast('Sent'); } }],
  });
  wireAudience(m.root);
}

// ---------- Viewer ----------
async function viewer(el, ctx, id) {
  const [p] = await Promise.all([api.get(`/api/plays/${id}`), loadPositions()]);
  const staff = ctx.me.caps.staff;
  ctx.setTitle(p.name);
  p.data = normalizePlay(p.data);
  let highlight = null;
  let theme = 'grass';
  const books = staff && p.can_edit ? await api.get('/api/playbooks').catch(() => []) : [];
  const tagList = [...(p.situation?.play_type || []), ...(p.situation?.distance || []), ...(p.situation?.down_distance || [])];
  set(el, html`<div class="page-head"><div><h1>${p.name}</h1><div class="sub">${[cap(p.side), p.formation, p.folder].filter(Boolean).join(' · ')} · version ${p.version}</div>
      ${tagList.length ? html`<div class="row" style="gap:4px;margin-top:6px">${tagList.map((t) => html`<span class="badge">${t}</span>`)}</div>` : ''}</div>
    <div class="actions"><a class="btn" href="${staff && p.playbook_id ? `/playbook/book/${p.playbook_id}?side=${p.side}` : '/playbook'}">Back</a>
      ${p.can_edit ? html`<a class="btn primary" href="/playbook/play/${id}/edit">Edit</a><button id="dup">Duplicate</button><button id="dupto">Duplicate to playbook</button><button id="flip">Flip copy</button><button id="share">Send to players</button>` : ''}
      ${p.can_export ? html`<button id="exp">${icon('download', 14)} Export</button>` : ''}
      ${staff ? html`<a class="btn" href="/playbook/game?play=${id}">Game mode</a>` : ''}</div></div>
  <div class="designer">
    <div>
      <div class="field-wrap no-copy" id="fw">${raw(renderPlay(p.data))}${raw(watermarkHtml(p.watermark))}</div>
      <div class="row" style="margin-top:8px">
        <button class="primary" id="playb">Play</button><button id="reset">Reset</button><button id="back1">‹ Step</button><button id="fwd1">Step ›</button>
        <div class="seg">${[0.5, 1, 2].map((s) => html`<button data-speed="${s}" class="${s === 1 ? 'on' : ''}">${s}x</button>`)}</div>
        <span class="muted" id="tlabel"></span>
        <span class="spacer"></span>
        <div class="seg" aria-label="Field theme"><button data-vtheme="grass" class="on">Grass</button><button data-vtheme="paper">Paper</button></div>
        <select id="hl" style="width:auto"><option value="">Highlight a position</option>${options([...new Set(p.data.players.map((x) => displayLetter(x)).filter(Boolean))])}</select>
      </div>
    </div>
    <div class="stack no-copy">
      ${p.coaching_points ? html`<div class="card"><div class="hd"><h3>Coaching points</h3></div><div class="bd">${p.coaching_points}</div></div>` : ''}
      <div class="card"><div class="hd"><h3>Assignments</h3></div>${Object.keys(p.assignments || {}).length ? html`<ul class="list">${Object.entries(p.assignments).map(([k, v]) => html`<li><b style="width:44px">${k}</b><span class="grow">${v}</span></li>`)}</ul>` : empty('No written assignments.')}</div>
      ${p.video_url ? html`<div class="card"><div class="bd"><a href="${p.video_url}" target="_blank" rel="noopener">Watch video</a></div></div>` : ''}
      ${!staff && (p.data.quiz || []).length ? html`<div class="card"><div class="hd"><h3>Knowledge check</h3></div><div class="bd" id="quiz">${p.data.quiz.map((q, i) => html`<div class="field"><label>${i + 1}. ${q.q}</label>${q.options.map((o, j) => html`<label class="check" style="display:flex"><input type="radio" name="q${i}" value="${j}"> ${o}</label>`)}</div>`)}<button class="primary" id="qsub">Submit answers</button></div></div>` : ''}
      ${staff ? html`<div class="card"><div class="hd"><h3>History and views</h3></div><div class="bd row"><button class="sm" id="ver">Version history</button><button class="sm" id="views">View log</button>${(p.data.quiz || []).length ? html`<button class="sm" id="qr">Quiz results</button>` : ''}</div></div>` : ''}
    </div>
  </div>`);
  protect(el);
  const fw = $('#fw', el);
  const draw = (t) => { fw.innerHTML = renderPlay(p.data, { t, highlight, theme }) + watermarkHtml(p.watermark); $('#tlabel', el).textContent = t == null ? '' : t < 0 ? 'Pre-snap motion' : `${t.toFixed(1)} s`; };
  const anim = animator(p.data, draw);
  on(el, 'click', '[data-vtheme]', (e, b) => { theme = b.dataset.vtheme; $$('[data-vtheme]', el).forEach((x) => x.classList.toggle('on', x === b)); draw(anim.time > -1.6 ? anim.time : null); });
  $('#playb', el).onclick = () => { if (anim.playing) { anim.pause(); $('#playb', el).textContent = 'Play'; } else { anim.play(); $('#playb', el).textContent = 'Pause'; } };
  $('#reset', el).onclick = () => { anim.reset(); $('#playb', el).textContent = 'Play'; };
  $('#back1', el).onclick = () => anim.step(-0.5);
  $('#fwd1', el).onclick = () => anim.step(0.5);
  on(el, 'click', '[data-speed]', (e, b) => { anim.setSpeed(Number(b.dataset.speed)); $$('[data-speed]', el).forEach((x) => x.classList.toggle('on', x === b)); });
  $('#hl', el).onchange = (e) => { highlight = e.target.value || null; draw(anim.time > -1.6 ? anim.time : null); };
  if ($('#qsub', el)) $('#qsub', el).onclick = async () => {
    const answers = p.data.quiz.map((_, i) => { const c = el.querySelector(`input[name=q${i}]:checked`); return c ? Number(c.value) : null; });
    try { const r = await api.post(`/api/plays/${id}/quiz`, { answers }); toast(`You scored ${r.score} of ${r.total}`); } catch (err) { errToast(err); }
  };
  if (!staff) return;
  if ($('#dup', el)) $('#dup', el).onclick = async () => { const r = await api.post(`/api/plays/${id}/duplicate`, {}); ctx.navigate(`/playbook/play/${r.id}/edit`); };
  if ($('#dupto', el)) $('#dupto', el).onclick = () => duplicateTo(ctx, p, books);
  if ($('#flip', el)) $('#flip', el).onclick = async () => { const r = await api.post(`/api/plays/${id}/duplicate`, { flip: true }); toast('Flipped copy created'); ctx.navigate(`/playbook/play/${r.id}`); };
  if ($('#share', el)) $('#share', el).onclick = () => shareDialog(ctx, { play_id: id });
  if ($('#exp', el)) $('#exp', el).onclick = () => openExport(ctx, id, { name: p.name });
  $('#ver', el).onclick = async () => {
    const v = await api.get(`/api/plays/${id}/versions`);
    const m = modal({ title: 'Version history', body: html`<ul class="list" style="margin:-16px">${v.map((x) => html`<li><div class="grow"><div class="t">Version ${x.version} · ${x.by_name || ''}</div><div class="s">${x.summary || ''} · ${fmtDT(x.at)}</div></div>${p.can_edit && x.version !== p.version ? html`<button class="sm" data-restore="${x.version}">Restore</button>` : ''}</li>`)}</ul>`, actions: [{ label: 'Close' }] });
    on(m.root, 'click', '[data-restore]', async (e, b) => { await api.post(`/api/plays/${id}/restore`, { version: Number(b.dataset.restore) }); m.close(); toast('Restored'); ctx.reload(); });
  };
  $('#views', el).onclick = async () => {
    const v = await api.get(`/api/plays/${id}/views`);
    modal({ title: 'Who opened this play', wide: true, body: v.length ? html`<table><thead><tr><th>Person</th><th>Role</th><th>How</th><th>When</th></tr></thead><tbody>${v.map((x) => html`<tr><td>${x.name}</td><td>${ROLE[x.role]}</td><td>${x.context}</td><td>${fmtDT(x.at)}</td></tr>`)}</tbody></table>` : empty('No views yet.'), actions: [{ label: 'Close' }] });
  };
  if ($('#qr', el)) $('#qr', el).onclick = async () => {
    const v = await api.get(`/api/plays/${id}/quiz-results`);
    modal({ title: 'Knowledge check results', body: v.length ? html`<table><thead><tr><th>Player</th><th class="num">Score</th><th>When</th></tr></thead><tbody>${v.map((x) => html`<tr><td>${x.name}</td><td class="num">${x.score}/${x.total}</td><td>${fmtDT(x.at)}</td></tr>`)}</tbody></table>` : empty('No results yet.'), actions: [{ label: 'Close' }] });
  };
}

// ---------- Delivery ----------
async function shares(el, ctx) {
  const list = await api.get('/api/play-shares');
  const cfg = await api.get('/api/playbook/config');
  set(el, html`<div class="page-head"><div><h1>Playbook</h1><div class="sub">What each group of players can see. Remove a row to revoke access immediately.</div></div></div>${staffTabs('shares')}
    <div class="card"><div class="bd flush tbl-wrap">${list.length ? html`<table><thead><tr><th>Play or playbook</th><th>Sent to</th><th>By</th><th>When</th><th></th></tr></thead><tbody>${list.map((s) => html`<tr><td>${s.play_name ? html`<a href="/playbook/play/${s.play_id}">${s.play_name}</a>` : html`<b>${s.playbook_name}</b> (whole playbook)`}</td><td>${s.audience_labels.join(', ')}</td><td>${s.by_name}</td><td>${fmtDT(s.at)}</td><td>${cfg.can_edit ? html`<button class="sm danger" data-rev="${s.id}">Revoke</button>` : ''}</td></tr>`)}</tbody></table>` : empty('Nothing has been sent to players yet.')}</div></div>`);
  on(el, 'click', '[data-rev]', async (e, b) => { await api.del(`/api/play-shares/${b.dataset.rev}`); toast('Access revoked'); ctx.reload(); });
}

// ---------- Install sheets ----------
async function installs(el, ctx) {
  const staff = ctx.me.caps.staff;
  const [list, cfg] = await Promise.all([api.get('/api/installs'), api.get('/api/playbook/config')]);
  set(el, html`<div class="page-head"><div><h1>${staff ? 'Playbook' : 'Install sheets'}</h1><div class="sub">Ordered sets of plays with coaching points, assigned to a group. Coaches see who has opened each one.</div></div>
    <div class="actions">${cfg.can_edit ? html`<button class="primary" id="new">New install sheet</button>` : ''}</div></div>${staff ? staffTabs('installs') : ''}
    <div class="card">${list.length ? html`<ul class="list">${list.map((i) => html`<li class="click" onclick="__navigate('/playbook/install/${i.id}')"><div class="grow"><div class="t">${i.name}</div><div class="s">${i.plays.length} plays · ${i.audience_labels.join(', ') || 'Not assigned'}</div></div>${staff ? html`<span class="badge ${i.viewed === i.expected ? 'ok' : 'warn'}">${i.viewed}/${i.expected} viewed</span>` : ''}</li>`)}</ul>` : empty('No install sheets yet.')}</div>`);
  if ($('#new', el)) $('#new', el).onclick = () => installForm(ctx);
}
async function installForm(ctx, inst = null) {
  const [plays, auds] = await Promise.all([api.get('/api/plays'), api.get('/api/audiences')]);
  const chosen = inst ? inst.plays.map((p) => p.id) : [];
  const m = modal({
    title: inst ? 'Edit install sheet' : 'New install sheet', wide: true,
    body: html`<form id="if">${field('Name', html`<input name="name" value="${inst?.name || ''}" required>`)}${field('Notes for players', html`<textarea name="notes">${inst?.notes || ''}</textarea>`)}
      <div class="grid g2"><div>${field('Plays (in order checked)', html`<div style="max-height:260px;overflow-y:auto;border:1px solid var(--border-strong);border-radius:5px;padding:6px 10px">${plays.map((p) => html`<label class="check" style="display:flex"><input type="checkbox" name="play_ids" data-multi data-num value="${p.id}" ${checked(chosen.includes(p.id))}> ${p.name} <span class="faint">${p.formation || ''}</span></label>`)}</div>`)}</div>
      <div>${field('Assign to', audienceField('audience', auds, inst?.audience || [], { exclude: ['parents', 'coaches'] }))}</div></div></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => {
      const f = formData(r.querySelector('#if'));
      if (inst) { await api.put(`/api/installs/${inst.id}`, f); ctx.reload(); } else { const res = await api.post('/api/installs', f); ctx.navigate(`/playbook/install/${res.id}`); }
    } }],
  });
  wireAudience(m.root);
}
async function install(el, ctx, id) {
  const [i] = await Promise.all([api.get(`/api/installs/${id}`), loadPositions()]);
  const staff = ctx.me.caps.staff;
  const cfg = await api.get('/api/playbook/config');
  ctx.setTitle(i.name);
  set(el, html`<div class="page-head"><div><h1>${i.name}</h1><div class="sub">${i.audience_labels.join(', ')}</div></div>
    <div class="actions"><a class="btn" href="/playbook/installs">Back</a>${cfg.can_edit ? html`<button id="edit">Edit</button><button class="danger" id="del">Delete</button>` : ''}</div></div>
    ${i.notes ? html`<div class="notice">${i.notes}</div>` : ''}
    ${staff ? html`<div class="card" style="margin-bottom:14px"><div class="hd"><h2>Viewed by ${i.viewed} of ${i.expected}</h2></div>${i.not_viewed.length ? html`<div class="bd"><span class="muted">Not opened yet:</span> ${i.not_viewed.map((p) => p.name).join(', ')}</div>` : html`<div class="bd muted">Everyone has opened it.</div>`}</div>` : ''}
    <div class="stack no-copy">${i.plays.map((p, n) => html`<div class="card"><div class="hd"><h2>${n + 1}. ${p.name}</h2><span class="r"><a href="/playbook/play/${p.id}?install=${id}">Open and animate</a></span></div><div class="bd grid g2">
      <div class="field-wrap">${raw(renderPlay(p.data))}${raw(watermarkHtml(i.watermark))}</div>
      <div>${p.coaching_points ? html`<p><b>Coaching points:</b> ${p.coaching_points}</p>` : ''}<dl class="kv">${Object.entries(p.assignments || {}).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl></div>
    </div></div>`)}</div>`);
  protect(el);
  if ($('#edit', el)) $('#edit', el).onclick = () => installForm(ctx, i);
  if ($('#del', el)) $('#del', el).onclick = async () => { if (await confirmDialog('Delete this install sheet?', { danger: true, ok: 'Delete' })) { await api.del(`/api/installs/${id}`); ctx.navigate('/playbook/installs'); } };
}

// ---------- Game mode (PLAY-9) ----------
const GKEY = 'pm.gameplays.v1';
async function gameMode(el, ctx) {
  const cfg = await api.get('/api/playbook/config').catch(() => ({ game_mode: 'booth_halftime', game_mode_note: '' }));
  await loadPositions();
  let plays = [];
  try { plays = await api.get('/api/plays'); try { localStorage.setItem(GKEY, JSON.stringify(plays)); } catch { /* full */ } } catch { try { plays = JSON.parse(localStorage.getItem(GKEY) || '[]'); } catch { plays = []; } }
  set(el, html`<div class="page-head"><div><h1>Playbook</h1><div class="sub">Open a play full screen, move players or draw over it, and show it. Works offline once plays are loaded here.</div></div></div>${staffTabs('game')}
    <div class="notice ${cfg.game_mode === 'off' ? 'bad' : 'warn'}"><b>${ctx.me.program.state} rule setting:</b> ${cfg.game_mode_note} <a href="/settings">Change in settings</a></div>
    ${cfg.game_mode === 'off' ? '' : html`<div class="card"><div class="bd">
      ${cfg.game_mode === 'booth_halftime' ? html`<label class="check" style="margin-bottom:10px"><input type="checkbox" id="ack"> I am in the coaching booth or the locker room (not on the sideline).</label>` : ''}
      <div class="inline-input"><select id="gp">${options(plays.map((p) => [p.id, p.name]), ctx.query.play)}</select><button class="primary" id="open">Open full screen</button></div>
      <p class="help">${plays.length} plays cached on this device for offline use.</p></div></div>`}`);
  if (cfg.game_mode === 'off') return;
  $('#open', el).onclick = () => {
    if ($('#ack', el) && !$('#ack', el).checked) return toast('Confirm you are in the booth or locker room first', 'warn');
    const p = plays.find((x) => x.id === Number($('#gp', el).value));
    if (p) openGame(p, ctx, plays);
  };
}
function openGame(play, ctx, plays) {
  const data = normalizePlay(play.data);
  const g = document.createElement('div');
  g.className = 'gamemode';
  g.innerHTML = `<div class="bar-top"><b>${esc(play.name)}</b><span style="opacity:.6;font-size:12px">${esc(ctx.me.user.name)}</span><span style="flex:1"></span>
    <select id="gsw" style="width:auto;background:#1c2a22;color:#fff;border-color:#2e4337">${plays.map((p) => `<option value="${p.id}" ${p.id === play.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <button data-m="move" class="sm">Move players</button><button data-m="draw" class="sm">Draw</button><button id="gclear" class="sm">Clear drawing</button><button id="ganim" class="sm">Animate</button><button id="greset" class="sm">Reset</button><button id="gx" class="sm">Close</button></div>
    <div class="stage"><div class="field-wrap" id="gfw" style="position:relative"></div></div>`;
  document.body.appendChild(g);
  if (g.requestFullscreen) g.requestFullscreen().catch(() => {});
  const fw = g.querySelector('#gfw');
  let mode = 'move'; let drag = null; let strokes = []; let cur = null;
  const draw = (t = null) => {
    fw.innerHTML = renderPlay(data, { t, extra: strokes.map((s) => `<polyline points="${s.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#ffd666" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round"/>`).join('') }) + watermarkHtml(ctx.me.user.name);
  };
  draw();
  const setMode = (m) => { mode = m; g.querySelectorAll('[data-m]').forEach((b) => { b.style.outline = b.dataset.m === m ? '2px solid #ffd666' : ''; }); };
  setMode('move');
  g.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => setMode(b.dataset.m); });
  fw.addEventListener('pointerdown', (e) => {
    const svg = fw.querySelector('svg'); const pt = flipPt(svgPoint(svg, e), data.view === 'defense');
    fw.setPointerCapture(e.pointerId);
    if (mode === 'draw') { cur = [pt]; strokes.push(cur); return; }
    const t = e.target.closest('[data-player]'); if (t) drag = data.players.find((p) => p.id === t.dataset.player);
  });
  fw.addEventListener('pointermove', (e) => {
    const svg = fw.querySelector('svg'); if (!svg) return; const pt = flipPt(svgPoint(svg, e), data.view === 'defense');
    if (cur) { cur.push(pt); draw(); } else if (drag) { const dx = pt[0] - drag.x; const dy = pt[1] - drag.y; drag.x = pt[0]; drag.y = pt[1]; drag.path = (drag.path || []).map(([x, y]) => [x + dx, y + dy]); draw(); }
  });
  fw.addEventListener('pointerup', () => { cur = null; drag = null; });
  g.querySelector('#gclear').onclick = () => { strokes = []; draw(); };
  g.querySelector('#greset').onclick = () => { Object.assign(data, JSON.parse(JSON.stringify(play.data))); strokes = []; draw(); };
  g.querySelector('#ganim').onclick = () => animator(data, (t) => draw(t)).play();
  g.querySelector('#gsw').onchange = (e) => { g.remove(); openGame(plays.find((p) => p.id === Number(e.target.value)), ctx, plays); };
  g.querySelector('#gx').onclick = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); g.remove(); };
  g.addEventListener('contextmenu', (e) => e.preventDefault());
  api.get(`/api/plays/${play.id}?context=game`).catch(() => {});
}
