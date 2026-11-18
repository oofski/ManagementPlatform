// Module 6: Weight room and nutrition — coach dashboard, programs (builder, templates, assignment, overrides),
// exercise library, testing days and leaderboard, private body weight, meal plans with approval and adherence;
// player workout logging (offline-safe) and meal check-offs.
import { api, uid } from '../api.js';
import { html, set, $, $$, on, modal, toast, errToast, formData, options, checked, field, audienceField, wireAudience, fmtDate, todayISO, cap, empty, bar,
  confirmDialog, tabs, lineChart, legend, UNIT, raw, parseCSV } from '../ui.js';

let TESTS = {};
export default async function weights(el, ctx) {
  TESTS = (await api.get('/api/weights/meta')).tests;
  if (ctx.route === '/weights/workout/:a/:w/:d') return workout(el, ctx);
  if (ctx.route === '/weights/program/:id') return programEditor(el, ctx, ctx.params.id);
  if (!ctx.me.caps.staff) return family(el, ctx);
  const tab = ctx.query.tab || 'dashboard';
  const t = tabs([['dashboard', 'Dashboard', '/weights'], ['programs', 'Programs', '/weights?tab=programs'], ['exercises', 'Exercises', '/weights?tab=exercises'], ['testing', 'Testing', '/weights?tab=testing'], ['body', 'Body weight', '/weights?tab=body'], ['nutrition', 'Meal plans', '/weights?tab=nutrition']], tab);
  const head = html`<div class="page-head"><div><h1>Weight room and nutrition</h1><div class="sub">Programs, testing and meal plans. Body weight stays private and never appears on leaderboards.</div></div></div>${t}`;
  if (tab === 'programs') return programs(el, ctx, head);
  if (tab === 'exercises') return exercises(el, ctx, head);
  if (tab === 'testing') return testing(el, ctx, head);
  if (tab === 'body') return body(el, ctx, head);
  if (tab === 'nutrition') return nutrition(el, ctx, head);
  return dashboard(el, ctx, head);
}

async function dashboard(el, ctx, head) {
  const q = ctx.query;
  const [d, st] = await Promise.all([api.get(`/api/wt-dashboard?${new URLSearchParams(q)}`), api.get('/api/structure')]);
  const codes = [...new Set(st.positions.map((p) => p.code))];
  const behind = d.rows.filter((r) => r.behind > 0);
  set(el, html`${head}
    ${!d.assignments.length ? empty('No lifting programs assigned yet. Build one under Programs.') : html`
    <div class="filters"><select data-f="assignment_id">${options(d.assignments.map((a) => [a.id, `${a.program_name} · ${a.audience_labels.join(', ')} · from ${fmtDate(a.start_date, { dow: false })}`]), d.assignment_id)}</select>
      <select data-f="unit"><option value="">All units</option>${options(Object.entries(UNIT), q.unit)}</select><select data-f="position"><option value="">All positions</option>${options(codes, q.position)}</select>
      <span class="spacer"></span><a class="btn" href="/api/wt-dashboard/export.csv" download>Export logs</a></div>
    <div class="grid g3" style="margin-bottom:14px">
      <div class="card stat"><div class="k">Workouts due so far</div><div class="v">${d.due_days}</div></div>
      <div class="card stat"><div class="k">Players up to date</div><div class="v">${d.rows.length - behind.length}<span class="muted" style="font-size:14px"> / ${d.rows.length}</span></div></div>
      <div class="card stat"><div class="k">Behind</div><div class="v" style="color:var(--bad)">${behind.length}</div></div>
    </div>
    <div class="grid g-side">
      <div class="card"><div class="hd"><h2>Completion</h2></div><div class="bd flush tbl-wrap"><table><thead><tr><th>Player</th><th>Positions</th><th class="num">Done</th><th>Progress</th><th class="num">Behind</th><th>Last log</th></tr></thead><tbody>
        ${d.rows.map((r) => html`<tr class="click" onclick="__navigate('/development/player/${r.id}')"><td><b>${r.name}</b> <span class="faint">${r.jersey ?? ''}</span></td><td>${r.positions.join(', ')}</td><td class="num">${r.completed}/${r.due}</td><td style="width:140px">${bar(r.due ? (r.completed / r.due) * 100 : 100, r.behind > 1 ? 'bad' : r.behind ? 'warn' : '')}</td><td class="num">${r.behind || ''}</td><td>${r.last_log ? fmtDate(r.last_log, { dow: false }) : html`<span class="faint">never</span>`}</td></tr>`)}
      </tbody></table></div></div>
      <div class="card"><div class="hd"><h2>Group progress (average max)</h2></div><div class="bd">
        ${lineChart(Object.entries(d.progress).map(([k, pts]) => ({ label: TESTS[k]?.label || k, points: pts.map((p) => [p.month, p.avg]) })), { height: 220 })}
        ${legend(Object.keys(d.progress).map((k) => ({ label: TESTS[k]?.label || k })))}
      </div></div>
    </div>`}`);
  $$('[data-f]', el).forEach((s) => { s.onchange = () => ctx.navigate('/weights?' + new URLSearchParams(Object.fromEntries(Object.entries({ ...q, [s.dataset.f]: s.value }).filter(([, v]) => v)))); });
}

async function programs(el, ctx, head) {
  const list = await api.get('/api/wt-programs');
  set(el, html`${head}<div class="row" style="margin-bottom:12px"><span class="spacer"></span><button class="primary" id="new">New program</button></div>
    <div class="card">${list.length ? html`<ul class="list">${list.map((p) => html`<li class="click" onclick="__navigate('/weights/program/${p.id}')"><div class="grow"><div class="t">${p.name} ${p.is_template ? html`<span class="badge">Template</span>` : ''}</div><div class="s">${p.weeks} weeks · ${p.days.length} sessions · ${p.description || ''}</div></div><span class="s">${p.assigned} assignment(s)</span></li>`)}</ul>` : empty('No programs yet.')}</div>`);
  $('#new', el).onclick = () => modal({ title: 'New lifting program', body: html`<form id="nf">${field('Name', html`<input name="name" required>`)}<div class="fields">${field('Weeks', html`<input type="number" name="weeks" value="4" min="1" max="20">`)}${field('Start from', html`<select name="copy_from">${options(list.map((p) => [p.id, p.name]), '', { blank: 'Blank' })}</select>`)}</div>${field('Description', html`<input name="description">`)}<label class="check"><input type="checkbox" name="is_template"> Save as a template</label></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#nf')); const res = await api.post('/api/wt-programs', { ...f, copy_from: f.copy_from || null }); ctx.navigate(`/weights/program/${res.id}`); } }] });
}

async function programEditor(el, ctx, id) {
  const [p, exs, auds] = await Promise.all([api.get(`/api/wt-programs/${id}`), api.get('/api/exercises'), api.get('/api/audiences')]);
  ctx.setTitle(p.name);
  const days = p.days.map((d) => ({ ...d, exercises: d.exercises.map((x) => ({ ...x })) }));
  const draw = () => set($('#days', el), days.length ? days.sort((a, b) => a.week - b.week || a.day - b.day).map((d, di) => html`<div class="card" style="margin-bottom:10px" data-di="${di}"><div class="hd">
      <b>Week</b><input type="number" data-dk="week" value="${d.week}" style="width:60px"><b>Day</b><input type="number" data-dk="day" value="${d.day}" style="width:60px"><input data-dk="label" value="${d.label || ''}" placeholder="Label (Lower, Upper…)" style="max-width:220px">
      <span class="r"><button class="sm" data-addx="${di}">Add exercise</button><button class="sm" data-dupd="${di}">Copy to next week</button><button class="sm ghost danger" data-deld="${di}">✕</button></span></div>
      <div class="bd flush tbl-wrap"><table><thead><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>% of max</th><th>Fixed load</th><th>Rest</th><th></th></tr></thead><tbody>
      ${d.exercises.map((x, xi) => html`<tr data-xi="${xi}"><td><select data-xk="exercise_id">${options(exs.map((e) => [e.id, `${e.name}${e.test_key ? ' (tested)' : ''}`]), x.exercise_id)}</select></td>
        <td><input type="number" data-xk="sets" value="${x.sets}" style="width:60px"></td><td><input data-xk="reps" value="${x.reps || ''}" style="width:70px"></td>
        <td><input type="number" data-xk="pct" value="${x.pct ?? ''}" style="width:70px" placeholder="—"></td><td><input type="number" data-xk="load" value="${x.load ?? ''}" style="width:80px" placeholder="—"></td>
        <td><input data-xk="rest" value="${x.rest || ''}" style="width:70px"></td><td><button class="sm ghost danger" data-delx="${xi}">✕</button></td></tr>`)}
      </tbody></table></div></div>`) : empty('Add a session to start.'));
  set(el, html`<div class="page-head"><div><h1>${p.name}</h1><div class="sub">${p.weeks} weeks · loads set as % of each player’s tested max update automatically when new maxes are recorded.</div></div>
    <div class="actions"><a class="btn" href="/weights?tab=programs">Programs</a><button class="danger" id="del">Delete</button><button id="assign">Assign</button><button class="primary" id="save">Save</button></div></div>
    <div class="grid g-side"><div><div class="row" style="margin-bottom:10px"><button id="addd">Add session</button></div><div id="days"></div></div>
    <div class="stack"><div class="card"><div class="hd"><h3>Program</h3></div><div class="bd"><form id="pf">${field('Name', html`<input name="name" value="${p.name}">`)}${field('Weeks', html`<input type="number" name="weeks" value="${p.weeks}">`)}${field('Description', html`<textarea name="description">${p.description || ''}</textarea>`)}<label class="check"><input type="checkbox" name="is_template" ${checked(p.is_template)}> Template</label></form></div></div>
    <div class="card"><div class="hd"><h3>Assigned to</h3></div>${p.assignments.length ? html`<ul class="list">${p.assignments.map((a) => html`<li><div class="grow"><div class="t">${a.audience_labels.join(', ')}</div><div class="s">Starts ${fmtDate(a.start_date)}</div></div><button class="sm" data-ov="${a.id}">Individual changes</button><button class="sm ghost danger" data-una="${a.id}">✕</button></li>`)}</ul>` : empty('Not assigned yet.')}</div></div></div>`);
  draw();
  const dEl = $('#days', el);
  dEl.addEventListener('change', (e) => {
    const di = Number(e.target.closest('[data-di]')?.dataset.di); const d = days[di]; if (!d) return;
    if (e.target.dataset.dk) d[e.target.dataset.dk] = e.target.dataset.dk === 'label' ? e.target.value : Number(e.target.value);
    const xi = e.target.closest('[data-xi]')?.dataset.xi;
    if (xi !== undefined && e.target.dataset.xk) { const k = e.target.dataset.xk; const v = e.target.value; d.exercises[Number(xi)][k] = ['reps', 'rest'].includes(k) ? v : v === '' ? null : Number(v); }
  });
  on(dEl, 'click', '[data-addx]', (e, b) => { days[Number(b.dataset.addx)].exercises.push({ exercise_id: exs[0]?.id, sets: 3, reps: '8' }); draw(); });
  on(dEl, 'click', '[data-delx]', (e, b) => { days[Number(b.closest('[data-di]').dataset.di)].exercises.splice(Number(b.dataset.delx), 1); draw(); });
  on(dEl, 'click', '[data-deld]', (e, b) => { days.splice(Number(b.dataset.deld), 1); draw(); });
  on(dEl, 'click', '[data-dupd]', (e, b) => { const d = days[Number(b.dataset.dupd)]; days.push({ ...JSON.parse(JSON.stringify(d)), week: d.week + 1 }); draw(); });
  $('#addd', el).onclick = () => { const last = days[days.length - 1]; days.push({ week: last ? last.week : 1, day: last ? last.day + 1 : 1, label: '', exercises: [] }); draw(); };
  $('#save', el).onclick = async () => { try { await api.put(`/api/wt-programs/${id}`, { ...formData($('#pf', el)), days }); toast('Program saved'); ctx.reload(); } catch (err) { errToast(err); } };
  $('#del', el).onclick = async () => { if (await confirmDialog('Delete this program and its assignments?', { danger: true, ok: 'Delete' })) { await api.del(`/api/wt-programs/${id}`); ctx.navigate('/weights?tab=programs'); } };
  $('#assign', el).onclick = () => { const m = modal({ title: 'Assign program', wide: true, body: html`<form id="af"><div class="grid g2"><div>${field('Who', audienceField('audience', auds, [], { exclude: ['coaches', 'parents'] }))}</div><div>
      ${field('Start date', html`<input type="date" name="start_date" value="${todayISO()}">`)}
      ${field('Put sessions on the calendar on', html`<div class="row">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => html`<label class="check"><input type="checkbox" name="weekdays" data-multi data-num value="${i}" ${checked(i === 2 || i === 4)}> ${d}</label>`)}</div>`, 'Day 1 of each week goes on the first chosen weekday, day 2 on the second, and so on. Uses the same audiences, RSVP and attendance as other events.')}
      <div class="fields">${field('Time', html`<input type="time" name="time" value="06:45">`)}${field('Minutes', html`<input type="number" name="minutes" value="50">`)}</div>${field('Location', html`<input name="location" value="Weight room">`)}</div></div></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Assign', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#af')); const res = await api.post('/api/wt-assignments', { wt_program_id: Number(id), audience: f.audience, start_date: f.start_date, schedule: f.weekdays.length ? { weekdays: f.weekdays, time: f.time, minutes: f.minutes, location: f.location } : null }); toast(`Assigned; ${res.events} sessions added to the calendar`); ctx.reload(); } }] }); wireAudience(m.root); };
  on(el, 'click', '[data-una]', async (e, b) => { if (await confirmDialog('Remove this assignment and its future calendar sessions?', { danger: true, ok: 'Remove' })) { await api.del(`/api/wt-assignments/${b.dataset.una}`); ctx.reload(); } });
  on(el, 'click', '[data-ov]', async (e, b) => {
    const aid = b.dataset.ov; const [ovs, players] = await Promise.all([api.get(`/api/wt-assignments/${aid}/overrides`), api.get('/api/players')]);
    const used = [...new Set(days.flatMap((d) => d.exercises.map((x) => x.exercise_id)))];
    modal({ title: 'Individual changes', wide: true, body: html`<p class="muted">Adjust one player’s plan on top of the group plan, for example an alternate exercise for an injured player.</p>
      ${ovs.length ? html`<table style="margin-bottom:12px"><thead><tr><th>Player</th><th>Exercise</th><th>Change</th><th></th></tr></thead><tbody>${ovs.map((o) => html`<tr><td>${o.player_name}</td><td>${o.exercise_name || 'All'}</td><td>${[o.alt_name ? `→ ${o.alt_name}` : '', o.sets ? `${o.sets} sets` : '', o.reps ? `${o.reps} reps` : '', o.pct ? `${o.pct}%` : '', o.note].filter(Boolean).join(' · ')}</td><td><button class="sm ghost danger" data-delo="${o.id}">✕</button></td></tr>`)}</tbody></table>` : ''}
      <form id="of"><div class="fields">${field('Player', html`<select name="player_id">${options(players.map((p) => [p.id, p.name]))}</select>`)}${field('Exercise', html`<select name="exercise_id">${options(used.map((u) => [u, exs.find((e) => e.id === u)?.name]))}</select>`)}${field('Replace with', html`<select name="alt_exercise_id">${options(exs.map((e) => [e.id, e.name]), '', { blank: 'Keep exercise' })}</select>`)}
      ${field('Sets', html`<input type="number" name="sets">`)}${field('Reps', html`<input name="reps">`)}${field('% of max', html`<input type="number" name="pct">`)}</div>${field('Note', html`<input name="note">`)}</form>`,
    actions: [{ label: 'Close' }, { label: 'Add change', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#of')); await api.post(`/api/wt-assignments/${aid}/overrides`, { ...f, player_id: Number(f.player_id), exercise_id: Number(f.exercise_id), alt_exercise_id: f.alt_exercise_id ? Number(f.alt_exercise_id) : null }); toast('Saved'); } }],
    onOpen: (r, close) => on(r, 'click', '[data-delo]', async (ev, x) => { await api.del(`/api/wt-overrides/${x.dataset.delo}`); close(); toast('Removed'); }) });
  });
}

async function exercises(el, ctx, head) {
  const list = await api.get('/api/exercises');
  set(el, html`${head}<div class="row" style="margin-bottom:12px"><span class="spacer"></span><button class="primary" id="new">New exercise</button></div>
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th>Exercise</th><th>Category</th><th>Coaching cues</th><th>Tied to test</th><th>Video</th><th></th></tr></thead><tbody>
    ${list.map((x) => html`<tr><td><b>${x.name}</b></td><td>${x.category || ''}</td><td>${x.cues || ''}</td><td>${x.test_key ? TESTS[x.test_key]?.label : ''}</td><td>${x.video_url ? html`<a href="${x.video_url}" target="_blank" rel="noopener">Demo</a>` : ''}</td><td><button class="sm" data-e="${x.id}">Edit</button></td></tr>`)}</tbody></table></div></div>`);
  const form = (x = {}) => modal({ title: x.id ? 'Edit exercise' : 'New exercise', body: html`<form id="xf">${field('Name', html`<input name="name" value="${x.name || ''}" required>`)}<div class="fields">${field('Category', html`<input name="category" value="${x.category || ''}" placeholder="Lower, Upper, Olympic">`)}${field('Tested max', html`<select name="test_key">${options(Object.entries(TESTS).filter(([, t]) => t.unit === 'lb').map(([k, t]) => [k, t.label]), x.test_key || '', { blank: 'None' })}</select>`)}</div>${field('Coaching cues', html`<textarea name="cues">${x.cues || ''}</textarea>`)}${field('Demo video link', html`<input name="video_url" value="${x.video_url || ''}">`)}</form>`,
    actions: [...(x.id ? [{ label: 'Delete', danger: true, onClick: async () => { await api.del(`/api/exercises/${x.id}`); ctx.reload(); } }] : []), { label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#xf')); if (x.id) await api.put(`/api/exercises/${x.id}`, f); else await api.post('/api/exercises', f); ctx.reload(); } }] });
  $('#new', el).onclick = () => form();
  on(el, 'click', '[data-e]', (e, b) => form(list.find((x) => x.id === Number(b.dataset.e))));
}

async function testing(el, ctx, head) {
  const key = ctx.query.test || 'squat';
  const [players, rows, lb] = await Promise.all([api.get('/api/players'), api.get(`/api/tests?test_key=${key}`), api.get(`/api/leaderboard?test_key=${key}`)]);
  const latest = {};
  for (const r of rows) if (!latest[r.player_id] || r.date > latest[r.player_id].date) latest[r.player_id] = r;
  set(el, html`${head}<div class="filters"><select id="tk">${options(Object.entries(TESTS).map(([k, t]) => [k, t.label]), key)}</select><span class="spacer"></span>
    <button id="imp">Import maxes</button><button class="primary" id="day">Record a testing day</button></div>
    <div class="grid g-side"><div class="card"><div class="hd"><h2>Latest results</h2></div><div class="bd flush tbl-wrap"><table><thead><tr><th>Player</th><th class="num">${TESTS[key].label} (${TESTS[key].unit})</th><th>Date</th></tr></thead><tbody>
      ${players.filter((p) => latest[p.id]).sort((a, b) => (TESTS[key].better === 'lower' ? latest[a.id].value - latest[b.id].value : latest[b.id].value - latest[a.id].value)).map((p) => html`<tr class="click" onclick="__navigate('/development/player/${p.id}')"><td>${p.name}</td><td class="num"><b>${latest[p.id].value}</b></td><td>${fmtDate(latest[p.id].date, { dow: false })}</td></tr>`)}
    </tbody></table></div></div>
    <div class="card"><div class="hd"><h2>Leaderboard</h2><span class="r">${ctx.me.settings.leaderboard ? html`<span class="badge ok">Visible to players</span>` : html`<span class="badge">Coaches only</span>`}</span></div>
      <ul class="list">${lb.rows.map((r, i) => html`<li><b style="width:22px">${i + 1}</b><span class="grow">${r.name}</span><span class="s">${r.positions.join('/')}</span><b>${r.best}</b></li>`)}</ul></div></div>`);
  $('#tk', el).onchange = (e) => ctx.navigate(`/weights?tab=testing&test=${e.target.value}`);
  $('#day', el).onclick = () => modal({ title: `Testing day: ${TESTS[key].label}`, wide: true, body: html`<form id="tf">${field('Date', html`<input type="date" name="date" value="${todayISO()}">`)}
    <div style="max-height:50vh;overflow-y:auto"><table><tbody>${players.map((p) => html`<tr><td>${p.name} <span class="faint">${p.jersey ?? ''} · ${p.team || ''}</span></td><td class="num faint">${latest[p.id]?.value ?? ''}</td><td style="width:130px"><input type="number" step="${TESTS[key].unit === 's' ? '0.01' : '5'}" data-pid="${p.id}" placeholder="${TESTS[key].unit}"></td></tr>`)}</tbody></table></div></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save results', primary: true, onClick: async (r) => {
      const entries = [...r.querySelectorAll('[data-pid]')].filter((i) => i.value).map((i) => ({ player_id: Number(i.dataset.pid), value: Number(i.value) }));
      const res = await api.post('/api/tests/batch', { test_key: key, date: r.querySelector('[name=date]').value, entries });
      toast(`${res.results.length} results saved · ${res.prs} personal record(s)`); ctx.reload();
    } }] });
  $('#imp', el).onclick = () => { let rows2 = []; const m = modal({ title: 'Import maxes from a spreadsheet', body: html`<p>CSV columns: <span class="mono">name (or jersey), test, value, date</span>. Tests: ${Object.keys(TESTS).join(', ')}.</p><input type="file" accept=".csv" id="f"><p id="n" class="muted"></p>`,
    actions: [{ label: 'Cancel' }, { label: 'Import', primary: true, onClick: async () => { const res = await api.post('/api/tests/import', { rows: rows2 }); toast(`Imported ${res.created}${res.errors.length ? `, ${res.errors.length} skipped` : ''}`); ctx.reload(); } }] });
    m.root.querySelector('#f').onchange = async (e) => { rows2 = parseCSV(await e.target.files[0].text()); m.root.querySelector('#n').textContent = `${rows2.length} rows ready`; }; };
}

async function body(el, ctx, head) {
  const players = await api.get('/api/players');
  const pid = Number(ctx.query.player || 0);
  let hist = null; let err = null;
  if (pid) { try { hist = await api.get(`/api/bodyweight/${pid}`); } catch (e) { err = e.message; } }
  set(el, html`${head}<div class="notice">Body weight is visible only to the player, their parents, and staff who have been granted access. It never appears on leaderboards, group views or shared screens.</div>
    <div class="filters"><select id="pl">${options(players.map((p) => [p.id, `${p.name}${p.jersey != null ? ' #' + p.jersey : ''}`]), pid || '', { blank: 'Choose a player' })}</select></div>
    ${err ? html`<div class="notice bad">${err}</div>` : hist ? html`<div class="grid g-side"><div class="card"><div class="hd"><h2>Weigh-ins</h2></div><div class="bd">${lineChart([{ label: 'Body weight', points: hist.map((h) => [h.date, h.value]) }])}</div></div>
      <div class="card"><div class="hd"><h2>Record weigh-in</h2></div><div class="bd"><form id="bw" class="inline-input"><input type="number" name="value" step="0.5" placeholder="lb" required><input type="date" name="date" value="${todayISO()}"><button class="primary">Save</button></form></div>
      <ul class="list">${hist.slice().reverse().map((h) => html`<li><span class="grow">${fmtDate(h.date)}</span><b>${h.value} lb</b><span class="s">${h.by_name || ''}</span></li>`)}</ul></div></div>` : empty('Choose a player to see their weigh-ins.')}`);
  $('#pl', el).onchange = (e) => ctx.navigate(`/weights?tab=body&player=${e.target.value}`);
  if ($('#bw', el)) $('#bw', el).onsubmit = async (e) => { e.preventDefault(); try { await api.post('/api/bodyweight', { ...formData(e.target), player_id: pid }); toast('Saved'); ctx.reload(); } catch (x) { errToast(x); } };
}

async function nutrition(el, ctx, head) {
  const [plans, auds] = await Promise.all([api.get('/api/meal-plans'), api.get('/api/audiences')]);
  const approver = ctx.me.caps['nutrition.approve'];
  set(el, html`${head}<div class="notice">Meal plans are created or approved by a trainer or nutrition professional. Tracking records only whether planned meals were eaten and hydration was met — no calorie counting. Players and parents can opt out.</div>
    <div class="row" style="margin-bottom:12px"><span class="spacer"></span><button class="primary" id="new">New meal plan</button></div>
    <div class="grid g2">${plans.map((m) => html`<div class="card"><div class="hd"><h2>${m.name}</h2><span class="r">${m.is_template ? html`<span class="badge">Template</span>` : ''}${m.locked ? html`<span class="badge blue">Locked</span>` : ''}${m.approved_by ? html`<span class="badge ok">Approved by ${m.approved_name}</span>` : html`<span class="badge warn">Needs approval</span>`}</span></div>
      <div class="bd"><ul class="list" style="margin:-14px -14px 8px">${m.meals.map((x) => html`<li><span style="width:70px" class="s">${x.time || ''}</span><span class="grow"><b>${x.name}</b> ${x.description || ''}</span></li>`)}</ul>
      <div class="s muted">Hydration target ${m.hydration_oz || '—'} oz · ${m.audience_labels.join(', ') || 'Not assigned'}</div>${m.notes ? html`<p class="s">${m.notes}</p>` : ''}</div>
      <div class="ft row">${!m.is_template ? html`<button class="sm" data-adh="${m.id}">Adherence</button>` : ''}<button class="sm" data-edit="${m.id}">Edit</button>${approver && !m.approved_by ? html`<button class="sm primary" data-appr="${m.id}">Approve</button>` : ''}${approver ? html`<button class="sm" data-lock="${m.id}" data-v="${m.locked ? 0 : 1}">${m.locked ? 'Unlock' : 'Lock'}</button>` : ''}</div></div>`)}</div>`);
  const form = (m = null) => {
    let meals = m ? m.meals.map((x) => ({ ...x })) : [{ name: 'Breakfast', time: '07:00', description: '' }];
    const mm = modal({ title: m ? `Edit ${m.name}` : 'New meal plan', wide: true, body: html`<form id="mf"><div class="fields">${field('Name', html`<input name="name" value="${m?.name || ''}" required>`)}${field('Hydration target (oz/day)', html`<input type="number" name="hydration_oz" value="${m?.hydration_oz ?? 100}">`)}${!m ? field('Start from template', html`<select name="copy_from">${options(plans.filter((p) => p.is_template).map((p) => [p.id, p.name]), '', { blank: 'Blank' })}</select>`) : ''}</div>
      <div id="meals"></div><button type="button" class="sm" id="addm">Add meal</button>
      ${field('Notes', html`<textarea name="notes">${m?.notes || ''}</textarea>`)}<div class="grid g2"><div>${field('Assign to', audienceField('audience', auds, m?.audience || [], { exclude: ['coaches', 'parents'] }))}</div><div>${!m ? html`<label class="check"><input type="checkbox" name="is_template"> Template</label>` : ''}</div></div></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => {
      const f = formData(r.querySelector('#mf')); const body2 = { ...f, meals, copy_from: f.copy_from || undefined };
      if (f.copy_from) delete body2.meals;
      const res = m ? await api.put(`/api/meal-plans/${m.id}`, body2) : await api.post('/api/meal-plans', body2);
      toast(m ? 'Saved' : res.approved ? 'Created and approved' : 'Created; a trainer must approve it before players see it'); ctx.reload();
    } }] });
    const dm = () => set(mm.root.querySelector('#meals'), meals.map((x, i) => html`<div class="inline-input" style="margin-bottom:6px" data-mi="${i}"><input data-mk="name" value="${x.name}" placeholder="Meal" style="max-width:160px"><input type="time" data-mk="time" value="${x.time || ''}" style="max-width:120px"><input data-mk="description" value="${x.description || ''}" placeholder="What to eat"><button type="button" class="sm ghost danger" data-rm="${i}">✕</button></div>`));
    dm(); wireAudience(mm.root);
    mm.root.querySelector('#meals').addEventListener('input', (e) => { const i = e.target.closest('[data-mi]'); if (i) meals[Number(i.dataset.mi)][e.target.dataset.mk] = e.target.value; });
    on(mm.root, 'click', '[data-rm]', (e, b) => { meals.splice(Number(b.dataset.rm), 1); dm(); });
    mm.root.querySelector('#addm').onclick = () => { meals.push({ name: '', time: '', description: '' }); dm(); };
  };
  $('#new', el).onclick = () => form();
  on(el, 'click', '[data-edit]', (e, b) => form(plans.find((p) => p.id === Number(b.dataset.edit))));
  on(el, 'click', '[data-appr]', async (e, b) => { await api.post(`/api/meal-plans/${b.dataset.appr}/approve`); toast('Approved; players notified'); ctx.reload(); });
  on(el, 'click', '[data-lock]', async (e, b) => { await api.put(`/api/meal-plans/${b.dataset.lock}`, { locked: b.dataset.v === '1' }); ctx.reload(); });
  on(el, 'click', '[data-adh]', async (e, b) => {
    const a = await api.get(`/api/meal-plans/${b.dataset.adh}/adherence`);
    modal({ title: 'Meal plan adherence (last 7 days)', wide: true, body: html`${a.opted_out ? html`<p class="muted">${a.opted_out} player(s) opted out of nutrition tracking.</p>` : ''}<table><thead><tr><th>Player</th><th class="num">Meals</th><th>Rate</th><th class="num">Hydration days</th></tr></thead><tbody>${a.rows.map((r) => html`<tr><td>${r.name}</td><td class="num">${r.meals_done}/${r.meals_planned}</td><td style="width:160px">${bar(r.rate, r.rate < 50 ? 'bad' : r.rate < 75 ? 'warn' : '')}</td><td class="num">${r.hydration_days}</td></tr>`)}</tbody></table>`, actions: [{ label: 'Close' }] });
  });
}

// ---------- player / parent ----------
async function family(el, ctx) {
  const parent = ctx.me.user.role === 'parent';
  const players = ctx.me.linked;
  const pid = Number(ctx.query.player || players[0]?.id || 0);
  if (!pid) { set(el, empty('No linked player.')); return; }
  const [workouts, meals, logs, tests, prof, bw] = await Promise.all([
    parent ? Promise.resolve([]) : api.get(`/api/workouts/player/${pid}`), api.get('/api/meal-plans'), api.get(`/api/meal-logs?player_id=${pid}`),
    api.get(`/api/tests?player_id=${pid}`), api.get(`/api/players/${pid}`), api.get(`/api/bodyweight/${pid}`).catch(() => []),
  ]);
  const optOut = !!prof.nutrition_opt_out;
  const done = new Set(logs.meals.filter((m) => m.done).map((m) => `${m.plan_id}:${m.meal_idx}`));
  const hyd = new Set(logs.hydration.filter((h) => h.met).map((h) => h.plan_id));
  set(el, html`<div class="page-head"><div><h1>${parent ? `${prof.name}: training and nutrition` : 'Weight room'}</h1><div class="sub">${parent ? 'What your player was assigned and how it is going.' : 'Your lifts, personal records and meal plan.'}</div></div>
    <div class="actions">${players.length > 1 ? html`<select id="pp">${options(players.map((p) => [p.id, p.name]), pid)}</select>` : ''}${ctx.me.settings.leaderboard ? html`<a class="btn" href="#" id="lb">Leaderboard</a>` : ''}</div></div>
    <div class="grid g-side"><div class="stack">
      ${!parent ? html`<div class="card"><div class="hd"><h2>Workouts</h2></div>${workouts.length ? workouts.map((a) => html`<div style="padding:10px 14px;border-bottom:1px solid var(--border)"><b>${a.program_name}</b><span class="muted"> · from ${fmtDate(a.start_date)}</span>
        <div class="row" style="margin-top:6px">${a.days.map((d) => html`<a class="btn sm ${d.complete ? '' : d.due <= todayISO() ? 'primary' : ''}" href="/weights/workout/${a.id}/${d.week}/${d.day}">W${d.week}D${d.day} ${d.label || ''} ${d.complete ? '✓' : ''}</a>`)}</div></div>`) : empty('No lifting program assigned yet.')}</div>` : ''}
      <div class="card"><div class="hd"><h2>Today’s meal plan</h2><span class="r">${!optOut ? html`<button class="sm" id="opt">Opt out of nutrition tracking</button>` : html`<button class="sm" id="optin">Opt back in</button>`}</span></div>
        ${optOut ? html`<div class="bd muted">Nutrition tracking is off for ${parent ? prof.name : 'you'}. Everything else in the app still works.</div>` : meals.length ? meals.map((m) => html`<div style="padding:10px 14px;border-bottom:1px solid var(--border)"><b>${m.name}</b>
          <ul class="list">${m.meals.map((x, i) => html`<li><label class="check" style="flex:1"><input type="checkbox" data-meal="${m.id}:${i}" ${checked(done.has(`${m.id}:${i}`))} ${parent ? raw('disabled') : ''}> <b>${x.time || ''}</b> ${x.name} <span class="muted">${x.description || ''}</span></label></li>`)}
          <li><label class="check"><input type="checkbox" data-hyd="${m.id}" ${checked(hyd.has(m.id))} ${parent ? raw('disabled') : ''}> Hit ${m.hydration_oz || ''} oz of water today</label></li></ul></div>`) : empty('No meal plan assigned.')}
      </div>
    </div><div class="stack">
      <div class="card"><div class="hd"><h2>Personal records</h2></div><ul class="list">${Object.entries(tests.prs).map(([k, r]) => html`<li><span class="grow">${TESTS[k]?.label || k}</span><b>${r.value} ${TESTS[k]?.unit || ''}</b><span class="s">${fmtDate(r.date, { dow: false })}</span></li>`)}</ul>${!Object.keys(tests.prs).length ? empty('No tests recorded yet.') : ''}</div>
      <div class="card"><div class="hd"><h2>Body weight</h2><span class="r faint" style="font-size:12px">Private</span></div><div class="bd">${bw.length ? lineChart([{ label: 'Body weight', points: bw.map((h) => [h.date, h.value]) }], { height: 150 }) : html`<p class="muted">No weigh-ins yet.</p>`}
        ${!parent ? html`<form id="bw" class="inline-input" style="margin-top:8px"><input type="number" step="0.5" name="value" placeholder="Today’s weight (lb)" required><button>Log</button></form>` : ''}</div></div>
    </div></div>`);
  if ($('#pp', el)) $('#pp', el).onchange = (e) => ctx.navigate(`/weights?player=${e.target.value}`);
  on(el, 'change', '[data-meal]', async (e, c) => { const [plan, idx] = c.dataset.meal.split(':').map(Number); try { await api.post('/api/meal-logs', { plan_id: plan, meal_idx: idx, done: c.checked }, { offline: true }); } catch (err) { errToast(err); } });
  on(el, 'change', '[data-hyd]', async (e, c) => { try { await api.post('/api/meal-logs', { plan_id: Number(c.dataset.hyd), hydration: c.checked }, { offline: true }); } catch (err) { errToast(err); } });
  const opt = async (v) => { await api.post(`/api/players/${pid}/opt-out`, { opt_out: v }); toast(v ? 'Nutrition tracking turned off' : 'Nutrition tracking turned on'); ctx.reload(); };
  if ($('#opt', el)) $('#opt', el).onclick = async () => { if (await confirmDialog('Stop nutrition tracking? Meal plans will not be tracked; nothing else changes.')) opt(true); };
  if ($('#optin', el)) $('#optin', el).onclick = () => opt(false);
  if ($('#bw', el)) $('#bw', el).onsubmit = async (e) => { e.preventDefault(); try { await api.post('/api/bodyweight', formData(e.target)); toast('Logged'); ctx.reload(); } catch (err) { errToast(err); } };
  if ($('#lb', el)) $('#lb', el).onclick = async (e) => { e.preventDefault(); const r = await api.get('/api/leaderboard?test_key=squat'); modal({ title: r.test.label, body: html`<ul class="list" style="margin:-16px">${r.rows.map((x, i) => html`<li><b style="width:22px">${i + 1}</b><span class="grow">${x.name}</span><b>${x.best}</b></li>`)}</ul>`, actions: [{ label: 'Close' }] }); };
}

async function workout(el, ctx) {
  const { a, w, d } = ctx.params;
  const pid = ctx.me.user.role === 'player' ? ctx.me.user.id : Number(ctx.query.player);
  const wk = await api.get(`/api/workouts/player/${pid}/${a}/${w}/${d}`);
  ctx.setTitle(`Week ${w} · Day ${d}`);
  set(el, html`<div class="page-head"><div><h1>${wk.program_name}: week ${w}, day ${d}</h1><div class="sub">${wk.label || ''} · due ${fmtDate(wk.due)} · ${wk.logged_sets}/${wk.prescribed_sets} sets logged</div></div><div class="actions"><a class="btn" href="/weights">Back</a></div></div>
    <div class="stack">${wk.exercises.map((x) => html`<div class="card" data-ex="${x.exercise_id}"><div class="hd"><h2>${x.name}</h2>${x.overridden ? html`<span class="badge warn">Changed for you</span>` : ''}<span class="r s muted">${x.sets} × ${x.reps || ''}${x.pct ? ` @ ${x.pct}%` : ''}${x.load ? ` · ${x.load} lb` : ''}${x.rest ? ` · rest ${x.rest}` : ''}</span></div>
      <div class="bd">${x.cues ? html`<p class="s muted">${x.cues}${x.note ? ` · ${x.note}` : ''}</p>` : ''}${x.pct && !x.tested_max ? html`<p class="s" style="color:var(--warn)">No tested max on file — ask your coach for a starting load.</p>` : ''}
        <table><thead><tr><th>Set</th><th>Reps</th><th>Weight (lb)</th><th></th></tr></thead><tbody>${Array.from({ length: x.sets }, (_, i) => { const l = x.logged.find((y) => y.set_no === i + 1); return html`<tr data-set="${i + 1}"><td>${i + 1}</td><td><input type="number" inputmode="numeric" data-k="reps" value="${l?.reps ?? (String(x.reps).match(/^\d+$/) ? x.reps : '')}" style="width:80px"></td><td><input type="number" inputmode="decimal" step="2.5" data-k="weight" value="${l?.weight ?? x.load ?? ''}" style="width:100px"></td><td><button class="sm ${l ? '' : 'primary'}" data-log>${l ? 'Logged ✓' : 'Log set'}</button></td></tr>`; })}</tbody></table>
      </div></div>`)}</div>`);
  on(el, 'click', '[data-log]', async (e, b) => {
    const tr = b.closest('[data-set]'); const ex = Number(b.closest('[data-ex]').dataset.ex);
    const body2 = { assignment_id: Number(a), week: Number(w), day: Number(d), exercise_id: ex, set_no: Number(tr.dataset.set), reps: Number(tr.querySelector('[data-k=reps]').value), weight: Number(tr.querySelector('[data-k=weight]').value), client_id: uid(), player_id: pid };
    try { const r = await api.post('/api/wt-logs', body2, { offline: true }); b.textContent = r.queued ? 'Saved offline' : 'Logged ✓'; b.classList.remove('primary'); } catch (err) { errToast(err); }
  });
}
