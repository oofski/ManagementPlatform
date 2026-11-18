// Demo data for v2 football operations (server/modules/football.js). Called from seed.js inside its transaction.
import { nowLocal, today, addDays, hashPassword } from './core.js';

// 1x1 transparent PNG, stands in for a drawn signature in demo data.
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export function seedFootball(db, { pid, staff, players, demoQB, demoParent, seasonId, tV, tJR, tJB, tF, year }) {
  let s = 7;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const day = today();
  const now = nowLocal();

  // C-4 join codes per team
  for (const [team, code] of [[tV, 'RVVARS'], [tJR, 'RVJVRD'], [tJB, 'RVJVBK'], [tF, 'RVFRSH']]) db.insert('fb_join_codes', { program_id: pid, team_id: team, code, created_by: staff.head });
  // A freshman who already joined with the code and picked a username (signs in with "username / password123").
  const fr = players.find((p) => p.team === tF && p.pos === 'RB');
  if (fr) db.run('UPDATE users SET username=?, email=NULL, password_hash=?, joined_at=?, invite_code=NULL WHERE id=?', 'demo.freshman', hashPassword('password123'), now, fr.id);

  // C-2 primary position group = first listed position
  for (const p of players) db.run('UPDATE player_profiles SET primary_group=? WHERE user_id=?', p.positions[0], p.id);

  // F-13 eligibility: most cleared, some missing items, a few physicals expiring or expired
  players.forEach((p, i) => {
    const r = rnd();
    const physical = i % 23 === 5 ? null : addDays(day, -Math.floor(40 + rnd() * 300));
    let expires = physical ? addDays(physical, 365) : null;
    if (i % 17 === 3) expires = addDays(day, 12);   // expiring soon
    if (i % 29 === 8) expires = addDays(day, -6);   // expired
    db.insert('fb_eligibility', {
      player_id: p.id, physical_date: physical, physical_expires: expires, consent: p.id === demoQB.id ? 0 : r > 0.08 ? 1 : 0, emergency_contact: p.id === demoQB.id ? 0 : r > 0.12 ? 1 : 0,
      insurance: rnd() > 0.06 ? 1 : 0, insurance_note: 'School policy', fees_paid: rnd() > 0.1 ? 1 : 0, fees_note: null,
      academic: i % 31 === 7 ? 'probation' : i % 41 === 9 ? 'ineligible' : 'eligible', updated_by: staff.at, updated_at: now,
    });
  });

  // F-14 forms with e-signature
  const consent = db.insert('fb_forms', { program_id: pid, kind: 'consent', title: `Participation consent ${year}`, created_by: staff.head, body:
    'I give permission for my child to participate in Ridgeview football, including practices, games, strength training, conditioning and travel to away games.\n\n'
    + 'I understand that football is a contact sport and carries a risk of injury, including concussion. I have read the concussion information sheet shared in Documents.\n\n'
    + 'I agree that the athletic trainer and coaching staff may arrange emergency medical care if I cannot be reached.' });
  const emergency = db.insert('fb_forms', { program_id: pid, kind: 'emergency', title: 'Emergency contact and medical information', created_by: staff.head, body:
    'Provide at least one emergency contact who can be reached during practices and games. Medical information is shared only with the athletic trainer and the head coach.' });
  const links = db.all(`SELECT l.parent_id, l.player_id, u.name FROM parent_links l JOIN users u ON u.id=l.parent_id WHERE u.program_id=? AND u.password_hash IS NOT NULL`, pid);
  links.filter((l) => l.player_id !== demoQB.id).slice(0, 40).forEach((l, i) => {
    const at = `${addDays(day, -Math.floor(5 + rnd() * 60))}T${String(18 + (i % 4)).padStart(2, '0')}:1${i % 10}`;
    db.insert('fb_signatures', { program_id: pid, form_id: consent, player_id: l.player_id, signer_id: l.parent_id, typed_name: l.name, signature: SIG, data: {}, ip: '203.0.113.' + (10 + i), user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', signed_at: at });
    if (i % 2 === 0) db.insert('fb_signatures', { program_id: pid, form_id: emergency, player_id: l.player_id, signer_id: l.parent_id, typed_name: l.name, signature: SIG, data: { contact_name: l.name, contact_phone: `555-01${String(i).padStart(2, '0')}`, relation: 'Parent' }, ip: '203.0.113.' + (10 + i), user_agent: 'Mozilla/5.0 (Windows NT 10.0)', signed_at: at });
  });

  // F-10 a cleared athlete; F-12 an active concussion case (stage 3) and a closed one
  const v = players.filter((p) => p.team === tV && p.id !== demoQB.id);
  const cleared = v.find((p) => p.pos === 'WR');
  const active = v.find((p) => p.pos === 'DB');
  const closed = v.filter((p) => p.pos === 'RB')[1] || v[3];
  const c1 = db.insert('fb_concussions', { program_id: pid, player_id: active.id, injury_date: addDays(day, -6), stage: 3, status: 'active', prior_availability: 'available', opened_by: staff.db, opened_at: `${addDays(day, -6)}T19:40` });
  db.insert('fb_concussion_signoffs', { case_id: c1, stage: 1, signed_by: staff.at, signed_at: `${addDays(day, -3)}T15:00` });
  db.insert('fb_concussion_signoffs', { case_id: c1, stage: 2, signed_by: staff.at, signed_at: `${addDays(day, -1)}T15:20` });
  db.insert('fb_medical_notes', { case_id: c1, stage: 1, note: 'Headache and light sensitivity after a helmet-to-helmet tackle in the 3rd quarter. SCAT6 symptom score 14. Parents informed; physician visit scheduled.', by_user: staff.at, at: `${addDays(day, -6)}T20:05` });
  db.insert('fb_medical_notes', { case_id: c1, stage: 2, note: 'Symptom free 24 h at rest. Physician note on file. 15 min stationary bike with no symptoms.', by_user: staff.at, at: `${addDays(day, -1)}T15:25` });
  db.run(`UPDATE player_profiles SET availability='out', avail_note='Return-to-play protocol', return_date=NULL WHERE user_id=?`, active.id);
  const c2 = db.insert('fb_concussions', { program_id: pid, player_id: closed.id, injury_date: `${year}-09-05`, stage: 6, status: 'closed', prior_availability: 'available', opened_by: staff.at, opened_at: `${year}-09-05T21:00`, closed_at: `${year}-09-16T16:00` });
  for (let st = 1; st <= 6; st++) db.insert('fb_concussion_signoffs', { case_id: c2, stage: st, signed_by: staff.at, signed_at: `${year}-09-${String(8 + st).padStart(2, '0')}T15:30` });
  db.insert('fb_medical_notes', { case_id: c2, stage: 6, note: 'Completed protocol without symptoms. Written clearance from Dr. Alvarez on file.', by_user: staff.at, at: `${year}-09-16T16:00` });
  if (cleared) db.run(`UPDATE player_profiles SET availability='cleared', avail_note='Cleared by trainer after hamstring rehab', return_date=NULL WHERE user_id=?`, cleared.id);

  // F-11 heat acclimatization: period started Aug 1, logs for the first two weeks
  const prog = db.get('SELECT settings FROM programs WHERE id=?', pid);
  db.run('UPDATE programs SET settings=? WHERE id=?', JSON.stringify({ ...JSON.parse(prog.settings || '{}'), heat_start_date: `${year}-08-01` }), pid);
  const equip = (d) => (d <= 2 ? 'helmet' : d <= 5 ? 'shells' : 'full');
  for (let d = 1; d <= 12; d++) {
    const date = addDays(`${year}-08-01`, d - 1);
    const wbgt = Math.round((78 + rnd() * 9) * 10) / 10;
    db.insert('fb_heat_logs', { program_id: pid, date, reading_type: 'wbgt', reading: wbgt, duration_min: d <= 5 ? 150 + Math.floor(rnd() * 3) * 10 : 165, equipment: d === 4 ? 'full' : equip(d), team_id: tV, notes: wbgt >= 82 ? 'Extra water break every 15 min' : null, by_user: staff.at, at: `${date}T07:45` });
  }

  // C-23 documents
  const d1 = db.insert('fb_docs', { program_id: pid, title: 'Concussion information sheet', description: 'CDC HEADS UP fact sheet for parents and athletes. Read before signing the consent form.', kind: 'link', url: 'https://www.cdc.gov/heads-up/', audience: ['program', 'parents'], by_user: staff.at, at: `${addDays(day, -20)}T09:00` });
  const itinerary = 'Away game travel\n\nBus leaves Ridgeview HS at 3:30 PM from the north lot.\nPre-game meal at 4:15 PM in the visitor cafeteria.\nReturn about 11:30 PM. Parents pick up at the field house.\n';
  const d2 = db.insert('fb_docs', { program_id: pid, title: 'Away game travel itinerary', description: 'Bus times and pick-up', kind: 'file', mime: 'text/plain', filename: 'travel-itinerary.txt', size: itinerary.length, data: `data:text/plain;base64,${Buffer.from(itinerary).toString('base64')}`, audience: [`team:${tV}`], by_user: staff.head, at: `${addDays(day, -2)}T12:00` });
  for (const p of v.slice(0, 18)) db.insert('fb_doc_views', { doc_id: d2, user_id: p.id, first_at: `${addDays(day, -1)}T18:00`, last_at: `${addDays(day, -1)}T18:00`, count: 1 });
  for (const l of links.slice(0, 25)) db.run('INSERT OR IGNORE INTO fb_doc_views (doc_id, user_id, first_at, last_at, count) VALUES (?,?,?,?,1)', d1, l.parent_id, `${addDays(day, -10)}T20:00`, `${addDays(day, -10)}T20:00`);

  // C-24 last season's archive for returning varsity players
  const last = db.get('SELECT id, name FROM seasons WHERE program_id=? AND active=0 ORDER BY id LIMIT 1', pid);
  if (last) {
    for (const p of v.slice(0, 30)) {
      const sq = db.get(`SELECT min(value) v FROM tests WHERE player_id=? AND test_key='squat'`, p.id)?.v;
      const bn = db.get(`SELECT min(value) v FROM tests WHERE player_id=? AND test_key='bench'`, p.id)?.v;
      const tests = {}; if (sq) tests.squat = { value: sq - 20, date: `${year - 1}-11-01` }; if (bn) tests.bench = { value: bn - 15, date: `${year - 1}-11-01` };
      db.insert('fb_season_archive', { program_id: pid, season_id: last.id, season_name: last.name, player_id: p.id, team: rnd() > 0.4 ? 'Varsity' : 'JV Red', class_year: null, positions: p.positions, attendance_rate: 80 + Math.floor(rnd() * 20), events: 60 + Math.floor(rnd() * 20), tests, prs: tests, at: `${year - 1}-12-15T10:00` });
    }
  }

  // F-18 recruiting profiles for seniors (class of next June)
  const grad = new Date().getMonth() >= 6 ? year + 1 : year;
  const seniors = db.all(`SELECT p.user_id id, u.name FROM player_profiles p JOIN users u ON u.id=p.user_id WHERE p.team_id=? AND p.class_year=? AND p.archived=0 ORDER BY u.id LIMIT 4`, tV, grad);
  seniors.forEach((p, i) => {
    db.insert('fb_recruiting', { player_id: p.id, gpa: [3.6, 3.2, 3.9, 2.9][i], film_url: `https://www.hudl.com/profile/demo-${p.id}`, contact_email: `${p.name.toLowerCase().replace(/[^a-z]+/g, '.')}@gmail.example`, contact_phone: null,
      bio: 'Three-year starter. Team captain. Honor roll.', status: i === 0 ? 'approved' : i === 1 ? 'pending' : 'draft', approved_by: i === 0 ? staff.head : null, approved_at: i === 0 ? `${addDays(day, -4)}T10:00` : null, updated_at: `${addDays(day, -5)}T10:00` });
  });
  void demoParent; void seasonId;
}
