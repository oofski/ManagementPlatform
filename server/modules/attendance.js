// Module 5: Attendance — coach marking and self check-in codes, statuses with reasons, planned vs actual
// from RSVPs, live dashboard, group attendance, history/reports/export, alert thresholds, offline conflicts.
import { fail, need, nowLocal, addMinutes, addDays, today } from '../core.js';
import { j, jAll } from '../db.js';
import { csv, csvResponse } from '../app.js';

export const ATT_STATUSES = ['present', 'late', 'left_early', 'excused', 'unexcused'];

export default function attendance(ctx) {
  const { router, db, core } = ctx;
  const { can, isStaff, isAdmin, audit, notify } = core;

  const eventOf = (pid, id) => j(db.get('SELECT * FROM events WHERE id=? AND program_id=?', id, pid), 'audience', 'details');
  const canMark = (u, playerId) => {
    if (isAdmin(u)) return true;
    if (u.role !== 'coach') return false;
    const scopes = core.staffScopes(u.id);
    return !scopes.length || core.managesAudience(u, [`player:${playerId}`]);
  };

  function sheet(user, e, query = {}) {
    let ids = core.resolvePlayers(user.program_id, e.audience);
    const rows = ids.map((id) => j(db.get(`SELECT u.id, u.name, pp.jersey, pp.units, pp.positions, pp.availability, pp.return_date, pp.team_id, t.name team, l.name level, l.id level_id
      FROM users u JOIN player_profiles pp ON pp.user_id=u.id LEFT JOIN teams t ON t.id=pp.team_id LEFT JOIN levels l ON l.id=t.level_id WHERE u.id=?`, id), 'units', 'positions'));
    const att = Object.fromEntries(db.all('SELECT a.*, b.name by_name FROM attendance a LEFT JOIN users b ON b.id=a.by_user WHERE event_id=?', e.id).map((a) => [a.player_id, a]));
    const rsvp = Object.fromEntries(db.all('SELECT user_id, status, reason FROM rsvps WHERE event_id=?', e.id).map((r) => [r.user_id, r]));
    let list = rows.map((r) => ({ ...r, attendance: att[r.id] || null, rsvp: rsvp[r.id] || null }));
    if (query.team_id) list = list.filter((r) => r.team_id === Number(query.team_id));
    if (query.unit) list = list.filter((r) => r.units.includes(query.unit));
    if (query.position) list = list.filter((r) => r.positions.includes(query.position));
    if (query.mine && user.role === 'coach') {
      const scopes = core.staffScopes(user.id);
      if (scopes.length) list = list.filter((r) => core.managesAudience(user, [`player:${r.id}`]));
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    const counts = { expected: list.length, present: 0, late: 0, left_early: 0, excused: 0, unexcused: 0, not_checked_in: 0, unavailable: 0, planned_absent: 0 };
    for (const r of list) {
      if (r.attendance && r.attendance.confirmed) counts[r.attendance.status]++;
      else if (r.attendance && !r.attendance.confirmed) counts.planned_absent++;
      else counts.not_checked_in++;
      if (r.availability !== 'available') counts.unavailable++;
    }
    return { event: e, players: list, counts };
  }

  router.get('/api/attendance/meta', () => ({ statuses: ATT_STATUSES }));
  router.get('/api/attendance/events', ({ user, query }) => {
    need(isStaff(user), 403, 'Staff only');
    const from = query.from || addDays(today(), -14);
    const to = query.to || addDays(today(), 7);
    return jAll(db.all(`SELECT * FROM events WHERE program_id=? AND start>=? AND start<=? AND type!='meeting' ORDER BY start DESC`, user.program_id, from, to + 'T23:59'), 'audience')
      .filter((e) => core.inAudience(user, e.audience))
      .map((e) => {
        const c = db.get(`SELECT sum(confirmed=1 AND status IN ('present','late','left_early')) here, sum(confirmed=1) marked FROM attendance WHERE event_id=?`, e.id);
        return { id: e.id, title: e.title, type: e.type, start: e.start, status: e.status, expected: core.resolvePlayers(user.program_id, e.audience).length, here: c.here || 0, marked: c.marked || 0 };
      });
  });
  router.get('/api/attendance/:eventId', ({ user, params, query }) => {
    need(isStaff(user), 403, 'Staff only');
    const e = eventOf(user.program_id, Number(params.eventId));
    need(e, 404, 'Event not found');
    const s = sheet(user, e, query);
    s.code = db.get('SELECT code, expires_at FROM checkin_codes WHERE event_id=? AND expires_at>?', e.id, nowLocal()) || null;
    s.conflicts = db.all(`SELECT * FROM sync_conflicts WHERE entity='attendance' AND entity_key LIKE ? AND resolved=0`, `${e.id}:%`).length;
    return s;
  });

  function checkAlerts(user, playerId) {
    const s = core.settings(user.program_id);
    const season = core.currentSeason(user.program_id);
    const since = season?.start_date || '0000';
    const c = db.get(`SELECT sum(a.status='unexcused') abs, sum(a.status='late') late FROM attendance a JOIN events e ON e.id=a.event_id WHERE a.player_id=? AND a.confirmed=1 AND e.start>=?`, playerId, since);
    const name = db.get('SELECT name FROM users WHERE id=?', playerId).name;
    const heads = db.all(`SELECT id FROM users WHERE program_id=? AND (role='head_coach' OR is_admin=1) AND active=1`, user.program_id).map((r) => r.id);
    for (const [kind, n, limit] of [['absences', c.abs || 0, s.absence_alert_threshold], ['lates', c.late || 0, s.late_alert_threshold]]) {
      if (!limit || n < limit) continue;
      const key = `${kind}:${n}`;
      if (db.get(`SELECT 1 FROM audit WHERE action='attendance_alert' AND entity_id=? AND detail=?`, playerId, JSON.stringify(key))) continue;
      audit(user, 'attendance_alert', 'player', playerId, key);
      notify(user.program_id, heads, { kind: 'urgent', title: `Attendance alert: ${name}`, body: `${n} ${kind === 'absences' ? 'unexcused absences' : 'late arrivals'} this season (threshold ${limit})`, link: `/players/${playerId}`, from: 'system', email: false });
    }
  }

  function mark(user, e, b) {
    const pid = Number(b.player_id);
    need(ATT_STATUSES.includes(b.status), 400, 'Unknown status');
    need(core.resolvePlayers(user.program_id, e.audience).includes(pid), 400, 'That player is not in this event');
    need(canMark(user, pid), 403, 'You can only take attendance for your own group');
    const existing = db.get('SELECT * FROM attendance WHERE event_id=? AND player_id=?', e.id, pid);
    // PLT-2: an offline edit made against an older value conflicts with a newer edit by someone else. Keep both, flag.
    if (b.base_at !== undefined && existing && existing.confirmed && existing.by_user !== user.id && existing.at > (b.base_at || '') && existing.status !== b.status) {
      db.insert('sync_conflicts', { program_id: user.program_id, entity: 'attendance', entity_key: `${e.id}:${pid}`, server_value: { status: existing.status, reason: existing.reason, by: existing.by_user, at: existing.at }, client_value: { status: b.status, reason: b.reason, at: b.client_at }, client_user: user.id });
      return { conflict: true };
    }
    db.run(`INSERT INTO attendance (event_id, player_id, status, reason, source, confirmed, by_user, at) VALUES (?,?,?,?,?,1,?,?)
      ON CONFLICT(event_id, player_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, source=excluded.source, confirmed=1, by_user=excluded.by_user, at=excluded.at`,
    e.id, pid, b.status, b.reason || null, b.source || 'coach', user.id, nowLocal());
    if (!existing || existing.status !== b.status) audit(user, 'attendance', 'event', e.id, { player: pid, status: b.status, reason: b.reason });
    if (b.status === 'unexcused' || b.status === 'late') checkAlerts(user, pid);
    if (b.status === 'unexcused' && core.settings(user.program_id).parent_absence_notice && (!existing || existing.status !== 'unexcused')) {
      const parents = db.all('SELECT parent_id FROM parent_links WHERE player_id=?', pid).map((r) => r.parent_id);
      const name = db.get('SELECT name FROM users WHERE id=?', pid).name;
      notify(user.program_id, parents, { kind: 'update', title: `${name} was marked absent`, body: `${e.title} on ${e.start.replace('T', ' ')}`, link: `/calendar/${e.id}` });
    }
    return { ok: true };
  }
  router.post('/api/attendance/:eventId/mark', ({ user, params, body }) => {
    need(isStaff(user), 403, 'Staff only');
    const e = eventOf(user.program_id, Number(params.eventId));
    need(e, 404, 'Event not found');
    return mark(user, e, body);
  });
  router.post('/api/attendance/:eventId/batch', ({ user, params, body }) => {
    need(isStaff(user), 403, 'Staff only');
    const e = eventOf(user.program_id, Number(params.eventId));
    need(e, 404, 'Event not found');
    const results = [];
    db.tx(() => { for (const item of body.items || []) { try { results.push(mark(user, e, item)); } catch (err) { results.push({ error: err.message }); } } });
    return { results };
  });
  // "Mark everyone present, then change the exceptions." Leaves RSVP pre-marks for confirmation.
  router.post('/api/attendance/:eventId/all-present', ({ user, params, body }) => {
    need(isStaff(user), 403, 'Staff only');
    const e = eventOf(user.program_id, Number(params.eventId));
    need(e, 404, 'Event not found');
    let ids = body.player_ids || core.resolvePlayers(user.program_id, e.audience);
    ids = ids.filter((id) => canMark(user, id));
    let n = 0;
    db.tx(() => {
      for (const id of ids) {
        if (db.get('SELECT 1 FROM attendance WHERE event_id=? AND player_id=?', e.id, id)) continue;
        db.insert('attendance', { event_id: e.id, player_id: id, status: 'present', source: 'coach', confirmed: 1, by_user: user.id, at: nowLocal() });
        n++;
      }
    });
    audit(user, 'attendance_all_present', 'event', e.id, { count: n });
    return { marked: n };
  });
  router.post('/api/attendance/:eventId/confirm', ({ user, params, body }) => {
    need(isStaff(user), 403, 'Staff only');
    const e = eventOf(user.program_id, Number(params.eventId));
    need(e, 404, 'Event not found');
    const ids = body.player_ids || db.all('SELECT player_id FROM attendance WHERE event_id=? AND confirmed=0', e.id).map((r) => r.player_id);
    for (const id of ids) if (canMark(user, id)) db.run(`UPDATE attendance SET confirmed=1, status=coalesce(?, status), by_user=?, at=? WHERE event_id=? AND player_id=?`, body.status || null, user.id, nowLocal(), e.id, id);
    audit(user, 'attendance_confirm_planned', 'event', e.id, { count: ids.length });
    return { confirmed: ids.length };
  });
  router.del('/api/attendance/:eventId/:playerId', ({ user, params }) => {
    need(isStaff(user), 403, 'Staff only');
    need(canMark(user, Number(params.playerId)), 403, 'Not your group');
    db.run('DELETE FROM attendance WHERE event_id=? AND player_id=?', Number(params.eventId), Number(params.playerId));
    return { ok: true };
  });

  // Self check-in codes
  router.post('/api/attendance/:eventId/code', ({ user, params, body }) => {
    need(isStaff(user), 403, 'Staff only');
    const e = eventOf(user.program_id, Number(params.eventId));
    need(e, 404, 'Event not found');
    const code = Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[O0I1]/g, 'X');
    const expires = addMinutes(nowLocal(), Number(body.minutes) || 120);
    db.run('INSERT INTO checkin_codes (event_id, code, expires_at) VALUES (?,?,?) ON CONFLICT(event_id) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at', e.id, code, expires);
    return { code, expires_at: expires, url: `/checkin?code=${code}` };
  });
  router.post('/api/checkin', ({ user, body }) => {
    need(user.role === 'player', 403, 'Only players check in');
    const c = db.get('SELECT c.*, e.start, e.program_id FROM checkin_codes c JOIN events e ON e.id=c.event_id WHERE c.code=? AND c.expires_at>?', String(body.code || '').trim().toUpperCase(), nowLocal());
    need(c && c.program_id === user.program_id, 400, 'That code is not valid or has expired');
    const e = eventOf(user.program_id, c.event_id);
    need(core.resolvePlayers(user.program_id, e.audience).includes(user.id), 400, 'You are not on the list for this event');
    const existing = db.get('SELECT * FROM attendance WHERE event_id=? AND player_id=?', e.id, user.id);
    if (existing && existing.confirmed && existing.source !== 'rsvp') return { ok: true, status: existing.status, already: true };
    const status = nowLocal() > addMinutes(e.start, 5) ? 'late' : 'present';
    db.run(`INSERT INTO attendance (event_id, player_id, status, source, confirmed, by_user, at) VALUES (?,?,?,'self',1,?,?)
      ON CONFLICT(event_id, player_id) DO UPDATE SET status=excluded.status, source='self', confirmed=1, by_user=excluded.by_user, at=excluded.at`, e.id, user.id, status, user.id, nowLocal());
    audit(user, 'self_checkin', 'event', e.id, { status });
    if (status === 'late') checkAlerts(user, user.id);
    return { ok: true, status, event: e.title };
  });

  // Player's own attendance (players and parents)
  router.get('/api/attendance/player/:id', ({ user, params }) => {
    const id = Number(params.id);
    need(isStaff(user) || core.linkedPlayers(user).includes(id), 403, 'No access');
    return db.all(`SELECT a.status, a.reason, a.confirmed, e.id event_id, e.title, e.type, e.start FROM attendance a JOIN events e ON e.id=a.event_id WHERE a.player_id=? ORDER BY e.start DESC LIMIT 200`, id);
  });

  // History and reports (ATT-7)
  function report(user, q) {
    const from = q.from || core.currentSeason(user.program_id)?.start_date || addDays(today(), -120);
    const to = q.to || today();
    let rows = db.all(`SELECT a.player_id, u.name, pp.jersey, pp.team_id, e.type, a.status FROM attendance a JOIN events e ON e.id=a.event_id JOIN users u ON u.id=a.player_id JOIN player_profiles pp ON pp.user_id=u.id
      WHERE e.program_id=? AND a.confirmed=1 AND e.start>=? AND e.start<=? ${q.type ? 'AND e.type=?' : ''}`, user.program_id, from, to + 'T23:59', ...(q.type ? [q.type] : []));
    if (q.team_id) rows = rows.filter((r) => r.team_id === Number(q.team_id));
    const by = {};
    for (const r of rows) {
      const p = by[r.player_id] ||= { player_id: r.player_id, name: r.name, jersey: r.jersey, team_id: r.team_id, total: 0, present: 0, late: 0, left_early: 0, excused: 0, unexcused: 0 };
      p.total++; p[r.status]++;
    }
    const players = Object.values(by).map((p) => ({ ...p, rate: p.total ? Math.round(((p.present + p.late + p.left_early) / p.total) * 100) : null })).sort((a, b) => a.rate - b.rate || a.name.localeCompare(b.name));
    const byType = {};
    for (const r of rows) { const t = byType[r.type] ||= { type: r.type, total: 0, attended: 0 }; t.total++; if (['present', 'late', 'left_early'].includes(r.status)) t.attended++; }
    const s = core.settings(user.program_id);
    return { from, to, players, by_type: Object.values(byType).map((t) => ({ ...t, rate: Math.round((t.attended / t.total) * 100) })), thresholds: { absences: s.absence_alert_threshold, lates: s.late_alert_threshold } };
  }
  router.get('/api/attendance-report', ({ user, query }) => { need(isStaff(user), 403, 'Staff only'); return report(user, query); });
  router.get('/api/attendance-report/export.csv', ({ user, query }) => {
    need(isStaff(user), 403, 'Staff only');
    const r = report(user, query);
    audit(user, 'export', 'attendance', null);
    return csvResponse('attendance.csv', csv(r.players, [
      { label: 'Player', key: 'name' }, { label: 'Jersey', key: 'jersey' }, { label: 'Events', key: 'total' }, { label: 'Present', key: 'present' },
      { label: 'Late', key: 'late' }, { label: 'Left early', key: 'left_early' }, { label: 'Excused', key: 'excused' }, { label: 'Unexcused', key: 'unexcused' }, { label: 'Attendance %', key: 'rate' },
    ]));
  });
}
