// Demo data for the v2 weight room (called from seed.js inside its transaction).
import { addDays, nowLocal } from './core.js';
import { ensureLibrary, ensureTemplates, exerciseIdByName, groupOf, CLUBS } from './strength-data.js';

export function seedWeightRoom(db, { pid, staff, players, vPlayers, teams, levels, wtA, wtProg, monday, day, rnd, int, pick }) {
  ensureLibrary(db, pid);
  ensureTemplates(db, pid, staff.sc);
  const ex = (name) => exerciseIdByName(db, pid, name);
  const tpl = (key) => db.get('SELECT p.* FROM wt_programs p JOIN wt_program_meta m ON m.wt_program_id=p.id WHERE p.program_id=? AND m.template_key=?', pid, key);
  const copy = (key, name, meta, by = staff.sc) => {
    const t = tpl(key);
    const id = db.insert('wt_programs', { program_id: pid, name, description: t.description, weeks: t.weeks, days: t.days, is_template: 0, created_by: by });
    const m = db.get('SELECT * FROM wt_program_meta WHERE wt_program_id=?', t.id);
    db.insert('wt_program_meta', { wt_program_id: id, mode: meta.mode || m.mode, kind: m.kind, phase: m.phase, position_group: meta.position_group || m.position_group, template_key: key, builtin: 0 });
    return { id, days: JSON.parse(t.days) };
  };
  const post = (o) => db.run('INSERT OR IGNORE INTO wt_feed (program_id, team_id, kind, title, body, player_id, by_user, ref, at) VALUES (?,?,?,?,?,?,?,?,?)', pid, o.team_id ?? null, o.kind, o.title, o.body || null, o.player_id ?? null, o.by_user ?? null, o.ref ?? null, o.at);

  // The seeded in-season block is a dated program for Varsity, with group-level changes (C-7)
  db.insert('wt_program_meta', { wt_program_id: wtProg, mode: 'dated', kind: 'lift', phase: 'in_season' });
  db.insert('wt_group_overrides', { assignment_id: wtA, group_token: 'pos:QB', exercise_id: ex('Bench press'), alt_exercise_id: ex('Dumbbell bench press'), note: 'QBs: dumbbells to protect the throwing shoulder', by_user: staff.sc });
  db.insert('wt_group_overrides', { assignment_id: wtA, group_token: 'pos:OL', exercise_id: ex('Back squat'), alt_exercise_id: ex('Safety bar squat'), note: 'OL: safety bar for shoulder health', by_user: staff.sc });
  db.insert('wt_group_overrides', { assignment_id: wtA, group_token: 'pg:K/P', exercise_id: null, sets: 2, note: 'Specialists: two working sets', by_user: staff.sc });

  // Freshman: dateless summer strength block (C-8) with the first sessions logged
  const fr = players.filter((p) => p.team === teams.tF);
  const dl = copy('phase-summer-strength', 'Freshman strength (work through in order)', { mode: 'dateless' });
  const frA = db.insert('wt_assignments', { program_id: pid, wt_program_id: dl.id, audience: [`level:${levels.fr}`], start_date: addDays(monday, -21), created_by: staff.frh });
  for (const p of fr) {
    const n = int(0, 4);
    dl.days.sort((a, b) => a.week - b.week || a.day - b.day).slice(0, n).forEach((d, i) => {
      const date = addDays(day, -2 * (n - i));
      for (const x of d.exercises) for (let s = 1; s <= x.sets; s++) db.insert('wt_logs', { player_id: p.id, assignment_id: frA, week: d.week, day: d.day, exercise_id: x.exercise_id, set_no: s, reps: Number.parseInt(x.reps, 10) || 5, weight: x.pct ? int(95, 185) : int(15, 45), date });
    });
  }
  // JV: game-week lift (F-5), scales by days to the JV game
  const gwp = copy('game-week', 'Game week: JV', { mode: 'game_week' });
  db.insert('wt_assignments', { program_id: pid, wt_program_id: gwp.id, audience: [`level:${levels.jv}`], start_date: monday, created_by: staff.jvh });
  // Specialists: K/P starter block assigned to the position group in one step (F-1)
  const kp = copy('pos-k-p', 'K/P starter block: K/P', { position_group: 'K/P' });
  db.insert('wt_assignments', { program_id: pid, wt_program_id: kp.id, audience: ['pos:K', 'pos:P'], start_date: addDays(monday, -7), created_by: staff.st });

  // F-6 battery: 10-yard split, pro agility, L-drill and broad jump for every athlete; a few rep tests
  const year = Number(day.slice(0, 4));
  for (const p of players) {
    const forty = db.get(`SELECT value FROM tests WHERE player_id=? AND test_key='forty' ORDER BY date LIMIT 1`, p.id)?.value || 5;
    for (const [d, g] of [[`${year}-06-05`, 0], [`${year}-10-07`, 1]]) {
      db.insert('tests', { player_id: p.id, test_key: 'ten_split', value: Math.round((forty * 0.345 - g * 0.02 + (rnd() - 0.5) * 0.04) * 100) / 100, date: d, by_user: staff.sc });
      db.insert('tests', { player_id: p.id, test_key: 'pro_agility', value: Math.round((forty * 0.93 - g * 0.06 + (rnd() - 0.5) * 0.2) * 100) / 100, date: d, by_user: staff.sc });
      db.insert('tests', { player_id: p.id, test_key: 'l_drill', value: Math.round((forty * 1.5 - g * 0.08 + (rnd() - 0.5) * 0.3) * 100) / 100, date: d, by_user: staff.sc });
      db.insert('tests', { player_id: p.id, test_key: 'broad', value: Math.round(150 - forty * 10 + g * int(1, 4) + int(-6, 6)), date: d, by_user: staff.sc });
    }
  }
  for (const p of vPlayers.slice(0, 10)) {
    const best = db.get(`SELECT max(value) v FROM tests WHERE player_id=? AND test_key='bench'`, p.id).v;
    const w = Math.round((best * 0.85) / 5) * 5; const reps = 5;
    const id = db.insert('tests', { player_id: p.id, test_key: 'bench', value: Math.round(w * (1 + reps / 30)), date: addDays(day, -12), by_user: staff.sc });
    db.insert('test_details', { test_id: id, weight: w, reps, method: 'epley' });
  }
  // Testing-day height and weight (coach-only measurements)
  for (const p of vPlayers.slice(0, 30)) {
    const w = db.get(`SELECT value FROM measurements WHERE player_id=? AND kind='weight' ORDER BY date DESC LIMIT 1`, p.id)?.value;
    if (w) db.insert('measurements', { player_id: p.id, kind: 'weight', value: w + int(-3, 4), date: `${year}-10-07`, by_user: staff.sc });
  }

  // C-15: training maxes from recent sessions for a dozen varsity athletes, with PR posts
  const teamOf = Object.fromEntries(players.map((p) => [p.id, p.team]));
  for (const p of vPlayers.filter((_, i) => i % 4 === 1).slice(0, 12)) {
    for (const key of ['squat', 'bench']) {
      const cur = db.get('SELECT max(value) v FROM tests WHERE player_id=? AND test_key=?', p.id, key).v;
      const reps = pick([3, 4, 5]); const weight = Math.round(((cur + int(5, 20)) / (1 + reps / 30)) / 5) * 5; const e1 = Math.round(weight * (1 + reps / 30));
      if (e1 <= cur) continue;
      const date = addDays(day, -int(1, 9));
      const id = db.insert('training_maxes', { player_id: p.id, test_key: key, value: e1, date, source: 'session', exercise_id: ex(key === 'squat' ? 'Back squat' : 'Bench press'), weight, reps, prev_value: cur, pr: 1 });
      post({ team_id: teamOf[p.id], kind: 'pr', title: `${p.name}: new ${key === 'squat' ? 'back squat' : 'bench press'} PR, ${e1} lb`, body: `Estimated from ${weight} x ${reps}`, player_id: p.id, ref: `pr:tm:${id}`, at: `${date} 07:${String(int(10, 40))}` });
    }
  }
  // F-19 milestone clubs from this season's results
  let clubPosts = 0;
  for (const p of vPlayers) {
    if (clubPosts >= 24) break;
    for (const c of CLUBS) {
      const lower = c.lower;
      const best = db.get(`SELECT ${lower ? 'min' : 'max'}(v) v FROM (SELECT value v FROM tests WHERE player_id=? AND test_key=? UNION ALL SELECT value FROM training_maxes WHERE player_id=? AND test_key=?)`, p.id, c.key, p.id, c.key).v;
      if (best == null) continue;
      const top = c.thresholds.filter((t) => (lower ? best < t : best >= t)).pop();
      if (top == null || (c.key !== 'forty' && top === c.thresholds[0] && rnd() < 0.6)) continue;
      clubPosts++;
      post({ team_id: teamOf[p.id], kind: 'milestone', title: `${p.name} joined the ${c.label(top)}`, body: `Best ${c.key === 'forty' ? '40-yard dash' : c.key}: ${best}`, player_id: p.id, ref: `club:${p.id}:${c.key}:${top}`, at: `${year}-10-07 ${String(int(15, 17))}:${String(int(10, 59))}` });
    }
  }
  // Coach posts and last week's awards
  post({ team_id: teams.tV, kind: 'coach', title: 'Lift times move to 6:45 on game weeks', body: 'Doors open at 6:35. Be dressed and on your platform by 6:45.', by_user: staff.sc, at: `${addDays(day, -4)} 18:10` });
  post({ team_id: null, kind: 'coach', title: 'Testing day is the first Monday after the season', body: '40, pro agility, vertical, broad, and a 5-rep bench test. Sleep and hydrate the weekend before.', by_user: staff.head, at: `${addDays(day, -2)} 12:00` });
  post({ team_id: teams.tF, kind: 'coach', title: 'Freshmen: work through your sessions in order', body: 'Your program is dateless. The app shows your next session; log every set.', by_user: staff.frh, at: `${addDays(day, -6)} 15:00` });
  const lastWeek = addDays(monday, -7);
  for (const t of [teams.tV]) {
    const top = db.get(`SELECT l.player_id, u.name, count(*) n FROM wt_logs l JOIN users u ON u.id=l.player_id JOIN player_profiles pp ON pp.user_id=u.id WHERE pp.team_id=? GROUP BY l.player_id ORDER BY n DESC LIMIT 1`, t);
    if (top) post({ team_id: t, kind: 'award', title: 'Weekly award (Varsity): most sets logged', body: `${top.name}, ${top.n} sets in the week of ${lastWeek}`, player_id: top.player_id, ref: `award:${t}:${lastWeek}:sets`, at: `${monday} 06:00` });
  }

  // C-18 wellness: two weeks of check-ins for varsity, with a few low scores to flag
  for (const p of vPlayers) {
    const base = 3 + rnd() * 1.5;
    for (let d = -13; d <= 0; d++) {
      if (rnd() < 0.25) continue;
      const v = () => Math.max(1, Math.min(5, Math.round(base + (rnd() - 0.55) * 2)));
      db.run('INSERT OR IGNORE INTO wellness (player_id, date, sleep_hours, sleep_quality, soreness, mood, stress, at) VALUES (?,?,?,?,?,?,?,?)',
        p.id, addDays(day, d), Math.round((5.5 + rnd() * 3.5) * 2) / 2, v(), v(), v(), v(), `${addDays(day, d)} 06:${String(int(10, 40))}`);
    }
  }

  // F-7 composite scores
  db.insert('wt_composites', { program_id: pid, name: 'Combine score', tests: [{ key: 'forty', weight: 30 }, { key: 'pro_agility', weight: 20 }, { key: 'vertical', weight: 20 }, { key: 'broad', weight: 15 }, { key: 'bench', weight: 15 }], created_by: staff.sc });
  db.insert('wt_composites', { program_id: pid, name: 'Strength index', tests: [{ key: 'squat', weight: 40 }, { key: 'bench', weight: 30 }, { key: 'clean', weight: 30 }], created_by: staff.sc });

  // C-22 weekly email on Mondays at 7, plus last week's sample in the outbox for the demo player and the AD
  const prog = db.get('SELECT settings FROM programs WHERE id=?', pid);
  db.run('UPDATE programs SET settings=? WHERE id=?', JSON.stringify({ ...JSON.parse(prog.settings), weekly_report_enabled: true, leaderboard_hidden: [] }), pid);
  db.run('INSERT OR IGNORE INTO wt_report_log (program_id, week, kind, sent, at) VALUES (?,?,?,?,?)', pid, lastWeek, 'weekly_email', 2, `${lastWeek} 07:00`);
  const demo = db.get(`SELECT id, email FROM users WHERE email='player@ridgeview.example'`);
  if (demo) db.insert('outbox', { user_id: demo.id, to_email: demo.email, subject: 'Your weight room week', body: `Weight room week of ${addDays(lastWeek, -7)} to ${addDays(lastWeek, -1)}\n\nYou logged 2 sessions and 26 sets.\nCurrent lift streak: 4.`, created_at: `${lastWeek} 07:00`, deliver_at: `${lastWeek}T07:00`, sent_at: `${lastWeek} 07:00` });
  void groupOf; void nowLocal;
}
