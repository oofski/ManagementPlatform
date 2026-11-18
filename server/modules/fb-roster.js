// C-1 roster import helpers shared by the CSV import (roster.js) and the Google Sheets import (google.js):
// grade -> class year, a single "position" column, and up to two parent contacts per row.
import { token, nowLocal, need } from '../core.js';

// Graduation year of the current school year (a school year that starts in August ends the next June).
export function schoolYearEnd(d = new Date()) {
  return d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear();
}

// "9", "9th", "Freshman", "Fr", "So", "Junior", "Sr" or a 4-digit class year.
export function gradeToClassYear(grade, now = new Date()) {
  const s = String(grade ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^\d{4}$/.test(s)) return Number(s);
  const words = { fr: 9, fresh: 9, freshman: 9, so: 10, soph: 10, sophomore: 10, jr: 11, junior: 11, sr: 12, senior: 12 };
  const n = words[s.replace(/[^a-z]/g, '')] ?? Number(s.replace(/(st|nd|rd|th)$/, ''));
  if (!Number.isInteger(n) || n < 6 || n > 12) return null;
  return schoolYearEnd(now) + (12 - n);
}

const UNIT_OF = (u) => (u.startsWith('spec') || u === 'st' ? 'special' : u.startsWith('off') ? 'offense' : u.startsWith('def') ? 'defense' : u);

// Normalize one spreadsheet row. positionRows: [{ code, unit }] for the program.
export function normalizeImportRow(r, positionRows) {
  const posList = String(r.positions || r.position || r.pos || '').split(/[ ,;/]+/).filter(Boolean).map((p) => p.toUpperCase());
  let units = String(r.units || r.unit || '').toLowerCase().split(/[ ,;/]+/).filter(Boolean).map(UNIT_OF).filter((u) => ['offense', 'defense', 'special'].includes(u));
  if (!units.length) units = [...new Set(posList.map((c) => positionRows.find((p) => p.code === c)?.unit).filter(Boolean))];
  const name = r.name || [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || null;
  const classYear = r.class_year ? gradeToClassYear(r.class_year) : r.grade ? gradeToClassYear(r.grade) : null;
  const parents = [];
  for (const pre of ['parent', 'parent1', 'parent2', 'guardian']) {
    const p = { name: r[`${pre}_name`], email: r[`${pre}_email`], phone: r[`${pre}_phone`], relation: pre === 'guardian' || pre === 'parent2' ? 'Guardian' : 'Parent' };
    if (p.name || p.email || p.phone) parents.push(p);
  }
  return {
    name, positions: posList, units, class_year: classYear,
    primary_group: (r.primary_group || r.group || posList[0] || '').toUpperCase() || null,
    parents: parents.slice(0, 2),
  };
}

// Create parent accounts (or reuse a parent with the same email in this program) and link them, max 2 per player.
export function linkImportedParents(db, user, playerId, parents) {
  let linked = 0;
  for (const p of parents) {
    const count = db.get('SELECT count(*) n FROM parent_links WHERE player_id=?', playerId).n;
    if (count >= 2) break;
    need(p.name || p.email, 400, 'Parent contact needs a name or an email');
    const email = p.email ? String(p.email).trim() : null;
    let parent = email ? db.get('SELECT * FROM users WHERE lower(email)=lower(?)', email) : null;
    if (parent) need(parent.role === 'parent' && parent.program_id === user.program_id, 400, `Parent email ${email} belongs to another account`);
    if (!parent && !email && p.phone) parent = db.get(`SELECT * FROM users WHERE program_id=? AND role='parent' AND phone=?`, user.program_id, String(p.phone).trim());
    let id = parent?.id;
    if (!id) {
      const code = token(12);
      const pname = p.name || email;
      id = db.insert('users', { program_id: user.program_id, name: pname, email, phone: p.phone ? String(p.phone).trim() : null, role: 'parent', invite_code: code, invited_by: user.id, cal_token: token(16) });
      const player = db.get('SELECT name FROM users WHERE id=?', playerId).name;
      if (email) db.insert('outbox', { user_id: id, to_email: email, subject: `You were invited to follow ${player} on the team app`, body: `Accept your invite: /invite/${code}`, deliver_at: nowLocal() });
    }
    const r = db.run('INSERT OR IGNORE INTO parent_links (parent_id, player_id, relation) VALUES (?,?,?)', id, playerId, p.relation || 'Parent');
    if (r.changes) linked++;
  }
  return linked;
}
