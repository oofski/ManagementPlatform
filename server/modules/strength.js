// Weight room v2 (on top of weights.js): group layers (C-7), templates and position-group assignment (C-10, F-1),
// game-week scaling (F-5), station mode and TV display (C-11, C-14), training maxes and PRs (C-15), team feed with
// milestone clubs and weekly awards (C-17, F-19), wellness (C-18), lift streaks (C-20), reports and CSV (C-21),
// scheduled weekly email (C-22), testing battery, norms, composite scores and comparisons (F-6, F-7, F-9).
import { need, nowLocal, today, addDays, parseLocal } from '../core.js';
import { j, jAll } from '../db.js';
import { csv, csvResponse } from '../app.js';
import { TESTS, MEASURES, epley } from './weights.js';
import { ensureLibrary, ensureTemplates, exerciseIdByName, POS_GROUPS, groupOf, athleteGroup, groupTokens, CLUBS, REFERENCE_NORMS, ACTIVATION, TEMPLATES } from '../strength-data.js';

const SETTING_KEYS = ['leaderboard', 'leaderboard_hidden', 'family_sees_bodyweight', 'weekly_report_enabled', 'weekly_report_weekday', 'weekly_report_hour',
  'weekly_report_athlete', 'weekly_report_parent', 'weekly_report_ad'];
const PHASES = { offseason: 'Offseason', summer: 'Summer', preseason: 'Preseason', in_season: 'In-season', playoffs: 'Playoffs' };
const ATTENDED = ['present', 'late', 'left_early'];
const daysBetween = (a, b) => Math.round((parseLocal(`${b}T00:00`) - parseLocal(`${a}T00:00`)) / 86400000);
const mondayOf = (d) => { const x = parseLocal(`${d}T00:00`); return addDays(d, -((x.getDay() + 6) % 7)); };
export function gradeOf(classYear, on = today()) {
  if (!classYear) return null;
  const y = Number(on.slice(0, 4)); const m = Number(on.slice(5, 7));
  const g = 12 - (Number(classYear) - (m >= 7 ? y + 1 : y));
  return Math.max(9, Math.min(12, g));
}
const pctile = (sorted, p) => {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p; const lo = Math.floor(i); const hi = Math.ceil(i);
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)) * 100) / 100;
};
const rankPct = (values, v, lowerBetter) => {
  if (!values.length || v == null) return null;
  const worse = values.filter((x) => (lowerBetter ? x > v : x < v)).length;
  const eq = values.filter((x) => x === v).length;
  return Math.round(((worse + 0.5 * eq) / values.length) * 100);
};

export default function strength(ctx) {
  const { router, db, core } = ctx;
  const { can, isStaff, isAdmin, audit } = core;
  const wt = ctx.wt;
  const editor = (u) => need(can(u, 'weights.edit'), 403, 'Coaches and trainers only');
  const staffOnly = (u) => need(isStaff(u), 403, 'Staff only');
  const playerIn = (u, id) => !!db.get(`SELECT 1 FROM users WHERE id=? AND program_id=? AND role='player'`, id, u.program_id);
  const teamIn = (u, id) => !!db.get('SELECT 1 FROM teams t JOIN levels l ON l.id=t.level_id WHERE t.id=? AND l.program_id=?', id, u.program_id);
  const teamName = (id) => { const t = db.get('SELECT t.name, l.name lname FROM teams t JOIN levels l ON l.id=t.level_id WHERE t.id=?', id); return t ? (t.name === t.lname ? t.name : `${t.lname} ${t.name}`) : null; };
  const asnOf = (u, id) => {
    const a = j(db.get(`SELECT a.*, p.name program_name, p.weeks, p.days, coalesce(m.mode,'dated') mode, coalesce(m.kind,'lift') kind FROM wt_assignments a
      JOIN wt_programs p ON p.id=a.wt_program_id LEFT JOIN wt_program_meta m ON m.wt_program_id=p.id WHERE a.id=? AND a.program_id=?`, Number(id), u.program_id), 'audience', 'days');
    need(a, 404, 'Assignment not found');
    return a;
  };
  function programPlayers(programId, { teamId, group, levelId } = {}) {
    let rows = jAll(db.all(`SELECT u.id, u.name, u.email, p.*, t.level_id, t.name team_name FROM users u JOIN player_profiles p ON p.user_id=u.id LEFT JOIN teams t ON t.id=p.team_id
      WHERE u.program_id=? AND u.role='player' AND u.active=1 AND p.archived=0 ORDER BY u.name`, programId), 'units', 'positions');
    for (const r of rows) { r.id = r.user_id; r.group = athleteGroup(r.primary_group, r.positions); r.grade = gradeOf(r.class_year); r.team = teamName(r.team_id); }
    if (teamId) rows = rows.filter((r) => r.team_id === Number(teamId));
    if (levelId) rows = rows.filter((r) => r.level_id === Number(levelId));
    if (group) rows = rows.filter((r) => r.group === group);
    return rows;
  }
  const playerCard = (r) => ({ id: r.id, name: r.name, jersey: r.jersey, team_id: r.team_id, team: r.team, positions: r.positions, group: r.group, grade: r.grade, availability: r.availability, avail_note: r.avail_note, return_date: r.return_date });

  // ---------- feed (C-17) ----------
  function post(programId, o) {
    const r = db.run(`INSERT OR IGNORE INTO wt_feed (program_id, team_id, kind, title, body, player_id, by_user, ref, at) VALUES (?,?,?,?,?,?,?,?,?)`,
      programId, o.team_id ?? null, o.kind, o.title, o.body || null, o.player_id ?? null, o.by_user ?? null, o.ref ?? null, o.at || nowLocal().replace('T', ' '));
    return r.changes ? Number(r.lastInsertRowid) : null;
  }
  const liftLabel = (k) => (TESTS[k]?.label || k).replace(/ 1RM$/, '');
  // Best value on record for a test, from tests and training maxes, optionally excluding one test row.
  function bestOf(pid, key, exceptTestId = null) {
    const lower = TESTS[key]?.better === 'lower';
    const fn = lower ? 'min' : 'max';
    const t = db.get(`SELECT ${fn}(value) v FROM tests WHERE player_id=? AND test_key=? AND id IS NOT ?`, pid, key, exceptTestId).v;
    const m = lower ? null : db.get('SELECT max(value) v FROM training_maxes WHERE player_id=? AND test_key=?', pid, key).v;
    const vals = [t, m].filter((x) => x != null);
    return vals.length ? (lower ? Math.min(...vals) : Math.max(...vals)) : null;
  }
  function checkClubs(programId, pid, key, value, before, date) {
    const club = CLUBS.find((c) => c.key === key);
    if (!club) return [];
    const p = db.get('SELECT u.name, pp.team_id FROM users u JOIN player_profiles pp ON pp.user_id=u.id WHERE u.id=?', pid);
    const out = [];
    for (const t of club.thresholds) {
      const now = club.lower ? value < t : value >= t;
      const was = before != null && (club.lower ? before < t : before >= t);
      if (now && !was) {
        const id = post(programId, { team_id: p?.team_id, kind: 'milestone', title: `${p?.name} joined the ${club.label(t)}`, body: `${liftLabel(key)}: ${value} ${TESTS[key]?.unit || ''}`.trim(), player_id: pid, ref: `club:${pid}:${key}:${t}`, at: `${date} ${nowLocal().slice(11)}` });
        if (id) out.push(club.label(t));
      }
    }
    return out;
  }
  // C-15: estimated 1RM from a logged set; a new high becomes the training max used for % loads.
  function afterLog(user, pid, row) {
    const ex = db.get('SELECT test_key, name FROM exercises WHERE id=?', row.exercise_id);
    const key = ex?.test_key;
    if (!key || !TESTS[key]?.rep_test || !(row.weight > 0) || !(row.reps >= 1 && row.reps <= 10)) return null;
    const e1 = epley(row.weight, row.reps);
    const cur = wt.maxInfo(pid, key).max;
    if (cur != null && e1 <= cur) return null;
    const best = bestOf(pid, key);
    const pr = best == null || e1 > best;
    const programId = db.get('SELECT program_id FROM users WHERE id=?', pid).program_id;
    const id = db.insert('training_maxes', { player_id: pid, test_key: key, value: e1, date: row.date || today(), source: 'session', exercise_id: row.exercise_id, log_id: row.log_id, weight: row.weight, reps: row.reps, prev_value: cur, pr: pr ? 1 : 0 });
    if (pr) {
      const p = db.get('SELECT u.name, pp.team_id FROM users u JOIN player_profiles pp ON pp.user_id=u.id WHERE u.id=?', pid);
      post(programId, { team_id: p?.team_id, kind: 'pr', title: `${p?.name}: new ${liftLabel(key).toLowerCase()} PR, ${e1} lb`, body: `Estimated from ${row.weight} x ${row.reps} on ${ex.name.toLowerCase()}`, player_id: pid, ref: `pr:tm:${id}` });
      checkClubs(programId, pid, key, e1, best, row.date || today());
    }
    return { test_key: key, value: e1, previous: cur, pr };
  }
  function afterTest(user, pid, key, value, date, { pr, test_id }) {
    const before = bestOf(pid, key, test_id);
    if (pr && before != null) {
      const p = db.get('SELECT u.name, pp.team_id FROM users u JOIN player_profiles pp ON pp.user_id=u.id WHERE u.id=?', pid);
      post(user.program_id, { team_id: p?.team_id, kind: 'pr', title: `${p?.name}: new ${liftLabel(key).toLowerCase()} PR, ${value} ${TESTS[key].unit}`, body: `Testing day, ${date}`, player_id: pid, ref: `pr:test:${test_id}` });
    }
    checkClubs(user.program_id, pid, key, value, before, date);
  }

  // ---------- game week (F-5) ----------
  function nextGame(programId, prof, from) {
    if (!prof) return null;
    const games = jAll(db.all(`SELECT id, title, start, audience FROM events WHERE program_id=? AND type='game' AND coalesce(status,'scheduled')!='cancelled' AND substr(start,1,10)>=? ORDER BY start LIMIT 40`, programId, from), 'audience');
    return games.find((g) => g.audience.some((t) => t === 'program' || t === `team:${prof.team_id}` || t === `level:${prof.level_id}` || t === `player:${prof.user_id}`)) || null;
  }
  function gameWeekFor(prof, date, programId) {
    const g = nextGame(programId, prof, date);
    const out = { next_game: g ? { id: g.id, title: g.title, start: g.start } : null, days_out: g ? daysBetween(date, g.start.slice(0, 10)) : null, factor: 1, pct_drop: 0, activation: false };
    if (!g || out.days_out > 6) out.label = 'No game this week: full volume';
    else if (out.days_out >= 4) out.label = `${out.days_out} days to the game: full volume`;
    else if (out.days_out === 3) { out.factor = 0.75; out.label = '3 days to the game: volume about 75 percent'; }
    else if (out.days_out === 2) { out.factor = 0.5; out.pct_drop = 5; out.label = '2 days to the game: volume about half, loads 5 percent lighter'; }
    else { out.activation = true; out.label = out.days_out === 0 ? 'Game day: activation lift' : 'Day before the game: activation lift'; }
    return out;
  }
  function activationExercises(programId) {
    ensureLibrary(db, programId);
    return ACTIVATION.map(([name, sets, reps, pct, rpe, rest, note]) => ({ exercise_id: exerciseIdByName(db, programId, name), sets, reps, pct, rpe, rest, note })).filter((x) => x.exercise_id);
  }

  // ---------- streaks and lift attendance (C-20, reads the attendance owned by the attendance module) ----------
  function streak(pid) {
    const rows = db.all(`SELECT a.status FROM attendance a JOIN events e ON e.id=a.event_id WHERE a.player_id=? AND e.type='lift' AND e.start<=? AND coalesce(e.status,'scheduled')!='cancelled' ORDER BY e.start DESC LIMIT 120`, pid, nowLocal());
    let n = 0;
    for (const r of rows) { if (ATTENDED.includes(r.status)) n++; else if (r.status === 'excused') continue; else break; }
    return n;
  }
  function liftAttendance(pid, from, to) {
    const r = db.get(`SELECT count(*) total, sum(CASE WHEN a.status IN ('present','late','left_early') THEN 1 ELSE 0 END) att FROM attendance a JOIN events e ON e.id=a.event_id
      WHERE a.player_id=? AND e.type='lift' AND substr(e.start,1,10)>=? AND substr(e.start,1,10)<=? AND a.status!='excused'`, pid, from, to);
    return { attended: r.att || 0, total: r.total || 0, rate: r.total ? Math.round(((r.att || 0) / r.total) * 100) : null };
  }

  ctx.strength = { afterLog, afterTest, gameWeekFor, activationExercises, streak, liftAttendance, post };

  // ---------- meta and settings ----------
  router.get('/api/strength/meta', ({ user }) => {
    const s = core.settings(user.program_id);
    const me = user.role === 'player' ? db.get('SELECT team_id, positions, primary_group FROM player_profiles WHERE user_id=?', user.id) : null;
    return {
      tests: TESTS, measures: MEASURES, groups: Object.keys(POS_GROUPS), phases: PHASES, clubs: CLUBS.map((c) => ({ key: c.key, labels: c.thresholds.map((t) => c.label(t)) })),
      can_edit: can(user, 'weights.edit'), is_admin: isAdmin(user), body_view: isAdmin(user) || can(user, 'body.view'),
      settings: Object.fromEntries(SETTING_KEYS.map((k) => [k, s[k]])),
      my_team_id: me?.team_id ?? null, my_group: me ? athleteGroup(me.primary_group, JSON.parse(me.positions || '[]')) : null,
      teams: db.all('SELECT t.id, t.name, l.name lname, l.id level_id FROM teams t JOIN levels l ON l.id=t.level_id WHERE l.program_id=? ORDER BY l.sort, t.name', user.program_id).map((t) => ({ id: t.id, level_id: t.level_id, name: t.name === t.lname ? t.name : `${t.lname} ${t.name}` })),
    };
  });
  router.put('/api/strength/settings', ({ user, body }) => {
    need(isAdmin(user), 403, 'Only the head coach can change these settings');
    const s = core.settings(user.program_id);
    const next = { ...s };
    for (const k of SETTING_KEYS) if (body[k] !== undefined) next[k] = body[k];
    need(Array.isArray(next.leaderboard_hidden), 400, 'Hidden leaderboards must be a list');
    need(Number(next.weekly_report_weekday) >= 0 && Number(next.weekly_report_weekday) <= 6 && Number(next.weekly_report_hour) >= 0 && Number(next.weekly_report_hour) <= 23, 400, 'Pick a weekday and hour');
    db.run('UPDATE programs SET settings=? WHERE id=?', JSON.stringify(next), user.program_id);
    audit(user, 'update_settings', 'program', user.program_id, Object.fromEntries(SETTING_KEYS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]])));
    return { ok: true, settings: Object.fromEntries(SETTING_KEYS.map((k) => [k, next[k]])) };
  });

  // ---------- C-7 group layer ----------
  const validToken = (u, tok) => {
    const [k, v] = String(tok || '').split(':');
    if (k === 'pg') return !!POS_GROUPS[v];
    if (k === 'pos') return !!db.get('SELECT 1 FROM positions WHERE program_id=? AND code=?', u.program_id, v);
    if (k === 'team') return teamIn(u, Number(v));
    if (k === 'level') return !!db.get('SELECT 1 FROM levels WHERE id=? AND program_id=?', Number(v), u.program_id);
    if (k === 'unit') return ['offense', 'defense', 'special'].includes(v);
    if (k === 'group') return !!db.get('SELECT 1 FROM custom_groups WHERE id=? AND program_id=?', Number(v), u.program_id);
    return false;
  };
  router.get('/api/strength/assignments/:id/group-overrides', ({ user, params }) => {
    staffOnly(user);
    const a = asnOf(user, params.id);
    return db.all('SELECT o.*, e.name exercise_name, x.name alt_name FROM wt_group_overrides o LEFT JOIN exercises e ON e.id=o.exercise_id LEFT JOIN exercises x ON x.id=o.alt_exercise_id WHERE o.assignment_id=? ORDER BY o.id', a.id)
      .map((o) => ({ ...o, group_label: wt.tokenLabel(user.program_id, o.group_token) }));
  });
  router.post('/api/strength/assignments/:id/group-overrides', ({ user, params, body }) => {
    editor(user);
    const a = asnOf(user, params.id);
    need(validToken(user, body.group_token), 400, 'Pick a team, position or group');
    for (const k of ['exercise_id', 'alt_exercise_id']) if (body[k]) need(db.get('SELECT 1 FROM exercises WHERE id=? AND program_id=?', Number(body[k]), user.program_id), 400, 'Unknown exercise');
    if (body.rpe != null && body.rpe !== '') need(Number(body.rpe) >= 1 && Number(body.rpe) <= 10, 400, 'RPE must be between 1 and 10');
    db.run('DELETE FROM wt_group_overrides WHERE assignment_id=? AND group_token=? AND coalesce(exercise_id,0)=coalesce(?,0)', a.id, body.group_token, body.exercise_id || null);
    const id = db.insert('wt_group_overrides', { assignment_id: a.id, group_token: body.group_token, exercise_id: body.exercise_id || null, alt_exercise_id: body.alt_exercise_id || null, sets: body.sets || null, reps: body.reps || null, pct: body.pct || null, rpe: body.rpe || null, note: body.note || null, by_user: user.id });
    audit(user, 'wt_group_override', 'wt_assignment', a.id, { group: body.group_token });
    return { id };
  });
  router.del('/api/strength/group-overrides/:id', ({ user, params }) => {
    editor(user);
    const o = db.get('SELECT o.id FROM wt_group_overrides o JOIN wt_assignments a ON a.id=o.assignment_id WHERE o.id=? AND a.program_id=?', Number(params.id), user.program_id);
    need(o, 404, 'Change not found');
    db.run('DELETE FROM wt_group_overrides WHERE id=?', o.id);
    return { ok: true };
  });
  // The resolved plan for one athlete, with the layer each prescription comes from.
  router.get('/api/strength/assignments/:id/resolved', ({ user, params, query }) => {
    staffOnly(user);
    const a = asnOf(user, params.id);
    const ids = core.resolvePlayers(user.program_id, a.audience);
    const roster = programPlayers(user.program_id).filter((p) => ids.includes(p.id));
    const pid = Number(query.player_id || roster[0]?.id || 0);
    if (!pid) return { assignment: { id: a.id, program_name: a.program_name, mode: a.mode }, roster: [], days: [] };
    need(ids.includes(pid), 404, 'That athlete is not on this assignment');
    const prof = wt.profileOf(pid);
    const days = a.days.slice().sort((x, y) => x.week - y.week || x.day - y.day).map((d) => ({ ...wt.resolveDay(pid, a, d, { profile: prof }), due: wt.dueDate(a, d) }));
    const athleteOv = db.get('SELECT count(*) n FROM wt_overrides WHERE assignment_id=?', a.id).n;
    return {
      assignment: { id: a.id, program_name: a.program_name, mode: a.mode, start_date: a.start_date, audience_labels: core.describeAudience(user.program_id, a.audience), athlete_overrides: athleteOv },
      player: playerCard(roster.find((r) => r.id === pid)), roster: roster.map((r) => ({ id: r.id, name: r.name, jersey: r.jersey, group: r.group, availability: r.availability, overrides: db.get('SELECT count(*) n FROM wt_overrides WHERE assignment_id=? AND player_id=?', a.id, r.id).n })),
      days,
    };
  });

  // ---------- C-10 templates, F-1 position-group assignment ----------
  router.get('/api/strength/templates', ({ user }) => {
    staffOnly(user);
    ensureTemplates(db, user.program_id);
    return jAll(db.all(`SELECT p.id, p.name, p.description, p.weeks, p.days, coalesce(m.mode,'dated') mode, coalesce(m.kind,'lift') kind, m.phase, m.position_group, m.template_key, coalesce(m.builtin,0) builtin
      FROM wt_programs p LEFT JOIN wt_program_meta m ON m.wt_program_id=p.id WHERE p.program_id=? AND p.is_template=1 ORDER BY coalesce(m.kind,'lift'), p.name`, user.program_id), 'days')
      .map(({ days, ...t }) => ({ ...t, sessions: days.length, days_per_week: new Set(days.filter((d) => d.week === 1).map((d) => d.day)).size }));
  });
  function copyProgram(user, srcId, name, extraMeta = {}) {
    const src = wt.progOf(user.program_id, Number(srcId));
    need(src, 404, 'Program or template not found');
    const meta = wt.metaOf(src.id);
    const id = db.insert('wt_programs', { program_id: user.program_id, name: name || src.name, description: src.description, weeks: src.weeks, days: src.days, is_template: 0, created_by: user.id });
    wt.saveMeta(id, { ...meta, builtin: 0, ...extraMeta });
    return { id, src };
  }
  function assign(user, program, audience, start, label) {
    const id = db.insert('wt_assignments', { program_id: user.program_id, wt_program_id: program.id, audience, start_date: start || today(), season_id: core.currentSeason(user.program_id)?.id, created_by: user.id });
    core.notify(user.program_id, core.resolvePlayers(user.program_id, audience), { kind: 'update', title: `New ${program.kind === 'conditioning' ? 'conditioning plan' : 'lifting program'}: ${label}`, body: `Starts ${start || today()}`, link: '/weights', email: false });
    audit(user, 'assign', 'wt_program', program.id, { assignment: id, audience });
    return id;
  }
  router.post('/api/strength/templates/:id/use', ({ user, params, body }) => {
    editor(user);
    const { id } = copyProgram(user, params.id, body.name, body.mode ? { mode: body.mode } : {});
    audit(user, 'create', 'wt_program', id, { from_template: Number(params.id) });
    return { id };
  });
  // F-1: assign a block or conditioning plan to a position group (and optionally one team) in one action.
  router.post('/api/strength/assign-group', ({ user, body }) => {
    editor(user);
    need(POS_GROUPS[body.group], 400, 'Pick a position group');
    const src = wt.progOf(user.program_id, Number(body.wt_program_id));
    need(src, 404, 'Program or template not found');
    const srcMeta = wt.metaOf(src.id);
    let programId = src.id; let name = src.name;
    if (src.is_template) { name = `${src.name.replace(/ \(.*\)$/, '')}: ${body.group}`; programId = copyProgram(user, src.id, name, { position_group: body.group }).id; }
    const audience = groupTokens(body.group);
    if (body.team_id) {
      need(teamIn(user, Number(body.team_id)), 400, 'Unknown team');
      // audiences are unions, so a team-only position group becomes a list of those players
      const ids = programPlayers(user.program_id, { teamId: body.team_id, group: body.group }).map((p) => p.id);
      need(ids.length, 400, 'No athletes in that team and group');
      audience.splice(0, audience.length, ...ids.map((x) => `player:${x}`));
    }
    const asn = assign(user, { id: programId, kind: srcMeta.kind }, audience, body.start_date, name);
    return { program_id: programId, assignment_id: asn, audience, athletes: core.resolvePlayers(user.program_id, audience).length };
  });

  // ---------- F-5 game week ----------
  router.get('/api/strength/game-week', ({ user, query }) => {
    staffOnly(user);
    const teams = db.all('SELECT t.id, t.level_id FROM teams t JOIN levels l ON l.id=t.level_id WHERE l.program_id=?', user.program_id);
    const t = teams.find((x) => x.id === Number(query.team_id)) || teams[0];
    need(t, 404, 'No teams yet');
    const prof = { user_id: 0, team_id: t.id, level_id: t.level_id };
    const from = query.date || today();
    const g = nextGame(user.program_id, prof, from);
    const days = [];
    for (let i = 0; i < 7; i++) { const d = addDays(from, i); days.push({ date: d, ...gameWeekFor(prof, d, user.program_id) }); if (g && d >= g.start.slice(0, 10)) break; }
    const tpl = db.get(`SELECT p.id FROM wt_programs p JOIN wt_program_meta m ON m.wt_program_id=p.id WHERE p.program_id=? AND p.is_template=1 AND m.template_key='game-week'`, user.program_id);
    return { team_id: t.id, team: teamName(t.id), next_game: g ? { id: g.id, title: g.title, start: g.start } : null, days, template_id: tpl?.id || null };
  });
  router.post('/api/strength/game-week', ({ user, body }) => {
    editor(user);
    ensureTemplates(db, user.program_id);
    need(teamIn(user, Number(body.team_id)), 400, 'Pick a team');
    const tpl = db.get(`SELECT p.id FROM wt_programs p JOIN wt_program_meta m ON m.wt_program_id=p.id WHERE p.program_id=? AND p.is_template=1 AND m.template_key='game-week'`, user.program_id);
    const start = body.start_date || mondayOf(today());
    const name = `Game week: ${teamName(Number(body.team_id))}, week of ${start}`;
    const { id } = copyProgram(user, body.wt_program_id || tpl.id, name, { mode: 'game_week' });
    const asn = assign(user, { id, kind: 'lift' }, [`team:${Number(body.team_id)}`], start, name);
    return { program_id: id, assignment_id: asn };
  });

  // ---------- C-11 station mode ----------
  const dayFor = (a, d) => a.days.find((x) => x.week === Number(d.week) && x.day === Number(d.day));
  router.get('/api/strength/station/roster', ({ user, query }) => {
    editor(user);
    const list = jAll(db.all(`SELECT a.*, p.name program_name, p.days, coalesce(m.mode,'dated') mode FROM wt_assignments a JOIN wt_programs p ON p.id=a.wt_program_id LEFT JOIN wt_program_meta m ON m.wt_program_id=p.id
      WHERE a.program_id=? ORDER BY a.start_date DESC, a.id DESC`, user.program_id), 'audience', 'days');
    const a = list.find((x) => x.id === Number(query.assignment_id)) || list[0];
    if (!a) return { assignments: [], players: [] };
    const ids = core.resolvePlayers(user.program_id, a.audience);
    const sorted = a.days.slice().sort((x, y) => x.week - y.week || x.day - y.day);
    const todays = a.mode === 'dateless' ? null : sorted.find((d) => wt.dueDate(a, d) === today()) || sorted.find((d) => wt.dueDate(a, d) > today());
    return {
      assignments: list.map((x) => ({ id: x.id, program_name: x.program_name, mode: x.mode, audience_labels: core.describeAudience(user.program_id, x.audience) })),
      assignment: { id: a.id, program_name: a.program_name, mode: a.mode, days: sorted.map((d) => ({ week: d.week, day: d.day, label: d.label, due: wt.dueDate(a, d) })), today: todays ? { week: todays.week, day: todays.day } : null },
      players: programPlayers(user.program_id).filter((p) => ids.includes(p.id)).map(playerCard),
    };
  });
  router.get('/api/strength/station', ({ user, query }) => {
    editor(user);
    const a = asnOf(user, query.assignment_id);
    const ids = String(query.players || '').split(',').map(Number).filter(Boolean);
    need(ids.length >= 1 && ids.length <= 8, 400, 'Pick 1 to 8 athletes');
    const inAud = new Set(core.resolvePlayers(user.program_id, a.audience));
    const roster = programPlayers(user.program_id);
    const players = ids.map((pid) => {
      need(inAud.has(pid), 404, 'An athlete is not on this assignment');
      const prof = wt.profileOf(pid);
      let d = query.week ? dayFor(a, query) : null;
      if (!d) {
        const resolved = a.days.map((x) => wt.resolveDay(pid, a, x, { profile: prof }));
        const n = wt.nextDayIndex(a, resolved);
        d = a.days[n >= 0 ? n : 0];
      }
      need(d, 404, 'Workout day not found');
      return { ...playerCard(roster.find((r) => r.id === pid) || { id: pid }), workout: { ...wt.resolveDay(pid, a, d, { profile: prof }), due: wt.dueDate(a, d) } };
    });
    return { assignment: { id: a.id, program_name: a.program_name, mode: a.mode }, players, at: nowLocal() };
  });

  // ---------- C-14 TV display ----------
  router.get('/api/strength/tv', ({ user, query }) => {
    staffOnly(user);
    const list = jAll(db.all(`SELECT a.*, p.name program_name, p.days, coalesce(m.mode,'dated') mode FROM wt_assignments a JOIN wt_programs p ON p.id=a.wt_program_id LEFT JOIN wt_program_meta m ON m.wt_program_id=p.id
      WHERE a.program_id=? ORDER BY a.start_date DESC, a.id DESC`, user.program_id), 'audience', 'days');
    const a = list.find((x) => x.id === Number(query.assignment_id)) || list[0];
    if (!a) return { assignments: [], day: null };
    const sorted = a.days.slice().sort((x, y) => x.week - y.week || x.day - y.day);
    const d = (query.week && dayFor(a, query)) || (a.mode !== 'dateless' && (sorted.find((x) => wt.dueDate(a, x) === today()) || sorted.find((x) => wt.dueDate(a, x) > today()))) || sorted[0];
    const gov = db.all('SELECT o.*, x.name alt_name FROM wt_group_overrides o LEFT JOIN exercises x ON x.id=o.alt_exercise_id WHERE o.assignment_id=?', a.id);
    const tok = query.group || null;
    const exercises = (d?.exercises || []).map((x) => {
      const ex = db.get('SELECT name, cues FROM exercises WHERE id=?', Number(x.exercise_id)) || { name: 'Exercise' };
      const mine = gov.filter((g) => g.exercise_id === Number(x.exercise_id) || (g.exercise_id == null && !g.alt_exercise_id));
      const covers = (gt) => gt === tok || (String(tok).startsWith('pg:') && gt.startsWith('pos:') && (POS_GROUPS[tok.slice(3)] || []).includes(gt.slice(4)));
      const applied = tok ? mine.find((g) => covers(g.group_token)) : null;
      return {
        name: applied?.alt_name || ex.name, cues: ex.cues, sets: applied?.sets ?? x.sets, reps: applied?.reps ?? x.reps, pct: applied?.pct ?? x.pct ?? null, rpe: applied?.rpe ?? x.rpe ?? null, rest: x.rest || null, note: applied?.note || x.note || null,
        variants: tok ? [] : mine.map((g) => ({ group: wt.tokenLabel(user.program_id, g.group_token), text: [g.alt_name, g.sets ? `${g.sets} sets` : '', g.reps ? `${g.reps} reps` : '', g.pct ? `${g.pct}%` : '', g.note].filter(Boolean).join(' · ') })),
      };
    });
    const prs = db.all(`SELECT title FROM wt_feed WHERE program_id=? AND kind IN ('pr','milestone') AND removed=0 AND at>=? ORDER BY at DESC LIMIT 6`, user.program_id, addDays(today(), -3));
    let gw = null;
    if (a.mode === 'game_week') {
      const team = a.audience.find((t) => t.startsWith('team:'));
      const tm = team ? db.get('SELECT id, level_id FROM teams WHERE id=?', Number(team.slice(5))) : null;
      if (tm) gw = gameWeekFor({ user_id: 0, team_id: tm.id, level_id: tm.level_id }, wt.dueDate(a, d) || today(), user.program_id);
    }
    return {
      assignments: list.map((x) => ({ id: x.id, program_name: x.program_name, audience_labels: core.describeAudience(user.program_id, x.audience) })),
      assignment: { id: a.id, program_name: a.program_name, mode: a.mode, audience_labels: core.describeAudience(user.program_id, a.audience) },
      days: sorted.map((x) => ({ week: x.week, day: x.day, label: x.label, due: wt.dueDate(a, x) })),
      day: d ? { week: d.week, day: d.day, label: gw?.activation ? 'Game-day activation' : d.label, due: wt.dueDate(a, d) } : null,
      exercises: gw?.activation ? activationExercises(user.program_id).map((x) => ({ ...x, name: db.get('SELECT name FROM exercises WHERE id=?', x.exercise_id).name, variants: [] })) : gw && gw.factor < 1 ? exercises.map((x) => ({ ...x, sets: Math.max(1, Math.round(x.sets * gw.factor)), pct: x.pct && gw.pct_drop ? x.pct - gw.pct_drop : x.pct })) : exercises,
      group: tok ? wt.tokenLabel(user.program_id, tok) : null, game_week: gw, prs: prs.map((p) => p.title), at: nowLocal(),
    };
  });

  // ---------- C-17 feed ----------
  function feedTeams(u) {
    if (isStaff(u)) return null; // all
    const ids = core.linkedPlayers(u);
    return [...new Set(ids.map((id) => db.get('SELECT team_id FROM player_profiles WHERE user_id=?', id)?.team_id).filter(Boolean))];
  }
  router.get('/api/strength/feed', ({ user, query }) => {
    const teams = feedTeams(user);
    const where = ['f.program_id=?', 'f.removed=0']; const args = [user.program_id];
    if (teams) { where.push(`(f.team_id IS NULL${teams.length ? ` OR f.team_id IN (${teams.map(() => '?').join(',')})` : ''})`); args.push(...teams); }
    if (query.team_id) { where.push('(f.team_id=? OR f.team_id IS NULL)'); args.push(Number(query.team_id)); }
    if (query.kind) { where.push('f.kind=?'); args.push(query.kind); }
    const rows = db.all(`SELECT f.*, u.name by_name FROM wt_feed f LEFT JOIN users u ON u.id=f.by_user WHERE ${where.join(' AND ')} ORDER BY f.at DESC, f.id DESC LIMIT ?`, ...args, Math.min(200, Number(query.limit) || 60));
    return { posts: rows.map((r) => ({ ...r, team: r.team_id ? teamName(r.team_id) : 'Whole program' })), can_post: can(user, 'weights.edit') };
  });
  router.post('/api/strength/feed', ({ user, body }) => {
    editor(user);
    need(String(body.title || '').trim(), 400, 'Write a post');
    if (body.team_id) need(teamIn(user, Number(body.team_id)), 400, 'Unknown team');
    const id = post(user.program_id, { team_id: body.team_id ? Number(body.team_id) : null, kind: 'coach', title: String(body.title).trim().slice(0, 200), body: body.body ? String(body.body).slice(0, 2000) : null, by_user: user.id });
    audit(user, 'post', 'wt_feed', id);
    return { id };
  });
  router.del('/api/strength/feed/:id', ({ user, params }) => {
    editor(user);
    const f = db.get('SELECT id FROM wt_feed WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    need(f, 404, 'Post not found');
    db.run('UPDATE wt_feed SET removed=1, removed_by=? WHERE id=?', user.id, f.id);
    audit(user, 'remove', 'wt_feed', f.id);
    return { ok: true };
  });
  // F-19 weekly awards for the week starting `weekStart` (Monday), one post per team per award, idempotent.
  function weeklyAwards(programId, weekStart) {
    const end = addDays(weekStart, 6);
    const teams = db.all('SELECT t.id FROM teams t JOIN levels l ON l.id=t.level_id WHERE l.program_id=?', programId);
    let n = 0;
    for (const t of teams) {
      const sets = db.get(`SELECT l.player_id, u.name, count(*) n FROM wt_logs l JOIN users u ON u.id=l.player_id JOIN player_profiles p ON p.user_id=u.id
        WHERE p.team_id=? AND l.date>=? AND l.date<=? GROUP BY l.player_id ORDER BY n DESC, u.name LIMIT 1`, t.id, weekStart, end);
      if (sets && post(programId, { team_id: t.id, kind: 'award', title: `Weekly award (${teamName(t.id)}): most sets logged`, body: `${sets.name}, ${sets.n} sets in the week of ${weekStart}`, player_id: sets.player_id, ref: `award:${t.id}:${weekStart}:sets`, at: `${addDays(end, 1)} 06:00` })) n++;
      const prs = db.get(`SELECT f.player_id, u.name, count(*) n FROM wt_feed f JOIN users u ON u.id=f.player_id WHERE f.program_id=? AND f.team_id=? AND f.kind='pr' AND f.removed=0
        AND substr(f.at,1,10)>=? AND substr(f.at,1,10)<=? GROUP BY f.player_id ORDER BY n DESC, u.name LIMIT 1`, programId, t.id, weekStart, end);
      if (prs && post(programId, { team_id: t.id, kind: 'award', title: `Weekly award (${teamName(t.id)}): most PRs`, body: `${prs.name}, ${prs.n} PR${prs.n > 1 ? 's' : ''} in the week of ${weekStart}`, player_id: prs.player_id, ref: `award:${t.id}:${weekStart}:prs`, at: `${addDays(end, 1)} 06:01` })) n++;
    }
    return n;
  }
  router.post('/api/strength/awards', ({ user, body }) => {
    editor(user);
    const week = body.week_start ? mondayOf(body.week_start) : addDays(mondayOf(today()), -7);
    return { posted: weeklyAwards(user.program_id, week), week_start: week };
  });

  // ---------- C-18 wellness ----------
  const SCALES = ['sleep_quality', 'soreness', 'mood', 'stress'];
  const flagsOf = (w) => {
    if (!w) return [];
    const f = [];
    if (w.sleep_hours != null && w.sleep_hours < 6) f.push('Under 6 hours of sleep');
    for (const k of SCALES) if (w[k] != null && w[k] <= 2) f.push({ sleep_quality: 'Poor sleep', soreness: 'Very sore', mood: 'Low mood', stress: 'High stress' }[k]);
    return f;
  };
  const wellnessScore = (w) => (w ? Math.round((SCALES.reduce((s, k) => s + (w[k] || 0), 0) / (SCALES.length * 5)) * 100) : null);
  const canSeeWellness = (u, pid) => (u.role === 'player' && u.id === pid) || ((can(u, 'weights.edit') || isAdmin(u)) && playerIn(u, pid));
  router.post('/api/wellness', ({ user, body }) => {
    need(user.role === 'player', 403, 'Athletes fill in their own check-in');
    const date = body.date || today();
    need(date <= today() && date >= addDays(today(), -2), 400, 'Check-ins are for today or the last two days');
    need(Number(body.sleep_hours) >= 0 && Number(body.sleep_hours) <= 16, 400, 'Enter hours of sleep');
    for (const k of SCALES) need(Number.isInteger(Number(body[k])) && Number(body[k]) >= 1 && Number(body[k]) <= 5, 400, 'Answer each question from 1 to 5');
    db.run(`INSERT INTO wellness (player_id, date, sleep_hours, sleep_quality, soreness, mood, stress, note, client_id, at) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(player_id, date) DO UPDATE SET sleep_hours=excluded.sleep_hours, sleep_quality=excluded.sleep_quality, soreness=excluded.soreness, mood=excluded.mood, stress=excluded.stress, note=excluded.note, at=excluded.at`,
    user.id, date, Number(body.sleep_hours), ...SCALES.map((k) => Number(body[k])), body.note ? String(body.note).slice(0, 500) : null, body.client_id || null, nowLocal());
    const w = db.get('SELECT * FROM wellness WHERE player_id=? AND date=?', user.id, date);
    return { ok: true, flags: flagsOf(w), score: wellnessScore(w) };
  });
  router.get('/api/wellness/player/:id', ({ user, params, query }) => {
    const pid = Number(params.id);
    need(canSeeWellness(user, pid), 403, 'Wellness check-ins are visible to the athlete and their strength coaches');
    const from = query.from || addDays(today(), -27);
    const rows = db.all('SELECT * FROM wellness WHERE player_id=? AND date>=? ORDER BY date', pid, from).map((w) => ({ ...w, flags: flagsOf(w), score: wellnessScore(w) }));
    return { rows, today: rows.find((r) => r.date === today()) || null };
  });
  router.get('/api/wellness/dashboard', ({ user, query }) => {
    need(can(user, 'weights.edit') || isAdmin(user), 403, 'Coaches and trainers only');
    const date = query.date || today();
    const roster = programPlayers(user.program_id, { teamId: query.team_id, group: query.group || null });
    const rows = roster.map((p) => {
      const w = db.get('SELECT * FROM wellness WHERE player_id=? AND date=?', p.id, date);
      const week = db.all('SELECT * FROM wellness WHERE player_id=? AND date>? AND date<=? ORDER BY date', p.id, addDays(date, -7), date);
      const avg = (k) => (week.length ? Math.round((week.reduce((s, r) => s + (r[k] || 0), 0) / week.length) * 10) / 10 : null);
      return { ...playerCard(p), checkin: w ? { ...w, flags: flagsOf(w), score: wellnessScore(w) } : null, week: { n: week.length, sleep_hours: avg('sleep_hours'), soreness: avg('soreness'), mood: avg('mood'), stress: avg('stress'), score: week.length ? Math.round(week.reduce((s, r) => s + wellnessScore(r), 0) / week.length) : null } };
    });
    const flagged = rows.filter((r) => r.checkin?.flags.length);
    return { date, responded: rows.filter((r) => r.checkin).length, total: rows.length, flagged: flagged.length, rows: rows.sort((a, b) => (b.checkin?.flags.length || 0) - (a.checkin?.flags.length || 0) || (a.checkin ? 0 : 1) - (b.checkin ? 0 : 1) || a.name.localeCompare(b.name)) };
  });

  // ---------- athlete summary (C-12 phone view, C-15 maxes, C-20 streak) ----------
  router.get('/api/strength/athlete/:id', ({ user, params }) => {
    const pid = Number(params.id);
    need((isStaff(user) && playerIn(user, pid)) || core.linkedPlayers(user).includes(pid), 403, 'No access');
    const maxes = Object.keys(TESTS).filter((k) => TESTS[k].rep_test).map((k) => ({ key: k, label: liftLabel(k), ...wt.maxInfo(pid, k), best: bestOf(pid, k) })).filter((m) => m.max != null || m.best != null);
    const history = db.all('SELECT test_key, value, date, weight, reps, pr FROM training_maxes WHERE player_id=? ORDER BY date DESC, id DESC LIMIT 20', pid);
    const clubs = db.all(`SELECT title, at FROM wt_feed WHERE player_id=? AND kind='milestone' AND removed=0 ORDER BY at DESC`, pid);
    const att = liftAttendance(pid, addDays(today(), -27), today());
    const w = db.get('SELECT * FROM wellness WHERE player_id=? AND date=?', pid, today());
    return { maxes, history, clubs, streak: streak(pid), lift_attendance_4wk: att, wellness_today: user.role === 'parent' ? undefined : (w ? { ...w, flags: flagsOf(w) } : null) };
  });

  // ---------- C-21 reports ----------
  function report(user, query) {
    const to = query.to || today(); const from = query.from || addDays(to, -27);
    need(from <= to, 400, 'The start date must be before the end date');
    const roster = programPlayers(user.program_id, { teamId: query.team_id, group: query.group || null });
    const asns = jAll(db.all(`SELECT a.*, p.days, coalesce(m.mode,'dated') mode FROM wt_assignments a JOIN wt_programs p ON p.id=a.wt_program_id LEFT JOIN wt_program_meta m ON m.wt_program_id=p.id WHERE a.program_id=?`, user.program_id), 'audience', 'days')
      .map((a) => ({ ...a, members: new Set(core.resolvePlayers(user.program_id, a.audience)) }));
    const rows = roster.map((p) => {
      const prof = wt.profileOf(p.id);
      let due = 0; let done = 0;
      for (const a of asns) {
        if (!a.members.has(p.id)) continue;
        for (const d of a.days) {
          if (a.mode === 'dateless') {
            const r = wt.resolveDay(p.id, a, d, { profile: prof });
            const last = db.get('SELECT max(date) d FROM wt_logs WHERE player_id=? AND assignment_id=? AND week=? AND day=?', p.id, a.id, d.week, d.day).d;
            if (r.complete && last >= from && last <= to) { due++; done++; }
            continue;
          }
          const dd = wt.dueDate(a, d);
          if (dd < from || dd > to || dd > today()) continue;
          due++;
          if (wt.resolveDay(p.id, a, d, { profile: prof }).complete) done++;
        }
      }
      const sets = db.get('SELECT count(*) n FROM wt_logs WHERE player_id=? AND date>=? AND date<=?', p.id, from, to).n;
      const progress = {};
      for (const k of ['squat', 'bench', 'clean']) {
        const before = db.get(`SELECT max(v) v FROM (SELECT max(value) v FROM tests WHERE player_id=? AND test_key=? AND date<? UNION ALL SELECT max(value) FROM training_maxes WHERE player_id=? AND test_key=? AND date<?)`, p.id, k, from, p.id, k, from).v;
        const after = db.get(`SELECT max(v) v FROM (SELECT max(value) v FROM tests WHERE player_id=? AND test_key=? AND date<=? UNION ALL SELECT max(value) FROM training_maxes WHERE player_id=? AND test_key=? AND date<=?)`, p.id, k, to, p.id, k, to).v;
        progress[k] = before != null && after != null ? after - before : null;
      }
      const prs = db.get(`SELECT count(*) n FROM wt_feed WHERE player_id=? AND kind='pr' AND removed=0 AND substr(at,1,10)>=? AND substr(at,1,10)<=?`, p.id, from, to).n;
      const att = liftAttendance(p.id, from, to);
      return { id: p.id, name: p.name, jersey: p.jersey, team: p.team, team_id: p.team_id, group: p.group, grade: p.grade, availability: p.availability,
        sessions_due: due, sessions_done: done, completion: due ? Math.round((done / due) * 100) : null, sets, prs, progress, lift_attended: att.attended, lift_total: att.total, attendance: att.rate, streak: streak(p.id) };
    });
    const by = query.by || 'athlete';
    if (by === 'athlete') return { from, to, by, rows };
    const key = by === 'team' ? 'team' : 'group';
    const groups = {};
    for (const r of rows) (groups[r[key] || 'Unassigned'] ||= []).push(r);
    const avg = (list, f) => { const v = list.map(f).filter((x) => x != null); return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null; };
    return { from, to, by, rows: Object.entries(groups).map(([name, list]) => ({
      name, athletes: list.length, sessions_due: list.reduce((s, r) => s + r.sessions_due, 0), sessions_done: list.reduce((s, r) => s + r.sessions_done, 0),
      completion: (() => { const d = list.reduce((s, r) => s + r.sessions_due, 0); return d ? Math.round((list.reduce((s, r) => s + r.sessions_done, 0) / d) * 100) : null; })(),
      sets: list.reduce((s, r) => s + r.sets, 0), prs: list.reduce((s, r) => s + r.prs, 0),
      progress: { squat: avg(list, (r) => r.progress.squat), bench: avg(list, (r) => r.progress.bench), clean: avg(list, (r) => r.progress.clean) },
      attendance: avg(list, (r) => r.attendance), streak: avg(list, (r) => r.streak),
    })).sort((a, b) => a.name.localeCompare(b.name)) };
  }
  router.get('/api/strength/reports', ({ user, query }) => { editorOrAdminStaff(user); return report(user, query); });
  router.get('/api/strength/reports/export.csv', ({ user, query }) => {
    editorOrAdminStaff(user);
    const r = report(user, query);
    audit(user, 'export', 'wt_report', null, { from: r.from, to: r.to, by: r.by });
    const prog = (k) => (x) => x.progress[k];
    const cols = r.by === 'athlete'
      ? [{ label: 'Athlete', key: 'name' }, { label: 'Jersey', key: 'jersey' }, { label: 'Team', key: 'team' }, { label: 'Position group', key: 'group' }, { label: 'Grade', key: 'grade' }]
      : [{ label: r.by === 'team' ? 'Team' : 'Position group', key: 'name' }, { label: 'Athletes', key: 'athletes' }];
    cols.push({ label: 'Sessions due', key: 'sessions_due' }, { label: 'Sessions done', key: 'sessions_done' }, { label: 'Completion %', key: 'completion' }, { label: 'Sets logged', key: 'sets' },
      { label: 'PRs', key: 'prs' }, { label: 'Squat change (lb)', get: prog('squat') }, { label: 'Bench change (lb)', get: prog('bench') }, { label: 'Clean change (lb)', get: prog('clean') },
      { label: 'Lift attendance %', key: 'attendance' }, { label: 'Streak', key: 'streak' });
    return csvResponse(`weight-room-${r.by}-${r.from}-to-${r.to}.csv`, csv(r.rows, cols));
  });
  function editorOrAdminStaff(u) { need(can(u, 'weights.edit') || isAdmin(u) || u.staff_kind === 'athletic_director', 403, 'Coaches, trainers and the athletic director only'); }

  // ---------- C-22 weekly email ----------
  function athleteWeek(pid, from, to) {
    const p = db.get('SELECT u.name FROM users u WHERE u.id=?', pid);
    const sessions = db.all('SELECT DISTINCT assignment_id, week, day FROM wt_logs WHERE player_id=? AND date>=? AND date<=? AND assignment_id IS NOT NULL', pid, from, to).length;
    const sets = db.get('SELECT count(*) n FROM wt_logs WHERE player_id=? AND date>=? AND date<=?', pid, from, to).n;
    const prs = db.all(`SELECT title FROM wt_feed WHERE player_id=? AND kind IN ('pr','milestone') AND removed=0 AND substr(at,1,10)>=? AND substr(at,1,10)<=? ORDER BY at`, pid, from, to).map((r) => r.title.replace(`${p.name}: `, '').replace(`${p.name} `, ''));
    const att = liftAttendance(pid, from, to);
    return { name: p.name, sessions, sets, prs, att, streak: streak(pid) };
  }
  function athleteText(w, from, to, forParent) {
    const who = forParent ? w.name : 'You';
    return [`Weight room week of ${from} to ${to}`, '',
      `${who} logged ${w.sessions} session${w.sessions === 1 ? '' : 's'} and ${w.sets} set${w.sets === 1 ? '' : 's'}.`,
      w.att.total ? `Lift attendance: ${w.att.attended} of ${w.att.total} (${w.att.rate}%). Current streak: ${w.streak}.` : `Current lift streak: ${w.streak}.`,
      w.prs.length ? `Personal records and milestones: ${w.prs.join('; ')}.` : 'No new personal records this week.', '', 'Open the app for the full workout history.'].join('\n');
  }
  function weeklyReport(programId, { now = nowLocal(), force = false, dry = false } = {}) {
    const s = core.settings(programId);
    const date = now.slice(0, 10);
    const week = mondayOf(date);
    if (!force) {
      if (!s.weekly_report_enabled) return { skipped: 'disabled' };
      const dow = parseLocal(`${date}T00:00`).getDay();
      if (dow !== Number(s.weekly_report_weekday) || Number(now.slice(11, 13)) < Number(s.weekly_report_hour)) return { skipped: 'not yet' };
      if (db.get('SELECT 1 FROM wt_report_log WHERE program_id=? AND week=? AND kind=?', programId, week, 'weekly_email')) return { skipped: 'already sent' };
    }
    const to = addDays(date, -1); const from = addDays(date, -7);
    const players = programPlayers(programId);
    const out = { week, from, to, athletes: 0, parents: 0, ad: 0, messages: [] };
    const send = (uid, title, body) => {
      if (dry) { out.messages.push({ user_id: uid, title, body }); return; }
      core.notify(programId, [uid], { kind: 'update', title, body, link: '/weights', from: 'system' });
    };
    if (!dry) db.run('INSERT OR IGNORE INTO wt_report_log (program_id, week, kind) VALUES (?,?,?)', programId, week, 'weekly_email');
    const teamTotals = {};
    for (const p of players) {
      const w = athleteWeek(p.id, from, to);
      const tt = (teamTotals[p.team || 'No team'] ||= { athletes: 0, sessions: 0, prs: 0, att: 0, total: 0 });
      tt.athletes++; tt.sessions += w.sessions; tt.prs += w.prs.length; tt.att += w.att.attended; tt.total += w.att.total;
      if (s.weekly_report_athlete) { send(p.id, 'Your weight room week', athleteText(w, from, to, false)); out.athletes++; }
      if (s.weekly_report_parent) for (const r of db.all('SELECT parent_id FROM parent_links WHERE player_id=?', p.id)) { send(r.parent_id, `${p.name}: weight room week`, athleteText(w, from, to, true)); out.parents++; }
    }
    if (s.weekly_report_ad) {
      const body = [`Weight room summary, ${from} to ${to}`, '', ...Object.entries(teamTotals).map(([t, v]) => `${t}: ${v.athletes} athletes, ${v.sessions} sessions logged, ${v.prs} PRs and milestones, lift attendance ${v.total ? Math.round((v.att / v.total) * 100) + '%' : 'not taken'}.`)].join('\n');
      for (const r of db.all(`SELECT id FROM users WHERE program_id=? AND staff_kind='athletic_director' AND active=1`, programId)) { send(r.id, 'Weekly weight room report', body); out.ad++; }
    }
    if (!dry) db.run('UPDATE wt_report_log SET sent=? WHERE program_id=? AND week=? AND kind=?', out.athletes + out.parents + out.ad, programId, week, 'weekly_email');
    return out;
  }
  router.get('/api/strength/weekly-report/preview', ({ user, query }) => {
    editorOrAdminStaff(user);
    const pid = Number(query.player_id) || programPlayers(user.program_id)[0]?.id;
    need(pid && playerIn(user, pid), 404, 'Player not found');
    const date = today(); const to = addDays(date, -1); const from = addDays(date, -7);
    const w = athleteWeek(pid, from, to);
    const ad = weeklyReport(user.program_id, { force: true, dry: true });
    const s = core.settings(user.program_id);
    return {
      from, to, settings: Object.fromEntries(SETTING_KEYS.filter((k) => k.startsWith('weekly_report')).map((k) => [k, s[k]])),
      athlete: { subject: 'Your weight room week', body: athleteText(w, from, to, false) },
      parent: { subject: `${w.name}: weight room week`, body: athleteText(w, from, to, true), recipients: db.get('SELECT count(*) n FROM parent_links WHERE player_id=?', pid).n },
      ad: ad.messages.find((m) => m.title === 'Weekly weight room report') || null,
      last_sent: db.get(`SELECT week, sent, at FROM wt_report_log WHERE program_id=? AND kind='weekly_email' ORDER BY week DESC LIMIT 1`, user.program_id) || null,
    };
  });
  router.post('/api/strength/weekly-report/send', ({ user }) => {
    need(isAdmin(user), 403, 'Only the head coach can send the weekly report now');
    const r = weeklyReport(user.program_id, { force: true });
    audit(user, 'send', 'wt_weekly_report', null, { week: r.week, athletes: r.athletes, parents: r.parents, ad: r.ad });
    return { week: r.week, athletes: r.athletes, parents: r.parents, ad: r.ad };
  });
  ctx.strength.weeklyReport = weeklyReport;
  ctx.strength.weeklyAwards = weeklyAwards;
  ctx.ticks.push(() => {
    const now = nowLocal();
    const monday = parseLocal(`${now.slice(0, 10)}T00:00`).getDay() === 1;
    for (const p of db.all('SELECT id FROM programs')) {
      weeklyReport(p.id, { now });
      if (monday && now.slice(11, 13) >= '06') weeklyAwards(p.id, addDays(mondayOf(now.slice(0, 10)), -7));
    }
  });

  // ---------- F-6 testing day (battery) ----------
  router.post('/api/strength/testing-day', ({ user, body }) => {
    editor(user);
    const date = body.date || today();
    const entries = (body.entries || []).filter((e) => (e.value !== '' && e.value != null) || (e.weight && e.reps));
    need(entries.length, 400, 'Enter at least one result');
    const results = db.tx(() => entries.map((e) => {
      try {
        if (MEASURES[e.test_key]) {
          need(playerIn(user, Number(e.player_id)) && Number(e.value) > 0, 400, 'Player and value are required');
          const v = Number(e.value);
          need(e.test_key === 'height' ? v >= 48 && v <= 90 : v > 50 && v < 500, 400, e.test_key === 'height' ? 'Height is in inches' : 'Weight is in pounds');
          return { player_id: Number(e.player_id), test_key: e.test_key, id: db.insert('measurements', { player_id: Number(e.player_id), kind: e.test_key, value: v, date, by_user: user.id, season_id: core.currentSeason(user.program_id)?.id }) };
        }
        return { player_id: Number(e.player_id), test_key: e.test_key, ...ctx.wt.saveTest(user, { ...e, date }) };
      } catch (err) { return { player_id: Number(e.player_id), test_key: e.test_key, error: err.message }; }
    }));
    audit(user, 'testing_day', 'tests', null, { date, count: results.filter((r) => !r.error).length });
    return { results, saved: results.filter((r) => !r.error).length, prs: results.filter((r) => r.pr).length };
  });
  router.get('/api/strength/test-dates', ({ user }) => {
    staffOnly(user);
    return db.all('SELECT t.date, count(*) n, count(DISTINCT t.test_key) tests FROM tests t JOIN users u ON u.id=t.player_id WHERE u.program_id=? GROUP BY t.date ORDER BY t.date DESC LIMIT 60', user.program_id);
  });
  // Latest results for the battery, one row per athlete with every test (plus height and weight for coaches).
  router.get('/api/strength/battery', ({ user, query }) => {
    staffOnly(user);
    const roster = programPlayers(user.program_id, { teamId: query.team_id, group: query.group || null });
    const keys = Object.keys(TESTS);
    const seeBody = isAdmin(user) || can(user, 'body.view') || can(user, 'ratings.view');
    return {
      tests: TESTS, measures: seeBody ? MEASURES : {},
      rows: roster.map((p) => {
        const res = {};
        for (const k of keys) {
          const last = db.get('SELECT t.value, t.date, d.weight, d.reps FROM tests t LEFT JOIN test_details d ON d.test_id=t.id WHERE t.player_id=? AND t.test_key=? ORDER BY t.date DESC, t.id DESC LIMIT 1', p.id, k);
          if (last) res[k] = { ...last, best: bestOf(p.id, k) };
        }
        if (seeBody) for (const k of Object.keys(MEASURES)) { const m = db.get('SELECT value, date FROM measurements WHERE player_id=? AND kind=? ORDER BY date DESC, id DESC LIMIT 1', p.id, k); if (m) res[k] = m; }
        return { ...playerCard(p), results: res };
      }),
    };
  });

  // ---------- F-9 norms ----------
  function bests(programId, key, roster) {
    const lower = TESTS[key].better === 'lower';
    const out = new Map();
    for (const r of db.all(`SELECT t.player_id, ${lower ? 'min' : 'max'}(t.value) v FROM tests t JOIN users u ON u.id=t.player_id WHERE u.program_id=? AND t.test_key=? GROUP BY t.player_id`, programId, key)) out.set(r.player_id, r.v);
    return roster.filter((p) => out.has(p.id)).map((p) => ({ ...p, value: out.get(p.id) }));
  }
  const dist = (vals) => { const s = vals.slice().sort((a, b) => a - b); return { n: s.length, p25: pctile(s, 0.25), p50: pctile(s, 0.5), p75: pctile(s, 0.75), p90: pctile(s, 0.9), p10: pctile(s, 0.1) }; };
  router.get('/api/strength/norms', ({ user, query }) => {
    staffOnly(user);
    const key = query.test_key || 'forty';
    need(TESTS[key], 400, 'Unknown test');
    const lower = TESTS[key].better === 'lower';
    const list = bests(user.program_id, key, programPlayers(user.program_id));
    const by = (f) => { const g = {}; for (const r of list) { const k = f(r); if (k != null) (g[k] ||= []).push(r.value); } return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, dist(v)])); };
    const gradeVals = {}; const groupVals = {};
    for (const r of list) { (gradeVals[r.grade] ||= []).push(r.value); (groupVals[r.group] ||= []).push(r.value); }
    const players = Object.fromEntries(list.map((r) => [r.id, { value: r.value, grade: r.grade, group: r.group, grade_pct: rankPct(gradeVals[r.grade] || [], r.value, lower), group_pct: rankPct(groupVals[r.group] || [], r.value, lower), program_pct: rankPct(list.map((x) => x.value), r.value, lower) }]));
    return { test: { key, ...TESTS[key] }, program: dist(list.map((r) => r.value)), by_grade: by((r) => r.grade), by_group: by((r) => r.group), players, reference: REFERENCE_NORMS[key] || null };
  });

  // ---------- F-7 composite scores and before/after comparison ----------
  const compOf = (u, id) => { const c = j(db.get('SELECT * FROM wt_composites WHERE id=? AND program_id=?', Number(id), u.program_id), 'tests'); need(c, 404, 'Composite not found'); return c; };
  const validComp = (tests) => {
    need(Array.isArray(tests) && tests.length, 400, 'Pick at least one test');
    for (const t of tests) need(TESTS[t.key] && Number(t.weight) > 0, 400, 'Each test needs a known test and a weight above 0');
    return tests.map((t) => ({ key: t.key, weight: Number(t.weight) }));
  };
  router.get('/api/strength/composites', ({ user }) => { staffOnly(user); return jAll(db.all('SELECT * FROM wt_composites WHERE program_id=? ORDER BY name', user.program_id), 'tests'); });
  router.post('/api/strength/composites', ({ user, body }) => {
    editor(user); need(String(body.name || '').trim(), 400, 'Name is required');
    return { id: db.insert('wt_composites', { program_id: user.program_id, name: String(body.name).trim(), tests: validComp(body.tests), created_by: user.id }) };
  });
  router.put('/api/strength/composites/:id', ({ user, params, body }) => {
    editor(user); const c = compOf(user, params.id);
    db.update('wt_composites', c.id, { ...(body.name ? { name: body.name } : {}), ...(body.tests ? { tests: validComp(body.tests) } : {}) });
    return { ok: true };
  });
  router.del('/api/strength/composites/:id', ({ user, params }) => { editor(user); const c = compOf(user, params.id); db.run('DELETE FROM wt_composites WHERE id=?', c.id); return { ok: true }; });
  router.get('/api/strength/composites/:id/scores', ({ user, params, query }) => {
    staffOnly(user);
    const c = compOf(user, params.id);
    // Normalized scoring: each test becomes a percentile within the cohort (reversed when lower is better), then a weighted average.
    const roster = programPlayers(user.program_id, { teamId: query.team_id, group: query.group || null });
    const per = {};
    for (const t of c.tests) { const list = bests(user.program_id, t.key, roster); per[t.key] = { vals: list.map((x) => x.value), map: new Map(list.map((x) => [x.id, x.value])) }; }
    const rows = roster.map((p) => {
      let sw = 0; let sum = 0; const parts = {};
      for (const t of c.tests) {
        const v = per[t.key].map.get(p.id);
        if (v == null) continue;
        const pc = rankPct(per[t.key].vals, v, TESTS[t.key].better === 'lower');
        parts[t.key] = { value: v, pct: pc }; sw += t.weight; sum += t.weight * pc;
      }
      const total = c.tests.reduce((s, t) => s + t.weight, 0);
      return { ...playerCard(p), score: sw ? Math.round(sum / sw) : null, coverage: Math.round((sw / total) * 100), parts };
    }).filter((r) => r.score != null).sort((a, b) => b.score - a.score);
    return { composite: c, rows };
  });
  router.get('/api/strength/compare', ({ user, query }) => {
    staffOnly(user);
    const key = query.test_key || 'squat';
    need(TESTS[key], 400, 'Unknown test');
    need(query.date_a && query.date_b, 400, 'Pick two test dates');
    const lower = TESTS[key].better === 'lower';
    const fn = lower ? 'min' : 'max';
    const win = (d) => [addDays(d, -3), addDays(d, 3)];
    const roster = programPlayers(user.program_id, { teamId: query.team_id });
    const at = (pid, d) => { const [a, b] = win(d); return db.get(`SELECT ${fn}(value) v FROM tests WHERE player_id=? AND test_key=? AND date>=? AND date<=?`, pid, key, a, b).v; };
    const groups = {};
    for (const p of roster) {
      const a = at(p.id, query.date_a); const b = at(p.id, query.date_b);
      if (a == null && b == null) continue;
      const g = (groups[p.group || 'Unassigned'] ||= { a: [], b: [], both: [] });
      if (a != null) g.a.push(a); if (b != null) g.b.push(b);
      if (a != null && b != null) g.both.push(b - a);
    }
    const mean = (v) => (v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 100) / 100 : null);
    const rows = Object.entries(groups).map(([group, g]) => {
      const change = mean(g.both);
      return { group, n_a: g.a.length, n_b: g.b.length, n_both: g.both.length, avg_a: mean(g.a), avg_b: mean(g.b), change, improved: change == null ? null : lower ? change < 0 : change > 0, improved_athletes: g.both.filter((d) => (lower ? d < 0 : d > 0)).length };
    }).sort((x, y) => Object.keys(POS_GROUPS).indexOf(x.group) - Object.keys(POS_GROUPS).indexOf(y.group));
    return { test: { key, ...TESTS[key] }, date_a: query.date_a, date_b: query.date_b, rows };
  });

  // ---------- program templates listing helpers for the UI ----------
  router.get('/api/strength/template-keys', () => TEMPLATES.map((t) => ({ key: t.key, name: t.name, kind: t.kind, phase: t.phase, position_group: t.position_group || null })));
}
