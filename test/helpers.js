// Shared test harness: a fresh in-memory app seeded with the demo program, listening on a random port.
import { createApp } from '../server/app.js';
import { seed } from '../server/seed.js';
import { nowLocal, today, addDays, addMinutes } from '../server/core.js';

export { nowLocal, today, addDays, addMinutes };

// Quiet hours default to 05:00-21:00, which would make player notifications depend on the wall clock.
// Tests start with quiet hours that never apply; comms tests switch them on explicitly.
export const NEVER_QUIET = { quiet_start: '00:00', quiet_end: '24:00' };
export const ALWAYS_QUIET = { quiet_start: '00:00', quiet_end: '00:00' };

// A second, unrelated program (PLT-8 isolation tests): head coach, coach, player with parent, an event, a play,
// a drill, a chat with a reported message, test/body-weight/goal/equipment records for the player.
export function addOtherProgram(t) {
  const { db } = t;
  const pid = db.insert('programs', { name: 'Other HS Football', school: 'Other HS', settings: JSON.stringify(NEVER_QUIET) });
  const level = db.insert('levels', { program_id: pid, name: 'Varsity' });
  const team = db.insert('teams', { level_id: level, name: 'Varsity' });
  const n = db.get('SELECT count(*) n FROM programs').n;
  const head = db.insert('users', { program_id: pid, name: 'Other Head', email: `head${n}@other.example`, role: 'head_coach' });
  const coach = db.insert('users', { program_id: pid, name: 'Other Coach', email: `coach${n}@other.example`, role: 'coach' });
  const player = db.insert('users', { program_id: pid, name: 'Other Player', email: `player${n}@other.example`, role: 'player' });
  db.insert('player_profiles', { user_id: player, team_id: team, jersey: 7, units: ['offense'], positions: ['QB'] });
  const parent = db.insert('users', { program_id: pid, name: 'Other Parent', email: `parent${n}@other.example`, role: 'parent' });
  db.insert('parent_links', { parent_id: parent, player_id: player, relation: 'parent' });
  const event = db.insert('events', { program_id: pid, type: 'practice', title: 'Other practice', start: `${addDays(today(), 1)}T15:30`, end: `${addDays(today(), 1)}T17:30`, audience: ['program'] });
  db.insert('attendance', { event_id: event, player_id: player, status: 'present', source: 'coach', confirmed: 1, by_user: coach });
  const play = db.insert('plays', { program_id: pid, name: 'Other play', data: { players: [], quiz: [{ q: 'Who?', options: ['a', 'b'], answer: 1 }] } });
  db.insert('play_views', { play_id: play, user_id: player, context: 'view' });
  db.insert('quiz_results', { play_id: play, player_id: player, score: 1, total: 1, answers: [1] });
  const drill = db.insert('drills', { program_id: pid, name: 'Other drill' });
  const chat = db.insert('chats', { program_id: pid, name: 'Other chat', audience: ['program'], created_by: coach });
  for (const u of [head, coach, player]) db.insert('chat_members', { chat_id: chat, user_id: u });
  const message = db.insert('messages', { chat_id: chat, user_id: coach, body: 'hello' });
  const report = db.insert('message_reports', { message_id: message, by_user: player, reason: 'test' });
  const test = db.insert('tests', { player_id: player, test_key: 'squat', value: 300, date: today() });
  db.insert('measurements', { player_id: player, kind: 'bodyweight', value: 180, date: today() });
  db.insert('dev_goals', { program_id: pid, player_id: player, title: 'Other goal' });
  const wtProgram = db.insert('wt_programs', { program_id: pid, name: 'Other lift', days: [] });
  const wtAssignment = db.insert('wt_assignments', { program_id: pid, wt_program_id: wtProgram, audience: ['program'], start_date: today() });
  const override = db.insert('wt_overrides', { assignment_id: wtAssignment, player_id: player, note: 'x' });
  const wtLog = db.insert('wt_logs', { player_id: player, exercise_id: 1, set_no: 1, reps: 5, weight: 100, date: today() });
  const eqType = db.insert('eq_types', { program_id: pid, name: 'Other jersey' });
  const eqItem = db.insert('eq_items', { type_id: eqType, qty: 1 });
  db.insert('eq_issues', { program_id: pid, item_id: eqItem, type_id: eqType, player_id: player, issued_at: today() });
  return { program_id: pid, team, head, coach, player, parent, event, play, drill, chat, message, report, test, override, wtLog };
}

export async function start() {
  const app = createApp({ dbFile: ':memory:', dev: true });
  seed(app.db);
  const { db } = app;
  const prog = db.get('SELECT id, settings FROM programs LIMIT 1');
  db.run('UPDATE programs SET settings=? WHERE id=?', JSON.stringify({ ...JSON.parse(prog.settings), ...NEVER_QUIET }), prog.id);
  // The demo season runs June-December of the current year while seeded activity is relative to today.
  // Widen it when the suite runs outside that window so date-scoped features still see the seeded data.
  const season = db.get('SELECT * FROM seasons WHERE active=1');
  db.run('UPDATE seasons SET start_date=?, end_date=? WHERE id=?', [season.start_date, addDays(today(), -60)].sort()[0], [season.end_date, addDays(today(), 30)].sort()[1], season.id);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  async function request(method, path, body, tok) {
    const headers = {};
    if (tok) headers.Authorization = `Bearer ${tok}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const type = res.headers.get('content-type') || '';
    const text = await res.text();
    let parsed = text;
    if (type.includes('application/json')) { try { parsed = JSON.parse(text); } catch { /* keep text */ } }
    return { status: res.status, body: parsed, headers: res.headers };
  }
  const client = (tok) => ({
    token: tok,
    get: (p) => request('GET', p, undefined, tok),
    post: (p, b = {}) => request('POST', p, b, tok),
    put: (p, b = {}) => request('PUT', p, b, tok),
    del: (p, b) => request('DELETE', p, b, tok),
  });

  // Resolve a user from an id, an email, or a staff title ("QB coach", "Athletic trainer").
  function user(ref) {
    if (typeof ref === 'number') return db.get('SELECT * FROM users WHERE id=?', ref);
    if (ref && typeof ref === 'object' && ref.id) return db.get('SELECT * FROM users WHERE id=?', ref.id);
    if (String(ref).includes('@')) return db.get('SELECT * FROM users WHERE email=?', ref);
    return db.get('SELECT * FROM users WHERE title=? ORDER BY id LIMIT 1', ref);
  }
  const tokens = new Map();
  async function as(ref) {
    const u = user(ref);
    if (!u) throw new Error(`No user for ${ref}`);
    if (!tokens.has(u.id)) {
      const r = await request('POST', '/api/auth/demo', { user_id: u.id });
      if (r.status !== 200) throw new Error(`demo sign-in failed for ${u.id}: ${r.status}`);
      tokens.set(u.id, r.body.token);
    }
    const c = client(tokens.get(u.id));
    c.user = u;
    c.id = u.id;
    return c;
  }

  // Handy lookups
  const teams = Object.fromEntries(db.all(`SELECT t.id, t.name, l.name lname FROM teams t JOIN levels l ON l.id=t.level_id`).map((t) => [t.name === t.lname ? t.name : `${t.lname} ${t.name}`, t.id]));
  const levels = Object.fromEntries(db.all('SELECT id, name FROM levels').map((l) => [l.name, l.id]));
  const players = (where = '1=1', ...args) => db.all(`SELECT u.*, p.team_id, p.jersey, p.units, p.positions FROM users u JOIN player_profiles p ON p.user_id=u.id
    WHERE u.role='player' AND u.active=1 AND p.archived=0 AND ${where} ORDER BY u.id`, ...args).map((r) => ({ ...r, units: JSON.parse(r.units), positions: JSON.parse(r.positions) }));
  const varsity = (where = '1=1', ...args) => players(`p.team_id=? AND ${where}`, teams.Varsity, ...args);
  const parentsOf = (pid) => db.all('SELECT parent_id FROM parent_links WHERE player_id=?', pid).map((r) => r.parent_id);
  const notifications = (uid, like = '%') => db.all('SELECT * FROM notifications WHERE user_id=? AND title LIKE ? ORDER BY id', uid, like);
  const setSettings = async (settings) => {
    const head = await as('coach@ridgeview.example');
    const r = await head.put('/api/program', { settings });
    if (r.status !== 200) throw new Error('settings update failed');
    return r.body.settings;
  };

  return {
    app, db, base, request, client, anon: client(null), as, user, teams, levels, players, varsity, parentsOf, notifications, setSettings,
    close: () => { app.server.closeAllConnections?.(); app.close(); },
  };
}
