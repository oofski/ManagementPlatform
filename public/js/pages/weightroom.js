// Weight room v2 screens used by pages/weights.js: block builder (C-6) with group and athlete layers (C-7), dated and
// dateless programs (C-8), exercise library (C-9), templates and position-group assignment (C-10, F-1), game week (F-5),
// testing battery, norms, composite and comparison (F-6, F-7, F-9), leaderboards (C-16), wellness dashboard (C-18),
// reports with CSV and print (C-21) and the weekly email (C-22).
import { api } from '../api.js';
import { html, set, $, $$, on, modal, toast, errToast, formData, options, checked, field, audienceField, wireAudience, fmtDate, todayISO, cap, empty, bar,
  confirmDialog, lineChart, legend, raw, availBadge, addDaysISO, parseCSV } from '../ui.js';
import { icon } from '../icons.js';

let META = null;
export async function meta(force = false) { if (!META || force) META = await api.get('/api/strength/meta'); return META; }
const clone = (x) => JSON.parse(JSON.stringify(x));
const MODE = { dated: 'Dated', dateless: 'Dateless (in order)', game_week: 'Game week (scales to the game)' };
const KIND = { lift: 'Lifting block', conditioning: 'Conditioning plan' };
const layerBadge = (x) => (x.layer === 'athlete' ? html`<span class="badge warn">Athlete change</span>` : x.layer === 'group' ? html`<span class="badge blue">${x.layer_label || 'Group change'}</span>` : '');
const prescription = (x) => [`${x.sets} × ${x.reps || ''}`, x.pct ? `${x.pct}%` : '', x.rpe ? `RPE ${x.rpe}` : '', x.load ? `${x.load} lb` : '', x.rest ? `rest ${x.rest}` : ''].filter(Boolean).join(' · ');
export const flagAvail = (p) => (p && p.availability && !['available', 'full', 'cleared'].includes(p.availability) ? html` ${availBadge(p.availability)}` : '');
const groupTokenOptions = (m, st) => [
  ...m.groups.map((g) => [`pg:${g}`, `${g} group`]),
  ...(st ? [...new Set(st.positions.map((p) => p.code))].map((c) => [`pos:${c}`, `${c} position`]) : []),
  ...m.teams.map((t) => [`team:${t.id}`, t.name]),
  ['unit:offense', 'Offense'], ['unit:defense', 'Defense'], ['unit:special', 'Special teams'],
];
const exerciseSelect = (name, exs, sel, blank) => html`<select name="${name}">${blank !== undefined ? html`<option value="">${blank}</option>` : ''}${Object.entries(exs.reduce((g, e) => { (g[e.category || 'Other'] ||= []).push(e); return g; }, {}))
  .map(([c, list]) => html`<optgroup label="${c}">${options(list.map((e) => [e.id, e.name]), sel)}</optgroup>`)}</select>`;

// ---------- exercise picker (search across the 600+ library) ----------
export function pickExercise(exs, { title = 'Choose an exercise', current } = {}) {
  return new Promise((resolve) => {
    const cats = [...new Set(exs.map((e) => e.category || 'Other'))].sort();
    let done = false;
    const m = modal({ title, wide: true, body: html`<div class="filters"><input type="search" id="pq" placeholder="Search ${exs.length} exercises" autocomplete="off"><select id="pc"><option value="">All categories</option>${options(cats)}</select></div><ul class="list wr-pick" id="pl"></ul>`,
      actions: [{ label: 'Cancel' }] });
    const draw = () => {
      const q = $('#pq', m.root).value.trim().toLowerCase(); const c = $('#pc', m.root).value;
      const words = q.split(/\s+/).filter(Boolean);
      const list = exs.filter((e) => (!c || (e.category || 'Other') === c) && words.every((w) => e.name.toLowerCase().includes(w))).slice(0, 80);
      set($('#pl', m.root), list.length ? list.map((e) => html`<li class="click ${e.id === current ? 'on' : ''}" data-id="${e.id}"><div class="grow"><div class="t">${e.name}${e.custom ? html` <span class="badge">Custom</span>` : ''}</div><div class="s">${[e.category, e.equipment].filter(Boolean).join(' · ')}</div></div></li>`) : empty('No matches'));
    };
    $('#pq', m.root).addEventListener('input', draw); $('#pc', m.root).addEventListener('change', draw);
    on(m.root, 'click', 'li[data-id]', (e, li) => { done = true; m.close(); resolve(exs.find((x) => x.id === Number(li.dataset.id))); });
    new MutationObserver((_, obs) => { if (!document.body.contains(m.root)) { obs.disconnect(); if (!done) resolve(null); } }).observe(document.body, { childList: true });
    draw();
  });
}

// ---------- C-6 block builder ----------
export async function builder(el, ctx, id) {
  const [p, exs, auds, m, st] = await Promise.all([api.get(`/api/wt-programs/${id}`), api.get('/api/exercises'), api.get('/api/audiences'), meta(), api.get('/api/structure')]);
  ctx.setTitle(p.name);
  const exById = new Map(exs.map((e) => [e.id, e]));
  let days = clone(p.days); let weeks = p.weeks;
  let week = Math.min(Number(ctx.query.week) || 1, Math.max(1, weeks));
  const undo = []; let dirty = false; let pending = null;
  const state = () => JSON.stringify({ days, weeks });
  const snap = (s = state()) => { undo.push(s); if (undo.length > 80) undo.shift(); dirty = true; };
  const sortDays = () => days.sort((a, b) => a.week - b.week || a.day - b.day);
  const renumber = (w) => days.filter((d) => d.week === w).forEach((d, i) => { d.day = i + 1; });
  const mut = (fn) => { snap(); fn(); sortDays(); draw(); };
  const doUndo = () => { const s = undo.pop(); if (!s) return; ({ days, weeks } = JSON.parse(s)); week = Math.min(week, weeks); draw(); toast('Undone'); };
  sortDays();

  set(el, html`<div class="page-head"><div><h1>${p.name}</h1><div class="sub">${p.is_template ? 'Template · ' : ''}${MODE[p.meta.mode]} · ${KIND[p.meta.kind]}. Loads set as % of max follow each athlete's training max.</div></div>
    <div class="actions"><a class="btn" href="/weights?tab=programs">Programs</a><button id="undo" title="Undo (Ctrl+Z)">Undo</button><button class="danger" id="del">Delete</button>${!p.is_template ? html`<button id="assign">Assign</button>` : html`<button id="use">Use template</button>`}<button class="primary" id="save">Save</button></div></div>
    <div class="grid g-side"><div>
      <div class="filters"><div class="seg" id="wk"></div><span class="spacer"></span><span id="dirty" class="badge warn" hidden>Unsaved changes</span>
        <button class="sm" id="addday">${icon('plus', 14)} Add day</button><button class="sm" id="copywk">Copy week</button><button class="sm" id="addwk">Add week</button><button class="sm ghost danger" id="delwk">Delete week</button></div>
      <p class="help" style="margin:-4px 0 10px">Drag the handle to reorder exercises or move them between days; drag a day's handle to reorder days. On a tablet use the arrow buttons.</p>
      <div id="days"></div></div>
    <div class="stack">
      <div class="card"><div class="hd"><h3>Program</h3></div><div class="bd"><form id="pf">${field('Name', html`<input name="name" value="${p.name}">`)}
        <div class="fields">${field('Type', html`<select name="kind">${options(Object.entries(KIND), p.meta.kind)}</select>`)}${field('Schedule', html`<select name="mode">${options(Object.entries(MODE), p.meta.mode)}</select>`)}</div>
        <div class="fields">${field('Phase', html`<select name="phase">${options(Object.entries(m.phases), p.meta.phase || '', { blank: 'Any' })}</select>`)}${field('Position group', html`<select name="position_group">${options(m.groups, p.meta.position_group || '', { blank: 'All' })}</select>`)}</div>
        ${field('Description', html`<textarea name="description">${p.description || ''}</textarea>`)}<label class="check"><input type="checkbox" name="is_template" ${checked(p.is_template)}> Template</label></form>
        <p class="help">Dated: day N of week W is due on the start date plus W−1 weeks and N−1 days. Dateless: athletes work through the days in order and the next session is the first one not finished. Game week: volume drops as the next game gets closer and the day before is an activation lift.</p></div></div>
      ${!p.is_template ? html`<div class="card"><div class="hd"><h3>Assigned to</h3></div>${p.assignments.length ? html`<ul class="list">${p.assignments.map((a) => html`<li style="flex-wrap:wrap"><div class="grow"><div class="t">${a.audience_labels.join(', ')}</div><div class="s">${p.meta.mode === 'dateless' ? 'Dateless' : `Starts ${fmtDate(a.start_date)}`} · ${a.group_overrides} group, ${a.athlete_overrides} athlete changes</div></div>
        <span class="row" style="gap:4px"><button class="sm" data-gov="${a.id}">Group changes</button><button class="sm" data-ov="${a.id}">Athlete changes</button><button class="sm" data-res="${a.id}">Resolved plan</button><button class="sm ghost danger" data-una="${a.id}" aria-label="Remove assignment">${icon('x', 14)}</button></span></li>`)}</ul>` : empty('Not assigned yet.')}</div>` : ''}
    </div></div>`);
  const dEl = $('#days', el);
  const usedIds = () => [...new Set(days.flatMap((d) => d.exercises.map((x) => Number(x.exercise_id))))];
  function draw() {
    $('#dirty', el).hidden = !dirty; $('#undo', el).disabled = !undo.length;
    set($('#wk', el), Array.from({ length: weeks }, (_, i) => html`<button class="${i + 1 === week ? 'on' : ''}" data-w="${i + 1}">Week ${i + 1}</button>`));
    const vis = days.map((d, di) => ({ d, di })).filter((x) => x.d.week === week);
    set(dEl, vis.length ? html`<div class="wr-days">${vis.map(({ d, di }) => html`<div class="card wr-day" data-di="${di}"><div class="hd">
        <span class="wr-grip" draggable="true" data-dragday="${di}" title="Drag to reorder days">${icon('grip', 14)}</span><b>Day ${d.day}</b>
        <input data-dk="label" value="${d.label || ''}" placeholder="Label (Lower, Upper…)" style="max-width:200px">
        <span class="r"><button class="sm" data-addx="${di}">${icon('plus', 13)} Exercise</button><button class="sm ghost" data-dupd="${di}">Duplicate</button><button class="sm ghost danger" data-deld="${di}" aria-label="Delete day">${icon('x', 14)}</button></span></div>
      <div class="bd flush tbl-wrap"><table class="wr-rows"><thead><tr><th style="width:24px"></th><th>Exercise</th><th>Sets</th><th>Reps</th><th>% max</th><th>RPE</th><th>Rest</th><th>Notes</th><th></th></tr></thead><tbody data-dropday="${di}">
      ${d.exercises.map((x, xi) => { const e = exById.get(Number(x.exercise_id)); return html`<tr data-xi="${xi}"><td><span class="wr-grip" draggable="true" title="Drag to move">${icon('grip', 14)}</span></td>
        <td><button type="button" class="sm ghost wr-exbtn" data-pick="${xi}" title="Change exercise">${e ? e.name : 'Choose…'}</button>${e?.test_key ? html` <span class="faint" style="font-size:11px">max</span>` : ''}</td>
        <td><input type="number" min="1" data-xk="sets" value="${x.sets}" class="wr-n"></td><td><input data-xk="reps" value="${x.reps || ''}" class="wr-n"></td>
        <td><input type="number" data-xk="pct" value="${x.pct ?? ''}" class="wr-n" placeholder="—"></td><td><input type="number" step="0.5" min="1" max="10" data-xk="rpe" value="${x.rpe ?? ''}" class="wr-n" placeholder="—"></td>
        <td><input data-xk="rest" value="${x.rest || ''}" class="wr-n"></td><td><input data-xk="note" value="${x.note || ''}" placeholder="Note" style="min-width:120px"></td>
        <td class="nowrap"><button class="sm ghost icon" data-mv="-1" aria-label="Move up">${icon('down', 14, 'rot180')}</button><button class="sm ghost icon" data-mv="1" aria-label="Move down">${icon('down', 14)}</button><button class="sm ghost danger icon" data-delx="${xi}" aria-label="Remove">${icon('x', 14)}</button></td></tr>`; })}
      ${!d.exercises.length ? html`<tr class="wr-droprow"><td colspan="9" class="faint">Drop an exercise here or add one.</td></tr>` : ''}
      </tbody></table></div></div>`)}</div>` : empty(`Week ${week} has no days yet. Add a day or copy another week.`));
  }
  draw();
  const keyH = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.target.matches('input, textarea')) { e.preventDefault(); if (document.body.contains(el)) doUndo(); } };
  document.addEventListener('keydown', keyH);
  new MutationObserver((_, obs) => { if (!document.body.contains(el)) { document.removeEventListener('keydown', keyH); obs.disconnect(); } }).observe(document.body, { childList: true, subtree: true });

  $('#undo', el).onclick = doUndo;
  on(el, 'click', '[data-w]', (e, b) => { week = Number(b.dataset.w); draw(); });
  dEl.addEventListener('focusin', (e) => { if (e.target.matches('input')) pending = state(); });
  dEl.addEventListener('change', (e) => {
    const di = Number(e.target.closest('[data-di]')?.dataset.di); const d = days[di]; if (!d) return;
    snap(pending || state()); pending = null;
    if (e.target.dataset.dk) d.label = e.target.value;
    const xi = e.target.closest('[data-xi]')?.dataset.xi;
    if (xi !== undefined && e.target.dataset.xk) { const k = e.target.dataset.xk; const v = e.target.value; d.exercises[Number(xi)][k] = ['reps', 'rest', 'note'].includes(k) ? v : v === '' ? null : Number(v); }
    $('#dirty', el).hidden = false; $('#undo', el).disabled = false;
  });
  on(dEl, 'click', '[data-addx]', async (e, b) => { const ex = await pickExercise(exs); if (ex) mut(() => days[Number(b.dataset.addx)].exercises.push({ exercise_id: ex.id, sets: 3, reps: '8' })); });
  on(dEl, 'click', '[data-pick]', async (e, b) => {
    const d = days[Number(b.closest('[data-di]').dataset.di)]; const x = d.exercises[Number(b.dataset.pick)];
    const ex = await pickExercise(exs, { current: Number(x.exercise_id) }); if (ex) mut(() => { x.exercise_id = ex.id; });
  });
  on(dEl, 'click', '[data-delx]', (e, b) => mut(() => days[Number(b.closest('[data-di]').dataset.di)].exercises.splice(Number(b.dataset.delx), 1)));
  on(dEl, 'click', '[data-mv]', (e, b) => mut(() => {
    const list = days[Number(b.closest('[data-di]').dataset.di)].exercises; const i = Number(b.closest('[data-xi]').dataset.xi); const j2 = i + Number(b.dataset.mv);
    if (j2 >= 0 && j2 < list.length) [list[i], list[j2]] = [list[j2], list[i]];
  }));
  on(dEl, 'click', '[data-deld]', (e, b) => mut(() => { const d = days[Number(b.dataset.deld)]; days.splice(Number(b.dataset.deld), 1); renumber(d.week); }));
  on(dEl, 'click', '[data-dupd]', (e, b) => mut(() => { const d = days[Number(b.dataset.dupd)]; days.push({ ...clone(d), day: days.filter((x) => x.week === d.week).length + 1 }); }));
  $('#addday', el).onclick = () => mut(() => days.push({ week, day: days.filter((d) => d.week === week).length + 1, label: '', exercises: [] }));
  $('#addwk', el).onclick = () => mut(() => { weeks += 1; week = weeks; });
  $('#delwk', el).onclick = async () => { if (weeks <= 1) return toast('A program needs at least one week', 'warn'); if (await confirmDialog(`Delete week ${week} and move later weeks up?`, { danger: true, ok: 'Delete week' })) mut(() => { days = days.filter((d) => d.week !== week); days.forEach((d) => { if (d.week > week) d.week -= 1; }); weeks -= 1; week = Math.min(week, weeks); }); };
  $('#copywk', el).onclick = () => {
    const mm = modal({ title: `Copy week ${week}`, body: html`<form id="cw">${field('Copy to', html`<select name="to">${options([...Array.from({ length: weeks }, (_, i) => i + 1).filter((w) => w !== week).map((w) => [w, `Week ${w}${days.some((d) => d.week === w) ? ' (replace)' : ''}`]), [weeks + 1, `New week ${weeks + 1}`]])}</select>`)}
      ${field('Change % of max by', html`<input type="number" name="bump" value="0" step="1">`, 'For example 2.5 or 5 to progress the loads, or a negative number to deload.')}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Copy week', primary: true, onClick: (r) => { const f = formData(r.querySelector('#cw')); const to = Number(f.to); const bump = Number(f.bump) || 0;
      mut(() => { const src = clone(days.filter((d) => d.week === week)); days = days.filter((d) => d.week !== to); for (const d of src) { d.week = to; for (const x of d.exercises) if (x.pct != null && bump) x.pct = Math.round((x.pct + bump) * 10) / 10; days.push(d); } weeks = Math.max(weeks, to); week = to; }); toast(`Copied to week ${to}`); } }] });
    void mm;
  };
  // drag and drop
  let drag = null;
  dEl.addEventListener('dragstart', (e) => {
    const g = e.target.closest('.wr-grip'); if (!g) return;
    if (g.dataset.dragday !== undefined) drag = { type: 'day', di: Number(g.dataset.dragday) };
    else { const tr = g.closest('[data-xi]'); drag = { type: 'x', di: Number(tr.closest('[data-di]').dataset.di), xi: Number(tr.dataset.xi) }; tr.classList.add('dragging'); }
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'move');
  });
  dEl.addEventListener('dragend', () => { drag = null; $$('.dragging, .drop', dEl).forEach((x) => x.classList.remove('dragging', 'drop')); });
  dEl.addEventListener('dragover', (e) => { if (!drag) return; const t = e.target.closest(drag.type === 'day' ? '.wr-day' : '[data-xi], [data-dropday], .wr-day'); if (!t) return; e.preventDefault(); $$('.drop', dEl).forEach((x) => x.classList.remove('drop')); t.classList.add('drop'); });
  dEl.addEventListener('drop', (e) => {
    if (!drag) return; e.preventDefault();
    const card = e.target.closest('.wr-day'); if (!card) return;
    const tdi = Number(card.dataset.di); const s = drag; drag = null;
    if (s.type === 'day') {
      if (tdi === s.di) return draw();
      mut(() => { const w = days[s.di].week; const list = days.filter((d) => d.week === w); const src = days[s.di]; const tgt = days[tdi]; const rest = list.filter((d) => d !== src); rest.splice(rest.indexOf(tgt), 0, src); rest.forEach((d, i) => { d.day = i + 1; }); });
      return;
    }
    const row = e.target.closest('[data-xi]');
    mut(() => {
      const [item] = days[s.di].exercises.splice(s.xi, 1);
      let txi = row ? Number(row.dataset.xi) : days[tdi].exercises.length;
      if (tdi === s.di && row && s.xi < txi) txi -= 1;
      days[tdi].exercises.splice(Math.min(txi, days[tdi].exercises.length), 0, item);
    });
  });
  $('#save', el).onclick = async () => {
    const f = formData($('#pf', el));
    try {
      await api.put(`/api/wt-programs/${id}`, { name: f.name, description: f.description, is_template: f.is_template, weeks, days, meta: { mode: f.mode, kind: f.kind, phase: f.phase || null, position_group: f.position_group || null, template_key: p.meta.template_key, builtin: p.meta.builtin } });
      dirty = false; undo.length = 0; toast('Program saved'); ctx.reload();
    } catch (err) { errToast(err); }
  };
  $('#del', el).onclick = async () => { if (await confirmDialog('Delete this program and its assignments?', { danger: true, ok: 'Delete' })) { await api.del(`/api/wt-programs/${id}`); ctx.navigate('/weights?tab=programs'); } };
  if ($('#use', el)) $('#use', el).onclick = () => useTemplate(ctx, p, m);
  if ($('#assign', el)) $('#assign', el).onclick = () => { const mm = modal({ title: 'Assign program', wide: true, body: html`<form id="af"><div class="grid g2"><div>${field('Who', audienceField('audience', auds, [], { exclude: ['coaches', 'parents'] }))}</div><div>
      ${field(p.meta.mode === 'dateless' ? 'Available from' : 'Start date', html`<input type="date" name="start_date" value="${todayISO()}">`)}
      ${p.meta.mode !== 'dateless' ? html`${field('Put sessions on the calendar on', html`<div class="row">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => html`<label class="check"><input type="checkbox" name="weekdays" data-multi data-num value="${i}" ${checked(i === 1 || i === 3)}> ${d}</label>`)}</div>`, 'Day 1 of each week goes on the first chosen weekday, day 2 on the second, and so on.')}
      <div class="fields">${field('Time', html`<input type="time" name="time" value="06:45">`)}${field('Minutes', html`<input type="number" name="minutes" value="50">`)}</div>${field('Location', html`<input name="location" value="Weight room">`)}` : html`<p class="help">Dateless programs are not put on the calendar. Each athlete sees their next session.</p>`}</div></div></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Assign', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#af')); const res = await api.post('/api/wt-assignments', { wt_program_id: Number(id), audience: f.audience, start_date: f.start_date, schedule: f.weekdays?.length ? { weekdays: f.weekdays, time: f.time, minutes: f.minutes, location: f.location } : null }); toast(`Assigned${res.events ? `; ${res.events} sessions added to the calendar` : ''}`); ctx.reload(); } }] }); wireAudience(mm.root); };
  on(el, 'click', '[data-una]', async (e, b) => { if (await confirmDialog('Remove this assignment and its future calendar sessions?', { danger: true, ok: 'Remove' })) { await api.del(`/api/wt-assignments/${b.dataset.una}`); ctx.reload(); } });
  on(el, 'click', '[data-gov]', (e, b) => groupChanges(b.dataset.gov, exs, usedIds(), m, st));
  on(el, 'click', '[data-ov]', (e, b) => athleteChanges(b.dataset.ov, exs, usedIds()));
  on(el, 'click', '[data-res]', (e, b) => resolvedPlan(b.dataset.res));
}

async function groupChanges(aid, exs, used, m, st) {
  const ovs = await api.get(`/api/strength/assignments/${aid}/group-overrides`);
  modal({ title: 'Group changes', wide: true, body: html`<p class="muted">Change the master plan for a position group, position, team or unit. Athlete changes still win over group changes.</p>
    ${ovs.length ? html`<div class="tbl-wrap"><table style="margin-bottom:12px"><thead><tr><th>Group</th><th>Exercise</th><th>Change</th><th></th></tr></thead><tbody>${ovs.map((o) => html`<tr><td>${o.group_label}</td><td>${o.exercise_name || 'All exercises'}</td><td>${[o.alt_name ? `→ ${o.alt_name}` : '', o.sets ? `${o.sets} sets` : '', o.reps ? `${o.reps} reps` : '', o.pct ? `${o.pct}%` : '', o.rpe ? `RPE ${o.rpe}` : '', o.note].filter(Boolean).join(' · ')}</td><td><button class="sm ghost danger" data-delg="${o.id}">Remove</button></td></tr>`)}</tbody></table></div>` : ''}
    <form id="gf"><div class="fields">${field('Group', html`<select name="group_token">${options(groupTokenOptions(m, st))}</select>`)}${field('Exercise', html`<select name="exercise_id"><option value="">All exercises</option>${options(used.map((u) => [u, exs.find((e) => e.id === u)?.name]))}</select>`)}</div>
    ${field('Replace with', exerciseSelect('alt_exercise_id', exs, '', 'Keep the exercise'))}
    <div class="fields">${field('Sets', html`<input type="number" name="sets">`)}${field('Reps', html`<input name="reps">`)}${field('% of max', html`<input type="number" name="pct">`)}${field('RPE', html`<input type="number" step="0.5" name="rpe">`)}</div>${field('Note', html`<input name="note">`)}</form>`,
  actions: [{ label: 'Close' }, { label: 'Add group change', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#gf')); await api.post(`/api/strength/assignments/${aid}/group-overrides`, { ...f, exercise_id: f.exercise_id ? Number(f.exercise_id) : null, alt_exercise_id: f.alt_exercise_id ? Number(f.alt_exercise_id) : null }); toast('Group change saved'); } }],
  onOpen: (r, close) => on(r, 'click', '[data-delg]', async (ev, x) => { await api.del(`/api/strength/group-overrides/${x.dataset.delg}`); close(); toast('Removed'); }) });
}
async function athleteChanges(aid, exs, used) {
  const [ovs, players] = await Promise.all([api.get(`/api/wt-assignments/${aid}/overrides`), api.get('/api/players')]);
  modal({ title: 'Athlete changes', wide: true, body: html`<p class="muted">Adjust one athlete's plan on top of the team and group plan, for example an alternate exercise for an injured player.</p>
    ${ovs.length ? html`<div class="tbl-wrap"><table style="margin-bottom:12px"><thead><tr><th>Athlete</th><th>Exercise</th><th>Change</th><th></th></tr></thead><tbody>${ovs.map((o) => html`<tr><td>${o.player_name}</td><td>${o.exercise_name || 'All'}</td><td>${[o.alt_name ? `→ ${o.alt_name}` : '', o.sets ? `${o.sets} sets` : '', o.reps ? `${o.reps} reps` : '', o.pct ? `${o.pct}%` : '', o.note].filter(Boolean).join(' · ')}</td><td><button class="sm ghost danger" data-delo="${o.id}">Remove</button></td></tr>`)}</tbody></table></div>` : ''}
    <form id="of"><div class="fields">${field('Athlete', html`<select name="player_id">${options(players.map((p) => [p.id, `${p.name}${p.availability !== 'available' ? ` (${p.availability})` : ''}`]))}</select>`)}${field('Exercise', html`<select name="exercise_id">${options(used.map((u) => [u, exs.find((e) => e.id === u)?.name]))}</select>`)}</div>
    ${field('Replace with', exerciseSelect('alt_exercise_id', exs, '', 'Keep the exercise'))}
    <div class="fields">${field('Sets', html`<input type="number" name="sets">`)}${field('Reps', html`<input name="reps">`)}${field('% of max', html`<input type="number" name="pct">`)}</div>${field('Note', html`<input name="note">`)}</form>`,
  actions: [{ label: 'Close' }, { label: 'Add change', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#of')); await api.post(`/api/wt-assignments/${aid}/overrides`, { ...f, player_id: Number(f.player_id), exercise_id: Number(f.exercise_id), alt_exercise_id: f.alt_exercise_id ? Number(f.alt_exercise_id) : null }); toast('Saved'); } }],
  onOpen: (r, close) => on(r, 'click', '[data-delo]', async (ev, x) => { await api.del(`/api/wt-overrides/${x.dataset.delo}`); close(); toast('Removed'); }) });
}
async function resolvedPlan(aid, pid) {
  const r = await api.get(`/api/strength/assignments/${aid}/resolved${pid ? `?player_id=${pid}` : ''}`);
  const m = modal({ title: `Resolved plan: ${r.assignment.program_name}`, wide: true, body: html`<div class="filters"><select id="rp">${options(r.roster.map((x) => [x.id, `${x.name}${x.group ? ` · ${x.group}` : ''}${x.overrides ? ' · changed' : ''}${x.availability !== 'available' ? ` · ${x.availability}` : ''}`]), r.player?.id)}</select></div>
    ${r.player ? html`<p class="muted">${r.player.name}${flagAvail(r.player)} · ${r.player.group || 'No group'} · team plan, then group changes, then athlete changes.</p>` : ''}
    <div style="max-height:60vh;overflow-y:auto">${r.days.map((d) => html`<div class="card" style="margin-bottom:8px"><div class="hd"><b>Week ${d.week}, day ${d.day}</b> <span class="muted">${d.label || ''}</span><span class="r s muted">${d.due ? fmtDate(d.due) : ''} ${d.complete ? html`<span class="badge ok">Done</span>` : ''}</span></div>
      <ul class="list">${d.exercises.map((x) => html`<li><div class="grow"><div class="t">${x.name} ${layerBadge(x)}</div><div class="s">${prescription(x)}${x.note ? ` · ${x.note}` : ''}</div></div></li>`)}</ul></div>`)}</div>`, actions: [{ label: 'Close' }] });
  $('#rp', m.root).onchange = (e) => { m.close(); resolvedPlan(aid, e.target.value); };
}

// ---------- programs list + C-10 templates + F-1 + F-5 ----------
export async function programs(el, ctx, head) {
  const list = (await api.get('/api/wt-programs')).filter((p) => !p.is_template);
  set(el, html`${head}<div class="row" style="margin-bottom:12px"><span class="muted">Your programs. Start from a template under Templates to save time.</span><span class="spacer"></span><button class="primary" id="new">New program</button></div>
    <div class="card">${list.length ? html`<ul class="list">${list.map((p) => html`<li class="click" onclick="__navigate('/weights/program/${p.id}')"><div class="grow"><div class="t">${p.name} ${p.kind === 'conditioning' ? html`<span class="badge">Conditioning</span>` : ''} ${p.mode !== 'dated' ? html`<span class="badge blue">${MODE[p.mode]}</span>` : ''}</div><div class="s">${p.weeks} weeks · ${p.days.length} sessions${p.position_group ? ` · ${p.position_group}` : ''}${p.description ? ` · ${p.description}` : ''}</div></div><span class="s">${p.assigned} assignment(s)</span></li>`)}</ul>` : empty('No programs yet.')}</div>`);
  $('#new', el).onclick = () => modal({ title: 'New program', body: html`<form id="nf">${field('Name', html`<input name="name" required>`)}<div class="fields">${field('Weeks', html`<input type="number" name="weeks" value="4" min="1" max="20">`)}${field('Schedule', html`<select name="mode">${options(Object.entries(MODE))}</select>`)}</div>${field('Type', html`<select name="kind">${options(Object.entries(KIND))}</select>`)}${field('Description', html`<input name="description">`)}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#nf')); const res = await api.post('/api/wt-programs', { name: f.name, weeks: f.weeks, description: f.description, days: [{ week: 1, day: 1, label: '', exercises: [] }], meta: { mode: f.mode, kind: f.kind } }); ctx.navigate(`/weights/program/${res.id}`); } }] });
}
async function useTemplate(ctx, t, m) {
  modal({ title: `Use ${t.name}`, body: html`<form id="uf">${field('Name for your copy', html`<input name="name" value="${t.name.replace(/ \(.*\)$/, '')}">`)}${field('Schedule', html`<select name="mode">${options(Object.entries(MODE), t.mode || t.meta?.mode)}</select>`)}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Create my copy', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#uf')); const res = await api.post(`/api/strength/templates/${t.id}/use`, f); ctx.navigate(`/weights/program/${res.id}`); } }] });
  void m;
}
function assignGroup(ctx, t, m) {
  modal({ title: `Assign to a position group`, body: html`<p class="muted">${t.name}. A copy is made for the group and every athlete in it gets the plan now.</p><form id="ag">
    <div class="fields">${field('Position group', html`<select name="group">${options(m.groups, t.position_group || '')}</select>`)}${field('Team', html`<select name="team_id">${options(m.teams.map((x) => [x.id, x.name]), '', { blank: 'All teams' })}</select>`)}</div>
    ${field(t.mode === 'dateless' ? 'Available from' : 'Start date', html`<input type="date" name="start_date" value="${todayISO()}">`)}</form>`,
  actions: [{ label: 'Cancel' }, { label: 'Assign', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#ag')); const res = await api.post('/api/strength/assign-group', { wt_program_id: t.id, group: f.group, team_id: f.team_id ? Number(f.team_id) : null, start_date: f.start_date }); toast(`Assigned to ${res.athletes} athletes`); ctx.navigate(`/weights/program/${res.program_id}`); } }] });
}
export async function templates(el, ctx, head) {
  const [list, m] = await Promise.all([api.get('/api/strength/templates'), meta()]);
  const editor = m.can_edit;
  const card = (t) => html`<div class="card"><div class="hd"><h3>${t.name}</h3><span class="r">${t.kind === 'conditioning' ? html`<span class="badge">Conditioning</span>` : ''}${t.mode === 'game_week' ? html`<span class="badge blue">Game week</span>` : ''}</span></div>
    <div class="bd"><p class="s" style="margin-top:0">${t.description || ''}</p><div class="s muted">${t.weeks} week${t.weeks > 1 ? 's' : ''} · ${t.days_per_week} day${t.days_per_week > 1 ? 's' : ''} a week${t.phase ? ` · ${m.phases[t.phase]}` : ''}${t.position_group ? ` · ${t.position_group}` : ''}${t.builtin ? '' : ' · your template'}</div></div>
    <div class="ft row"><a class="btn sm" href="/weights/program/${t.id}">Preview</a>${editor ? html`<button class="sm" data-use="${t.id}">Use</button><button class="sm primary" data-grp="${t.id}">Assign to group</button>` : ''}</div></div>`;
  const sec = (title, items) => (items.length ? html`<h2 style="margin:18px 0 8px">${title}</h2><div class="grid g3">${items.map(card)}</div>` : '');
  const phaseOrder = ['offseason', 'summer', 'preseason', 'in_season', 'playoffs'];
  const lifts = list.filter((t) => t.kind === 'lift' && !t.position_group).sort((a, b) => phaseOrder.indexOf(a.phase) - phaseOrder.indexOf(b.phase));
  set(el, html`${head}<div class="card" style="margin-bottom:14px"><div class="hd"><h2>Game week</h2><span class="r"><select id="gwt" style="width:auto">${options(m.teams.map((x) => [x.id, x.name]))}</select></span></div><div class="bd" id="gw">Loading…</div></div>
    ${sec('Football programs by phase', lifts)}${sec('Position-group starter blocks', list.filter((t) => t.kind === 'lift' && t.position_group))}${sec('Conditioning plans', list.filter((t) => t.kind === 'conditioning'))}`);
  on(el, 'click', '[data-use]', (e, b) => useTemplate(ctx, list.find((t) => t.id === Number(b.dataset.use)), m));
  on(el, 'click', '[data-grp]', (e, b) => assignGroup(ctx, list.find((t) => t.id === Number(b.dataset.grp)), m));
  const gw = async () => {
    const r = await api.get(`/api/strength/game-week?team_id=${$('#gwt', el).value}`);
    set($('#gw', el), html`<p style="margin-top:0">${r.next_game ? html`Next game: <b>${r.next_game.title}</b>, ${fmtDate(r.next_game.start)}.` : 'No game on the calendar in the next week.'} The game-week template scales each session to the days left.</p>
      <div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Days to the game</th><th>Session</th></tr></thead><tbody>${r.days.map((d) => html`<tr><td>${fmtDate(d.date)}</td><td class="num">${d.days_out ?? '—'}</td><td>${d.activation ? html`<span class="badge blue">Activation</span> ` : ''}${d.label}</td></tr>`)}</tbody></table></div>
      ${editor ? html`<div class="row" style="margin-top:10px"><button class="primary sm" id="gwgo">Assign game week to ${r.team}</button>${r.template_id ? html`<a class="btn sm" href="/weights/program/${r.template_id}">Edit the template</a>` : ''}</div>` : ''}`);
    if ($('#gwgo', el)) $('#gwgo', el).onclick = async () => { try { const res = await api.post('/api/strength/game-week', { team_id: r.team_id }); toast('Game-week lift assigned'); ctx.navigate(`/weights/program/${res.program_id}`); } catch (err) { errToast(err); } };
  };
  $('#gwt', el).onchange = gw; gw().catch(errToast);
}

// ---------- C-9 exercise library ----------
export async function exercises(el, ctx, head) {
  const [list, m] = await Promise.all([api.get('/api/exercises'), meta()]);
  const cats = [...new Set(list.map((e) => e.category || 'Other'))].sort();
  const equip = [...new Set(list.map((e) => e.equipment).filter(Boolean))].sort();
  let limit = 100;
  set(el, html`${head}<div class="filters"><input type="search" id="q" placeholder="Search ${list.length} exercises" value="${ctx.query.q || ''}"><select id="c"><option value="">All categories</option>${options(cats, ctx.query.category)}</select><select id="eq"><option value="">All equipment</option>${options(equip)}</select>
    <label class="check"><input type="checkbox" id="cu"> Custom only</label><span class="spacer"></span>${m.can_edit ? html`<button class="primary" id="new">New exercise</button>` : ''}</div>
    <div class="card"><div class="hd"><h2 id="cnt"></h2></div><div class="bd flush tbl-wrap"><table><thead><tr><th>Exercise</th><th>Category</th><th>Equipment</th><th>Coaching cues</th><th>Max</th><th>Demo</th><th></th></tr></thead><tbody id="rows"></tbody></table></div><div class="ft" id="more"></div></div>`);
  const draw = () => {
    const words = $('#q', el).value.trim().toLowerCase().split(/\s+/).filter(Boolean); const c = $('#c', el).value; const e2 = $('#eq', el).value; const cu = $('#cu', el).checked;
    const rows = list.filter((e) => (!c || (e.category || 'Other') === c) && (!e2 || e.equipment === e2) && (!cu || e.custom) && words.every((w) => e.name.toLowerCase().includes(w)));
    $('#cnt', el).textContent = `${rows.length} exercise${rows.length === 1 ? '' : 's'}`;
    set($('#rows', el), rows.slice(0, limit).map((x) => html`<tr><td><b>${x.name}</b>${x.custom ? html` <span class="badge">Custom</span>` : ''}</td><td>${x.category || ''}</td><td>${x.equipment || ''}</td><td class="s">${x.cues || ''}</td><td>${x.test_key ? m.tests[x.test_key]?.label.replace(' 1RM', '') : ''}</td>
      <td>${x.video_url ? html`<a href="${x.video_url}" target="_blank" rel="noopener">Watch</a>` : ''}</td><td>${m.can_edit ? html`<button class="sm" data-e="${x.id}">Edit</button>` : ''}</td></tr>`));
    set($('#more', el), rows.length > limit ? html`<button class="sm" id="mr">Show ${Math.min(100, rows.length - limit)} more</button>` : '');
    if ($('#mr', el)) $('#mr', el).onclick = () => { limit += 100; draw(); };
  };
  for (const s of ['#q', '#c', '#eq', '#cu']) $(s, el).addEventListener(s === '#q' ? 'input' : 'change', () => { limit = 100; draw(); });
  draw();
  const form = (x = {}) => modal({ title: x.id ? 'Edit exercise' : 'New exercise', body: html`<form id="xf">${field('Name', html`<input name="name" value="${x.name || ''}" required>`)}<div class="fields">${field('Category', html`<input name="category" list="cats" value="${x.category || ''}" placeholder="Lower, Upper, Olympic">`)}${field('Equipment', html`<input name="equipment" list="equips" value="${x.equipment || ''}">`)}</div>
    <datalist id="cats">${options(cats)}</datalist><datalist id="equips">${options(equip)}</datalist>
    ${field('Tied to a tested max', html`<select name="test_key">${options(Object.entries(m.tests).filter(([, t]) => t.rep_test).map(([k, t]) => [k, t.label]), x.test_key || '', { blank: 'None' })}</select>`, 'Loads written as % of max use this max, and logged sets can raise it.')}
    ${field('Coaching cues', html`<textarea name="cues">${x.cues || ''}</textarea>`)}${field('Demo video link', html`<input name="video_url" value="${x.video_url || ''}" placeholder="https://">`)}</form>`,
  actions: [...(x.id ? [{ label: 'Delete', danger: true, onClick: async () => { await api.del(`/api/exercises/${x.id}`); ctx.reload(); } }] : []), { label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#xf')); if (x.id) await api.put(`/api/exercises/${x.id}`, f); else await api.post('/api/exercises', f); ctx.reload(); } }] });
  if ($('#new', el)) $('#new', el).onclick = () => form();
  on(el, 'click', '[data-e]', (e, b) => form(list.find((x) => x.id === Number(b.dataset.e))));
}

// ---------- F-6 / F-7 / F-9 testing ----------
export async function testing(el, ctx, head) {
  const m = await meta();
  const view = ctx.query.view || 'results';
  const seg = html`<div class="seg" style="margin-bottom:12px">${[['results', 'Results and norms'], ['day', 'Testing day'], ['composite', 'Composite score'], ['compare', 'Before and after']].map(([k, l]) => html`<button class="${k === view ? 'on' : ''}" data-view="${k}">${l}</button>`)}</div>`;
  const go = (q) => ctx.navigate('/weights?' + new URLSearchParams({ tab: 'testing', ...Object.fromEntries(Object.entries({ ...ctx.query, ...q }).filter(([k, v]) => v && k !== 'tab')) }));
  const teamSel = (id, v) => html`<select id="${id}"><option value="">All teams</option>${options(m.teams.map((t) => [t.id, t.name]), v)}</select>`;
  const grpSel = (id, v) => html`<select id="${id}"><option value="">All groups</option>${options(m.groups, v)}</select>`;
  const fmtV = (k, v) => (v == null ? '' : m.tests[k]?.unit === 's' ? Number(v).toFixed(2) : v);
  if (view === 'day') return testingDay(el, ctx, head, seg, m, go);
  if (view === 'composite') return composite(el, ctx, head, seg, m, go, teamSel, grpSel);
  if (view === 'compare') return compare(el, ctx, head, seg, m, go, teamSel);
  const key = ctx.query.test || 'forty';
  const [bat, norms] = await Promise.all([api.get(`/api/strength/battery?${new URLSearchParams({ team_id: ctx.query.team || '', group: ctx.query.group || '' })}`), api.get(`/api/strength/norms?test_key=${key}`)]);
  const t = m.tests[key];
  const ref = norms.reference;
  const rows = bat.rows.filter((r) => r.results[key]).sort((a, b) => (t.better === 'lower' ? a.results[key].best - b.results[key].best : b.results[key].best - a.results[key].best));
  const dist = (title, obj, refObj) => html`<div class="card"><div class="hd"><h3>${title}</h3></div><div class="bd flush tbl-wrap"><table><thead><tr><th></th><th class="num">n</th><th class="num">25th</th><th class="num">Median</th><th class="num">75th</th><th class="num">90th</th><th class="num">Reference</th></tr></thead><tbody>
    ${Object.entries(obj).map(([k, d]) => html`<tr><td><b>${title.startsWith('By grade') ? `Grade ${k}` : k}</b></td><td class="num">${d.n}</td><td class="num">${fmtV(key, t.better === 'lower' ? d.p75 : d.p25)}</td><td class="num"><b>${fmtV(key, d.p50)}</b></td><td class="num">${fmtV(key, t.better === 'lower' ? d.p25 : d.p75)}</td><td class="num">${fmtV(key, t.better === 'lower' ? d.p10 : d.p90)}</td><td class="num faint">${refObj?.[k] ?? ''}</td></tr>`)}</tbody></table></div></div>`;
  set(el, html`${head}${seg}<div class="filters"><select id="tk">${options(Object.entries(m.tests).map(([k, x]) => [k, x.label]), key)}</select>${teamSel('tm', ctx.query.team)}${grpSel('gp', ctx.query.group)}<span class="spacer"></span>${m.can_edit ? html`<button id="imp">Import maxes</button>` : ''}</div>
    <div class="grid g-side"><div class="card"><div class="hd"><h2>${t.label} (${t.unit})</h2><span class="r s muted">${t.better === 'lower' ? 'Lower is better' : 'Higher is better'} · percentiles from your program's own results</span></div><div class="bd flush tbl-wrap"><table><thead><tr><th>Athlete</th><th>Group</th><th class="num">Grade</th><th class="num">Latest</th><th class="num">Best</th><th class="num">Grade pct</th><th class="num">Group pct</th><th class="num">Ref. median</th></tr></thead><tbody>
      ${rows.map((r) => { const n = norms.players[r.id] || {}; const lr = r.results[key]; return html`<tr class="click" onclick="__navigate('/development/player/${r.id}')"><td><b>${r.name}</b> <span class="faint">${r.jersey ?? ''}</span>${flagAvail(r)}</td><td>${r.group || ''}</td><td class="num">${r.grade ?? ''}</td>
        <td class="num">${fmtV(key, lr.value)}${lr.reps ? html` <span class="faint" title="Rep test">(${lr.weight}×${lr.reps})</span>` : ''}</td><td class="num"><b>${fmtV(key, lr.best)}</b></td><td class="num">${n.grade_pct ?? ''}</td><td class="num">${n.group_pct ?? ''}</td><td class="num faint">${ref?.by_group?.[r.group] ?? ''}</td></tr>`; })}
    </tbody></table>${!rows.length ? empty('No results for this test yet.') : ''}</div></div>
    <div class="stack">${dist('By grade', norms.by_grade, ref?.by_grade)}${dist('By position group', norms.by_group, ref?.by_group)}
      <p class="help">${ref ? `Reference column: ${ref.label}, an approximate figure for context only.` : ''} Grade comes from class year; position group from the athlete's primary position.</p></div></div>`);
  on(el, 'click', '[data-view]', (e, b) => go({ view: b.dataset.view }));
  $('#tk', el).onchange = (e) => go({ test: e.target.value }); $('#tm', el).onchange = (e) => go({ team: e.target.value }); $('#gp', el).onchange = (e) => go({ group: e.target.value });
  if ($('#imp', el)) $('#imp', el).onclick = () => { let rows2 = []; const mm = modal({ title: 'Import maxes from a spreadsheet', body: html`<p>CSV columns: <span class="mono">name (or jersey), test, value, date</span>. Tests: ${Object.keys(m.tests).join(', ')}.</p><input type="file" accept=".csv" id="f"><p id="n" class="muted"></p>`,
    actions: [{ label: 'Cancel' }, { label: 'Import', primary: true, onClick: async () => { const res = await api.post('/api/tests/import', { rows: rows2 }); toast(`Imported ${res.created}${res.errors.length ? `, ${res.errors.length} skipped` : ''}`); ctx.reload(); } }] });
  mm.root.querySelector('#f').onchange = async (e) => { rows2 = parseCSV(await e.target.files[0].text()); mm.root.querySelector('#n').textContent = `${rows2.length} rows ready`; }; };
}
async function testingDay(el, ctx, head, seg, m, go) {
  const all = { ...m.tests, ...(m.body_view ? m.measures : {}) };
  const picked = (ctx.query.tests || 'forty,ten_split').split(',').filter((k) => all[k]);
  const bat = await api.get(`/api/strength/battery?${new URLSearchParams({ team_id: ctx.query.team || '', group: ctx.query.group || '' })}`);
  set(el, html`${head}${seg}<div class="card" style="margin-bottom:12px"><div class="bd"><div class="row" style="flex-wrap:wrap;gap:12px">${Object.entries(all).map(([k, t]) => html`<label class="check"><input type="checkbox" data-tk="${k}" ${checked(picked.includes(k))}> ${t.label}</label>`)}</div>
    <p class="help">Strength tests take a 1RM, or a weight and reps for a rep test (estimated 1RM by the Epley formula, up to 12 reps). Height and weight go to the coach-only body record and never appear on leaderboards.</p></div></div>
    <div class="filters"><input type="date" id="dt" value="${todayISO()}" style="max-width:170px"><select id="tm"><option value="">All teams</option>${options(m.teams.map((t) => [t.id, t.name]), ctx.query.team)}</select><select id="gp"><option value="">All groups</option>${options(m.groups, ctx.query.group)}</select><span class="spacer"></span>${m.can_edit ? html`<button class="primary" id="savet">Save results</button>` : ''}</div>
    <div class="card"><div class="bd flush tbl-wrap"><table class="wr-entry"><thead><tr><th>Athlete</th>${picked.map((k) => html`<th>${all[k].label} <span class="faint">${all[k].unit}</span></th>`)}</tr></thead><tbody>
    ${bat.rows.map((r) => html`<tr data-pid="${r.id}"><td><b>${r.name}</b> <span class="faint">${r.jersey ?? ''} · ${r.group || ''}</span>${flagAvail(r)}</td>${picked.map((k) => html`<td>${m.tests[k]?.rep_test
      ? html`<div class="inline-input"><input type="number" inputmode="decimal" data-k="${k}" data-f="weight" placeholder="lb" step="5" style="width:74px"><input type="number" inputmode="numeric" data-k="${k}" data-f="reps" placeholder="reps" style="width:58px" title="Leave reps empty or 1 for a true 1RM"></div>`
      : html`<input type="number" inputmode="decimal" step="${all[k].unit === 's' ? '0.01' : '0.5'}" data-k="${k}" data-f="value" placeholder="${r.results[k]?.value ?? all[k].unit}" style="width:90px">`}</td>`)}</tr>`)}</tbody></table></div></div>`);
  on(el, 'click', '[data-view]', (e, b) => go({ view: b.dataset.view }));
  on(el, 'change', '[data-tk]', () => go({ tests: $$('[data-tk]', el).filter((c) => c.checked).map((c) => c.dataset.tk).join(',') || 'forty' }));
  $('#tm', el).onchange = (e) => go({ team: e.target.value }); $('#gp', el).onchange = (e) => go({ group: e.target.value });
  if ($('#savet', el)) $('#savet', el).onclick = async () => {
    const entries = [];
    for (const tr of $$('tr[data-pid]', el)) for (const k of picked) {
      const g = (f) => tr.querySelector(`[data-k="${k}"][data-f="${f}"]`)?.value;
      if (m.tests[k]?.rep_test) { const w = g('weight'); const reps = g('reps'); if (w) entries.push(reps && Number(reps) > 1 ? { player_id: Number(tr.dataset.pid), test_key: k, weight: Number(w), reps: Number(reps) } : { player_id: Number(tr.dataset.pid), test_key: k, value: Number(w) }); }
      else if (g('value')) entries.push({ player_id: Number(tr.dataset.pid), test_key: k, value: Number(g('value')) });
    }
    if (!entries.length) return toast('Enter at least one result', 'warn');
    try { const res = await api.post('/api/strength/testing-day', { date: $('#dt', el).value, entries }); const errs = res.results.filter((x) => x.error); toast(`${res.saved} results saved · ${res.prs} personal record(s)${errs.length ? ` · ${errs.length} skipped: ${errs[0].error}` : ''}`, errs.length ? 'warn' : ''); ctx.reload(); } catch (err) { errToast(err); }
  };
}
async function composite(el, ctx, head, seg, m, go, teamSel, grpSel) {
  const list = await api.get('/api/strength/composites');
  const cid = Number(ctx.query.c || list[0]?.id || 0);
  const sc = cid ? await api.get(`/api/strength/composites/${cid}/scores?${new URLSearchParams({ team_id: ctx.query.team || '', group: ctx.query.group || '' })}`) : null;
  set(el, html`${head}${seg}<div class="filters">${list.length ? html`<select id="cs">${options(list.map((c) => [c.id, c.name]), cid)}</select>` : ''}${teamSel('tm', ctx.query.team)}${grpSel('gp', ctx.query.group)}<span class="spacer"></span>${m.can_edit ? html`${sc ? html`<button id="edc">Edit</button>` : ''}<button class="primary" id="nc">New composite</button>` : ''}</div>
    ${sc ? html`<div class="card"><div class="hd"><h2>${sc.composite.name}</h2><span class="r s muted">${sc.composite.tests.map((t) => `${m.tests[t.key]?.label} ${t.weight}`).join(' · ')}</span></div>
      <div class="bd flush tbl-wrap"><table><thead><tr><th class="num">#</th><th>Athlete</th><th>Group</th><th class="num">Score</th>${sc.composite.tests.map((t) => html`<th class="num">${m.tests[t.key]?.label}</th>`)}<th class="num">Coverage</th></tr></thead><tbody>
      ${sc.rows.map((r, i) => html`<tr><td class="num">${i + 1}</td><td><b>${r.name}</b>${flagAvail(r)}</td><td>${r.group || ''}</td><td class="num"><b>${r.score}</b></td>${sc.composite.tests.map((t) => html`<td class="num">${r.parts[t.key] ? html`${r.parts[t.key].value} <span class="faint">(${r.parts[t.key].pct})</span>` : html`<span class="faint">—</span>`}</td>`)}<td class="num">${r.coverage}%</td></tr>`)}</tbody></table></div>
      <div class="ft s muted">Each test is turned into a percentile within the athletes shown (reversed for timed tests), then averaged with your weights. Missing tests are left out and shown in coverage.</div></div>` : empty('No composite scores yet. Pick tests and weights to make one.')}`);
  on(el, 'click', '[data-view]', (e, b) => go({ view: b.dataset.view }));
  if ($('#cs', el)) $('#cs', el).onchange = (e) => go({ c: e.target.value });
  $('#tm', el).onchange = (e) => go({ team: e.target.value }); $('#gp', el).onchange = (e) => go({ group: e.target.value });
  const form = (c) => modal({ title: c ? `Edit ${c.name}` : 'New composite score', body: html`<form id="cf">${field('Name', html`<input name="name" value="${c?.name || ''}" required>`)}
    <table><thead><tr><th>Test</th><th>Weight</th></tr></thead><tbody>${Object.entries(m.tests).map(([k, t]) => html`<tr><td>${t.label}</td><td><input type="number" min="0" data-w="${k}" value="${c?.tests.find((x) => x.key === k)?.weight ?? ''}" placeholder="0" style="width:80px"></td></tr>`)}</tbody></table></form>`,
  actions: [...(c ? [{ label: 'Delete', danger: true, onClick: async () => { await api.del(`/api/strength/composites/${c.id}`); go({ c: '' }); } }] : []), { label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => {
    const tests = $$('[data-w]', r).filter((i) => Number(i.value) > 0).map((i) => ({ key: i.dataset.w, weight: Number(i.value) }));
    const body = { name: r.querySelector('[name=name]').value, tests };
    if (c) { await api.put(`/api/strength/composites/${c.id}`, body); ctx.reload(); } else { const res = await api.post('/api/strength/composites', body); go({ c: res.id }); }
  } }] });
  if ($('#nc', el)) $('#nc', el).onclick = () => form();
  if ($('#edc', el)) $('#edc', el).onclick = () => form(sc.composite);
}
async function compare(el, ctx, head, seg, m, go, teamSel) {
  const dates = await api.get('/api/strength/test-dates');
  const key = ctx.query.test || 'squat';
  const a = ctx.query.a || dates[dates.length - 1]?.date; const b = ctx.query.b || dates[0]?.date;
  const r = a && b ? await api.get(`/api/strength/compare?${new URLSearchParams({ test_key: key, date_a: a, date_b: b, team_id: ctx.query.team || '' })}`) : null;
  const t = m.tests[key];
  const fmtV = (v) => (v == null ? '—' : t.unit === 's' ? Number(v).toFixed(2) : v);
  set(el, html`${head}${seg}<div class="filters"><select id="tk">${options(Object.entries(m.tests).map(([k, x]) => [k, x.label]), key)}</select>
    <select id="da">${options(dates.map((d) => [d.date, `Before: ${fmtDate(d.date, { year: true })}`]), a)}</select><select id="db">${options(dates.map((d) => [d.date, `After: ${fmtDate(d.date, { year: true })}`]), b)}</select>${teamSel('tm', ctx.query.team)}</div>
    ${r ? html`<div class="card"><div class="hd"><h2>${t.label}: before and after by position group</h2></div><div class="bd flush tbl-wrap"><table><thead><tr><th>Group</th><th class="num">Before (avg)</th><th class="num">After (avg)</th><th class="num">Change</th><th class="num">Athletes tested twice</th><th class="num">Improved</th></tr></thead><tbody>
      ${r.rows.map((x) => html`<tr><td><b>${x.group}</b></td><td class="num">${fmtV(x.avg_a)} <span class="faint">n=${x.n_a}</span></td><td class="num">${fmtV(x.avg_b)} <span class="faint">n=${x.n_b}</span></td><td class="num">${x.change == null ? '—' : html`<span class="badge ${x.improved ? 'ok' : 'warn'}">${x.change > 0 ? '+' : ''}${t.unit === 's' ? x.change.toFixed(2) : x.change}</span>`}</td><td class="num">${x.n_both}</td><td class="num">${x.improved_athletes}</td></tr>`)}</tbody></table>${!r.rows.length ? empty('No results on these dates.') : ''}</div>
      <div class="ft s muted">Results within three days of each date count. Change is the average for athletes tested on both dates.</div></div>` : empty('Record at least one testing day to compare.')}`);
  on(el, 'click', '[data-view]', (e, x) => go({ view: x.dataset.view }));
  $('#tk', el).onchange = (e) => go({ test: e.target.value }); $('#da', el).onchange = (e) => go({ a: e.target.value }); $('#db', el).onchange = (e) => go({ b: e.target.value }); $('#tm', el).onchange = (e) => go({ team: e.target.value });
}

// ---------- C-16 leaderboards ----------
export async function leaderboards(el, ctx, head) {
  const m = await meta(true);
  const key = ctx.query.test || 'squat'; const team = ctx.query.team || ''; const group = ctx.query.group || '';
  const lb = await api.get(`/api/leaderboard?${new URLSearchParams({ test_key: key, team_id: team, group, limit: 50 })}`);
  const hidden = new Set(m.settings.leaderboard_hidden || []);
  const go = (q) => ctx.navigate('/weights?' + new URLSearchParams({ tab: 'leaderboards', ...Object.fromEntries(Object.entries({ test: key, team, group, ...q }).filter(([, v]) => v)) }));
  const t = m.tests[key];
  set(el, html`${head}<div class="filters"><select id="tk">${options(Object.entries(m.tests).map(([k, x]) => [k, x.label]), key)}</select><select id="tm"><option value="">All teams</option>${options(m.teams.map((x) => [x.id, x.name]), team)}</select><select id="gp"><option value="">All position groups</option>${options(m.groups, group)}</select></div>
    <div class="grid g-side"><div class="card"><div class="hd"><h2>${t.label}</h2><span class="r">${!lb.visible_to_players ? html`<span class="badge">Coaches only</span>` : (team && hidden.has(`team:${team}`)) || (group && hidden.has(`group:${group}`)) ? html`<span class="badge warn">Hidden from players</span>` : html`<span class="badge ok">Visible to players</span>`}</span></div>
      ${lb.rows.length ? html`<ul class="list">${lb.rows.map((r, i) => html`<li><b style="width:26px" class="num">${i + 1}</b><span class="grow">${r.name} <span class="faint">${r.jersey ?? ''}</span></span><span class="s">${r.group || ''}</span><b>${t.unit === 's' ? Number(r.best).toFixed(2) : r.best} <span class="faint">${t.unit}</span></b></li>`)}</ul>` : empty('No results for this test and filter.')}</div>
    <div class="stack"><div class="card"><div class="hd"><h3>Who sees leaderboards</h3></div><div class="bd">
      ${m.is_admin ? html`<label class="check"><input type="checkbox" id="lbon" ${checked(m.settings.leaderboard)}> Show leaderboards to players</label>
        <p class="help">Hide a team or position group from players. Coaches always see every board. Body weight is never ranked.</p>
        <div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin:8px 0 4px">Teams</div>${m.teams.map((x) => html`<label class="check" style="display:flex"><input type="checkbox" data-hide="team:${x.id}" ${checked(hidden.has(`team:${x.id}`))}> Hide ${x.name}</label>`)}
        <div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin:8px 0 4px">Position groups</div><div class="row" style="flex-wrap:wrap">${m.groups.map((g) => html`<label class="check"><input type="checkbox" data-hide="group:${g}" ${checked(hidden.has(`group:${g}`))}> ${g}</label>`)}</div>`
    : html`<p class="muted" style="margin:0">${m.settings.leaderboard ? 'Players can see leaderboards' : 'Leaderboards are for coaches only'}${hidden.size ? `, except ${hidden.size} hidden team or group board(s)` : ''}. The head coach changes this.</p>`}</div></div></div></div>`);
  $('#tk', el).onchange = (e) => go({ test: e.target.value }); $('#tm', el).onchange = (e) => go({ team: e.target.value }); $('#gp', el).onchange = (e) => go({ group: e.target.value });
  const saveS = async (body) => { try { await api.put('/api/strength/settings', body); toast('Saved'); await meta(true); ctx.reload(); } catch (err) { errToast(err); } };
  if ($('#lbon', el)) $('#lbon', el).onchange = (e) => saveS({ leaderboard: e.target.checked });
  on(el, 'change', '[data-hide]', () => saveS({ leaderboard_hidden: $$('[data-hide]', el).filter((c) => c.checked).map((c) => c.dataset.hide) }));
}

// ---------- C-18 wellness dashboard ----------
export async function wellnessDash(el, ctx, head) {
  const m = await meta();
  if (!m.can_edit && !m.is_admin) { set(el, html`${head}${empty('Wellness check-ins are visible to strength coaches and athletic trainers.')}`); return; }
  const q = { date: ctx.query.date || todayISO(), team_id: ctx.query.team || '', group: ctx.query.group || '' };
  const d = await api.get(`/api/wellness/dashboard?${new URLSearchParams(q)}`);
  const go = (x) => ctx.navigate('/weights?' + new URLSearchParams({ tab: 'wellness', ...Object.fromEntries(Object.entries({ date: q.date, team: q.team_id, group: q.group, ...x }).filter(([, v]) => v)) }));
  const sc = (v) => (v == null ? html`<span class="faint">—</span>` : html`<span class="${v <= 2 ? 'wr-low' : ''}">${v}</span>`);
  set(el, html`${head}<div class="filters"><input type="date" id="dt" value="${q.date}" style="max-width:170px"><select id="tm"><option value="">All teams</option>${options(m.teams.map((x) => [x.id, x.name]), q.team_id)}</select><select id="gp"><option value="">All groups</option>${options(m.groups, q.group)}</select></div>
    <div class="grid g3" style="margin-bottom:14px"><div class="card stat"><div class="k">Checked in</div><div class="v">${d.responded}<span class="muted"> / ${d.total}</span></div></div><div class="card stat"><div class="k">Flagged</div><div class="v" style="color:${d.flagged ? 'var(--bad)' : 'inherit'}">${d.flagged}</div><div class="d">Under 6 hours of sleep or any answer of 1 or 2</div></div><div class="card stat"><div class="k">Response rate</div><div class="v">${d.total ? Math.round((d.responded / d.total) * 100) : 0}%</div></div></div>
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th>Athlete</th><th>Flags</th><th class="num">Sleep (h)</th><th class="num">Sleep quality</th><th class="num">Soreness</th><th class="num">Mood</th><th class="num">Stress</th><th class="num">7-day score</th><th></th></tr></thead><tbody>
    ${d.rows.map((r) => { const c = r.checkin; return html`<tr class="${c?.flags.length ? 'wr-flag' : ''}"><td><b>${r.name}</b> <span class="faint">${r.group || ''}</span>${flagAvail(r)}</td><td>${c ? (c.flags.length ? c.flags.map((f) => html`<span class="badge bad">${f}</span> `) : html`<span class="badge ok">OK</span>`) : html`<span class="faint">No check-in</span>`}</td>
      <td class="num">${c ? html`<span class="${c.sleep_hours < 6 ? 'wr-low' : ''}">${c.sleep_hours}</span>` : html`<span class="faint">—</span>`}</td><td class="num">${sc(c?.sleep_quality)}</td><td class="num">${sc(c?.soreness)}</td><td class="num">${sc(c?.mood)}</td><td class="num">${sc(c?.stress)}</td><td class="num">${r.week.score ?? ''}${r.week.n ? html` <span class="faint">(${r.week.n})</span>` : ''}</td><td><button class="sm" data-tr="${r.id}" data-n="${r.name}">Trend</button></td></tr>`; })}
    </tbody></table></div><div class="ft s muted">All answers are 1 to 5 where 5 is best (5 = not sore, 5 = low stress).</div></div>`);
  $('#dt', el).onchange = (e) => go({ date: e.target.value }); $('#tm', el).onchange = (e) => go({ team: e.target.value }); $('#gp', el).onchange = (e) => go({ group: e.target.value });
  on(el, 'click', '[data-tr]', async (e, b) => {
    const w = await api.get(`/api/wellness/player/${b.dataset.tr}`);
    modal({ title: `${b.dataset.n}: wellness, last 4 weeks`, wide: true, body: html`${lineChart([{ label: 'Score (0-100)', points: w.rows.map((r) => [r.date, r.score]) }, { label: 'Sleep hours x10', points: w.rows.map((r) => [r.date, r.sleep_hours * 10]), dashed: true }], { height: 200, yMin: 0, yMax: 100 })}${legend([{ label: 'Wellness score' }, { label: 'Sleep hours × 10' }])}
      <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>Date</th><th class="num">Sleep</th><th class="num">Quality</th><th class="num">Soreness</th><th class="num">Mood</th><th class="num">Stress</th><th>Note</th></tr></thead><tbody>${w.rows.slice().reverse().map((r) => html`<tr><td>${fmtDate(r.date)}</td><td class="num">${r.sleep_hours}</td><td class="num">${r.sleep_quality}</td><td class="num">${r.soreness}</td><td class="num">${r.mood}</td><td class="num">${r.stress}</td><td class="s">${r.note || ''}</td></tr>`)}</tbody></table></div>`, actions: [{ label: 'Close' }] });
  });
}

// ---------- C-21 reports + C-22 weekly email ----------
export async function reports(el, ctx, head) {
  const m = await meta();
  const q = { from: ctx.query.from || addDaysISO(todayISO(), -27), to: ctx.query.to || todayISO(), by: ctx.query.by || 'athlete', team_id: ctx.query.team || '', group: ctx.query.group || '' };
  let r;
  try { r = await api.get(`/api/strength/reports?${new URLSearchParams(q)}`); } catch (e) { if (e.status === 403) { set(el, html`${head}${empty('Reports are for coaches, trainers and the athletic director.')}`); return; } throw e; }
  const go = (x) => ctx.navigate('/weights?' + new URLSearchParams({ tab: 'reports', ...Object.fromEntries(Object.entries({ from: q.from, to: q.to, by: q.by, team: q.team_id, group: q.group, ...x }).filter(([, v]) => v)) }));
  const delta = (v) => (v == null ? html`<span class="faint">—</span>` : html`${v > 0 ? '+' : ''}${v}`);
  const ath = r.by === 'athlete';
  set(el, html`${head}<div class="print-only"><h1>Weight room report</h1><p>${fmtDate(r.from, { year: true })} to ${fmtDate(r.to, { year: true })} · by ${r.by}${q.team_id ? ` · ${m.teams.find((t) => t.id === Number(q.team_id))?.name}` : ''}${q.group ? ` · ${q.group}` : ''}</p></div>
    <div class="filters"><input type="date" id="fr" value="${q.from}" style="max-width:160px"><input type="date" id="to" value="${q.to}" style="max-width:160px"><select id="by">${options([['athlete', 'By athlete'], ['group', 'By position group'], ['team', 'By team']], q.by)}</select>
      <select id="tm"><option value="">All teams</option>${options(m.teams.map((x) => [x.id, x.name]), q.team_id)}</select><select id="gp"><option value="">All groups</option>${options(m.groups, q.group)}</select><span class="spacer"></span>
      <a class="btn" href="/api/strength/reports/export.csv?${new URLSearchParams(q)}" download>${icon('download', 14)} CSV</a><button id="pr">${icon('printer', 14)} Print or PDF</button></div>
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th>${ath ? 'Athlete' : r.by === 'team' ? 'Team' : 'Position group'}</th>${ath ? html`<th>Group</th>` : html`<th class="num">Athletes</th>`}<th class="num">Completion</th><th>Sessions</th><th class="num">Sets</th><th class="num">PRs</th><th class="num">Squat Δ</th><th class="num">Bench Δ</th><th class="num">Clean Δ</th><th class="num">Lift attendance</th><th class="num">Streak</th></tr></thead><tbody>
    ${r.rows.map((x) => html`<tr ${ath ? raw(`class="click" onclick="__navigate('/development/player/${x.id}')"`) : ''}><td><b>${x.name}</b>${ath ? html` <span class="faint">${x.jersey ?? ''}</span>${flagAvail(x)}` : ''}</td>${ath ? html`<td>${x.group || ''}</td>` : html`<td class="num">${x.athletes}</td>`}
      <td class="num">${x.completion == null ? html`<span class="faint">—</span>` : html`${x.completion}%`}</td><td style="min-width:110px">${x.sessions_due ? bar((x.sessions_done / x.sessions_due) * 100, x.completion < 50 ? 'bad' : x.completion < 80 ? 'warn' : '') : ''} <span class="faint s">${x.sessions_done}/${x.sessions_due}</span></td>
      <td class="num">${x.sets}</td><td class="num">${x.prs || ''}</td><td class="num">${delta(x.progress.squat)}</td><td class="num">${delta(x.progress.bench)}</td><td class="num">${delta(x.progress.clean)}</td><td class="num">${x.attendance == null ? html`<span class="faint">—</span>` : `${x.attendance}%`}</td><td class="num">${x.streak ?? ''}</td></tr>`)}
    </tbody></table>${!r.rows.length ? empty('No athletes match.') : ''}</div><div class="ft s muted">Completion counts sessions due in the date range (dateless programs count sessions finished in the range). Δ is the change in best max between the start and end of the range. Lift attendance and streaks come from attendance taken at lift events.</div></div>
    <div class="card no-print" style="margin-top:14px"><div class="hd"><h2>Weekly email report</h2><span class="r"><button class="sm" id="pv">Preview</button></span></div><div class="bd" id="wr"></div></div>`);
  $('#fr', el).onchange = (e) => go({ from: e.target.value }); $('#to', el).onchange = (e) => go({ to: e.target.value }); $('#by', el).onchange = (e) => go({ by: e.target.value });
  $('#tm', el).onchange = (e) => go({ team: e.target.value }); $('#gp', el).onchange = (e) => go({ group: e.target.value });
  $('#pr', el).onclick = () => window.print();
  const s = m.settings; const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  set($('#wr', el), m.is_admin ? html`<form id="wf" class="row" style="flex-wrap:wrap;gap:12px;align-items:flex-end"><label class="check"><input type="checkbox" name="weekly_report_enabled" ${checked(s.weekly_report_enabled)}> Send every week</label>
      <div class="field" style="margin:0"><label>Day</label><select name="weekly_report_weekday" data-num>${options(DOW.map((d, i) => [i, d]), s.weekly_report_weekday)}</select></div>
      <div class="field" style="margin:0"><label>Hour</label><select name="weekly_report_hour" data-num>${options(Array.from({ length: 24 }, (_, h) => [h, `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`]), s.weekly_report_hour)}</select></div>
      <label class="check"><input type="checkbox" name="weekly_report_athlete" ${checked(s.weekly_report_athlete)}> Athletes</label><label class="check"><input type="checkbox" name="weekly_report_parent" ${checked(s.weekly_report_parent)}> Parents</label><label class="check"><input type="checkbox" name="weekly_report_ad" ${checked(s.weekly_report_ad)}> Athletic director</label>
      <button class="primary sm">Save schedule</button><button type="button" class="sm" id="snow">Send last week now</button></form>`
    : html`<p class="muted" style="margin:0">${s.weekly_report_enabled ? `Sent ${DOW[s.weekly_report_weekday]}s at ${((s.weekly_report_hour + 11) % 12) + 1}:00 ${s.weekly_report_hour < 12 ? 'AM' : 'PM'} to ${[s.weekly_report_athlete && 'athletes', s.weekly_report_parent && 'parents', s.weekly_report_ad && 'the athletic director'].filter(Boolean).join(', ')}.` : 'The weekly email is off. The head coach can turn it on.'}</p>`);
  if ($('#wf', el)) $('#wf', el).onsubmit = async (e) => { e.preventDefault(); try { await api.put('/api/strength/settings', formData(e.target)); await meta(true); toast('Schedule saved'); } catch (err) { errToast(err); } };
  if ($('#snow', el)) $('#snow', el).onclick = async () => { if (!(await confirmDialog('Send the weekly report for the last 7 days to everyone on the list now?', { ok: 'Send now' }))) return; try { const res = await api.post('/api/strength/weekly-report/send'); toast(`Sent to ${res.athletes} athletes, ${res.parents} parents and ${res.ad} AD`); } catch (err) { errToast(err); } };
  $('#pv', el).onclick = async () => {
    const players = await api.get('/api/players');
    const show = async (pid) => {
      const p = await api.get(`/api/strength/weekly-report/preview${pid ? `?player_id=${pid}` : ''}`);
      const mm = modal({ title: 'Weekly email preview', wide: true, body: html`<div class="filters"><select id="pp">${options(players.map((x) => [x.id, x.name]), pid || players[0]?.id)}</select></div>
        ${[['To the athlete', p.athlete], [`To parents (${p.parent.recipients})`, p.parent], ['To the athletic director', p.ad ? { subject: p.ad.title, body: p.ad.body } : null]].filter(([, v]) => v).map(([lbl, v]) => html`<div class="card" style="margin-bottom:8px"><div class="hd"><b>${lbl}</b><span class="r s muted">${v.subject}</span></div><div class="bd"><pre class="wr-mail">${v.body}</pre></div></div>`)}
        <p class="help">${p.last_sent ? `Last sent for the week of ${fmtDate(p.last_sent.week)} (${p.last_sent.sent} messages).` : 'Not sent yet.'} Messages go to the email outbox and the Alerts panel.</p>`, actions: [{ label: 'Close' }] });
      $('#pp', mm.root).onchange = (e) => { mm.close(); show(e.target.value); };
    };
    show(null).catch(errToast);
  };
}
