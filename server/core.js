// Core services shared by every module: routing, auth, roles, audiences, audit and notifications.
import crypto from 'node:crypto';
import { j } from './db.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, msg) => { throw new HttpError(status, msg); };
export const need = (cond, status, msg) => { if (!cond) fail(status, msg); };

// ---------- time helpers (program-local wall clock, "YYYY-MM-DDTHH:MM") ----------
const pad = (n) => String(n).padStart(2, '0');
export function fmtLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const nowLocal = () => fmtLocal(new Date());
export const today = () => nowLocal().slice(0, 10);
export function parseLocal(s) {
  const [d, t = '00:00'] = s.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, hh || 0, mm || 0);
}
export const addMinutes = (s, min) => fmtLocal(new Date(parseLocal(s).getTime() + min * 60000));
export const addDays = (s, days) => {
  const d = parseLocal(s); d.setDate(d.getDate() + days);
  return s.length <= 10 ? fmtLocal(d).slice(0, 10) : fmtLocal(d);
};

// ---------- passwords ----------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
export function checkPassword(pw, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}
export const token = (n = 24) => crypto.randomBytes(n).toString('base64url');

// ---------- default program settings (head coach controls these) ----------
export const DEFAULT_SETTINGS = {
  quiet_start: '05:00', quiet_end: '21:00',
  reminder_defaults: [1440, 120],
  coach_playbook: 'edit',          // none | view | edit
  coach_export_plays: false,
  formation_limit: null,           // FM-3: saved formations per program: 25 | 250 | null (unlimited)
  trainer_playbook: false,
  trainer_ratings: false,
  staff_access: 'view',            // what "other staff" can see: view | none
  players_see_ratings: false,
  players_see_trends: false,
  leaderboard: false,
  game_mode: 'booth_halftime',     // sideline | booth_halftime | off  (set per state rules)
  absence_alert_threshold: 3,
  late_alert_threshold: 3,
  parent_absence_notice: false,
  chat_files: true,
  helmet_max_age_years: 10,
  helmet_recert_interval_years: 1,
  staff_twofa: true,
  retention_years: 3,
  rating_scale: 5,
  weekly_practice_limit_min: null, // CAL-15/PRAC-13: set from your state association's rules
  weekly_contact_limit_min: null,
  // Google integration: deliver the email outbox through this staff member's connected Gmail (null = simulated).
  gmail_send_user_id: null,
  gmail_send_after_id: null,       // only outbox rows queued after sending was turned on are delivered
  // F-11: heat acclimatization. Day 1 is the first practice of the acclimatization period. Data-driven per state.
  heat_start_date: null,
  heat_schedule: [
    { from: 1, to: 2, equipment: 'helmet', max_practices: 1, max_minutes: 180, contact: false, note: 'Helmets only, one practice a day, up to 3 hours' },
    { from: 3, to: 5, equipment: 'shells', max_practices: 1, max_minutes: 180, contact: false, note: 'Helmets and shoulder pads, one practice a day, up to 3 hours' },
    { from: 6, to: 14, equipment: 'full', max_practices: 2, max_minutes: 300, contact: true, note: 'Full pads; double sessions up to 5 hours total, not on consecutive days' },
  ],
  heat_limits: { heat_index: { caution: 95, stop: 104 }, wbgt: { caution: 82, stop: 92 } },
  // F-13: warn this many days before a physical expires.
  physical_warn_days: 30,
  // F-17: weekly parent digest by email (day 0 = Sunday).
  parent_digest: true,
  digest_day: 0,
  digest_time: '17:00',
  // v2 weight room: body weight stays coach-only unless the head coach opens it to players and parents (F-8);
  // leaderboard scopes hidden from players, as tokens like "team:3" or "group:OL" (C-16);
  // the scheduled weekly weight-room email (C-22, day 0 = Sunday).
  family_sees_bodyweight: false,
  leaderboard_hidden: [],
  weekly_report_enabled: false,
  weekly_report_weekday: 1,
  weekly_report_hour: 7,
  weekly_report_athlete: true,
  weekly_report_parent: true,
  weekly_report_ad: true,
  // CAL-5: standard game week. day = offset from Monday of game week.
  game_week_template: [
    { day: 0, type: 'film', title: 'Film: scout report', start: '15:15', end: '16:00', location: 'Film room' },
    { day: 0, type: 'practice', title: 'Practice: install day 1', start: '16:00', end: '18:00', location: 'Main field' },
    { day: 1, type: 'practice', title: 'Practice: install day 2', start: '15:30', end: '17:45', location: 'Main field' },
    { day: 2, type: 'practice', title: 'Practice: situations', start: '15:30', end: '17:30', location: 'Main field' },
    { day: 3, type: 'practice', title: 'Walkthrough', start: '15:30', end: '16:30', location: 'Main field' },
    { day: 3, type: 'meeting', title: 'Staff meeting: game plan', start: '17:00', end: '18:00', location: 'Coaches office' },
  ],
};

export function createCore(db) {
  const settings = (programId) => {
    const p = db.get('SELECT settings FROM programs WHERE id=?', programId);
    return { ...DEFAULT_SETTINGS, ...(p ? JSON.parse(p.settings || '{}') : {}) };
  };

  // ---------- roles and capabilities ----------
  const STAFF = ['head_coach', 'coach', 'trainer', 'staff'];
  const isStaff = (u) => STAFF.includes(u.role);
  const isAdmin = (u) => u.role === 'head_coach' || !!u.is_admin;
  const userPerms = (u) => (typeof u.perms === 'string' ? JSON.parse(u.perms || '{}') : u.perms || {});

  function can(u, cap) {
    if (!u) return false;
    const s = settings(u.program_id);
    const p = userPerms(u);
    if (isAdmin(u)) return true;
    switch (cap) {
      case 'admin': return false;
      case 'staff': return isStaff(u);
      case 'calendar.edit': return u.role === 'coach' || !!p.calendar_edit;
      case 'roster.edit': return u.role === 'coach' || !!p.roster_edit;
      case 'availability.edit': return u.role === 'coach' || u.role === 'trainer';
      case 'practice.edit': return u.role === 'coach' || !!p.practice_edit;
      case 'ratings.view': return u.role === 'coach' || (u.role === 'trainer' && (s.trainer_ratings || p.ratings)) || !!p.ratings;
      case 'ratings.edit': return u.role === 'coach';
      case 'playbook.view':
        if (u.role === 'coach') return s.coach_playbook !== 'none' || !!p.playbook;
        if (u.role === 'trainer') return !!(s.trainer_playbook || p.playbook);
        return !!p.playbook;
      case 'playbook.edit': return (u.role === 'coach' && s.coach_playbook === 'edit') || !!p.playbook_edit;
      case 'playbook.export': return (u.role === 'coach' && s.coach_export_plays) || !!p.playbook_export;
      case 'depth.edit': return u.role === 'coach';
      case 'equipment.manage': return !!p.equipment_manager;
      case 'equipment.view': return isStaff(u);
      case 'weights.edit': return u.role === 'coach' || u.role === 'trainer';
      case 'nutrition.approve': return u.role === 'trainer' || !!p.nutrition_pro;
      case 'body.view': return u.role === 'trainer' || !!p.body_data;
      case 'chats.read_all': return !!p.read_all_chats || u.staff_kind === 'athletic_director';
      case 'audit.view': return u.staff_kind === 'athletic_director' || !!p.audit;
      case 'messages.send': return u.role === 'coach' || u.role === 'trainer' || !!p.messages;
      case 'assignments.edit': return u.role === 'coach';
      case 'season.view': return u.role === 'coach' || u.role === 'trainer' || !!p.development;
      case 'eligibility.edit': return u.role === 'coach' || u.role === 'trainer' || !!p.eligibility || !!p.medical;
      case 'heat.log': return u.role === 'coach' || u.role === 'trainer' || !!p.medical;
      // Medical detail (concussion notes, stage sign-off) — trainers or staff given the medical permission.
      // Admins pass every can() check; football.js uses its own isMedical() so head coaches do not read medical notes.
      case 'medical': return u.role === 'trainer' || !!p.medical;
      default: return false;
    }
  }

  // ---------- audiences ----------
  // Tokens: program | level:ID | team:ID | unit:offense|defense|special | pos:CODE | group:ID | player:ID | user:ID | coaches | staff | parents
  function activePlayers(programId) {
    return db.all(`SELECT u.id, p.team_id, t.level_id, p.units, p.positions FROM users u
      JOIN player_profiles p ON p.user_id=u.id LEFT JOIN teams t ON t.id=p.team_id
      WHERE u.program_id=? AND u.role='player' AND u.active=1 AND p.archived=0`, programId)
      .map((r) => j(r, 'units', 'positions'));
  }
  function resolvePlayers(programId, audience) {
    const toks = Array.isArray(audience) ? audience : JSON.parse(audience || '[]');
    const players = activePlayers(programId);
    const out = new Set();
    const groupMembers = (gid) => new Set(db.all('SELECT user_id FROM group_members WHERE group_id=?', gid).map((r) => r.user_id));
    for (const t of toks) {
      const [k, v] = t.split(':');
      let match;
      if (k === 'program') match = () => true;
      else if (k === 'level') match = (p) => p.level_id === Number(v);
      else if (k === 'team') match = (p) => p.team_id === Number(v);
      else if (k === 'unit') match = (p) => p.units.includes(v);
      else if (k === 'pos') match = (p) => p.positions.includes(v);
      else if (k === 'player' || k === 'user') match = (p) => p.id === Number(v);
      else if (k === 'group') { const m = groupMembers(Number(v)); match = (p) => m.has(p.id); }
      else continue;
      for (const p of players) if (match(p)) out.add(p.id);
    }
    return [...out];
  }
  function staffScopes(userId) {
    return db.all('SELECT scope FROM staff_scopes WHERE user_id=?', userId).map((r) => r.scope);
  }
  // Does a staff member's scope cover an audience token?
  function scopeCovers(programId, scopes, tok) {
    if (scopes.includes(tok)) return true;
    const [k, v] = tok.split(':');
    if (k === 'team') {
      const t = db.get('SELECT level_id FROM teams WHERE id=?', Number(v));
      return t && scopes.includes(`level:${t.level_id}`);
    }
    if (k === 'pos') {
      const p = db.get('SELECT unit FROM positions WHERE program_id=? AND code=?', programId, v);
      return p && scopes.includes(`unit:${p.unit}`);
    }
    if (k === 'player' || k === 'user') {
      const pl = db.get(`SELECT p.team_id, t.level_id, p.units, p.positions FROM player_profiles p LEFT JOIN teams t ON t.id=p.team_id WHERE p.user_id=?`, Number(v));
      if (!pl) return false;
      j(pl, 'units', 'positions');
      return scopes.includes(`level:${pl.level_id}`) || scopes.includes(`team:${pl.team_id}`)
        || pl.units.some((x) => scopes.includes(`unit:${x}`)) || pl.positions.some((x) => scopes.includes(`pos:${x}`));
    }
    return false;
  }
  // Which users receive something sent to this audience (players, their parents, matching staff).
  function resolveRecipients(programId, audience, { parents = true, staff = true } = {}) {
    const toks = Array.isArray(audience) ? audience : JSON.parse(audience || '[]');
    const out = new Set(resolvePlayers(programId, toks));
    if (parents && out.size) {
      const ids = [...out];
      for (const r of db.all(`SELECT parent_id FROM parent_links WHERE player_id IN (${ids.map(() => '?').join(',')})`, ...ids)) out.add(r.parent_id);
    }
    for (const t of toks) {
      if (t.startsWith('user:')) out.add(Number(t.slice(5)));
    }
    if (toks.includes('parents')) {
      for (const r of db.all(`SELECT id FROM users WHERE program_id=? AND role='parent' AND active=1`, programId)) out.add(r.id);
    }
    if (staff) {
      const staffRows = db.all(`SELECT id, role, is_admin FROM users WHERE program_id=? AND role IN ('head_coach','coach','trainer','staff') AND active=1`, programId);
      for (const s of staffRows) {
        if (toks.includes('program') || toks.includes('coaches') || toks.includes('staff')) { out.add(s.id); continue; }
        if (s.role === 'head_coach' || s.is_admin) { out.add(s.id); continue; }
        const scopes = staffScopes(s.id);
        if (toks.some((t) => scopeCovers(programId, scopes, t))) out.add(s.id);
      }
    }
    return [...out];
  }
  // Players a user is connected to: self for player, children for parent.
  function linkedPlayers(u) {
    if (u.role === 'player') return [u.id];
    if (u.role === 'parent') return db.all('SELECT player_id FROM parent_links WHERE parent_id=?', u.id).map((r) => r.player_id);
    return [];
  }
  // Can the user see an item addressed to this audience?
  function inAudience(u, audience) {
    if (isAdmin(u)) return true;
    const toks = Array.isArray(audience) ? audience : JSON.parse(audience || '[]');
    if (isStaff(u)) {
      if (toks.some((t) => ['program', 'staff'].includes(t))) return true;
      // 'coaches' items (e.g. coaches-only meetings) are for coaches, not trainers or other staff.
      if (u.role === 'coach' && toks.includes('coaches')) return true;
      if (toks.includes(`user:${u.id}`)) return true;
      // Trainers and other staff view every non-staff-only event; coaches see events for groups they cover.
      if (u.role !== 'coach') return toks.some((t) => t !== 'coaches');
      const scopes = staffScopes(u.id);
      if (!scopes.length) return true;
      if (toks.some((t) => scopeCovers(u.program_id, scopes, t))) return true;
      // A position coach sees team events that include any of their players.
      const players = resolvePlayers(u.program_id, toks);
      return players.some((pid) => scopeCovers(u.program_id, scopes, `player:${pid}`));
    }
    if (toks.includes(`user:${u.id}`)) return true;
    if (u.role === 'parent' && toks.includes('parents')) return true;
    const mine = linkedPlayers(u);
    if (!mine.length) return false;
    const inside = new Set(resolvePlayers(u.program_id, toks));
    return mine.some((id) => inside.has(id));
  }
  // Can a non-admin coach manage something addressed to this audience? (CAL-8 "their own groups")
  function managesAudience(u, audience) {
    if (isAdmin(u)) return true;
    if (!isStaff(u)) return false;
    const toks = Array.isArray(audience) ? audience : JSON.parse(audience || '[]');
    const scopes = staffScopes(u.id);
    if (!toks.length) return false;
    // A custom group is only "theirs" when every member of it falls inside the coach's scopes.
    const groupCovered = (t) => {
      const gid = Number(t.slice(6));
      const g = db.get('SELECT id FROM custom_groups WHERE id=? AND program_id=?', gid, u.program_id);
      if (!g || !scopes.length) return false;
      return db.all('SELECT user_id FROM group_members WHERE group_id=?', gid)
        .every((m) => m.user_id === u.id || scopeCovers(u.program_id, scopes, `player:${m.user_id}`));
    };
    return toks.every((t) => t === `user:${u.id}` || t === 'coaches' || t === 'staff'
      || scopeCovers(u.program_id, scopes, t) || (t.startsWith('group:') && groupCovered(t)));
  }
  function describeAudience(programId, audience) {
    const toks = Array.isArray(audience) ? audience : JSON.parse(audience || '[]');
    return toks.map((t) => {
      const [k, v] = t.split(':');
      if (k === 'program') return 'Whole program';
      if (k === 'coaches') return 'Coaches only';
      if (k === 'staff') return 'All staff';
      if (k === 'parents') return 'Parents';
      if (k === 'unit') return { offense: 'Offense', defense: 'Defense', special: 'Special teams' }[v] || v;
      if (k === 'pos') return `${v} group`;
      if (k === 'level') return db.get('SELECT name FROM levels WHERE id=?', Number(v))?.name || 'Level';
      if (k === 'team') {
        const t = db.get('SELECT t.name, l.name lname FROM teams t JOIN levels l ON l.id=t.level_id WHERE t.id=?', Number(v));
        return t ? (t.name === t.lname ? t.name : `${t.lname} ${t.name}`) : 'Team';
      }
      if (k === 'group') return db.get('SELECT name FROM custom_groups WHERE id=?', Number(v))?.name || 'Group';
      if (k === 'player' || k === 'user') return db.get('SELECT name FROM users WHERE id=?', Number(v))?.name || 'Person';
      return t;
    });
  }

  // ---------- audit log (SEC-2, CAL-7) ----------
  function audit(u, action, entity, entityId, detail) {
    db.insert('audit', {
      program_id: u?.program_id ?? null, user_id: u?.id ?? null, action, entity, entity_id: entityId ?? null,
      detail: detail === undefined ? null : JSON.stringify(detail), at: nowLocal().replace('T', ' '),
    });
  }

  // ---------- quiet hours (COM-6) ----------
  function inQuietHours(programId, when = nowLocal()) {
    const s = settings(programId);
    const hm = when.slice(11, 16);
    return hm < s.quiet_start || hm >= s.quiet_end;
  }
  function nextDeliveryTime(programId, when = nowLocal()) {
    if (!inQuietHours(programId, when)) return when;
    const s = settings(programId);
    const hm = when.slice(11, 16);
    const day = hm >= s.quiet_end ? addDays(when.slice(0, 10), 1) : when.slice(0, 10);
    return `${day}T${s.quiet_start}`;
  }

  // ---------- notifications: push (in-app) + email outbox ----------
  // opts: { kind, title, body, link, ref, emergency, from }  — quiet hours apply to messages from staff to players/parents.
  function notify(programId, userIds, opts) {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (!ids.length) return 0;
    const now = nowLocal();
    const later = opts.emergency ? now : nextDeliveryTime(programId, now);
    const rows = db.all(`SELECT id, role, email, notify_email FROM users WHERE id IN (${ids.map(() => '?').join(',')}) AND active=1`, ...ids);
    db.tx(() => {
      for (const r of rows) {
        const quiet = (r.role === 'player' || r.role === 'parent') && opts.from !== 'system' ? later : now;
        const deliver = opts.emergency ? now : quiet;
        db.insert('notifications', {
          user_id: r.id, kind: opts.kind || 'update', title: opts.title, body: opts.body || '',
          link: opts.link || null, ref: opts.ref || null, created_at: now.replace('T', ' '), deliver_at: deliver,
        });
        if (r.email && r.notify_email && opts.email !== false) {
          db.insert('outbox', {
            user_id: r.id, to_email: r.email, subject: (opts.kind === 'urgent' ? '[URGENT] ' : '') + opts.title,
            body: opts.body || '', created_at: now.replace('T', ' '), deliver_at: deliver,
          });
        }
      }
    });
    return rows.length;
  }

  // ---------- sessions ----------
  function userFromSession(sid) {
    if (!sid) return null;
    const s = db.get('SELECT * FROM sessions WHERE id=?', sid);
    if (!s) return null;
    const u = db.get('SELECT * FROM users WHERE id=? AND active=1', s.user_id);
    if (!u) return null;
    if (u.role === 'player' && db.get('SELECT 1 FROM player_profiles WHERE user_id=? AND archived=1', u.id)) return null;
    u.perms = userPerms(u);
    u._session = s;
    return u;
  }

  function currentSeason(programId) {
    return db.get('SELECT * FROM seasons WHERE program_id=? AND active=1 ORDER BY id DESC LIMIT 1', programId)
      || db.get('SELECT * FROM seasons WHERE program_id=? ORDER BY id DESC LIMIT 1', programId);
  }

  function publicUser(u) {
    if (!u) return u;
    const { password_hash, invite_code, perms, _session, ...rest } = u;
    return rest;
  }

  return {
    db, settings, can, isStaff, isAdmin, resolvePlayers, resolveRecipients, linkedPlayers, inAudience, managesAudience,
    describeAudience, staffScopes, audit, notify, inQuietHours, nextDeliveryTime, userFromSession, currentSeason, publicUser,
  };
}

// ---------- tiny router ----------
export function createRouter() {
  const routes = [];
  const add = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler, opts });
  };
  const match = (method, path) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = path.match(r.re);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { route: r, params };
      }
    }
    return null;
  };
  return {
    get: (p, h, o) => add('GET', p, h, o), post: (p, h, o) => add('POST', p, h, o),
    put: (p, h, o) => add('PUT', p, h, o), del: (p, h, o) => add('DELETE', p, h, o),
    match, routes,
  };
}
