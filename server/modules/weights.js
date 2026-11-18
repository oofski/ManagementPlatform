// Module 6: Weight room and nutrition — exercise library, multi-week programs, assignment to any audience with
// individual overrides, %-of-max loads, player logging (offline-safe), testing days and PRs, coach dashboard,
// workouts as calendar events, private body-weight log, meal plans with approval and adherence, opt out.
import { fail, need, nowLocal, addDays, parseLocal, fmtLocal, today } from '../core.js';
import { j, jAll } from '../db.js';
import { csv, csvResponse } from '../app.js';
import { ensureLibrary, groupOf, athleteGroup } from '../strength-data.js';

// F-6 football testing battery. Strength tests accept a rep test (weight x reps -> estimated 1RM by Epley).
// Height and weight are part of the battery but are stored as measurements (coach-only) and never ranked.
export const TESTS = {
  squat: { label: 'Back squat 1RM', unit: 'lb', better: 'higher', group: 'strength', rep_test: true },
  bench: { label: 'Bench press 1RM', unit: 'lb', better: 'higher', group: 'strength', rep_test: true },
  clean: { label: 'Power clean 1RM', unit: 'lb', better: 'higher', group: 'strength', rep_test: true },
  deadlift: { label: 'Deadlift 1RM', unit: 'lb', better: 'higher', group: 'strength', rep_test: true },
  forty: { label: '40-yard dash', unit: 's', better: 'lower', group: 'speed' },
  ten_split: { label: '10-yard split', unit: 's', better: 'lower', group: 'speed' },
  pro_agility: { label: 'Pro agility (5-10-5)', unit: 's', better: 'lower', group: 'agility' },
  l_drill: { label: 'L-drill (3-cone)', unit: 's', better: 'lower', group: 'agility' },
  vertical: { label: 'Vertical jump', unit: 'in', better: 'higher', group: 'power' },
  broad: { label: 'Broad jump', unit: 'in', better: 'higher', group: 'power' },
};
export const MEASURES = { height: { label: 'Height', unit: 'in' }, weight: { label: 'Weight', unit: 'lb' } };
export const epley = (weight, reps) => (Number(reps) <= 1 ? Number(weight) : Math.round(Number(weight) * (1 + Number(reps) / 30)));

export default function weights(ctx) {
  const { router, db, core } = ctx;
  const { can, isStaff, isAdmin, audit, notify } = core;
  const editor = (u) => need(can(u, 'weights.edit'), 403, 'Coaches and trainers only');
  const playerIn = (u, id) => !!db.get(`SELECT 1 FROM users WHERE id=? AND program_id=? AND role='player'`, id, u.program_id);
  const selfOrStaff = (u, id) => (isStaff(u) && playerIn(u, id)) || core.linkedPlayers(u).includes(id);

  router.get('/api/weights/meta', () => ({ tests: TESTS, measures: MEASURES }));

  // ---------- exercises (C-9: the built-in library is seeded into each program on first use, idempotently) ----------
  router.get('/api/exercises', ({ user, query }) => {
    ensureLibrary(db, user.program_id);
    const where = ['e.program_id=?']; const args = [user.program_id];
    if (query.q) { where.push('lower(e.name) LIKE ?'); args.push(`%${String(query.q).toLowerCase()}%`); }
    if (query.category) { where.push('e.category=?'); args.push(query.category); }
    if (query.equipment) { where.push('m.equipment=?'); args.push(query.equipment); }
    if (query.custom === '1') where.push('coalesce(m.custom,1)=1');
    return db.all(`SELECT e.*, m.equipment, m.pattern, coalesce(m.custom,1) custom FROM exercises e LEFT JOIN exercise_meta m ON m.exercise_id=e.id
      WHERE ${where.join(' AND ')} ORDER BY e.category, e.name`, ...args);
  });
  router.post('/api/exercises', ({ user, body }) => {
    editor(user); need(body.name, 400, 'Name is required');
    if (body.test_key) need(TESTS[body.test_key], 400, 'Unknown test');
    const id = db.insert('exercises', { program_id: user.program_id, name: body.name, category: body.category || null, cues: body.cues || null, video_url: body.video_url || null, test_key: body.test_key || null });
    db.insert('exercise_meta', { exercise_id: id, equipment: body.equipment || null, pattern: body.pattern || null, custom: 1 });
    return { id };
  });
  router.put('/api/exercises/:id', ({ user, params, body }) => {
    editor(user);
    const e = db.get('SELECT * FROM exercises WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    need(e, 404, 'Exercise not found');
    if (body.test_key) need(TESTS[body.test_key], 400, 'Unknown test');
    db.update('exercises', e.id, Object.fromEntries(['name', 'category', 'cues', 'video_url', 'test_key'].filter((k) => body[k] !== undefined).map((k) => [k, body[k] || null])));
    if (body.equipment !== undefined) db.run('INSERT INTO exercise_meta (exercise_id, equipment, custom) VALUES (?,?,1) ON CONFLICT(exercise_id) DO UPDATE SET equipment=excluded.equipment', e.id, body.equipment || null);
    return { ok: true };
  });
  router.del('/api/exercises/:id', ({ user, params }) => {
    editor(user);
    db.run('DELETE FROM exercises WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    return { ok: true };
  });

  // ---------- programs ----------
  const progOf = (pid, id) => j(db.get('SELECT * FROM wt_programs WHERE id=? AND program_id=?', id, pid), 'days');
  // C-8: dated (day N of week W falls on start + (W-1) weeks + (N-1) days) or dateless (work through days in order);
  // F-5: game_week programs scale volume by days to the next game.
  const MODES = ['dated', 'dateless', 'game_week'];
  const metaOf = (id) => ({ mode: 'dated', kind: 'lift', phase: null, position_group: null, template_key: null, builtin: 0, ...(db.get('SELECT mode, kind, phase, position_group, template_key, builtin FROM wt_program_meta WHERE wt_program_id=?', id) || {}) });
  function saveMeta(id, m) {
    need(MODES.includes(m.mode || 'dated'), 400, 'Mode must be dated, dateless or game_week');
    need(['lift', 'conditioning'].includes(m.kind || 'lift'), 400, 'Kind must be lift or conditioning');
    db.run(`INSERT INTO wt_program_meta (wt_program_id, mode, kind, phase, position_group, template_key, builtin) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(wt_program_id) DO UPDATE SET mode=excluded.mode, kind=excluded.kind, phase=excluded.phase, position_group=excluded.position_group, template_key=excluded.template_key, builtin=excluded.builtin`,
    id, m.mode || 'dated', m.kind || 'lift', m.phase || null, m.position_group || null, m.template_key || null, m.builtin ? 1 : 0);
  }
  function validDays(days) {
    need(Array.isArray(days), 400, 'Days must be a list');
    for (const d of days) {
      need(Number.isInteger(d.week) && Number.isInteger(d.day) && Array.isArray(d.exercises), 400, 'Each day needs week, day and exercises');
      for (const x of d.exercises) {
        need(x.exercise_id && Number(x.sets) > 0, 400, 'Each exercise needs an exercise and sets');
        if (x.rpe != null && x.rpe !== '') need(Number(x.rpe) >= 1 && Number(x.rpe) <= 10, 400, 'RPE must be between 1 and 10');
        if (x.pct != null && x.pct !== '') need(Number(x.pct) > 0 && Number(x.pct) <= 120, 400, 'Percent of max must be between 1 and 120');
      }
    }
    return days;
  }
  router.get('/api/wt-programs', ({ user }) => {
    need(isStaff(user), 403, 'Staff only');
    return jAll(db.all(`SELECT p.*, u.name author, (SELECT count(*) FROM wt_assignments WHERE wt_program_id=p.id) assigned,
      coalesce(m.mode,'dated') mode, coalesce(m.kind,'lift') kind, m.phase, m.position_group, m.template_key, coalesce(m.builtin,0) builtin
      FROM wt_programs p LEFT JOIN users u ON u.id=p.created_by LEFT JOIN wt_program_meta m ON m.wt_program_id=p.id
      WHERE p.program_id=? ORDER BY p.is_template DESC, p.name`, user.program_id), 'days');
  });
  router.get('/api/wt-programs/:id', ({ user, params }) => {
    need(isStaff(user), 403, 'Staff only');
    const p = progOf(user.program_id, Number(params.id));
    need(p, 404, 'Program not found');
    p.assignments = jAll(db.all('SELECT * FROM wt_assignments WHERE wt_program_id=?', p.id), 'audience').map((a) => ({ ...a, audience_labels: core.describeAudience(user.program_id, a.audience),
      group_overrides: db.get('SELECT count(*) n FROM wt_group_overrides WHERE assignment_id=?', a.id).n, athlete_overrides: db.get('SELECT count(*) n FROM wt_overrides WHERE assignment_id=?', a.id).n }));
    p.meta = metaOf(p.id);
    return p;
  });
  router.post('/api/wt-programs', ({ user, body }) => {
    editor(user); need(body.name, 400, 'Name is required');
    let days = body.days || [];
    let meta = {};
    if (body.copy_from) { const src = progOf(user.program_id, Number(body.copy_from)); need(src, 404, 'Source not found'); days = src.days; meta = metaOf(src.id); if (!body.weeks) body.weeks = src.weeks; }
    const id = db.insert('wt_programs', { program_id: user.program_id, name: body.name, description: body.description || null, weeks: Number(body.weeks) || 4, days: validDays(days), is_template: body.is_template ? 1 : 0, created_by: user.id });
    saveMeta(id, { ...meta, template_key: meta.template_key || null, builtin: 0, ...(body.meta || {}) });
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
    if (body.meta) saveMeta(p.id, { ...metaOf(p.id), ...body.meta });
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
  router.del('/api/wt-overrides/:id', ({ user, params }) => {
    editor(user);
    const o = db.get('SELECT o.id FROM wt_overrides o JOIN wt_assignments a ON a.id=o.assignment_id WHERE o.id=? AND a.program_id=?', Number(params.id), user.program_id);
    need(o, 404, 'Override not found');
    db.run('DELETE FROM wt_overrides WHERE id=?', o.id);
    return { ok: true };
  });

  // ---------- resolving a player's workout ----------
  // C-15: the max used for % loads is the latest tested max, raised by any training max recorded after that test
  // (training maxes come from estimated 1RMs of logged sets, see strength.js).
  function maxInfo(playerId, testKey) {
    if (!testKey || !TESTS[testKey]) return { tested: null, training: null, max: null };
    const better = TESTS[testKey].better === 'lower' ? 'min' : 'max';
    const last = db.get('SELECT max(date) d FROM tests WHERE player_id=? AND test_key=?', playerId, testKey).d;
    const tested = last ? db.get(`SELECT ${better}(value) v FROM tests WHERE player_id=? AND test_key=? AND date=?`, playerId, testKey, last).v : null;
    const tm = db.get('SELECT max(value) v FROM training_maxes WHERE player_id=? AND test_key=? AND date>=?', playerId, testKey, last || '0000-00-00').v;
    const training = tm != null && (tested == null || tm > tested) ? tm : null;
    return { tested, training, max: training ?? tested };
  }
  const maxFor = (playerId, testKey) => maxInfo(playerId, testKey).max;
  const round5 = (x) => Math.round(x / 5) * 5;
  const profileOf = (pid) => j(db.get('SELECT p.*, t.level_id, u.name FROM player_profiles p JOIN users u ON u.id=p.user_id LEFT JOIN teams t ON t.id=p.team_id WHERE p.user_id=?', pid), 'units', 'positions');
  // Does a player sit inside a group-layer token? (team:, level:, unit:, pos:, group: custom group, pg: football position group)
  function tokenMatches(prof, tok) {
    if (!prof) return false;
    const [k, v] = String(tok).split(':');
    if (k === 'program') return true;
    if (k === 'team') return prof.team_id === Number(v);
    if (k === 'level') return prof.level_id === Number(v);
    if (k === 'unit') return (prof.units || []).includes(v);
    if (k === 'pos') return (prof.positions || []).includes(v);
    if (k === 'pg') return athleteGroup(prof.primary_group, prof.positions) === v;
    if (k === 'group') return !!db.get('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?', Number(v), prof.user_id);
    return false;
  }
  const tokenLabel = (pid, tok) => (String(tok).startsWith('pg:') ? `${tok.slice(3)} group` : core.describeAudience(pid, [tok])[0]);
  function assignmentsFor(playerId, programId) {
    return jAll(db.all(`SELECT a.*, p.name program_name, p.weeks, p.days, coalesce(m.mode,'dated') mode, coalesce(m.kind,'lift') kind FROM wt_assignments a
      JOIN wt_programs p ON p.id=a.wt_program_id LEFT JOIN wt_program_meta m ON m.wt_program_id=p.id WHERE a.program_id=? ORDER BY a.start_date DESC`, programId), 'audience', 'days')
      .filter((a) => core.resolvePlayers(programId, a.audience).includes(playerId));
  }
  function resolveDay(playerId, a, d, { profile } = {}) {
    const prof = profile || profileOf(playerId);
    const ov = db.all('SELECT * FROM wt_overrides WHERE assignment_id=? AND player_id=?', a.id, playerId);
    const gov = db.all('SELECT * FROM wt_group_overrides WHERE assignment_id=? ORDER BY id', a.id).filter((g) => tokenMatches(prof, g.group_token));
    const logs = db.all('SELECT * FROM wt_logs WHERE player_id=? AND assignment_id=? AND week=? AND day=? ORDER BY exercise_id, set_no', playerId, a.id, d.week, d.day);
    // F-5: game-week programs scale by days to the player's next game, and swap in the activation lift the day before.
    const gw = a.mode === 'game_week' && ctx.strength ? ctx.strength.gameWeekFor(prof, dueDate(a, d) || today(), a.program_id) : null;
    const src = gw?.activation ? ctx.strength.activationExercises(a.program_id) : d.exercises;
    const pick = (rows, x) => rows.find((r) => r.exercise_id === Number(x.exercise_id)) || rows.find((r) => r.exercise_id == null && !r.alt_exercise_id);
    const exercises = src.map((x) => {
      const ao = pick(ov, x); const go = pick(gov, x);
      const f = (k) => ao?.[k] ?? go?.[k] ?? null;
      const exId = ao?.alt_exercise_id || go?.alt_exercise_id || Number(x.exercise_id);
      const ex = db.get('SELECT * FROM exercises WHERE id=?', exId) || { name: 'Unknown exercise' };
      let pct = f('pct') ?? x.pct ?? null;
      let sets = f('sets') ?? Number(x.sets);
      if (gw && !gw.activation && gw.factor < 1) { sets = Math.max(1, Math.round(sets * gw.factor)); if (pct && gw.pct_drop) pct -= gw.pct_drop; }
      const info = pct ? maxInfo(playerId, ex.test_key || db.get('SELECT test_key FROM exercises WHERE id=?', Number(x.exercise_id))?.test_key) : { tested: null, training: null, max: null };
      return {
        exercise_id: exId, original_exercise_id: Number(x.exercise_id), name: ex.name, cues: ex.cues, video_url: ex.video_url,
        sets, reps: f('reps') ?? x.reps, pct, rpe: f('rpe') ?? x.rpe ?? null, rest: x.rest || null, note: ao?.note || go?.note || x.note || null,
        load: pct && info.max ? round5((pct / 100) * info.max) : x.load || null, tested_max: info.tested, training_max: info.training, overridden: !!(ao || go),
        layer: ao ? 'athlete' : go ? 'group' : 'team', layer_label: ao ? 'Changed for this athlete' : go ? `${tokenLabel(a.program_id, go.group_token)} change` : null,
        logged: logs.filter((l) => l.exercise_id === exId),
      };
    });
    const prescribedSets = exercises.reduce((s, x) => s + x.sets, 0);
    const loggedSets = exercises.reduce((s, x) => s + Math.min(x.logged.length, x.sets), 0);
    return { week: d.week, day: d.day, label: gw?.activation ? 'Game-day activation' : d.label, exercises, complete: prescribedSets > 0 && loggedSets >= prescribedSets, logged_sets: loggedSets, prescribed_sets: prescribedSets, game_week: gw || undefined };
  }
  function dueDate(a, d) { return a.mode === 'dateless' ? null : addDays(a.start_date, (d.week - 1) * 7 + (d.day - 1)); }
  // C-8: the next session. Dateless: the first incomplete day in order. Dated: today's day, else the earliest incomplete day from today on.
  function nextDayIndex(a, resolved) {
    const sorted = resolved.map((r, i) => ({ r, i, d: a.days[i] })).sort((x, y) => x.d.week - y.d.week || x.d.day - y.d.day);
    if (a.mode === 'dateless') return sorted.find((x) => !x.r.complete)?.i ?? -1;
    const t = today();
    return (sorted.find((x) => dueDate(a, x.d) === t) || sorted.find((x) => !x.r.complete && dueDate(a, x.d) >= t))?.i ?? -1;
  }
  ctx.wt = { maxInfo, maxFor, resolveDay, assignmentsFor, dueDate, nextDayIndex, profileOf, tokenMatches, tokenLabel, metaOf, saveMeta, validDays, progOf, playerIn, saveTest: (u, b) => saveTest(u, b), TESTS };

  router.get('/api/workouts/player/:id', ({ user, params }) => {
    const id = Number(params.id);
    need(selfOrStaff(user, id), 403, 'No access');
    return assignmentsFor(id, user.program_id).map((a) => ({
      id: a.id, program_name: a.program_name, start_date: a.start_date, weeks: a.weeks, mode: a.mode, kind: a.kind,
      days: (() => { const prof = profileOf(id); const r = a.days.map((d) => ({ ...resolveDay(id, a, d, { profile: prof }), due: dueDate(a, d) })); const n = nextDayIndex(a, r); if (n >= 0) r[n].next = true; return r; })(),
    }));
  });
  router.get('/api/workouts/player/:id/:assignment/:week/:day', ({ user, params }) => {
    const id = Number(params.id);
    need(selfOrStaff(user, id), 403, 'No access');
    const a = assignmentsFor(id, user.program_id).find((x) => x.id === Number(params.assignment));
    need(a, 404, 'Workout not found');
    const d = a.days.find((x) => x.week === Number(params.week) && x.day === Number(params.day));
    need(d, 404, 'Workout day not found');
    const prof = profileOf(id);
    return { assignment_id: a.id, program_name: a.program_name, mode: a.mode, due: dueDate(a, d), availability: prof?.availability, avail_note: prof?.avail_note, ...resolveDay(id, a, d, { profile: prof }) };
  });

  // WGT-5: player logging (idempotent by client_id)
  function saveLog(user, b) {
    const pid = Number(b.player_id || user.id);
    need(pid === user.id || (can(user, 'weights.edit') && playerIn(user, pid)), 403, 'You can only log your own work');
    if (b.client_id) { const dup = db.get('SELECT id FROM wt_logs WHERE client_id=?', b.client_id); if (dup) return { id: dup.id, duplicate: true }; }
    need(b.exercise_id && Number(b.set_no) > 0, 400, 'Exercise and set are required');
    const existing = db.get('SELECT id FROM wt_logs WHERE player_id=? AND assignment_id IS ? AND week IS ? AND day IS ? AND exercise_id=? AND set_no=?', pid, b.assignment_id || null, b.week || null, b.day || null, Number(b.exercise_id), Number(b.set_no));
    if (b.assignment_id) need(db.get('SELECT 1 FROM wt_assignments WHERE id=? AND program_id=?', Number(b.assignment_id), user.program_id), 404, 'Workout not found');
    const row = { reps: Number(b.reps) || 0, weight: Number(b.weight) || 0, date: b.date || today(), exercise_id: Number(b.exercise_id) };
    let out;
    if (existing) { db.run('UPDATE wt_logs SET reps=?, weight=?, at=? WHERE id=?', row.reps, row.weight, nowLocal(), existing.id); out = { id: existing.id, updated: true }; }
    else out = { id: db.insert('wt_logs', { player_id: pid, assignment_id: b.assignment_id || null, week: b.week || null, day: b.day || null, exercise_id: row.exercise_id, set_no: Number(b.set_no), reps: row.reps, weight: row.weight, date: row.date, client_id: b.client_id || null }) };
    // C-15: update the training max from this set's estimated 1RM
    const tm = ctx.strength?.afterLog(user, pid, { ...row, log_id: out.id });
    if (tm) out.training_max = tm;
    return out;
  }
  router.post('/api/wt-logs', ({ user, body }) => saveLog(user, body));
  router.post('/api/wt-logs/batch', ({ user, body }) => ({ results: (body.items || []).map((i) => { try { return saveLog(user, i); } catch (e) { return { error: e.message }; } }) }));
  router.del('/api/wt-logs/:id', ({ user, params }) => {
    const l = db.get('SELECT * FROM wt_logs WHERE id=?', Number(params.id));
    need(l && (l.player_id === user.id || (can(user, 'weights.edit') && playerIn(user, l.player_id))), 403, 'No access');
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
    const t = TESTS[b.test_key];
    // F-6 rep test: weight x reps becomes an estimated 1RM (Epley)
    const repTest = t.rep_test && Number(b.weight) > 0 && Number(b.reps) > 0;
    if (repTest) { need(Number(b.reps) <= 12, 400, 'Rep tests are estimated up to 12 reps'); b = { ...b, value: epley(b.weight, b.reps) }; }
    need(playerIn(user, Number(b.player_id)) && Number(b.value) > 0, 400, 'Player and value are required');
    const pid = Number(b.player_id);
    const prev = db.get(`SELECT ${t.better === 'lower' ? 'min' : 'max'}(value) v FROM tests WHERE player_id=? AND test_key=?`, pid, b.test_key).v;
    const date = b.date || today();
    const id = db.insert('tests', { player_id: pid, test_key: b.test_key, value: Number(b.value), date, by_user: user.id, season_id: core.currentSeason(user.program_id)?.id });
    if (repTest) db.insert('test_details', { test_id: id, weight: Number(b.weight), reps: Number(b.reps), method: 'epley' });
    const pr = prev == null || (t.better === 'lower' ? Number(b.value) < prev : Number(b.value) > prev);
    ctx.strength?.afterTest(user, pid, b.test_key, Number(b.value), date, { pr, prev, test_id: id });
    return repTest ? { id, pr, value: Number(b.value), estimated: true } : { id, pr };
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
  router.del('/api/tests/:id', ({ user, params }) => {
    editor(user);
    const t = db.get('SELECT t.id FROM tests t JOIN users u ON u.id=t.player_id WHERE t.id=? AND u.program_id=?', Number(params.id), user.program_id);
    need(t, 404, 'Test result not found');
    db.run('DELETE FROM tests WHERE id=?', t.id);
    return { ok: true };
  });

  // C-16 leaderboards by team and position group. Players only see them when the coach turns them on, and never
  // for a team or group the coach has hidden. Only TESTS can be ranked, so body weight never appears.
  router.get('/api/leaderboard', ({ user, query }) => {
    const s = core.settings(user.program_id);
    const staff = isStaff(user);
    need(s.leaderboard || staff, 403, 'Leaderboards are turned off');
    const key = query.test_key || 'squat';
    const t = TESTS[key]; need(t, 400, 'Unknown test');
    const hidden = Array.isArray(s.leaderboard_hidden) ? s.leaderboard_hidden : [];
    const teamId = query.team_id ? Number(query.team_id) : null; const grp = query.group || null; const levelId = query.level_id ? Number(query.level_id) : null;
    if (!staff) {
      need(!(teamId && hidden.includes(`team:${teamId}`)) && !(grp && hidden.includes(`group:${grp}`)), 403, 'The coach has hidden this leaderboard');
    }
    let rows = jAll(db.all(`SELECT u.id, u.name, pp.jersey, pp.positions, pp.team_id, pp.primary_group, t2.level_id, ${t.better === 'lower' ? 'min' : 'max'}(t.value) best FROM tests t JOIN users u ON u.id=t.player_id JOIN player_profiles pp ON pp.user_id=u.id LEFT JOIN teams t2 ON t2.id=pp.team_id
      WHERE u.program_id=? AND t.test_key=? AND pp.archived=0 AND u.active=1 GROUP BY u.id ORDER BY best ${t.better === 'lower' ? 'ASC' : 'DESC'}`, user.program_id, key), 'positions');
    for (const r of rows) r.group = athleteGroup(r.primary_group, r.positions);
    if (teamId) rows = rows.filter((r) => r.team_id === teamId);
    if (levelId) rows = rows.filter((r) => r.level_id === levelId);
    if (grp) rows = rows.filter((r) => r.group === grp);
    if (!staff) rows = rows.filter((r) => !hidden.includes(`team:${r.team_id}`) && !hidden.includes(`group:${r.group}`));
    rows = rows.slice(0, Number(query.limit) > 0 ? Math.min(100, Number(query.limit)) : 25)
      .map(({ id, name, jersey, positions, team_id, group, best }) => ({ id, name, jersey, positions, team_id, group, best }));
    return { test: { key, ...t }, rows, visible_to_players: !!s.leaderboard, hidden };
  });

  // ---------- coach dashboard (WGT-7) ----------
  router.get('/api/wt-dashboard', ({ user, query }) => {
    need(isStaff(user), 403, 'Staff only');
    const assignments = jAll(db.all(`SELECT a.*, p.name program_name, p.days, coalesce(m.mode,'dated') mode, coalesce(m.kind,'lift') kind FROM wt_assignments a JOIN wt_programs p ON p.id=a.wt_program_id
      LEFT JOIN wt_program_meta m ON m.wt_program_id=p.id WHERE a.program_id=? ORDER BY a.start_date DESC, a.id DESC`, user.program_id), 'audience', 'days');
    const a = query.assignment_id ? assignments.find((x) => x.id === Number(query.assignment_id)) : assignments[0];
    if (!a) return { assignments: [], rows: [] };
    let players = core.resolvePlayers(user.program_id, a.audience).map((id) => j(db.get('SELECT u.id, u.name, pp.jersey, pp.units, pp.positions, pp.availability, pp.avail_note, pp.team_id FROM users u JOIN player_profiles pp ON pp.user_id=u.id WHERE u.id=?', id), 'units', 'positions'));
    if (query.unit) players = players.filter((p) => p.units.includes(query.unit));
    if (query.position) players = players.filter((p) => p.positions.includes(query.position));
    if (query.team_id) players = players.filter((p) => p.team_id === Number(query.team_id));
    const dateless = a.mode === 'dateless';
    const dueDays = dateless ? a.days : a.days.filter((d) => dueDate(a, d) <= today());
    const rows = players.map((p) => {
      const prof = profileOf(p.id);
      const done = dueDays.filter((d) => resolveDay(p.id, a, d, { profile: prof }).complete).length;
      const lastLog = db.get('SELECT max(date) d FROM wt_logs WHERE player_id=?', p.id).d;
      return { ...p, due: dueDays.length, completed: done, behind: dateless ? 0 : Math.max(0, dueDays.length - done), last_log: lastLog, streak: ctx.strength?.streak(p.id) ?? null };
    }).sort((x, y) => y.behind - x.behind || x.name.localeCompare(y.name));
    // Progress over time: group average of best maxes per month for main lifts.
    const ids = players.map((p) => p.id);
    const progress = {};
    if (ids.length) {
      for (const key of ['squat', 'bench', 'clean']) {
        progress[key] = db.all(`SELECT substr(date,1,7) month, round(avg(value)) avg FROM tests WHERE test_key=? AND player_id IN (${ids.map(() => '?').join(',')}) GROUP BY month ORDER BY month`, key, ...ids);
      }
    }
    return { assignments: assignments.map((x) => ({ id: x.id, program_name: x.program_name, start_date: x.start_date, mode: x.mode, audience_labels: core.describeAudience(user.program_id, x.audience) })), assignment_id: a.id, mode: a.mode, due_days: dueDays.length, rows, progress };
  });
  router.get('/api/wt-dashboard/export.csv', ({ user }) => {
    need(isStaff(user), 403, 'Staff only');
    const rows = db.all(`SELECT u.name, l.date, e.name exercise, l.set_no, l.reps, l.weight FROM wt_logs l JOIN users u ON u.id=l.player_id LEFT JOIN exercises e ON e.id=l.exercise_id WHERE u.program_id=? ORDER BY l.date DESC, u.name`, user.program_id);
    audit(user, 'export', 'workouts', null);
    return csvResponse('workout-logs.csv', csv(rows, [{ label: 'Player', key: 'name' }, { label: 'Date', key: 'date' }, { label: 'Exercise', key: 'exercise' }, { label: 'Set', key: 'set_no' }, { label: 'Reps', key: 'reps' }, { label: 'Weight', key: 'weight' }]));
  });

  // ---------- body weight (WGT-9, F-8) — coaches with body-data access only, unless the head coach opens it to families ----------
  const familySees = (u) => !!core.settings(u.program_id).family_sees_bodyweight;
  const staffSeesBody = (u, pid) => (isAdmin(u) || can(u, 'body.view')) && playerIn(u, pid);
  const canSeeBody = (u, pid) => staffSeesBody(u, pid) || (familySees(u) && core.linkedPlayers(u).includes(pid));
  router.get('/api/bodyweight/:playerId', ({ user, params }) => {
    const pid = Number(params.playerId);
    need(canSeeBody(user, pid), 403, 'Body weight is private to coaches who have been granted access');
    if (isStaff(user)) audit(user, 'view', 'bodyweight', pid);
    // Coaches also see weigh-ins from testing days and the roster (kind 'weight'); families see their own log only.
    const kinds = isStaff(user) ? "('bodyweight','weight')" : "('bodyweight')";
    return db.all(`SELECT m.id, m.value, m.date, m.kind, u.name by_name FROM measurements m LEFT JOIN users u ON u.id=m.by_user WHERE m.player_id=? AND m.kind IN ${kinds} ORDER BY m.date, m.id`, pid);
  });
  router.post('/api/bodyweight', ({ user, body }) => {
    const pid = Number(body.player_id || user.id);
    need((pid === user.id && user.role === 'player') || (isStaff(user) && staffSeesBody(user, pid)), 403, 'You cannot record body weight for this player');
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
    need(core.linkedPlayers(user).includes(pid) || (isStaff(user) && playerIn(user, pid)), 403, 'No access');
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
