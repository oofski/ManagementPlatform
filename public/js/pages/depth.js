// Module 4 (PLR-8..12): depth charts. Two views, as coaching tools use them:
//  - Board: positions as rows, ranked strings as columns; drag (or tap) chips between cells and the player pool.
//  - Field: a formation diagram showing the starter and depth count at each spot.
import { api } from '../api.js';
import { html, set, $, $$, on, modal, toast, errToast, formData, options, field, empty, UNIT, mondayOf, todayISO, confirmDialog, raw, ago, esc, tabs } from '../ui.js';
import { icon } from '../icons.js';

const POS_NAME = {
  'WR-X': 'Split end', 'WR-S': 'Slot', 'WR-Z': 'Flanker', TE: 'Tight end', LT: 'Left tackle', LG: 'Left guard', C: 'Center', RG: 'Right guard', RT: 'Right tackle', QB: 'Quarterback', RB: 'Running back',
  'DE-L': 'Left end', 'DT-L': '3-tech', 'DT-R': 'Nose', 'DE-R': 'Right end', WLB: 'Will', MLB: 'Mike', SLB: 'Sam', 'CB-L': 'Left corner', 'CB-R': 'Right corner', FS: 'Free safety', SS: 'Strong safety',
  K: 'Kicker', P: 'Punter', LS: 'Long snapper', H: 'Holder', KR: 'Kick returner', PR: 'Punt returner', 'GUN-L': 'Gunner', 'GUN-R': 'Gunner',
};
// Formation diagram coordinates on a 100 x 60 field (x, y). Spaced so labels never collide.
const SPOTS = {
  offense: { 'WR-X': [8, 30], 'WR-S': [19, 34], LT: [30, 30], LG: [40, 30], C: [50, 30], RG: [60, 30], RT: [70, 30], TE: [80, 30], 'WR-Z': [93, 34], QB: [50, 42], RB: [50, 53], los: 26 },
  defense: { 'CB-L': [8, 30], 'DE-L': [30, 40], 'DT-L': [43, 40], 'DT-R': [57, 40], 'DE-R': [70, 40], 'CB-R': [92, 30], WLB: [32, 25], MLB: [50, 24], SLB: [68, 25], FS: [37, 9], SS: [63, 11], los: 45 },
  special: { 'GUN-L': [8, 34], LS: [50, 34], 'GUN-R': [92, 34], H: [50, 43], K: [40, 51], P: [60, 51], KR: [40, 9], PR: [60, 9], los: 30 },
};
const RANKS = ['Starter', '2nd', '3rd', '4th'];
const lastName = (n) => n.split(' ').slice(-1)[0];

export default async function depth(el, ctx) {
  if (ctx.params.id) return chart(el, ctx, Number(ctx.params.id));
  const [charts, st] = await Promise.all([api.get('/api/depth'), api.get('/api/structure')]);
  const teams = st.levels.flatMap((l) => l.teams.map((t) => ({ id: t.id, label: t.name === l.name ? t.name : `${l.name} ${t.name}` })));
  const edit = ctx.me.caps['depth.edit'];
  const groups = {};
  for (const c of charts) (groups[c.team_id] ||= {})[c.unit] ||= c; // newest first from the API
  set(el, html`<div class="page-head"><div><h1>Depth charts</h1><div class="sub">${edit ? 'One chart per team and unit for each game week. Copy last week and adjust.' : 'Depth charts your coaches have shared with you.'}</div></div>
    <div class="actions">${edit ? html`<button class="primary" id="new">${icon('plus', 14)} New chart</button>` : ''}</div></div>
    ${Object.keys(groups).length ? html`<div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th>Team</th>${['offense', 'defense', 'special'].map((u) => html`<th>${UNIT[u]}</th>`)}</tr></thead><tbody>
      ${Object.entries(groups).map(([tid, units]) => html`<tr><td><b>${teams.find((t) => t.id === Number(tid))?.label || 'Team'}</b></td>${['offense', 'defense', 'special'].map((u) => html`<td>${units[u] ? html`<a href="/depth/${units[u].id}">${units[u].week_label}</a> <span class="faint s">· ${ago(units[u].updated_at)}</span>${edit && !units[u].visible_to_players ? html` <span class="badge">Coaches only</span>` : ''}` : html`<span class="faint">—</span>`}</td>`)}</tr>`)}
    </tbody></table></div></div>` : html`<div class="card">${empty(edit ? 'No depth charts yet. Create one to start.' : 'No depth charts have been shared with you.')}</div>`}`);
  if (!edit) return;
  $('#new', el).onclick = () => newChart(ctx, teams, charts);
  if (ctx.query.new) newChart(ctx, teams, charts, { unit: ctx.query.new, team_id: ctx.query.team });
}

function newChart(ctx, teams, charts, preset = {}) {
  modal({
    title: 'New depth chart',
    body: html`<form id="nf"><div class="fields">${field('Team', html`<select name="team_id">${options(teams.map((t) => [t.id, t.label]), preset.team_id)}</select>`)}${field('Unit', html`<select name="unit">${options(Object.entries(UNIT), preset.unit)}</select>`)}</div>
      ${field('Week', html`<input name="week_label" value="Week of ${mondayOf(todayISO())}">`)}
      ${field('Start from', html`<select name="copy_from">${options(charts.map((c) => [c.id, `${teams.find((t) => t.id === c.team_id)?.label} · ${UNIT[c.unit]} · ${c.week_label}`]), preset.copy_from ?? '', { blank: 'Empty chart' })}</select>`, 'Copy an earlier week to start from it.')}
      <label class="check"><input type="checkbox" name="visible_to_players"> Players on this team can see it</label></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#nf')); const res = await api.post('/api/depth', { ...f, copy_from: f.copy_from || null }); ctx.navigate(`/depth/${res.id}`); } }],
  });
}

async function chart(el, ctx, id) {
  const [c, all, players, st] = await Promise.all([api.get(`/api/depth/${id}`), api.get('/api/depth'), ctx.me.caps.staff ? api.get('/api/players') : Promise.resolve([]), api.get('/api/structure')]);
  const edit = ctx.me.caps['depth.edit'];
  const teams = st.levels.flatMap((l) => l.teams.map((t) => ({ id: t.id, label: t.name === l.name ? t.name : `${l.name} ${t.name}` })));
  const teamLabel = teams.find((t) => t.id === c.team_id)?.label || '';
  const slots = JSON.parse(JSON.stringify(c.slots));
  const order = c.layout.map(([s]) => s);
  for (const s of order) slots[s] ||= [];
  const cards = { ...c.cards };
  for (const p of players) cards[p.id] = { ...(cards[p.id] || { id: p.id, name: p.name, jersey: p.jersey, class_year: p.class_year, availability: p.availability, weight: p.weight }), positions: p.positions };
  const history = all.filter((x) => x.team_id === c.team_id && x.unit === c.unit);
  const latestByUnit = Object.fromEntries(['offense', 'defense', 'special'].map((u) => [u, all.find((x) => x.team_id === c.team_id && x.unit === u)]));
  let dirty = false; let picked = null; let view = ctx.query.view === 'field' ? 'field' : 'board'; let hl = null; let poolQ = ''; let poolPos = '';
  ctx.setTitle(`${teamLabel} · ${UNIT[c.unit]}`);
  const used = () => new Set(Object.values(slots).flat());
  const pool = () => players.filter((p) => p.team_id === c.team_id && !used().has(p.id) && (!poolQ || p.name.toLowerCase().includes(poolQ) || String(p.jersey) === poolQ) && (!poolPos || p.positions.includes(poolPos)))
    .sort((a, b) => (a.units.includes(c.unit) === b.units.includes(c.unit) ? (a.jersey ?? 99) - (b.jersey ?? 99) : a.units.includes(c.unit) ? -1 : 1));
  const meta = (p) => [p.class_year ? `'${String(p.class_year).slice(2)}` : null, p.positions?.join('/'), p.weight ? `${p.weight} lb` : null, p.avg_rating ? `${p.avg_rating} avg` : null].filter(Boolean).join(' · ');
  const chip = (pid, slot, idx) => {
    const p = cards[pid]; if (!p) return '';
    return html`<div class="chip ${idx === 0 && slot ? 'starter' : ''} ${picked && picked.pid === pid ? 'sel' : ''}" draggable="${edit ? 'true' : 'false'}" data-pid="${pid}" data-from="${slot || ''}" title="${p.name}">
      <span class="num">${p.jersey ?? '–'}</span><span class="nm"><b>${lastName(p.name)}, ${p.name.split(' ')[0][0]}.</b><small>${meta(p)}</small></span>
      ${p.availability && p.availability !== 'available' ? html`<span class="flag ${p.availability}" title="${p.availability}"></span>` : ''}</div>`;
  };
  const board = () => html`<div class="card"><div class="bd flush tbl-wrap"><table class="dc-table"><thead><tr><th>Position</th>${RANKS.map((r, i) => html`<th class="rank${i + 1}">${r}</th>`)}</tr></thead><tbody>
    ${order.map((s) => html`<tr data-row="${s}" class="${hl === s ? 'hl' : ''}"><td class="pos"><b>${s}</b><span>${POS_NAME[s] || ''}</span></td>
      ${RANKS.map((_, i) => { const pid = slots[s][i]; return html`<td class="rank${i + 1}"><div class="dc-cell ${pid ? '' : 'empty-slot'}" data-slot="${s}" data-idx="${i}">${pid ? chip(pid, s, i) : 'Empty'}</div></td>`; })}</tr>`)}
    </tbody></table></div></div>`;
  const fieldSvg = () => {
    const spots = SPOTS[c.unit];
    const lines = Array.from({ length: 15 }, (_, i) => `<line x1="0" x2="100" y1="${i * 5}" y2="${i * 5}" stroke="rgba(255,255,255,.14)" stroke-width=".2"/>`).join('');
    const nodes = order.filter((s) => spots[s]).map((s) => {
      const [x, y] = spots[s]; const list = slots[s]; const p = cards[list[0]];
      const nm = p ? esc(lastName(p.name).slice(0, 10)) : 'Open';
      return `<g class="pos-node" data-node="${s}"><circle class="ring" cx="${x}" cy="${y}" r="2.6" fill="${p ? '#fff' : 'transparent'}" stroke="rgba(255,255,255,.85)" stroke-width=".35" ${p ? '' : 'stroke-dasharray=".8 .6"'}/>
        <text x="${x}" y="${y + 0.7}" text-anchor="middle" font-size="1.85" font-weight="700" fill="#17171a" font-family="Inter,Arial">${p?.jersey ?? ''}</text>
        <text x="${x}" y="${y + 5}" text-anchor="middle" font-size="1.9" font-weight="600" fill="#fff" font-family="Inter,Arial">${nm}</text>
        <text x="${x}" y="${y + 7.4}" text-anchor="middle" font-size="1.45" fill="rgba(255,255,255,.7)" font-family="Inter,Arial">${esc(s)}${list.length > 1 ? ` · +${list.length - 1}` : ''}</text></g>`;
    }).join('');
    const ys = Object.entries(spots).filter(([k]) => k !== 'los').map(([, v]) => v[1]);
    const top = Math.max(0, Math.min(...ys, spots.los) - 7); const h = Math.max(...ys) + 10 - top;
    return `<svg viewBox="0 ${top} 100 ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Formation view"><rect y="${top}" width="100" height="${h}" fill="#2d5e3d"/>${lines}<line x1="0" x2="100" y1="${spots.los}" y2="${spots.los}" stroke="rgba(255,255,255,.55)" stroke-width=".3" stroke-dasharray="1 .7"/>${nodes}</svg>`;
  };
  const draw = () => {
    set($('#main', el), view === 'board' ? board() : html`<div class="fieldview">${raw(fieldSvg())}</div><p class="help">Select a position to see its full depth on the board.</p>`);
    if (edit) {
      const list = pool();
      set($('#poolbox', el), list.length ? list.map((p) => chip(p.id, '', 0)) : html`<div class="empty">No other players${poolQ || poolPos ? ' match' : ''}.</div>`);
    }
    $$('[data-view]', el).forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    if ($('#save', el)) { $('#save', el).disabled = !dirty; $('#save', el).textContent = dirty ? 'Save changes' : 'Saved'; }
  };
  const codes = [...new Set(st.positions.filter((p) => p.unit === c.unit).map((p) => p.code))];
  set(el, html`<div class="page-head"><div><h1>${teamLabel} depth chart</h1><div class="sub">${c.week_label}${edit ? (c.visible_to_players ? ' · visible to players on this team' : ' · coaches only') : ''}</div></div>
    <div class="actions">
      <div class="seg"><button data-view="board">${icon('list', 14)} Board</button><button data-view="field">${icon('field', 14)} Field</button></div>
      <select id="ver" style="width:auto" aria-label="Week">${options(history.map((h) => [h.id, h.week_label]), id)}</select>
      ${edit ? html`<button id="more">Options</button>` : ''}
      <button id="print">${icon('printer', 14)} Print</button><button id="fbpdf" title="Opens the print dialog; choose Save as PDF">${icon('download', 14)} Export PDF</button>
      ${edit ? html`<button class="primary" id="save" disabled>Saved</button>` : ''}
    </div></div>
  ${ctx.me.caps.staff ? tabs(['offense', 'defense', 'special'].map((u) => [u, UNIT[u], latestByUnit[u] ? `/depth/${latestByUnit[u].id}` : `/depth?new=${u}&team=${c.team_id}`]), c.unit) : ''}
  <div class="${edit ? 'depth-board' : ''}">
    <div id="main"></div>
    ${edit ? html`<aside class="card"><div class="hd"><h3>Available players</h3><span class="r faint s">Drag onto the board</span></div>
      <div class="bd" style="padding:8px 8px 0"><div class="inline-input"><input type="search" id="pq" placeholder="Name or number"><select id="pp" style="max-width:96px" aria-label="Position"><option value="">All</option>${options(codes)}</select></div></div>
      <div class="pool" id="poolbox" data-slot=""></div></aside>` : ''}
  </div>`);
  draw();
  on(el, 'click', '[data-view]', (e, b) => { view = b.dataset.view; draw(); });
  on(el, 'click', '[data-node]', (e, g) => { hl = g.dataset.node; view = 'board'; draw(); setTimeout(() => $(`[data-row="${hl}"]`, el)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30); });
  $('#ver', el).onchange = (e) => ctx.navigate(`/depth/${e.target.value}`);
  $('#print', el).onclick = () => window.print();
  // F-2: PDF export uses the same print view; the document title becomes the PDF file name.
  $('#fbpdf', el).onclick = () => { const t = document.title; document.title = `Depth chart - ${(ctx.me.program?.name || '').trim()} - ${$('h1', el)?.textContent || ''}`.trim(); window.print(); setTimeout(() => { document.title = t; }, 500); };
  if (!edit) return;
  $('#pq', el).oninput = (e) => { poolQ = e.target.value.trim().toLowerCase(); draw(); };
  $('#pp', el).onchange = (e) => { poolPos = e.target.value; draw(); };
  const move = (pid, from, to, idx) => {
    if (from) slots[from] = slots[from].filter((x) => x !== pid);
    if (to) {
      slots[to] = slots[to].filter((x) => x !== pid);
      slots[to].splice(Math.min(idx ?? slots[to].length, slots[to].length), 0, pid);
    }
    dirty = true; picked = null; draw();
  };
  el.addEventListener('dragstart', (e) => { const cd = e.target.closest('.chip'); if (!cd) return; cd.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', JSON.stringify({ pid: Number(cd.dataset.pid), from: cd.dataset.from })); });
  el.addEventListener('dragend', () => $$('.dragging, .drop', el).forEach((x) => x.classList.remove('dragging', 'drop')));
  el.addEventListener('dragover', (e) => { const t = e.target.closest('.dc-cell, .pool'); if (!t) return; e.preventDefault(); $$('.drop', el).forEach((x) => x !== t && x.classList.remove('drop')); t.classList.add('drop'); });
  el.addEventListener('drop', (e) => {
    const t = e.target.closest('.dc-cell, .pool'); if (!t) return; e.preventDefault();
    const d = JSON.parse(e.dataTransfer.getData('text/plain') || '{}');
    if (t.classList.contains('pool')) move(d.pid, d.from, null); else move(d.pid, d.from, t.dataset.slot, Number(t.dataset.idx));
  });
  // Tap to move (touch): tap a chip, then tap a cell or the pool.
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-view], [data-node], button, select, input')) return;
    const cd = e.target.closest('.chip'); const cell = e.target.closest('.dc-cell'); const pl = e.target.closest('.pool');
    if (picked && cell && (!cd || Number(cd.dataset.pid) !== picked.pid)) { move(picked.pid, picked.from, cell.dataset.slot, Number(cell.dataset.idx)); return; }
    if (picked && pl && !cd) { move(picked.pid, picked.from, null); return; }
    if (cd) { const pid = Number(cd.dataset.pid); picked = picked && picked.pid === pid ? null : { pid, from: cd.dataset.from }; draw(); }
  });
  $('#save', el).onclick = async () => { try { await api.put(`/api/depth/${id}`, { slots }); dirty = false; toast('Depth chart saved'); draw(); } catch (err) { errToast(err); } };
  $('#more', el).onclick = () => {
    const m = modal({ title: 'Chart options', body: html`<label class="check" style="margin-bottom:14px"><input type="checkbox" id="vis" ${c.visible_to_players ? raw('checked') : ''}> Players on this team can see this chart</label>
      <div class="row"><button id="copy">${icon('plus', 14)} Copy to next week</button><button class="danger" id="del">Delete this version</button></div>`, actions: [{ label: 'Close' }] });
    m.root.querySelector('#vis').onchange = async (e) => { await api.put(`/api/depth/${id}`, { visible_to_players: e.target.checked }); c.visible_to_players = e.target.checked; toast(e.target.checked ? 'Visible to players on this team' : 'Hidden from players'); };
    m.root.querySelector('#copy').onclick = async () => {
      const mm = c.week_label.match(/(\d{4}-\d{2}-\d{2})/);
      const next = mm ? `Week of ${new Date(new Date(mm[1] + 'T00:00').getTime() + 7 * 864e5).toISOString().slice(0, 10)}` : `${c.week_label} (copy)`;
      if (dirty) await api.put(`/api/depth/${id}`, { slots });
      const r = await api.post('/api/depth', { team_id: c.team_id, unit: c.unit, week_label: next, copy_from: id, visible_to_players: c.visible_to_players });
      m.close(); ctx.navigate(`/depth/${r.id}`);
    };
    m.root.querySelector('#del').onclick = async () => { m.close(); if (await confirmDialog('Delete this depth chart version?', { danger: true, ok: 'Delete' })) { await api.del(`/api/depth/${id}`); ctx.navigate('/depth'); } };
  };
  window.onbeforeunload = () => (dirty ? 'unsaved' : undefined);
}
