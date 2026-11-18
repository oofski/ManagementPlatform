// Playbook v2 (docs/requirements-v2-playbook.md): playbook positions (PS-1..PS-3), custom routes (RT-1..RT-3),
// per-user playbook preferences (PL-6 Defensive Coordinator Mode, recently used routes for the Route Menu) and the
// Playcaller play call log (PC-4). Registered from playbook.js.
import { need, nowLocal } from '../core.js';
import { j, jAll } from '../db.js';

export const SITUATION = {
  play_type: ['Run', 'Pass', 'Play-action', 'Screen', 'RPO', 'Option', 'Draw', 'Trick', 'Base', 'Blitz', 'Coverage', 'Man', 'Zone', 'Stunt', 'Prevent', 'Kick', 'Return'],
  distance: ['Short', 'Medium', 'Long'],
  down_distance: ['1st & 10', '2nd & Short', '2nd & Medium', '2nd & Long', '3rd & Short', '3rd & Medium', '3rd & Long', '4th & Short', '4th & Medium', '4th & Long', 'Goal line', 'Red zone', '2-minute'],
};
// PL-4: tags are checkbox values; unknown values are dropped so grouping and Playcaller navigation stay clean.
export function cleanSituation(s) {
  const out = {};
  for (const [k, allowed] of Object.entries(SITUATION)) {
    const v = Array.isArray(s?.[k]) ? s[k] : [];
    out[k] = [...new Set(v.map(String))].filter((x) => allowed.includes(x));
  }
  return out;
}

export const COLORS = ['default', 'blue', 'red', 'green', 'orange', 'purple', 'yellow'];
// The default positions every program starts with. `mirror` names the opposite-side position (Smart Flip, PD-15).
const DEFAULTS = [
  ['O', 'Quarterback', 'QB', 'QB', 'default'], ['O', 'Center', 'C', 'C', 'default', { is_center: 1, lineman: 1 }],
  ['O', 'Left guard', 'LG', 'LG', 'default', { lineman: 1, mirror: 'Right guard' }], ['O', 'Right guard', 'RG', 'RG', 'default', { lineman: 1, mirror: 'Left guard' }],
  ['O', 'Left tackle', 'LT', 'LT', 'default', { lineman: 1, mirror: 'Right tackle' }], ['O', 'Right tackle', 'RT', 'RT', 'default', { lineman: 1, mirror: 'Left tackle' }],
  ['O', 'Running back', 'RB', 'RB', 'default'], ['O', 'Fullback', 'F', 'FB', 'default'], ['O', 'Tight end', 'Y', 'TE', 'orange'],
  ['O', 'Split end', 'X', 'X', 'red'], ['O', 'Flanker', 'Z', 'Z', 'blue'], ['O', 'Slot', 'H', 'H', 'green'],
  ['D', 'Left end', 'E', 'LE', 'default', { lineman: 1, mirror: 'Right end' }], ['D', 'Right end', 'E', 'RE', 'default', { lineman: 1, mirror: 'Left end' }],
  ['D', 'Left tackle (DL)', 'T', 'LDT', 'default', { lineman: 1, mirror: 'Right tackle (DL)' }], ['D', 'Right tackle (DL)', 'N', 'RDT', 'default', { lineman: 1, mirror: 'Left tackle (DL)' }],
  ['D', 'Will linebacker', 'W', 'WLB', 'default'], ['D', 'Mike linebacker', 'M', 'MLB', 'default'], ['D', 'Sam linebacker', 'S', 'SLB', 'default'],
  ['D', 'Cornerback', 'C', 'CB', 'purple'], ['D', 'Free safety', 'FS', 'FS', 'yellow'], ['D', 'Strong safety', 'SS', 'SS', 'yellow'], ['D', 'Nickel', 'N', 'NB', 'purple'],
];
export function ensurePositions(db, pid) {
  if (db.get('SELECT 1 FROM pb_positions WHERE program_id=? LIMIT 1', pid)) return;
  const ids = {};
  DEFAULTS.forEach(([side, name, letter, abbr, color, x = {}], i) => {
    ids[name] = db.insert('pb_positions', { program_id: pid, side, name, letter, abbr, color, sort: i, is_center: x.is_center || 0, lineman: x.lineman || 0 });
  });
  for (const [, name, , , , x = {}] of DEFAULTS) if (x.mirror) db.run('UPDATE pb_positions SET mirror_id=? WHERE id=?', ids[x.mirror], ids[name]);
}

export default function playbookV2(ctx, { requireEdit }) {
  const { router, db, core } = ctx;
  const { can, isStaff, audit } = core;
  const staffView = (u) => need(isStaff(u) && can(u, 'playbook.view'), 403, 'No playbook access');

  // ---------- positions (PS-1..PS-3) ----------
  const posRow = (r) => ({ ...r, is_center: !!r.is_center, lineman: !!r.lineman });
  router.get('/api/pb/positions', ({ user }) => {
    // Players need positions to draw the plays shared with them; parents never see the playbook.
    need(user.role === 'player' || (isStaff(user) && can(user, 'playbook.view')), 403, 'No playbook access');
    ensurePositions(db, user.program_id);
    return db.all('SELECT * FROM pb_positions WHERE program_id=? ORDER BY side DESC, sort, id', user.program_id).map(posRow);
  });
  function posFields(user, b, creating) {
    const f = {};
    if (creating || b.name !== undefined) { need(String(b.name || '').trim(), 400, 'Name is required'); f.name = String(b.name).trim().slice(0, 40); }
    if (b.letter !== undefined) { need(String(b.letter || '').length <= 3, 400, 'Letter is up to three characters'); f.letter = String(b.letter || '').trim(); }
    if (b.abbr !== undefined) { need(String(b.abbr || '').length <= 4, 400, 'Abbreviation is up to four characters'); f.abbr = String(b.abbr || '').trim(); }
    if (b.color !== undefined) { need(COLORS.includes(b.color), 400, 'Unknown color'); f.color = b.color; }
    if (creating || b.side !== undefined) f.side = b.side === 'D' ? 'D' : 'O';
    if (b.is_center !== undefined) f.is_center = b.is_center ? 1 : 0;
    if (b.lineman !== undefined) f.lineman = b.lineman ? 1 : 0;
    if (b.mirror_id !== undefined) {
      if (b.mirror_id) need(db.get('SELECT 1 FROM pb_positions WHERE id=? AND program_id=?', Number(b.mirror_id), user.program_id), 400, 'Unknown mirror position');
      f.mirror_id = b.mirror_id ? Number(b.mirror_id) : null;
    }
    return f;
  }
  router.post('/api/pb/positions', ({ user, body }) => {
    requireEdit(user);
    ensurePositions(db, user.program_id);
    const f = posFields(user, body, true);
    const sort = (db.get('SELECT max(sort) m FROM pb_positions WHERE program_id=?', user.program_id).m || 0) + 1;
    const id = db.insert('pb_positions', { program_id: user.program_id, color: 'default', ...f, sort });
    audit(user, 'create', 'pb_position', id);
    return { id };
  });
  router.put('/api/pb/positions/:id', ({ user, params, body }) => {
    requireEdit(user);
    const p = db.get('SELECT * FROM pb_positions WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    need(p, 404, 'Position not found');
    db.update('pb_positions', p.id, posFields(user, body, false));
    audit(user, 'edit', 'pb_position', p.id);
    return { ok: true };
  });
  router.del('/api/pb/positions/:id', ({ user, params }) => {
    requireEdit(user);
    const p = db.get('SELECT * FROM pb_positions WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    need(p, 404, 'Position not found');
    db.run('UPDATE pb_positions SET mirror_id=NULL WHERE mirror_id=? AND program_id=?', p.id, user.program_id);
    db.run('DELETE FROM pb_positions WHERE id=?', p.id);
    audit(user, 'delete', 'pb_position', p.id);
    return { ok: true };
  });

  // ---------- custom routes (RT-1..RT-3) ----------
  const isPt = (p) => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every((n) => Number.isFinite(Number(n)));
  function routeFields(b, creating) {
    const f = {};
    if (creating || b.name !== undefined) { need(String(b.name || '').trim(), 400, 'Name is required'); f.name = String(b.name).trim().slice(0, 60); }
    if (b.side !== undefined || creating) f.side = b.side === 'D' ? 'D' : 'O';
    if (b.grp !== undefined) f.grp = String(b.grp || 'Custom').trim().slice(0, 40) || 'Custom';
    if (b.smart !== undefined) f.smart = b.smart ? 1 : 0;
    if (b.data !== undefined || creating) {
      const d = b.data || {};
      need(Array.isArray(d.points) && d.points.length && d.points.every(isPt), 400, 'Draw the route first');
      need((d.opts || []).every((o) => Array.isArray(o.points) && o.points.every(isPt)), 400, 'Bad optional route');
      f.data = { points: d.points, type: d.type || 'route', opts: d.opts || [] };
    }
    return f;
  }
  const routeOf = (pid, id) => j(db.get('SELECT * FROM pb_routes WHERE id=? AND program_id=?', Number(id), pid), 'data');
  const routeRow = (r) => ({ ...r, smart: !!r.smart });
  router.get('/api/pb/routes', ({ user }) => {
    staffView(user);
    return jAll(db.all('SELECT * FROM pb_routes WHERE program_id=? ORDER BY grp, name', user.program_id), 'data').map(routeRow);
  });
  router.get('/api/pb/routes/:id', ({ user, params }) => {
    staffView(user);
    const r = routeOf(user.program_id, params.id);
    need(r, 404, 'Route not found');
    return routeRow(r);
  });
  router.post('/api/pb/routes', ({ user, body }) => {
    requireEdit(user);
    const id = db.insert('pb_routes', { program_id: user.program_id, smart: 1, grp: 'Custom', ...routeFields(body, true), created_by: user.id, updated_at: nowLocal() });
    audit(user, 'create', 'pb_route', id);
    return { id };
  });
  router.put('/api/pb/routes/:id', ({ user, params, body }) => {
    requireEdit(user);
    const r = routeOf(user.program_id, params.id);
    need(r, 404, 'Route not found');
    db.update('pb_routes', r.id, { ...routeFields(body, false), updated_at: nowLocal() });
    return { ok: true };
  });
  router.post('/api/pb/routes/:id/duplicate', ({ user, params }) => {
    requireEdit(user);
    const r = routeOf(user.program_id, params.id);
    need(r, 404, 'Route not found');
    const id = db.insert('pb_routes', { program_id: user.program_id, name: `${r.name} (Copy)`, side: r.side, grp: r.grp, data: r.data, smart: r.smart, created_by: user.id, updated_at: nowLocal() });
    return { id };
  });
  router.del('/api/pb/routes/:id', ({ user, params }) => {
    requireEdit(user);
    need(routeOf(user.program_id, params.id), 404, 'Route not found');
    db.run('DELETE FROM pb_routes WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    return { ok: true };
  });

  // ---------- per-user preferences (PL-6, PD-10 recently used) ----------
  const prefsOf = (uid) => {
    const r = j(db.get('SELECT * FROM pb_prefs WHERE user_id=?', uid), 'recent_routes');
    return { dc_mode: !!r?.dc_mode, recent_routes: r?.recent_routes || [] };
  };
  router.get('/api/pb/prefs', ({ user }) => { staffView(user); return prefsOf(user.id); });
  router.put('/api/pb/prefs', ({ user, body }) => {
    staffView(user);
    const cur = prefsOf(user.id);
    if (body.dc_mode !== undefined) cur.dc_mode = !!body.dc_mode;
    if (body.recent_route) cur.recent_routes = [String(body.recent_route).slice(0, 60), ...cur.recent_routes.filter((k) => k !== String(body.recent_route))].slice(0, 8);
    db.run('INSERT INTO pb_prefs (user_id, dc_mode, recent_routes) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET dc_mode=excluded.dc_mode, recent_routes=excluded.recent_routes',
      user.id, cur.dc_mode ? 1 : 0, JSON.stringify(cur.recent_routes));
    return cur;
  });

  // ---------- play call log (PC-4) ----------
  router.get('/api/pb/calls', ({ user, query }) => {
    staffView(user);
    const args = [user.program_id];
    let where = 'c.program_id=?';
    if (query.playbook_id) { where += ' AND c.playbook_id=?'; args.push(Number(query.playbook_id)); }
    if (query.play_id) { where += ' AND c.play_id=?'; args.push(Number(query.play_id)); }
    return db.all(`SELECT c.*, u.name by_name FROM pb_calls c LEFT JOIN users u ON u.id=c.by_user WHERE ${where} ORDER BY c.id DESC LIMIT ?`, ...args, Math.min(500, Number(query.limit) || 200));
  });
  router.post('/api/pb/calls', ({ user, body }) => {
    staffView(user);
    const play = db.get('SELECT id, name, playbook_id FROM plays WHERE id=? AND program_id=?', Number(body.play_id), user.program_id);
    need(play, 404, 'Play not found');
    const down = body.down ? Number(body.down) : null;
    need(down === null || [1, 2, 3, 4].includes(down), 400, 'Down is 1 to 4');
    const distance = body.distance === '' || body.distance == null ? null : Number(body.distance);
    need(distance === null || (Number.isFinite(distance) && distance >= 0 && distance <= 99), 400, 'Distance is 0 to 99 yards');
    const id = db.insert('pb_calls', {
      program_id: user.program_id, playbook_id: play.playbook_id, play_id: play.id, play_name: play.name, down, distance,
      yard_line: body.yard_line ? String(body.yard_line).slice(0, 20) : null, result: body.result ? String(body.result).slice(0, 120) : null,
      note: body.note ? String(body.note).slice(0, 300) : null, by_user: user.id, at: nowLocal(),
    });
    db.insert('play_views', { play_id: play.id, user_id: user.id, context: 'playcaller' });
    return { id };
  });
  router.del('/api/pb/calls/:id', ({ user, params }) => {
    staffView(user);
    const c = db.get('SELECT * FROM pb_calls WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    need(c, 404, 'Call not found');
    need(c.by_user === user.id || can(user, 'playbook.edit'), 403, 'Only the coach who logged it can remove this call');
    db.run('DELETE FROM pb_calls WHERE id=?', c.id);
    return { ok: true };
  });

  router.get('/api/pb/meta', ({ user }) => { staffView(user); return { situation: SITUATION, colors: COLORS }; });
}
