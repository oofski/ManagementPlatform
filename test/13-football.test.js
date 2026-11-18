// v2 football operations: roster import with grade and parents (C-1), primary group (C-2), staff seats (C-3),
// join codes and usernames (C-4), kiosk (C-19), streaks (C-20), documents (C-23), season archive (C-24),
// availability (F-10), heat (F-11), concussion RTP (F-12), eligibility (F-13), e-sign forms (F-14),
// parent digest (F-17), recruiting (F-18).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, today, addDays, nowLocal, addMinutes, addOtherProgram } from './helpers.js';

let t; let head; let coach; let qbc; let trainer; let player; let parent; let other; let otherHead; let V;
before(async () => {
  t = await start();
  head = await t.as('coach@ridgeview.example');
  coach = await t.as('Defensive coordinator');
  qbc = await t.as('QB coach');
  trainer = await t.as('Athletic trainer');
  player = await t.as('player@ridgeview.example');
  parent = await t.as('parent@ridgeview.example');
  V = t.teams.Varsity;
  other = addOtherProgram(t);
  otherHead = await t.as(other.head);
});
after(() => t.close());

test('C-1 import accepts grade, a single position and parent contacts (max 2), and links parents', async () => {
  const existingParent = t.db.get(`SELECT email FROM users WHERE role='parent' AND email LIKE '%family.example' LIMIT 1`).email;
  const rows = [
    { name: 'Avery Stone', grade: '10', position: 'WR', jersey: '81', team: 'JV Red', parent_name: 'Kim Stone', parent_email: 'kim.stone@family.example', parent_phone: '555-0110', parent2_name: 'Lee Stone', parent2_email: 'lee.stone@family.example', guardian_name: 'Third Person', guardian_email: 'third@family.example' },
    { first_name: 'Blake', last_name: 'Ford', grade: 'Sr', position: 'OL', team: 'Varsity', parent_name: 'Shared Parent', parent_email: existingParent },
    { name: 'Casey Hill', grade: '9', position: 'DB', team: 'Freshman', parent_name: 'Other Parent', parent_email: 'parent2@other.example' },
  ];
  assert.equal((await player.post('/api/players/import', { rows })).status, 403);
  const r = await head.post('/api/players/import', { rows });
  assert.equal(r.status, 200);
  assert.equal(r.body.created, 3);
  assert.equal(r.body.parents, 3, 'two for Avery (third ignored), one reused for Blake');
  assert.equal(r.body.errors.length, 1, 'parent email from another program is skipped with a row warning');
  assert.match(r.body.errors[0].error, /another account/);
  const avery = t.db.get(`SELECT u.id, p.class_year, p.positions, p.units, p.primary_group FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.name='Avery Stone'`);
  const now = new Date(); const end = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  assert.equal(avery.class_year, end + 2, 'grade 10 graduates two years after this school year');
  assert.deepEqual(JSON.parse(avery.positions), ['WR']);
  assert.deepEqual(JSON.parse(avery.units), ['offense'], 'unit inferred from the position');
  assert.equal(avery.primary_group, 'WR');
  const links = t.db.all('SELECT u.name, u.role, u.invite_code FROM parent_links l JOIN users u ON u.id=l.parent_id WHERE l.player_id=?', avery.id);
  assert.equal(links.length, 2);
  assert.ok(links.every((l) => l.role === 'parent' && l.invite_code));
  assert.ok(t.db.get(`SELECT 1 FROM outbox WHERE to_email='kim.stone@family.example'`), 'parent invite emailed');
  const blake = t.db.get(`SELECT u.id, p.class_year FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.name='Blake Ford'`);
  assert.equal(blake.class_year, end);
  assert.equal(t.db.get('SELECT count(*) n FROM users WHERE lower(email)=lower(?)', existingParent).n, 1, 'existing parent reused, not duplicated');
  assert.equal(t.db.get('SELECT count(*) n FROM parent_links WHERE player_id=?', blake.id).n, 1);
});

test('C-2 primary position group is editable and returned on the roster; C-3 unlimited scoped coach seats', async () => {
  const list = await head.get('/api/players');
  const p = list.body.find((x) => x.id === player.id);
  assert.equal(p.primary_group, 'QB');
  assert.equal((await head.put(`/api/players/${player.id}`, { primary_group: 'rb' })).status, 200);
  assert.equal((await head.get(`/api/players/${player.id}`)).body.primary_group, 'RB');
  await head.put(`/api/players/${player.id}`, { primary_group: 'QB' });
  for (let i = 0; i < 5; i++) {
    const s = await head.post('/api/staff', { name: `Volunteer ${i}`, email: `vol${i}@ridgeview.example`, role: 'coach', scopes: ['pos:LB'] });
    assert.equal(s.status, 200, 'no seat limit');
  }
  const lbCoach = t.db.get(`SELECT id FROM users WHERE email='vol0@ridgeview.example'`).id;
  assert.deepEqual(t.db.all('SELECT scope FROM staff_scopes WHERE user_id=?', lbCoach).map((r) => r.scope), ['pos:LB']);
});

test('C-4 join code: lookup, claim a roster spot, add yourself, sign in with username', async () => {
  t.app.ctx.fb.resetLimits();
  const fr = t.teams.Freshman;
  assert.equal((await player.post('/api/fb/join-codes', { team_id: fr })).status, 403);
  assert.equal((await head.post('/api/fb/join-codes', { team_id: other.team })).status, 404, 'cannot create a code for another program');
  const c = await head.post('/api/fb/join-codes', { team_id: fr });
  assert.equal(c.status, 200);
  const code = c.body.code;
  assert.match(code, /^[A-Z2-9]{6}$/);
  // An unclaimed freshman
  const target = t.db.get(`SELECT u.id, u.name FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE p.team_id=? AND u.password_hash IS NULL AND u.username IS NULL AND p.archived=0 LIMIT 1`, fr)
    || (() => { const id = t.db.insert('users', { program_id: head.user.program_id, name: 'Unclaimed Frosh', role: 'player' }); t.db.insert('player_profiles', { user_id: id, team_id: fr, jersey: 44 }); return { id, name: 'Unclaimed Frosh' }; })();
  const look = await t.anon.post('/api/join/lookup', { code: code.toLowerCase() });
  assert.equal(look.status, 200);
  assert.equal(look.body.team, 'Freshman');
  const row = look.body.players.find((p) => p.id === target.id);
  assert.ok(row && row.suggested, 'unclaimed players are listed with a suggested username');
  assert.ok(look.body.players.every((p) => !t.db.get('SELECT password_hash FROM users WHERE id=?', p.id).password_hash), 'only players without an account');
  assert.ok(!('email' in row), 'no contact details exposed');
  // weak password / bad username
  assert.equal((await t.anon.post('/api/join/claim', { code, player_id: target.id, username: 'ab', password: 'password123' })).status, 400);
  assert.equal((await t.anon.post('/api/join/claim', { code, player_id: target.id, username: 'frosh.one', password: 'short' })).status, 400);
  assert.equal((await t.anon.post('/api/join/claim', { code, player_id: player.id, username: 'frosh.one', password: 'password123' })).status, 400, 'cannot claim a varsity player that already has an account');
  const claim = await t.anon.post('/api/join/claim', { code, player_id: target.id, username: 'Frosh.One', password: 'password123' });
  assert.equal(claim.status, 200);
  assert.ok(claim.body.token);
  const me = await t.client(claim.body.token).get('/api/me');
  assert.equal(me.body.user.id, target.id);
  assert.equal((await t.anon.post('/api/join/claim', { code, player_id: target.id, username: 'frosh.two', password: 'password123' })).status, 400, 'already claimed');
  assert.equal((await t.anon.post('/api/join/claim', { code, name: 'New Kid', username: 'frosh.one', password: 'password123' })).status, 400, 'username taken (case-insensitive)');
  // Add yourself
  const sug = await t.anon.post('/api/join/suggest', { code, name: 'Riley Newman', jersey: 33 });
  assert.equal(sug.body.username, 'rnewman');
  const add = await t.anon.post('/api/join/claim', { code, name: 'Riley Newman', jersey: 33, username: sug.body.username, password: 'password123' });
  assert.equal(add.status, 200);
  const riley = t.db.get(`SELECT u.*, p.team_id, p.jersey FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.username='rnewman'`);
  assert.equal(riley.team_id, fr); assert.equal(riley.jersey, 33); assert.equal(riley.email, null);
  assert.ok(t.notifications(head.id, '%joined with the team code%').length >= 1);
  // Login with username (no email) and with email still works
  const li = await t.anon.post('/api/auth/login', { email: 'RNEWMAN', password: 'password123' });
  assert.equal(li.status, 200);
  assert.equal((await t.anon.post('/api/auth/login', { username: 'rnewman', password: 'wrong-pass' })).status, 401);
  assert.equal((await t.anon.post('/api/auth/login', { email: 'player@ridgeview.example', password: 'password123' })).status, 200);
  // Rotate: old code stops working; disable: new code stops working
  const rot = await head.post('/api/fb/join-codes', { team_id: fr });
  assert.equal((await t.anon.post('/api/join/lookup', { code })).status, 404);
  assert.equal((await t.anon.post('/api/join/lookup', { code: rot.body.code })).status, 200);
  assert.equal((await head.put(`/api/fb/join-codes/${rot.body.id}`, { active: false })).status, 200);
  assert.equal((await t.anon.post('/api/join/lookup', { code: rot.body.code })).status, 404);
  assert.equal((await otherHead.put(`/api/fb/join-codes/${rot.body.id}`, { active: true })).status, 404, 'other program cannot touch this code');
  const list = await head.get('/api/fb/join-codes');
  assert.ok(list.body.find((x) => x.team_id === fr).code.uses === 0);
});

test('C-4 join codes are rate-limited against guessing', async () => {
  t.app.ctx.fb.resetLimits();
  const good = (await head.post('/api/fb/join-codes', { team_id: t.teams['JV Black'] })).body.code;
  let last;
  for (let i = 0; i < 10; i++) last = await t.anon.post('/api/join/lookup', { code: `ZZZZ${String(i).padStart(2, 'Z')}` });
  assert.equal(last.status, 404);
  assert.equal((await t.anon.post('/api/join/lookup', { code: good })).status, 429, 'blocked after 10 misses, even with a valid code');
  assert.equal((await t.anon.post('/api/join/claim', { code: good, name: 'X Y', username: 'xyxyxy', password: 'password123' })).status, 429);
  t.app.ctx.fb.resetLimits();
  assert.equal((await t.anon.post('/api/join/lookup', { code: good })).status, 200);
});

test('C-19 tablet kiosk: tap to check in, tardy after 5 minutes, coach PIN to exit', async () => {
  const e = await head.post('/api/events', { type: 'lift', title: 'Kiosk lift', start: addMinutes(nowLocal(), -20), audience: [`team:${V}`] });
  assert.equal(e.status, 200);
  assert.equal((await player.post('/api/fb/kiosk', { event_id: e.body.id, pin: '1234' })).status, 403);
  assert.equal((await head.post('/api/fb/kiosk', { event_id: e.body.id, pin: '12' })).status, 400);
  assert.equal((await otherHead.post('/api/fb/kiosk', { event_id: e.body.id, pin: '1234' })).status, 404);
  const k = await head.post('/api/fb/kiosk', { event_id: e.body.id, pin: '2468' });
  assert.equal(k.status, 200);
  const view = await head.get(`/api/fb/kiosk/${k.body.id}`);
  assert.equal(view.body.players.length, t.varsity().length);
  assert.ok(view.body.players.every((p) => !('availability' in p) && !('email' in p)), 'shared tablet shows name and number only');
  assert.equal((await otherHead.get(`/api/fb/kiosk/${k.body.id}`)).status, 404);
  const jv = t.players('p.team_id=?', t.teams['JV Red'])[0];
  assert.equal((await head.post(`/api/fb/kiosk/${k.body.id}/checkin`, { player_id: jv.id })).status, 400);
  const ci = await head.post(`/api/fb/kiosk/${k.body.id}/checkin`, { player_id: player.id });
  assert.equal(ci.body.status, 'late', 'stored as late, shown as Tardy');
  const again = await head.post(`/api/fb/kiosk/${k.body.id}/checkin`, { player_id: player.id });
  assert.equal(again.body.already, true);
  assert.equal(t.db.get('SELECT source FROM attendance WHERE event_id=? AND player_id=?', e.body.id, player.id).source, 'kiosk');
  assert.equal((await head.post(`/api/fb/kiosk/${k.body.id}/exit`, { pin: '0000' })).status, 403);
  assert.equal((await head.post(`/api/fb/kiosk/${k.body.id}/exit`, { pin: '2468' })).status, 200);
  assert.equal((await head.post(`/api/fb/kiosk/${k.body.id}/checkin`, { player_id: t.varsity()[1].id })).status, 410);
});

test('C-20 streaks and trends per athlete and per group; workout logs count for lift days', async () => {
  const r = await head.get(`/api/fb/attendance/trends?from=${addDays(today(), -120)}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.players.length > 10);
  const p = r.body.players[0];
  for (const k of ['rate', 'current_streak', 'best_streak', 'practice_rate', 'workout_rate', 'trend', 'group']) assert.ok(k in p, k);
  assert.ok(r.body.groups.some((g) => g.group === 'QB'));
  const qb = await head.get('/api/fb/attendance/trends?group=QB');
  assert.ok(qb.body.players.every((x) => x.group === 'QB'));
  // A logged workout on a lift day with no attendance mark counts as present.
  const ev = await head.post('/api/events', { type: 'lift', title: 'Morning lift', start: `${addDays(today(), -1)}T06:30`, audience: [`player:${player.id}`] });
  t.db.insert('wt_logs', { player_id: player.id, exercise_id: 1, set_no: 1, reps: 5, weight: 185, date: addDays(today(), -1) });
  const mine = await player.get(`/api/fb/attendance/player/${player.id}?from=${addDays(today(), -2)}`);
  assert.equal(mine.status, 200);
  assert.ok(mine.body.via_workout >= 1);
  assert.ok(ev.body.id);
  assert.equal((await player.get(`/api/fb/attendance/player/${t.varsity()[3].id}`)).status, 403);
  assert.equal((await player.get('/api/fb/attendance/trends')).status, 403);
  assert.equal((await otherHead.get(`/api/fb/attendance/player/${player.id}`)).status, 403);
});

test('C-23 documents: files up to 5 MB or links, audience, viewed-by tracking', async () => {
  const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 test').toString('base64')}`;
  assert.equal((await player.post('/api/fb/docs', { title: 'x', kind: 'link', url: 'https://example.com', audience: ['program'] })).status, 403);
  assert.equal((await head.post('/api/fb/docs', { title: 'Bad', data: 'data:application/x-msdownload;base64,AAAA', audience: [`team:${V}`] })).status, 400);
  const big = `data:application/pdf;base64,${Buffer.alloc(5 * 1024 * 1024 + 10).toString('base64')}`;
  assert.equal((await head.post('/api/fb/docs', { title: 'Big', data: big, audience: [`team:${V}`] })).status, 400);
  assert.equal((await head.post('/api/fb/docs', { title: 'Link', kind: 'link', url: 'javascript:alert(1)', audience: [`team:${V}`] })).status, 400);
  assert.equal((await qbc.post('/api/fb/docs', { title: 'DL only', kind: 'link', url: 'https://example.com', audience: ['pos:DL'] })).status, 403, 'scoped coach shares with own groups only');
  const d = await head.post('/api/fb/docs', { title: 'Playbook install PDF', data: pdf, filename: 'install.pdf', audience: [`team:${V}`] });
  assert.equal(d.status, 200);
  const jv = await t.as(t.players('p.team_id=?', t.teams['JV Red'])[0].id);
  assert.ok(!(await jv.get('/api/fb/docs')).body.some((x) => x.id === d.body.id));
  assert.equal((await jv.get(`/api/fb/docs/${d.body.id}/file`)).status, 404);
  const list = await player.get('/api/fb/docs');
  const mine = list.body.find((x) => x.id === d.body.id);
  assert.ok(mine && !mine.viewed_at && !('data' in mine));
  const f = await player.get(`/api/fb/docs/${d.body.id}/file`);
  assert.equal(f.status, 200);
  assert.match(f.headers.get('content-type'), /application\/pdf/);
  assert.equal(f.body, '%PDF-1.4 test');
  const pv = await parent.get('/api/fb/docs');
  assert.ok(pv.body.some((x) => x.id === d.body.id), 'parents of players in the audience see it');
  const views = await head.get(`/api/fb/docs/${d.body.id}/views`);
  assert.equal(views.status, 200);
  assert.ok(views.body.recipients.find((x) => x.id === player.id).viewed_at);
  assert.ok(!views.body.recipients.find((x) => x.id === parent.id).viewed_at);
  assert.equal((await player.get(`/api/fb/docs/${d.body.id}/views`)).status, 403);
  assert.equal((await otherHead.get(`/api/fb/docs/${d.body.id}/file`)).status, 404);
  assert.equal((await coach.del(`/api/fb/docs/${d.body.id}`)).status, 403);
  const link = await head.post('/api/fb/docs', { title: 'Hudl', kind: 'link', url: 'https://www.hudl.com/x', audience: ['program'] });
  assert.equal((await parent.post(`/api/fb/docs/${link.body.id}/open`)).body.url, 'https://www.hudl.com/x');
  assert.equal((await head.del(`/api/fb/docs/${link.body.id}`)).status, 200);
});

test('F-10 availability: full, limited, out and cleared', async () => {
  const p = t.varsity('u.id!=?', player.id)[5];
  assert.equal((await head.put(`/api/players/${p.id}/availability`, { availability: 'cleared' })).status, 200);
  assert.equal(t.db.get('SELECT availability FROM player_profiles WHERE user_id=?', p.id).availability, 'cleared');
  assert.equal((await trainer.put(`/api/players/${p.id}/availability`, { availability: 'full' })).status, 200);
  assert.equal(t.db.get('SELECT availability FROM player_profiles WHERE user_id=?', p.id).availability, 'available');
  assert.equal((await head.put(`/api/players/${p.id}/availability`, { availability: 'questionable' })).status, 400);
  assert.equal((await player.put(`/api/players/${p.id}/availability`, { availability: 'out' })).status, 403);
  const v = (await head.get('/api/players?availability=limited')).body;
  assert.ok(v.every((x) => x.availability === 'limited'));
});

test('F-12 concussion: player out while in protocol; only medical signs off; coaches never see notes', async () => {
  const p = t.varsity('u.id!=?', player.id).find((x) => !t.db.get(`SELECT 1 FROM fb_concussions WHERE player_id=? AND status='active'`, x.id));
  assert.equal((await player.post('/api/fb/concussions', { player_id: p.id })).status, 403);
  const open = await coach.post('/api/fb/concussions', { player_id: p.id, injury_date: today(), note: 'coach observation' });
  assert.equal(open.status, 200);
  assert.equal(t.db.get('SELECT availability FROM player_profiles WHERE user_id=?', p.id).availability, 'out');
  assert.equal(t.db.get('SELECT count(*) n FROM fb_medical_notes WHERE case_id=?', open.body.id).n, 0, 'non-medical staff cannot write medical notes');
  assert.equal((await coach.post('/api/fb/concussions', { player_id: p.id })).status, 400, 'one open case per player');
  assert.equal((await head.put(`/api/players/${p.id}/availability`, { availability: 'available' })).status, 400, 'stays out while in protocol');
  assert.equal((await trainer.post(`/api/fb/concussions/${open.body.id}/notes`, { note: 'SCAT6 symptom score 18; headache' })).status, 200);
  for (const u of [coach, head, qbc]) {
    const c = await u.get(`/api/fb/concussions/${open.body.id}`);
    assert.equal(c.status, 200);
    assert.equal(c.body.stage, 1);
    assert.ok(!('notes' in c.body), 'coach sees the stage, not the medical detail');
    assert.ok(!JSON.stringify((await u.get('/api/fb/concussions')).body).includes('SCAT6'));
    assert.equal((await u.post(`/api/fb/concussions/${open.body.id}/advance`, {})).status, 403);
    assert.equal((await u.post(`/api/fb/concussions/${open.body.id}/notes`, { note: 'x' })).status, 403);
  }
  const tc = await trainer.get(`/api/fb/concussions/${open.body.id}`);
  assert.equal(tc.body.notes[0].note, 'SCAT6 symptom score 18; headache');
  // A staff member given the medical permission is a designated medical professional too.
  const doc = await head.post('/api/staff', { name: 'Team Physician', email: 'doc@ridgeview.example', role: 'staff', perms: { medical: true } });
  const md = await t.as(doc.body.id);
  assert.ok((await md.get(`/api/fb/concussions/${open.body.id}`)).body.notes.length === 1);
  // Parent of the athlete sees the stage only
  const par = t.db.get('SELECT parent_id FROM parent_links WHERE player_id=?', p.id);
  if (par) { const pc = await (await t.as(par.parent_id)).get('/api/fb/concussions'); assert.ok(pc.body.every((c) => !('notes' in c))); }
  assert.equal((await parent.get(`/api/fb/concussions/${open.body.id}`)).status, 404, 'other families cannot see the case');
  assert.equal((await otherHead.get(`/api/fb/concussions/${open.body.id}`)).status, 404);
  for (let i = 1; i <= 6; i++) {
    const a = await trainer.post(`/api/fb/concussions/${open.body.id}/advance`, { note: `stage ${i} ok` });
    assert.equal(a.status, 200);
  }
  const done = t.db.get('SELECT * FROM fb_concussions WHERE id=?', open.body.id);
  assert.equal(done.status, 'closed');
  assert.equal(t.db.get('SELECT availability FROM player_profiles WHERE user_id=?', p.id).availability, 'cleared');
  assert.equal(t.db.get('SELECT count(*) n FROM fb_concussion_signoffs WHERE case_id=?', open.body.id).n, 6);
  assert.equal((await trainer.post(`/api/fb/concussions/${open.body.id}/advance`, {})).status, 400);
});

test('F-11 heat acclimatization: log, schedule and practice-plan warnings', async () => {
  await t.setSettings({ heat_start_date: today() });
  const e = await head.post('/api/events', { type: 'practice', title: 'Heat day practice', start: `${today()}T23:00`, end: `${today()}T23:50`, audience: [`team:${V}`] });
  const plan = await head.post('/api/plans', { event_id: e.body.id, name: 'Day 1' });
  assert.equal(plan.status, 200);
  const put = await head.put(`/api/plans/${plan.body.id}`, { periods: [{ duration: 120, contact: false, positions: [], play_ids: [] }, { duration: 90, contact: true, positions: [], play_ids: [] }] });
  assert.equal(put.status, 200);
  const c = await head.get(`/api/fb/heat/check?plan_id=${plan.body.id}`);
  assert.equal(c.status, 200);
  assert.equal(c.body.day, 1);
  assert.equal(c.body.rule.equipment, 'helmet');
  assert.ok(c.body.warnings.some((w) => /minutes planned/.test(w.text)), 'over 180 minutes');
  assert.ok(c.body.warnings.some((w) => /contact minutes/.test(w.text)), 'no contact on day 1');
  assert.equal((await player.post('/api/fb/heat', { date: today(), reading: 80 })).status, 403);
  const log = await trainer.post('/api/fb/heat', { date: today(), reading_type: 'wbgt', reading: 93, duration_min: 120, equipment: 'full', team_id: V });
  assert.equal(log.status, 200);
  assert.ok(log.body.check.warnings.some((w) => /stop limit/.test(w.text)));
  assert.ok(log.body.check.warnings.some((w) => /Logged full pads on day 1/.test(w.text)));
  const list = await coach.get('/api/fb/heat');
  assert.ok(list.body.logs.find((l) => l.id === log.body.id).over);
  assert.equal((await otherHead.get('/api/fb/heat')).body.logs.length, 0);
  assert.equal((await player.get('/api/fb/heat/check?date=' + today())).status, 403);
  // Data-driven: the head coach edits the schedule
  const s = await t.setSettings({ heat_schedule: [{ from: 1, to: 14, equipment: 'full', max_practices: 2, max_minutes: 400, contact: true }] });
  assert.equal(s.heat_schedule[0].max_minutes, 400);
  const c2 = await head.get(`/api/fb/heat/check?plan_id=${plan.body.id}`);
  assert.ok(!c2.body.warnings.some((w) => /minutes planned|contact minutes/.test(w.text)));
});

test('F-13 eligibility checklist, roster view and dashboard count', async () => {
  const r = await head.get('/api/fb/eligibility');
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 6);
  assert.ok(r.body.players.some((p) => p.cleared) && r.body.players.some((p) => !p.cleared));
  assert.ok(r.body.players.some((p) => p.expiring), 'seed has expiring physicals');
  assert.ok(r.body.players.every((p) => !('signature' in p)));
  const s = await head.get('/api/fb/eligibility/summary');
  assert.equal(s.body.total, r.body.players.length);
  assert.equal(s.body.cleared + s.body.not_cleared, s.body.total);
  for (const u of [player, parent, await t.as('Team manager (volunteer)')]) assert.equal((await u.get('/api/fb/eligibility')).status, 403);
  assert.equal((await (await t.as('Athletic director')).get('/api/fb/eligibility')).status, 200);
  const qb = r.body.players.find((p) => p.player_id === player.id);
  assert.equal(qb.items.consent, false);
  assert.equal((await player.put(`/api/fb/eligibility/${player.id}`, { insurance: true })).status, 403);
  const u = await trainer.put(`/api/fb/eligibility/${player.id}`, { physical_date: addDays(today(), -10), insurance: true, fees_paid: true, academic: 'eligible' });
  assert.equal(u.status, 200);
  assert.equal(u.body.physical_expires, addDays(addDays(today(), -10), 365), 'expiry defaults to one year');
  assert.equal((await head.put(`/api/fb/eligibility/${player.id}`, { academic: 'great' })).status, 400);
  assert.equal((await head.put(`/api/fb/eligibility/${other.player}`, { insurance: true })).status, 404);
  const own = await parent.get(`/api/fb/eligibility/player/${player.id}`);
  assert.equal(own.status, 200);
  assert.equal((await parent.get(`/api/fb/eligibility/player/${t.varsity()[4].id}`)).status, 403);
  assert.equal((await otherHead.get(`/api/fb/eligibility/player/${player.id}`)).status, 403);
});

test('F-14 e-signature: parents sign only for their own child; signing updates the checklist', async () => {
  const forms = await parent.get('/api/fb/forms');
  const consent = forms.body.find((f) => f.kind === 'consent');
  const emergency = forms.body.find((f) => f.kind === 'emergency');
  assert.ok(consent.children.find((c) => c.player_id === player.id && !c.signed_at));
  const sig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const otherChild = t.varsity('u.id NOT IN (SELECT player_id FROM parent_links WHERE parent_id=?)', parent.id)[0];
  assert.equal((await parent.post(`/api/fb/forms/${consent.id}/sign`, { player_id: otherChild.id, typed_name: 'Lisa Parent', signature: sig, agree: true })).status, 403);
  assert.equal((await player.post(`/api/fb/forms/${consent.id}/sign`, { player_id: player.id, typed_name: 'Me Me', signature: sig, agree: true })).status, 403);
  assert.equal((await head.post(`/api/fb/forms/${consent.id}/sign`, { player_id: player.id, typed_name: 'Coach', signature: sig, agree: true })).status, 403);
  assert.equal((await parent.post(`/api/fb/forms/${consent.id}/sign`, { player_id: player.id, typed_name: 'Lisa Parent', agree: true })).status, 400, 'drawn signature required');
  assert.equal((await parent.post(`/api/fb/forms/${consent.id}/sign`, { player_id: player.id, typed_name: 'Lisa Parent', signature: sig })).status, 400, 'agreement required');
  assert.equal((await parent.post(`/api/fb/forms/${emergency.id}/sign`, { player_id: player.id, typed_name: 'Lisa Parent', signature: sig, agree: true, data: {} })).status, 400, 'emergency contact required');
  const ok = await parent.post(`/api/fb/forms/${consent.id}/sign`, { player_id: player.id, typed_name: 'Lisa Parent', signature: sig, agree: true });
  assert.equal(ok.status, 200);
  const em = await parent.post(`/api/fb/forms/${emergency.id}/sign`, { player_id: player.id, typed_name: 'Lisa Parent', signature: sig, agree: true, data: { contact_name: 'Grandma', contact_phone: '555-0199', relation: 'Grandmother', evil: 'x' } });
  assert.equal(em.status, 200);
  const row = t.db.get('SELECT * FROM fb_signatures WHERE id=?', ok.body.id);
  assert.ok(row.ip && row.signed_at && row.signature.startsWith('data:image/png'));
  assert.equal(row.signer_id, parent.id);
  const e = t.db.get('SELECT consent, emergency_contact FROM fb_eligibility WHERE player_id=?', player.id);
  assert.deepEqual([e.consent, e.emergency_contact], [1, 1]);
  const ec = await head.get(`/api/fb/emergency/${player.id}`);
  assert.equal(ec.body.data.contact_name, 'Grandma');
  assert.ok(!('evil' in ec.body.data));
  assert.equal((await parent.get(`/api/fb/emergency/${otherChild.id}`)).status, 403);
  const sigs = await trainer.get(`/api/fb/forms/${consent.id}/signatures`);
  assert.ok(sigs.body.some((s) => s.player_id === player.id && s.typed_name === 'Lisa Parent'));
  assert.equal((await parent.get(`/api/fb/forms/${consent.id}/signatures`)).status, 403);
  assert.equal((await otherHead.get(`/api/fb/forms/${consent.id}/signatures`)).status, 404);
  const otherParent = await t.as(other.parent);
  assert.equal((await otherParent.post(`/api/fb/forms/${consent.id}/sign`, { player_id: other.player, typed_name: 'Other Parent', signature: sig, agree: true })).status, 404, 'form from another program');
  assert.equal((await coach.post('/api/fb/forms', { kind: 'other', title: 'Travel' })).status, 403);
  assert.equal((await head.post('/api/fb/forms', { kind: 'other', title: 'Travel permission' })).status, 200);
});

test('F-17 parent digest: preview, idempotent weekly send', async () => {
  const pv = await head.get(`/api/fb/digest/preview?parent_id=${parent.id}`);
  assert.equal(pv.status, 200);
  assert.match(pv.body.subject, /week of/);
  assert.match(pv.body.body, new RegExp(player.user.name));
  assert.match(pv.body.body, /Attendance last 7 days/);
  assert.equal((await player.get('/api/fb/digest/preview')).status, 403);
  assert.equal((await otherHead.get(`/api/fb/digest/preview?parent_id=${parent.id}`)).status, 404);
  assert.equal((await coach.post('/api/fb/digest/send')).status, 403);
  const a = await head.post('/api/fb/digest/send');
  assert.equal(a.status, 200);
  assert.ok(a.body.sent > 10);
  assert.ok(t.db.get(`SELECT 1 FROM outbox WHERE user_id=? AND subject LIKE '%week of%'`, parent.id));
  const b = await head.post('/api/fb/digest/send');
  assert.equal(b.body.sent, 0, 'once per parent per week');
  assert.equal(t.app.ctx.fb.runDigest(head.user.program_id).sent, 0);
  assert.equal(t.db.get(`SELECT count(*) n FROM fb_digest_log WHERE user_id=?`, other.parent).n, 0, 'other program untouched');
});

test('F-18 recruiting profile: tests pulled from records, edits need coach approval, access limited', async () => {
  const r = await player.get(`/api/fb/recruiting/${player.id}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.tests.some((x) => x.test_key === 'squat' && x.verified));
  const u = await player.put(`/api/fb/recruiting/${player.id}`, { gpa: 3.7, film_url: 'https://www.hudl.com/me', bio: 'QB' });
  assert.equal(u.body.status, 'pending');
  assert.equal((await player.put(`/api/fb/recruiting/${player.id}`, { gpa: 7 })).status, 400);
  assert.equal((await player.put(`/api/fb/recruiting/${player.id}`, { film_url: 'javascript:x' })).status, 400);
  assert.equal((await player.post(`/api/fb/recruiting/${player.id}/approve`)).status, 403);
  const other1 = t.varsity('u.id!=?', player.id)[2];
  assert.equal((await player.put(`/api/fb/recruiting/${other1.id}`, { gpa: 2 })).status, 403);
  assert.equal((await player.get(`/api/fb/recruiting/${other1.id}`)).status, 403);
  assert.equal((await parent.get(`/api/fb/recruiting/${player.id}`)).status, 200);
  assert.equal((await otherHead.get(`/api/fb/recruiting/${player.id}`)).status, 403);
  const a = await qbc.post(`/api/fb/recruiting/${player.id}/approve`, {});
  assert.equal(a.body.status, 'approved');
  assert.match(a.body.approved_by, /Ben Okafor/);
  const again = await player.put(`/api/fb/recruiting/${player.id}`, { bio: 'Dual-threat QB' });
  assert.equal(again.body.status, 'pending', 'an edit sends it back for approval');
  const list = await head.get('/api/fb/recruiting');
  assert.ok(list.body.some((x) => x.id === player.id));
  assert.equal((await player.get('/api/fb/recruiting')).status, 403);
});

test('F-18/F-8 recruiting: lifts come from coach-recorded tests only; weight only for body-data viewers', async () => {
  const sq = t.db.get(`SELECT id FROM exercises WHERE program_id=1 AND test_key='squat' ORDER BY id LIMIT 1`).id;
  // an athlete's own logged set never shows as a recruiting lift
  t.db.insert('wt_logs', { player_id: player.id, exercise_id: sq, set_no: 1, reps: 1, weight: 995, date: today() });
  const coachBest = t.db.get(`SELECT max(value) v FROM tests WHERE player_id=? AND test_key='squat' AND by_user IS NOT NULL`, player.id).v;
  const r = await head.get(`/api/fb/recruiting/${player.id}`);
  assert.ok(r.body.lifts.length);
  assert.ok(r.body.lifts.every((l) => l.weight !== 995));
  assert.equal(r.body.lifts.find((l) => l.test_key === 'squat').weight, coachBest);
  assert.equal(typeof r.body.player.weight, 'number', 'the head coach has body-data access');
  assert.equal((await qbc.get(`/api/fb/recruiting/${player.id}`)).body.player.weight, null, 'a position coach does not');
  assert.equal((await player.get(`/api/fb/recruiting/${player.id}`)).body.player.weight, null);
  await t.setSettings({ family_sees_bodyweight: true });
  assert.equal(typeof (await player.get(`/api/fb/recruiting/${player.id}`)).body.player.weight, 'number');
  await t.setSettings({ family_sees_bodyweight: false });
});

test('F-14/F-12 emergency medical details and concussion cases are hidden from volunteers', async () => {
  const em = t.db.get(`SELECT id FROM fb_forms WHERE program_id=1 AND kind='emergency' AND active=1 LIMIT 1`).id;
  const sig = 'data:image/png;base64,iVBORw0KGgo=';
  const s = await parent.post(`/api/fb/forms/${em}/sign`, { player_id: player.id, typed_name: 'Lisa Parent', signature: sig, agree: true, data: { contact_name: 'Grandma', contact_phone: '555-0199', allergies: 'Peanuts', medications: 'Inhaler', conditions: 'Asthma' } });
  assert.equal(s.status, 200);
  const vol = await t.as('Team manager (volunteer)');
  const v = await vol.get(`/api/fb/emergency/${player.id}`);
  assert.equal(v.status, 200);
  assert.equal(v.body.data.contact_phone, '555-0199');
  for (const k of ['allergies', 'medications', 'conditions']) assert.equal(v.body.data[k], undefined, k);
  assert.equal((await (await t.as('Equipment manager')).get(`/api/fb/emergency/${player.id}`)).body.data.allergies, undefined);
  for (const u of [trainer, head, qbc, await t.as('Athletic director'), parent]) assert.equal((await u.get(`/api/fb/emergency/${player.id}`)).body.data.allergies, 'Peanuts');
  // concussion cases: volunteers and other support staff without eligibility access get nothing
  assert.equal((await vol.get('/api/fb/concussions')).status, 403);
  const anyCase = t.db.get('SELECT id FROM fb_concussions WHERE program_id=1 LIMIT 1').id;
  assert.equal((await vol.get(`/api/fb/concussions/${anyCase}`)).status, 403);
  assert.equal((await (await t.as('Athletic director')).get('/api/fb/concussions')).status, 200);
  assert.equal((await coach.get('/api/fb/concussions')).status, 200);
});

test('C-2 eligibility and attendance use the weight room position groups (K/P, not P)', async () => {
  const k = t.players(`p.positions = '["P"]'`)[0] || t.players(`p.positions = '["K"]'`)[0];
  const r = await head.get('/api/fb/eligibility');
  assert.equal(r.body.players.find((x) => x.player_id === k.id).group, 'K/P');
  assert.ok(!r.body.players.some((x) => ['P', 'K', 'RB', 'TE', 'LS', 'RET'].includes(x.group)));
});

test('seeded class years follow the school year: seniors graduate at the end of this school year', async () => {
  const d = today(); const y = Number(d.slice(0, 4));
  const end = Number(d.slice(5, 7)) >= 7 ? y + 1 : y;
  const years = t.db.all(`SELECT DISTINCT p.class_year y FROM player_profiles p JOIN users u ON u.id=p.user_id WHERE u.program_id=1 AND p.class_year IS NOT NULL AND u.email LIKE '%@students.ridgeview.example' ORDER BY y`).map((r) => r.y);
  assert.deepEqual(years, [end, end + 1, end + 2, end + 3]);
  const seniors = (await head.get('/api/fb/recruiting')).body.filter((x) => x.senior);
  assert.ok(seniors.length > 0, 'recruiting has seniors');
  const fr = t.players('p.team_id=?', t.teams.Freshman)[0];
  const norms = await head.get('/api/strength/norms?test_key=forty');
  assert.ok(Object.keys(norms.body.by_grade).every((g) => Number(g) >= 9 && Number(g) <= 12));
  const freshRow = (await head.get(`/api/strength/battery?team_id=${t.teams.Freshman}`)).body.rows.find((x) => x.id === fr.id);
  assert.equal(freshRow.grade, 9);
});

test('C-24 season rollover snapshots each athlete into the archive and shows history', async () => {
  const before = t.db.get('SELECT count(*) n FROM fb_season_archive').n;
  const season = t.db.get('SELECT * FROM seasons WHERE active=1');
  const grad = t.db.get(`SELECT min(class_year) y FROM player_profiles WHERE archived=0 AND class_year IS NOT NULL`).y;
  assert.equal((await coach.post('/api/players/rollover', {})).status, 403);
  const r = await head.post('/api/players/rollover', { graduating_class: grad, new_season: { name: 'Fall next' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.snapshot.athletes > 50);
  assert.ok(r.body.archived > 0);
  assert.ok(t.db.get('SELECT count(*) n FROM fb_season_archive').n >= before + r.body.snapshot.athletes - 30);
  const row = t.db.get('SELECT * FROM fb_season_archive WHERE player_id=? AND season_id=?', player.id, season.id);
  assert.ok(row);
  assert.ok(JSON.parse(row.tests).squat, 'best squat this season');
  assert.equal(t.db.get('SELECT name FROM seasons WHERE active=1').name, 'Fall next');
  const h = await parent.get(`/api/fb/history/${player.id}`);
  assert.equal(h.status, 200);
  assert.ok(h.body.some((x) => x.season_id === season.id && x.tests.squat.label));
  assert.equal((await otherHead.get(`/api/fb/history/${player.id}`)).status, 403);
  // restore active season for later tests
  t.db.run('UPDATE seasons SET active=0'); t.db.run('UPDATE seasons SET active=1 WHERE id=?', season.id);
});
