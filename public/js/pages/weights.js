// Module 6: Weight room and nutrition — coach dashboard, programs (builder, templates, assignment, overrides),
// exercise library, testing days and leaderboard, private body weight, meal plans with approval and adherence;
// player workout logging (offline-safe) and meal check-offs.
import { api, uid } from '../api.js';
import { html, set, $, $$, on, modal, toast, errToast, formData, options, checked, field, audienceField, wireAudience, fmtDate, todayISO, cap, empty, bar,
  confirmDialog, tabs, lineChart, legend, UNIT, raw, parseCSV } from '../ui.js';

import * as wr from './weightroom.js';
import { renderFeed } from './feed.js';
import { icon } from '../icons.js';

let TESTS = {};
export default async function weights(el, ctx) {
  TESTS = (await api.get('/api/weights/meta')).tests;
  if (ctx.route === '/weights/workout/:a/:w/:d') return workout(el, ctx);
  if (ctx.route === '/weights/program/:id') return wr.builder(el, ctx, ctx.params.id);
  if (!ctx.me.caps.staff) return family(el, ctx);
  const tab = ctx.query.tab || 'dashboard';
  const t = tabs([['dashboard', 'Dashboard', '/weights'], ['programs', 'Programs', '/weights?tab=programs'], ['templates', 'Templates', '/weights?tab=templates'], ['exercises', 'Exercises', '/weights?tab=exercises'],
    ['testing', 'Testing', '/weights?tab=testing'], ['leaderboards', 'Leaderboards', '/weights?tab=leaderboards'], ['wellness', 'Wellness', '/weights?tab=wellness'], ['reports', 'Reports', '/weights?tab=reports'],
    ['feed', 'Team feed', '/weights?tab=feed'], ['body', 'Body weight', '/weights?tab=body'], ['nutrition', 'Meal plans', '/weights?tab=nutrition']], tab);
  const head = html`<div class="page-head"><div><h1>Weight room and nutrition</h1><div class="sub">Programs, testing, wellness and meal plans. Body weight stays with coaches and never appears on leaderboards.</div></div>
    <div class="actions">${ctx.me.caps['weights.edit'] ? html`<a class="btn" href="/weights/station">${icon('users', 14)} Station mode</a>` : ''}<a class="btn" href="/weights/tv">${icon('external', 14)} TV display</a></div></div>${t}`;
  if (tab === 'programs') return wr.programs(el, ctx, head);
  if (tab === 'templates') return wr.templates(el, ctx, head);
  if (tab === 'exercises') return wr.exercises(el, ctx, head);
  if (tab === 'testing') return wr.testing(el, ctx, head);
  if (tab === 'leaderboards') return wr.leaderboards(el, ctx, head);
  if (tab === 'wellness') return wr.wellnessDash(el, ctx, head);
  if (tab === 'reports') return wr.reports(el, ctx, head);
  if (tab === 'feed') { set(el, html`${head}<div id="feedbox"></div>`); return renderFeed($('#feedbox', el), ctx); }
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
    ${d.rows.some((r) => r.availability && r.availability !== 'available') ? html`<div class="notice warn">${d.rows.filter((r) => r.availability && r.availability !== 'available').length} athlete(s) on this program are limited or out: ${d.rows.filter((r) => r.availability && r.availability !== 'available').map((r) => `${r.name} (${r.availability})`).join(', ')}.</div>` : ''}
    <div class="grid g3" style="margin-bottom:14px">
      <div class="card stat"><div class="k">${d.mode === 'dateless' ? 'Sessions in the program' : 'Workouts due so far'}</div><div class="v">${d.due_days}</div></div>
      <div class="card stat"><div class="k">Players up to date</div><div class="v">${d.rows.length - behind.length}<span class="muted" style="font-size:14px"> / ${d.rows.length}</span></div></div>
      <div class="card stat"><div class="k">Behind</div><div class="v" style="color:var(--bad)">${behind.length}</div></div>
    </div>
    <div class="grid g-side">
      <div class="card"><div class="hd"><h2>Completion</h2>${d.mode === 'dateless' ? html`<span class="r s muted">Dateless program: sessions finished in order</span>` : ''}</div><div class="bd flush tbl-wrap"><table><thead><tr><th>Player</th><th>Positions</th><th class="num">Done</th><th>Progress</th><th class="num">Behind</th><th class="num" title="Lift sessions attended in a row">Streak</th><th>Last log</th></tr></thead><tbody>
        ${d.rows.map((r) => html`<tr class="click" onclick="__navigate('/development/player/${r.id}')"><td><b>${r.name}</b> <span class="faint">${r.jersey ?? ''}</span>${wr.flagAvail(r)}</td><td>${r.positions.join(', ')}</td><td class="num">${r.completed}/${r.due}</td><td style="width:140px">${bar(r.due ? (r.completed / r.due) * 100 : 100, r.behind > 1 ? 'bad' : r.behind ? 'warn' : '')}</td><td class="num">${r.behind || ''}</td><td class="num">${r.streak || ''}</td><td>${r.last_log ? fmtDate(r.last_log, { dow: false }) : html`<span class="faint">never</span>`}</td></tr>`)}
      </tbody></table></div></div>
      <div class="card"><div class="hd"><h2>Group progress (average max)</h2></div><div class="bd">
        ${lineChart(Object.entries(d.progress).map(([k, pts]) => ({ label: TESTS[k]?.label || k, points: pts.map((p) => [p.month, p.avg]) })), { height: 220 })}
        ${legend(Object.keys(d.progress).map((k) => ({ label: TESTS[k]?.label || k })))}
      </div></div>
    </div>`}`);
  $$('[data-f]', el).forEach((s) => { s.onchange = () => ctx.navigate('/weights?' + new URLSearchParams(Object.fromEntries(Object.entries({ ...q, [s.dataset.f]: s.value }).filter(([, v]) => v)))); });
}

async function body(el, ctx, head) {
  const players = await api.get('/api/players');
  const pid = Number(ctx.query.player || 0);
  let hist = null; let err = null;
  if (pid) { try { hist = await api.get(`/api/bodyweight/${pid}`); } catch (e) { err = e.message; } }
  const m = await wr.meta();
  const fam = !!m.settings.family_sees_bodyweight;
  set(el, html`${head}<div class="notice">Body weight is visible to coaches who have been granted body-data access${fam ? ', and to the player and their parents' : ''}. It never appears on leaderboards, group views or shared screens.</div>
    <div class="filters"><select id="pl">${options(players.map((p) => [p.id, `${p.name}${p.jersey != null ? ' #' + p.jersey : ''}`]), pid || '', { blank: 'Choose a player' })}</select><span class="spacer"></span>
      ${m.is_admin ? html`<label class="check"><input type="checkbox" id="fam" ${checked(fam)}> Players and parents can see their own body weight</label>` : ''}</div>
    ${err ? html`<div class="notice bad">${err}</div>` : hist ? html`<div class="grid g-side"><div class="card"><div class="hd"><h2>Body weight trend</h2>${hist.length > 1 ? html`<span class="r s muted">${(hist[hist.length - 1].value - hist[0].value > 0 ? '+' : '') + Math.round((hist[hist.length - 1].value - hist[0].value) * 10) / 10} lb since ${fmtDate(hist[0].date, { dow: false })}</span>` : ''}</div><div class="bd">${lineChart([{ label: 'Body weight', points: hist.map((h) => [h.date, h.value]) }])}<p class="help">Includes weigh-ins, testing-day weights and roster weights.</p></div></div>
      <div class="card"><div class="hd"><h2>Record weigh-in</h2></div><div class="bd"><form id="bw" class="inline-input"><input type="number" name="value" step="0.5" placeholder="lb" required><input type="date" name="date" value="${todayISO()}"><button class="primary">Save</button></form></div>
      <ul class="list">${hist.slice().reverse().map((h) => html`<li><span class="grow">${fmtDate(h.date)} ${h.kind === 'weight' ? html`<span class="faint">testing or roster</span>` : ''}</span><b>${h.value} lb</b><span class="s">${h.by_name || ''}</span></li>`)}</ul></div></div>` : empty('Choose a player to see their weigh-ins.')}`);
  $('#pl', el).onchange = (e) => ctx.navigate(`/weights?tab=body&player=${e.target.value}`);
  if ($('#fam', el)) $('#fam', el).onchange = async (e) => { try { await api.put('/api/strength/settings', { family_sees_bodyweight: e.target.checked }); await wr.meta(true); toast('Saved'); ctx.reload(); } catch (x) { errToast(x); } };
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

// ---------- player / parent (C-12 phone view) ----------
async function family(el, ctx) {
  const parent = ctx.me.user.role === 'parent';
  const players = ctx.me.linked;
  const pid = Number(ctx.query.player || players[0]?.id || 0);
  if (!pid) { set(el, empty('No linked player.')); return; }
  const [workouts, meals, logs, tests, prof, bw, sum, m] = await Promise.all([
    parent ? Promise.resolve([]) : api.get(`/api/workouts/player/${pid}`), api.get('/api/meal-plans'), api.get(`/api/meal-logs?player_id=${pid}`),
    api.get(`/api/tests?player_id=${pid}`), api.get(`/api/players/${pid}`), api.get(`/api/bodyweight/${pid}`).catch(() => null), api.get(`/api/strength/athlete/${pid}`).catch(() => null), wr.meta(),
  ]);
  const optOut = !!prof.nutrition_opt_out;
  const done = new Set(logs.meals.filter((x) => x.done).map((x) => `${x.plan_id}:${x.meal_idx}`));
  const hyd = new Set(logs.hydration.filter((h) => h.met).map((h) => h.plan_id));
  const nexts = workouts.map((a) => ({ a, d: a.days.find((x) => x.next) })).filter((x) => x.d);
  const fmtV = (k, v) => (TESTS[k]?.unit === 's' ? Number(v).toFixed(2) : v);
  set(el, html`<div class="page-head"><div><h1>${parent ? `${prof.name}: training and nutrition` : 'Weight room'}</h1><div class="sub">${parent ? 'What your player was assigned and how it is going.' : 'Your next session, maxes, personal records and meal plan.'}</div></div>
    <div class="actions">${players.length > 1 ? html`<select id="pp">${options(players.map((p) => [p.id, p.name]), pid)}</select>` : ''}<a class="btn" href="/weights/feed">Team feed</a>${!parent ? html`<a class="btn" href="/weights/wellness">Daily check-in</a>` : ''}${m.settings.leaderboard ? html`<a class="btn" href="#" id="lb">Leaderboards</a>` : ''}</div></div>
    ${!parent && sum && !sum.wellness_today ? html`<div class="notice">You have not done today's check-in yet. <a href="/weights/wellness">Two minutes: sleep, soreness, mood and stress.</a></div>` : ''}
    ${!parent && nexts.length ? html`<div class="stack" style="margin-bottom:14px">${nexts.map(({ a, d }) => html`<a class="card wr-next" href="/weights/workout/${a.id}/${d.week}/${d.day}"><div class="bd"><div class="s muted">${a.mode === 'dateless' ? 'Next session' : d.due === todayISO() ? 'Today' : `Next: ${fmtDate(d.due)}`} · ${a.program_name}</div>
      <div class="wr-next-t">Week ${d.week}, day ${d.day}${d.label ? `: ${d.label}` : ''}</div><div class="s">${d.exercises.slice(0, 4).map((x) => x.name).join(' · ')}${d.exercises.length > 4 ? ` +${d.exercises.length - 4}` : ''} · ${d.logged_sets}/${d.prescribed_sets} sets</div></div></a>`)}</div>` : ''}
    <div class="grid g-side"><div class="stack">
      ${!parent ? html`<div class="card"><div class="hd"><h2>All sessions</h2></div>${workouts.length ? workouts.map((a) => html`<div style="padding:10px 14px;border-bottom:1px solid var(--border)"><b>${a.program_name}</b><span class="muted"> · ${a.mode === 'dateless' ? 'work through in order' : `from ${fmtDate(a.start_date)}`}</span>
        <div class="row wr-daybtns" style="margin-top:6px">${a.days.map((d) => html`<a class="btn sm ${d.complete ? '' : d.next ? 'primary' : ''}" href="/weights/workout/${a.id}/${d.week}/${d.day}">W${d.week}D${d.day} ${d.label || ''}${d.complete ? html` ${icon('check', 12)}` : ''}</a>`)}</div></div>`) : empty('No lifting program assigned yet.')}</div>` : ''}
      <div class="card"><div class="hd"><h2>Today’s meal plan</h2><span class="r">${!optOut ? html`<button class="sm" id="opt">Opt out of nutrition tracking</button>` : html`<button class="sm" id="optin">Opt back in</button>`}</span></div>
        ${optOut ? html`<div class="bd muted">Nutrition tracking is off for ${parent ? prof.name : 'you'}. Everything else in the app still works.</div>` : meals.length ? meals.map((mp) => html`<div style="padding:10px 14px;border-bottom:1px solid var(--border)"><b>${mp.name}</b>
          <ul class="list">${mp.meals.map((x, i) => html`<li><label class="check" style="flex:1"><input type="checkbox" data-meal="${mp.id}:${i}" ${checked(done.has(`${mp.id}:${i}`))} ${parent ? raw('disabled') : ''}> <b>${x.time || ''}</b> ${x.name} <span class="muted">${x.description || ''}</span></label></li>`)}
          <li><label class="check"><input type="checkbox" data-hyd="${mp.id}" ${checked(hyd.has(mp.id))} ${parent ? raw('disabled') : ''}> Hit ${mp.hydration_oz || ''} oz of water today</label></li></ul></div>`) : empty('No meal plan assigned.')}
      </div>
    </div><div class="stack">
      ${sum ? html`<div class="card"><div class="hd"><h2>Training maxes</h2><span class="r s muted">Lift streak ${sum.streak}</span></div>${sum.maxes.length ? html`<ul class="list">${sum.maxes.map((x) => html`<li><span class="grow">${x.label}</span><b>${x.max ?? x.best} lb</b><span class="s">${x.training ? 'from training' : 'tested'}</span></li>`)}</ul>` : empty('No maxes yet.')}
        ${sum.clubs.length ? html`<div class="bd" style="border-top:1px solid var(--line)">${sum.clubs.map((c) => html`<span class="badge ok" style="margin:0 4px 4px 0">${c.title.replace(`${prof.name} joined the `, '')}</span>`)}</div>` : ''}
        <div class="ft s muted">Your training max goes up on its own when a logged set estimates a higher 1-rep max. Percent loads use it.</div></div>` : ''}
      <div class="card"><div class="hd"><h2>Personal records</h2></div><ul class="list">${Object.entries(tests.prs).map(([k, r]) => html`<li><span class="grow">${TESTS[k]?.label || k}</span><b>${fmtV(k, r.value)} ${TESTS[k]?.unit || ''}</b><span class="s">${fmtDate(r.date, { dow: false })}</span></li>`)}</ul>${!Object.keys(tests.prs).length ? empty('No tests recorded yet.') : ''}</div>
      ${bw ? html`<div class="card"><div class="hd"><h2>Body weight</h2><span class="r faint" style="font-size:12px">Private</span></div><div class="bd">${bw.length ? lineChart([{ label: 'Body weight', points: bw.map((h) => [h.date, h.value]) }], { height: 150 }) : html`<p class="muted">No weigh-ins yet.</p>`}
        ${!parent ? html`<form id="bw" class="inline-input" style="margin-top:8px"><input type="number" step="0.5" name="value" placeholder="Today’s weight (lb)" required><button>Log</button></form>` : ''}</div></div>` : ''}
    </div></div>`);
  if ($('#pp', el)) $('#pp', el).onchange = (e) => ctx.navigate(`/weights?player=${e.target.value}`);
  on(el, 'change', '[data-meal]', async (e, c) => { const [plan, idx] = c.dataset.meal.split(':').map(Number); try { await api.post('/api/meal-logs', { plan_id: plan, meal_idx: idx, done: c.checked }, { offline: true }); } catch (err) { errToast(err); } });
  on(el, 'change', '[data-hyd]', async (e, c) => { try { await api.post('/api/meal-logs', { plan_id: Number(c.dataset.hyd), hydration: c.checked }, { offline: true }); } catch (err) { errToast(err); } });
  const opt = async (v) => { await api.post(`/api/players/${pid}/opt-out`, { opt_out: v }); toast(v ? 'Nutrition tracking turned off' : 'Nutrition tracking turned on'); ctx.reload(); };
  if ($('#opt', el)) $('#opt', el).onclick = async () => { if (await confirmDialog('Stop nutrition tracking? Meal plans will not be tracked; nothing else changes.')) opt(true); };
  if ($('#optin', el)) $('#optin', el).onclick = () => opt(false);
  if ($('#bw', el)) $('#bw', el).onsubmit = async (e) => { e.preventDefault(); try { await api.post('/api/bodyweight', formData(e.target)); toast('Logged'); ctx.reload(); } catch (err) { errToast(err); } };
  if ($('#lb', el)) $('#lb', el).onclick = (e) => { e.preventDefault(); leaderboardModal(m); };
}
async function leaderboardModal(m, key = 'squat', scope = 'team') {
  const q = { test_key: key, ...(scope === 'team' && m.my_team_id ? { team_id: m.my_team_id } : {}), ...(scope === 'group' && m.my_group ? { group: m.my_group } : {}) };
  let r; let err = null;
  try { r = await api.get(`/api/leaderboard?${new URLSearchParams(q)}`); } catch (e) { err = e.message; }
  const t = TESTS[key];
  const mm = modal({ title: 'Leaderboards', body: html`<div class="filters"><select id="lk">${options(Object.entries(TESTS).map(([k, x]) => [k, x.label]), key)}</select><select id="ls">${options([['team', 'My team'], ['group', 'My position group'], ['program', 'Whole program']], scope)}</select></div>
    ${err ? html`<p class="muted">${err}</p>` : r.rows.length ? html`<ul class="list" style="margin:0 -16px -16px">${r.rows.map((x, i) => html`<li><b style="width:22px">${i + 1}</b><span class="grow">${x.name}</span><span class="s">${x.group || ''}</span><b>${t.unit === 's' ? Number(x.best).toFixed(2) : x.best}</b></li>`)}</ul>` : empty('No results yet.')}`, actions: [{ label: 'Close' }] });
  const re = () => { mm.close(); leaderboardModal(m, $('#lk', mm.root).value, $('#ls', mm.root).value); };
  $('#lk', mm.root).onchange = re; $('#ls', mm.root).onchange = re;
}

async function workout(el, ctx) {
  const { a, w, d } = ctx.params;
  const pid = ctx.me.user.role === 'player' ? ctx.me.user.id : Number(ctx.query.player);
  const wk = await api.get(`/api/workouts/player/${pid}/${a}/${w}/${d}`);
  ctx.setTitle(`Week ${w} · Day ${d}`);
  const limited = wk.availability && wk.availability !== 'available';
  set(el, html`<div class="page-head"><div><h1>${wk.program_name}: week ${w}, day ${d}</h1><div class="sub">${wk.label || ''}${wk.due ? ` · due ${fmtDate(wk.due)}` : ' · work through in order'} · <span id="cnt">${wk.logged_sets}/${wk.prescribed_sets}</span> sets logged</div></div><div class="actions"><a class="btn" href="/weights">Back</a></div></div>
    ${limited ? html`<div class="notice warn">Availability: <b>${cap(wk.availability)}</b>${wk.avail_note ? ` · ${wk.avail_note}` : ''}. Follow the trainer's limits and ask a coach before any lift that hurts.</div>` : ''}
    ${wk.game_week ? html`<div class="notice">${wk.game_week.label}${wk.game_week.next_game ? ` · ${wk.game_week.next_game.title}` : ''}</div>` : ''}
    <div class="stack wr-workout">${wk.exercises.map((x) => html`<div class="card" data-ex="${x.exercise_id}"><div class="hd"><h2>${x.name}</h2>${x.layer === 'athlete' ? html`<span class="badge warn">Changed for you</span>` : x.layer === 'group' ? html`<span class="badge blue">${x.layer_label}</span>` : ''}<span class="r s muted">${x.sets} × ${x.reps || ''}${x.pct ? ` @ ${x.pct}%` : ''}${x.rpe ? ` · RPE ${x.rpe}` : ''}${x.load ? ` · ${x.load} lb` : ''}${x.rest ? ` · rest ${x.rest}` : ''}</span></div>
      <div class="bd">${x.cues || x.note ? html`<p class="s muted" style="margin-top:0">${x.cues || ''}${x.note ? html` · <b>${x.note}</b>` : ''}</p>` : ''}${x.video_url ? html`<p class="s" style="margin-top:0"><a href="${x.video_url}" target="_blank" rel="noopener">Watch a demo</a></p>` : ''}
        ${x.pct && !x.load ? html`<p class="s" style="color:var(--warn)">No max on file. Ask your coach for a starting load.</p>` : x.training_max ? html`<p class="s faint">Load from your training max of ${x.training_max} lb.</p>` : ''}
        <div class="wr-sets">${Array.from({ length: x.sets }, (_, i) => { const l = x.logged.find((y) => y.set_no === i + 1); return html`<div class="wr-set ${l ? 'done' : ''}" data-set="${i + 1}"><span class="wr-setno">Set ${i + 1}</span>
          <label class="wr-fld"><span>Reps</span><span class="wr-step"><button type="button" class="icon" data-st="reps:-1" aria-label="Fewer reps">−</button><input type="number" inputmode="numeric" data-k="reps" value="${l?.reps ?? (String(x.reps).match(/^\d+$/) ? x.reps : '')}"><button type="button" class="icon" data-st="reps:1" aria-label="More reps">+</button></span></label>
          <label class="wr-fld"><span>Weight (lb)</span><span class="wr-step"><button type="button" class="icon" data-st="weight:-5" aria-label="Five pounds less">−</button><input type="number" inputmode="decimal" step="2.5" data-k="weight" value="${l?.weight ?? x.load ?? ''}"><button type="button" class="icon" data-st="weight:5" aria-label="Five pounds more">+</button></span></label>
          <button class="${l ? '' : 'primary'} wr-log" data-log>${l ? 'Logged' : 'Log set'}</button></div>`; })}</div>
      </div></div>`)}</div>`);
  let logged = wk.logged_sets;
  on(el, 'click', '[data-st]', (e, b) => { const [k, dv] = b.dataset.st.split(':'); const inp = b.closest('.wr-set').querySelector(`[data-k=${k}]`); inp.value = Math.max(0, (Number(inp.value) || 0) + Number(dv)); });
  on(el, 'click', '[data-log]', async (e, b) => {
    const row = b.closest('[data-set]'); const ex = Number(b.closest('[data-ex]').dataset.ex);
    const body2 = { assignment_id: Number(a), week: Number(w), day: Number(d), exercise_id: ex, set_no: Number(row.dataset.set), reps: Number(row.querySelector('[data-k=reps]').value), weight: Number(row.querySelector('[data-k=weight]').value), client_id: uid(), player_id: pid };
    try {
      const r = await api.post('/api/wt-logs', body2, { offline: true });
      if (!row.classList.contains('done')) { logged++; $('#cnt', el).textContent = `${logged}/${wk.prescribed_sets}`; }
      row.classList.add('done'); b.textContent = r.queued ? 'Saved offline' : 'Logged'; b.classList.remove('primary');
      if (r.training_max) toast(r.training_max.pr ? `New PR: estimated ${r.training_max.value} lb` : `Training max is now ${r.training_max.value} lb`);
    } catch (err) { errToast(err); }
  });
}
