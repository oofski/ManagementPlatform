// v2 football operations: team join codes and athlete usernames (C-4), tablet kiosk check-in (C-19),
// attendance streaks and trends (C-20), document sharing (C-23), season archive (C-24), heat acclimatization (F-11),
// concussion return-to-play (F-12), eligibility checklist (F-13), parent e-signature forms (F-14),
// weekly parent digest (F-17) and recruiting profiles (F-18).
import crypto from 'node:crypto';
import { fail, need, nowLocal, today, addDays, addMinutes, hashPassword, checkPassword, token, parseLocal, fmtLocal } from '../core.js';
import { j, jAll } from '../db.js';
import * as weights from './weights.js';
import { schoolYearEnd } from './fb-roster.js';

export const CONCUSSION_STAGES = [
  { stage: 1, label: 'Symptom-limited activity', detail: 'Daily activities that do not provoke symptoms; no exercise.' },
  { stage: 2, label: 'Light aerobic exercise', detail: 'Walking or stationary bike at slow to medium pace; no resistance training.' },
  { stage: 3, label: 'Sport-specific exercise', detail: 'Running drills; no head-impact activities.' },
  { stage: 4, label: 'Non-contact training drills', detail: 'Harder drills such as passing; may start progressive resistance training.' },
  { stage: 5, label: 'Full-contact practice', detail: 'After written medical clearance, normal training activities.' },
  { stage: 6, label: 'Return to play', detail: 'Normal game play.' },
];
const ATTENDED = ['present', 'late', 'left_early'];
const EQUIP = ['helmet', 'shells', 'full'];
const EQUIP_LABEL = { helmet: 'helmet only', shells: 'helmet and shoulder pads', full: 'full pads' };
const DOC_TYPES = {
  'application/pdf': 'PDF', 'image/png': 'Image', 'image/jpeg': 'Image', 'image/gif': 'Image', 'image/webp': 'Image',
  'application/msword': 'Document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Document',
  'application/vnd.ms-excel': 'Spreadsheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Spreadsheet',
  'application/vnd.ms-powerpoint': 'Slides', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'Slides',
  'text/plain': 'Text', 'text/csv': 'Spreadsheet',
};
const MAX_DOC_BYTES = 5 * 1024 * 1024;

export const mondayOf = (d) => { const x = parseLocal(d.slice(0, 10) + 'T00:00'); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return fmtLocal(x).slice(0, 10); };
const daysBetween = (a, b) => Math.round((parseLocal(b + 'T12:00') - parseLocal(a + 'T12:00')) / 86400000);
const TESTS = () => weights.TESTS || {};
const better = (key) => (TESTS()[key]?.better === 'lower' ? 'lower' : 'higher');
const isBetter = (key, a, b) => (b == null ? true : better(key) === 'lower' ? a < b : a > b);

// ---------- C-24: season archive (called by POST /api/players/rollover inside its transaction) ----------
export function archiveSeason(db, core, user, { graduating_class = 0, new_season = null } = {}) {
  const season = core.currentSeason(user.program_id);
  const from = season?.start_date || '0000-01-01';
  const to = season?.end_date || today();
  const players = db.all(`SELECT u.id, u.name, p.class_year, p.positions, t.name team, l.name lname FROM users u JOIN player_profiles p ON p.user_id=u.id
    LEFT JOIN teams t ON t.id=p.team_id LEFT JOIN levels l ON l.id=t.level_id WHERE u.program_id=? AND u.role='player' AND u.active=1 AND p.archived=0`, user.program_id);
  for (const p of players) {
    const tests = {};
    for (const r of db.all('SELECT test_key, value, date FROM tests WHERE player_id=? AND (season_id=? OR (date>=? AND date<=?)) ORDER BY date', p.id, season?.id ?? -1, from, to)) {
      if (!tests[r.test_key] || isBetter(r.test_key, r.value, tests[r.test_key].value)) tests[r.test_key] = { value: r.value, date: r.date };
    }
    const prs = {};
    for (const r of db.all('SELECT test_key, value, date FROM tests WHERE player_id=? ORDER BY date', p.id)) {
      if (!prs[r.test_key] || isBetter(r.test_key, r.value, prs[r.test_key].value)) prs[r.test_key] = { value: r.value, date: r.date };
    }
    for (const r of db.all(`SELECT e.name, max(l.weight) w FROM wt_logs l JOIN exercises e ON e.id=l.exercise_id WHERE l.player_id=? AND l.weight>0 GROUP BY e.id`, p.id)) {
      prs[`lift:${r.name}`] = { value: r.w, label: r.name };
    }
    const a = db.get(`SELECT count(*) n, sum(a.status IN ('present','late','left_early')) here FROM attendance a JOIN events e ON e.id=a.event_id
      WHERE a.player_id=? AND a.confirmed=1 AND e.start>=? AND e.start<=?`, p.id, from, to + 'T23:59');
    db.run(`INSERT INTO fb_season_archive (program_id, season_id, season_name, player_id, team, class_year, positions, attendance_rate, events, tests, prs, graduated, at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(season_id, player_id) DO UPDATE SET team=excluded.team, class_year=excluded.class_year, positions=excluded.positions,
      attendance_rate=excluded.attendance_rate, events=excluded.events, tests=excluded.tests, prs=excluded.prs, graduated=excluded.graduated, at=excluded.at`,
    user.program_id, season?.id ?? null, season?.name || 'Season', p.id, p.team ? (p.team === p.lname ? p.team : `${p.lname} ${p.team}`) : null, p.class_year, p.positions,
    a.n ? Math.round(((a.here || 0) / a.n) * 100) : null, a.n || 0, JSON.stringify(tests), JSON.stringify(prs), graduating_class && p.class_year && p.class_year <= graduating_class ? 1 : 0, nowLocal());
  }
  let newSeasonId = null;
  if (new_season && new_season.name) {
    db.run('UPDATE seasons SET active=0 WHERE program_id=?', user.program_id);
    newSeasonId = db.insert('seasons', { program_id: user.program_id, name: String(new_season.name).slice(0, 80), start_date: new_season.start_date || null, end_date: new_season.end_date || null, active: 1, phases: [] });
  }
  return { season_id: season?.id ?? null, season: season?.name || null, athletes: players.length, new_season_id: newSeasonId };
}

export default function football(ctx) {
  const { router, db, core } = ctx;
  const { can, isStaff, isAdmin, audit, notify } = core;
  const perms = (u) => (typeof u.perms === 'string' ? JSON.parse(u.perms || '{}') : u.perms || {});
  // F-12: the designated medical professional. Deliberately not can(): admins (head coaches) do not read medical notes.
  const isMedical = (u) => !!u && (u.role === 'trainer' || !!perms(u).medical);
  const eligView = (u) => isAdmin(u) || ['coach', 'trainer'].includes(u.role) || u.staff_kind === 'athletic_director' || !!perms(u).eligibility || !!perms(u).medical;
  const staffOnly = (u) => need(isStaff(u), 403, 'Staff only');
  const playerOf = (pid, id) => db.get(`SELECT u.id, u.name, u.email, u.username, u.password_hash, u.joined_at, p.* FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.id=? AND u.program_id=? AND u.role='player'`, id, pid);
  const canSee = (u, id) => (isStaff(u) && !!playerOf(u.program_id, id)) || core.linkedPlayers(u).includes(id);
  const teamOf = (pid, id) => db.get('SELECT t.*, l.name lname FROM teams t JOIN levels l ON l.id=t.level_id WHERE t.id=? AND l.program_id=?', id, pid);
  const teamName = (t) => (t ? (t.name === t.lname ? t.name : `${t.lname} ${t.name}`) : null);
  const clientIp = (req) => String(req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '').split(',')[0].trim();
  const setCookie = (res, sid) => { res.headers['Set-Cookie'] = `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`; };

  // ---------- rate limiting for join codes (C-4) and kiosk PINs ----------
  const limits = new Map();
  const WINDOW = 10 * 60 * 1000;
  const blocked = (key, max) => { const r = limits.get(key); return !!r && r.reset > Date.now() && r.n >= max; };
  const strike = (key) => { const r = limits.get(key); if (!r || r.reset <= Date.now()) limits.set(key, { n: 1, reset: Date.now() + WINDOW }); else r.n++; };
  ctx.fb = { resetLimits: () => limits.clear() };

  router.get('/api/fb/me', ({ user }) => ({
    medical: isMedical(user), eligibility_view: eligView(user), eligibility_edit: can(user, 'eligibility.edit'), heat_log: can(user, 'heat.log'),
    stages: CONCUSSION_STAGES,
  }));

  // =====================================================================
  // C-4: per-team join codes, /join flow, usernames
  // =====================================================================
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newCode = () => { let c; do { c = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHA[b % ALPHA.length]).join(''); } while (db.get('SELECT 1 FROM fb_join_codes WHERE code=?', c)); return c; };
  const shortName = (n) => { const [f, ...rest] = String(n).split(/\s+/); return rest.length ? `${f} ${rest[rest.length - 1][0]}.` : f; };
  const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
  const usernameTaken = (u) => !!db.get('SELECT 1 FROM users WHERE lower(username)=lower(?) OR lower(email)=lower(?)', u, u);
  function suggestUsername(name, jersey) {
    const parts = String(name || '').trim().split(/\s+/);
    const base = (slug(parts[0]).slice(0, 1) + slug(parts.slice(1).join('') || parts[0])).slice(0, 20) || 'athlete';
    const cands = [base, jersey != null && jersey !== '' ? `${base}${jersey}` : null].filter(Boolean);
    for (const c of cands) if (c.length >= 3 && !usernameTaken(c)) return c;
    for (let i = 2; i < 999; i++) if (!usernameTaken(`${base}${i}`)) return `${base}${i}`;
    return `${base}${token(3).toLowerCase()}`;
  }
  const activeCode = (code) => db.get(`SELECT c.*, p.name program_name, p.school FROM fb_join_codes c JOIN programs p ON p.id=c.program_id WHERE c.code=? AND c.active=1`, String(code || '').trim().toUpperCase());

  router.get('/api/fb/join-codes', ({ user }) => {
    need(can(user, 'roster.edit'), 403, 'Coaches only');
    const teams = db.all('SELECT t.id, t.name, l.name lname FROM teams t JOIN levels l ON l.id=t.level_id WHERE l.program_id=? ORDER BY l.sort, t.name', user.program_id);
    return teams.map((t) => {
      const c = db.get('SELECT id, code, active, uses, created_at FROM fb_join_codes WHERE team_id=? AND program_id=? ORDER BY id DESC LIMIT 1', t.id, user.program_id);
      const waiting = db.get(`SELECT count(*) n FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE p.team_id=? AND u.active=1 AND p.archived=0 AND u.password_hash IS NULL`, t.id).n;
      return { team_id: t.id, team: teamName(t), code: c || null, waiting };
    });
  });
  router.post('/api/fb/join-codes', ({ user, body }) => {
    need(can(user, 'roster.edit'), 403, 'Coaches only');
    const t = teamOf(user.program_id, Number(body.team_id));
    need(t, 404, 'Team not found');
    db.run('UPDATE fb_join_codes SET active=0 WHERE team_id=? AND program_id=?', t.id, user.program_id);
    const code = newCode();
    const id = db.insert('fb_join_codes', { program_id: user.program_id, team_id: t.id, code, created_by: user.id });
    audit(user, 'rotate_join_code', 'team', t.id);
    return { id, code, url: `/join?code=${code}` };
  });
  router.put('/api/fb/join-codes/:id', ({ user, params, body }) => {
    need(can(user, 'roster.edit'), 403, 'Coaches only');
    const c = db.get('SELECT * FROM fb_join_codes WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    need(c, 404, 'Code not found');
    db.run('UPDATE fb_join_codes SET active=? WHERE id=?', body.active ? 1 : 0, c.id);
    audit(user, body.active ? 'enable_join_code' : 'disable_join_code', 'team', c.team_id);
    return { ok: true };
  });

  function lookup(req, code) {
    const ip = clientIp(req);
    need(!blocked(`join:${ip}`, 10), 429, 'Too many attempts. Wait 10 minutes and try again.');
    const c = activeCode(code);
    if (!c) { strike(`join:${ip}`); fail(404, 'That join code is not valid. Ask your coach for the current code.'); }
    return c;
  }
  router.post('/api/join/lookup', ({ body, req }) => {
    const c = lookup(req, body.code);
    const t = teamOf(c.program_id, c.team_id);
    const players = db.all(`SELECT u.id, u.name, p.jersey FROM users u JOIN player_profiles p ON p.user_id=u.id
      WHERE p.team_id=? AND u.program_id=? AND u.role='player' AND u.active=1 AND p.archived=0 AND u.password_hash IS NULL AND u.username IS NULL ORDER BY u.name`, c.team_id, c.program_id);
    return {
      program: c.program_name, school: c.school, team: teamName(t),
      players: players.map((p) => ({ id: p.id, label: `${shortName(p.name)}${p.jersey != null ? ` #${p.jersey}` : ''}`, suggested: suggestUsername(p.name, p.jersey) })),
    };
  }, { auth: false });
  router.post('/api/join/suggest', ({ body, req }) => {
    lookup(req, body.code);
    return { username: suggestUsername(body.name, body.jersey) };
  }, { auth: false });
  router.post('/api/join/claim', ({ body, req, res }) => {
    const c = lookup(req, body.code);
    const username = String(body.username || '').trim();
    need(/^[A-Za-z0-9._-]{3,30}$/.test(username), 400, 'Usernames are 3 to 30 letters, numbers, dots, dashes or underscores');
    need(!usernameTaken(username), 400, 'That username is taken. Try another.');
    need(String(body.password || '').length >= 8, 400, 'Password must be at least 8 characters');
    let id;
    db.tx(() => {
      if (body.player_id) {
        const p = playerOf(c.program_id, Number(body.player_id));
        need(p && p.team_id === c.team_id && !p.archived && !p.password_hash && !p.username, 400, 'That name is not available. Ask your coach.');
        id = p.id;
      } else {
        const name = String(body.name || '').trim().replace(/\s+/g, ' ');
        need(name.length >= 3 && name.includes(' '), 400, 'Enter your first and last name');
        const jersey = body.jersey === '' || body.jersey == null ? null : Number(body.jersey);
        need(jersey == null || (Number.isInteger(jersey) && jersey >= 0 && jersey <= 99), 400, 'Jersey must be 0 to 99');
        id = db.insert('users', { program_id: c.program_id, name: name.slice(0, 80), role: 'player', invited_by: c.created_by, cal_token: token(16) });
        db.insert('player_profiles', { user_id: id, team_id: c.team_id, jersey, units: [], positions: [], personal: { joined_with_code: true } });
      }
      db.update('users', id, { username, password_hash: hashPassword(body.password), joined_at: nowLocal(), invite_code: null });
      db.run('UPDATE fb_join_codes SET uses=uses+1 WHERE id=?', c.id);
    });
    const u = db.get('SELECT * FROM users WHERE id=?', id);
    const sid = token();
    db.insert('sessions', { id: sid, user_id: id, verified: 1 });
    setCookie(res, sid);
    audit(u, body.player_id ? 'join_with_code' : 'join_with_code_new', 'user', id, { team: c.team_id });
    const staffIds = db.all(`SELECT id FROM users WHERE program_id=? AND (role='head_coach' OR is_admin=1) AND active=1`, c.program_id).map((r) => r.id);
    notify(c.program_id, staffIds, { kind: 'update', title: `${u.name} joined with the team code`, body: body.player_id ? 'Claimed their roster spot' : 'Added themselves to the roster. Check their positions.', link: `/players/${id}`, from: 'system', email: false });
    return { ok: true, token: sid, username };
  }, { auth: false });

  // =====================================================================
  // C-19: tablet kiosk check-in (coach PIN to exit)
  // =====================================================================
  const canRunKiosk = (u) => isAdmin(u) || u.role === 'coach' || u.role === 'trainer';
  const kioskOf = (u, id) => {
    const k = db.get('SELECT * FROM fb_kiosks WHERE id=? AND program_id=?', id, u.program_id);
    need(k, 404, 'Kiosk not found');
    return k;
  };
  router.post('/api/fb/kiosk', ({ user, body }) => {
    need(canRunKiosk(user), 403, 'Coaches only');
    const e = db.get('SELECT * FROM events WHERE id=? AND program_id=?', Number(body.event_id), user.program_id);
    need(e, 404, 'Event not found');
    need(/^\d{4,8}$/.test(String(body.pin || '')), 400, 'Choose a PIN of 4 to 8 digits');
    const id = token(18);
    db.insert('fb_kiosks', { id, program_id: user.program_id, event_id: e.id, pin_hash: hashPassword(String(body.pin)), created_by: user.id });
    audit(user, 'kiosk_start', 'event', e.id);
    return { id };
  });
  router.get('/api/fb/kiosk/:id', ({ user, params }) => {
    staffOnly(user);
    const k = kioskOf(user, params.id);
    const e = j(db.get('SELECT * FROM events WHERE id=?', k.event_id), 'audience');
    const att = Object.fromEntries(db.all('SELECT player_id, status, confirmed FROM attendance WHERE event_id=?', e.id).map((a) => [a.player_id, a]));
    const players = core.resolvePlayers(user.program_id, e.audience).map((id) => db.get('SELECT u.id, u.name, p.jersey FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.id=?', id))
      .map((p) => ({ id: p.id, name: p.name, jersey: p.jersey, status: att[p.id]?.confirmed ? att[p.id].status : null }))
      .sort((a, b) => (a.jersey ?? 999) - (b.jersey ?? 999) || a.name.localeCompare(b.name));
    return { id: k.id, ended: !!k.ended_at, event: { id: e.id, title: e.title, start: e.start, location: e.location }, players };
  });
  router.post('/api/fb/kiosk/:id/checkin', ({ user, params, body }) => {
    staffOnly(user);
    const k = kioskOf(user, params.id);
    need(!k.ended_at, 410, 'This kiosk was closed');
    const e = j(db.get('SELECT * FROM events WHERE id=?', k.event_id), 'audience');
    const pid = Number(body.player_id);
    need(core.resolvePlayers(user.program_id, e.audience).includes(pid), 400, 'That player is not on the list for this event');
    const existing = db.get('SELECT * FROM attendance WHERE event_id=? AND player_id=?', e.id, pid);
    if (existing && existing.confirmed && existing.source !== 'rsvp') return { ok: true, status: existing.status, already: true };
    const status = nowLocal() > addMinutes(e.start, 5) ? 'late' : 'present';
    db.run(`INSERT INTO attendance (event_id, player_id, status, source, confirmed, by_user, at) VALUES (?,?,?,'kiosk',1,?,?)
      ON CONFLICT(event_id, player_id) DO UPDATE SET status=excluded.status, source='kiosk', confirmed=1, by_user=excluded.by_user, at=excluded.at`, e.id, pid, status, user.id, nowLocal());
    audit(user, 'kiosk_checkin', 'event', e.id, { player: pid, status });
    return { ok: true, status };
  });
  router.post('/api/fb/kiosk/:id/exit', ({ user, params, body }) => {
    staffOnly(user);
    const k = kioskOf(user, params.id);
    need(!blocked(`kiosk:${k.id}`, 5), 429, 'Too many wrong PINs. Wait 10 minutes.');
    if (!checkPassword(String(body.pin || ''), k.pin_hash)) { strike(`kiosk:${k.id}`); fail(403, 'Wrong PIN'); }
    db.run('UPDATE fb_kiosks SET ended_at=? WHERE id=?', nowLocal(), k.id);
    audit(user, 'kiosk_end', 'event', k.event_id);
    return { ok: true, event_id: k.event_id };
  });

  // =====================================================================
  // C-20: attendance streaks and trends, linked to workouts and practices
  // =====================================================================
  function attendanceRecords(programId, from, to, type) {
    const rows = db.all(`SELECT a.player_id, a.status, e.id event_id, e.type, e.start FROM attendance a JOIN events e ON e.id=a.event_id
      WHERE e.program_id=? AND a.confirmed=1 AND e.start>=? AND e.start<=? AND e.status!='cancelled' ${type ? 'AND e.type=?' : ''}`, programId, from, to + 'T23:59', ...(type ? [type] : []));
    // A logged workout on a lift day counts as attending that lift even when nobody took attendance.
    if (!type || type === 'lift') {
      const marked = new Set(rows.map((r) => `${r.event_id}:${r.player_id}`));
      for (const e of jAll(db.all(`SELECT id, start, audience FROM events WHERE program_id=? AND type='lift' AND status!='cancelled' AND start>=? AND start<=?`, programId, from, to + 'T23:59'), 'audience')) {
        const logged = new Set(db.all('SELECT DISTINCT player_id FROM wt_logs WHERE date=?', e.start.slice(0, 10)).map((r) => r.player_id));
        if (!logged.size) continue;
        for (const pid of core.resolvePlayers(programId, e.audience)) {
          if (logged.has(pid) && !marked.has(`${e.id}:${pid}`)) rows.push({ player_id: pid, status: 'present', event_id: e.id, type: 'lift', start: e.start, via: 'workout' });
        }
      }
    }
    return rows;
  }
  function summarize(list) {
    list.sort((a, b) => (a.start < b.start ? -1 : 1));
    let cur = 0; let best = 0; let run = 0;
    const counted = list.filter((r) => r.status !== 'excused'); // excused absences neither count nor break a streak
    for (const r of counted) { if (ATTENDED.includes(r.status)) { run++; best = Math.max(best, run); } else run = 0; }
    for (let i = counted.length - 1; i >= 0 && ATTENDED.includes(counted[i].status); i--) cur++;
    const weeks = {};
    for (const r of counted) { const w = weeks[mondayOf(r.start)] ||= { n: 0, here: 0 }; w.n++; if (ATTENDED.includes(r.status)) w.here++; }
    const rate = (rows) => { const c = rows.filter((r) => r.status !== 'excused'); return c.length ? Math.round((c.filter((r) => ATTENDED.includes(r.status)).length / c.length) * 100) : null; };
    return {
      events: list.length, rate: rate(list), current_streak: cur, best_streak: best,
      practice_rate: rate(list.filter((r) => r.type === 'practice')), workout_rate: rate(list.filter((r) => r.type === 'lift')),
      tardies: list.filter((r) => r.status === 'late').length, via_workout: list.filter((r) => r.via === 'workout').length,
      trend: Object.entries(weeks).sort().map(([w, v]) => [w, Math.round((v.here / v.n) * 100)]),
    };
  }
  router.get('/api/fb/attendance/trends', ({ user, query }) => {
    staffOnly(user);
    const from = query.from || core.currentSeason(user.program_id)?.start_date || addDays(today(), -90);
    const to = query.to || today();
    const rows = attendanceRecords(user.program_id, from, to, query.type || null);
    const info = Object.fromEntries(jAll(db.all(`SELECT u.id, u.name, p.jersey, p.team_id, p.positions, p.primary_group FROM users u JOIN player_profiles p ON p.user_id=u.id
      WHERE u.program_id=? AND u.role='player' AND u.active=1 AND p.archived=0`, user.program_id), 'positions').map((p) => [p.id, { ...p, group: p.primary_group || p.positions[0] || 'None' }]));
    const by = {};
    for (const r of rows) if (info[r.player_id]) (by[r.player_id] ||= []).push(r);
    let players = Object.entries(by).map(([pid, list]) => { const p = info[pid]; return { player_id: Number(pid), name: p.name, jersey: p.jersey, team_id: p.team_id, group: p.group, ...summarize(list) }; });
    if (query.team_id) players = players.filter((p) => p.team_id === Number(query.team_id));
    if (query.group) players = players.filter((p) => p.group === query.group);
    const groups = {};
    for (const p of players) (groups[p.group] ||= []).push(...by[p.player_id]);
    return {
      from, to,
      players: players.sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || a.name.localeCompare(b.name)),
      groups: Object.entries(groups).map(([g, list]) => { const s = summarize(list); return { group: g, rate: s.rate, practice_rate: s.practice_rate, workout_rate: s.workout_rate, trend: s.trend, athletes: players.filter((p) => p.group === g).length }; }).sort((a, b) => a.group.localeCompare(b.group)),
    };
  });
  router.get('/api/fb/attendance/player/:id', ({ user, params, query }) => {
    const id = Number(params.id);
    need(canSee(user, id), 403, 'No access');
    const from = query.from || core.currentSeason(user.program_id)?.start_date || addDays(today(), -90);
    return { from, ...summarize(attendanceRecords(user.program_id, from, query.to || today(), null).filter((r) => r.player_id === id)) };
  });

  // =====================================================================
  // C-23: document sharing with viewed-by tracking
  // =====================================================================
  const docOf = (u, id) => j(db.get('SELECT * FROM fb_docs WHERE id=? AND program_id=?', id, u.program_id), 'audience');
  const docVisible = (u, d) => isAdmin(u) || d.by_user === u.id || core.inAudience(u, d.audience);
  const docManage = (u, d) => isAdmin(u) || d.by_user === u.id;
  router.get('/api/fb/docs', ({ user }) => {
    const rows = jAll(db.all('SELECT d.id, d.title, d.description, d.kind, d.url, d.filename, d.mime, d.size, d.audience, d.by_user, d.at, u.name by_name FROM fb_docs d LEFT JOIN users u ON u.id=d.by_user WHERE d.program_id=? ORDER BY d.id DESC', user.program_id), 'audience')
      .filter((d) => docVisible(user, d));
    return rows.map((d) => {
      const mine = db.get('SELECT first_at FROM fb_doc_views WHERE doc_id=? AND user_id=?', d.id, user.id);
      const out = { ...d, type: d.kind === 'link' ? 'Link' : DOC_TYPES[d.mime] || 'File', audience_labels: core.describeAudience(user.program_id, d.audience), viewed_at: mine?.first_at || null, can_manage: docManage(user, d) };
      if (isStaff(user)) {
        out.views = db.get('SELECT count(*) n FROM fb_doc_views WHERE doc_id=?', d.id).n;
        out.recipients = core.resolveRecipients(user.program_id, d.audience, { staff: false }).length;
      }
      return out;
    });
  });
  router.post('/api/fb/docs', ({ user, body }) => {
    need(can(user, 'messages.send'), 403, 'Only coaches and trainers share documents');
    const title = String(body.title || '').trim();
    need(title, 400, 'Title is required');
    const audience = Array.isArray(body.audience) ? body.audience : [];
    need(audience.length, 400, 'Choose who can see this document');
    need(core.managesAudience(user, audience) || !core.staffScopes(user.id).length || user.role === 'trainer', 403, 'You can only share with your own groups');
    const row = { program_id: user.program_id, title: title.slice(0, 160), description: body.description ? String(body.description).slice(0, 1000) : null, audience, by_user: user.id };
    if (body.kind === 'link') {
      need(/^https?:\/\/\S+$/i.test(String(body.url || '')), 400, 'Links must start with http:// or https://');
      Object.assign(row, { kind: 'link', url: String(body.url).slice(0, 2000) });
    } else {
      const m = /^data:([\w./+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ''));
      need(m, 400, 'Attach a file');
      need(DOC_TYPES[m[1]], 400, 'Share PDFs, images, documents, spreadsheets or slides');
      const size = Math.floor((m[2].length * 3) / 4) - (m[2].endsWith('==') ? 2 : m[2].endsWith('=') ? 1 : 0);
      need(size <= MAX_DOC_BYTES, 400, 'Files must be 5 MB or smaller');
      Object.assign(row, { kind: 'file', data: body.data, mime: m[1], size, filename: String(body.filename || title).replace(/[^\w .()-]+/g, '_').slice(0, 120) });
    }
    const id = db.insert('fb_docs', row);
    audit(user, 'share_document', 'document', id, { audience, kind: row.kind });
    const to = core.resolveRecipients(user.program_id, audience, { staff: false }).filter((x) => x !== user.id);
    notify(user.program_id, to, { kind: 'update', title: `New document: ${row.title}`, body: row.description || '', link: '/messages/documents', email: false });
    return { id };
  });
  function recordView(user, d) {
    const now = nowLocal();
    db.run(`INSERT INTO fb_doc_views (doc_id, user_id, first_at, last_at, count) VALUES (?,?,?,?,1)
      ON CONFLICT(doc_id, user_id) DO UPDATE SET last_at=excluded.last_at, count=count+1`, d.id, user.id, now, now);
  }
  router.get('/api/fb/docs/:id/file', ({ user, params }) => {
    const d = docOf(user, Number(params.id));
    need(d && docVisible(user, d), 404, 'Document not found');
    need(d.kind === 'file', 400, 'This document is a link');
    recordView(user, d);
    const b64 = d.data.slice(d.data.indexOf(',') + 1);
    return { __raw: true, type: d.mime, body: Buffer.from(b64, 'base64'), headers: { 'Content-Disposition': `inline; filename="${d.filename}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'" } };
  });
  router.post('/api/fb/docs/:id/open', ({ user, params }) => {
    const d = docOf(user, Number(params.id));
    need(d && docVisible(user, d), 404, 'Document not found');
    recordView(user, d);
    return { kind: d.kind, url: d.kind === 'link' ? d.url : `/api/fb/docs/${d.id}/file` };
  });
  router.get('/api/fb/docs/:id/views', ({ user, params }) => {
    const d = docOf(user, Number(params.id));
    need(d && docVisible(user, d), 404, 'Document not found');
    need(isStaff(user), 403, 'Staff only');
    const views = Object.fromEntries(db.all('SELECT * FROM fb_doc_views WHERE doc_id=?', d.id).map((v) => [v.user_id, v]));
    const ids = core.resolveRecipients(user.program_id, d.audience, { staff: false });
    const people = ids.length ? db.all(`SELECT id, name, role FROM users WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY role, name`, ...ids) : [];
    return { recipients: people.map((p) => ({ ...p, viewed_at: views[p.id]?.first_at || null, count: views[p.id]?.count || 0 })), staff_views: Object.values(views).filter((v) => !ids.includes(v.user_id)).length };
  });
  router.del('/api/fb/docs/:id', ({ user, params }) => {
    const d = docOf(user, Number(params.id));
    need(d, 404, 'Document not found');
    need(docManage(user, d), 403, 'Only the person who shared it or an admin can remove it');
    db.run('DELETE FROM fb_docs WHERE id=?', d.id);
    audit(user, 'delete_document', 'document', d.id);
    return { ok: true };
  });

  // =====================================================================
  // C-24: season history on profiles
  // =====================================================================
  router.get('/api/fb/history/:id', ({ user, params }) => {
    const id = Number(params.id);
    need(canSee(user, id), 403, 'No access');
    return jAll(db.all('SELECT season_id, season_name, team, class_year, positions, attendance_rate, events, tests, prs, graduated, at FROM fb_season_archive WHERE player_id=? AND program_id=? ORDER BY id DESC', id, user.program_id), 'positions', 'tests', 'prs')
      .map((r) => ({ ...r, tests: Object.fromEntries(Object.entries(r.tests).map(([k, v]) => [k, { ...v, label: TESTS()[k]?.label || k, unit: TESTS()[k]?.unit || '' }])) }));
  });

  // =====================================================================
  // F-11: heat acclimatization
  // =====================================================================
  const heatRule = (s, date) => {
    if (!s.heat_start_date || !date) return null;
    const day = daysBetween(s.heat_start_date, date) + 1;
    const rule = (s.heat_schedule || []).find((r) => day >= r.from && day <= r.to);
    return rule ? { day, rule } : { day, rule: null };
  };
  function heatCheck(programId, date, { planId = null } = {}) {
    const s = core.settings(programId);
    const hr = heatRule(s, date);
    const out = { date, start_date: s.heat_start_date, day: hr?.day ?? null, rule: hr?.rule ?? null, active: !!hr?.rule, warnings: [], logs: [] };
    out.logs = db.all('SELECT * FROM fb_heat_logs WHERE program_id=? AND date=? ORDER BY id', programId, date);
    const lim = s.heat_limits || {};
    for (const l of out.logs) {
      const L = lim[l.reading_type];
      if (L && l.reading != null) {
        if (l.reading >= L.stop) out.warnings.push({ level: 'bad', text: `${l.reading_type === 'wbgt' ? 'WBGT' : 'Heat index'} ${l.reading} is at or above the stop limit (${L.stop}). Move indoors or cancel.` });
        else if (l.reading >= L.caution) out.warnings.push({ level: 'warn', text: `${l.reading_type === 'wbgt' ? 'WBGT' : 'Heat index'} ${l.reading} is above the caution limit (${L.caution}). Add rest and water breaks and reduce equipment.` });
      }
    }
    if (!out.active) return out;
    const r = out.rule;
    const practices = db.all(`SELECT e.id, e.title, e.start, e.end FROM events e WHERE e.program_id=? AND e.type='practice' AND e.status!='cancelled' AND substr(e.start,1,10)=?`, programId, date);
    if (practices.length > r.max_practices) out.warnings.push({ level: 'bad', text: `Day ${out.day}: ${practices.length} practices are scheduled; the schedule allows ${r.max_practices}.` });
    const planMinutes = (pid) => db.get('SELECT coalesce(sum(duration),0) m, coalesce(sum(CASE WHEN contact=1 THEN duration ELSE 0 END),0) c FROM periods WHERE plan_id=?', pid);
    const plans = db.all(`SELECT DISTINCT pp.id FROM practice_plans pp JOIN events e ON e.id=pp.event_id WHERE e.program_id=? AND e.type='practice' AND e.status!='cancelled' AND substr(e.start,1,10)=?`, programId, date).map((x) => x.id);
    if (planId && !plans.includes(planId)) plans.push(planId);
    let minutes = 0; let contact = 0;
    for (const pid of plans) { const m = planMinutes(pid); minutes += m.m; contact += m.c; }
    if (!plans.length) for (const e of practices) if (e.end) minutes += Math.max(0, (parseLocal(e.end) - parseLocal(e.start)) / 60000);
    out.minutes = minutes; out.contact_minutes = contact;
    if (minutes > r.max_minutes) out.warnings.push({ level: 'bad', text: `Day ${out.day}: ${minutes} practice minutes planned; the schedule allows ${r.max_minutes}.` });
    if (!r.contact && contact > 0) out.warnings.push({ level: 'bad', text: `Day ${out.day} is ${EQUIP_LABEL[r.equipment] || r.equipment}: ${contact} contact minutes are planned. No contact is allowed yet.` });
    for (const l of out.logs) {
      if (l.equipment && EQUIP.indexOf(l.equipment) > EQUIP.indexOf(r.equipment)) out.warnings.push({ level: 'bad', text: `Logged ${EQUIP_LABEL[l.equipment]} on day ${out.day}; the schedule allows ${EQUIP_LABEL[r.equipment]}.` });
    }
    if (r.max_practices > 1 && practices.length > 1) {
      const prev = db.get(`SELECT count(*) n FROM events WHERE program_id=? AND type='practice' AND status!='cancelled' AND substr(start,1,10)=?`, programId, addDays(date, -1)).n;
      if (prev > 1) out.warnings.push({ level: 'warn', text: 'Double sessions on consecutive days. Follow a double-session day with a single-practice day.' });
    }
    return out;
  }
  router.get('/api/fb/heat', ({ user, query }) => {
    staffOnly(user);
    const from = query.from || addDays(today(), -30); const to = query.to || today();
    const s = core.settings(user.program_id);
    const logs = db.all(`SELECT h.*, u.name by_name, t.name team_name FROM fb_heat_logs h LEFT JOIN users u ON u.id=h.by_user LEFT JOIN teams t ON t.id=h.team_id
      WHERE h.program_id=? AND h.date>=? AND h.date<=? ORDER BY h.date DESC, h.id DESC`, user.program_id, from, to)
      .map((l) => { const hr = heatRule(s, l.date); return { ...l, day: hr?.rule ? hr.day : null, allowed: hr?.rule?.equipment || null, over: !!(hr?.rule && l.equipment && EQUIP.indexOf(l.equipment) > EQUIP.indexOf(hr.rule.equipment)) }; });
    return { logs, start_date: s.heat_start_date, schedule: s.heat_schedule, limits: s.heat_limits, today: heatCheck(user.program_id, today()) };
  });
  router.post('/api/fb/heat', ({ user, body }) => {
    need(can(user, 'heat.log'), 403, 'Coaches and trainers log heat readings');
    need(/^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')), 400, 'Date is required');
    need(['heat_index', 'wbgt'].includes(body.reading_type || 'heat_index'), 400, 'Reading is heat index or WBGT');
    need(body.reading !== '' && body.reading != null && Number.isFinite(Number(body.reading)), 400, 'Enter the reading');
    need(!body.equipment || EQUIP.includes(body.equipment), 400, 'Equipment is helmet, shells or full');
    if (body.team_id) need(teamOf(user.program_id, Number(body.team_id)), 400, 'Unknown team');
    if (body.event_id) need(db.get('SELECT 1 FROM events WHERE id=? AND program_id=?', Number(body.event_id), user.program_id), 400, 'Unknown event');
    const id = db.insert('fb_heat_logs', {
      program_id: user.program_id, date: body.date, reading_type: body.reading_type || 'heat_index', reading: Number(body.reading),
      duration_min: body.duration_min ? Number(body.duration_min) : null, equipment: body.equipment || null, team_id: body.team_id ? Number(body.team_id) : null,
      event_id: body.event_id ? Number(body.event_id) : null, notes: body.notes ? String(body.notes).slice(0, 500) : null, by_user: user.id,
    });
    audit(user, 'heat_log', 'heat', id, { date: body.date, reading: body.reading });
    return { id, check: heatCheck(user.program_id, body.date) };
  });
  router.del('/api/fb/heat/:id', ({ user, params }) => {
    need(can(user, 'heat.log'), 403, 'Coaches and trainers only');
    db.run('DELETE FROM fb_heat_logs WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    return { ok: true };
  });
  router.get('/api/fb/heat/check', ({ user, query }) => {
    staffOnly(user);
    let date = query.date; let planId = null;
    if (query.plan_id) {
      const p = db.get('SELECT pp.id, e.start FROM practice_plans pp LEFT JOIN events e ON e.id=pp.event_id WHERE pp.id=? AND pp.program_id=?', Number(query.plan_id), user.program_id);
      need(p, 404, 'Plan not found');
      planId = p.id; date = date || p.start?.slice(0, 10);
    }
    if (!date) return { active: false, warnings: [] };
    return heatCheck(user.program_id, date, { planId });
  });

  // =====================================================================
  // F-12: concussion return to play
  // =====================================================================
  const caseOut = (u, c) => {
    const st = CONCUSSION_STAGES.find((s) => s.stage === c.stage);
    const out = {
      id: c.id, player_id: c.player_id, player: c.player, jersey: c.jersey, injury_date: c.injury_date, stage: c.stage, stage_label: st?.label, stages: CONCUSSION_STAGES.length,
      status: c.status, opened_at: c.opened_at, closed_at: c.closed_at,
      signoffs: db.all('SELECT s.stage, s.signed_at, u.name signed_by FROM fb_concussion_signoffs s LEFT JOIN users u ON u.id=s.signed_by WHERE s.case_id=? ORDER BY s.stage', c.id),
    };
    if (isMedical(u)) out.notes = db.all('SELECT n.id, n.stage, n.note, n.at, u.name by_name FROM fb_medical_notes n LEFT JOIN users u ON u.id=n.by_user WHERE n.case_id=? ORDER BY n.id', c.id);
    return out;
  };
  const caseOf = (u, id) => db.get('SELECT c.*, u.name player, p.jersey FROM fb_concussions c JOIN users u ON u.id=c.player_id JOIN player_profiles p ON p.user_id=c.player_id WHERE c.id=? AND c.program_id=?', id, u.program_id);
  router.get('/api/fb/concussions', ({ user, query }) => {
    const where = ['c.program_id=?']; const args = [user.program_id];
    if (isStaff(user)) { if (query.player_id) { where.push('c.player_id=?'); args.push(Number(query.player_id)); } } else {
      const mine = core.linkedPlayers(user);
      if (!mine.length) return [];
      where.push(`c.player_id IN (${mine.map(() => '?').join(',')})`); args.push(...mine);
    }
    if (query.status) { where.push('c.status=?'); args.push(query.status); }
    return db.all(`SELECT c.*, u.name player, p.jersey FROM fb_concussions c JOIN users u ON u.id=c.player_id JOIN player_profiles p ON p.user_id=c.player_id WHERE ${where.join(' AND ')} ORDER BY c.status='active' DESC, c.id DESC`, ...args).map((c) => caseOut(user, c));
  });
  router.get('/api/fb/concussions/:id', ({ user, params }) => {
    const c = caseOf(user, Number(params.id));
    need(c && (isStaff(user) || core.linkedPlayers(user).includes(c.player_id)), 404, 'Case not found');
    if (isMedical(user)) audit(user, 'view_medical', 'player', c.player_id, { case: c.id });
    return caseOut(user, c);
  });
  router.post('/api/fb/concussions', ({ user, body }) => {
    need(can(user, 'availability.edit') || isMedical(user), 403, 'Only coaches and trainers report a concussion');
    const p = playerOf(user.program_id, Number(body.player_id));
    need(p, 404, 'Player not found');
    need(!db.get(`SELECT 1 FROM fb_concussions WHERE player_id=? AND status='active'`, p.id), 400, 'This player already has an open return-to-play case');
    const id = db.tx(() => {
      const cid = db.insert('fb_concussions', { program_id: user.program_id, player_id: p.id, injury_date: body.injury_date || today(), stage: 1, status: 'active', prior_availability: p.availability, opened_by: user.id, opened_at: nowLocal() });
      if (body.note && isMedical(user)) db.insert('fb_medical_notes', { case_id: cid, stage: 1, note: String(body.note).slice(0, 4000), by_user: user.id });
      db.update('player_profiles', p.id, { availability: 'out', avail_note: 'Return-to-play protocol', return_date: null, avail_updated_by: user.id, avail_updated_at: nowLocal() }, 'user_id');
      return cid;
    });
    audit(user, 'concussion_open', 'player', p.id, { case: id });
    audit(user, 'set_availability', 'player', p.id, { availability: 'out', reason: 'protocol' });
    const med = db.all(`SELECT id, perms, role FROM users WHERE program_id=? AND active=1 AND role IN ('trainer','head_coach','coach','staff')`, user.program_id).filter((u) => u.id !== user.id && (u.role === 'trainer' || JSON.parse(u.perms || '{}').medical || u.role === 'head_coach')).map((u) => u.id);
    notify(user.program_id, med, { kind: 'urgent', title: `${p.name}: return-to-play protocol started`, body: 'Out until each stage is signed off.', link: '/safety?tab=concussion', from: 'system', email: false });
    return { id };
  });
  router.post('/api/fb/concussions/:id/advance', ({ user, params, body }) => {
    need(isMedical(user), 403, 'Only the designated medical professional signs off a stage');
    const c = caseOf(user, Number(params.id));
    need(c, 404, 'Case not found');
    need(c.status === 'active', 400, 'This case is closed');
    db.tx(() => {
      db.insert('fb_concussion_signoffs', { case_id: c.id, stage: c.stage, signed_by: user.id, signed_at: nowLocal() });
      if (body.note) db.insert('fb_medical_notes', { case_id: c.id, stage: c.stage, note: String(body.note).slice(0, 4000), by_user: user.id });
      if (c.stage >= CONCUSSION_STAGES.length) {
        db.update('fb_concussions', c.id, { status: 'closed', closed_at: nowLocal() });
        db.update('player_profiles', c.player_id, { availability: 'cleared', avail_note: 'Cleared after return-to-play protocol', avail_updated_by: user.id, avail_updated_at: nowLocal() }, 'user_id');
      } else db.update('fb_concussions', c.id, { stage: c.stage + 1 });
    });
    audit(user, 'concussion_signoff', 'player', c.player_id, { case: c.id, stage: c.stage });
    const closed = c.stage >= CONCUSSION_STAGES.length;
    if (closed) audit(user, 'set_availability', 'player', c.player_id, { availability: 'cleared' });
    const staffIds = db.all(`SELECT id FROM users WHERE program_id=? AND role IN ('head_coach','coach') AND active=1`, user.program_id).map((r) => r.id);
    notify(user.program_id, staffIds, { kind: 'update', title: closed ? `${c.player}: cleared to return` : `${c.player}: now at stage ${c.stage + 1} of ${CONCUSSION_STAGES.length}`, body: closed ? '' : CONCUSSION_STAGES[c.stage].label, link: `/players/${c.player_id}`, from: 'system', email: false });
    return caseOut(user, caseOf(user, c.id));
  });
  router.post('/api/fb/concussions/:id/notes', ({ user, params, body }) => {
    need(isMedical(user), 403, 'Only the designated medical professional adds medical notes');
    const c = caseOf(user, Number(params.id));
    need(c, 404, 'Case not found');
    need(String(body.note || '').trim(), 400, 'Note is required');
    const id = db.insert('fb_medical_notes', { case_id: c.id, stage: c.stage, note: String(body.note).slice(0, 4000), by_user: user.id });
    audit(user, 'medical_note', 'player', c.player_id, { case: c.id });
    return { id };
  });

  // =====================================================================
  // F-13: eligibility checklist
  // =====================================================================
  const ELIG_ITEMS = [['physical', 'Physical on file'], ['consent', 'Parent consent'], ['emergency_contact', 'Emergency contact'], ['insurance', 'Insurance'], ['fees_paid', 'Fees paid'], ['academic', 'Academic eligibility']];
  function eligibility(row, s, day = today()) {
    const e = row || {};
    const warn = s.physical_warn_days ?? 30;
    const expired = !!e.physical_expires && e.physical_expires < day;
    const expiring = !!e.physical_expires && !expired && e.physical_expires <= addDays(day, warn);
    const items = {
      physical: !!e.physical_date && !!e.physical_expires && !expired, consent: !!e.consent, emergency_contact: !!e.emergency_contact,
      insurance: !!e.insurance, fees_paid: !!e.fees_paid, academic: e.academic === 'eligible',
    };
    const missing = ELIG_ITEMS.filter(([k]) => !items[k]).map(([, l]) => l);
    return {
      items, cleared: !missing.length, missing, physical_date: e.physical_date || null, physical_expires: e.physical_expires || null, expiring, expired,
      academic: e.academic || null, insurance_note: e.insurance_note || null, fees_note: e.fees_note || null, notes: e.notes || null, updated_at: e.updated_at || null,
    };
  }
  function eligibilityList(user) {
    const s = core.settings(user.program_id);
    const rows = jAll(db.all(`SELECT u.id, u.name, p.jersey, p.team_id, p.class_year, p.positions, p.primary_group, p.availability, t.name team, l.name lname, e.*
      FROM users u JOIN player_profiles p ON p.user_id=u.id LEFT JOIN teams t ON t.id=p.team_id LEFT JOIN levels l ON l.id=t.level_id LEFT JOIN fb_eligibility e ON e.player_id=u.id
      WHERE u.program_id=? AND u.role='player' AND u.active=1 AND p.archived=0 ORDER BY u.name`, user.program_id), 'positions');
    const signed = {};
    for (const r of db.all(`SELECT s.player_id, f.kind, max(s.signed_at) at FROM fb_signatures s JOIN fb_forms f ON f.id=s.form_id WHERE s.program_id=? GROUP BY s.player_id, f.kind`, user.program_id)) (signed[r.player_id] ||= {})[r.kind] = r.at;
    return rows.map((r) => ({
      player_id: r.id, name: r.name, jersey: r.jersey, team_id: r.team_id, team: r.team ? (r.team === r.lname ? r.team : `${r.lname} ${r.team}`) : null,
      class_year: r.class_year, group: r.primary_group || r.positions[0] || null, availability: r.availability,
      ...eligibility(r.player_id ? r : null, s), signed: signed[r.id] || {},
    }));
  }
  router.get('/api/fb/eligibility', ({ user, query }) => {
    need(eligView(user), 403, 'No access to eligibility records');
    let list = eligibilityList(user);
    if (query.team_id) list = list.filter((r) => r.team_id === Number(query.team_id));
    return { items: ELIG_ITEMS, warn_days: core.settings(user.program_id).physical_warn_days, players: list };
  });
  router.get('/api/fb/eligibility/summary', ({ user }) => {
    need(eligView(user), 403, 'No access to eligibility records');
    const list = eligibilityList(user);
    return { total: list.length, cleared: list.filter((r) => r.cleared).length, not_cleared: list.filter((r) => !r.cleared).length, expiring: list.filter((r) => r.expiring).length, expired: list.filter((r) => r.expired).length };
  });
  router.get('/api/fb/eligibility/player/:id', ({ user, params }) => {
    const id = Number(params.id);
    need((isStaff(user) && eligView(user) && playerOf(user.program_id, id)) || core.linkedPlayers(user).includes(id), 403, 'No access');
    return { items: ELIG_ITEMS, ...eligibility(db.get('SELECT * FROM fb_eligibility WHERE player_id=?', id), core.settings(user.program_id)) };
  });
  function upsertEligibility(playerId, fields, byUser) {
    if (!db.get('SELECT 1 FROM fb_eligibility WHERE player_id=?', playerId)) db.insert('fb_eligibility', { player_id: playerId });
    db.update('fb_eligibility', playerId, { ...fields, updated_by: byUser, updated_at: nowLocal() }, 'player_id');
  }
  router.put('/api/fb/eligibility/:id', ({ user, params, body }) => {
    need(can(user, 'eligibility.edit'), 403, 'Coaches, trainers and eligibility staff only');
    const id = Number(params.id);
    need(playerOf(user.program_id, id), 404, 'Player not found');
    const f = {};
    for (const k of ['physical_date', 'physical_expires']) if (body[k] !== undefined) { need(!body[k] || /^\d{4}-\d{2}-\d{2}$/.test(body[k]), 400, 'Dates are YYYY-MM-DD'); f[k] = body[k] || null; }
    if (body.physical_date && body.physical_expires === undefined && !db.get('SELECT physical_expires FROM fb_eligibility WHERE player_id=?', id)?.physical_expires) f.physical_expires = addDays(body.physical_date, 365);
    for (const k of ['consent', 'emergency_contact', 'insurance', 'fees_paid']) if (body[k] !== undefined) f[k] = body[k] ? 1 : 0;
    if (body.academic !== undefined) { need(['eligible', 'probation', 'ineligible', null, ''].includes(body.academic), 400, 'Academic status is eligible, probation or ineligible'); f.academic = body.academic || null; }
    for (const k of ['insurance_note', 'fees_note', 'notes']) if (body[k] !== undefined) f[k] = body[k] ? String(body[k]).slice(0, 500) : null;
    upsertEligibility(id, f, user.id);
    audit(user, 'update_eligibility', 'player', id, Object.keys(f));
    return { ok: true, ...eligibility(db.get('SELECT * FROM fb_eligibility WHERE player_id=?', id), core.settings(user.program_id)) };
  });

  // =====================================================================
  // F-14: digital forms with parent e-signature
  // =====================================================================
  router.get('/api/fb/forms', ({ user }) => {
    const forms = db.all('SELECT * FROM fb_forms WHERE program_id=? AND active=1 ORDER BY id', user.program_id);
    if (isStaff(user)) {
      const total = db.get(`SELECT count(*) n FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.program_id=? AND u.role='player' AND u.active=1 AND p.archived=0`, user.program_id).n;
      return forms.map((f) => ({ ...f, signed: db.get('SELECT count(DISTINCT player_id) n FROM fb_signatures WHERE form_id=?', f.id).n, total }));
    }
    const kids = core.linkedPlayers(user).map((id) => db.get('SELECT id, name FROM users WHERE id=?', id));
    return forms.map((f) => ({
      ...f,
      children: kids.map((k) => { const s = db.get('SELECT s.signed_at, s.typed_name, u.name signer FROM fb_signatures s LEFT JOIN users u ON u.id=s.signer_id WHERE s.form_id=? AND s.player_id=? ORDER BY s.id DESC LIMIT 1', f.id, k.id); return { player_id: k.id, name: k.name, signed_at: s?.signed_at || null, signer: s?.signer || null }; }),
    }));
  });
  router.post('/api/fb/forms', ({ user, body }) => {
    need(isAdmin(user), 403, 'Head coach only');
    need(['consent', 'emergency', 'other'].includes(body.kind) && body.title, 400, 'Kind and title are required');
    const id = db.insert('fb_forms', { program_id: user.program_id, kind: body.kind, title: String(body.title).slice(0, 160), body: String(body.body || '').slice(0, 20000), created_by: user.id });
    audit(user, 'create_form', 'fb_form', id);
    return { id };
  });
  router.put('/api/fb/forms/:id', ({ user, params, body }) => {
    need(isAdmin(user), 403, 'Head coach only');
    const f = db.get('SELECT * FROM fb_forms WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    need(f, 404, 'Form not found');
    db.update('fb_forms', f.id, { ...(body.title && { title: String(body.title).slice(0, 160) }), ...(body.body !== undefined && { body: String(body.body).slice(0, 20000) }), ...(body.active !== undefined && { active: body.active ? 1 : 0 }) });
    audit(user, 'update_form', 'fb_form', f.id);
    return { ok: true };
  });
  router.post('/api/fb/forms/:id/sign', ({ user, params, body, req }) => {
    need(user.role === 'parent', 403, 'Only a parent or guardian signs these forms');
    const f = db.get('SELECT * FROM fb_forms WHERE id=? AND program_id=? AND active=1', Number(params.id), user.program_id);
    need(f, 404, 'Form not found');
    const pid = Number(body.player_id);
    need(core.linkedPlayers(user).includes(pid), 403, 'You can only sign for your own child');
    const typed = String(body.typed_name || '').trim();
    need(typed.length >= 3, 400, 'Type your full name');
    need(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(String(body.signature || '')) && body.signature.length <= 400_000, 400, 'Draw your signature');
    need(body.agree === true, 400, 'Check the box to agree');
    let data = {};
    if (f.kind === 'emergency') {
      const d = body.data || {};
      need(d.contact_name && d.contact_phone, 400, 'Emergency contact name and phone are required');
      data = Object.fromEntries(['contact_name', 'contact_phone', 'relation', 'contact2_name', 'contact2_phone', 'physician', 'physician_phone', 'allergies', 'medications', 'conditions'].filter((k) => d[k]).map((k) => [k, String(d[k]).slice(0, 300)]));
    }
    const at = nowLocal();
    const id = db.insert('fb_signatures', { program_id: user.program_id, form_id: f.id, player_id: pid, signer_id: user.id, typed_name: typed.slice(0, 120), signature: body.signature, data, ip: clientIp(req), user_agent: String(req?.headers?.['user-agent'] || '').slice(0, 300), signed_at: at });
    if (f.kind === 'consent') upsertEligibility(pid, { consent: 1 }, user.id);
    if (f.kind === 'emergency') upsertEligibility(pid, { emergency_contact: 1 }, user.id);
    audit(user, 'sign_form', 'player', pid, { form: f.id, kind: f.kind });
    return { id, signed_at: at };
  });
  router.get('/api/fb/forms/:id/signatures', ({ user, params }) => {
    need(eligView(user), 403, 'No access');
    const f = db.get('SELECT * FROM fb_forms WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    need(f, 404, 'Form not found');
    return jAll(db.all(`SELECT s.id, s.player_id, pu.name player, su.name signer, s.typed_name, s.signature, s.data, s.ip, s.user_agent, s.signed_at FROM fb_signatures s
      JOIN users pu ON pu.id=s.player_id LEFT JOIN users su ON su.id=s.signer_id WHERE s.form_id=? ORDER BY s.id DESC`, f.id), 'data');
  });
  router.get('/api/fb/emergency/:id', ({ user, params }) => {
    const id = Number(params.id);
    need((isStaff(user) && playerOf(user.program_id, id)) || core.linkedPlayers(user).includes(id), 403, 'No access');
    const s = j(db.get(`SELECT s.data, s.signed_at, s.typed_name FROM fb_signatures s JOIN fb_forms f ON f.id=s.form_id WHERE s.player_id=? AND f.kind='emergency' ORDER BY s.id DESC LIMIT 1`, id), 'data');
    return s || null;
  });

  // =====================================================================
  // F-17: weekly parent digest
  // =====================================================================
  function digestFor(parent) {
    const day = today(); const s = core.settings(parent.program_id);
    const kids = db.all('SELECT u.id, u.name, p.availability FROM parent_links l JOIN users u ON u.id=l.player_id JOIN player_profiles p ON p.user_id=u.id WHERE l.parent_id=? AND u.active=1 AND p.archived=0', parent.id);
    const events = jAll(db.all(`SELECT id, type, title, start, location, audience, status FROM events WHERE program_id=? AND start>=? AND start<=? AND status!='cancelled' ORDER BY start`, parent.program_id, day, addDays(day, 7) + 'T23:59'), 'audience');
    const program = db.get('SELECT name FROM programs WHERE id=?', parent.program_id).name;
    const lines = [`Weekly update from ${program}`, ''];
    const children = [];
    for (const k of kids) {
      const theirs = events.filter((e) => core.resolvePlayers(parent.program_id, e.audience).includes(k.id));
      const att = db.get(`SELECT count(*) n, sum(a.status IN ('present','late','left_early')) here, sum(a.status='late') late, sum(a.status='unexcused') abs FROM attendance a JOIN events e ON e.id=a.event_id
        WHERE a.player_id=? AND a.confirmed=1 AND e.start>=? AND e.start<=?`, k.id, addDays(day, -7), day + 'T23:59');
      const tests = db.all('SELECT test_key, value, date FROM tests WHERE player_id=? AND date>=? ORDER BY date', k.id, addDays(day, -7));
      const asn = db.get(`SELECT count(*) n, sum(s.status='completed') done FROM assignment_status s JOIN assignments a ON a.id=s.assignment_id WHERE s.player_id=? AND a.due>=? AND a.due<=?`, k.id, addDays(day, -7), day + 'T23:59');
      const prs = tests.filter((t) => { const prev = db.get(`SELECT ${better(t.test_key) === 'lower' ? 'min' : 'max'}(value) v FROM tests WHERE player_id=? AND test_key=? AND date<?`, k.id, t.test_key, t.date).v; return prev == null || isBetter(t.test_key, t.value, prev); });
      const c = { player_id: k.id, name: k.name, events: theirs.map((e) => ({ title: e.title, start: e.start, location: e.location, type: e.type })), attendance: { events: att.n || 0, attended: att.here || 0, tardy: att.late || 0, absent: att.abs || 0 }, tests, prs: prs.length, assignments: { due: asn.n || 0, done: asn.done || 0 } };
      children.push(c);
      lines.push(`${k.name}`, '');
      lines.push('Coming up this week:');
      if (theirs.length) for (const e of theirs.slice(0, 12)) lines.push(`  ${e.start.slice(5, 10).replace('-', '/')} ${e.start.slice(11, 16)}  ${e.title}${e.location ? ` (${e.location})` : ''}`);
      else lines.push('  Nothing scheduled.');
      lines.push('', `Attendance last 7 days: ${c.attendance.attended} of ${c.attendance.events}${c.attendance.tardy ? `, ${c.attendance.tardy} tardy` : ''}${c.attendance.absent ? `, ${c.attendance.absent} absent` : ''}`);
      if (c.assignments.due) lines.push(`Assignments due last 7 days: ${c.assignments.done} of ${c.assignments.due} done`);
      if (tests.length) lines.push(`Testing: ${tests.map((t) => `${TESTS()[t.test_key]?.label || t.test_key} ${t.value}${TESTS()[t.test_key]?.unit ? ' ' + TESTS()[t.test_key].unit : ''}`).join(', ')}${prs.length ? ` (${prs.length} personal record${prs.length > 1 ? 's' : ''})` : ''}`);
      lines.push('');
    }
    lines.push('Open the team app for the full calendar and details. You can turn off email in My account.');
    return { subject: `${program}: week of ${mondayOf(day)}`, body: lines.join('\n'), children, quiet: s.quiet_start };
  }
  function runDigest(programId, { force = false } = {}) {
    const week = mondayOf(today());
    const parents = db.all(`SELECT DISTINCT u.* FROM users u JOIN parent_links l ON l.parent_id=u.id WHERE u.program_id=? AND u.role='parent' AND u.active=1`, programId);
    let sent = 0; let skipped = 0;
    for (const p of parents) {
      const r = db.run('INSERT OR IGNORE INTO fb_digest_log (program_id, week, user_id) VALUES (?,?,?)', programId, week, p.id);
      if (!r.changes && !force) { skipped++; continue; }
      const d = digestFor(p);
      if (!d.children.length) continue;
      notify(programId, [p.id], { kind: 'digest', title: d.subject, body: d.body, link: '/', from: 'system' });
      sent++;
    }
    return { week, sent, skipped };
  }
  ctx.fb.runDigest = runDigest;
  ctx.ticks.push(() => {
    const now = new Date(); const hm = nowLocal().slice(11, 16);
    for (const p of db.all('SELECT id FROM programs')) {
      const s = core.settings(p.id);
      if (!s.parent_digest || now.getDay() !== Number(s.digest_day) || hm < (s.digest_time || '17:00')) continue;
      runDigest(p.id);
    }
  });
  router.get('/api/fb/digest/preview', ({ user, query }) => {
    need(isStaff(user) && can(user, 'messages.send'), 403, 'Coaches only');
    const parent = query.parent_id
      ? db.get(`SELECT * FROM users WHERE id=? AND program_id=? AND role='parent'`, Number(query.parent_id), user.program_id)
      : db.get(`SELECT u.* FROM users u JOIN parent_links l ON l.parent_id=u.id WHERE u.program_id=? AND u.role='parent' AND u.active=1 ORDER BY u.id LIMIT 1`, user.program_id);
    need(parent, 404, 'No parent found');
    const s = core.settings(user.program_id);
    const week = mondayOf(today());
    return { parent: { id: parent.id, name: parent.name, email: parent.email }, ...digestFor(parent), enabled: !!s.parent_digest, digest_day: s.digest_day, digest_time: s.digest_time, sent_this_week: db.get('SELECT count(*) n FROM fb_digest_log WHERE program_id=? AND week=?', user.program_id, week).n };
  });
  router.post('/api/fb/digest/send', ({ user }) => {
    need(isAdmin(user), 403, 'Head coach only');
    const r = runDigest(user.program_id);
    audit(user, 'parent_digest_send', 'program', user.program_id, r);
    return r;
  });

  // =====================================================================
  // F-18: recruiting profile
  // =====================================================================
  const canApprove = (u) => isAdmin(u) || u.role === 'coach';
  function recruitProfile(user, id) {
    const p = db.get(`SELECT u.id, u.name, u.email, p.jersey, p.class_year, p.positions, p.photo, t.name team, l.name lname FROM users u JOIN player_profiles p ON p.user_id=u.id
      LEFT JOIN teams t ON t.id=p.team_id LEFT JOIN levels l ON l.id=t.level_id WHERE u.id=? AND u.program_id=?`, id, user.program_id);
    need(p, 404, 'Player not found');
    j(p, 'positions');
    const r = db.get('SELECT * FROM fb_recruiting WHERE player_id=?', id) || { status: 'draft' };
    const tests = {};
    for (const t of db.all('SELECT t.test_key, t.value, t.date, u.name by_name FROM tests t LEFT JOIN users u ON u.id=t.by_user WHERE t.player_id=? ORDER BY t.date', id)) {
      if (!tests[t.test_key] || isBetter(t.test_key, t.value, tests[t.test_key].value)) tests[t.test_key] = { ...t, label: TESTS()[t.test_key]?.label || t.test_key, unit: TESTS()[t.test_key]?.unit || '', verified: !!t.by_name };
    }
    const h = db.get(`SELECT value FROM measurements WHERE player_id=? AND kind='height' ORDER BY date DESC LIMIT 1`, id)?.value ?? null;
    const w = db.get(`SELECT value FROM measurements WHERE player_id=? AND kind='weight' ORDER BY date DESC LIMIT 1`, id)?.value ?? null;
    const lifts = db.all(`SELECT e.name, max(l.weight) weight FROM wt_logs l JOIN exercises e ON e.id=l.exercise_id WHERE l.player_id=? AND l.weight>0 GROUP BY e.id ORDER BY weight DESC LIMIT 6`, id);
    const approver = r.approved_by ? db.get('SELECT name, title FROM users WHERE id=?', r.approved_by) : null;
    const program = db.get('SELECT name, school, state FROM programs WHERE id=?', user.program_id);
    const coach = db.get(`SELECT name, email, phone, title FROM users WHERE program_id=? AND role='head_coach' AND active=1 ORDER BY id LIMIT 1`, user.program_id);
    return {
      player: { id: p.id, name: p.name, jersey: p.jersey, class_year: p.class_year, positions: p.positions, photo: p.photo, team: p.team ? (p.team === p.lname ? p.team : `${p.lname} ${p.team}`) : null, height: h, weight: w },
      gpa: r.gpa ?? null, film_url: r.film_url || null, contact_email: r.contact_email || null, contact_phone: r.contact_phone || null, bio: r.bio || null,
      status: r.status, approved_by: approver ? `${approver.name}${approver.title ? `, ${approver.title}` : ''}` : null, approved_at: r.approved_at || null, updated_at: r.updated_at || null,
      tests: Object.values(tests), lifts, program, coach: coach ? { name: coach.name, email: coach.email, phone: coach.phone, title: coach.title } : null,
      senior: p.class_year === schoolYearEnd(), can_approve: canApprove(user), can_edit: canApprove(user) || can(user, 'roster.edit') || user.id === id,
    };
  }
  router.get('/api/fb/recruiting', ({ user }) => {
    staffOnly(user);
    const grad = schoolYearEnd();
    return jAll(db.all(`SELECT u.id, u.name, p.jersey, p.class_year, p.positions, r.status, r.gpa, r.film_url, r.updated_at FROM users u JOIN player_profiles p ON p.user_id=u.id LEFT JOIN fb_recruiting r ON r.player_id=u.id
      WHERE u.program_id=? AND u.role='player' AND u.active=1 AND p.archived=0 AND (p.class_year<=? OR r.player_id IS NOT NULL) ORDER BY p.class_year, u.name`, user.program_id, grad + 1), 'positions')
      .map((r) => ({ ...r, status: r.status || 'draft', senior: r.class_year === grad }));
  });
  router.get('/api/fb/recruiting/:id', ({ user, params }) => {
    const id = Number(params.id);
    need(canSee(user, id), 403, 'No access');
    return recruitProfile(user, id);
  });
  router.put('/api/fb/recruiting/:id', ({ user, params, body }) => {
    const id = Number(params.id);
    need(playerOf(user.program_id, id), 404, 'Player not found');
    need(user.id === id || canApprove(user) || can(user, 'roster.edit'), 403, 'Only the player and coaches edit this profile');
    const f = {};
    if (body.gpa !== undefined) { need(body.gpa === null || body.gpa === '' || (Number(body.gpa) >= 0 && Number(body.gpa) <= 5), 400, 'GPA is between 0 and 5'); f.gpa = body.gpa === '' || body.gpa === null ? null : Number(body.gpa); }
    if (body.film_url !== undefined) { need(!body.film_url || /^https?:\/\/\S+$/i.test(body.film_url), 400, 'Film link must start with http:// or https://'); f.film_url = body.film_url || null; }
    if (body.contact_email !== undefined) f.contact_email = body.contact_email ? String(body.contact_email).slice(0, 120) : null;
    if (body.contact_phone !== undefined) f.contact_phone = body.contact_phone ? String(body.contact_phone).slice(0, 40) : null;
    if (body.bio !== undefined) f.bio = body.bio ? String(body.bio).slice(0, 1200) : null;
    // Any change sends the profile back for coach approval before it can be exported.
    f.status = 'pending'; f.approved_by = null; f.approved_at = null; f.updated_at = nowLocal();
    if (!db.get('SELECT 1 FROM fb_recruiting WHERE player_id=?', id)) db.insert('fb_recruiting', { player_id: id });
    db.update('fb_recruiting', id, f, 'player_id');
    audit(user, 'update_recruiting', 'player', id, Object.keys(f));
    return recruitProfile(user, id);
  });
  router.post('/api/fb/recruiting/:id/approve', ({ user, params, body }) => {
    need(canApprove(user), 403, 'Only coaches approve recruiting profiles');
    const id = Number(params.id);
    need(playerOf(user.program_id, id), 404, 'Player not found');
    if (!db.get('SELECT 1 FROM fb_recruiting WHERE player_id=?', id)) db.insert('fb_recruiting', { player_id: id });
    const ok = body.approve !== false;
    db.update('fb_recruiting', id, { status: ok ? 'approved' : 'pending', approved_by: ok ? user.id : null, approved_at: ok ? nowLocal() : null }, 'player_id');
    audit(user, ok ? 'approve_recruiting' : 'unapprove_recruiting', 'player', id);
    return recruitProfile(user, id);
  });
}
