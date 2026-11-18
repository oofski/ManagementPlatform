// Module 6: Weight room and nutrition — exercise library, multi-week programs, assignment to any audience with
// individual overrides, %-of-max loads, player logging (offline-safe), testing days and PRs, coach dashboard,
// workouts as calendar events, private body-weight log, meal plans with approval and adherence, opt out.
import { fail, need, nowLocal, addDays, parseLocal, fmtLocal, today } from '../core.js';
import { j, jAll } from '../db.js';
import { csv, csvResponse } from '../app.js';

export const TESTS = {
  squat: { label: 'Back squat 1RM', unit: 'lb', better: 'higher' },
  bench: { label: 'Bench press 1RM', unit: 'lb', better: 'higher' },
  clean: { label: 'Power clean 1RM', unit: 'lb', better: 'higher' },
  deadlift: { label: 'Deadlift 1RM', unit: 'lb', better: 'higher' },
  forty: { label: '40-yard dash', unit: 's', better: 'lower' },
  pro_agility: { label: 'Pro agility (5-10-5)', unit: 's', better: 'lower' },
  vertical: { label: 'Vertical jump', unit: 'in', better: 'higher' },
  broad: { label: 'Broad jump', unit: 'in', better: 'higher' },
};

export default function weights(ctx) {
  const { router, db, core } = ctx;
  const { can, isStaff, isAdmin, audit, notify } = core;
  const editor = (u) => need(can(u, 'weights.edit'), 403, 'Coaches and trainers only');
  const playerIn = (u, id) => !!db.get(`SELECT 1 FROM users WHERE id=? AND program_id=? AND role='player'`, id, u.program_id);
  const selfOrStaff = (u, id) => isStaff(u) || core.linkedPlayers(u).includes(id);

  router.get('/api/weights/meta', () => ({ tests: TESTS }));

  // ---------- exercises ----------
  router.get('/api/exercises', ({ user }) => db.all('SELECT * FROM exercises WHERE program_id=? ORDER BY category, name', user.program_id));
  router.post('/api/exercises', ({ user, body }) => {
    editor(user); need(body.name, 400, 'Name is required');
    if (body.test_key) need(TESTS[body.test_key], 400, 'Unknown test');
    return { id: db.insert('exercises', { program_id: user.program_id, name: body.name, category: body.category || null, cues: body.cues || null, video_url: body.video_url || null, test_key: body.test_key || null }) };
  });
  router.put('/api/exercises/:id', ({ user, params, body }) => {
    editor(user);
    const e = db.get('SELECT * FROM exercises WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    need(e, 404, 'Exercise not found');
    db.update('exercises', e.id, Object.fromEntries(['name', 'category', 'cues', 'video_url', 'test_key'].filter((k) => body[k] !== undefined).map((k) => [k, body[k] || null])));
    return { ok: true };
  });
  router.del('/api/exercises/:id', ({ user, params }) => {
    editor(user);
    db.run('DELETE FROM exercises WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    return { ok: true };
  });

  // ---------- programs ----------
  const progOf = (pid, id) => j(db.get('SELECT * FROM wt_programs WHERE id=? AND program_id=?', id, pid), 'days');
  function validDays(days) {
    need(Array.isArray(days), 400, 'Days must be a list');
    for (const d of days) {
      need(Number.isInteger(d.week) && Number.isInteger(d.day) && Array.isArray(d.exercises), 400, 'Each day needs week, day and exercises');
      for (const x of d.exercises) need(x.exercise_id && Number(x.sets) > 0, 400, 'Each exercise needs an exercise and sets');
    }
    return days;
  }
  router.get('/api/wt-programs', ({ user }) => {
    need(isStaff(user), 403, 'Staff only');
    return jAll(db.all('SELECT p.*, u.name author, (SELECT count(*) FROM wt_assignments WHERE wt_program_id=p.id) assigned FROM wt_programs p LEFT JOIN users u ON u.id=p.created_by WHERE p.program_id=? ORDER BY p.is_template DESC, p.name', user.program_id), 'days');
  });
  router.get('/api/wt-programs/:id', ({ user, params }) => {
    need(isStaff(user), 403, 'Staff only');
    const p = progOf(user.program_id, Number(params.id));
    need(p, 404, 'Program not found');
    p.assignments = jAll(db.all('SELECT * FROM wt_assignments WHERE wt_program_id=?', p.id), 'audience').map((a) => ({ ...a, audience_labels: core.describeAudience(user.program_id, a.audience) }));
    return p;
  });
  router.post('/api/wt-programs', ({ user, body }) => {
    editor(user); need(body.name, 400, 'Name is required');
    let days = body.days || [];
    if (body.copy_from) { const src = progOf(user.program_id, Number(body.copy_from)); need(src, 404, 'Source not found'); days = src.days; }
    const id = db.insert('wt_programs', { program_id: user.program_id, name: body.name, description: body.description || null, weeks: Number(body.weeks) || 4, days: validDays(days), is_template: body.is_template ? 1 : 0, created_by: user.id });
    audit(user, 'create', 'wt_program', id);
    return { id };
  });
  router.put('/api/wt-programs/:id', ({ user, params, body }) => {
    editor(user);
    const p = progOf(user.program_id, Number(params.id));
    need(p, 404, 'Program not found');
    const upd = {};
    for (const k of ['name', 'description']) if (body[k] !== undefined) upd[k] = body[k];
    if (body.weeks) upd.weeks = Number(body.weeks);
    if (body.is_template !== undefined) upd.is_template = body.is_template ? 1 : 0;
    if (body.days) upd.days = validDays(body.days);
    db.update('wt_programs', p.id, upd);
    audit(user, 'edit', 'wt_program', p.id);
    return { ok: true };
  });
  router.del('/api/wt-programs/:id', ({ user, params }) => {
    editor(user);
    db.run('DELETE FROM wt_programs WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    return { ok: true };
  });

  // ---------- assignment (WGT-3) + calendar events (WGT-8) ----------
  router.post('/api/wt-assignments', ({ user, body }) => {
    editor(user);
    const p = progOf(user.program_id, Number(body.wt_program_id));
    need(p, 404, 'Program not found');
    need(Array.isArray(body.audience) && body.audience.length, 400, 'Pick who this is for');
    const start = body.start_date || today();
    const id = db.insert('wt_assignments', { program_id: user.program_id, wt_program_id: p.id, audience: body.audience, start_date: start, season_id: core.currentSeason(user.program_id)?.id, created_by: user.id });
    const events = [];
    if (body.schedule && Array.isArray(body.schedule.weekdays) && body.schedule.weekdays.length) {
      // Each program "day" N in a week maps to the Nth chosen weekday.
      const wd = body.schedule.weekdays.map(Number).sort();
      const time = body.schedule.time || '06:30';
      const dur = Number(body.schedule.minutes) || 60;
      const s = parseLocal(start + 'T00:00');
      for (const d of p.days) {
        const target = wd[(d.day - 1) % wd.length];
        const weekStart = new Date(s); weekStart.setDate(s.getDate() + (d.week - 1) * 7);
        const dt = new Date(weekStart);
        while (dt.getDay() !== target) dt.setDate(dt.getDate() + 1);
        const date = fmtLocal(dt).slice(0, 10);
        const end = fmtLocal(new Date(parseLocal(`${date}T${time}`).getTime() + dur * 60000));
        events.push(db.insert('events', { program_id: user.program_id, season_id: core.currentSeason(user.program_id)?.id, type: 'lift', title: `Lift: ${p.name} W${d.week}D${d.day}${d.label ? ' ' + d.label : ''}`, start: `${date}T${time}`, end, location: body.schedule.location || 'Weight room', audience: body.audience, details: { wt_assignment_id: id, week: d.week, day: d.day }, reminders: core.settings(user.program_id).reminder_defaults, created_by: user.id, updated_at: nowLocal() }));
      }
    }
    notify(user.program_id, core.resolvePlayers(user.program_id, body.audience), { kind: 'update', title: `New lifting program: ${p.name}`, body: `Starts ${start}`, link: '/weights', email: false });
    audit(user, 'assign', 'wt_program', p.id, { assignment: id, audience: body.audience, events: events.length });
    return { id, events: events.length };
  });
  router.del('/api/wt-assignments/:id', ({ user, params }) => {
    editor(user);
    const a = db.get('SELECT * FROM wt_assignments WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    need(a, 404, 'Not found');
    db.run(`DELETE FROM events WHERE type='lift' AND program_id=? AND json_extract(details,'$.wt_assignment_id')=? AND start>=?`, user.program_id, a.id, nowLocal());
    db.run('DELETE FROM wt_assignments WHERE id=?', a.id);
    return { ok: true };
  });
  router.get('/api/wt-assignments/:id/overrides', ({ user, params }) => {
    need(isStaff(user), 403, 'Staff only');
    return db.all('SELECT o.*, u.name player_name, e.name exercise_name, a.name alt_name FROM wt_overrides o JOIN users u ON u.id=o.player_id LEFT JOIN exercises e ON e.id=o.exercise_id LEFT JOIN exercises a ON a.id=o.alt_exercise_id WHERE o.assignment_id=?', Number(params.id));
  });
  router.post('/api/wt-assignments/:id/overrides', ({ user, params, body }) => {
    editor(user);
    const a = db.get('SELECT * FROM wt_assignments WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    need(a && playerIn(user, Number(body.player_id)), 404, 'Assignment or player not found');
    db.run('DELETE FROM wt_overrides WHERE assignment_id=? AND player_id=? AND coalesce(exercise_id,0)=coalesce(?,0)', a.id, Number(body.player_id), body.exercise_id || null);
    const id = db.insert('wt_overrides', { assignment_id: a.id, player_id: Number(body.player_id), exercise_id: body.exercise_id || null, alt_exercise_id: body.alt_exercise_id || null, sets: body.sets || null, reps: body.reps || null, pct: body.pct || null, note: body.note || null });
    audit(user, 'wt_override', 'player', Number(body.player_id), { assignment: a.id });
    return { id };
  });
  router.del('/api/wt-overrides/:id', ({ user, params }) => { editor(user); db.run('DELETE FROM wt_overrides WHERE id=?', Number(params.id)); return { ok: true }; });

  // ---------- resolving a player's workout ----------
  function maxFor(playerId, testKey) {
    if (!testKey) return null;
    const better = TESTS[testKey]?.better === 'lower' ? 'min' : 'max';
    return db.get(`SELECT ${better}(value) v FROM tests WHERE player_id=? AND test_key=? AND date=(SELECT max(date) FROM tests WHERE player_id=? AND test_key=?)`, playerId, testKey, playerId, testKey).v;
  }
  const round5 = (x) => Math.round(x / 5) * 5;
  function assignmentsFor(playerId, programId) {
    return jAll(db.all('SELECT a.*, p.name program_name, p.weeks, p.days FROM wt_assignments a JOIN wt_programs p ON p.id=a.wt_program_id WHERE a.program_id=? ORDER BY a.start_date DESC', programId), 'audience', 'days')
      .filter((a) => core.resolvePlayers(programId, a.audience).includes(playerId));
  }
  function resolveDay(playerId, a, d) {
    const ov = db.all('SELECT * FROM wt_overrides WHERE assignment_id=? AND player_id=?', a.id, playerId);
    const logs = db.all('SELECT * FROM wt_logs WHERE player_id=? AND assignment_id=? AND week=? AND day=? ORDER BY exercise_id, set_no', playerId, a.id, d.week, d.day);
    const exercises = d.exercises.map((x) => {
      const o = ov.find((r) => r.exercise_id === Number(x.exercise_id)) || ov.find((r) => r.exercise_id == null && !r.alt_exercise_id);
      const exId = o?.alt_exercise_id || Number(x.exercise_id);
      const ex = db.get('SELECT * FROM exercises WHERE id=?', exId) || { name: 'Unknown exercise' };
      const pct = o?.pct ?? x.pct ?? null;
      const max = pct ? maxFor(playerId, ex.test_key || db.get('SELECT test_key FROM exercises WHERE id=?', Number(x.exercise_id))?.test_key) : null;
      return {
        exercise_id: exId, original_exercise_id: Number(x.exercise_id), name: ex.name, cues: ex.cues, video_url: ex.video_url,
        sets: o?.sets ?? Number(x.sets), reps: o?.reps ?? x.reps, pct, rest: x.rest || null, note: o?.note || x.note || null,
        load: pct && max ? round5((pct / 100) * max) : x.load || null, tested_max: max, overridden: !!o,
        logged: logs.filter((l) => l.exercise_id === exId),
      };
    });
    const prescribedSets = exercises.reduce((s, x) => s + x.sets, 0);
    const loggedSets = exercises.reduce((s, x) => s + Math.min(x.logged.length, x.sets), 0);
    return { week: d.week, day: d.day, label: d.label, exercises, complete: prescribedSets > 0 && loggedSets >= prescribedSets, logged_sets: loggedSets, prescribed_sets: prescribedSets };
  }
  function dueDate(a, d) { return addDays(a.start_date, (d.week - 1) * 7 + (d.day - 1)); }

  router.get('/api/workouts/player/:id', ({ user, params }) => {
    const id = Number(params.id);
    need(selfOrStaff(user, id), 403, 'No access');
    return assignmentsFor(id, user.program_id).map((a) => ({
      id: a.id, program_name: a.program_name, start_date: a.start_date, weeks: a.weeks,
      days: a.days.map((d) => ({ ...resolveDay(id, a, d), due: dueDate(a, d) })),
    }));
  });
  router.get('/api/workouts/player/:id/:assignment/:week/:day', ({ user, params }) => {
    const id = Number(params.id);
    need(selfOrStaff(user, id), 403, 'No access');
    const a = assignmentsFor(id, user.program_id).find((x) => x.id === Number(params.assignment));
    need(a, 404, 'Workout not found');
    const d = a.days.find((x) => x.week === Number(params.week) && x.day === Number(params.day));
    need(d, 404, 'Workout day not found');
    return { assignment_id: a.id, program_name: a.program_name, due: dueDate(a, d), ...resolveDay(id, a, d) };
  });

  // WGT-5: player logging (idempotent by client_id)
  function saveLog(user, b) {
    const pid = Number(b.player_id || user.id);
    need(pid === user.id || can(user, 'weights.edit'), 403, 'You can only log your own work');
    if (b.client_id) { const dup = db.get('SELECT id FROM wt_logs WHERE client_id=?', b.client_id); if (dup) return { id: dup.id, duplicate: true }; }
    need(b.exercise_id && Number(b.set_no) > 0, 400, 'Exercise and set are required');
    const existing = db.get('SELECT id FROM wt_logs WHERE player_id=? AND assignment_id IS ? AND week IS ? AND day IS ? AND exercise_id=? AND set_no=?', pid, b.assignment_id || null, b.week || null, b.day || null, Number(b.exercise_id), Number(b.set_no));
    if (existing) { db.run('UPDATE wt_logs SET reps=?, weight=?, at=? WHERE id=?', Number(b.reps) || 0, Number(b.weight) || 0, nowLocal(), existing.id); return { id: existing.id, updated: true }; }
    return { id: db.insert('wt_logs', { player_id: pid, assignment_id: b.assignment_id || null, week: b.week || null, day: b.day || null, exercise_id: Number(b.exercise_id), set_no: Number(b.set_no), reps: Number(b.reps) || 0, weight: Number(b.weight) || 0, date: b.date || today(), client_id: b.client_id || null }) };
  }
  router.post('/api/wt-logs', ({ user, body }) => saveLog(user, body));
  router.post('/api/wt-logs/batch', ({ user, body }) => ({ results: (body.items || []).map((i) => { try { return saveLog(user, i); } catch (e) { return { error: e.message }; } }) }));
  router.del('/api/wt-logs/:id', ({ user, params }) => {
    const l = db.get('SELECT * FROM wt_logs WHERE id=?', Number(params.id));
    need(l && (l.player_id === user.id || can(user, 'weights.edit')), 403, 'No access');
    db.run('DELETE FROM wt_logs WHERE id=?', l.id);
    return { ok: true };
  });

  // ---------- testing (WGT-6) ----------
  router.get('/api/tests', ({ user, query }) => {
    if (query.player_id) {
      const id = Number(query.player_id);
      need(selfOrStaff(user, id), 403, 'No access');
      const rows = db.all('SELECT * FROM tests WHERE player_id=? ORDER BY date', id);
      const prs = {};
      for (const r of rows) { const t = TESTS[r.test_key]; const cur = prs[r.test_key]; if (!cur || (t?.better === 'lower' ? r.value < cur.value : r.value > cur.value)) prs[r.test_key] = r; }
      return { history: rows, prs };
    }
    need(isStaff(user), 403, 'Staff only');
    return db.all(`SELECT t.*, u.name FROM tests t JOIN users u ON u.id=t.player_id WHERE u.program_id=? ${query.test_key ? 'AND t.test_key=?' : ''} ORDER BY t.date DESC, u.name LIMIT 1000`, user.program_id, ...(query.test_key ? [query.test_key] : []));
  });
  function saveTest(user, b) {
    need(TESTS[b.test_key], 400, 'Unknown test');
    need(playerIn(user, Number(b.player_id)) && Number(b.value) > 0, 400, 'Player and value are required');
    const pid = Number(b.player_id);
    const t = TESTS[b.test_key];
    const prev = db.get(`SELECT ${t.better === 'lower' ? 'min' : 'max'}(value) v FROM tests WHERE player_id=? AND test_key=?`, pid, b.test_key).v;
    const id = db.insert('tests', { player_id: pid, test_key: b.test_key, value: Number(b.value), date: b.date || today(), by_user: user.id, season_id: core.currentSeason(user.program_id)?.id });
    const pr = prev == null || (t.better === 'lower' ? Number(b.value) < prev : Number(b.value) > prev);
    return { id, pr };
  }
  router.post('/api/tests', ({ user, body }) => { editor(user); const r = saveTest(user, body); audit(user, 'record_test', 'player', Number(body.player_id), { test: body.test_key }); return r; });
  router.post('/api/tests/batch', ({ user, body }) => {
    editor(user);
    const out = db.tx(() => (body.entries || []).filter((e) => e.value !== '' && e.value != null).map((e) => { try { return saveTest(user, { ...e, test_key: e.test_key || body.test_key, date: body.date }); } catch (err) { return { error: err.message, player_id: e.player_id }; } }));
    audit(user, 'testing_day', 'tests', null, { test: body.test_key, count: out.length });
    return { results: out, prs: out.filter((r) => r.pr).length };
  });
  // WGT-11: import maxes from a spreadsheet (name or jersey, test, value, date)
  router.post('/api/tests/import', ({ user, body }) => {
    editor(user);
    const players = db.all(`SELECT u.id, u.name, p.jersey FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.program_id=? AND u.role='player'`, user.program_id);
    const res = { created: 0, errors: [] };
    (body.rows || []).forEach((r, i) => {
      const p = players.find((x) => x.name.toLowerCase() === String(r.name || '').toLowerCase().trim()) || players.find((x) => r.jersey && x.jersey === Number(r.jersey));
      if (!p) return res.errors.push({ row: i + 1, error: 'Player not found' });
      try { saveTest(user, { player_id: p.id, test_key: r.test_key || r.test, value: r.value, date: r.date }); res.created++; } catch (e) { res.errors.push({ row: i + 1, error: e.message }); }
    });
    return res;
  });
  router.del('/api/tests/:id', ({ user, params }) => { editor(user); db.run('DELETE FROM tests WHERE id=?', Number(params.id)); return { ok: true }; });

  // Leaderboard — only when the coach turns it on; never body weight.
  router.get('/api/leaderboard', ({ user, query }) => {
    need(core.settings(user.program_id).leaderboard || isStaff(user), 403, 'Leaderboards are turned off');
    const key = query.test_key || 'squat';
    const t = TESTS[key]; need(t, 400, 'Unknown test');
    const rows = db.all(`SELECT u.id, u.name, pp.jersey, pp.positions, ${t.better === 'lower' ? 'min' : 'max'}(t.value) best FROM tests t JOIN users u ON u.id=t.player_id JOIN player_profiles pp ON pp.user_id=u.id
      WHERE u.program_id=? AND t.test_key=? AND pp.archived=0 GROUP BY u.id ORDER BY best ${t.better === 'lower' ? 'ASC' : 'DESC'} LIMIT 25`, user.program_id, key);
    return { test: { key, ...t }, rows: jAll(rows, 'positions') };
  });

  // ---------- coach dashboard (WGT-7) ----------
  router.get('/api/wt-dashboard', ({ user, query }) => {
    need(isStaff(user), 403, 'Staff only');
    const assignments = jAll(db.all('SELECT a.*, p.name program_name, p.days FROM wt_assignments a JOIN wt_programs p ON p.id=a.wt_program_id WHERE a.program_id=? ORDER BY a.start_date DESC', user.program_id), 'audience', 'days');
    const a = query.assignment_id ? assignments.find((x) => x.id === Number(query.assignment_id)) : assignments[0];
    if (!a) return { assignments: [], rows: [] };
    let players = core.resolvePlayers(user.program_id, a.audience).map((id) => j(db.get('SELECT u.id, u.name, pp.jersey, pp.units, pp.positions FROM users u JOIN player_profiles pp ON pp.user_id=u.id WHERE u.id=?', id), 'units', 'positions'));
    if (query.unit) players = players.filter((p) => p.units.includes(query.unit));
    if (query.position) players = players.filter((p) => p.positions.includes(query.position));
    const dueDays = a.days.filter((d) => dueDate(a, d) <= today());
    const rows = players.map((p) => {
      const done = dueDays.filter((d) => resolveDay(p.id, a, d).complete).length;
      const lastLog = db.get('SELECT max(date) d FROM wt_logs WHERE player_id=?', p.id).d;
      return { ...p, due: dueDays.length, completed: done, behind: Math.max(0, dueDays.length - done), last_log: lastLog };
    }).sort((x, y) => y.behind - x.behind || x.name.localeCompare(y.name));
    // Progress over time: group average of best maxes per month for main lifts.
    const ids = players.map((p) => p.id);
    const progress = {};
    if (ids.length) {
      for (const key of ['squat', 'bench', 'clean']) {
        progress[key] = db.all(`SELECT substr(date,1,7) month, round(avg(value)) avg FROM tests WHERE test_key=? AND player_id IN (${ids.map(() => '?').join(',')}) GROUP BY month ORDER BY month`, key, ...ids);
      }
    }
    return { assignments: assignments.map((x) => ({ id: x.id, program_name: x.program_name, start_date: x.start_date, audience_labels: core.describeAudience(user.program_id, x.audience) })), assignment_id: a.id, due_days: dueDays.length, rows, progress };
  });
  router.get('/api/wt-dashboard/export.csv', ({ user }) => {
    need(isStaff(user), 403, 'Staff only');
    const rows = db.all(`SELECT u.name, l.date, e.name exercise, l.set_no, l.reps, l.weight FROM wt_logs l JOIN users u ON u.id=l.player_id LEFT JOIN exercises e ON e.id=l.exercise_id WHERE u.program_id=? ORDER BY l.date DESC, u.name`, user.program_id);
    audit(user, 'export', 'workouts', null);
    return csvResponse('workout-logs.csv', csv(rows, [{ label: 'Player', key: 'name' }, { label: 'Date', key: 'date' }, { label: 'Exercise', key: 'exercise' }, { label: 'Set', key: 'set_no' }, { label: 'Reps', key: 'reps' }, { label: 'Weight', key: 'weight' }]));
  });

  // ---------- body weight (WGT-9) — private by default ----------
  const canSeeBody = (u, pid) => core.linkedPlayers(u).includes(pid) || isAdmin(u) || can(u, 'body.view');
  router.get('/api/bodyweight/:playerId', ({ user, params }) => {
    const pid = Number(params.playerId);
    need(canSeeBody(user, pid), 403, 'Body weight is private to the player, their parents and staff who have been granted access');
    if (isStaff(user)) audit(user, 'view', 'bodyweight', pid);
    return db.all(`SELECT m.id, m.value, m.date, u.name by_name FROM measurements m LEFT JOIN users u ON u.id=m.by_user WHERE m.player_id=? AND m.kind='bodyweight' ORDER BY m.date`, pid);
  });
  router.post('/api/bodyweight', ({ user, body }) => {
    const pid = Number(body.player_id || user.id);
    need(pid === user.id || (isStaff(user) && (can(user, 'weights.edit')) && canSeeBody(user, pid)) || (user.role === 'coach' && canSeeBody(user, pid)), 403, 'You cannot record body weight for this player');
    need(Number(body.value) > 50 && Number(body.value) < 500, 400, 'Enter a weight in pounds');
    const id = db.insert('measurements', { player_id: pid, kind: 'bodyweight', value: Number(body.value), date: body.date || today(), by_user: user.id, season_id: core.currentSeason(user.program_id)?.id });
    audit(user, 'record', 'bodyweight', pid);
    return { id };
  });
  router.del('/api/bodyweight/:id', ({ user, params }) => {
    const m = db.get(`SELECT * FROM measurements WHERE id=? AND kind='bodyweight'`, Number(params.id));
    need(m && (m.by_user === user.id || isAdmin(user)), 403, 'No access');
    db.run('DELETE FROM measurements WHERE id=?', m.id);
    return { ok: true };
  });

  // ---------- meal plans (WGT-10) ----------
  const mealOf = (pid, id) => j(db.get('SELECT * FROM meal_plans WHERE id=? AND program_id=?', id, pid), 'meals', 'audience');
  const mealRecipients = (pid, audience) => core.resolvePlayers(pid, audience).filter((id) => !db.get('SELECT nutrition_opt_out FROM player_profiles WHERE user_id=?', id).nutrition_opt_out);
  router.get('/api/meal-plans', ({ user }) => {
    if (isStaff(user)) {
      return jAll(db.all('SELECT m.*, a.name approved_name, c.name author FROM meal_plans m LEFT JOIN users a ON a.id=m.approved_by LEFT JOIN users c ON c.id=m.created_by WHERE m.program_id=? ORDER BY m.is_template DESC, m.name', user.program_id), 'meals', 'audience')
        .map((m) => ({ ...m, audience_labels: core.describeAudience(user.program_id, m.audience) }));
    }
    const mine = core.linkedPlayers(user);
    return jAll(db.all('SELECT * FROM meal_plans WHERE program_id=? AND approved_by IS NOT NULL AND is_template=0', user.program_id), 'meals', 'audience')
      .filter((m) => mine.some((pid) => mealRecipients(user.program_id, m.audience).includes(pid)));
  });
  router.post('/api/meal-plans', ({ user, body }) => {
    editor(user); need(body.name, 400, 'Name is required');
    let src = {};
    if (body.copy_from) { src = mealOf(user.program_id, Number(body.copy_from)); need(src, 404, 'Template not found'); }
    const meals = body.meals || src.meals || [];
    need(Array.isArray(meals), 400, 'Meals must be a list');
    const approver = can(user, 'nutrition.approve') ? user.id : null;
    const id = db.insert('meal_plans', { program_id: user.program_id, name: body.name, meals, hydration_oz: body.hydration_oz ?? src.hydration_oz ?? null, notes: body.notes ?? src.notes ?? null, audience: body.audience || [], approved_by: approver, locked: body.locked && approver ? 1 : 0, is_template: body.is_template ? 1 : 0, created_by: user.id });
    audit(user, 'create', 'meal_plan', id);
    return { id, approved: !!approver };
  });
  router.put('/api/meal-plans/:id', ({ user, params, body }) => {
    editor(user);
    const m = mealOf(user.program_id, Number(params.id));
    need(m, 404, 'Meal plan not found');
    need(!m.locked || can(user, 'nutrition.approve'), 403, 'This plan is locked by a trainer');
    const upd = {};
    for (const k of ['name', 'notes', 'hydration_oz']) if (body[k] !== undefined) upd[k] = body[k];
    if (body.meals) { upd.meals = body.meals; if (!can(user, 'nutrition.approve')) upd.approved_by = null; }
    if (body.audience) upd.audience = body.audience;
    if (body.locked !== undefined) { need(can(user, 'nutrition.approve'), 403, 'Only a trainer or nutrition professional can lock plans'); upd.locked = body.locked ? 1 : 0; }
    db.update('meal_plans', m.id, upd);
    if (body.audience && m.approved_by && upd.approved_by !== null) notify(user.program_id, mealRecipients(user.program_id, body.audience), { kind: 'update', title: `Meal plan: ${m.name}`, link: '/weights?tab=nutrition', email: false });
    audit(user, 'edit', 'meal_plan', m.id);
    return { ok: true };
  });
  router.post('/api/meal-plans/:id/approve', ({ user, params }) => {
    need(can(user, 'nutrition.approve'), 403, 'Only a trainer or nutrition professional can approve meal plans');
    const m = mealOf(user.program_id, Number(params.id));
    need(m, 404, 'Meal plan not found');
    db.update('meal_plans', m.id, { approved_by: user.id });
    if (m.audience.length) notify(user.program_id, mealRecipients(user.program_id, m.audience), { kind: 'update', title: `Meal plan: ${m.name}`, link: '/weights?tab=nutrition', email: false });
    audit(user, 'approve', 'meal_plan', m.id);
    return { ok: true };
  });
  router.del('/api/meal-plans/:id', ({ user, params }) => {
    editor(user);
    const m = mealOf(user.program_id, Number(params.id));
    need(m && (!m.locked || can(user, 'nutrition.approve')), 403, 'This plan is locked by a trainer');
    db.run('DELETE FROM meal_plans WHERE id=?', m.id);
    return { ok: true };
  });
  router.post('/api/meal-logs', ({ user, body }) => {
    const pid = Number(body.player_id || user.id);
    need(core.linkedPlayers(user).includes(pid) && user.role === 'player', 403, 'Players mark their own meals');
    need(!db.get('SELECT nutrition_opt_out FROM player_profiles WHERE user_id=?', pid).nutrition_opt_out, 400, 'You opted out of nutrition tracking');
    const m = mealOf(user.program_id, Number(body.plan_id));
    need(m && mealRecipients(user.program_id, m.audience).includes(pid), 404, 'Meal plan not found');
    const date = body.date || today();
    if (body.hydration !== undefined) {
      db.run('INSERT INTO hydration_logs (plan_id, player_id, date, met) VALUES (?,?,?,?) ON CONFLICT(plan_id, player_id, date) DO UPDATE SET met=excluded.met', m.id, pid, date, body.hydration ? 1 : 0);
      return { ok: true };
    }
    need(Number.isInteger(Number(body.meal_idx)) && Number(body.meal_idx) < m.meals.length, 400, 'Unknown meal');
    db.run('INSERT INTO meal_logs (plan_id, player_id, date, meal_idx, done) VALUES (?,?,?,?,?) ON CONFLICT(plan_id, player_id, date, meal_idx) DO UPDATE SET done=excluded.done', m.id, pid, date, Number(body.meal_idx), body.done === false ? 0 : 1);
    return { ok: true };
  });
  router.get('/api/meal-logs', ({ user, query }) => {
    const pid = Number(query.player_id || user.id);
    need(core.linkedPlayers(user).includes(pid) || isStaff(user), 403, 'No access');
    const date = query.date || today();
    return { meals: db.all('SELECT plan_id, meal_idx, done FROM meal_logs WHERE player_id=? AND date=?', pid, date), hydration: db.all('SELECT plan_id, met FROM hydration_logs WHERE player_id=? AND date=?', pid, date) };
  });
  router.get('/api/meal-plans/:id/adherence', ({ user, params, query }) => {
    need(isStaff(user), 403, 'Staff only');
    const m = mealOf(user.program_id, Number(params.id));
    need(m, 404, 'Meal plan not found');
    const from = query.from || addDays(today(), -6); const to = query.to || today();
    const days = Math.round((parseLocal(to + 'T00:00') - parseLocal(from + 'T00:00')) / 86400000) + 1;
    const rows = mealRecipients(user.program_id, m.audience).map((pid) => {
      const done = db.get('SELECT count(*) n FROM meal_logs WHERE plan_id=? AND player_id=? AND done=1 AND date>=? AND date<=?', m.id, pid, from, to).n;
      const hyd = db.get('SELECT count(*) n FROM hydration_logs WHERE plan_id=? AND player_id=? AND met=1 AND date>=? AND date<=?', m.id, pid, from, to).n;
      return { player_id: pid, name: db.get('SELECT name FROM users WHERE id=?', pid).name, meals_done: done, meals_planned: days * m.meals.length, rate: m.meals.length ? Math.round((done / (days * m.meals.length)) * 100) : null, hydration_days: hyd };
    });
    const optedOut = core.resolvePlayers(user.program_id, m.audience).length - rows.length;
    return { from, to, days, rows: rows.sort((a, b) => a.rate - b.rate), opted_out: optedOut };
  });
}
