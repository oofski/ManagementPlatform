// Module 2: Practice planning — plan list, editor with ordered periods, drill library, templates and
// game-week plans, run mode with clock, quick notes and one-tap ratings (offline-safe), summary.
import { api, uid } from '../api.js';
import { html, set, $, $$, on, modal, toast, errToast, formData, options, checked, field, fmtDate, fmtTime, fmtHM, fmtDT, ago, cap, empty, statusBadge, availBadge,
  confirmDialog, todayISO, UNIT, raw, tabs } from '../ui.js';

export default async function practice(el, ctx) {
  if (ctx.route === '/practice/drills') return drills(el, ctx);
  if (ctx.route === '/practice/:id/run') return run(el, ctx, Number(ctx.params.id));
  if (ctx.route === '/practice/:id/summary') return summary(el, ctx, Number(ctx.params.id));
  if (ctx.params.id) return editor(el, ctx, Number(ctx.params.id));
  return list(el, ctx);
}
const nav = (active) => tabs([['plans', 'Plans', '/practice'], ['templates', 'Templates', '/practice?tab=templates'], ['drills', 'Drill library', '/practice/drills']], active);

async function list(el, ctx) {
  const tab = ctx.query.tab === 'templates' ? 'templates' : 'plans';
  const [plans, templates, events] = await Promise.all([api.get('/api/plans'), api.get('/api/plans?templates=1'), api.get(`/api/events?type=practice&from=${todayISO()}`)]);
  const planned = new Set(plans.map((p) => p.event_id));
  const unplanned = events.filter((e) => !planned.has(e.id)).slice(0, 12);
  const upcoming = plans.filter((p) => p.event_start && p.event_start >= todayISO()).reverse();
  const past = plans.filter((p) => !p.event_start || p.event_start < todayISO());
  const edit = ctx.me.caps['practice.edit'];
  const row = (p) => html`<tr class="click" onclick="__navigate('/practice/${p.id}')"><td>${p.event_start ? fmtDate(p.event_start) : '—'}</td><td>${p.event_start ? fmtTime(p.event_start) : ''}</td><td><b>${p.name}</b></td><td class="num">${p.period_count}</td><td class="num">${p.minutes || 0} min</td><td>${p.author || ''}</td>
    <td class="no-print"><a href="/practice/${p.id}/run" onclick="event.stopPropagation()">Run</a> · <a href="/practice/${p.id}/summary" onclick="event.stopPropagation()">Summary</a></td></tr>`;
  set(el, html`<div class="page-head"><div><h1>Practice planning</h1><div class="sub">Build each day from reusable drills, run it from the field, and capture notes and ratings.</div></div>
    <div class="actions">${edit ? html`<button id="gw">Plans for a game week</button><button class="primary" id="new">New plan</button>` : ''}</div></div>
    ${nav(tab)}
    ${tab === 'templates' ? html`<div class="card"><div class="bd flush">${templates.length ? html`<table><thead><tr><th>Template</th><th class="num">Periods</th><th class="num">Length</th><th>Author</th><th></th></tr></thead><tbody>
      ${templates.map((t) => html`<tr class="click" onclick="__navigate('/practice/${t.id}')"><td><b>${t.name}</b><div class="s muted">${t.notes || ''}</div></td><td class="num">${t.period_count}</td><td class="num">${t.minutes || 0} min</td><td>${t.author || ''}</td><td>${edit ? html`<button class="sm" data-use="${t.id}" onclick="event.stopPropagation()">Use for a practice</button>` : ''}</td></tr>`)}</tbody></table>` : empty('No templates yet. Open a plan and choose "Save as template".')}</div></div>`
    : html`<div class="grid g-side">
      <div class="stack">
        <div class="card"><div class="hd"><h2>Upcoming</h2></div><div class="bd flush tbl-wrap">${upcoming.length ? html`<table><thead><tr><th>Date</th><th>Start</th><th>Plan</th><th class="num">Periods</th><th class="num">Length</th><th>Author</th><th></th></tr></thead><tbody>${upcoming.map(row)}</tbody></table>` : empty('No upcoming plans.')}</div></div>
        <div class="card"><div class="hd"><h2>Past practices</h2></div><div class="bd flush tbl-wrap">${past.length ? html`<table><thead><tr><th>Date</th><th>Start</th><th>Plan</th><th class="num">Periods</th><th class="num">Length</th><th>Author</th><th></th></tr></thead><tbody>${past.slice(0, 25).map(row)}</tbody></table>` : empty('No past plans.')}</div></div>
      </div>
      <div class="card"><div class="hd"><h2>Practices without a plan</h2></div>${unplanned.length ? html`<ul class="list">${unplanned.map((e) => html`<li><div class="grow"><div class="t">${e.title}</div><div class="s">${fmtDT(e.start)} · ${e.audience_labels.join(', ')}</div></div>${edit ? html`<button class="sm" data-plan="${e.id}">Plan it</button>` : ''}</li>`)}</ul>` : empty('Every upcoming practice has a plan.')}</div>
    </div>`}`);
  const pickTemplate = (eventId) => modal({
    title: 'Create practice plan',
    body: html`<form id="pf">${eventId ? '' : field('Practice', html`<select name="event_id">${options(unplanned.map((e) => [e.id, `${fmtDT(e.start)} · ${e.title}`]), '', { blank: 'Not linked to an event' })}</select>`)}
      ${field('Start from', html`<select name="template_id">${options(templates.map((t) => [t.id, t.name]), '', { blank: 'Blank plan' })}</select>`)}
      ${field('Or copy a past plan', html`<select name="copy_from">${options(past.slice(0, 30).map((p) => [p.id, `${p.event_start ? fmtDate(p.event_start) : ''} ${p.name}`]), '', { blank: '—' })}</select>`)}
      ${eventId ? '' : field('Name', html`<input name="name" placeholder="Practice plan">`)}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: async (r) => {
      const f = formData(r.querySelector('#pf'));
      const res = await api.post('/api/plans', { event_id: eventId || f.event_id || null, template_id: f.copy_from || f.template_id || null, name: f.name || undefined });
      ctx.navigate(`/practice/${res.id}`);
    } }],
  });
  on(el, 'click', '[data-plan]', (e, b) => pickTemplate(Number(b.dataset.plan)));
  on(el, 'click', '[data-use]', (e, b) => {
    modal({ title: 'Use template', body: html`<select id="ev">${options(unplanned.map((x) => [x.id, `${fmtDT(x.start)} · ${x.title}`]))}</select>`, actions: [{ label: 'Cancel' }, { label: 'Create plan', primary: true, onClick: async (r) => {
      const res = await api.post('/api/plans', { event_id: Number(r.querySelector('#ev').value), template_id: Number(b.dataset.use) }); ctx.navigate(`/practice/${res.id}`);
    } }] });
  });
  if ($('#new', el)) $('#new', el).onclick = () => pickTemplate(null);
  if ($('#gw', el)) $('#gw', el).onclick = () => modal({
    title: 'Plans for a game week',
    body: html`<form id="gf">${field('Week of', html`<input type="date" name="week_of" value="${todayISO()}">`)}${field('Template for every practice', html`<select name="template_id">${options(templates.map((t) => [t.id, t.name]), '', { blank: 'Blank plans' })}</select>`)}
      <p class="help">Creates a plan for every practice that week that does not have one yet. Use the calendar's Game week button first to create the events.</p></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Create plans', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#gf')); const res = await api.post('/api/plans/game-week', { week_of: f.week_of, template_id: f.template_id || null }); toast(`Created ${res.created.length} plan(s)`); ctx.reload(); } }],
  });
}

// ---------- Drill library ----------
async function drills(el, ctx) {
  const q = ctx.query;
  const [list, structure] = await Promise.all([api.get(`/api/drills?${new URLSearchParams(q)}`), api.get('/api/structure')]);
  const codes = [...new Set(structure.positions.map((p) => p.code))];
  const edit = ctx.me.caps['practice.edit'];
  set(el, html`<div class="page-head"><div><h1>Practice planning</h1></div><div class="actions">${edit ? html`<button class="primary" id="new">New drill</button>` : ''}</div></div>
    ${nav('drills')}
    <div class="filters"><input type="search" id="q" placeholder="Search drills, skills, coaching points" value="${q.q || ''}" style="min-width:260px">
      <select id="pos"><option value="">All positions</option>${options(codes, q.position)}</select>
      <select id="unit"><option value="">All units</option>${options(Object.entries(UNIT), q.unit)}</select>
      <input id="skill" placeholder="Skill" value="${q.skill || ''}"></div>
    <div class="grid g3">${list.map((d) => html`<div class="card"><div class="hd"><h3>${d.name}</h3><span class="r">${d.unit ? html`<span class="badge">${UNIT[d.unit]}</span>` : ''}</span></div><div class="bd">
      <p>${d.description || ''}</p>
      ${d.points ? html`<p class="s"><b>Coaching points:</b> ${d.points}</p>` : ''}
      <div class="s muted">${d.positions.length ? d.positions.join(', ') : 'All positions'} · ${d.duration} min${d.equipment ? ` · ${d.equipment}` : ''}</div>
      ${d.skills ? html`<div class="row" style="margin-top:6px">${d.skills.split(',').map((s) => html`<span class="badge">${s.trim()}</span>`)}</div>` : ''}
      ${d.media_url ? html`<p style="margin-top:6px"><a href="${d.media_url}" target="_blank" rel="noopener">Diagram or video</a></p>` : ''}
    </div>${edit ? html`<div class="ft row"><button class="sm" data-edit="${d.id}">Edit</button><button class="sm danger" data-del="${d.id}">Delete</button></div>` : ''}</div>`)}</div>
    ${!list.length ? empty('No drills match.') : ''}`);
  const go = () => ctx.navigate('/practice/drills?' + new URLSearchParams(Object.fromEntries(Object.entries({ q: $('#q', el).value, position: $('#pos', el).value, unit: $('#unit', el).value, skill: $('#skill', el).value }).filter(([, v]) => v))));
  $('#q', el).onchange = go; $('#pos', el).onchange = go; $('#unit', el).onchange = go; $('#skill', el).onchange = go;
  const form = (d = {}) => modal({
    title: d.id ? 'Edit drill' : 'New drill', wide: true,
    body: html`<form id="df"><div class="fields">${field('Name', html`<input name="name" value="${d.name || ''}" required>`)}${field('Unit', html`<select name="unit">${options(Object.entries(UNIT), d.unit || '', { blank: 'Any' })}</select>`)}${field('Minutes', html`<input type="number" name="duration" value="${d.duration || 10}">`)}</div>
      ${field('Description', html`<textarea name="description">${d.description || ''}</textarea>`)}${field('Coaching points', html`<textarea name="points">${d.points || ''}</textarea>`)}
      <div class="fields">${field('Equipment', html`<input name="equipment" value="${d.equipment || ''}">`)}${field('Skills (comma separated)', html`<input name="skills" value="${d.skills || ''}">`)}${field('Diagram or video link', html`<input name="media_url" value="${d.media_url || ''}">`)}</div>
      ${field('Position groups', html`<div class="row">${codes.map((c) => html`<label class="check"><input type="checkbox" name="positions" data-multi value="${c}" ${checked((d.positions || []).includes(c))}> ${c}</label>`)}</div>`)}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#df')); if (d.id) await api.put(`/api/drills/${d.id}`, f); else await api.post('/api/drills', f); toast('Drill saved'); ctx.reload(); } }],
  });
  if ($('#new', el)) $('#new', el).onclick = () => form();
  on(el, 'click', '[data-edit]', (e, b) => form(list.find((d) => d.id === Number(b.dataset.edit))));
  on(el, 'click', '[data-del]', async (e, b) => { if (await confirmDialog('Delete this drill?', { danger: true, ok: 'Delete' })) { await api.del(`/api/drills/${b.dataset.del}`); ctx.reload(); } });
}

// ---------- Plan editor ----------
async function editor(el, ctx, id) {
  const [plan, drillsList, staff, structure, plays] = await Promise.all([
    api.get(`/api/plans/${id}`), api.get('/api/drills'), api.get('/api/staff'), api.get('/api/structure'),
    ctx.me.caps['playbook.view'] ? api.get('/api/plays').catch(() => []) : Promise.resolve([]),
  ]);
  ctx.setTitle(plan.name);
  const codes = [...new Set(structure.positions.map((p) => p.code))];
  const edit = ctx.me.caps['practice.edit'];
  let periods = plan.periods.map((p) => ({ ...p }));
  const coaches = staff.filter((s) => s.role !== 'staff');
  const draw = () => {
    let t = plan.start_time || (plan.event ? plan.event.start.slice(11) : null);
    let clock = t ? new Date(`2000-01-01T${t}`) : null;
    const total = periods.reduce((s, p) => s + Number(p.duration || 0), 0);
    const contact = periods.reduce((s, p) => s + (p.contact ? Number(p.duration || 0) : 0), 0);
    const w = plan.week;
    set($('#periods', el), html`<div class="tbl-wrap"><table><thead><tr><th></th><th>Start</th><th>Min</th><th>Drill</th><th>Group</th><th>Unit</th><th>Positions</th><th>Coach</th><th>Location</th><th>Plays</th><th>Contact</th><th></th></tr></thead><tbody>
      ${periods.map((p, i) => { const start = clock ? `${String(clock.getHours()).padStart(2, '0')}:${String(clock.getMinutes()).padStart(2, '0')}` : ''; if (clock) clock = new Date(clock.getTime() + Number(p.duration || 0) * 60000); return html`<tr data-i="${i}">
        <td style="white-space:nowrap">${edit ? html`<button class="sm ghost" data-up="${i}" aria-label="Move up">↑</button><button class="sm ghost" data-down="${i}" aria-label="Move down">↓</button>` : i + 1}</td>
        <td class="muted">${fmtHM(start)}</td>
        <td><input type="number" min="1" data-k="duration" value="${p.duration}" style="width:62px" ${edit ? '' : raw('disabled')}></td>
        <td><select data-k="drill_id" style="min-width:160px" ${edit ? '' : raw('disabled')}>${options(drillsList.map((d) => [d.id, d.name]), p.drill_id ?? '', { blank: '—' })}</select></td>
        <td><input data-k="group_label" value="${p.group_label || ''}" style="width:110px" ${edit ? '' : raw('disabled')}></td>
        <td><select data-k="unit" ${edit ? '' : raw('disabled')}>${options(Object.entries(UNIT), p.unit || '', { blank: 'All' })}</select></td>
        <td><select data-k="positions" multiple size="2" style="width:90px" ${edit ? '' : raw('disabled')}>${codes.map((c) => html`<option ${p.positions.includes(c) ? raw('selected') : ''}>${c}</option>`)}</select></td>
        <td><select data-k="coach_id" ${edit ? '' : raw('disabled')}>${options(coaches.map((c) => [c.id, c.name]), p.coach_id ?? '', { blank: '—' })}</select></td>
        <td><input data-k="location" value="${p.location || ''}" style="width:120px" ${edit ? '' : raw('disabled')}></td>
        <td>${plays.length ? html`<select data-k="play_ids" multiple size="2" style="width:140px" ${edit ? '' : raw('disabled')}>${plays.map((pl) => html`<option value="${pl.id}" ${(p.play_ids || []).includes(pl.id) ? raw('selected') : ''}>${pl.name}</option>`)}</select>` : html`<span class="faint">—</span>`}</td>
        <td><input type="checkbox" data-k="contact" ${checked(p.contact)} ${edit ? '' : raw('disabled')}></td>
        <td>${statusBadge(p.status || 'pending')}${edit ? html` <button class="sm ghost danger" data-rm="${i}" aria-label="Remove">✕</button>` : ''}</td></tr>`; })}
    </tbody></table></div>
    <div class="ft row between"><span><b>${total} min</b> total · ${contact} min contact</span>${w ? html`<span class="${w.limit && w.minutes > w.limit ? 'badge bad' : 'muted'}">Week of ${fmtDate(w.from, { dow: false })}: ${Math.round(w.minutes)} practice min${w.limit ? ` of ${w.limit} allowed` : ''} · ${w.contact_minutes} contact${w.contact_limit ? ` of ${w.contact_limit}` : ''}</span>` : ''}</div>`);
  };
  set(el, html`<div class="page-head"><div><h1>${plan.name}</h1><div class="sub">${plan.is_template ? 'Template' : plan.event ? `${fmtDT(plan.event.start)} · ${plan.event.location || ''} · ${plan.event.audience.join(', ')}` : 'Not linked to a calendar event'}</div></div>
    <div class="actions"><a class="btn" href="/practice">Back</a><button onclick="window.print()">Print</button>
      ${!plan.is_template ? html`<a class="btn" href="/practice/${id}/summary">Summary</a><a class="btn" href="/practice/${id}/run">Run mode</a>` : ''}
      ${edit ? html`<button id="tpl">Save as template</button><button class="danger" id="del">Delete</button><button class="primary" id="save">Save plan</button>` : ''}</div></div>
    <div id="fbheat"></div>
    <div class="card" style="margin-bottom:14px"><div class="bd"><div class="fields">
      ${field('Plan name', html`<input id="pname" value="${plan.name}" ${edit ? '' : raw('disabled')}>`)}
      ${field('Start time', html`<input type="time" id="pstart" value="${plan.start_time || ''}" ${edit ? '' : raw('disabled')}>`)}
      ${field('Notes for staff', html`<input id="pnotes" value="${plan.notes || ''}" ${edit ? '' : raw('disabled')}>`)}
    </div></div></div>
    <div class="card"><div class="hd"><h2>Periods</h2><span class="r">${edit ? html`<button class="sm" id="add">Add period</button>` : ''}</span></div><div id="periods"></div></div>
    ${!plan.is_template ? html`<div class="grid g2" style="margin-top:14px">
      <div class="card"><div class="hd"><h2>Notes</h2><span class="r faint" style="font-size:12px">${plan.notes.length}</span></div>${plan.notes.length ? html`<ul class="list">${plan.notes.slice(0, 30).map((n) => html`<li><div class="grow"><div class="t">${n.tags.map((t) => html`<span class="badge ${t === 'went well' ? 'ok' : t === 'injury concern' ? 'bad' : t === 'needs work' ? 'warn' : ''}">${t}</span> `)}${n.player_name || n.group_label || ''}</div><div class="s">${n.text || ''} · ${n.coach_name}</div></div></li>`)}</ul>` : empty('No notes yet.')}</div>
      <div class="card"><div class="hd"><h2>Ratings</h2><span class="r faint" style="font-size:12px">${plan.ratings.length}</span></div>${plan.ratings.length ? html`<div class="bd flush tbl-wrap" style="max-height:340px;overflow-y:auto"><table><thead><tr><th>Player</th><th class="num">Rating</th><th>Coach</th></tr></thead><tbody>${plan.ratings.slice(0, 80).map((r) => html`<tr><td>${r.player_name}</td><td class="num">${r.value}</td><td>${r.coach_name}</td></tr>`)}</tbody></table></div>` : empty(ctx.me.caps['ratings.view'] ? 'No ratings yet.' : 'Ratings are visible to coaches.')}</div>
    </div>` : ''}`);
  draw();
  // F-11: heat-acclimatization banner when this day's plan goes over the state schedule.
  if (!plan.is_template) import('./safety.js').then(async (m) => set($('#fbheat', el), m.heatBanner(await api.get(`/api/fb/heat/check?plan_id=${id}`)))).catch(() => {});
  const pe = $('#periods', el);
  pe.addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-i]'); if (!tr) return;
    const p = periods[Number(tr.dataset.i)]; const k = e.target.dataset.k;
    if (k === 'positions') p.positions = [...e.target.selectedOptions].map((o) => o.value);
    else if (k === 'play_ids') p.play_ids = [...e.target.selectedOptions].map((o) => Number(o.value));
    else if (k === 'contact') p.contact = e.target.checked;
    else if (k === 'drill_id') { p.drill_id = e.target.value ? Number(e.target.value) : null; const d = drillsList.find((x) => x.id === p.drill_id); if (d) { if (!p.unit && d.unit) p.unit = d.unit; if (!p.positions.length) p.positions = d.positions; p.duration = p.duration || d.duration; } draw(); }
    else { p[k] = e.target.value; if (k === 'duration') draw(); }
  });
  on(pe, 'click', '[data-up]', (e, b) => { const i = Number(b.dataset.up); if (i > 0) { [periods[i - 1], periods[i]] = [periods[i], periods[i - 1]]; draw(); } });
  on(pe, 'click', '[data-down]', (e, b) => { const i = Number(b.dataset.down); if (i < periods.length - 1) { [periods[i + 1], periods[i]] = [periods[i], periods[i + 1]]; draw(); } });
  on(pe, 'click', '[data-rm]', (e, b) => { periods.splice(Number(b.dataset.rm), 1); draw(); });
  if (!edit) return;
  $('#add', el).onclick = () => { periods.push({ duration: 10, positions: [], play_ids: [], status: 'pending' }); draw(); };
  $('#save', el).onclick = async () => {
    try { await api.put(`/api/plans/${id}`, { name: $('#pname', el).value, start_time: $('#pstart', el).value || null, notes: $('#pnotes', el).value, periods }); toast('Plan saved'); ctx.reload(); } catch (err) { errToast(err); }
  };
  $('#tpl', el).onclick = async () => { const r = await api.post(`/api/plans/${id}/save-template`, {}); toast('Saved as template'); ctx.navigate(`/practice/${r.id}`); };
  $('#del', el).onclick = async () => { if (await confirmDialog('Delete this plan, its notes and ratings?', { danger: true, ok: 'Delete' })) { await api.del(`/api/plans/${id}`); ctx.navigate('/practice'); } };
}

// ---------- Run mode ----------
const TAGS = ['went well', 'needs work', 'injury concern', 'effort', 'technique', 'assignment error'];
async function run(el, ctx, id) {
  const plan = await api.get(`/api/plans/${id}`);
  ctx.setTitle(`Run: ${plan.name}`);
  const heat = await api.get(`/api/fb/heat/check?plan_id=${id}`).catch(() => null); // F-11
  const scale = ctx.me.settings.rating_scale || 5;
  const canRate = ctx.me.caps['ratings.edit'];
  let idx = Math.max(0, plan.periods.findIndex((p) => p.status === 'pending'));
  if (idx < 0) idx = 0;
  let timer = null; let startedAt = null;
  const myRatings = {};
  let offs = [];
  const draw = async () => {
    offs.forEach((f) => f()); offs = [];
    const p = plan.periods[idx];
    if (!p) { set(el, empty('This plan has no periods.')); return; }
    const next = plan.periods[idx + 1];
    let roster = [];
    try { roster = await api.get(`/api/periods/${p.id}/roster`); } catch { roster = []; }
    for (const r of roster) if (myRatings[`${p.id}:${r.id}`] === undefined && r.my_rating != null) myRatings[`${p.id}:${r.id}`] = r.my_rating;
    set(el, html`<div class="page-head"><div><h1>${plan.name}</h1><div class="sub">Period ${idx + 1} of ${plan.periods.length}</div></div>
      <div class="actions"><a class="btn" href="/practice/${id}">Edit plan</a><a class="btn" href="/practice/${id}/summary">Summary</a></div></div>
      ${heat ? (await import('./safety.js')).heatBanner(heat) : ''}
      <div class="grid g-side">
        <div class="stack">
          <div class="card"><div class="bd">
            <div class="row between"><div><h4>Now · ${fmtHM(p.start_time)}</h4><h1 style="font-size:24px;margin-top:4px">${p.drill_name || p.group_label || 'Period'}</h1>
              <div class="muted">${[p.group_label, p.unit ? UNIT[p.unit] : null, p.positions.join(', '), p.location, p.coach_name].filter(Boolean).join(' · ')}</div>
              ${p.drill_points ? html`<p style="margin-top:6px"><b>Points:</b> ${p.drill_points}</p>` : ''}
              ${p.plays.length ? html`<p>Plays: ${p.plays.map((pl) => html`<a href="/playbook/play/${pl.id}">${pl.name}</a> `)}</p>` : ''}</div>
              <div style="text-align:right"><div class="run-clock" id="clock">${String(p.duration).padStart(2, '0')}:00</div><div class="muted">${p.duration} min scheduled</div></div></div>
            <div class="row" style="margin-top:12px">
              <button id="go" class="primary">${timer ? 'Pause clock' : 'Start clock'}</button>
              <button data-ps="done">Mark done</button><button data-ps="skipped">Skip</button><button data-ps="changed">Changed…</button>
              ${statusBadge(p.status)}
              <span class="spacer"></span>
              <button ${idx === 0 ? raw('disabled') : ''} id="prev">‹ Previous</button><button ${!next ? raw('disabled') : ''} id="next">Next ›</button>
            </div>
          </div><div class="ft muted">${next ? html`Next: <b>${fmtHM(next.start_time)} ${next.drill_name || next.group_label || 'Period'}</b> · ${next.duration} min · ${next.location || ''}` : 'Last period'}</div></div>
          <div class="card"><div class="hd"><h2>${canRate ? 'Rate players' : 'Players in this period'}</h2><span class="r faint" style="font-size:12px">${roster.length} in group · tap to rate 1–${scale}, only the ones who stood out</span></div><div class="bd">
            ${roster.length ? html`<div class="tap-grid">${roster.map((r) => html`<div class="tap ${r.flagged ? 'flag' : ''}" data-pid="${r.id}">
              <div class="who"><b>${r.jersey != null ? `#${r.jersey} ` : ''}${r.name}</b><span>${r.positions.join('/')} · ${r.units.map((u) => UNIT[u]).join(', ')} · ${r.level || ''}${['excused', 'unexcused'].includes(r.attendance) ? ' · absent' : ''}</span>${['limited', 'out'].includes(r.availability) ? html` ${availBadge(r.availability)}` : ''}</div>
              ${canRate ? html`<div class="rate">${Array.from({ length: scale }, (_, i) => html`<button class="${myRatings[`${p.id}:${r.id}`] === i + 1 ? 'on' : ''}" data-rate="${i + 1}">${i + 1}</button>`)}</div>` : ''}
              <button class="sm ghost" data-note-player="${r.id}" title="Note">✎</button>
            </div>`)}</div>` : empty('No players match this period’s group.')}
          </div></div>
        </div>
        <div class="stack">
          <div class="card"><div class="hd"><h2>Quick note</h2></div><div class="bd">
            <div class="row" style="margin-bottom:8px">${TAGS.map((t) => html`<button class="sm" data-tag="${t}">${t}</button>`)}</div>
            <select id="ntarget" style="margin-bottom:8px">${options([['group', `Group: ${p.group_label || 'this period'}`], ...roster.map((r) => [`p:${r.id}`, r.name])], 'group')}</select>
            <textarea id="ntext" placeholder="Optional note"></textarea>
            <button class="primary" id="nsave" style="margin-top:8px;width:100%;justify-content:center">Save note</button>
          </div></div>
          <div class="card"><div class="hd"><h2>Script</h2></div><ul class="list">${plan.periods.map((x, i) => html`<li class="click ${i === idx ? 'type-practice' : ''}" data-jump="${i}"><span class="s" style="width:60px">${fmtHM(x.start_time)}</span><span class="grow">${x.drill_name || x.group_label || 'Period'}</span>${statusBadge(x.status)}</li>`)}</ul></div>
        </div>
      </div>`);
    const clockEl = $('#clock', el);
    const tick = () => { if (!startedAt) return; const left = p.duration * 60 - Math.floor((Date.now() - startedAt) / 1000); const a = Math.abs(left); clockEl.textContent = `${left < 0 ? '+' : ''}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`; clockEl.style.color = left < 0 ? 'var(--bad)' : left < 60 ? 'var(--warn)' : ''; };
    tick();
    $('#go', el).onclick = () => { if (timer) { clearInterval(timer); timer = null; startedAt = null; } else { startedAt = Date.now(); timer = setInterval(tick, 500); } $('#go', el).textContent = timer ? 'Pause clock' : 'Start clock'; };
    const move = (n) => { clearInterval(timer); timer = null; startedAt = null; idx = n; draw(); };
    $('#prev', el).onclick = () => move(idx - 1);
    $('#next', el).onclick = () => move(idx + 1);
    offs.push(on(el, 'click', '[data-jump]', (e, li) => move(Number(li.dataset.jump))));
    el.querySelectorAll('[data-ps]').forEach((b) => { b.onclick = async () => {
      const status = b.dataset.ps; let note = null;
      if (status === 'changed') { note = prompt('What changed?'); if (note === null) return; }
      try { await api.post(`/api/periods/${p.id}/status`, { status, note }, { offline: true }); p.status = status; toast(`Period ${status}`); if (status !== 'changed' && plan.periods[idx + 1]) move(idx + 1); else draw(); } catch (err) { errToast(err); }
    }; });
    offs.push(on(el, 'click', '[data-rate]', async (e, b) => {
      const pid = Number(b.closest('[data-pid]').dataset.pid); const value = Number(b.dataset.rate);
      myRatings[`${p.id}:${pid}`] = value;
      b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      const r = await api.post('/api/ratings', { period_id: p.id, player_id: pid, value, client_id: uid() }, { offline: true }).catch(errToast);
      if (r?.queued) toast('Saved offline — will sync', 'warn');
    }));
    let tagsSel = new Set();
    offs.push(on(el, 'click', '[data-tag]', (e, b) => { const t = b.dataset.tag; if (tagsSel.has(t)) tagsSel.delete(t); else tagsSel.add(t); b.classList.toggle('primary', tagsSel.has(t)); }));
    offs.push(on(el, 'click', '[data-note-player]', (e, b) => { $('#ntarget', el).value = `p:${b.dataset.notePlayer}`; $('#ntext', el).focus(); }));
    $('#nsave', el).onclick = async () => {
      const target = $('#ntarget', el).value;
      const body = { plan_id: id, period_id: p.id, tags: [...tagsSel], text: $('#ntext', el).value, player_id: target.startsWith('p:') ? Number(target.slice(2)) : null, group_label: target === 'group' ? p.group_label : null, client_id: uid() };
      try { const r = await api.post('/api/practice-notes', body, { offline: true }); toast(r.queued ? 'Note saved offline — will sync' : 'Note saved', r.queued ? 'warn' : ''); tagsSel = new Set(); $('#ntext', el).value = ''; el.querySelectorAll('[data-tag]').forEach((x) => x.classList.remove('primary')); } catch (err) { errToast(err); }
    };
  };
  await draw();
}

// ---------- Summary ----------
async function summary(el, ctx, id) {
  const s = await api.get(`/api/plans/${id}/summary`);
  ctx.setTitle(`Summary: ${s.name}`);
  set(el, html`<div class="page-head"><div><h1>${s.name}</h1><div class="sub">${s.date ? fmtDate(s.date, { year: true }) : ''} · practice summary</div></div>
    <div class="actions"><a class="btn" href="/practice/${id}">Plan</a><button onclick="window.print()">Print / PDF</button>${ctx.me.caps['practice.edit'] ? html`<button class="primary" id="share">Share with staff</button>` : ''}</div></div>
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card stat"><div class="k">Periods done</div><div class="v">${s.periods_done}/${s.periods_total}</div></div>
      <div class="card stat"><div class="k">Skipped</div><div class="v">${s.periods_skipped}</div></div>
      <div class="card stat"><div class="k">Changed</div><div class="v">${s.periods_changed.length}</div></div>
      <div class="card stat"><div class="k">Notes</div><div class="v">${s.notes.length}</div></div>
    </div>
    <div class="grid g2">
      <div class="card"><div class="hd"><h2>Highest ratings</h2></div>${s.top.length ? html`<ul class="list">${s.top.map((r) => html`<li><span class="grow">${r.name}</span><b>${r.avg}</b><span class="s">${r.n} rating(s)</span></li>`)}</ul>` : empty('No ratings.')}</div>
      <div class="card"><div class="hd"><h2>Lowest ratings</h2></div>${s.bottom.length ? html`<ul class="list">${s.bottom.map((r) => html`<li><span class="grow">${r.name}</span><b>${r.avg}</b><span class="s">${r.n} rating(s)</span></li>`)}</ul>` : empty('Not enough ratings.')}</div>
      <div class="card"><div class="hd"><h2>Notes</h2></div>${s.notes.length ? html`<ul class="list">${s.notes.map((n) => html`<li><div class="grow"><div class="t">${n.tags.join(', ')} ${n.player ? `· ${n.player}` : ''}</div><div class="s">${n.text || ''} — ${n.coach}</div></div></li>`)}</ul>` : empty('No notes.')}</div>
      <div class="card"><div class="hd"><h2>Changes to the plan</h2></div>${s.periods_changed.length ? html`<ul class="list">${s.periods_changed.map((c) => html`<li><span class="grow">${c.drill || 'Period'}</span><span class="s">${c.note || ''}</span></li>`)}</ul>` : empty('Ran as planned.')}</div>
    </div>`);
  if ($('#share', el)) $('#share', el).onclick = async () => { await api.post(`/api/plans/${id}/share-summary`); toast('Summary shared with the coaching staff'); };
}
