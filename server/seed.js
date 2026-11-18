// Demo data: one program, three levels, ~20 coaches, ~95 players with parents and a season of activity.
import { hashPassword, token, nowLocal, today, addDays, addMinutes, parseLocal, fmtLocal, DEFAULT_SETTINGS } from './core.js';
import { fileURLToPath } from 'node:url';
import { ensurePositions } from './modules/playbook-v2.js';
import { seedFootball } from './seed-football.js';
import { seedWeightRoom } from './strength-seed.js';

let s = 42;
const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const FIRST = ['Jalen', 'Marcus', 'Tyler', 'Caleb', 'Ethan', 'Noah', 'Mason', 'Isaiah', 'Elijah', 'Jordan', 'Aiden', 'Carter', 'Luke', 'Dylan', 'Gavin', 'Owen', 'Xavier', 'Micah', 'Josiah', 'Brayden', 'Cole', 'Trey', 'Andre', 'Miles', 'Devin', 'Logan', 'Hunter', 'Chase', 'Jace', 'Kaden', 'Darius', 'Malik', 'Nathan', 'Ryan', 'Diego', 'Mateo', 'Luis', 'Kai', 'Bryce', 'Jaylen', 'Cameron', 'Wyatt', 'Grant', 'Zion', 'Tristan', 'Eli', 'Reid', 'Brady', 'Colton', 'Damian'];
const LAST = ['Johnson', 'Williams', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin', 'Garcia', 'Martinez', 'Robinson', 'Clark', 'Lewis', 'Lee', 'Walker', 'Hall', 'Allen', 'Young', 'King', 'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Hill', 'Ramirez', 'Campbell', 'Mitchell', 'Roberts', 'Carter', 'Phillips', 'Evans', 'Turner', 'Torres', 'Parker', 'Collins', 'Edwards', 'Stewart', 'Morris', 'Murphy', 'Cook', 'Rogers', 'Reed', 'Bailey'];
const PARENT_FIRST = ['Lisa', 'Michael', 'Angela', 'David', 'Tasha', 'Robert', 'Maria', 'James', 'Kim', 'Chris', 'Monica', 'Brian', 'Erica', 'Anthony', 'Rachel', 'Kevin', 'Denise', 'Mark', 'Sandra', 'Paul'];

export function seed(db) {
  s = 42;
  const PW = hashPassword('password123');
  const day = today();
  const monday = (() => { const d = parseLocal(day + 'T00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fmtLocal(d).slice(0, 10); })();
  const year = Number(day.slice(0, 4));

  db.tx(() => {
    const pid = db.insert('programs', { name: 'Ridgeview Football', school: 'Ridgeview High School', state: 'TX', settings: { ...DEFAULT_SETTINGS, leaderboard: true, players_see_ratings: false, coach_export_plays: false } });
    const seasonStart = `${year}-06-01`; const seasonEnd = `${year}-12-12`;
    const seasonId = db.insert('seasons', {
      program_id: pid, name: `Fall ${year}`, start_date: seasonStart, end_date: seasonEnd, active: 1,
      phases: [
        { name: 'Summer', start: `${year}-06-01`, end: `${year}-07-31`, goals: 'Strength base, 7-on-7 install, 90% summer lift attendance' },
        { name: 'Preseason and camp', start: `${year}-08-01`, end: `${year}-08-27`, goals: 'Heat acclimatization, full install, set depth charts' },
        { name: 'In-season', start: `${year}-08-28`, end: `${year}-11-06`, goals: 'Win district, stay healthy, maintain strength' },
        { name: 'Playoffs', start: `${year}-11-07`, end: `${year}-12-12`, goals: 'One week at a time' },
      ],
    });
    db.insert('seasons', { program_id: pid, name: `Fall ${year - 1}`, start_date: `${year - 1}-06-01`, end_date: `${year - 1}-12-10`, active: 0, phases: [] });

    // Levels and teams
    const varsity = db.insert('levels', { program_id: pid, name: 'Varsity', sort: 1 });
    const jv = db.insert('levels', { program_id: pid, name: 'JV', sort: 2 });
    const fr = db.insert('levels', { program_id: pid, name: 'Freshman', sort: 3 });
    const tV = db.insert('teams', { level_id: varsity, name: 'Varsity' });
    const tJR = db.insert('teams', { level_id: jv, name: 'Red' });
    const tJB = db.insert('teams', { level_id: jv, name: 'Black' });
    const tF = db.insert('teams', { level_id: fr, name: 'Freshman' });

    const POS = { offense: ['QB', 'RB', 'WR', 'TE', 'OL'], defense: ['DL', 'LB', 'DB'], special: ['K', 'P', 'LS', 'RET'] };
    for (const [unit, list] of Object.entries(POS)) for (const code of list) db.insert('positions', { program_id: pid, unit, code, name: code });

    // Staff (~20)
    const staff = {};
    const mkStaff = (key, name, role, title, extra = {}, scopes = []) => {
      const email = name.toLowerCase().replace(/[^a-z]+/g, '.') + '@ridgeview.example';
      const id = db.insert('users', { program_id: pid, name, email, password_hash: PW, role, title, joined_at: nowLocal(), cal_token: token(16), ...extra });
      for (const sc of scopes) db.run('INSERT INTO staff_scopes VALUES (?,?)', id, sc);
      staff[key] = id;
      return id;
    };
    mkStaff('head', 'Dana Whitfield', 'head_coach', 'Head coach');
    db.run(`UPDATE users SET email='coach@ridgeview.example' WHERE id=?`, staff.head);
    mkStaff('oc', 'Marcus Reyes', 'coach', 'Offensive coordinator', { is_admin: 1 }, ['unit:offense']);
    mkStaff('dc', 'Terrence Boyd', 'coach', 'Defensive coordinator', {}, ['unit:defense']);
    mkStaff('st', 'Alan Kowalski', 'coach', 'Special teams coordinator', {}, ['unit:special']);
    mkStaff('qb', 'Ben Okafor', 'coach', 'QB coach', {}, ['pos:QB']);
    mkStaff('rb', 'Luis Ortega', 'coach', 'RB coach', {}, ['pos:RB']);
    mkStaff('wr', 'Sam Patel', 'coach', 'WR coach', {}, ['pos:WR', 'pos:TE']);
    mkStaff('ol', 'Greg Hanson', 'coach', 'OL coach', {}, ['pos:OL']);
    mkStaff('dl', 'Andre Mitchell', 'coach', 'DL coach', {}, ['pos:DL']);
    mkStaff('lb', 'Chris Dalton', 'coach', 'LB coach', {}, ['pos:LB']);
    mkStaff('db', 'Jamal Price', 'coach', 'DB coach', {}, ['pos:DB']);
    mkStaff('jvh', 'Ray Castillo', 'coach', 'JV head coach', {}, [`level:${jv}`]);
    mkStaff('jva', 'Tom Becker', 'coach', 'JV assistant', {}, [`team:${tJR}`]);
    mkStaff('jvb', 'Nate Silva', 'coach', 'JV assistant', {}, [`team:${tJB}`]);
    mkStaff('frh', 'Paul Greene', 'coach', 'Freshman head coach', {}, [`level:${fr}`]);
    mkStaff('fra', 'Eric Lund', 'coach', 'Freshman assistant', {}, [`level:${fr}`]);
    mkStaff('sc', 'Kara Jensen', 'coach', 'Strength and conditioning', { perms: { body_data: true } }, []);
    mkStaff('at', 'Morgan Ellis', 'trainer', 'Athletic trainer', { perms: { nutrition_pro: true } });
    mkStaff('ad', 'Patricia Long', 'staff', 'Athletic director', { staff_kind: 'athletic_director', perms: { read_all_chats: true, audit: true } });
    mkStaff('eq', 'Victor Hale', 'staff', 'Equipment manager', { staff_kind: 'equipment_manager', perms: { equipment_manager: true } });
    mkStaff('vol', 'Jenna Ruiz', 'staff', 'Team manager (volunteer)', { staff_kind: 'volunteer' });

    // Players (~95)
    const players = [];
    const usedNames = new Set();
    const name = () => { let n; do { n = `${pick(FIRST)} ${pick(LAST)}`; } while (usedNames.has(n)); usedNames.add(n); return n; };
    const plan = [
      [tV, 46, [year + 1, year + 2, year + 1, year]], [tJR, 16, [year + 2, year + 3]], [tJB, 15, [year + 2, year + 3]], [tF, 20, [year + 3]],
    ];
    const dist = ['QB', 'QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'WR', 'TE', 'TE', 'OL', 'OL', 'OL', 'OL', 'OL', 'OL', 'OL', 'DL', 'DL', 'DL', 'DL', 'DL', 'LB', 'LB', 'LB', 'LB', 'DB', 'DB', 'DB', 'DB', 'DB', 'DB'];
    for (const [team, count, classes] of plan) {
      const jerseys = new Set();
      for (let i = 0; i < count; i++) {
        const nm = name();
        const pos = dist[i % dist.length];
        const unit = POS.offense.includes(pos) ? 'offense' : 'defense';
        const units = [unit];
        const positions = [pos];
        if (pos === 'WR' && i % 3 === 0) { units.push('special'); positions.push('RET'); }
        if (pos === 'DB' && i % 4 === 0) { units.push('offense'); positions.push('WR'); }
        if (pos === 'LB' && i % 2 === 0) units.push('special');
        if (pos === 'OL' && i % 7 === 0) { units.push('special'); positions.push('LS'); }
        if (i === count - 1 || i === count - 2) { units.splice(0, units.length, 'special'); positions.splice(0, positions.length, i === count - 1 ? 'K' : 'P'); }
        let j; do { j = pos === 'QB' ? int(1, 19) : pos === 'OL' ? int(50, 79) : pos === 'DL' ? int(90, 99) : int(1, 49); } while (jerseys.has(j) && jerseys.size < 99); jerseys.add(j);
        const email = nm.toLowerCase().replace(/[^a-z]+/g, '.') + '@students.ridgeview.example';
        const joined = rnd() > 0.08;
        const id = db.insert('users', { program_id: pid, name: nm, email, password_hash: joined ? PW : null, role: 'player', joined_at: joined ? nowLocal() : null, invite_code: joined ? null : token(12), cal_token: token(16), invited_by: staff.head });
        const bigs = ['OL', 'DL'].includes(pos);
        db.insert('player_profiles', {
          user_id: id, team_id: team, jersey: j, class_year: pick(classes), hand: rnd() > 0.88 ? 'Left' : 'Right', units, positions,
          availability: rnd() > 0.93 ? 'out' : rnd() > 0.9 ? 'limited' : 'available',
          personal: { nickname: '', hometown: 'Ridgeview' },
        });
        const h = bigs ? int(72, 77) : int(67, 74); const w = bigs ? int(235, 295) : pos === 'LB' || pos === 'TE' ? int(195, 225) : int(155, 195);
        db.insert('measurements', { player_id: id, kind: 'height', value: h, date: `${year}-06-01`, by_user: staff.sc, season_id: seasonId });
        db.insert('measurements', { player_id: id, kind: 'weight', value: w, date: `${year}-06-01`, by_user: staff.sc, season_id: seasonId });
        db.insert('measurements', { player_id: id, kind: 'weight', value: w + int(-6, 8), date: `${year}-09-15`, by_user: staff.sc, season_id: seasonId });
        for (const [dd, delta] of [[`${year}-08-03`, 0], [`${year}-09-07`, int(-3, 4)], [`${year}-10-05`, int(-4, 6)], [`${year}-11-02`, int(-4, 7)]]) db.insert('measurements', { player_id: id, kind: 'bodyweight', value: w + delta, date: dd, by_user: staff.at });
        players.push({ id, name: nm, team, pos, units, positions, jersey: j, bigs });
        // parents
        const last = nm.split(' ')[1];
        const n = rnd() > 0.25 ? (rnd() > 0.6 ? 2 : 1) : 0;
        for (let k = 0; k < n; k++) {
          const pn = `${pick(PARENT_FIRST)} ${last}`;
          const pe = `${pn.toLowerCase().replace(/[^a-z]+/g, '.')}.${id}${k}@family.example`;
          const accepted = rnd() > 0.15;
          const parentId = db.insert('users', { program_id: pid, name: pn, email: pe, password_hash: accepted ? PW : null, role: 'parent', joined_at: accepted ? nowLocal() : null, invite_code: accepted ? null : token(12), invited_by: id, cal_token: token(16) });
          db.insert('parent_links', { parent_id: parentId, player_id: id, relation: k === 0 ? 'Parent' : 'Guardian' });
        }
      }
    }
    // Stable demo accounts
    const demoQB = players.find((p) => p.team === tV && p.pos === 'QB');
    db.run(`UPDATE users SET email='player@ridgeview.example', invite_code=NULL, password_hash=?, joined_at=? WHERE id=?`, PW, nowLocal(), demoQB.id);
    db.run(`UPDATE player_profiles SET availability='available' WHERE user_id=?`, demoQB.id);
    let demoParent = db.get('SELECT parent_id FROM parent_links WHERE player_id=?', demoQB.id)?.parent_id;
    if (!demoParent) { demoParent = db.insert('users', { program_id: pid, name: `Lisa ${demoQB.name.split(' ')[1]}`, email: 'x', role: 'parent', cal_token: token(16) }); db.insert('parent_links', { parent_id: demoParent, player_id: demoQB.id, relation: 'Parent' }); }
    db.run(`UPDATE users SET email='parent@ridgeview.example', invite_code=NULL, password_hash=?, joined_at=? WHERE id=?`, PW, nowLocal(), demoParent);
    const vPlayers = players.filter((p) => p.team === tV);

    // Custom groups
    const captains = db.insert('custom_groups', { program_id: pid, name: 'Captains' });
    for (const p of vPlayers.filter((_, i) => i % 11 === 0).slice(0, 4)) db.insert('group_members', { group_id: captains, user_id: p.id });
    db.run('INSERT OR IGNORE INTO group_members VALUES (?,?)', captains, demoQB.id);

    // ---------- Calendar ----------
    const events = [];
    const ev = (o) => { const id = db.insert('events', { program_id: pid, season_id: seasonId, reminders: [1440, 120], created_by: staff.head, updated_at: nowLocal(), details: {}, ...o }); events.push({ id, ...o }); return id; };
    const opponents = ['Lakeside', 'Westbrook', 'Cedar Creek', 'North Valley', 'Pine Ridge', 'Eastfield'];
    const practiceSeries = db.insert('event_series', { program_id: pid, rule: { freq: 'weekly', days: [1, 2, 3, 4] } });
    for (let w = -3; w <= 2; w++) {
      const mon = addDays(monday, w * 7);
      const opp = opponents[(w + 3) % opponents.length];
      const home = w % 2 === 0;
      ev({ type: 'film', title: `Film: ${opp} scout`, start: `${mon}T15:15`, end: `${mon}T16:00`, location: 'Film room', audience: [`team:${tV}`] });
      for (let d = 0; d < 4; d++) {
        const date = addDays(mon, d);
        ev({ type: 'practice', title: d === 3 ? 'Varsity walkthrough' : 'Varsity practice', start: `${date}T${d === 0 ? '16:00' : '15:30'}`, end: `${date}T${d === 3 ? '16:30' : '17:45'}`, location: 'Main field', audience: [`team:${tV}`], details: { what_to_bring: d === 3 ? 'Helmets only' : 'Full pads, water bottle', indoor_outdoor: 'outdoor' }, series_id: practiceSeries });
        if (d < 3) ev({ type: 'practice', title: 'JV practice', start: `${date}T15:45`, end: `${date}T17:30`, location: 'Practice field B', audience: [`level:${jv}`], details: { what_to_bring: 'Full pads' } });
        if (d < 3) ev({ type: 'practice', title: 'Freshman practice', start: `${date}T15:45`, end: `${date}T17:15`, location: 'Practice field C', audience: [`level:${fr}`], details: { what_to_bring: 'Shells' } });
      }
      for (const d of [1, 3]) ev({ type: 'lift', title: 'In-season lift', start: `${addDays(mon, d)}T06:45`, end: `${addDays(mon, d)}T07:35`, location: 'Weight room', audience: [`team:${tV}`], details: { what_to_bring: 'Training shoes' } });
      ev({ type: 'meeting', title: 'Staff meeting: game plan', start: `${addDays(mon, 3)}T17:00`, end: `${addDays(mon, 3)}T18:00`, location: 'Coaches office', audience: ['coaches'] });
      ev({ type: 'game', title: `${home ? 'vs' : '@'} ${opp}`, start: `${addDays(mon, 4)}T19:00`, end: `${addDays(mon, 4)}T22:00`, location: home ? 'Ridgeview Stadium' : `${opp} Stadium`, audience: [`team:${tV}`], details: { opponent: opp, home_away: home ? 'home' : 'away', kickoff: '19:00', report_time: '17:00', bus_departure: home ? undefined : '16:15', uniform: home ? 'Home black' : 'Away white' } });
      ev({ type: 'game', title: `JV ${home ? '@' : 'vs'} ${opp}`, start: `${addDays(mon, 3)}T18:00`, end: `${addDays(mon, 3)}T20:30`, location: home ? `${opp} Stadium` : 'Ridgeview Stadium', audience: [`level:${jv}`], details: { opponent: opp, home_away: home ? 'away' : 'home', kickoff: '18:00', report_time: '16:45' } });
    }
    const social = ev({ type: 'social', title: 'Team dinner at Coach Whitfield’s', start: `${addDays(monday, 2)}T18:30`, end: `${addDays(monday, 2)}T20:00`, location: 'Ridgeview cafeteria', audience: ['program'], rsvp_deadline: `${addDays(monday, 1)}T21:00`, details: { head_count: 'RSVP by Tuesday', cost: 'Free' } });

    // RSVPs and attendance for past events
    const now = nowLocal();
    const reasons = ['sick', 'injured', 'family', 'academic', 'transportation'];
    for (const e of events) {
      const aud = e.audience[0];
      let roster = [];
      if (aud === `team:${tV}`) roster = vPlayers;
      else if (aud === `level:${jv}`) roster = players.filter((p) => p.team === tJR || p.team === tJB);
      else if (aud === `level:${fr}`) roster = players.filter((p) => p.team === tF);
      else if (aud === 'program') roster = players;
      if (!roster.length) continue;
      const past = e.start < now;
      for (const p of roster) {
        const r = rnd();
        if (!past && r < 0.45) {
          const st = r < 0.36 ? 'going' : r < 0.41 ? 'maybe' : 'not_going';
          db.insert('rsvps', { event_id: e.id, user_id: p.id, status: st, reason: st === 'not_going' ? pick(reasons) : null, by_user: p.id });
          if (st === 'not_going') db.insert('attendance', { event_id: e.id, player_id: p.id, status: 'excused', reason: 'RSVP', source: 'rsvp', confirmed: 0, by_user: p.id });
        }
        if (past && e.type !== 'social') {
          const st = r < 0.86 ? 'present' : r < 0.91 ? 'late' : r < 0.93 ? 'left_early' : r < 0.97 ? 'excused' : 'unexcused';
          db.insert('attendance', { event_id: e.id, player_id: p.id, status: st, reason: st === 'excused' ? pick(reasons) : null, source: 'coach', confirmed: 1, by_user: staff.head, at: e.start });
        }
      }
    }
    for (const k of ['oc', 'dc', 'qb', 'wr', 'ol']) db.insert('rsvps', { event_id: social, user_id: staff[k], status: 'going', by_user: staff[k] });

    // ---------- Practice planning ----------
    const drills = {};
    const mkDrill = (key, o) => { drills[key] = db.insert('drills', { program_id: pid, created_by: staff.head, ...o }); };
    mkDrill('dyn', { name: 'Dynamic warm-up', description: 'Full team movement prep', points: 'Tall posture; quick feet', equipment: 'Cones', unit: null, positions: [], skills: 'warm-up, mobility', duration: 10 });
    mkDrill('indy_wr', { name: 'WR release vs press', description: 'Releases off the line vs a DB in press', points: 'Win with hands; stack the DB', equipment: 'Hand shields', unit: 'offense', positions: ['WR', 'TE'], skills: 'release, route running', duration: 10, media_url: 'https://example.com/drills/wr-release' });
    mkDrill('indy_ol', { name: 'OL pass set mirror', description: 'Kick-slide mirror drill', points: 'Hands inside; keep base', equipment: 'Bags', unit: 'offense', positions: ['OL'], skills: 'pass protection, footwork', duration: 10 });
    mkDrill('indy_qb', { name: 'QB drop and throw', description: '3- and 5-step drops to targets', points: 'Eyes downfield; finish throw', equipment: 'Footballs, nets', unit: 'offense', positions: ['QB'], skills: 'footwork, accuracy', duration: 10 });
    mkDrill('indy_rb', { name: 'RB ball security gauntlet', description: 'Run the gauntlet with high and tight', points: 'Five points of pressure', equipment: 'Gauntlet bags', unit: 'offense', positions: ['RB'], skills: 'ball security', duration: 8 });
    mkDrill('indy_dl', { name: 'DL get-off and hands', description: 'Get off on ball movement, strike sled', points: 'First step; hat and hands', equipment: 'Sled', unit: 'defense', positions: ['DL'], skills: 'get-off, hand fighting', duration: 10 });
    mkDrill('indy_lb', { name: 'LB read steps', description: 'Read guard to ball, fill', points: 'Shuffle, don’t cross over', equipment: 'Cones', unit: 'defense', positions: ['LB'], skills: 'reads, fit', duration: 10 });
    mkDrill('indy_db', { name: 'DB backpedal and break', description: 'Pedal, plant and drive on cue', points: 'Low pad level', equipment: 'Cones', unit: 'defense', positions: ['DB'], skills: 'coverage, footwork', duration: 10 });
    mkDrill('tackle', { name: 'Tackling circuit', description: 'Shoulder tackling progression', points: 'Head across; wrap and run feet', equipment: 'Tackling rings, dummies', unit: 'defense', positions: ['DL', 'LB', 'DB'], skills: 'tackling', duration: 10 });
    mkDrill('7on7', { name: '7-on-7', description: 'Skill players vs back seven', points: 'Execute the script; communicate', equipment: 'Footballs, cones', unit: null, positions: ['QB', 'WR', 'TE', 'RB', 'LB', 'DB'], skills: 'passing game, coverage', duration: 15 });
    mkDrill('team', { name: 'Team period', description: '11-on-11 vs scout look', points: 'Tempo; finish plays', equipment: 'Scout cards', unit: null, positions: [], skills: 'team', duration: 20 });
    mkDrill('punt', { name: 'Punt team', description: 'Protection and coverage lanes', points: 'Stay in lanes', equipment: 'Footballs', unit: 'special', positions: [], skills: 'special teams', duration: 10 });
    mkDrill('kick', { name: 'Kickoff coverage', description: 'Lane integrity and leverage', points: 'Squeeze the returner', equipment: 'Tees, cones', unit: 'special', positions: [], skills: 'special teams', duration: 8 });
    mkDrill('cond', { name: 'Conditioning', description: 'Gassers and finishers', points: 'Finish through the line', equipment: 'Cones', unit: null, positions: [], skills: 'conditioning', duration: 10 });

    const templateId = db.insert('practice_plans', { program_id: pid, name: 'Tuesday template', is_template: 1, start_time: '15:30', created_by: staff.head, notes: 'Standard Tuesday install day' });
    const tplPeriods = [
      ['dyn', null, [], 'Whole team', 'Main field', 10, 0, staff.sc],
      ['indy_qb', 'offense', ['QB'], 'QBs', 'Main field north', 10, 0, staff.qb],
      ['indy_wr', 'offense', ['WR', 'TE'], 'WR/TE', 'Main field north', 10, 0, staff.wr],
      ['indy_ol', 'offense', ['OL'], 'OL', 'Main field south', 10, 1, staff.ol],
      ['indy_dl', 'defense', ['DL'], 'DL', 'Sled area', 10, 1, staff.dl],
      ['indy_db', 'defense', ['DB'], 'DBs', 'Main field east', 10, 0, staff.db],
      ['tackle', 'defense', ['DL', 'LB', 'DB'], 'Defense', 'Main field east', 10, 1, staff.dc],
      ['7on7', null, ['QB', 'WR', 'TE', 'RB', 'LB', 'DB'], 'Skill', 'Main field', 15, 0, staff.oc],
      ['team', null, [], 'Team', 'Main field', 20, 1, staff.head],
      ['punt', 'special', [], 'Punt', 'Main field', 10, 0, staff.st],
      ['cond', null, [], 'Whole team', 'Main field', 10, 0, staff.sc],
    ];
    const addPeriods = (planId) => {
      tplPeriods.forEach(([d, unit, positions, label, loc, dur, contact, coach], i) => db.insert('periods', { plan_id: planId, sort: i, drill_id: drills[d], unit, positions, group_label: label, location: loc, duration: dur, contact, coach_id: coach }));
      let t = '2000-01-01T' + (db.get('SELECT start_time FROM practice_plans WHERE id=?', planId).start_time || '15:30');
      for (const p of db.all('SELECT id, duration FROM periods WHERE plan_id=? ORDER BY sort', planId)) { db.run('UPDATE periods SET start_time=? WHERE id=?', t.slice(11), p.id); t = addMinutes(t, p.duration); }
    };
    addPeriods(templateId);
    const vPractices = events.filter((e) => e.type === 'practice' && e.audience[0] === `team:${tV}`);
    const coaches = [staff.head, staff.oc, staff.dc, staff.qb, staff.wr, staff.ol, staff.dl, staff.lb, staff.db];
    const tags = [['went well'], ['needs work'], ['effort'], ['technique', 'needs work'], ['went well', 'effort'], ['assignment error']];
    // per-player base skill so trends look real
    const base = Object.fromEntries(players.map((p) => [p.id, 2.3 + rnd() * 2]));
    for (const e of vPractices) {
      const planId = db.insert('practice_plans', { program_id: pid, event_id: e.id, name: e.title, start_time: e.start.slice(11), created_by: staff.head });
      addPeriods(planId);
      if (e.start > now) continue;
      const date = e.start.slice(0, 10);
      const periods = db.all('SELECT * FROM periods WHERE plan_id=?', planId).map((p) => ({ ...p, positions: JSON.parse(p.positions) }));
      for (const per of periods) {
        db.run(`UPDATE periods SET status=? WHERE id=?`, rnd() > 0.92 ? 'skipped' : 'done', per.id);
        const group = vPlayers.filter((p) => (!per.unit || p.units.includes(per.unit)) && (!per.positions.length || p.positions.some((x) => per.positions.includes(x))));
        if (!['team', 'dyn', 'cond', 'punt'].includes(Object.keys(drills).find((k) => drills[k] === per.drill_id))) {
          for (const p of group) {
            if (rnd() > 0.45) continue;
            const v = Math.max(1, Math.min(5, Math.round(base[p.id] + (e.start > addDays(monday, -14) ? 0.4 : 0) + (rnd() - 0.5) * 1.6)));
            db.insert('ratings', { plan_id: planId, period_id: per.id, drill_id: per.drill_id, player_id: p.id, value: v, coach_id: per.coach_id || pick(coaches), date, season_id: seasonId });
          }
        }
        if (rnd() > 0.6 && group.length) {
          const p = pick(group);
          db.insert('practice_notes', { plan_id: planId, period_id: per.id, drill_id: per.drill_id, player_id: rnd() > 0.3 ? p.id : null, group_label: per.group_label, tags: pick(tags), text: pick(['Good burst off the line', 'Late on the read twice', 'Great communication', 'Hands too wide', 'Finished every rep', 'Needs to sink hips', '']), coach_id: per.coach_id || staff.head, date });
        }
      }
    }

    // ---------- Playbook ----------
    const off = (lbl, x, y, shape = 'O', extra = {}) => ({ id: lbl.toLowerCase() + '-' + x, label: lbl, shape, team: 'O', x, y, path: [], path_type: 'route', delay: 0, ...extra });
    const dff = (lbl, x, y, extra = {}) => ({ id: lbl.toLowerCase() + '-' + x, label: lbl, shape: 'X', team: 'D', x, y, path: [], path_type: 'coverage', delay: 0, ...extra });
    const line = () => [off('LT', 38, 32, 'O', { path: [[37, 35]], path_type: 'block' }), off('LG', 44, 32, 'O', { path: [[44, 35]], path_type: 'block' }), off('C', 50, 32, 'square', { path: [[50, 35]], path_type: 'block' }), off('RG', 56, 32, 'O', { path: [[56, 35]], path_type: 'block' }), off('RT', 62, 32, 'O', { path: [[63, 35]], path_type: 'block' })];
    const shotgun = () => [...line(), off('QB', 50, 38), off('RB', 56, 38), off('X', 10, 32), off('Z', 90, 33), off('H', 24, 33), off('Y', 76, 33)];
    const mkPlay = (pbk, name, formation, folder, tagsArr, players, points, assignments, quiz) => {
      const data = { players, ball: { x: 50, y: 31.5 }, quiz: quiz || [] };
      const id = db.insert('plays', { program_id: pid, playbook_id: pbk, name, side: players[0].team === 'D' ? 'defense' : 'offense', formation, folder, tags: tagsArr, data, coaching_points: points, assignments, version: 1, updated_by: staff.oc, updated_at: nowLocal() });
      db.insert('play_versions', { play_id: id, version: 1, snapshot: db.get('SELECT * FROM plays WHERE id=?', id), by_user: staff.oc, summary: 'Created' });
      return id;
    };
    const pbOff = db.insert('playbooks', { program_id: pid, name: 'Varsity offense', side: 'offense', description: 'Base spread offense' });
    const pbDef = db.insert('playbooks', { program_id: pid, name: 'Varsity defense', side: 'defense', description: '4-3 base, quarters coverage' });
    db.insert('playbooks', { program_id: pid, name: 'Special teams', side: 'special', description: 'Punt, kickoff, PAT' });
    const p1 = shotgun();
    p1.find((p) => p.label === 'X').path = [[10, 18], [18, 12]];
    p1.find((p) => p.label === 'Z').path = [[90, 22], [80, 22]];
    p1.find((p) => p.label === 'H').path = [[24, 24], [40, 14]];
    p1.find((p) => p.label === 'Y').path = [[76, 26], [70, 26]];
    p1.find((p) => p.label === 'RB').path = [[62, 36], [70, 30]];
    p1.find((p) => p.label === 'QB').path = [[50, 42]];
    const mesh = mkPlay(pbOff, 'Gun Trips Right — Smash', 'Gun 2x2', 'Pass / Quick game', ['3rd down', 'cover 2 beater', 'pass'], p1,
      'QB: high-low read on the flat defender. Throw the corner on squat, hitch on bail.', { QB: 'Read flat defender. Corner or hitch.', X: '12-yard corner, stem inside first', Z: '5-yard hitch, settle in the window', H: 'Post at 10', Y: 'Hitch', RB: 'Check release to flat', OL: 'Slide protection left' },
      [{ q: 'Who is the QB’s read on Smash?', options: ['Middle linebacker', 'Flat defender', 'Free safety'], answer: 1 }, { q: 'Depth of the corner route?', options: ['8 yards', '12 yards', '18 yards'], answer: 1 }]);
    const p2 = shotgun();
    p2.find((p) => p.label === 'RB').path = [[52, 34], [45, 26], [44, 14]]; p2.find((p) => p.label === 'RB').path_type = 'run';
    p2.find((p) => p.label === 'QB').path = [[55, 37]];
    for (const l of p2.filter((p) => ['LT', 'LG', 'C', 'RG', 'RT'].includes(p.label))) l.path = [[l.x - 4, 29]];
    p2.find((p) => p.label === 'H').motion = [[40, 36]];
    const zone = mkPlay(pbOff, 'Inside Zone Left', 'Gun 2x2', 'Run game', ['run', 'base'], p2, 'RB: press the A gap, one cut and go. OL: zone steps left, double to the backer.', { RB: 'Aim inside leg of the guard, read the first down lineman', OL: 'Zone step left, combine to the backside linebacker', QB: 'Mesh and read the backside end', H: 'Jet motion across, then block the edge' },
      [{ q: 'What is the RB’s aiming point?', options: ['Outside the tackle', 'Inside leg of the guard', 'Center’s hip'], answer: 1 }]);
    const p3 = shotgun();
    p3.find((p) => p.label === 'X').path = [[10, 8]]; p3.find((p) => p.label === 'Z').path = [[90, 8]];
    p3.find((p) => p.label === 'H').path = [[24, 20], [50, 20]]; p3.find((p) => p.label === 'Y').path = [[76, 24], [56, 24]];
    const fourVerts = mkPlay(pbOff, 'Four Verticals', 'Gun 2x2', 'Pass / Dropback', ['pass', '2-minute'], p3, 'Seams stay on the hash; outside receivers get vertical and stay outside the numbers.', { X: 'Go route, stay outside the numbers', Z: 'Go route', H: 'Seam, bend away from the safety', Y: 'Seam' });
    const d1 = [dff('E', 36, 27, { path: [[34, 34]], path_type: 'rush' }), dff('T', 46, 27, { path: [[46, 34]], path_type: 'rush' }), dff('N', 54, 27, { path: [[54, 34]], path_type: 'rush' }), dff('E', 64, 27, { path: [[66, 34]], path_type: 'rush' }),
      dff('W', 38, 21, { path: [[30, 18]] }), dff('M', 50, 20, { path: [[50, 14]] }), dff('S', 62, 21, { path: [[70, 18]] }), dff('C', 10, 24, { path: [[12, 10]] }), dff('C', 90, 24, { path: [[88, 10]] }), dff('FS', 35, 12, { path: [[32, 6]] }), dff('SS', 65, 12, { path: [[68, 6]] })];
    const quarters = mkPlay(pbDef, '4-3 Over — Cover 4', '4-3 Over', 'Base coverage', ['base', 'cover 4', 'early down'], d1, 'Safeties read #2. Corners deep quarter, eyes on #1.', { DL: 'Gap control, rush lanes', LB: 'Hook/curl drops, wall #2', DB: 'Quarters: read #2 to #1' });
    const d2 = d1.map((p) => ({ ...p, path: [...p.path] }));
    d2[5].path = [[50, 32]]; d2[5].path_type = 'rush'; d2[4].path = [[42, 33]]; d2[4].path_type = 'rush';
    const blitz = mkPlay(pbDef, 'Fire Zone — Will/Mike Cross', '4-3 Over', 'Pressure', ['blitz', '3rd down'], d2, 'Will and Mike cross the A and B gaps; end drops to the hook.', { LB: 'Mike A gap, Will B gap — time it at the snap' });
    db.insert('formations', { program_id: pid, name: 'Gun 2x2', side: 'offense', data: shotgun() });
    db.insert('formations', { program_id: pid, name: '4-3 Over', side: 'defense', data: d1.map((p) => ({ ...p, path: [] })) });
    db.insert('play_shares', { program_id: pid, play_id: mesh, audience: ['pos:QB', 'pos:WR', 'pos:TE'], by_user: staff.oc });
    db.insert('play_shares', { program_id: pid, playbook_id: pbDef, audience: ['unit:defense'], by_user: staff.dc });
    const install = db.insert('install_sheets', { program_id: pid, name: `Week ${Math.ceil((parseLocal(day + 'T00:00') - parseLocal(seasonStart + 'T00:00')) / 6048e5)} offense install`, play_ids: [mesh, zone, fourVerts], notes: 'Learn your assignment on each play before Tuesday practice.', audience: [`team:${tV}`, 'unit:offense'], created_by: staff.oc });
    for (const p of vPlayers.filter((p) => p.units.includes('offense')).slice(0, 14)) db.insert('play_views', { install_id: install, user_id: p.id, context: 'install' });
    // v2 playbook: positions, play tags (Group By / Playcaller), a few custom routes and play calls
    ensurePositions(db, pid);
    const tagPlay = (id, play_type, distance, down_distance) => db.run('UPDATE plays SET situation=? WHERE id=?', JSON.stringify({ play_type, distance, down_distance }), id);
    tagPlay(mesh, ['Pass'], ['Medium'], ['2nd & Medium', '3rd & Medium']);
    tagPlay(zone, ['Run'], ['Short'], ['1st & 10', '2nd & Short', '3rd & Short', 'Goal line']);
    tagPlay(fourVerts, ['Pass'], ['Long'], ['2nd & Long', '3rd & Long', '2-minute']);
    tagPlay(quarters, ['Base', 'Zone', 'Coverage'], ['Medium', 'Long'], ['1st & 10', '2nd & Long']);
    tagPlay(blitz, ['Blitz', 'Zone'], ['Short', 'Medium'], ['3rd & Short', '3rd & Medium', 'Red zone']);
    db.insert('formations', { program_id: pid, name: 'Gun Trips Right', side: 'offense', data: shotgun().map((p) => (p.label === 'H' ? { ...p, x: 70, y: 33 } : p.label === 'Y' ? { ...p, x: 80, y: 32 } : p)) });
    db.insert('formations', { program_id: pid, name: 'Nickel 4-2-5', side: 'defense', data: d1.map((p) => ({ ...p, path: [] })).map((p) => (p.label === 'S' ? { ...p, label: 'N', x: 72, y: 24 } : p)) });
    const rt = (name, grp, points, smart = 1, type = 'route') => db.insert('pb_routes', { program_id: pid, name, grp, side: 'O', smart, data: { points, type, opts: [] }, created_by: staff.oc, updated_at: nowLocal() });
    rt('12-yard dig', 'Ridgeview concepts', [[0, -13], [9, -13]]);
    rt('Bench (7-yard out-and-up)', 'Ridgeview concepts', [[0, -8], [-4, -10, 1], [-6, -16, 1]]);
    rt('Snag', 'Ridgeview concepts', [[1, -5], [0.5, -6.5]]);
    for (const [play_id, down, distance, result, mins] of [[zone, 1, 10, '+4', 95], [mesh, 2, 6, '+8, first down', 90], [fourVerts, 3, 9, 'Incomplete', 60], [zone, 3, 2, '+3, first down', 30]]) {
      db.insert('pb_calls', { program_id: pid, playbook_id: pbOff, play_id, play_name: db.get('SELECT name FROM plays WHERE id=?', play_id).name, down, distance, result, by_user: staff.oc, at: addMinutes(nowLocal(), -mins) });
    }

    // ---------- Depth charts ----------
    const SL = {
      offense: [['QB', 'QB'], ['RB', 'RB'], ['WR-X', 'WR'], ['WR-Z', 'WR'], ['WR-S', 'WR'], ['TE', 'TE'], ['LT', 'OL'], ['LG', 'OL'], ['C', 'OL'], ['RG', 'OL'], ['RT', 'OL']],
      defense: [['DE-L', 'DL'], ['DT-L', 'DL'], ['DT-R', 'DL'], ['DE-R', 'DL'], ['WLB', 'LB'], ['MLB', 'LB'], ['SLB', 'LB'], ['CB-L', 'DB'], ['CB-R', 'DB'], ['FS', 'DB'], ['SS', 'DB']],
      special: [['K', 'K'], ['P', 'P'], ['LS', 'LS'], ['H', 'QB'], ['KR', 'RET'], ['PR', 'RET'], ['GUN-L', 'DB'], ['GUN-R', 'WR']],
    };
    for (const [unit, slots] of Object.entries(SL)) {
      const used = {};
      const mk = () => {
        const out = {};
        for (const [slot, pos] of slots) {
          const pool = vPlayers.filter((p) => p.positions.includes(pos));
          used[pos] ||= 0;
          const n = pos === 'OL' || pos === 'DL' || pos === 'DB' || pos === 'WR' || pos === 'LB' ? 2 : 3;
          out[slot] = pool.slice(used[pos], used[pos] + n).map((p) => p.id);
          if (['OL', 'DL', 'DB', 'WR', 'LB'].includes(pos)) used[pos] += 1;
          if (!out[slot].length) out[slot] = pool.slice(0, 2).map((p) => p.id);
        }
        return out;
      };
      const last = mk();
      db.insert('depth_charts', { program_id: pid, team_id: tV, unit, week_label: `Week of ${addDays(monday, -7)}`, season_id: seasonId, slots: last, visible_to_players: 1, updated_by: staff.head });
      const cur = JSON.parse(JSON.stringify(last));
      const k = Object.keys(cur)[1];
      if (cur[k].length > 1) cur[k] = [cur[k][1], cur[k][0], ...cur[k].slice(2)];
      const cid = db.insert('depth_charts', { program_id: pid, team_id: tV, unit, week_label: `Week of ${monday}`, season_id: seasonId, slots: cur, visible_to_players: unit !== 'special' ? 1 : 0, updated_by: staff.head });
      if (cur[k].length > 1) db.insert('audit', { program_id: pid, user_id: staff.head, action: 'depth_move', entity: 'player', entity_id: cur[k][0], detail: JSON.stringify({ chart: cid, week: `Week of ${monday}`, unit, slot: k, from: 2, to: 1 }), at: `${monday} 08:00` });
    }

    // ---------- Weight room ----------
    const ex = {};
    const mkEx = (k, name, cat, cues, test) => { ex[k] = db.insert('exercises', { program_id: pid, name, category: cat, cues, test_key: test || null, video_url: null }); };
    mkEx('squat', 'Back squat', 'Lower', 'Brace, knees out, hit depth', 'squat');
    mkEx('bench', 'Bench press', 'Upper', 'Shoulder blades pinned, bar to sternum', 'bench');
    mkEx('clean', 'Hang power clean', 'Olympic', 'Hips through, fast elbows', 'clean');
    mkEx('rdl', 'Romanian deadlift', 'Lower', 'Hinge, soft knees', 'deadlift');
    mkEx('split', 'Rear-foot split squat', 'Lower', 'Tall torso', null);
    mkEx('row', 'DB row', 'Upper', 'Pull to hip', null);
    mkEx('press', 'Incline DB press', 'Upper', 'Control the eccentric', null);
    mkEx('neck', 'Neck series', 'Prehab', '4-way, slow', null);
    mkEx('trap', 'Trap bar deadlift', 'Lower', 'Push the floor away', null);
    mkEx('leg', 'Goblet squat', 'Lower', 'Alternative for limited players', null);
    const daysArr = [];
    for (let w = 1; w <= 4; w++) {
      const pct = [70, 75, 80, 65][w - 1];
      daysArr.push({ week: w, day: 1, label: 'Lower + power', exercises: [{ exercise_id: ex.clean, sets: 3, reps: '3', pct: pct - 5, rest: '2:00' }, { exercise_id: ex.squat, sets: 4, reps: w === 3 ? '3' : '5', pct, rest: '2:30' }, { exercise_id: ex.rdl, sets: 3, reps: '8', rest: '1:30' }, { exercise_id: ex.neck, sets: 2, reps: '10' }] });
      daysArr.push({ week: w, day: 2, label: 'Upper', exercises: [{ exercise_id: ex.bench, sets: 4, reps: w === 3 ? '3' : '5', pct, rest: '2:30' }, { exercise_id: ex.row, sets: 3, reps: '10', rest: '1:30' }, { exercise_id: ex.press, sets: 3, reps: '8' }] });
    }
    const wtProg = db.insert('wt_programs', { program_id: pid, name: 'In-season strength (4 weeks)', description: 'Two days a week, maintain strength and power', weeks: 4, days: daysArr, is_template: 0, created_by: staff.sc });
    db.insert('wt_programs', { program_id: pid, name: 'Summer base template', description: '4 days a week hypertrophy and strength', weeks: 6, days: daysArr.slice(0, 2).map((d) => ({ ...d })), is_template: 1, created_by: staff.sc });
    const wtStart = addDays(monday, -14);
    const wtA = db.insert('wt_assignments', { program_id: pid, wt_program_id: wtProg, audience: [`team:${tV}`], start_date: wtStart, season_id: seasonId, created_by: staff.sc });
    const injured = vPlayers.find((p) => p.pos === 'RB');
    db.insert('wt_overrides', { assignment_id: wtA, player_id: injured.id, exercise_id: ex.squat, alt_exercise_id: ex.leg, note: 'Knee: goblet squat until cleared' });
    // tests
    for (const p of players) {
      const strength = p.bigs ? 1.25 : 1;
      const lvl = p.team === tV ? 1 : p.team === tF ? 0.75 : 0.88;
      const sq = Math.round((int(225, 335) * strength * lvl) / 5) * 5; const bn = Math.round((int(165, 245) * strength * lvl) / 5) * 5; const cl = Math.round((int(155, 225) * strength * lvl) / 5) * 5;
      const forty = Math.round((4.6 + rnd() * 0.6 + (p.bigs ? 0.45 : 0) + (1 - lvl)) * 100) / 100;
      for (const [d, g] of [[`${year}-06-05`, 0], [`${year}-08-05`, 1], [`${year}-10-07`, 2]]) {
        db.insert('tests', { player_id: p.id, test_key: 'squat', value: sq + g * int(5, 20), date: d, by_user: staff.sc, season_id: seasonId });
        db.insert('tests', { player_id: p.id, test_key: 'bench', value: bn + g * int(0, 15), date: d, by_user: staff.sc, season_id: seasonId });
        db.insert('tests', { player_id: p.id, test_key: 'clean', value: cl + g * int(0, 15), date: d, by_user: staff.sc, season_id: seasonId });
        if (g !== 1) db.insert('tests', { player_id: p.id, test_key: 'forty', value: Math.round((forty - g * 0.04 * rnd()) * 100) / 100, date: d, by_user: staff.sc, season_id: seasonId });
        if (g !== 1) db.insert('tests', { player_id: p.id, test_key: 'vertical', value: int(20, 32) + g, date: d, by_user: staff.sc, season_id: seasonId });
      }
    }
    // logs for the first two weeks
    for (const p of vPlayers) {
      if (rnd() < 0.15) continue;
      for (const d of daysArr.filter((x) => x.week <= 2)) {
        if (rnd() < 0.12) continue;
        const date = addDays(wtStart, (d.week - 1) * 7 + (d.day - 1));
        for (const x of d.exercises) {
          const exId = p.id === injured.id && x.exercise_id === ex.squat ? ex.leg : x.exercise_id;
          for (let set = 1; set <= x.sets; set++) db.insert('wt_logs', { player_id: p.id, assignment_id: wtA, week: d.week, day: d.day, exercise_id: exId, set_no: set, reps: Number(x.reps), weight: x.pct ? int(135, 275) : int(25, 70), date });
        }
      }
    }
    // meal plans
    const meal = db.insert('meal_plans', { program_id: pid, name: 'Game-week fueling', meals: [{ name: 'Breakfast', time: '07:00', description: 'Eggs, oatmeal, fruit' }, { name: 'Lunch', time: '11:45', description: 'Lean protein, rice, vegetables' }, { name: 'Pre-practice snack', time: '15:00', description: 'Banana and peanut butter' }, { name: 'Dinner', time: '19:00', description: 'Protein, potatoes, salad' }], hydration_oz: 100, notes: 'Hydrate all day; extra fluids before Friday', audience: [`team:${tV}`], approved_by: staff.at, locked: 1, created_by: staff.at });
    db.insert('meal_plans', { program_id: pid, name: 'Lineman weight gain (template)', meals: [{ name: 'Breakfast', time: '07:00', description: '' }, { name: 'Lunch', time: '12:00', description: '' }, { name: 'Snack', time: '15:00', description: '' }, { name: 'Dinner', time: '19:00', description: '' }, { name: 'Night snack', time: '21:00', description: '' }], hydration_oz: 120, is_template: 1, approved_by: staff.at, created_by: staff.at });
    for (const p of vPlayers) for (let d = -5; d <= -1; d++) for (let m = 0; m < 4; m++) if (rnd() > 0.35) db.run('INSERT OR IGNORE INTO meal_logs (plan_id, player_id, date, meal_idx, done) VALUES (?,?,?,?,1)', meal, p.id, addDays(day, d), m);
    db.run('UPDATE player_profiles SET nutrition_opt_out=1 WHERE user_id=?', vPlayers[7].id);

    // ---------- Communication ----------
    const ann = (title, body, audience, by, at) => {
      const id = db.insert('announcements', { program_id: pid, title, body, audience, by_user: by, at });
      const rec = [...new Set([...db.all(`SELECT id FROM users WHERE program_id=? AND role IN ('head_coach','coach','trainer','staff')`, pid).map((r) => r.id), ...(audience.includes('program') ? db.all(`SELECT id FROM users WHERE program_id=? AND role IN ('player','parent')`, pid).map((r) => r.id) : vPlayers.map((p) => p.id))])].filter((x) => x !== by);
      for (const u of rec) db.insert('notifications', { user_id: u, kind: 'announcement', title, body, link: `/messages/announcements/${id}`, ref: `ann:${id}`, created_at: at, deliver_at: at.replace(' ', 'T'), opened_at: rnd() > 0.35 ? at : null });
    };
    ann('Picture day Thursday', 'Team and individual photos Thursday before practice. Wear home jerseys.', ['program'], staff.head, `${addDays(day, -3)} 12:10`);
    ann('Playoff tickets', 'Players get two passes each for the playoff game. Pick them up from Coach Hale.', [`team:${tV}`], staff.head, `${addDays(day, -1)} 16:40`);
    const chat = (name, kind, audience, members, by) => {
      const id = db.insert('chats', { program_id: pid, name, kind, audience, allow_players: 1, allow_parents: 0, created_by: by });
      for (const m of new Set(members)) db.run('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?,?)', id, m);
      return id;
    };
    const coachIds = Object.values(staff);
    const teamChat = chat('Varsity team', 'team', [`team:${tV}`], [staff.head, staff.oc, staff.dc, staff.st, ...vPlayers.map((p) => p.id)], staff.head);
    const wrChat = chat('WR room', 'position', ['pos:WR'], [staff.wr, staff.oc, ...players.filter((p) => p.team === tV && p.positions.includes('WR')).map((p) => p.id)], staff.wr);
    const staffChat = chat('Coaching staff', 'staff', ['coaches'], coachIds, staff.head);
    const capChat = chat('Captains', 'group', [`group:${captains}`], [staff.head, staff.oc, ...db.all('SELECT user_id FROM group_members WHERE group_id=?', captains).map((r) => r.user_id)], staff.head);
    const msg = (c, u, body, at) => db.insert('messages', { chat_id: c, user_id: u, body, at, deliver_at: at.replace(' ', 'T') });
    msg(teamChat, staff.head, 'Great week of practice. Walkthrough is helmets only tomorrow.', `${addDays(day, -2)} 18:05`);
    msg(teamChat, vPlayers[3].id, 'What time is the bus Friday?', `${addDays(day, -2)} 18:20`);
    msg(teamChat, staff.oc, 'Bus leaves 4:15. Report time is 5:00 at the stadium for home games.', `${addDays(day, -2)} 18:31`);
    msg(wrChat, staff.wr, 'Watch the Smash install before Tuesday. Corner depth is 12.', `${addDays(day, -1)} 15:02`);
    msg(staffChat, staff.dc, 'Need the scout team cards printed by 2pm.', `${addDays(day, -1)} 09:12`);
    msg(staffChat, staff.head, 'On it. Also: Lakeside film is up.', `${addDays(day, -1)} 09:30`);
    msg(capChat, staff.head, 'Captains meeting Wednesday at lunch, room 114.', `${addDays(day, -1)} 11:00`);
    const flaggedMsg = msg(teamChat, vPlayers[9].id, 'that drill was stupid lol', `${addDays(day, -1)} 19:40`);
    db.run('UPDATE messages SET flagged=1 WHERE id=?', flaggedMsg);
    db.insert('message_reports', { message_id: flaggedMsg, by_user: null, reason: 'Automatic flag: possible risky language' });

    // ---------- Equipment ----------
    const tHelmet = db.insert('eq_types', { program_id: pid, name: 'Helmet', category: 'helmet', brand: 'Riddell', model: 'SpeedFlex', tracking: 'serial', cost: 425, low_stock: 3 });
    const tShoulder = db.insert('eq_types', { program_id: pid, name: 'Shoulder pads', category: 'shoulder pads', brand: 'Douglas', model: 'CP Series', tracking: 'serial', cost: 280, low_stock: 3 });
    const tJersey = db.insert('eq_types', { program_id: pid, name: 'Game jersey (home)', category: 'jersey', tracking: 'bulk', cost: 85, low_stock: 2 });
    const tPants = db.insert('eq_types', { program_id: pid, name: 'Game pants', category: 'pants', tracking: 'bulk', cost: 55, low_stock: 2 });
    const tShirt = db.insert('eq_types', { program_id: pid, name: 'Practice shirt', category: 'practice gear', tracking: 'bulk', cost: 18, low_stock: 5 });
    db.insert('eq_types', { program_id: pid, name: 'Girdle with pads', category: 'pads', tracking: 'bulk', cost: 40, low_stock: 3 });
    const sizes = ['S', 'M', 'L', 'XL', '2XL'];
    const helmets = [];
    for (let i = 0; i < 70; i++) {
      const mY = year - int(1, 11);
      helmets.push(db.insert('eq_items', { type_id: tHelmet, serial: `RH-${10400 + i}`, size: pick(['M', 'L', 'XL']), condition: pick(['good', 'good', 'fair']), manuf_year: mY, recert_year: rnd() > 0.15 ? year - int(0, 2) : null, recert_facility: 'NOCSAE-licensed reconditioner', allows_recert: i % 23 === 0 ? 0 : 1 }));
    }
    const pads = [];
    for (let i = 0; i < 65; i++) pads.push(db.insert('eq_items', { type_id: tShoulder, serial: `SP-${5200 + i}`, size: pick(sizes), condition: 'good' }));
    for (const sz of sizes) { db.insert('eq_items', { type_id: tJersey, size: sz, qty: int(3, 12) }); db.insert('eq_items', { type_id: tPants, size: sz, qty: int(1, 10) }); db.insert('eq_items', { type_id: tShirt, size: sz, qty: int(10, 40) }); }
    vPlayers.forEach((p, i) => {
      if (i < helmets.length) db.insert('eq_issues', { program_id: pid, item_id: helmets[i], type_id: tHelmet, player_id: p.id, size: 'L', qty: 1, season_id: seasonId, issued_at: `${year}-07-28`, condition_out: 'good', issued_by: staff.eq, acknowledged_at: rnd() > 0.3 ? `${year}-07-29T10:00` : null });
      if (i < pads.length) db.insert('eq_issues', { program_id: pid, item_id: pads[i], type_id: tShoulder, player_id: p.id, size: 'L', qty: 1, season_id: seasonId, issued_at: `${year}-07-28`, condition_out: 'good', issued_by: staff.eq });
      const jItem = db.get('SELECT id FROM eq_items WHERE type_id=? AND size=?', tJersey, pick(sizes)).id;
      db.insert('eq_issues', { program_id: pid, item_id: jItem, type_id: tJersey, player_id: p.id, size: 'L', qty: 1, season_id: seasonId, issued_at: `${year}-08-20`, condition_out: 'new', issued_by: staff.eq });
      if (i < helmets.length) db.insert('helmet_fits', { item_id: helmets[i], player_id: p.id, season_id: seasonId, date: `${year}-07-28`, notes: 'Good fit, 2 fingers above brow', by_user: staff.eq });
    });
    // last season returns history
    const lastSeasonPlayer = vPlayers[0];
    db.insert('eq_issues', { program_id: pid, item_id: helmets[60], type_id: tHelmet, player_id: lastSeasonPlayer.id, size: 'L', qty: 1, issued_at: `${year - 1}-07-30`, condition_out: 'good', returned_at: `${year - 1}-12-01`, return_status: 'returned', condition_in: 'fair', issued_by: staff.eq, received_by: staff.eq });

    // ---------- Assignments and forms ----------
    const asn = (o, done) => {
      const id = db.insert('assignments', { program_id: pid, season_id: seasonId, created_by: staff.oc, checklist: [], play_ids: [], ...o });
      const aud = o.audience;
      const ids = aud[0] === `team:${tV}` ? vPlayers.map((p) => p.id) : aud[0] === 'unit:offense' ? vPlayers.filter((p) => p.units.includes('offense')).map((p) => p.id) : aud[0] === 'pos:WR' ? players.filter((p) => p.positions.includes('WR')).map((p) => p.id) : vPlayers.map((p) => p.id);
      for (const pidd of ids) {
        const r = rnd();
        const st = r < done ? 'completed' : r < done + 0.15 ? 'in_progress' : 'not_started';
        db.insert('assignment_status', { assignment_id: id, player_id: pidd, status: st, submitted_at: st === 'completed' ? (o.due && o.due < now ? addMinutes(o.due, -int(60, 2000)) : now) : null, response: st === 'completed' && o.type === 'submit' ? 'I need to work on my first step and stay low out of my stance.' : null, progress: o.type === 'complete' && st !== 'not_started' ? { 0: true } : {} });
      }
      return id;
    };
    asn({ title: `Film: ${opponents[3]} defense`, instructions: 'Watch the first half cut-up. Note their coverage on 3rd down.', type: 'watch', due: `${addDays(day, 1)}T21:00`, audience: [`team:${tV}`], video_url: 'https://example.com/film/scout-cutup' }, 0.55);
    asn({ title: 'Study: offense install', instructions: 'Know your assignment on each play.', type: 'study', due: `${addDays(day, -1)}T21:00`, audience: ['unit:offense'], install_id: install }, 0.7);
    asn({ title: 'Weekly self-check', instructions: 'Complete each item.', type: 'complete', due: `${addDays(day, 3)}T21:00`, audience: [`team:${tV}`], checklist: ['Watched film', 'Hydration plan followed', 'Grades checked'], recurring: { freq: 'weekly', count: 1 } }, 0.3);
    asn({ title: 'Post-game self-evaluation', instructions: 'What went well, what needs work, one goal for next week.', type: 'submit', due: `${addDays(day, -3)}T21:00`, audience: [`team:${tV}`] }, 0.6);
    asn({ title: 'Smash quiz', instructions: 'Answer the questions on Smash and Inside Zone.', type: 'quiz', due: `${addDays(day, 2)}T21:00`, audience: ['pos:WR'], play_ids: [mesh, zone] }, 0.2);
    asn({ title: 'Weekly film template', type: 'watch', video_url: 'https://example.com/film', audience: [], is_template: 1 }, 0);
    const form = db.insert('forms', { program_id: pid, title: 'End-of-week check-in', description: 'Takes one minute. Only your position coach and the trainer see this.', questions: [{ type: 'scale', label: 'How does your body feel? (1-5)', required: true }, { type: 'yesno', label: 'Any pain we should know about?' }, { type: 'text', label: 'Anything else for your coach?' }], audience: [`team:${tV}`], share_with: ['head_coach', 'trainer', 'coach'], due: `${addDays(day, 2)}T21:00`, created_by: staff.head });
    for (const p of vPlayers.slice(0, 25)) db.insert('form_responses', { form_id: form, player_id: p.id, answers: [String(int(2, 5)), rnd() > 0.85 ? 'yes' : 'no', rnd() > 0.7 ? 'Hamstring a little tight' : ''], at: `${addDays(day, -1)}T20:00` });

    // ---------- Goals and evaluations ----------
    for (const p of vPlayers.slice(0, 20)) {
      db.insert('dev_goals', { program_id: pid, player_id: p.id, title: 'Squat +20 lb by end of season', kind: 'test', test_key: 'squat', baseline: db.get(`SELECT value FROM tests WHERE player_id=? AND test_key='squat' ORDER BY date LIMIT 1`, p.id).value, target: db.get(`SELECT value FROM tests WHERE player_id=? AND test_key='squat' ORDER BY date LIMIT 1`, p.id).value + 20, due: seasonEnd, season_id: seasonId, by_user: staff.sc });
    }
    db.insert('dev_goals', { program_id: pid, player_id: demoQB.id, title: 'Footwork on 3-step drops', kind: 'skill', progress: 60, due: seasonEnd, season_id: seasonId, by_user: staff.qb, notes: 'Quicker reset after hitch' });
    for (const p of vPlayers.slice(0, 30)) {
      const unit = p.units[0];
      const crit = { offense: ['Technique', 'Assignment knowledge', 'Effort', 'Physicality', 'Ball skills', 'Football IQ'], defense: ['Technique', 'Assignment knowledge', 'Effort', 'Tackling', 'Pursuit', 'Football IQ'], special: ['Technique', 'Consistency', 'Effort', 'Composure'] }[unit];
      for (const point of ['preseason', 'midseason']) db.insert('evaluations', { program_id: pid, player_id: p.id, season_id: seasonId, point, position: p.pos, scores: Object.fromEntries(crit.map((c) => [c, int(2, 5)])), notes: '', by_user: staff.head, at: point === 'preseason' ? `${year}-08-20 10:00` : `${year}-10-01 10:00` });
    }

    // a few availability changes and notifications
    for (const p of vPlayers.filter((x) => x.pos === 'LB').slice(0, 2)) {
      db.run(`UPDATE player_profiles SET availability='limited', avail_note='Ankle sprain, no live contact', return_date=? WHERE user_id=?`, addDays(day, 5), p.id);
      db.insert('audit', { program_id: pid, user_id: staff.at, action: 'set_availability', entity: 'player', entity_id: p.id, detail: JSON.stringify({ availability: 'limited', return_date: addDays(day, 5) }), at: `${addDays(day, -1)} 16:10` });
    }
    db.insert('notifications', { user_id: staff.head, kind: 'update', title: 'Welcome to Program Manager', body: 'Demo data is loaded. Sign in as any role from the sign-in page.', created_at: nowLocal(), deliver_at: nowLocal() });
    // v2 football operations demo data (server/seed-football.js)
    seedFootball(db, { pid, staff, players, demoQB, demoParent, seasonId, tV, tJR, tJB, tF, year });
    // v2 weight room demo data (server/strength-seed.js)
    seedWeightRoom(db, { pid, staff, players, vPlayers, teams: { tV, tJR, tJB, tF }, levels: { varsity, jv, fr }, wtA, wtProg, monday, day, rnd, int, pick });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { createApp } = await import('./app.js');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const file = process.env.DB_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'app.db');
  for (const f of [file, file + '-wal', file + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
  const app = createApp({ dbFile: file });
  seed(app.db);
  console.log('Seeded', file);
  app.close();
}
