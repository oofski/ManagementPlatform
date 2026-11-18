// Module 10: Season tracking and player development — seasons and phases, week-by-week season plan,
// one development timeline per player, trends vs position-group average, group view, goals, home screens,
// structured evaluations and end-of-season reports.
import { fail, need, nowLocal, addDays, parseLocal, fmtLocal, today } from '../core.js';
import { j, jAll } from '../db.js';
import { TESTS } from './weights.js';

export const EVAL_POINTS = ['preseason', 'midseason', 'end'];
export const EVAL_CRITERIA = {
  offense: ['Technique', 'Assignment knowledge', 'Effort', 'Physicality', 'Ball skills', 'Football IQ'],
  defense: ['Technique', 'Assignment knowledge', 'Effort', 'Tackling', 'Pursuit', 'Football IQ'],
  special: ['Technique', 'Consistency', 'Effort', 'Composure'],
};

export default function season(ctx) {
  const { router, db, core } = ctx;
  const { can, isStaff, isAdmin, audit, notify } = core;
  const seasonOf = (pid, id) => j(db.get('SELECT * FROM seasons WHERE id=? AND program_id=?', id, pid), 'phases', 'goals');
  const coachView = (u) => isStaff(u) && u.role !== 'staff' || isAdmin(u);

  // ---------- seasons (SEA-1) ----------
  router.get('/api/seasons', ({ user }) => jAll(db.all('SELECT * FROM seasons WHERE program_id=? ORDER BY start_date DESC', user.program_id), 'phases', 'goals'));
  router.post('/api/seasons', ({ user, body }) => {
    need(isAdmin(user), 403, 'Head coach only');
    need(body.name && body.start_date && body.end_date && body.end_date >= body.start_date, 400, 'Name and valid dates are required');
    const id = db.insert('seasons', { program_id: user.program_id, name: body.name, start_date: body.start_date, end_date: body.end_date, phases: body.phases || [], goals: body.goals || {}, active: 0 });
    if (body.activate) { db.run('UPDATE seasons SET active=0 WHERE program_id=?', user.program_id); db.run('UPDATE seasons SET active=1 WHERE id=?', id); }
    audit(user, 'create', 'season', id);
    return { id };
  });
  router.put('/api/seasons/:id', ({ user, params, body }) => {
    need(isAdmin(user), 403, 'Head coach only');
    const s = seasonOf(user.program_id, Number(params.id));
    need(s, 404, 'Season not found');
    const upd = {};
    for (const k of ['name', 'start_date', 'end_date']) if (body[k]) upd[k] = body[k];
    if (body.phases) {
      need(Array.isArray(body.phases) && body.phases.every((p) => p.name && p.start && p.end && p.end >= p.start), 400, 'Each phase needs a name and dates');
      upd.phases = body.phases;
    }
    if (body.goals) upd.goals = body.goals;
    db.update('seasons', s.id, upd);
    audit(user, 'edit', 'season', s.id);
    return { ok: true };
  });
  router.post('/api/seasons/:id/activate', ({ user, params }) => {
    need(isAdmin(user), 403, 'Head coach only');
    need(seasonOf(user.program_id, Number(params.id)), 404, 'Season not found');
    db.run('UPDATE seasons SET active=0 WHERE program_id=?', user.program_id);
    db.run('UPDATE seasons SET active=1 WHERE id=?', Number(params.id));
    return { ok: true };
  });

  // ---------- season plan (SEA-2) ----------
  router.get('/api/seasons/:id/plan', ({ user, params }) => {
    need(isStaff(user), 403, 'Staff only');
    const s = seasonOf(user.program_id, Number(params.id));
    need(s, 404, 'Season not found');
    const d0 = parseLocal(s.start_date + 'T00:00'); d0.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));
    const weeks = [];
    let cur = fmtLocal(d0).slice(0, 10);
    let n = 1;
    while (cur <= s.end_date && weeks.length < 60) {
      const end = addDays(cur, 6);
      const evs = db.all(`SELECT e.id, e.type, e.title, e.start, e.status, (SELECT id FROM practice_plans WHERE event_id=e.id) plan_id FROM events e WHERE e.program_id=? AND e.start>=? AND e.start<=? AND e.type IN ('game','practice','meeting','social','film') ORDER BY e.start`, user.program_id, cur, end + 'T23:59');
      const phase = (s.phases || []).find((p) => p.start <= end && p.end >= cur);
      const due = db.all(`SELECT id, title, due FROM assignments WHERE program_id=? AND is_template=0 AND due>=? AND due<=? ORDER BY due`, user.program_id, cur, end + 'T23:59');
      weeks.push({
        week: n++, from: cur, to: end, phase: phase?.name || null, phase_goals: phase?.goals || null, week_goal: (s.goals || {})[cur] || null,
        games: evs.filter((e) => e.type === 'game'), practices: evs.filter((e) => e.type === 'practice'), key_dates: [...evs.filter((e) => !['game', 'practice'].includes(e.type)), ...due.map((a) => ({ id: a.id, type: 'assignment', title: `Due: ${a.title}`, start: a.due }))],
      });
      cur = addDays(cur, 7);
    }
    return { season: s, weeks };
  });
  router.put('/api/seasons/:id/week-goal', ({ user, params, body }) => {
    need(isAdmin(user) || user.role === 'coach', 403, 'Coaches only');
    const s = seasonOf(user.program_id, Number(params.id));
    need(s, 404, 'Season not found');
    const goals = { ...(s.goals || {}), [body.week_from]: body.goal || undefined };
    db.update('seasons', s.id, { goals });
    return { ok: true };
  });

  // ---------- development record (SEA-3, SEA-4, SEA-8) ----------
  function weekKey(date) { const d = parseLocal(date.slice(0, 10) + 'T00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fmtLocal(d).slice(0, 10); }
  function groupIds(programId, positions) {
    if (!positions.length) return [];
    return db.all(`SELECT u.id, pp.positions FROM users u JOIN player_profiles pp ON pp.user_id=u.id WHERE u.program_id=? AND u.role='player' AND pp.archived=0`, programId)
      .map((r) => j(r, 'positions')).filter((r) => r.positions.includes(positions[0])).map((r) => r.id);
  }
  function ratingTrend(ids, from) {
    if (!ids.length) return [];
    const rows = db.all(`SELECT date, value FROM ratings WHERE player_id IN (${ids.map(() => '?').join(',')}) AND date>=?`, ...ids, from);
    const by = {};
    for (const r of rows) { const k = weekKey(r.date); (by[k] ||= []).push(r.value); }
    return Object.entries(by).sort().map(([week, v]) => ({ week, avg: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100, n: v.length }));
  }
  function attendanceRate(pid, from) {
    const r = db.get(`SELECT count(*) total, sum(a.status IN ('present','late','left_early')) here FROM attendance a JOIN events e ON e.id=a.event_id WHERE a.player_id=? AND a.confirmed=1 AND e.start>=?`, pid, from);
    return r.total ? Math.round((r.here / r.total) * 100) : null;
  }
  function goalProgress(g) {
    if (g.kind === 'test' && g.test_key && g.target != null) {
      const t = TESTS[g.test_key];
      const latest = db.get('SELECT value FROM tests WHERE player_id=? AND test_key=? ORDER BY date DESC, id DESC LIMIT 1', g.player_id, g.test_key)?.value;
      const base = g.baseline ?? latest;
      if (latest == null || base == null) return { ...g, current: latest ?? null, pct: 0 };
      const span = g.target - base;
      const pct = span === 0 ? 100 : Math.max(0, Math.min(100, Math.round(((latest - base) / span) * 100)));
      return { ...g, current: latest, pct, unit: t?.unit, achieved: t?.better === 'lower' ? latest <= g.target : latest >= g.target };
    }
    return { ...g, pct: g.progress, achieved: g.status === 'achieved' };
  }

  router.get('/api/development/:playerId', ({ user, params, query }) => {
    const pid = Number(params.playerId);
    const self = core.linkedPlayers(user).includes(pid);
    need(coachView(user) || self, 403, 'Development records are visible to coaches only unless the program shares them');
    const p = j(db.get(`SELECT u.id, u.name, pp.jersey, pp.positions, pp.units, pp.class_year, pp.photo, pp.availability, t.name team, l.name level FROM users u JOIN player_profiles pp ON pp.user_id=u.id LEFT JOIN teams t ON t.id=pp.team_id LEFT JOIN levels l ON l.id=t.level_id WHERE u.id=? AND u.program_id=?`, pid, user.program_id), 'positions', 'units');
    need(p, 404, 'Player not found');
    const s = core.settings(user.program_id);
    const season = query.season_id ? seasonOf(user.program_id, Number(query.season_id)) : core.currentSeason(user.program_id);
    const from = season?.start_date || '0000';
    const to = season?.end_date || '9999';
    const seeRatings = (coachView(user) && can(user, 'ratings.view')) || (self && s.players_see_ratings);
    const seeTrends = coachView(user) || (self && s.players_see_trends);
    const timeline = [];
    if (seeRatings) {
      for (const r of db.all(`SELECT r.date, r.value, d.name drill, c.name coach FROM ratings r LEFT JOIN drills d ON d.id=r.drill_id LEFT JOIN users c ON c.id=r.coach_id WHERE r.player_id=? AND r.date>=? AND r.date<=?`, pid, from, to))
        timeline.push({ date: r.date, kind: 'rating', text: `Rated ${r.value}/${s.rating_scale}${r.drill ? ' in ' + r.drill : ''}`, by: r.coach, value: r.value });
      if (coachView(user)) for (const n of jAll(db.all(`SELECT n.date, n.tags, n.text, c.name coach FROM practice_notes n LEFT JOIN users c ON c.id=n.coach_id WHERE n.player_id=? AND n.date>=? AND n.date<=?`, pid, from, to), 'tags'))
        timeline.push({ date: n.date, kind: 'note', text: [n.tags.join(', '), n.text].filter(Boolean).join(' — '), by: n.coach });
    }
    for (const a of db.all(`SELECT a.status, a.reason, e.title, e.start FROM attendance a JOIN events e ON e.id=a.event_id WHERE a.player_id=? AND a.confirmed=1 AND e.start>=? AND e.start<=? AND a.status!='present'`, pid, from, to + 'T23:59'))
      timeline.push({ date: a.start.slice(0, 10), kind: 'attendance', text: `${a.status.replace('_', ' ')}: ${a.title}${a.reason ? ' (' + a.reason + ')' : ''}` });
    for (const t of db.all('SELECT * FROM tests WHERE player_id=? AND date>=? AND date<=?', pid, from, to))
      timeline.push({ date: t.date, kind: 'test', text: `${TESTS[t.test_key]?.label || t.test_key}: ${t.value} ${TESTS[t.test_key]?.unit || ''}` });
    for (const a of db.all(`SELECT a.title, a.due, s.status, s.submitted_at, s.mark FROM assignment_status s JOIN assignments a ON a.id=s.assignment_id WHERE s.player_id=? AND coalesce(a.due, a.created_at)>=? AND coalesce(a.due, a.created_at)<=?`, pid, from, to + 'T23:59'))
      timeline.push({ date: (a.submitted_at || a.due || '').slice(0, 10), kind: 'assignment', text: `${a.title}: ${a.status === 'completed' ? (a.due && a.submitted_at > a.due ? 'completed late' : 'completed') : a.due && nowLocal() > a.due ? 'missed' : a.status.replace('_', ' ')}${a.mark ? ' (' + a.mark + ')' : ''}` });
    if (coachView(user)) for (const m of jAll(db.all(`SELECT at, detail FROM audit WHERE action='depth_move' AND entity_id=? AND at>=?`, pid, from), 'detail'))
      timeline.push({ date: m.at.slice(0, 10), kind: 'depth', text: `${m.detail.unit} ${m.detail.slot}: ${m.detail.from ? 'string ' + m.detail.from : 'added'} → ${m.detail.to ? 'string ' + m.detail.to : 'removed'} (${m.detail.week})` });
    timeline.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const out = { player: p, season, timeline, goals: db.all('SELECT * FROM dev_goals WHERE player_id=? ORDER BY status, id DESC', pid).map(goalProgress) };
    out.attendance_rate = attendanceRate(pid, from);
    const asn = db.get(`SELECT count(*) total, sum(s.status='completed') done FROM assignment_status s JOIN assignments a ON a.id=s.assignment_id WHERE s.player_id=? AND coalesce(a.due,a.created_at)>=?`, pid, from);
    out.assignment_rate = asn.total ? Math.round((asn.done / asn.total) * 100) : null;
    if (seeTrends) {
      const group = groupIds(user.program_id, p.positions);
      out.trends = {
        ratings: seeRatings ? ratingTrend([pid], from) : [], group_ratings: seeRatings && coachView(user) ? ratingTrend(group, from) : [],
        tests: Object.fromEntries(Object.keys(TESTS).map((k) => [k, db.all('SELECT date, value FROM tests WHERE player_id=? AND test_key=? ORDER BY date', pid, k)]).filter(([, v]) => v.length)),
        group_tests: coachView(user) ? Object.fromEntries(Object.keys(TESTS).map((k) => [k, group.length ? db.get(`SELECT round(avg(best),1) v FROM (SELECT ${TESTS[k].better === 'lower' ? 'min' : 'max'}(value) best FROM tests WHERE test_key=? AND player_id IN (${group.map(() => '?').join(',')}) GROUP BY player_id)`, k, ...group).v : null])) : {},
        attendance: db.all(`SELECT substr(e.start,1,7) month, round(100.0*sum(a.status IN ('present','late','left_early'))/count(*)) rate FROM attendance a JOIN events e ON e.id=a.event_id WHERE a.player_id=? AND a.confirmed=1 AND e.start>=? GROUP BY month ORDER BY month`, pid, from),
        group_attendance: coachView(user) && group.length ? db.get(`SELECT round(100.0*sum(a.status IN ('present','late','left_early'))/count(*)) rate FROM attendance a JOIN events e ON e.id=a.event_id WHERE a.player_id IN (${group.map(() => '?').join(',')}) AND a.confirmed=1 AND e.start>=?`, ...group, from).rate : null,
        group_label: p.positions[0] ? `${p.positions[0]} group` : null,
      };
    }
    if (coachView(user)) {
      out.evaluations = jAll(db.all('SELECT e.*, u.name by_name FROM evaluations e LEFT JOIN users u ON u.id=e.by_user WHERE e.player_id=? ORDER BY e.at DESC', pid), 'scores');
      audit(user, 'view', 'development', pid);
    }
    return out;
  });

  // SEA-5: position group view
  router.get('/api/development-group', ({ user, query }) => {
    need(coachView(user), 403, 'Coaches only');
    const season = core.currentSeason(user.program_id);
    const from = season?.start_date || '0000';
    let players = jAll(db.all(`SELECT u.id, u.name, pp.jersey, pp.positions, pp.units, pp.class_year, pp.availability, pp.team_id FROM users u JOIN player_profiles pp ON pp.user_id=u.id WHERE u.program_id=? AND u.role='player' AND u.active=1 AND pp.archived=0`, user.program_id), 'positions', 'units');
    if (query.position) players = players.filter((p) => p.positions.includes(query.position));
    if (query.unit) players = players.filter((p) => p.units.includes(query.unit));
    if (query.team_id) players = players.filter((p) => p.team_id === Number(query.team_id));
    const showRatings = can(user, 'ratings.view');
    const recent = addDays(today(), -14);
    return players.map((p) => {
      const r = showRatings ? db.get('SELECT round(avg(value),2) avg, count(*) n FROM ratings WHERE player_id=? AND date>=?', p.id, from) : {};
      const r14 = showRatings ? db.get('SELECT round(avg(value),2) avg FROM ratings WHERE player_id=? AND date>=?', p.id, recent).avg : null;
      const prior = showRatings ? db.get('SELECT round(avg(value),2) avg FROM ratings WHERE player_id=? AND date>=? AND date<?', p.id, from, recent).avg : null;
      const lastR = showRatings ? db.get('SELECT value, date FROM ratings WHERE player_id=? ORDER BY date DESC, id DESC LIMIT 1', p.id) : null;
      return { ...p, rating_avg: r.avg ?? null, ratings: r.n || 0, rating_recent: r14, rating_trend: r14 != null && prior != null ? Math.round((r14 - prior) * 100) / 100 : null, latest_rating: lastR?.value ?? null, attendance_rate: attendanceRate(p.id, from),
        squat: db.get(`SELECT max(value) v FROM tests WHERE player_id=? AND test_key='squat'`, p.id).v, forty: db.get(`SELECT min(value) v FROM tests WHERE player_id=? AND test_key='forty'`, p.id).v,
        goals_active: db.get(`SELECT count(*) n FROM dev_goals WHERE player_id=? AND status='active'`, p.id).n };
    });
  });

  // ---------- goals (SEA-6) ----------
  router.get('/api/goals', ({ user, query }) => {
    const pid = Number(query.player_id || (user.role === 'player' ? user.id : 0));
    if (pid) { need(isStaff(user) || core.linkedPlayers(user).includes(pid), 403, 'No access'); return db.all('SELECT * FROM dev_goals WHERE player_id=? ORDER BY status, id DESC', pid).map(goalProgress); }
    need(coachView(user), 403, 'Coaches only');
    return db.all(`SELECT g.*, u.name player_name FROM dev_goals g JOIN users u ON u.id=g.player_id WHERE g.program_id=? ORDER BY g.status, g.due`, user.program_id).map(goalProgress);
  });
  router.post('/api/goals', ({ user, body }) => {
    need(isAdmin(user) || user.role === 'coach' || user.role === 'trainer', 403, 'Coaches only');
    need(body.title && db.get(`SELECT 1 FROM users WHERE id=? AND program_id=? AND role='player'`, Number(body.player_id), user.program_id), 400, 'Player and goal are required');
    if (body.kind === 'test') need(TESTS[body.test_key] && body.target != null, 400, 'Test goals need a test and target');
    const baseline = body.kind === 'test' ? (body.baseline ?? db.get('SELECT value FROM tests WHERE player_id=? AND test_key=? ORDER BY date DESC LIMIT 1', Number(body.player_id), body.test_key)?.value ?? null) : null;
    const id = db.insert('dev_goals', { program_id: user.program_id, player_id: Number(body.player_id), title: body.title, kind: body.kind || 'skill', test_key: body.test_key || null, baseline, target: body.target ?? null, due: body.due || null, notes: body.notes || null, season_id: core.currentSeason(user.program_id)?.id, by_user: user.id });
    notify(user.program_id, [Number(body.player_id)], { kind: 'update', title: `New goal: ${body.title}`, link: '/development', email: false });
    audit(user, 'create', 'goal', id, { player: body.player_id });
    return { id };
  });
  router.put('/api/goals/:id', ({ user, params, body }) => {
    need(isAdmin(user) || user.role === 'coach' || user.role === 'trainer', 403, 'Coaches only');
    const g = db.get('SELECT * FROM dev_goals WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    need(g, 404, 'Goal not found');
    const upd = {};
    for (const k of ['title', 'notes', 'due', 'target']) if (body[k] !== undefined) upd[k] = body[k];
    if (body.progress !== undefined) upd.progress = Math.max(0, Math.min(100, Number(body.progress)));
    if (body.status) { need(['active', 'achieved', 'dropped'].includes(body.status), 400, 'Unknown status'); upd.status = body.status; }
    db.update('dev_goals', g.id, upd);
    return { ok: true };
  });
  router.del('/api/goals/:id', ({ user, params }) => {
    need(isAdmin(user) || user.role === 'coach', 403, 'Coaches only');
    db.run('DELETE FROM dev_goals WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    return { ok: true };
  });

  // ---------- evaluations (SEA-9) ----------
  router.get('/api/evaluations/meta', () => ({ points: EVAL_POINTS, criteria: EVAL_CRITERIA }));
  router.get('/api/evaluations', ({ user, query }) => {
    need(coachView(user), 403, 'Coaches only');
    return jAll(db.all(`SELECT e.*, u.name player_name, b.name by_name FROM evaluations e JOIN users u ON u.id=e.player_id LEFT JOIN users b ON b.id=e.by_user WHERE e.program_id=? ${query.point ? 'AND e.point=?' : ''} ORDER BY e.at DESC`, user.program_id, ...(query.point ? [query.point] : [])), 'scores');
  });
  router.post('/api/evaluations', ({ user, body }) => {
    need(isAdmin(user) || user.role === 'coach', 403, 'Coaches only');
    need(EVAL_POINTS.includes(body.point), 400, 'Pick preseason, midseason or end of season');
    need(db.get(`SELECT 1 FROM users WHERE id=? AND program_id=? AND role='player'`, Number(body.player_id), user.program_id), 404, 'Player not found');
    const scores = body.scores || {};
    for (const v of Object.values(scores)) need(Number(v) >= 1 && Number(v) <= 5, 400, 'Scores are 1 to 5');
    const season = core.currentSeason(user.program_id);
    db.run('DELETE FROM evaluations WHERE player_id=? AND season_id IS ? AND point=? AND by_user=?', Number(body.player_id), season?.id ?? null, body.point, user.id);
    const id = db.insert('evaluations', { program_id: user.program_id, player_id: Number(body.player_id), season_id: season?.id, point: body.point, position: body.position || null, scores, notes: body.notes || null, by_user: user.id });
    audit(user, 'evaluate', 'player', Number(body.player_id), { point: body.point });
    return { id };
  });

  // ---------- end-of-season reports (SEA-10) ----------
  router.get('/api/season-report/player/:id', ({ user, params }) => {
    need(coachView(user) || can(user, 'audit.view'), 403, 'Coaches and the athletic director only');
    const pid = Number(params.id);
    const p = j(db.get(`SELECT u.id, u.name, pp.jersey, pp.positions, pp.class_year, t.name team, l.name level FROM users u JOIN player_profiles pp ON pp.user_id=u.id LEFT JOIN teams t ON t.id=pp.team_id LEFT JOIN levels l ON l.id=t.level_id WHERE u.id=? AND u.program_id=?`, pid, user.program_id), 'positions');
    need(p, 404, 'Player not found');
    const s = core.currentSeason(user.program_id);
    const from = s?.start_date || '0000';
    const tests = {};
    for (const k of Object.keys(TESTS)) {
      const rows = db.all('SELECT value, date FROM tests WHERE player_id=? AND test_key=? AND date>=? ORDER BY date', pid, k, from);
      if (rows.length) tests[k] = { label: TESTS[k].label, unit: TESTS[k].unit, first: rows[0].value, last: rows[rows.length - 1].value, best: TESTS[k].better === 'lower' ? Math.min(...rows.map((r) => r.value)) : Math.max(...rows.map((r) => r.value)) };
    }
    const evals = jAll(db.all('SELECT point, scores, notes FROM evaluations WHERE player_id=? AND season_id IS ? ORDER BY at', pid, s?.id ?? null), 'scores');
    return {
      player: p, season: s, attendance_rate: attendanceRate(pid, from),
      ratings: db.get('SELECT round(avg(value),2) avg, count(*) n FROM ratings WHERE player_id=? AND date>=?', pid, from),
      assignments: db.get(`SELECT count(*) total, sum(s.status='completed') done FROM assignment_status s JOIN assignments a ON a.id=s.assignment_id WHERE s.player_id=? AND coalesce(a.due,a.created_at)>=?`, pid, from),
      tests, evaluations: evals, goals: db.all('SELECT * FROM dev_goals WHERE player_id=? AND season_id IS ?', pid, s?.id ?? null).map(goalProgress),
      generated_at: nowLocal(),
    };
  });
  router.get('/api/season-report/team', ({ user, query }) => {
    need(coachView(user) || can(user, 'audit.view'), 403, 'Coaches and the athletic director only');
    const s = core.currentSeason(user.program_id);
    const from = s?.start_date || '0000'; const to = s?.end_date || '9999';
    const games = jAll(db.all(`SELECT id, title, start, details, status FROM events WHERE program_id=? AND type='game' AND start>=? AND start<=? ORDER BY start`, user.program_id, from, to + 'T23:59'), 'details');
    const att = db.get(`SELECT count(*) total, sum(a.status IN ('present','late','left_early')) here FROM attendance a JOIN events e ON e.id=a.event_id WHERE e.program_id=? AND a.confirmed=1 AND e.start>=?`, user.program_id, from);
    return {
      season: s, games, attendance_rate: att.total ? Math.round((att.here / att.total) * 100) : null,
      practices: db.get(`SELECT count(*) n FROM events WHERE program_id=? AND type='practice' AND start>=? AND start<=? AND status!='cancelled'`, user.program_id, from, to + 'T23:59').n,
      plans_with_notes: db.get(`SELECT count(DISTINCT plan_id) n FROM practice_notes n JOIN practice_plans p ON p.id=n.plan_id WHERE p.program_id=?`, user.program_id).n,
      ratings: db.get(`SELECT count(*) n, round(avg(value),2) avg FROM ratings r JOIN users u ON u.id=r.player_id WHERE u.program_id=? AND r.date>=?`, user.program_id, from),
      prs: db.get(`SELECT count(*) n FROM tests t JOIN users u ON u.id=t.player_id WHERE u.program_id=? AND t.date>=?`, user.program_id, from).n,
      roster: db.get(`SELECT count(*) n FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.program_id=? AND u.role='player' AND p.archived=0`, user.program_id).n,
      equipment_outstanding: db.get('SELECT count(*) n FROM eq_issues WHERE program_id=? AND returned_at IS NULL', user.program_id).n,
      generated_at: nowLocal(),
    };
  });

  // ---------- home screens (SEA-7, SEA-8) ----------
  router.get('/api/home', ({ user }) => {
    const now = nowLocal(); const day = today();
    const events = jAll(db.all('SELECT * FROM events WHERE program_id=? AND start>=? AND start<=? ORDER BY start', user.program_id, day, addDays(day, 6) + 'T23:59'), 'audience', 'details').filter((e) => core.inAudience(user, e.audience));
    const unread = db.get(`SELECT count(*) n FROM notifications WHERE user_id=? AND kind='announcement' AND opened_at IS NULL AND (deliver_at IS NULL OR deliver_at<=?)`, user.id, now).n;
    if (isStaff(user)) {
      const todayEvents = events.filter((e) => e.start.startsWith(day)).map((e) => {
        const c = db.get(`SELECT sum(confirmed=1 AND status IN ('present','late','left_early')) here, sum(confirmed=1 AND status IN ('excused','unexcused')) absent, sum(confirmed=0) planned FROM attendance WHERE event_id=?`, e.id);
        return { id: e.id, title: e.title, type: e.type, start: e.start, end: e.end, location: e.location, status: e.status, expected: core.resolvePlayers(user.program_id, e.audience).length, here: c.here || 0, absent: c.absent || 0, planned_absent: c.planned || 0, plan_id: db.get('SELECT id FROM practice_plans WHERE event_id=?', e.id)?.id ?? null };
      });
      const avail = jAll(db.all(`SELECT a.at, a.detail, a.entity_id, u.name player, b.name by_name FROM audit a JOIN users u ON u.id=a.entity_id LEFT JOIN users b ON b.id=a.user_id WHERE a.program_id=? AND a.action='set_availability' AND a.at>=? ORDER BY a.id DESC LIMIT 10`, user.program_id, addDays(day, -7)), 'detail');
      const out = db.all(`SELECT pp.availability, count(*) n FROM player_profiles pp JOIN users u ON u.id=pp.user_id WHERE u.program_id=? AND pp.archived=0 AND u.active=1 GROUP BY pp.availability`, user.program_id);
      const helmets = db.all(`SELECT i.* FROM eq_items i JOIN eq_types t ON t.id=i.type_id WHERE t.program_id=? AND t.category='helmet' AND i.retired=0`, user.program_id);
      const s = core.settings(user.program_id); const y = Number(day.slice(0, 4));
      const helmetsDue = helmets.filter((h) => (h.allows_recert && (!h.recert_year || y - h.recert_year >= (h.manuf_year && h.manuf_year < 2017 ? 1 : s.helmet_recert_interval_years))) || (h.manuf_year && y - h.manuf_year >= s.helmet_max_age_years)).length;
      const overdue = db.all(`SELECT a.id, a.title, a.due, (SELECT count(*) FROM assignment_status s WHERE s.assignment_id=a.id AND s.status!='completed') pending FROM assignments a WHERE a.program_id=? AND a.is_template=0 AND a.due<? ORDER BY a.due DESC LIMIT 8`, user.program_id, now).filter((a) => a.pending > 0);
      const upcomingDue = db.all(`SELECT id, title, due FROM assignments WHERE program_id=? AND is_template=0 AND due>=? AND due<=? ORDER BY due LIMIT 8`, user.program_id, now, addDays(day, 7) + 'T23:59');
      const anns = jAll(db.all(`SELECT a.id, a.title, a.at, a.audience, u.name by_name FROM announcements a LEFT JOIN users u ON u.id=a.by_user WHERE a.program_id=? ORDER BY a.id DESC LIMIT 5`, user.program_id), 'audience');
      return {
        role: 'staff', today: todayEvents, week: events.map((e) => ({ id: e.id, title: e.title, type: e.type, start: e.start, status: e.status })),
        availability: Object.fromEntries(out.map((r) => [r.availability, r.n])), availability_changes: avail,
        deadlines: { equipment_outstanding: db.get('SELECT count(*) n FROM eq_issues WHERE program_id=? AND returned_at IS NULL', user.program_id).n, helmets_due: helmetsDue, assignments_due: upcomingDue },
        overdue_assignments: overdue, unread_announcements: unread, announcements: anns,
        open_reports: isAdmin(user) ? db.get(`SELECT count(*) n FROM message_reports r JOIN messages m ON m.id=r.message_id JOIN chats c ON c.id=m.chat_id WHERE c.program_id=? AND r.resolved=0`, user.program_id).n : 0,
        pending_blocks: isAdmin(user) ? db.get(`SELECT count(*) n FROM contact_blocks WHERE program_id=? AND status='requested'`, user.program_id).n : 0,
        conflicts: db.get('SELECT count(*) n FROM sync_conflicts WHERE program_id=? AND resolved=0', user.program_id).n,
      };
    }
    // Player / parent home
    const players = core.linkedPlayers(user);
    const s = core.settings(user.program_id);
    const season = core.currentSeason(user.program_id);
    const kids = players.map((pid) => {
      const p = db.get('SELECT u.id, u.name, pp.jersey, pp.availability, pp.return_date FROM users u JOIN player_profiles pp ON pp.user_id=u.id WHERE u.id=?', pid);
      const asn = db.all(`SELECT a.id, a.title, a.due, a.type, s.status FROM assignment_status s JOIN assignments a ON a.id=s.assignment_id WHERE s.player_id=? AND s.status!='completed' ORDER BY a.due IS NULL, a.due LIMIT 8`, pid)
        .map((a) => ({ ...a, display_status: a.due && now > a.due ? 'late' : a.status }));
      return {
        ...p, assignments: asn, goals: db.all(`SELECT * FROM dev_goals WHERE player_id=? AND status='active'`, pid).map(goalProgress),
        attendance_rate: attendanceRate(pid, season?.start_date || '0000'),
        recent_rating: s.players_see_ratings ? db.get('SELECT round(avg(value),2) v FROM ratings WHERE player_id=? AND date>=?', pid, addDays(day, -14)).v : undefined,
        rsvp_needed: events.filter((e) => ['game', 'practice', 'social', 'lift', 'film'].includes(e.type) && !db.get('SELECT 1 FROM rsvps WHERE event_id=? AND user_id=?', e.id, pid)).length,
        equipment_unacknowledged: db.get('SELECT count(*) n FROM eq_issues WHERE player_id=? AND returned_at IS NULL AND acknowledged_at IS NULL', pid).n,
        forms_pending: user.role === 'player' ? jAll(db.all('SELECT id, audience FROM forms WHERE program_id=?', user.program_id), 'audience').filter((f) => core.resolvePlayers(user.program_id, f.audience).includes(pid) && !db.get('SELECT 1 FROM form_responses WHERE form_id=? AND player_id=?', f.id, pid)).length : 0,
      };
    });
    return { role: user.role, events: events.map((e) => ({ id: e.id, title: e.title, type: e.type, start: e.start, end: e.end, location: e.location, status: e.status, details: e.details })), players: kids, unread_announcements: unread };
  });
}
