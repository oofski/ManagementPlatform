// SQLite data layer (Node's built-in node:sqlite). One file per database.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, school TEXT, state TEXT DEFAULT 'OTHER',
  settings TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL REFERENCES programs(id),
  name TEXT NOT NULL, start_date TEXT, end_date TEXT, phases TEXT DEFAULT '[]', goals TEXT DEFAULT '{}',
  active INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS levels (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL REFERENCES programs(id), name TEXT NOT NULL, sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY, level_id INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE, name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, unit TEXT NOT NULL, code TEXT NOT NULL, name TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL REFERENCES programs(id),
  name TEXT NOT NULL, email TEXT, phone TEXT, password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('head_coach','coach','trainer','staff','player','parent')),
  is_admin INTEGER DEFAULT 0, title TEXT, staff_kind TEXT, twofa INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1, invite_code TEXT, invited_by INTEGER, joined_at TEXT,
  cal_token TEXT, notify_email INTEGER DEFAULT 1, perms TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verified INTEGER DEFAULT 1, code TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS staff_scopes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, scope TEXT NOT NULL, PRIMARY KEY (user_id, scope)
);
CREATE TABLE IF NOT EXISTS player_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES teams(id), jersey INTEGER, class_year INTEGER, hand TEXT,
  photo TEXT, units TEXT DEFAULT '[]', positions TEXT DEFAULT '[]',
  personal TEXT DEFAULT '{}', availability TEXT DEFAULT 'available', avail_note TEXT, return_date TEXT,
  avail_updated_by INTEGER, avail_updated_at TEXT,
  nutrition_opt_out INTEGER DEFAULT 0, archived INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, value REAL NOT NULL, date TEXT NOT NULL, by_user INTEGER, season_id INTEGER
);
CREATE TABLE IF NOT EXISTS parent_links (
  parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, relation TEXT, PRIMARY KEY (parent_id, player_id)
);
CREATE TABLE IF NOT EXISTS custom_groups (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES custom_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, program_id INTEGER, at TEXT DEFAULT (datetime('now','localtime')), user_id INTEGER,
  action TEXT NOT NULL, entity TEXT, entity_id INTEGER, detail TEXT
);
CREATE INDEX IF NOT EXISTS audit_entity ON audit(entity, entity_id);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT, ref TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')), deliver_at TEXT, opened_at TEXT
);
CREATE INDEX IF NOT EXISTS notif_user ON notifications(user_id, opened_at);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, user_id INTEGER, to_email TEXT, subject TEXT, body TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')), deliver_at TEXT, sent_at TEXT
);

-- Module 1: Calendar
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, season_id INTEGER,
  type TEXT NOT NULL, title TEXT NOT NULL, start TEXT NOT NULL, end TEXT, location TEXT,
  audience TEXT DEFAULT '["program"]', details TEXT DEFAULT '{}',
  status TEXT DEFAULT 'scheduled', status_note TEXT, rsvp_deadline TEXT, reminders TEXT DEFAULT '[1440,120]',
  series_id INTEGER, created_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE INDEX IF NOT EXISTS events_start ON events(program_id, start);
CREATE TABLE IF NOT EXISTS event_series (
  id INTEGER PRIMARY KEY, program_id INTEGER, rule TEXT
);
CREATE TABLE IF NOT EXISTS rsvps (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL, reason TEXT, note TEXT, by_user INTEGER, at TEXT DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (event_id, user_id)
);
CREATE TABLE IF NOT EXISTS reminder_log (
  event_id INTEGER, offset_min INTEGER, PRIMARY KEY (event_id, offset_min)
);

-- Module 2: Practice planning
CREATE TABLE IF NOT EXISTS drills (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT, points TEXT,
  equipment TEXT, media_url TEXT, unit TEXT, positions TEXT DEFAULT '[]', skills TEXT, duration INTEGER DEFAULT 10,
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS practice_plans (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  name TEXT NOT NULL, is_template INTEGER DEFAULT 0, notes TEXT, start_time TEXT,
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS periods (
  id INTEGER PRIMARY KEY, plan_id INTEGER NOT NULL REFERENCES practice_plans(id) ON DELETE CASCADE,
  sort INTEGER DEFAULT 0, start_time TEXT, duration INTEGER DEFAULT 10, location TEXT,
  unit TEXT, group_label TEXT, positions TEXT DEFAULT '[]', coach_id INTEGER, drill_id INTEGER, play_ids TEXT DEFAULT '[]',
  status TEXT DEFAULT 'pending', status_note TEXT, contact INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS practice_notes (
  id INTEGER PRIMARY KEY, plan_id INTEGER REFERENCES practice_plans(id) ON DELETE CASCADE, period_id INTEGER, drill_id INTEGER,
  player_id INTEGER, group_label TEXT, tags TEXT DEFAULT '[]', text TEXT, coach_id INTEGER, date TEXT,
  at TEXT DEFAULT (datetime('now','localtime')), client_id TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY, plan_id INTEGER, period_id INTEGER, drill_id INTEGER,
  player_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, value INTEGER NOT NULL, coach_id INTEGER, date TEXT,
  season_id INTEGER, at TEXT DEFAULT (datetime('now','localtime')), client_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS ratings_player ON ratings(player_id, date);

-- Module 3: Playbook
CREATE TABLE IF NOT EXISTS playbooks (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, name TEXT NOT NULL, side TEXT, description TEXT
);
CREATE TABLE IF NOT EXISTS formations (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, name TEXT NOT NULL, side TEXT, data TEXT
);
CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, playbook_id INTEGER REFERENCES playbooks(id) ON DELETE SET NULL,
  name TEXT NOT NULL, side TEXT DEFAULT 'offense', formation TEXT, folder TEXT, tags TEXT DEFAULT '[]',
  data TEXT DEFAULT '{"players":[]}', coaching_points TEXT, assignments TEXT DEFAULT '{}', video_url TEXT,
  version INTEGER DEFAULT 1, updated_by INTEGER, updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS play_versions (
  id INTEGER PRIMARY KEY, play_id INTEGER NOT NULL REFERENCES plays(id) ON DELETE CASCADE, version INTEGER,
  snapshot TEXT, by_user INTEGER, at TEXT DEFAULT (datetime('now','localtime')), summary TEXT
);
CREATE TABLE IF NOT EXISTS play_shares (
  id INTEGER PRIMARY KEY, program_id INTEGER, play_id INTEGER, playbook_id INTEGER, audience TEXT,
  by_user INTEGER, at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS install_sheets (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, name TEXT NOT NULL, play_ids TEXT DEFAULT '[]',
  notes TEXT, audience TEXT DEFAULT '[]', created_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS play_views (
  id INTEGER PRIMARY KEY, play_id INTEGER, install_id INTEGER, user_id INTEGER, at TEXT DEFAULT (datetime('now','localtime')), context TEXT
);

CREATE TABLE IF NOT EXISTS quiz_results (
  id INTEGER PRIMARY KEY, play_id INTEGER NOT NULL REFERENCES plays(id) ON DELETE CASCADE, player_id INTEGER NOT NULL,
  score INTEGER, total INTEGER, answers TEXT, at TEXT DEFAULT (datetime('now','localtime'))
);

-- Module 4: Depth charts
CREATE TABLE IF NOT EXISTS depth_charts (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  unit TEXT NOT NULL, week_label TEXT NOT NULL, season_id INTEGER, formation TEXT, slots TEXT DEFAULT '{}',
  visible_to_players INTEGER DEFAULT 0, updated_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime'))
);

-- Module 5: Attendance
CREATE TABLE IF NOT EXISTS attendance (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, player_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL, reason TEXT, source TEXT, confirmed INTEGER DEFAULT 1, by_user INTEGER,
  at TEXT DEFAULT (datetime('now','localtime')), PRIMARY KEY (event_id, player_id)
);
CREATE TABLE IF NOT EXISTS checkin_codes (
  event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, code TEXT NOT NULL, expires_at TEXT
);
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id INTEGER PRIMARY KEY, program_id INTEGER, entity TEXT, entity_key TEXT, server_value TEXT, client_value TEXT,
  client_user INTEGER, at TEXT DEFAULT (datetime('now','localtime')), resolved INTEGER DEFAULT 0
);

-- Module 6: Weight room and nutrition
CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, name TEXT NOT NULL, category TEXT, cues TEXT, video_url TEXT, test_key TEXT
);
CREATE TABLE IF NOT EXISTS wt_programs (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT, weeks INTEGER DEFAULT 4,
  days TEXT DEFAULT '[]', is_template INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS wt_assignments (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, wt_program_id INTEGER NOT NULL REFERENCES wt_programs(id) ON DELETE CASCADE,
  audience TEXT NOT NULL, start_date TEXT, season_id INTEGER, created_by INTEGER
);
CREATE TABLE IF NOT EXISTS wt_overrides (
  id INTEGER PRIMARY KEY, assignment_id INTEGER NOT NULL REFERENCES wt_assignments(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL, exercise_id INTEGER, alt_exercise_id INTEGER, sets INTEGER, reps TEXT, pct REAL, note TEXT
);
CREATE TABLE IF NOT EXISTS wt_logs (
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, assignment_id INTEGER,
  week INTEGER, day INTEGER, exercise_id INTEGER, set_no INTEGER, reps INTEGER, weight REAL, date TEXT,
  at TEXT DEFAULT (datetime('now','localtime')), client_id TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, test_key TEXT NOT NULL,
  value REAL NOT NULL, date TEXT NOT NULL, by_user INTEGER, season_id INTEGER
);
CREATE TABLE IF NOT EXISTS meal_plans (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, name TEXT NOT NULL, meals TEXT DEFAULT '[]', hydration_oz INTEGER,
  notes TEXT, audience TEXT DEFAULT '[]', approved_by INTEGER, locked INTEGER DEFAULT 0, is_template INTEGER DEFAULT 0,
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS meal_logs (
  id INTEGER PRIMARY KEY, plan_id INTEGER NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE, player_id INTEGER NOT NULL,
  date TEXT NOT NULL, meal_idx INTEGER NOT NULL, done INTEGER DEFAULT 1, UNIQUE (plan_id, player_id, date, meal_idx)
);
CREATE TABLE IF NOT EXISTS hydration_logs (
  plan_id INTEGER NOT NULL, player_id INTEGER NOT NULL, date TEXT NOT NULL, met INTEGER DEFAULT 1, PRIMARY KEY (plan_id, player_id, date)
);

-- Module 7: Communication
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, title TEXT NOT NULL, body TEXT, audience TEXT NOT NULL,
  emergency INTEGER DEFAULT 0, by_user INTEGER, at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT DEFAULT 'group', audience TEXT DEFAULT '[]',
  allow_players INTEGER DEFAULT 1, allow_parents INTEGER DEFAULT 0, locked INTEGER DEFAULT 0, allow_files INTEGER DEFAULT 1,
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS chat_members (
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted INTEGER DEFAULT 0, last_read INTEGER DEFAULT 0, PRIMARY KEY (chat_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE, user_id INTEGER NOT NULL,
  body TEXT, attachment TEXT, at TEXT DEFAULT (datetime('now','localtime')), deliver_at TEXT,
  removed_by_sender INTEGER DEFAULT 0, hidden_by_admin INTEGER DEFAULT 0, emergency INTEGER DEFAULT 0, poll TEXT, flagged INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE TABLE IF NOT EXISTS poll_votes (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, option_idx INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE TABLE IF NOT EXISTS message_reports (
  id INTEGER PRIMARY KEY, message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE, by_user INTEGER,
  reason TEXT, at TEXT DEFAULT (datetime('now','localtime')), resolved INTEGER DEFAULT 0, resolution TEXT
);
CREATE TABLE IF NOT EXISTS contact_blocks (
  id INTEGER PRIMARY KEY, program_id INTEGER, parent_id INTEGER, player_id INTEGER, coach_id INTEGER, reason TEXT,
  status TEXT DEFAULT 'requested', applied_by INTEGER, at TEXT DEFAULT (datetime('now','localtime'))
);

-- Module 8: Equipment
CREATE TABLE IF NOT EXISTS eq_types (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, name TEXT NOT NULL, category TEXT, brand TEXT, model TEXT,
  tracking TEXT DEFAULT 'bulk', cost REAL DEFAULT 0, low_stock INTEGER DEFAULT 2
);
CREATE TABLE IF NOT EXISTS eq_items (
  id INTEGER PRIMARY KEY, type_id INTEGER NOT NULL REFERENCES eq_types(id) ON DELETE CASCADE, serial TEXT, size TEXT,
  qty INTEGER DEFAULT 1, condition TEXT DEFAULT 'good', manuf_year INTEGER, recert_year INTEGER, recert_facility TEXT,
  allows_recert INTEGER DEFAULT 1, retired INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS eq_issues (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, item_id INTEGER REFERENCES eq_items(id), type_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL REFERENCES users(id), size TEXT, qty INTEGER DEFAULT 1, season_id INTEGER,
  issued_at TEXT, condition_out TEXT, issued_by INTEGER,
  returned_at TEXT, return_status TEXT, condition_in TEXT, received_by INTEGER, acknowledged_at TEXT
);
CREATE TABLE IF NOT EXISTS helmet_fits (
  id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL, player_id INTEGER NOT NULL, season_id INTEGER, date TEXT, notes TEXT, by_user INTEGER
);

-- Module 9: Assignments and reports
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, title TEXT NOT NULL, instructions TEXT,
  type TEXT NOT NULL, due TEXT, audience TEXT NOT NULL, video_url TEXT, install_id INTEGER, play_ids TEXT DEFAULT '[]',
  checklist TEXT DEFAULT '[]', recurring TEXT, parent_id INTEGER, is_template INTEGER DEFAULT 0, season_id INTEGER,
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS assignment_status (
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE, player_id INTEGER NOT NULL,
  status TEXT DEFAULT 'not_started', progress TEXT DEFAULT '{}', response TEXT, attachment TEXT,
  submitted_at TEXT, feedback TEXT, mark TEXT, score REAL, reminded_at TEXT, PRIMARY KEY (assignment_id, player_id)
);
CREATE TABLE IF NOT EXISTS forms (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT, questions TEXT DEFAULT '[]',
  audience TEXT DEFAULT '[]', share_with TEXT DEFAULT '[]', due TEXT, created_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS form_responses (
  id INTEGER PRIMARY KEY, form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE, player_id INTEGER NOT NULL,
  answers TEXT, at TEXT DEFAULT (datetime('now','localtime')), UNIQUE(form_id, player_id)
);

-- Module 10: Season tracking
CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, player_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id INTEGER, point TEXT NOT NULL, position TEXT, scores TEXT DEFAULT '{}', notes TEXT, by_user INTEGER,
  at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS dev_goals (
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL, player_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, kind TEXT DEFAULT 'skill', test_key TEXT, baseline REAL, target REAL, progress INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active', due TEXT, notes TEXT, season_id INTEGER, by_user INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return wrap(db);
}

function wrap(raw) {
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const norm = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
  const plain = (r) => (r ? { ...r } : r);
  return {
    raw,
    all: (sql, ...p) => stmt(sql).all(...norm(p)).map(plain),
    get: (sql, ...p) => plain(stmt(sql).get(...norm(p))),
    run: (sql, ...p) => stmt(sql).run(...norm(p)),
    exec: (sql) => raw.exec(sql),
    tx(fn) {
      raw.exec('BEGIN');
      try { const r = fn(); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
    insert(table, obj) {
      const keys = Object.keys(obj);
      const vals = keys.map((k) => (obj[k] !== null && typeof obj[k] === 'object' ? JSON.stringify(obj[k]) : obj[k]));
      const r = stmt(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...norm(vals));
      return Number(r.lastInsertRowid);
    },
    update(table, id, obj, idCol = 'id') {
      const keys = Object.keys(obj);
      if (!keys.length) return;
      const vals = keys.map((k) => (obj[k] !== null && typeof obj[k] === 'object' ? JSON.stringify(obj[k]) : obj[k]));
      stmt(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE ${idCol}=?`).run(...norm(vals), id);
    },
  };
}

// Parse JSON columns in place.
export function j(row, ...cols) {
  if (!row) return row;
  for (const c of cols) {
    if (typeof row[c] === 'string') { try { row[c] = JSON.parse(row[c]); } catch { /* leave */ } }
  }
  return row;
}
export const jAll = (rows, ...cols) => rows.map((r) => j(r, ...cols));
