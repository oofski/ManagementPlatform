// Module 10: Season tracking and player development — position-group view, player development record with
// timeline and trends vs group average, goals, evaluations, week-by-week season plan, end-of-season reports.
import { api } from '../api.js';
import { html, set, $, $$, on, modal, toast, errToast, formData, options, checked, field, fmtDate, fmtDT, cap, empty, bar, lineChart, legend,
  sortRows, tabs, UNIT, todayISO, confirmDialog, availBadge, raw } from '../ui.js';

let TESTS = {};
export default async function development(el, ctx) {
  TESTS = (await api.get('/api/weights/meta')).tests;
  const r = ctx.route;
  if (r === '/season') return seasonPlan(el, ctx);
  if (r === '/reports/player/:id') return playerReport(el, ctx, Number(ctx.params.id));
  if (r === '/reports/team') return teamReport(el, ctx);
  if (r === '/development/player/:id') return record(el, ctx, Number(ctx.params.id));
  if (!ctx.me.caps.staff) return record(el, ctx, Number(ctx.query.player || ctx.me.linked[0]?.id || ctx.me.user.id));
  const tab = ctx.query.tab || 'group';
  const t = tabs([['group', 'Position groups', '/development'], ['goals', 'Goals', '/development?tab=goals'], ['evals', 'Evaluations', '/development?tab=evals'], ['season', 'Season plan', '/season'], ['report', 'Team report', '/reports/team']], tab);
  if (tab === 'goals') return goalsTab(el, ctx, t);
  if (tab === 'evals') return evalsTab(el, ctx, t);
  return group(el, ctx, t);
}

async function group(el, ctx, t) {
  const q = ctx.query;
  const [rows, st] = await Promise.all([api.get(`/api/development-group?${new URLSearchParams(q)}`), api.get('/api/structure')]);
  const codes = [...new Set(st.positions.map((p) => p.code))];
  const key = q.sort || 'rating_avg'; const dir = q.dir === 'asc' ? 1 : -1;
  const list = sortRows(rows, key, dir);
  const th = (k, l) => html`<th class="sortable num" data-sort="${k}">${l}${key === k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  set(el, html`<div class="page-head"><div><h1>Development</h1><div class="sub">Built from ratings, attendance, testing and assignments coaches already enter. Visible to coaches only unless the program shares it.</div></div></div>${t}
    <div class="filters"><select data-f="position"><option value="">All positions</option>${options(codes, q.position)}</select><select data-f="unit"><option value="">All units</option>${options(Object.entries(UNIT), q.unit)}</select>
      <select data-f="team_id"><option value="">All teams</option>${options(st.levels.flatMap((l) => l.teams.map((x) => [x.id, x.name === l.name ? x.name : `${l.name} ${x.name}`])), q.team_id)}</select></div>
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th class="sortable" data-sort="name">Player</th><th>Pos</th><th>Status</th>${th('rating_avg', 'Season rating')}${th('rating_recent', 'Last 14 days')}${th('rating_trend', 'Trend')}${th('latest_rating', 'Latest')}${th('attendance_rate', 'Attendance')}${th('squat', 'Squat')}${th('forty', '40 yd')}${th('goals_active', 'Goals')}</tr></thead><tbody>
    ${list.map((p) => html`<tr class="click" onclick="__navigate('/development/player/${p.id}')"><td><b>${p.name}</b> <span class="faint">${p.jersey ?? ''}</span></td><td>${p.positions.join('/')}</td><td>${availBadge(p.availability)}</td>
      <td class="num">${p.rating_avg ?? '—'}<span class="faint" style="font-size:11px"> (${p.ratings})</span></td><td class="num">${p.rating_recent ?? '—'}</td><td class="num" style="color:${p.rating_trend > 0 ? 'var(--ok)' : p.rating_trend < 0 ? 'var(--bad)' : ''}">${p.rating_trend == null ? '—' : `${p.rating_trend > 0 ? '+' : ''}${p.rating_trend}`}</td>
      <td class="num">${p.latest_rating ?? '—'}</td><td class="num">${p.attendance_rate != null ? `${p.attendance_rate}%` : '—'}</td><td class="num">${p.squat ?? ''}</td><td class="num">${p.forty ?? ''}</td><td class="num">${p.goals_active || ''}</td></tr>`)}</tbody></table>${!list.length ? empty('No players.') : ''}</div></div>`);
  const go = (patch) => ctx.navigate('/development?' + new URLSearchParams(Object.fromEntries(Object.entries({ ...q, ...patch }).filter(([, v]) => v))));
  $$('[data-f]', el).forEach((s) => { s.onchange = () => go({ [s.dataset.f]: s.value }); });
  on(el, 'click', '[data-sort]', (e, b) => go({ sort: b.dataset.sort, dir: key === b.dataset.sort && dir < 0 ? 'asc' : 'desc' }));
}

const KIND = { rating: ['Rating', 'green'], note: ['Note', ''], attendance: ['Attendance', 'warn'], test: ['Test', 'blue'], assignment: ['Assignment', ''], depth: ['Depth chart', 'green'] };
async function record(el, ctx, pid) {
  const d = await api.get(`/api/development/${pid}`);
  const staff = ctx.me.caps.staff;
  const coach = staff && ctx.me.user.role !== 'staff';
  ctx.setTitle(staff ? `${d.player.name} · development` : 'My progress');
  const tr = d.trends;
  const kinds = [...new Set(d.timeline.map((x) => x.kind))];
  const sel = ctx.query.kind || '';
  set(el, html`<div class="page-head"><div><h1>${d.player.name} ${d.player.jersey != null ? html`<span class="muted">#${d.player.jersey}</span>` : ''}</h1><div class="sub">${[d.player.level, d.player.positions.join('/'), d.season?.name].filter(Boolean).join(' · ')}</div></div>
    <div class="actions">${ctx.me.linked.length > 1 ? html`<select id="pp">${options(ctx.me.linked.map((p) => [p.id, p.name]), pid)}</select>` : ''}${staff ? html`<a class="btn" href="/players/${pid}">Profile</a><a class="btn" href="/reports/player/${pid}">Season report</a>` : ''}${coach ? html`<button id="goal">Add goal</button><button class="primary" id="eval">Evaluate</button>` : ''}</div></div>
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card stat"><div class="k">Attendance</div><div class="v">${d.attendance_rate != null ? `${d.attendance_rate}%` : '—'}</div>${tr?.group_attendance != null ? html`<div class="d">${tr.group_label}: ${tr.group_attendance}%</div>` : ''}</div>
      <div class="card stat"><div class="k">Assignments done</div><div class="v">${d.assignment_rate != null ? `${d.assignment_rate}%` : '—'}</div></div>
      <div class="card stat"><div class="k">Active goals</div><div class="v">${d.goals.filter((g) => g.status === 'active').length}</div></div>
      <div class="card stat"><div class="k">Ratings this season</div><div class="v">${tr?.ratings ? tr.ratings.reduce((s, r) => s + r.n, 0) : '—'}</div></div>
    </div>
    <div class="grid g-side">
      <div class="stack">
        ${tr ? html`${tr.ratings.length ? html`<div class="card"><div class="hd"><h2>Practice ratings by week</h2></div><div class="bd">${lineChart([{ label: d.player.name, points: tr.ratings.map((r) => [r.week, r.avg]) }, ...(tr.group_ratings.length ? [{ label: tr.group_label, points: tr.group_ratings.map((r) => [r.week, r.avg]), dashed: true }] : [])], { yMin: 1, yMax: ctx.me.settings.rating_scale || 5 })}${legend([{ label: d.player.name }, ...(tr.group_ratings.length ? [{ label: `${tr.group_label} average` }] : [])])}</div></div>` : ''}
        <div class="card"><div class="hd"><h2>Testing</h2></div><div class="bd grid g2">${Object.entries(tr.tests).map(([k, pts]) => html`<div><h4>${TESTS[k]?.label || k}${tr.group_tests?.[k] != null ? html` <span class="faint" style="text-transform:none;letter-spacing:0">· group best avg ${tr.group_tests[k]}</span>` : ''}</h4>${lineChart([{ label: TESTS[k]?.label, points: pts.map((p) => [p.date, p.value]) }], { height: 140 })}</div>`)}${!Object.keys(tr.tests).length ? empty('No testing yet.') : ''}</div></div>
        ${tr.attendance.length ? html`<div class="card"><div class="hd"><h2>Attendance by month</h2></div><div class="bd">${lineChart([{ label: 'Attendance %', points: tr.attendance.map((a) => [a.month, a.rate]) }], { height: 140, yMin: 0, yMax: 100 })}</div></div>` : ''}` : ''}
        <div class="card"><div class="hd"><h2>Timeline</h2><span class="r"><select id="kind" style="width:auto">${options(kinds.map((k) => [k, KIND[k]?.[0] || k]), sel, { blank: 'Everything' })}</select></span></div>
          ${d.timeline.length ? html`<ul class="timeline">${d.timeline.filter((x) => !sel || x.kind === sel).slice(0, 150).map((x) => html`<li><span class="when">${x.date ? fmtDate(x.date, { dow: false }) : ''}</span><span><span class="badge ${KIND[x.kind]?.[1] || ''}">${KIND[x.kind]?.[0] || x.kind}</span></span><span>${x.text}${x.by ? html` <span class="faint">· ${x.by}</span>` : ''}</span></li>`)}</ul>` : empty('Nothing recorded yet this season.')}</div>
      </div>
      <div class="stack">
        <div class="card"><div class="hd"><h2>Goals</h2></div>${d.goals.length ? html`<ul class="list">${d.goals.map((g) => html`<li><div class="grow"><div class="t">${g.title} ${g.achieved ? html`<span class="badge ok">Achieved</span>` : g.status !== 'active' ? html`<span class="badge">${cap(g.status)}</span>` : ''}</div>
          <div class="s">${g.kind === 'test' ? `${TESTS[g.test_key]?.label}: ${g.baseline ?? '—'} → now ${g.current ?? '—'} · target ${g.target}` : g.notes || ''}${g.due ? ` · by ${fmtDate(g.due, { dow: false })}` : ''}</div><div style="margin-top:4px">${bar(g.pct)}</div></div>
          ${coach ? html`<button class="sm" data-g="${g.id}">Update</button>` : ''}</li>`)}</ul>` : empty('No goals yet.')}</div>
        ${d.evaluations ? html`<div class="card"><div class="hd"><h2>Evaluations</h2></div>${d.evaluations.length ? html`<ul class="list">${d.evaluations.map((e) => html`<li style="display:block"><div class="row between"><b>${cap(e.point)}</b><span class="s">${e.by_name} · ${fmtDate(e.at, { dow: false })}</span></div><div class="s">${Object.entries(e.scores).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>${e.notes ? html`<div class="s muted">${e.notes}</div>` : ''}</li>`)}</ul>` : empty('No evaluations yet.')}</div>` : ''}
      </div>
    </div>`);
  if ($('#pp', el)) $('#pp', el).onchange = (e) => ctx.navigate(`/development?player=${e.target.value}`);
  $('#kind', el).onchange = (e) => ctx.navigate(`${location.pathname}?${new URLSearchParams({ ...ctx.query, kind: e.target.value })}`);
  if (!coach) return;
  $('#goal', el).onclick = () => goalForm(ctx, pid);
  $('#eval', el).onclick = () => evalForm(ctx, d.player);
  on(el, 'click', '[data-g]', (e, b) => { const g = d.goals.find((x) => x.id === Number(b.dataset.g)); modal({ title: g.title, body: html`<form id="uf">${g.kind !== 'test' ? field('Progress %', html`<input type="number" name="progress" min="0" max="100" value="${g.progress}">`) : field('Target', html`<input type="number" name="target" value="${g.target}">`)}${field('Status', html`<select name="status">${options([['active', 'Active'], ['achieved', 'Achieved'], ['dropped', 'Dropped']], g.status)}</select>`)}${field('Notes', html`<textarea name="notes">${g.notes || ''}</textarea>`)}</form>`,
    actions: [{ label: 'Delete', danger: true, onClick: async () => { await api.del(`/api/goals/${g.id}`); ctx.reload(); } }, { label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => { await api.put(`/api/goals/${g.id}`, formData(r.querySelector('#uf'))); ctx.reload(); } }] }); });
}

function goalForm(ctx, pid, players) {
  const m = modal({ title: 'New development goal', body: html`<form id="gf">${players ? field('Player', html`<select name="player_id">${options(players.map((p) => [p.id, p.name]))}</select>`) : ''}${field('Goal', html`<input name="title" required placeholder="Squat 315 by playoffs">`)}
    ${field('Kind', html`<select name="kind" id="gk">${options([['skill', 'Skill (coach updates progress)'], ['test', 'Test target (tracked automatically)']])}</select>`)}
    <div id="gt" hidden class="fields">${field('Test', html`<select name="test_key">${options(Object.entries(TESTS).map(([k, t]) => [k, t.label]))}</select>`)}${field('Target', html`<input type="number" step="0.01" name="target">`)}</div>
    ${field('By', html`<input type="date" name="due">`)}${field('Notes', html`<textarea name="notes"></textarea>`)}</form>`,
  actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#gf')); await api.post('/api/goals', { ...f, player_id: pid || Number(f.player_id), target: f.target === '' ? null : Number(f.target) }); toast('Goal set; the player can see it'); ctx.reload(); } }] });
  m.root.querySelector('#gk').onchange = (e) => { m.root.querySelector('#gt').hidden = e.target.value !== 'test'; };
}
async function evalForm(ctx, player) {
  const meta = await api.get('/api/evaluations/meta');
  const unit = player.units?.[0] || 'offense';
  modal({ title: `Evaluate ${player.name}`, body: html`<form id="ef"><div class="fields">${field('When', html`<select name="point">${options(meta.points.map((p) => [p, cap(p === 'end' ? 'end of season' : p)]))}</select>`)}${field('Position', html`<input name="position" value="${player.positions?.[0] || ''}">`)}</div>
    <table><tbody>${meta.criteria[unit].map((c) => html`<tr><td>${c}</td><td>${[1, 2, 3, 4, 5].map((n) => html`<label class="check" style="margin-right:6px"><input type="radio" name="c_${c}" value="${n}" ${checked(n === 3)}> ${n}</label>`)}</td></tr>`)}</tbody></table>${field('Notes', html`<textarea name="notes"></textarea>`)}</form>`,
  actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#ef')); const scores = Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith('c_')).map(([k, v]) => [k.slice(2), Number(v)])); await api.post('/api/evaluations', { player_id: player.id, point: f.point, position: f.position, notes: f.notes, scores }); toast('Evaluation saved'); ctx.reload(); } }] });
}

async function goalsTab(el, ctx, t) {
  const [goals, players] = await Promise.all([api.get('/api/goals'), api.get('/api/players')]);
  set(el, html`<div class="page-head"><div><h1>Development</h1></div><div class="actions"><button class="primary" id="new">New goal</button></div></div>${t}
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th>Player</th><th>Goal</th><th>Progress</th><th>Status</th><th>By</th></tr></thead><tbody>${goals.map((g) => html`<tr class="click" onclick="__navigate('/development/player/${g.player_id}')"><td>${g.player_name}</td><td>${g.title}<div class="s muted">${g.kind === 'test' ? `${TESTS[g.test_key]?.label}: now ${g.current ?? '—'} / ${g.target}` : ''}</div></td><td style="width:160px">${bar(g.pct)}</td><td>${g.achieved ? html`<span class="badge ok">Achieved</span>` : html`<span class="badge">${cap(g.status)}</span>`}</td><td>${g.due ? fmtDate(g.due, { dow: false }) : ''}</td></tr>`)}</tbody></table>${!goals.length ? empty('No goals yet.') : ''}</div></div>`);
  $('#new', el).onclick = () => goalForm(ctx, null, players);
}
async function evalsTab(el, ctx, t) {
  const point = ctx.query.point || '';
  const list = await api.get(`/api/evaluations${point ? `?point=${point}` : ''}`);
  const crit = [...new Set(list.flatMap((e) => Object.keys(e.scores)))];
  set(el, html`<div class="page-head"><div><h1>Development</h1><div class="sub">Structured evaluations at preseason, midseason and end of season, by position criteria.</div></div></div>${t}
    <div class="filters"><select id="pt">${options([['', 'All points'], ['preseason', 'Preseason'], ['midseason', 'Midseason'], ['end', 'End of season']], point)}</select></div>
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th>Player</th><th>Point</th>${crit.map((c) => html`<th class="num">${c}</th>`)}<th class="num">Avg</th><th>By</th></tr></thead><tbody>${list.map((e) => { const v = Object.values(e.scores); return html`<tr class="click" onclick="__navigate('/development/player/${e.player_id}')"><td>${e.player_name}</td><td>${cap(e.point)}</td>${crit.map((c) => html`<td class="num">${e.scores[c] ?? ''}</td>`)}<td class="num"><b>${v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : ''}</b></td><td class="s">${e.by_name}</td></tr>`; })}</tbody></table>${!list.length ? empty('No evaluations yet. Open a player and choose Evaluate.') : ''}</div></div>`);
  $('#pt', el).onchange = (e) => ctx.navigate(`/development?tab=evals${e.target.value ? `&point=${e.target.value}` : ''}`);
}

async function seasonPlan(el, ctx) {
  const seasons = await api.get('/api/seasons');
  const sid = Number(ctx.query.season || seasons.find((s) => s.active)?.id || seasons[0]?.id);
  const admin = ctx.me.caps.admin;
  if (!sid) { set(el, html`<div class="notice">No seasons yet.</div>${admin ? html`<button class="primary" id="ns">Create season</button>` : ''}`); if (admin) $('#ns', el).onclick = () => seasonForm(ctx); return; }
  const plan = await api.get(`/api/seasons/${sid}/plan`);
  const s = plan.season;
  const t = tabs([['group', 'Position groups', '/development'], ['goals', 'Goals', '/development?tab=goals'], ['evals', 'Evaluations', '/development?tab=evals'], ['season', 'Season plan', '/season'], ['report', 'Team report', '/reports/team']], 'season');
  const thisWeek = plan.weeks.find((w) => w.from <= todayISO() && w.to >= todayISO());
  set(el, html`<div class="page-head"><div><h1>${s.name}</h1><div class="sub">${fmtDate(s.start_date, { year: true })} – ${fmtDate(s.end_date, { year: true })}${s.active ? ' · active season' : ''}</div></div>
    <div class="actions"><select id="ss">${options(seasons.map((x) => [x.id, x.name]), sid)}</select>${admin ? html`${!s.active ? html`<button id="act">Make active</button>` : ''}<button id="edit">Edit phases</button><button class="primary" id="ns">New season</button>` : ''}<button onclick="window.print()">Print</button></div></div>${t}
    <div class="row" style="margin-bottom:12px">${(s.phases || []).map((p) => html`<div class="card" style="padding:8px 12px;flex:1;min-width:180px"><b>${p.name}</b><div class="s muted">${fmtDate(p.start, { dow: false })} – ${fmtDate(p.end, { dow: false })}</div>${p.goals ? html`<div class="s">${p.goals}</div>` : ''}</div>`)}</div>
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th>Week</th><th>Phase</th><th>Games</th><th>Practices</th><th>Key dates</th><th>Week goal</th></tr></thead><tbody>
    ${plan.weeks.map((w) => html`<tr class="${w === thisWeek ? 'type-practice' : ''}" id="w${w.week}"><td style="white-space:nowrap"><b>${w.week}</b> <span class="s muted">${fmtDate(w.from, { dow: false })}</span></td><td class="s">${w.phase || ''}</td>
      <td>${w.games.map((g) => html`<div><a href="/calendar/${g.id}">${g.title}</a> <span class="s muted">${fmtDate(g.start)}</span></div>`)}</td>
      <td>${w.practices.length ? html`<span class="s">${w.practices.length} practice(s): ${w.practices.map((p) => (p.plan_id ? html`<a href="/practice/${p.plan_id}">${fmtDate(p.start, { dow: true }).slice(0, 3)}</a> ` : html`<span class="faint">${fmtDate(p.start).slice(0, 3)}</span> `))}</span>` : ''}</td>
      <td class="s">${w.key_dates.map((k) => html`<div>${k.title}</div>`)}</td>
      <td>${ctx.me.caps['practice.edit'] ? html`<input data-wg="${w.from}" value="${w.week_goal || ''}" placeholder="Goal for the week" style="min-width:160px">` : w.week_goal || ''}</td></tr>`)}</tbody></table></div></div>`);
  if (thisWeek) setTimeout(() => $(`#w${thisWeek.week}`, el)?.scrollIntoView({ block: 'center' }), 50);
  $('#ss', el).onchange = (e) => ctx.navigate(`/season?season=${e.target.value}`);
  on(el, 'change', '[data-wg]', async (e, i) => { await api.put(`/api/seasons/${sid}/week-goal`, { week_from: i.dataset.wg, goal: i.value }); toast('Week goal saved'); });
  if (!admin) return;
  if ($('#act', el)) $('#act', el).onclick = async () => { await api.post(`/api/seasons/${sid}/activate`); await ctx.refreshMe(); ctx.reload(); };
  $('#ns', el).onclick = () => seasonForm(ctx);
  $('#edit', el).onclick = () => seasonForm(ctx, s);
}
function seasonForm(ctx, s = null) {
  let phases = s ? JSON.parse(JSON.stringify(s.phases || [])) : [{ name: 'Offseason', start: '', end: '' }, { name: 'Summer', start: '', end: '' }, { name: 'Preseason and camp', start: '', end: '' }, { name: 'In-season', start: '', end: '' }, { name: 'Playoffs', start: '', end: '' }];
  const m = modal({ title: s ? `Edit ${s.name}` : 'New season', wide: true, body: html`<form id="sf"><div class="fields">${field('Name', html`<input name="name" value="${s?.name || ''}" required>`)}${field('Start', html`<input type="date" name="start_date" value="${s?.start_date || ''}" required>`)}${field('End', html`<input type="date" name="end_date" value="${s?.end_date || ''}" required>`)}</div>
    <h4>Phases</h4><div id="ph"></div><button type="button" class="sm" id="addp">Add phase</button>${!s ? html`<div style="margin-top:10px"><label class="check"><input type="checkbox" name="activate"> Make this the active season</label></div>` : ''}</form>`,
  actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#sf')); const body = { ...f, phases: phases.filter((p) => p.name && p.start && p.end) }; if (s) await api.put(`/api/seasons/${s.id}`, body); else await api.post('/api/seasons', body); await ctx.refreshMe(); ctx.reload(); } }] });
  const dp = () => set(m.root.querySelector('#ph'), phases.map((p, i) => html`<div class="inline-input" style="margin-bottom:6px" data-pi="${i}"><input data-k="name" value="${p.name}" placeholder="Phase"><input type="date" data-k="start" value="${p.start}"><input type="date" data-k="end" value="${p.end}"><input data-k="goals" value="${p.goals || ''}" placeholder="Goals for this phase"><button type="button" class="sm ghost danger" data-rm="${i}">✕</button></div>`));
  dp();
  m.root.querySelector('#ph').addEventListener('input', (e) => { const r = e.target.closest('[data-pi]'); if (r) phases[Number(r.dataset.pi)][e.target.dataset.k] = e.target.value; });
  on(m.root, 'click', '[data-rm]', (e, b) => { phases.splice(Number(b.dataset.rm), 1); dp(); });
  m.root.querySelector('#addp').onclick = () => { phases.push({ name: '', start: '', end: '' }); dp(); };
}

async function playerReport(el, ctx, id) {
  const r = await api.get(`/api/season-report/player/${id}`);
  ctx.setTitle(`Season report · ${r.player.name}`);
  set(el, html`<div class="page-head"><div><h1>End-of-season report</h1><div class="sub">${r.player.name} · ${r.season?.name || ''} · generated ${fmtDT(r.generated_at)}</div></div><div class="actions"><a class="btn" href="/development/player/${id}">Back</a><button class="primary" onclick="window.print()">Save as PDF</button></div></div>
    <div class="card" style="margin-bottom:14px"><div class="bd"><dl class="kv"><dt>Player</dt><dd>${r.player.name}${r.player.jersey != null ? ` #${r.player.jersey}` : ''}</dd><dt>Team</dt><dd>${r.player.team || ''}</dd><dt>Positions</dt><dd>${r.player.positions.join(', ')}</dd><dt>Class</dt><dd>${r.player.class_year || ''}</dd></dl></div></div>
    <div class="grid g3" style="margin-bottom:14px"><div class="card stat"><div class="k">Attendance</div><div class="v">${r.attendance_rate ?? '—'}%</div></div><div class="card stat"><div class="k">Average practice rating</div><div class="v">${r.ratings.avg ?? '—'}</div><div class="d">${r.ratings.n} ratings</div></div><div class="card stat"><div class="k">Assignments completed</div><div class="v">${r.assignments.done || 0}/${r.assignments.total}</div></div></div>
    <div class="grid g2"><div class="card"><div class="hd"><h2>Testing</h2></div><div class="bd flush"><table><thead><tr><th>Test</th><th class="num">First</th><th class="num">Last</th><th class="num">Best</th></tr></thead><tbody>${Object.values(r.tests).map((t) => html`<tr><td>${t.label}</td><td class="num">${t.first}</td><td class="num">${t.last}</td><td class="num"><b>${t.best}</b> ${t.unit}</td></tr>`)}</tbody></table></div></div>
    <div class="card"><div class="hd"><h2>Evaluations</h2></div>${r.evaluations.length ? html`<ul class="list">${r.evaluations.map((e) => html`<li style="display:block"><b>${cap(e.point)}</b><div class="s">${Object.entries(e.scores).map(([k, v]) => `${k} ${v}`).join(' · ')}</div></li>`)}</ul>` : empty('None.')}</div>
    <div class="card"><div class="hd"><h2>Goals</h2></div>${r.goals.length ? html`<ul class="list">${r.goals.map((g) => html`<li><span class="grow">${g.title}</span>${g.achieved ? html`<span class="badge ok">Achieved</span>` : html`<span class="s">${g.pct}%</span>`}</li>`)}</ul>` : empty('None.')}</div></div>`);
}
async function teamReport(el, ctx) {
  const r = await api.get('/api/season-report/team');
  const t = tabs([['group', 'Position groups', '/development'], ['goals', 'Goals', '/development?tab=goals'], ['evals', 'Evaluations', '/development?tab=evals'], ['season', 'Season plan', '/season'], ['report', 'Team report', '/reports/team']], 'report');
  set(el, html`<div class="page-head"><div><h1>Team season report</h1><div class="sub">${r.season?.name || ''} · generated ${fmtDT(r.generated_at)}</div></div><div class="actions"><button class="primary" onclick="window.print()">Save as PDF</button></div></div>${ctx.me.caps.staff ? t : ''}
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card stat"><div class="k">Roster</div><div class="v">${r.roster}</div></div><div class="card stat"><div class="k">Attendance</div><div class="v">${r.attendance_rate ?? '—'}%</div></div>
      <div class="card stat"><div class="k">Practices held</div><div class="v">${r.practices}</div><div class="d">${r.plans_with_notes} with notes</div></div><div class="card stat"><div class="k">Practice ratings</div><div class="v">${r.ratings.n}</div><div class="d">avg ${r.ratings.avg ?? '—'}</div></div>
    </div>
    <div class="grid g2"><div class="card"><div class="hd"><h2>Games</h2></div><ul class="list">${r.games.map((g) => html`<li><span class="grow">${g.title}</span><span class="s">${fmtDate(g.start, { dow: false })}</span>${g.status !== 'scheduled' ? html`<span class="badge">${g.status}</span>` : ''}</li>`)}</ul></div>
    <div class="card"><div class="hd"><h2>Program</h2></div><div class="bd"><dl class="kv"><dt>Test results recorded</dt><dd>${r.prs}</dd><dt>Equipment still out</dt><dd>${r.equipment_outstanding}</dd></dl></div></div></div>`);
}
