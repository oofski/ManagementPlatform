// Shared test harness: a fresh in-memory app seeded with the demo program, listening on a random port.
import { createApp } from '../server/app.js';
import { seed } from '../server/seed.js';
import { nowLocal, today, addDays, addMinutes } from '../server/core.js';

export { nowLocal, today, addDays, addMinutes };

// Quiet hours default to 05:00-21:00, which would make player notifications depend on the wall clock.
// Tests start with quiet hours that never apply; comms tests switch them on explicitly.
export const NEVER_QUIET = { quiet_start: '00:00', quiet_end: '24:00' };
export const ALWAYS_QUIET = { quiet_start: '00:00', quiet_end: '00:00' };

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
