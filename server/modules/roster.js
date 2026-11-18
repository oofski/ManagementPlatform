// Module 4: Players and teams — levels, teams, positions, player accounts and profiles,
// measurements, availability, roster import/export and depth charts.
import { fail, need, token, nowLocal, today } from '../core.js';
import { j, jAll } from '../db.js';
import { csv, csvResponse } from '../app.js';

export default function roster({ router, db, core }) {
  const { can, isStaff, isAdmin, audit, notify } = core;

  const levelOf = (pid, id) => db.get('SELECT * FROM levels WHERE id=? AND program_id=?', id, pid);
  const teamOf = (pid, id) => db.get('SELECT t.* FROM teams t JOIN levels l ON l.id=t.level_id WHERE t.id=? AND l.program_id=?', id, pid);
  const playerOf = (pid, id) => db.get(`SELECT u.*, p.* FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.id=? AND u.program_id=? AND u.role='player'`, id, pid);

  // Can this viewer see this player's profile? Staff yes; player self; parent of player.
  const canSeePlayer = (u, id) => isStaff(u) || core.linkedPlayers(u).includes(id);
  // PLR-12 / SEC-1: sensitive fields only for coaches/trainers/admins (and the player and parents for body data).
  const sensitiveFor = (u) => isAdmin(u) || u.role === 'coach' || u.role === 'trainer';

  function latest(playerId, kind) {
    return db.get('SELECT value, date FROM measurements WHERE player_id=? AND kind=? ORDER BY date DESC, id DESC LIMIT 1', playerId, kind);
  }

  function shapePlayer(r, viewer, { full = false } = {}) {
    j(r, 'units', 'positions', 'personal');
    const team = r.team_id ? db.get('SELECT t.id, t.name, l.id level_id, l.name level_name FROM teams t JOIN levels l ON l.id=t.level_id WHERE t.id=?', r.team_id) : null;
    const out = {
      id: r.user_id || r.id, name: r.name, jersey: r.jersey, class_year: r.class_year, photo: r.photo,
      team_id: r.team_id, team: team ? (team.name === team.level_name ? team.name : `${team.level_name} ${team.name}`) : null, level_id: team?.level_id, level: team?.level_name,
      units: r.units, positions: r.positions, availability: r.availability, avail_note: null, return_date: r.return_date,
      archived: !!r.archived, joined: !!r.joined_at, pending_invite: !!r.invite_code,
    };
    const self = core.linkedPlayers(viewer).includes(out.id);
    if (isStaff(viewer) || self) {
      out.hand = r.hand;
      out.personal = r.personal;
      out.avail_note = isStaff(viewer) || self ? r.avail_note : null;
    }
    if (sensitiveFor(viewer) || (self && full)) {
      const h = latest(out.id, 'height'); const w = latest(out.id, 'weight');
      out.height = h?.value ?? null; out.weight = w?.value ?? null;
    }
    if (isAdmin(viewer) || (isStaff(viewer) && viewer.role !== 'staff')) {
      out.email = r.email; out.nutrition_opt_out = !!r.nutrition_opt_out;
    }
    if (full && isStaff(viewer)) {
      out.parents = db.all('SELECT u.id, u.name, u.invite_code IS NOT NULL pending, l.relation FROM parent_links l JOIN users u ON u.id=l.parent_id WHERE l.player_id=?', out.id);
    }
    return out;
  }

  // ---------- structure: levels, teams, positions ----------
  router.get('/api/structure', ({ user }) => {
    const levels = db.all('SELECT * FROM levels WHERE program_id=? ORDER BY sort, id', user.program_id);
    for (const l of levels) l.teams = db.all('SELECT * FROM teams WHERE level_id=? ORDER BY name', l.id);
    const positions = db.all('SELECT * FROM positions WHERE program_id=? ORDER BY unit, id', user.program_id);
    return { levels, positions };
  });
  router.post('/api/levels', ({ user, body }) => {
    need(isAdmin(user), 403, 'Head coach only');
    need(body.name, 400, 'Name is required');
    const id = db.insert('levels', { program_id: user.program_id, name: body.name, sort: body.sort ?? 99 });
    audit(user, 'create_level', 'level', id, body);
    return { id };
  });
  router.put('/api/levels/:id', ({ user, params, body }) => {
    need(isAdmin(user), 403, 'Head coach only');
    need(levelOf(user.program_id, Number(params.id)), 404, 'Level not found');
    db.update('levels', Number(params.id), { ...(body.name && { name: body.name }), ...(body.sort !== undefined && { sort: body.sort }) });
    return { ok: true };
  });
  router.del('/api/levels/:id', ({ user, params }) => {
    need(isAdmin(user), 403, 'Head coach only');
    const id = Number(params.id);
    need(levelOf(user.program_id, id), 404, 'Level not found');
    need(!db.get('SELECT 1 FROM player_profiles p JOIN teams t ON t.id=p.team_id WHERE t.level_id=?', id), 400, 'Move players off this level first');
    db.run('DELETE FROM levels WHERE id=?', id);
    return { ok: true };
  });
  router.post('/api/teams', ({ user, body }) => {
    need(can(user, 'roster.edit'), 403, 'Coaches only');
    need(body.name && levelOf(user.program_id, Number(body.level_id)), 400, 'Name and level are required');
    const id = db.insert('teams', { level_id: Number(body.level_id), name: body.name });
    audit(user, 'create_team', 'team', id, body);
    return { id };
  });
  router.put('/api/teams/:id', ({ user, params, body }) => {
    need(can(user, 'roster.edit'), 403, 'Coaches only');
    need(teamOf(user.program_id, Number(params.id)), 404, 'Team not found');
    db.update('teams', Number(params.id), { ...(body.name && { name: body.name }) });
    return { ok: true };
  });
  router.del('/api/teams/:id', ({ user, params }) => {
    need(can(user, 'roster.edit'), 403, 'Coaches only');
    const id = Number(params.id);
    need(teamOf(user.program_id, id), 404, 'Team not found');
    need(!db.get('SELECT 1 FROM player_profiles WHERE team_id=?', id), 400, 'Move players off this team first');
    db.run('DELETE FROM teams WHERE id=?', id);
    return { ok: true };
  });
  router.post('/api/positions', ({ user, body }) => {
    need(isAdmin(user), 403, 'Head coach only');
    need(body.code && ['offense', 'defense', 'special'].includes(body.unit), 400, 'Code and unit are required');
    const id = db.insert('positions', { program_id: user.program_id, unit: body.unit, code: body.code.toUpperCase(), name: body.name || body.code });
    return { id };
  });
  router.del('/api/positions/:id', ({ user, params }) => {
    need(isAdmin(user), 403, 'Head coach only');
    db.run('DELETE FROM positions WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    return { ok: true };
  });

  // ---------- players ----------
  router.get('/api/players', ({ user, query }) => {
    let rows = db.all(`SELECT u.id, u.name, u.email, u.invite_code, u.joined_at, p.* FROM users u JOIN player_profiles p ON p.user_id=u.id
      WHERE u.program_id=? AND u.role='player' AND u.active=1 ${query.archived ? '' : 'AND p.archived=0'} ORDER BY u.name`, user.program_id);
    if (!isStaff(user)) {
      // Players and parents see teammates' public cards only (name, number, team, positions).
      return rows.map((r) => shapePlayer(r, user)).map(({ id, name, jersey, class_year, photo, team, units, positions, level }) => ({ id, name, jersey, class_year, photo, team, units, positions, level }));
    }
    let out = rows.map((r) => shapePlayer(r, user));
    if (query.level_id) out = out.filter((p) => p.level_id === Number(query.level_id));
    if (query.team_id) out = out.filter((p) => p.team_id === Number(query.team_id));
    if (query.unit) out = out.filter((p) => p.units.includes(query.unit));
    if (query.position) out = out.filter((p) => p.positions.includes(query.position));
    if (query.availability) out = out.filter((p) => p.availability === query.availability);
    return out;
  });
  router.get('/api/players/export.csv', ({ user }) => {
    need(isStaff(user), 403, 'Staff only');
    const rows = db.all(`SELECT u.id, u.name, u.email, p.* FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.program_id=? AND u.role='player' AND u.active=1 AND p.archived=0 ORDER BY u.name`, user.program_id).map((r) => shapePlayer(r, user));
    audit(user, 'export', 'roster', null);
    return csvResponse('roster.csv', csv(rows, [
      { label: 'Name', key: 'name' }, { label: 'Jersey', key: 'jersey' }, { label: 'Class', key: 'class_year' }, { label: 'Team', key: 'team' },
      { label: 'Units', get: (r) => r.units.join(' ') }, { label: 'Positions', get: (r) => r.positions.join(' ') },
      { label: 'Height (in)', key: 'height' }, { label: 'Weight (lb)', key: 'weight' }, { label: 'Hand', key: 'hand' },
      { label: 'Availability', key: 'availability' }, { label: 'Email', key: 'email' },
    ]));
  });
  router.get('/api/players/:id', ({ user, params }) => {
    const id = Number(params.id);
    need(canSeePlayer(user, id) || !isStaff(user), 403, 'No access');
    const r = db.get(`SELECT u.id, u.name, u.email, u.invite_code, u.joined_at, p.* FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.id=? AND u.program_id=?`, id, user.program_id);
    need(r, 404, 'Player not found');
    if (!canSeePlayer(user, id)) {
      const s = shapePlayer(r, user);
      return { id: s.id, name: s.name, jersey: s.jersey, class_year: s.class_year, photo: s.photo, team: s.team, units: s.units, positions: s.positions };
    }
    const out = shapePlayer(r, user, { full: true });
    if (sensitiveFor(user) || core.linkedPlayers(user).includes(id)) {
      out.measurements = db.all(`SELECT * FROM measurements WHERE player_id=? AND kind IN ('height','weight') ORDER BY date`, id);
    }
    if (isStaff(user)) audit(user, 'view', 'player', id);
    return out;
  });
  function upsertPlayer(user, b, existingId) {
    const fields = {};
    if (b.team_id !== undefined) { need(b.team_id === null || teamOf(user.program_id, Number(b.team_id)), 400, 'Unknown team'); fields.team_id = b.team_id ? Number(b.team_id) : null; }
    for (const k of ['class_year', 'hand']) if (b[k] !== undefined) fields[k] = b[k];
    if (b.jersey !== undefined) fields.jersey = b.jersey === '' || b.jersey === null ? null : Number(b.jersey);
    if (b.units) { need(b.units.every((x) => ['offense', 'defense', 'special'].includes(x)), 400, 'Unknown unit'); fields.units = b.units; }
    if (b.positions) fields.positions = b.positions.map((x) => String(x).toUpperCase());
    if (existingId) {
      if (Object.keys(fields).length) db.update('player_profiles', existingId, fields, 'user_id');
      if (b.name) db.update('users', existingId, { name: b.name });
      if (b.email !== undefined) db.update('users', existingId, { email: b.email || null });
      return existingId;
    }
    need(b.name, 400, 'Name is required');
    if (b.email) need(!db.get('SELECT 1 FROM users WHERE lower(email)=lower(?)', b.email), 400, `Email ${b.email} already has an account`);
    const code = token(12);
    const id = db.insert('users', { program_id: user.program_id, name: b.name, email: b.email || null, role: 'player', invite_code: code, invited_by: user.id, cal_token: token(16) });
    db.insert('player_profiles', { user_id: id, units: fields.units || [], positions: fields.positions || [], ...fields });
    if (b.email) db.insert('outbox', { user_id: id, to_email: b.email, subject: 'Your team app invite', body: `Accept your invite: /invite/${code}`, deliver_at: nowLocal() });
    return id;
  }
  function measure(user, id, b) {
    for (const kind of ['height', 'weight']) {
      if (b[kind] !== undefined && b[kind] !== null && b[kind] !== '') {
        const v = Number(b[kind]);
        const prev = latest(id, kind);
        if (!prev || prev.value !== v) db.insert('measurements', { player_id: id, kind, value: v, date: b.measured_on || today(), by_user: user.id, season_id: core.currentSeason(user.program_id)?.id });
      }
    }
  }
  const jerseyWarning = (id, teamId, jersey) => {
    if (jersey == null || !teamId) return null;
    const dup = db.get(`SELECT u.name FROM player_profiles p JOIN users u ON u.id=p.user_id WHERE p.team_id=? AND p.jersey=? AND p.user_id!=? AND p.archived=0 AND u.active=1`, teamId, jersey, id);
    return dup ? `Jersey #${jersey} is also worn by ${dup.name} on this team` : null;
  };
  router.post('/api/players', ({ user, body }) => {
    need(can(user, 'roster.edit'), 403, 'Coaches only');
    const id = upsertPlayer(user, body);
    measure(user, id, body);
    audit(user, 'create_player', 'player', id);
    const p = db.get('SELECT team_id, jersey FROM player_profiles WHERE user_id=?', id);
    return { id, warning: jerseyWarning(id, p.team_id, p.jersey), invite_code: db.get('SELECT invite_code FROM users WHERE id=?', id).invite_code };
  });
  router.post('/api/players/import', ({ user, body }) => {
    need(can(user, 'roster.edit'), 403, 'Coaches only');
    const rows = body.rows || [];
    need(rows.length && rows.length <= 500, 400, 'Provide between 1 and 500 rows');
    const teams = db.all('SELECT t.id, t.name, l.name lname FROM teams t JOIN levels l ON l.id=t.level_id WHERE l.program_id=?', user.program_id);
    const findTeam = (s) => {
      if (!s) return null;
      const x = String(s).toLowerCase().trim();
      return teams.find((t) => `${t.lname} ${t.name}`.toLowerCase() === x || t.lname.toLowerCase() === x || t.name.toLowerCase() === x)?.id ?? null;
    };
    const results = { created: 0, errors: [] };
    db.tx(() => {
      rows.forEach((r, i) => {
        try {
          const units = String(r.units || '').toLowerCase().split(/[ ,;/]+/).filter(Boolean).map((u) => (u.startsWith('spec') || u === 'st' ? 'special' : u.startsWith('off') ? 'offense' : u.startsWith('def') ? 'defense' : u)).filter((u) => ['offense', 'defense', 'special'].includes(u));
          const positions = String(r.positions || '').split(/[ ,;/]+/).filter(Boolean);
          const id = upsertPlayer(user, { name: r.name, email: r.email || null, jersey: r.jersey || null, class_year: r.class_year ? Number(r.class_year) : null, hand: r.hand || null, team_id: findTeam(r.team), units, positions });
          measure(user, id, { height: r.height, weight: r.weight });
          results.created++;
        } catch (e) { results.errors.push({ row: i + 1, error: e.message }); }
      });
      if (results.errors.length && body.all_or_nothing) throw new Error('rollback');
    });
    audit(user, 'import_roster', 'roster', null, { created: results.created, errors: results.errors.length });
    return results;
  });
  router.put('/api/players/:id', ({ user, params, body }) => {
    const id = Number(params.id);
    const p = playerOf(user.program_id, id);
    need(p, 404, 'Player not found');
    const self = user.id === id;
    if (can(user, 'roster.edit')) {
      upsertPlayer(user, body, id);
      measure(user, id, body);
      if (body.remove_photo) db.update('player_profiles', id, { photo: null }, 'user_id');
    } else if (self) {
      // Players edit only their photo and a short set of personal fields (PLR-6).
      const allowed = {};
      if (body.photo !== undefined) {
        need(!body.photo || (String(body.photo).startsWith('data:image/') && body.photo.length < 1_500_000), 400, 'Photo must be an image under 1 MB');
        allowed.photo = body.photo || null;
      }
      if (body.personal) {
        const keep = ['nickname', 'hometown', 'favorite_player', 'goals', 'pronouns', 'walkup_song'];
        allowed.personal = Object.fromEntries(Object.entries(body.personal).filter(([k]) => keep.includes(k)).map(([k, v]) => [k, String(v).slice(0, 200)]));
      }
      need(Object.keys(allowed).length, 403, 'Those fields are set by coaches');
      db.update('player_profiles', id, allowed, 'user_id');
    } else fail(403, 'Coaches only');
    if (can(user, 'roster.edit') && body.photo !== undefined) db.update('player_profiles', id, { photo: body.photo || null }, 'user_id');
    audit(user, 'update_player', 'player', id, Object.keys(body));
    const np = db.get('SELECT team_id, jersey FROM player_profiles WHERE user_id=?', id);
    return { ok: true, warning: jerseyWarning(id, np.team_id, np.jersey) };
  });
  router.put('/api/players/:id/availability', ({ user, params, body }) => {
    need(can(user, 'availability.edit'), 403, 'Only trainers and coaches set availability');
    const id = Number(params.id);
    need(playerOf(user.program_id, id), 404, 'Player not found');
    need(['available', 'limited', 'out'].includes(body.availability), 400, 'Status must be available, limited or out');
    db.update('player_profiles', id, { availability: body.availability, avail_note: body.note || null, return_date: body.return_date || null, avail_updated_by: user.id, avail_updated_at: nowLocal() }, 'user_id');
    audit(user, 'set_availability', 'player', id, { availability: body.availability, return_date: body.return_date });
    const name = db.get('SELECT name FROM users WHERE id=?', id).name;
    const staff = db.all(`SELECT id FROM users WHERE program_id=? AND role IN ('head_coach','coach','trainer') AND active=1 AND id!=?`, user.program_id, user.id).map((r) => r.id);
    notify(user.program_id, staff, { kind: 'update', title: `${name}: ${body.availability}`, body: body.return_date ? `Expected back ${body.return_date}` : '', link: `/players/${id}`, from: 'system', email: false });
    return { ok: true };
  });
  router.post('/api/players/:id/archive', ({ user, params, body }) => {
    need(isAdmin(user), 403, 'Head coach only');
    const id = Number(params.id);
    need(playerOf(user.program_id, id), 404, 'Player not found');
    db.update('player_profiles', id, { archived: body.archived === false ? 0 : 1 }, 'user_id');
    if (body.archived !== false) {
      // Access ends when a player leaves the roster (PLAY-7, SEC-9).
      db.run('DELETE FROM sessions WHERE user_id=?', id);
      db.run('DELETE FROM group_members WHERE user_id=?', id);
      db.run('DELETE FROM chat_members WHERE user_id=?', id);
    }
    audit(user, body.archived === false ? 'restore_player' : 'archive_player', 'player', id);
    return { ok: true };
  });
  router.del('/api/players/:id', ({ user, params }) => {
    need(isAdmin(user), 403, 'Head coach only');
    const id = Number(params.id);
    need(playerOf(user.program_id, id), 404, 'Player not found');
    db.tx(() => {
      for (const t of ['eq_issues', 'helmet_fits']) db.run(`DELETE FROM ${t} WHERE player_id=?`, id);
      for (const t of ['assignment_status', 'form_responses', 'meal_logs', 'hydration_logs', 'wt_overrides']) db.run(`DELETE FROM ${t} WHERE player_id=?`, id);
      db.run('DELETE FROM practice_notes WHERE player_id=?', id);
      db.run('UPDATE messages SET body=NULL, attachment=NULL WHERE user_id=?', id);
      db.run('DELETE FROM users WHERE id=?', id);
    });
    audit(user, 'delete_player_data', 'player', id);
    return { ok: true };
  });
  // Season rollover (PLR-13): move players up a level, archive graduates.
  router.post('/api/players/rollover', ({ user, body }) => {
    need(isAdmin(user), 403, 'Head coach only');
    const moves = body.moves || []; // [{player_id, team_id}]
    const grad = Number(body.graduating_class || 0);
    let moved = 0; let archived = 0;
    db.tx(() => {
      for (const m of moves) { if (playerOf(user.program_id, m.player_id) && teamOf(user.program_id, m.team_id)) { db.update('player_profiles', m.player_id, { team_id: m.team_id }, 'user_id'); moved++; } }
      if (grad) {
        const r = db.run(`UPDATE player_profiles SET archived=1 WHERE class_year<=? AND user_id IN (SELECT id FROM users WHERE program_id=?)`, grad, user.program_id);
        archived = Number(r.changes);
      }
    });
    audit(user, 'season_rollover', 'roster', null, { moved, archived });
    return { moved, archived };
  });
  router.post('/api/players/:id/invite', ({ user, params }) => {
    need(can(user, 'roster.edit'), 403, 'Coaches only');
    const u = db.get(`SELECT * FROM users WHERE id=? AND program_id=? AND role='player'`, Number(params.id), user.program_id);
    need(u, 404, 'Player not found');
    need(!u.joined_at, 400, 'This player already joined');
    const code = u.invite_code || token(12);
    db.update('users', u.id, { invite_code: code });
    if (u.email) db.insert('outbox', { user_id: u.id, to_email: u.email, subject: 'Your team app invite', body: `Accept your invite: /invite/${code}`, deliver_at: nowLocal() });
    return { invite_code: code };
  });
  router.post('/api/players/:id/opt-out', ({ user, params, body }) => {
    const id = Number(params.id);
    need(core.linkedPlayers(user).includes(id) || isAdmin(user), 403, 'Only the player or a parent can opt out');
    db.update('player_profiles', id, { nutrition_opt_out: body.opt_out ? 1 : 0 }, 'user_id');
    audit(user, 'nutrition_opt_out', 'player', id, { opt_out: !!body.opt_out });
    return { ok: true };
  });

  // ---------- depth charts ----------
  const SLOTS = {
    offense: [['LT', 30, 62], ['LG', 40, 62], ['C', 50, 62], ['RG', 60, 62], ['RT', 70, 62], ['TE', 81, 62], ['WR-X', 8, 60], ['WR-Z', 92, 66], ['WR-S', 20, 70], ['QB', 50, 76], ['RB', 50, 90]],
    defense: [['DE-L', 30, 40], ['DT-L', 43, 40], ['DT-R', 57, 40], ['DE-R', 70, 40], ['WLB', 32, 28], ['MLB', 50, 26], ['SLB', 68, 28], ['CB-L', 8, 30], ['CB-R', 92, 30], ['FS', 40, 10], ['SS', 62, 12]],
    special: [['K', 50, 80], ['P', 50, 92], ['LS', 50, 62], ['H', 44, 78], ['KR', 40, 12], ['PR', 60, 12], ['GUN-L', 8, 60], ['GUN-R', 92, 60]],
  };
  router.get('/api/depth/layouts', () => SLOTS);
  const chartVisible = (u, c) => isStaff(u) || (c.visible_to_players && core.linkedPlayers(u).some((pid) => db.get('SELECT 1 FROM player_profiles WHERE user_id=? AND team_id=?', pid, c.team_id)));
  router.get('/api/depth', ({ user, query }) => {
    const where = ['program_id=?']; const args = [user.program_id];
    if (query.team_id) { where.push('team_id=?'); args.push(Number(query.team_id)); }
    if (query.unit) { where.push('unit=?'); args.push(query.unit); }
    return jAll(db.all(`SELECT id, team_id, unit, week_label, visible_to_players, updated_at, created_at, slots FROM depth_charts WHERE ${where.join(' AND ')} ORDER BY id DESC`, ...args), 'slots')
      .filter((c) => chartVisible(user, c));
  });
  router.get('/api/depth/:id', ({ user, params }) => {
    const c = j(db.get('SELECT * FROM depth_charts WHERE id=? AND program_id=?', Number(params.id), user.program_id), 'slots');
    need(c && chartVisible(user, c), 404, 'Depth chart not found');
    const ids = [...new Set(Object.values(c.slots).flat())];
    const show = sensitiveFor(user);
    const cards = {};
    for (const id of ids) {
      const r = db.get(`SELECT u.id, u.name, p.jersey, p.class_year, p.photo, p.availability FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.id=?`, id);
      if (!r) continue;
      if (show) {
        r.height = latest(id, 'height')?.value ?? null; r.weight = latest(id, 'weight')?.value ?? null;
        r.avg_rating = db.get('SELECT round(avg(value),1) v FROM ratings WHERE player_id=?', id).v;
      } else delete r.availability;
      cards[id] = r;
    }
    return { ...c, cards, layout: SLOTS[c.unit] };
  });
  router.post('/api/depth', ({ user, body }) => {
    need(can(user, 'depth.edit'), 403, 'Coaches only');
    need(teamOf(user.program_id, Number(body.team_id)) && SLOTS[body.unit] && body.week_label, 400, 'Team, unit and week are required');
    let slots = Object.fromEntries(SLOTS[body.unit].map(([k]) => [k, []]));
    if (body.copy_from) {
      const src = j(db.get('SELECT slots FROM depth_charts WHERE id=? AND program_id=?', Number(body.copy_from), user.program_id), 'slots');
      need(src, 404, 'Source chart not found');
      slots = src.slots;
    }
    const id = db.insert('depth_charts', { program_id: user.program_id, team_id: Number(body.team_id), unit: body.unit, week_label: body.week_label, season_id: core.currentSeason(user.program_id)?.id, slots, visible_to_players: body.visible_to_players ? 1 : 0, updated_by: user.id });
    audit(user, 'create_depth_chart', 'depth_chart', id, { copy_from: body.copy_from });
    return { id };
  });
  router.put('/api/depth/:id', ({ user, params, body }) => {
    need(can(user, 'depth.edit'), 403, 'Coaches only');
    const id = Number(params.id);
    const c = j(db.get('SELECT * FROM depth_charts WHERE id=? AND program_id=?', id, user.program_id), 'slots');
    need(c, 404, 'Depth chart not found');
    const upd = { updated_by: user.id, updated_at: nowLocal() };
    if (body.slots) {
      for (const [k, v] of Object.entries(body.slots)) need(Array.isArray(v) && v.every(Number.isInteger), 400, `Bad slot ${k}`);
      upd.slots = body.slots;
      // Record moves for the development timeline (SEA-3).
      const moves = [];
      for (const [slot, list] of Object.entries(body.slots)) {
        list.forEach((pid, idx) => {
          const before = (c.slots[slot] || []).indexOf(pid);
          if (before !== idx) moves.push({ player_id: pid, slot, from: before === -1 ? null : before + 1, to: idx + 1 });
        });
      }
      for (const [slot, list] of Object.entries(c.slots)) for (const pid of list) if (!(body.slots[slot] || []).includes(pid)) moves.push({ player_id: pid, slot, from: list.indexOf(pid) + 1, to: null });
      for (const m of moves) audit(user, 'depth_move', 'player', m.player_id, { chart: id, week: c.week_label, unit: c.unit, slot: m.slot, from: m.from, to: m.to });
    }
    if (body.week_label) upd.week_label = body.week_label;
    if (body.visible_to_players !== undefined) upd.visible_to_players = body.visible_to_players ? 1 : 0;
    db.update('depth_charts', id, upd);
    return { ok: true };
  });
  router.del('/api/depth/:id', ({ user, params }) => {
    need(can(user, 'depth.edit'), 403, 'Coaches only');
    db.run('DELETE FROM depth_charts WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    return { ok: true };
  });
}
