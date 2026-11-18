// Module 4 (PLR-8..12): visual drag-and-drop depth charts per team, unit and game week, with versions.
import { api } from '../api.js';
import { html, set, $, $$, on, modal, toast, errToast, formData, options, field, empty, initials, UNIT, mondayOf, todayISO, fmtDate, confirmDialog, raw, ago } from '../ui.js';

export default async function depth(el, ctx) {
  if (ctx.params.id) return chart(el, ctx, Number(ctx.params.id));
  const [charts, st] = await Promise.all([api.get('/api/depth'), api.get('/api/structure')]);
  const teams = st.levels.flatMap((l) => l.teams.map((t) => ({ id: t.id, label: t.name === l.name ? t.name : `${l.name} ${t.name}` })));
  const edit = ctx.me.caps['depth.edit'];
  const groups = {};
  for (const c of charts) (groups[`${c.team_id}:${c.unit}`] ||= []).push(c);
  set(el, html`<div class="page-head"><div><h1>Depth charts</h1><div class="sub">${edit ? 'One chart per team and unit for each game week. Copy last week and drag players between slots.' : 'Depth charts your coaches have shared.'}</div></div>
    <div class="actions">${edit ? html`<button class="primary" id="new">New chart</button>` : ''}</div></div>
    ${Object.keys(groups).length ? html`<div class="grid g3">${Object.entries(groups).map(([k, list]) => { const [tid, unit] = k.split(':'); const t = teams.find((x) => x.id === Number(tid)); return html`<div class="card"><div class="hd"><h2>${t?.label || 'Team'} · ${UNIT[unit]}</h2></div>
      <ul class="list">${list.map((c, i) => html`<li class="click" onclick="__navigate('/depth/${c.id}')"><div class="grow"><div class="t">${c.week_label}${i === 0 ? html` <span class="badge green">Latest</span>` : ''}</div><div class="s">Updated ${ago(c.updated_at)}</div></div>${edit ? html`<span class="badge ${c.visible_to_players ? 'ok' : ''}">${c.visible_to_players ? 'Players can see' : 'Coaches only'}</span>` : ''}</li>`)}</ul></div>`; })}</div>`
    : empty(edit ? 'No depth charts yet.' : 'No depth charts have been shared with you.')}`);
  if (!edit) return;
  $('#new', el).onclick = () => modal({
    title: 'New depth chart',
    body: html`<form id="nf"><div class="fields">${field('Team', html`<select name="team_id">${options(teams.map((t) => [t.id, t.label]))}</select>`)}${field('Unit', html`<select name="unit">${options(Object.entries(UNIT))}</select>`)}</div>
      ${field('Week', html`<input name="week_label" value="Week of ${mondayOf(todayISO())}">`)}
      ${field('Start from', html`<select name="copy_from">${options(charts.map((c) => [c.id, `${teams.find((t) => t.id === c.team_id)?.label} ${UNIT[c.unit]} · ${c.week_label}`]), '', { blank: 'Empty chart' })}</select>`, 'Copy last week’s chart to start from it.')}
      <label class="check"><input type="checkbox" name="visible_to_players"> Players on this team can see it</label></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#nf')); const res = await api.post('/api/depth', { ...f, copy_from: f.copy_from || null }); ctx.navigate(`/depth/${res.id}`); } }],
  });
}

async function chart(el, ctx, id) {
  const [c, all, players] = await Promise.all([api.get(`/api/depth/${id}`), api.get('/api/depth'), ctx.me.caps.staff ? api.get('/api/players') : Promise.resolve([])]);
  const edit = ctx.me.caps['depth.edit'];
  const sensitive = ctx.me.caps['ratings.view'] || ctx.me.user.role === 'trainer' || ctx.me.caps.admin;
  const slots = JSON.parse(JSON.stringify(c.slots));
  const cards = { ...c.cards };
  for (const p of players) if (!cards[p.id]) cards[p.id] = { id: p.id, name: p.name, jersey: p.jersey, class_year: p.class_year, photo: p.photo, availability: p.availability, height: p.height, weight: p.weight };
  const history = all.filter((x) => x.team_id === c.team_id && x.unit === c.unit);
  let dirty = false; let picked = null; // tap-to-move for touch: pick a card, tap a slot
  ctx.setTitle(`Depth chart · ${UNIT[c.unit]}`);
  const pool = () => players.filter((p) => p.team_id === c.team_id && p.units.includes(c.unit) && !Object.values(slots).flat().includes(p.id));
  const card = (pid, i, slot) => { const p = cards[pid]; if (!p) return ''; return html`<div class="pcard ${i === 0 ? 'first' : ''} ${picked && picked.pid === pid && picked.slot === slot ? 'sel' : ''}" draggable="${edit ? 'true' : 'false'}" data-pid="${pid}" data-from="${slot || ''}">
    <span class="ph">${p.photo ? html`<img src="${p.photo}" alt="">` : p.jersey ?? initials(p.name)}</span>
    <span class="nm">${p.jersey != null ? `#${p.jersey} ` : ''}${p.name.split(' ').slice(-1)[0]}<small>${p.name.split(' ')[0]} · '${String(p.class_year || '').slice(2)}${sensitive && p.weight ? ` · ${p.weight}lb` : ''}${sensitive && p.avg_rating ? ` · ${p.avg_rating}★` : ''}${sensitive && p.availability && p.availability !== 'available' ? ` · ${p.availability.toUpperCase()}` : ''}</small></span></div>`; };
  const draw = () => {
    set($('#fieldbox', el), html`<div class="depth-field">${c.layout.map(([slot, x, y]) => html`<div class="slot" data-slot="${slot}" style="left:${x}%;top:${y}%"><div class="sl">${slot}<span>${(slots[slot] || []).length}</span></div>${(slots[slot] || []).map((pid, i) => card(pid, i, slot))}</div>`)}</div>`);
    if (edit) set($('#pool', el), pool().length ? html`<div style="display:flex;flex-wrap:wrap;gap:4px;background:#244f31;padding:8px;border-radius:6px" data-slot="">${pool().map((p) => card(p.id, 1, ''))}</div>` : html`<p class="muted">Every eligible player is on the chart.</p>`);
    $('#save', el) && ($('#save', el).disabled = !dirty);
  };
  set(el, html`<div class="page-head"><div><h1>${c.week_label}</h1><div class="sub">${UNIT[c.unit]} · ${edit ? 'Drag a card to a slot (or tap a card, then tap a slot). Order within a slot: starter, second, third string.' : ''}</div></div>
    <div class="actions"><a class="btn" href="/depth">All charts</a><button onclick="window.print()">Print / PDF</button>
      ${edit ? html`<label class="check"><input type="checkbox" id="vis" ${c.visible_to_players ? raw('checked') : ''}> Players can see</label><button id="copy">Copy to next week</button><button class="danger" id="del">Delete</button><button class="primary" id="save" disabled>Save changes</button>` : ''}</div></div>
  <div class="grid ${edit ? 'g-side' : ''}">
    <div id="fieldbox"></div>
    ${edit ? html`<div class="stack"><div class="card"><div class="hd"><h3>Not on the chart</h3><span class="r faint" style="font-size:12px">${UNIT[c.unit]} players on this team</span></div><div class="bd" id="pool"></div></div>
      <div class="card"><div class="hd"><h3>Versions</h3></div><ul class="list">${history.map((h) => html`<li class="click ${h.id === id ? 'type-practice' : ''}" onclick="__navigate('/depth/${h.id}')"><span class="grow">${h.week_label}</span><span class="s">${ago(h.updated_at)}</span></li>`)}</ul></div></div>` : ''}
  </div>`);
  draw();
  if (!edit) return;
  const move = (pid, from, to, beforePid) => {
    if (from) slots[from] = slots[from].filter((x) => x !== pid);
    if (to) {
      slots[to] = (slots[to] || []).filter((x) => x !== pid);
      const idx = beforePid ? slots[to].indexOf(Number(beforePid)) : -1;
      if (idx >= 0) slots[to].splice(idx, 0, pid); else slots[to].push(pid);
    }
    dirty = true; draw();
  };
  el.addEventListener('dragstart', (e) => { const cd = e.target.closest('.pcard'); if (!cd) return; e.dataTransfer.setData('text/plain', JSON.stringify({ pid: Number(cd.dataset.pid), from: cd.dataset.from })); });
  el.addEventListener('dragover', (e) => { const s = e.target.closest('[data-slot]'); if (s) { e.preventDefault(); $$('.slot.drop', el).forEach((x) => x.classList.remove('drop')); s.classList.add('drop'); } });
  el.addEventListener('drop', (e) => {
    const s = e.target.closest('[data-slot]'); if (!s) return; e.preventDefault();
    const d = JSON.parse(e.dataTransfer.getData('text/plain') || '{}'); const before = e.target.closest('.pcard')?.dataset.pid;
    move(d.pid, d.from, s.dataset.slot, before && Number(before) !== d.pid ? before : null);
  });
  el.addEventListener('click', (e) => {
    const cd = e.target.closest('.pcard'); const s = e.target.closest('[data-slot]');
    if (cd && (!picked || picked.pid !== Number(cd.dataset.pid))) {
      if (picked && s && s.dataset.slot) { move(picked.pid, picked.slot, s.dataset.slot, cd.dataset.pid); picked = null; return; }
      picked = { pid: Number(cd.dataset.pid), slot: cd.dataset.from }; draw(); return;
    }
    if (picked && s) { move(picked.pid, picked.slot, s.dataset.slot || null); picked = null; return; }
    if (cd) { picked = null; draw(); }
  });
  $('#save', el).onclick = async () => { try { await api.put(`/api/depth/${id}`, { slots }); dirty = false; toast('Depth chart saved; moves recorded'); draw(); } catch (err) { errToast(err); } };
  $('#vis', el).onchange = async (e) => { await api.put(`/api/depth/${id}`, { visible_to_players: e.target.checked }); toast(e.target.checked ? 'Players on this team can now see it' : 'Hidden from players'); };
  $('#copy', el).onclick = async () => {
    const m = c.week_label.match(/(\d{4}-\d{2}-\d{2})/);
    const next = m ? `Week of ${new Date(new Date(m[1] + 'T00:00').getTime() + 7 * 864e5).toISOString().slice(0, 10)}` : `${c.week_label} (copy)`;
    const r = await api.post('/api/depth', { team_id: c.team_id, unit: c.unit, week_label: next, copy_from: id, visible_to_players: c.visible_to_players });
    ctx.navigate(`/depth/${r.id}`);
  };
  $('#del', el).onclick = async () => { if (await confirmDialog('Delete this depth chart version?', { danger: true, ok: 'Delete' })) { await api.del(`/api/depth/${id}`); ctx.navigate('/depth'); } };
  window.onbeforeunload = () => (dirty ? 'unsaved' : undefined);
}
