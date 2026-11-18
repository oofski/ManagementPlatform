// Accounts, sign-in (with two-step for staff), invites, program settings, staff roles, groups,
// notifications, email outbox and the audit log.
import { fail, need, hashPassword, checkPassword, token, nowLocal, DEFAULT_SETTINGS } from '../core.js';
import { j, jAll } from '../db.js';

export const CAPS = ['admin', 'staff', 'calendar.edit', 'roster.edit', 'availability.edit', 'practice.edit', 'ratings.view', 'ratings.edit',
  'playbook.view', 'playbook.edit', 'playbook.export', 'depth.edit', 'equipment.manage', 'equipment.view', 'weights.edit',
  'nutrition.approve', 'body.view', 'chats.read_all', 'audit.view', 'messages.send', 'assignments.edit', 'season.view',
  'eligibility.edit', 'heat.log'];

export default function auth(ctx) {
  const { router, db, core, dev } = ctx;
  const { can, isStaff, isAdmin, audit, notify } = core;
  const setCookie = (res, sid) => {
    res.headers['Set-Cookie'] = `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
  };
  const newSession = (u, verified) => {
    const sid = token();
    const code = verified ? null : String(Math.floor(100000 + Math.random() * 900000));
    db.insert('sessions', { id: sid, user_id: u.id, verified: verified ? 1 : 0, code });
    if (code) {
      db.insert('outbox', { user_id: u.id, to_email: u.email, subject: 'Your sign-in code', body: `Your verification code is ${code}`, deliver_at: nowLocal() });
    }
    return sid;
  };
  const needsTwoFa = (u) => isStaff(u) && (core.settings(u.program_id).staff_twofa || u.twofa);

  router.post('/api/auth/login', ({ body, res }) => {
    // C-4: athletes without a personal email sign in with the username they chose at /join.
    const login = String(body.email || body.username || '').trim();
    const u = db.get('SELECT * FROM users WHERE (lower(email)=lower(?) OR lower(username)=lower(?)) AND active=1', login, login);
    if (!u || !checkPassword(body.password || '', u.password_hash)) fail(401, 'Email or password is incorrect');
    // Access ends when a player leaves the roster (SEC-9): archived players cannot sign back in.
    if (u.role === 'player' && db.get('SELECT archived FROM player_profiles WHERE user_id=?', u.id)?.archived) fail(401, 'This account is no longer on the roster');
    const two = needsTwoFa(u);
    const sid = newSession(u, !two);
    setCookie(res, sid);
    audit(u, 'sign_in', 'user', u.id, { twofa: two });
    return { ok: true, twofa: two, token: sid };
  }, { auth: false });

  // Wrong two-step codes per session; after MAX_CODE_TRIES the session is thrown away (no brute forcing 6 digits).
  const MAX_CODE_TRIES = 5;
  const codeFailures = new Map();
  router.post('/api/auth/verify', ({ user, body, sid }) => {
    const s = user._session;
    if (!(s.code && String(body.code).trim() === s.code)) {
      const n = (codeFailures.get(sid) || 0) + 1;
      if (n >= MAX_CODE_TRIES) {
        codeFailures.delete(sid);
        db.run('DELETE FROM sessions WHERE id=?', sid);
        audit(user, 'twofa_lockout', 'user', user.id);
        fail(401, 'Too many incorrect codes. Sign in again to get a new code.');
      }
      codeFailures.set(sid, n);
      fail(400, 'That code is not correct');
    }
    codeFailures.delete(sid);
    db.run('UPDATE sessions SET verified=1, code=NULL WHERE id=?', sid);
    return { ok: true };
  }, { unverified: true });

  // School sign-in (Google, Clever) lives in server/google/sso.js; it signs people in through this helper so the
  // same rules apply as for a password sign-in (archived players are refused, staff two-step still applies).
  ctx.auth = {
    signIn(u, res, method) {
      if (u.role === 'player' && db.get('SELECT archived FROM player_profiles WHERE user_id=?', u.id)?.archived) fail(401, 'This account is no longer on the roster');
      const two = needsTwoFa(u);
      const sid = newSession(u, !two);
      if (res) setCookie(res, sid);
      audit(u, 'sign_in', 'user', u.id, { twofa: two, method });
      return { ok: true, twofa: two, token: sid };
    },
  };

  // Demo sign-in (development only): pick any seeded account.
  router.get('/api/auth/demo-users', () => {
    if (!dev) fail(404, 'Not found');
    return db.all(`SELECT id, name, role, title, staff_kind FROM users WHERE active=1 ORDER BY
      CASE role WHEN 'head_coach' THEN 0 WHEN 'coach' THEN 1 WHEN 'trainer' THEN 2 WHEN 'staff' THEN 3 WHEN 'player' THEN 4 ELSE 5 END, name LIMIT 400`);
  }, { auth: false });
  router.post('/api/auth/demo', ({ body, res }) => {
    if (!dev) fail(404, 'Not found');
    const u = db.get('SELECT * FROM users WHERE id=? AND active=1', body.user_id);
    need(u, 404, 'No such user');
    const sid = newSession(u, true);
    setCookie(res, sid);
    return { ok: true, token: sid };
  }, { auth: false });

  router.post('/api/auth/logout', ({ sid, res }) => {
    db.run('DELETE FROM sessions WHERE id=?', sid);
    res.headers['Set-Cookie'] = 'sid=; Path=/; Max-Age=0';
    return { ok: true };
  }, { unverified: true });

  // Invites
  router.get('/api/invite/:code', ({ params }) => {
    const u = db.get('SELECT id, name, email, role, program_id FROM users WHERE invite_code=?', params.code);
    need(u, 404, 'This invite is not valid or was already used');
    const p = db.get('SELECT name, school FROM programs WHERE id=?', u.program_id);
    return { name: u.name, email: u.email, role: u.role, program: p };
  }, { auth: false });
  router.post('/api/invite/:code/accept', ({ params, body, res }) => {
    const u = db.get('SELECT * FROM users WHERE invite_code=?', params.code);
    need(u, 404, 'This invite is not valid or was already used');
    need((body.password || '').length >= 8, 400, 'Password must be at least 8 characters');
    db.update('users', u.id, { password_hash: hashPassword(body.password), invite_code: null, joined_at: nowLocal(), name: body.name || u.name });
    const fresh = db.get('SELECT * FROM users WHERE id=?', u.id);
    const sid = newSession(fresh, !needsTwoFa(fresh));
    setCookie(res, sid);
    audit(fresh, 'accept_invite', 'user', u.id);
    return { ok: true, twofa: needsTwoFa(fresh), token: sid };
  }, { auth: false });

  router.get('/api/me', ({ user }) => {
    const program = db.get('SELECT id, name, school, state FROM programs WHERE id=?', user.program_id);
    const caps = Object.fromEntries(CAPS.map((c) => [c, can(user, c)]));
    const linked = core.linkedPlayers(user).map((id) => db.get(`SELECT u.id, u.name, p.jersey, p.team_id FROM users u LEFT JOIN player_profiles p ON p.user_id=u.id WHERE u.id=?`, id));
    const parents = user.role === 'player'
      ? db.all('SELECT u.id, u.name, u.email, u.invite_code IS NOT NULL pending FROM parent_links l JOIN users u ON u.id=l.parent_id WHERE l.player_id=?', user.id) : [];
    const unread = db.get(`SELECT count(*) n FROM notifications WHERE user_id=? AND opened_at IS NULL AND (deliver_at IS NULL OR deliver_at<=?)`, user.id, nowLocal()).n;
    const s = core.settings(user.program_id);
    return {
      user: core.publicUser(user), program, caps, linked, parents, unread,
      scopes: core.staffScopes(user.id), season: core.currentSeason(user.program_id),
      settings: {
        players_see_ratings: s.players_see_ratings, players_see_trends: s.players_see_trends, leaderboard: s.leaderboard,
        game_mode: s.game_mode, rating_scale: s.rating_scale, quiet_start: s.quiet_start, quiet_end: s.quiet_end, chat_files: s.chat_files,
        family_sees_bodyweight: !!s.family_sees_bodyweight,
      },
    };
  });
  router.put('/api/me', ({ user, body }) => {
    const upd = {};
    if (body.notify_email !== undefined) upd.notify_email = body.notify_email ? 1 : 0;
    if (body.phone !== undefined) upd.phone = body.phone;
    if (body.password) { need(body.password.length >= 8, 400, 'Password must be at least 8 characters'); upd.password_hash = hashPassword(body.password); }
    db.update('users', user.id, upd);
    return { ok: true };
  });

  // Player invites 1 or 2 parents/guardians.
  router.post('/api/me/parents', ({ user, body }) => {
    need(user.role === 'player', 403, 'Only players invite parents');
    const count = db.get('SELECT count(*) n FROM parent_links WHERE player_id=?', user.id).n;
    need(count < 2, 400, 'A player can connect at most 2 parents or guardians');
    need(body.name && body.email, 400, 'Name and email are required');
    let p = db.get('SELECT * FROM users WHERE lower(email)=lower(?)', body.email);
    if (p) need(p.role === 'parent' && p.program_id === user.program_id, 400, 'That email belongs to another account');
    const code = token(12);
    const id = p ? p.id : db.insert('users', { program_id: user.program_id, name: body.name, email: body.email, role: 'parent', invite_code: code, invited_by: user.id, cal_token: token(16) });
    db.run('INSERT OR IGNORE INTO parent_links (parent_id, player_id, relation) VALUES (?,?,?)', id, user.id, body.relation || 'Parent');
    if (!p) db.insert('outbox', { user_id: id, to_email: body.email, subject: `${user.name} invited you to the team app`, body: `Accept your invite: /invite/${code}`, deliver_at: nowLocal() });
    audit(user, 'invite_parent', 'user', id);
    return { ok: true, id, invite_code: p ? null : code };
  });
  router.del('/api/me/parents/:id', ({ user, params }) => {
    need(user.role === 'player', 403, 'Only players manage parents');
    db.run('DELETE FROM parent_links WHERE player_id=? AND parent_id=?', user.id, Number(params.id));
    return { ok: true };
  });

  // Program settings (head coach)
  router.get('/api/program', ({ user }) => {
    need(isStaff(user), 403, 'Staff only');
    const p = db.get('SELECT * FROM programs WHERE id=?', user.program_id);
    return { ...p, settings: core.settings(user.program_id), defaults: DEFAULT_SETTINGS };
  });
  router.put('/api/program', ({ user, body }) => {
    need(isAdmin(user), 403, 'Only the head coach can change program settings');
    const cur = core.settings(user.program_id);
    const next = { ...cur };
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (body.settings && body.settings[k] !== undefined) next[k] = body.settings[k];
    db.run('UPDATE programs SET name=coalesce(?,name), school=coalesce(?,school), state=coalesce(?,state), settings=? WHERE id=?',
      body.name ?? null, body.school ?? null, body.state ?? null, JSON.stringify(next), user.program_id);
    audit(user, 'update_settings', 'program', user.program_id, body.settings);
    return { ok: true, settings: next };
  });

  // Staff management (head coach)
  const staffRow = (r) => ({ ...core.publicUser(j(r, 'perms')), perms: r.perms, scopes: core.staffScopes(r.id), pending: !!r.invite_code });
  router.get('/api/staff', ({ user }) => {
    need(isStaff(user) || user.role === 'player' || user.role === 'parent', 403, 'No access');
    const rows = db.all(`SELECT * FROM users WHERE program_id=? AND role IN ('head_coach','coach','trainer','staff') AND active=1 ORDER BY role='head_coach' DESC, name`, user.program_id);
    if (!isStaff(user)) return rows.map((r) => ({ id: r.id, name: r.name, role: r.role, title: r.title }));
    return rows.map(staffRow).map((r) => (isAdmin(user) ? r : { ...r, email: undefined, phone: undefined }));
  });
  router.post('/api/staff', ({ user, body }) => {
    need(isAdmin(user), 403, 'Only the head coach manages staff');
    need(body.name && body.email, 400, 'Name and email are required');
    need(['coach', 'trainer', 'staff', 'head_coach'].includes(body.role), 400, 'Unknown role');
    need(!db.get('SELECT id FROM users WHERE lower(email)=lower(?)', body.email), 400, 'That email already has an account');
    const code = token(12);
    const id = db.insert('users', {
      program_id: user.program_id, name: body.name, email: body.email, role: body.role, title: body.title || null,
      staff_kind: body.staff_kind || null, is_admin: body.is_admin ? 1 : 0, invite_code: code, invited_by: user.id, cal_token: token(16), perms: body.perms || {},
    });
    for (const s of body.scopes || []) db.run('INSERT OR IGNORE INTO staff_scopes VALUES (?,?)', id, s);
    db.insert('outbox', { user_id: id, to_email: body.email, subject: 'You were invited to the coaching staff', body: `Accept your invite: /invite/${code}`, deliver_at: nowLocal() });
    audit(user, 'invite_staff', 'user', id, { role: body.role });
    return { id, invite_code: code };
  });
  router.put('/api/staff/:id', ({ user, params, body }) => {
    need(isAdmin(user), 403, 'Only the head coach manages staff');
    const id = Number(params.id);
    const t = db.get('SELECT * FROM users WHERE id=? AND program_id=?', id, user.program_id);
    need(t && isStaff(t), 404, 'Staff member not found');
    const upd = {};
    for (const k of ['name', 'title', 'staff_kind', 'phone']) if (body[k] !== undefined) upd[k] = body[k];
    if (body.role) { need(['coach', 'trainer', 'staff', 'head_coach'].includes(body.role), 400, 'Unknown role'); upd.role = body.role; }
    if (body.is_admin !== undefined) upd.is_admin = body.is_admin ? 1 : 0;
    if (body.perms) upd.perms = body.perms;
    db.update('users', id, upd);
    if (body.scopes) {
      db.run('DELETE FROM staff_scopes WHERE user_id=?', id);
      for (const s of body.scopes) db.run('INSERT OR IGNORE INTO staff_scopes VALUES (?,?)', id, s);
    }
    audit(user, 'update_staff', 'user', id, body);
    return { ok: true };
  });
  router.del('/api/staff/:id', ({ user, params }) => {
    need(isAdmin(user), 403, 'Only the head coach manages staff');
    need(Number(params.id) !== user.id, 400, 'You cannot remove yourself');
    db.run(`UPDATE users SET active=0 WHERE id=? AND program_id=? AND role!='player' AND role!='parent'`, Number(params.id), user.program_id);
    db.run('DELETE FROM sessions WHERE user_id=?', Number(params.id));
    audit(user, 'remove_staff', 'user', Number(params.id));
    return { ok: true };
  });

  // Custom groups (e.g. captains)
  router.get('/api/groups', ({ user }) => {
    const gs = db.all('SELECT * FROM custom_groups WHERE program_id=? ORDER BY name', user.program_id);
    return gs.map((g) => ({ ...g, members: db.all('SELECT u.id, u.name FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=?', g.id) }));
  });
  router.post('/api/groups', ({ user, body }) => {
    need(can(user, 'roster.edit'), 403, 'Coaches only');
    need(body.name, 400, 'Name is required');
    const id = db.insert('custom_groups', { program_id: user.program_id, name: body.name });
    for (const m of body.members || []) if (db.get('SELECT 1 FROM users WHERE id=? AND program_id=? AND active=1', Number(m), user.program_id)) db.run('INSERT OR IGNORE INTO group_members VALUES (?,?)', id, Number(m));
    audit(user, 'create_group', 'group', id);
    return { id };
  });
  router.put('/api/groups/:id', ({ user, params, body }) => {
    need(can(user, 'roster.edit'), 403, 'Coaches only');
    const id = Number(params.id);
    need(db.get('SELECT id FROM custom_groups WHERE id=? AND program_id=?', id, user.program_id), 404, 'Group not found');
    if (body.name) db.run('UPDATE custom_groups SET name=? WHERE id=?', body.name, id);
    if (body.members) {
      db.run('DELETE FROM group_members WHERE group_id=?', id);
      for (const m of body.members) if (db.get('SELECT 1 FROM users WHERE id=? AND program_id=? AND active=1', Number(m), user.program_id)) db.run('INSERT OR IGNORE INTO group_members VALUES (?,?)', id, Number(m));
    }
    return { ok: true };
  });
  router.del('/api/groups/:id', ({ user, params }) => {
    need(can(user, 'roster.edit'), 403, 'Coaches only');
    db.run('DELETE FROM custom_groups WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    return { ok: true };
  });

  // Audience picker options shared by calendar, plays, chats, assignments, weights.
  router.get('/api/audiences', ({ user }) => {
    const pid = user.program_id;
    const out = [{ token: 'program', label: 'Whole program', kind: 'Program' }, { token: 'coaches', label: 'Coaches only', kind: 'Program' }, { token: 'parents', label: 'All parents', kind: 'Program' }];
    for (const l of db.all('SELECT * FROM levels WHERE program_id=? ORDER BY sort', pid)) {
      out.push({ token: `level:${l.id}`, label: l.name, kind: 'Level' });
      for (const t of db.all('SELECT * FROM teams WHERE level_id=? ORDER BY name', l.id)) out.push({ token: `team:${t.id}`, label: t.name === l.name ? `${t.name} (team)` : `${l.name} ${t.name}`, kind: 'Team' });
    }
    for (const u of [['offense', 'Offense'], ['defense', 'Defense'], ['special', 'Special teams']]) out.push({ token: `unit:${u[0]}`, label: u[1], kind: 'Unit' });
    for (const p of db.all('SELECT DISTINCT code, unit FROM positions WHERE program_id=? ORDER BY unit, code', pid)) out.push({ token: `pos:${p.code}`, label: `${p.code} group`, kind: 'Position group' });
    for (const g of db.all('SELECT * FROM custom_groups WHERE program_id=? ORDER BY name', pid)) out.push({ token: `group:${g.id}`, label: g.name, kind: 'Custom group' });
    if (isStaff(user)) {
      for (const p of db.all(`SELECT u.id, u.name, pp.jersey FROM users u JOIN player_profiles pp ON pp.user_id=u.id WHERE u.program_id=? AND u.role='player' AND u.active=1 AND pp.archived=0 ORDER BY u.name`, pid)) {
        out.push({ token: `player:${p.id}`, label: `${p.name}${p.jersey != null ? ' #' + p.jersey : ''}`, kind: 'Player' });
      }
    }
    return out;
  });
  router.post('/api/audiences/resolve', ({ user, body }) => {
    need(isStaff(user), 403, 'Staff only');
    const players = core.resolvePlayers(user.program_id, body.audience || []);
    const recipients = core.resolveRecipients(user.program_id, body.audience || []);
    return { players: players.length, recipients: recipients.length, labels: core.describeAudience(user.program_id, body.audience || []) };
  });

  // Notifications (push channel shown in-app) and acknowledgments
  router.get('/api/notifications', ({ user, query }) => {
    const rows = db.all(`SELECT * FROM notifications WHERE user_id=? AND (deliver_at IS NULL OR deliver_at<=?) ORDER BY id DESC LIMIT ?`, user.id, nowLocal(), Number(query.limit || 50));
    return rows;
  });
  router.post('/api/notifications/:id/open', ({ user, params }) => {
    db.run(`UPDATE notifications SET opened_at=coalesce(opened_at, ?) WHERE id=? AND user_id=?`, nowLocal(), Number(params.id), user.id);
    return { ok: true };
  });
  router.post('/api/notifications/open-all', ({ user }) => {
    db.run(`UPDATE notifications SET opened_at=? WHERE user_id=? AND opened_at IS NULL AND (deliver_at IS NULL OR deliver_at<=?)`, nowLocal(), user.id, nowLocal());
    return { ok: true };
  });
  router.post('/api/notifications/test', ({ user }) => {
    notify(user.program_id, [user.id], { kind: 'update', title: 'Test notification', body: 'Notifications are working.', from: 'system' });
    return { ok: true };
  });

  // Email outbox (simulated email delivery, visible to admins)
  router.get('/api/outbox', ({ user, query }) => {
    need(isAdmin(user) || dev, 403, 'Admins only');
    const scope = isAdmin(user) ? 'u.program_id=?' : 'o.user_id=?';
    return db.all(`SELECT o.* FROM outbox o LEFT JOIN users u ON u.id=o.user_id WHERE ${scope} ${query.email ? 'AND o.to_email=?' : ''} ORDER BY o.id DESC LIMIT 200`,
      isAdmin(user) ? user.program_id : user.id, ...(query.email ? [query.email] : []));
  });

  // Audit log (SEC-2)
  router.get('/api/audit', ({ user, query }) => {
    need(isAdmin(user) || can(user, 'audit.view'), 403, 'Only admins and the athletic director can review the audit log');
    const where = ['a.program_id=?'];
    const args = [user.program_id];
    if (query.entity) { where.push('a.entity=?'); args.push(query.entity); }
    if (query.entity_id) { where.push('a.entity_id=?'); args.push(Number(query.entity_id)); }
    if (query.action) { where.push('a.action LIKE ?'); args.push(`%${query.action}%`); }
    return jAll(db.all(`SELECT a.*, u.name user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ?`, ...args, Number(query.limit || 300)), 'detail');
  });

  // Sync conflicts flagged by offline replays (PLT-2)
  router.get('/api/conflicts', ({ user }) => {
    need(isStaff(user), 403, 'Staff only');
    return jAll(db.all(`SELECT c.*, u.name user_name FROM sync_conflicts c LEFT JOIN users u ON u.id=c.client_user WHERE c.program_id=? AND c.resolved=0 ORDER BY c.id DESC`, user.program_id), 'server_value', 'client_value');
  });
  router.post('/api/conflicts/:id/resolve', ({ user, params, body }) => {
    need(isStaff(user), 403, 'Staff only');
    const c = j(db.get('SELECT * FROM sync_conflicts WHERE id=? AND program_id=?', Number(params.id), user.program_id), 'client_value', 'server_value');
    need(c, 404, 'Not found');
    if (body.keep === 'client' && c.entity === 'attendance') {
      const [eventId, playerId] = c.entity_key.split(':').map(Number);
      db.run('UPDATE attendance SET status=?, reason=?, by_user=?, at=? WHERE event_id=? AND player_id=?', c.client_value.status, c.client_value.reason || null, user.id, nowLocal(), eventId, playerId);
    }
    db.run('UPDATE sync_conflicts SET resolved=1 WHERE id=?', c.id);
    audit(user, 'resolve_conflict', c.entity, c.id, { keep: body.keep });
    return { ok: true };
  });
}
