import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, addOtherProgram } from './helpers.js';

let t; let head; let player; let parent; let trainer; let V;
before(async () => {
  t = await start();
  head = await t.as('coach@ridgeview.example');
  player = await t.as('player@ridgeview.example');
  parent = await t.as('parent@ridgeview.example');
  trainer = await t.as('Athletic trainer');
  V = t.teams.Varsity;
});
after(() => t.close());

test('structure lists levels, teams and positions', async () => {
  const s = await player.get('/api/structure');
  assert.deepEqual(s.body.levels.map((l) => l.name), ['Varsity', 'JV', 'Freshman']);
  assert.equal(s.body.levels[1].teams.length, 2);
  assert.ok(s.body.positions.some((p) => p.code === 'QB'));
  const dc = await t.as('Defensive coordinator');
  assert.equal((await dc.post('/api/levels', { name: 'Sophomore' })).status, 403);
  const lvl = await head.post('/api/levels', { name: 'Sophomore' });
  assert.equal(lvl.status, 200);
  const team = await dc.post('/api/teams', { name: 'Sophomore', level_id: lvl.body.id });
  assert.equal(team.status, 200);
  assert.equal((await player.post('/api/teams', { name: 'x', level_id: lvl.body.id })).status, 403);
  assert.equal((await head.del(`/api/levels/${t.levels.Varsity}`)).status, 400, 'cannot delete a level with players');
});

test('players CRUD with duplicate-jersey warning and invite', async () => {
  const qbJersey = t.db.get('SELECT jersey FROM player_profiles WHERE user_id=?', player.id).jersey;
  assert.equal((await player.post('/api/players', { name: 'X' })).status, 403);
  assert.equal((await head.post('/api/players', {})).status, 400);
  assert.equal((await head.post('/api/players', { name: 'Dup Email', email: 'player@ridgeview.example' })).status, 400);
  assert.equal((await head.post('/api/players', { name: 'Bad unit', units: ['offence'] })).status, 400);
  const r = await head.post('/api/players', { name: 'Newbie Jones', email: 'newbie@students.ridgeview.example', team_id: V, jersey: qbJersey, class_year: 2028, units: ['offense'], positions: ['qb'], height: 72, weight: 190 });
  assert.equal(r.status, 200);
  assert.match(r.body.warning, new RegExp(`Jersey #${qbJersey} is also worn by ${player.user.name}`));
  assert.ok(r.body.invite_code);
  assert.ok(t.db.get(`SELECT 1 FROM outbox WHERE to_email='newbie@students.ridgeview.example'`));
  const g = await head.get(`/api/players/${r.body.id}`);
  assert.equal(g.body.height, 72);
  assert.equal(g.body.weight, 190);
  assert.deepEqual(g.body.positions, ['QB']);
  assert.equal(g.body.pending_invite, true);

  const u = await head.put(`/api/players/${r.body.id}`, { jersey: 98, weight: 195 });
  assert.equal(u.status, 200);
  assert.equal(u.body.warning, null);
  assert.equal((await head.get(`/api/players/${r.body.id}`)).body.measurements.filter((m) => m.kind === 'weight').length, 2);
  const inv = await head.post(`/api/players/${r.body.id}/invite`);
  assert.equal(inv.body.invite_code, r.body.invite_code);
  assert.equal((await head.post(`/api/players/${player.id}/invite`)).status, 400, 'already joined');

  const f = await head.get(`/api/players?team_id=${V}&position=QB`);
  assert.ok(f.body.some((p) => p.id === r.body.id));
  assert.ok(f.body.every((p) => p.team_id === V && p.positions.includes('QB')));
});

test('roster import creates players and reports row errors', async () => {
  const r = await head.post('/api/players/import', {
    rows: [
      { name: 'Import One', team: 'Varsity', units: 'Off, ST', positions: 'WR RET', jersey: '81', class_year: '2027', height: '70', weight: '175' },
      { name: '' },
      { name: 'Import Two', team: 'jv red', units: 'def', positions: 'LB' },
      { name: 'Import Dup', email: 'player@ridgeview.example' },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.created, 2);
  assert.deepEqual(r.body.errors.map((e) => e.row), [2, 4]);
  const one = t.db.get(`SELECT p.* FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.name='Import One'`);
  assert.equal(one.team_id, V);
  assert.deepEqual(JSON.parse(one.units), ['offense', 'special']);
  assert.deepEqual(JSON.parse(one.positions), ['WR', 'RET']);
  const two = t.db.get(`SELECT p.team_id FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.name='Import Two'`);
  assert.equal(two.team_id, t.teams['JV Red']);
  assert.equal((await head.post('/api/players/import', { rows: [] })).status, 400);
  const before = t.db.get(`SELECT count(*) n FROM users WHERE role='player'`).n;
  await head.post('/api/players/import', { all_or_nothing: true, rows: [{ name: 'Atomic' }, { name: '' }] });
  assert.equal(t.db.get(`SELECT count(*) n FROM users WHERE role='player'`).n, before, 'all-or-nothing rolls back');
  const csv = await head.get('/api/players/export.csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.ok(csv.body.startsWith('Name,Jersey,Class'));
  assert.ok(csv.body.includes('Import One'));
  assert.equal((await player.get('/api/players/export.csv')).status, 403);
});

test('players edit only their photo and personal fields', async () => {
  const r = await player.put(`/api/players/${player.id}`, { personal: { nickname: 'Ace', ssn: '123', hometown: 'Ridgeview' } });
  assert.equal(r.status, 200);
  const p = JSON.parse(t.db.get('SELECT personal FROM player_profiles WHERE user_id=?', player.id).personal);
  assert.deepEqual(p, { nickname: 'Ace', hometown: 'Ridgeview' });
  assert.equal((await player.put(`/api/players/${player.id}`, { jersey: 1 })).status, 403);
  assert.equal((await player.put(`/api/players/${player.id}`, { photo: 'http://evil.example/x.png' })).status, 400);
  assert.equal((await player.put(`/api/players/${player.id}`, { photo: 'data:image/png;base64,AAAA' })).status, 200);
  const jersey = t.db.get('SELECT jersey FROM player_profiles WHERE user_id=?', player.id).jersey;
  await player.put(`/api/players/${player.id}`, { photo: 'data:image/png;base64,AAAA', jersey: 1, team_id: null });
  assert.equal(t.db.get('SELECT jersey FROM player_profiles WHERE user_id=?', player.id).jersey, jersey, 'coach-owned fields are ignored');
  const other = t.varsity('u.id!=?', player.id)[0];
  assert.equal((await player.put(`/api/players/${other.id}`, { personal: { nickname: 'x' } })).status, 403);
  assert.equal((await parent.put(`/api/players/${player.id}`, { personal: { nickname: 'x' } })).status, 403);
});

test('height/weight and contact details are hidden from players viewing others', async () => {
  const list = await player.get('/api/players');
  assert.equal(list.status, 200);
  const keys = Object.keys(list.body[0]).sort();
  assert.deepEqual(keys, ['class_year', 'id', 'jersey', 'level', 'name', 'photo', 'positions', 'team', 'units']);
  const other = t.varsity('u.id!=?', player.id)[0];
  const o = await player.get(`/api/players/${other.id}`);
  assert.equal(o.status, 200);
  assert.equal(o.body.height, undefined);
  assert.equal(o.body.weight, undefined);
  assert.equal(o.body.email, undefined);
  assert.equal(o.body.measurements, undefined);
  const self = await player.get(`/api/players/${player.id}`);
  assert.equal(typeof self.body.height, 'number');
  // F-8: the athlete sees their height; body weight only once the head coach opens it to families.
  assert.equal(self.body.weight, undefined);
  assert.ok(self.body.measurements.length >= 1 && self.body.measurements.every((m) => m.kind === 'height'));
  const kid = await parent.get(`/api/players/${player.id}`);
  assert.equal(kid.body.weight, undefined);
  const pOther = await parent.get(`/api/players/${other.id}`);
  assert.equal(pOther.body.weight, undefined);
  // volunteer staff see the roster but not body measurements or emails
  const vol = await t.as('Team manager (volunteer)');
  const v = await vol.get(`/api/players/${other.id}`);
  assert.equal(v.body.height, undefined);
  assert.equal(v.body.email, undefined);
  const c = await head.get(`/api/players/${other.id}`);
  assert.equal(typeof c.body.height, 'number');
  assert.ok(c.body.email);
  assert.ok(Array.isArray(c.body.parents));
  assert.ok(t.db.get(`SELECT 1 FROM audit WHERE action='view' AND entity='player' AND entity_id=? AND user_id=?`, other.id, head.id), 'staff profile views are audited');
});

test('availability is set by trainers (and coaches) and notifies staff', async () => {
  const target = t.varsity('u.id!=?', player.id)[1];
  assert.equal((await player.put(`/api/players/${target.id}/availability`, { availability: 'out' })).status, 403);
  const vol = await t.as('Team manager (volunteer)');
  assert.equal((await vol.put(`/api/players/${target.id}/availability`, { availability: 'out' })).status, 403);
  assert.equal((await trainer.put(`/api/players/${target.id}/availability`, { availability: 'hurt' })).status, 400);
  const r = await trainer.put(`/api/players/${target.id}/availability`, { availability: 'limited', note: 'Hamstring', return_date: '2099-01-01' });
  assert.equal(r.status, 200);
  const row = t.db.get('SELECT availability, avail_note, avail_updated_by FROM player_profiles WHERE user_id=?', target.id);
  assert.deepEqual(row, { availability: 'limited', avail_note: 'Hamstring', avail_updated_by: trainer.id });
  assert.equal(t.notifications(head.id, `${target.name}: limited`).length, 1);
  const pl = await t.as(target.id);
  assert.equal((await pl.get(`/api/players/${target.id}`)).body.avail_note, 'Hamstring');
  const tm = await player.get(`/api/players/${target.id}`);
  assert.equal(tm.body.avail_note, undefined, 'teammates do not see medical notes');
  assert.equal((await head.get(`/api/players?availability=limited`)).body.some((p) => p.id === target.id), true);
});

test('depth charts: create, copy, move logs and player visibility', async () => {
  const src = t.db.get(`SELECT * FROM depth_charts WHERE unit='offense' ORDER BY id DESC LIMIT 1`);
  assert.equal((await trainer.post('/api/depth', { team_id: V, unit: 'offense', week_label: 'x' })).status, 403);
  assert.equal((await head.post('/api/depth', { team_id: V, unit: 'kickoff', week_label: 'x' })).status, 400);
  const blank = await head.post('/api/depth', { team_id: V, unit: 'defense', week_label: 'Blank week' });
  const b = await head.get(`/api/depth/${blank.body.id}`);
  assert.deepEqual(Object.values(b.body.slots).flat(), []);
  assert.ok(b.body.layout.length === 11);

  // A unit coordinator builds only their own unit's charts (group limits).
  const dc = await t.as('Defensive coordinator');
  assert.equal((await dc.post('/api/depth', { team_id: V, unit: 'offense', week_label: 'Test week', copy_from: src.id })).status, 403);
  const oc = await t.as('Offensive coordinator');
  const c = await oc.post('/api/depth', { team_id: V, unit: 'offense', week_label: 'Test week', copy_from: src.id });
  assert.equal(c.status, 200);
  const chart = await head.get(`/api/depth/${c.body.id}`);
  assert.deepEqual(chart.body.slots, JSON.parse(src.slots));
  assert.ok(Object.values(chart.body.cards).every((x) => 'height' in x && 'avg_rating' in x));

  // move: swap the QB order
  const slots = chart.body.slots;
  const [a, bb] = slots.QB;
  const moved = { ...slots, QB: [bb, a, ...slots.QB.slice(2)] };
  assert.equal((await head.put(`/api/depth/${c.body.id}`, { slots: { QB: ['x'] } })).status, 400);
  assert.equal((await head.put(`/api/depth/${c.body.id}`, { slots: moved })).status, 200);
  const logs = t.db.all(`SELECT entity_id, detail FROM audit WHERE action='depth_move' AND json_extract(detail,'$.chart')=?`, c.body.id).map((r) => ({ id: r.entity_id, ...JSON.parse(r.detail) }));
  assert.equal(logs.length, 2);
  assert.deepEqual(logs.find((l) => l.id === bb), { id: bb, chart: c.body.id, week: 'Test week', unit: 'offense', slot: 'QB', from: 2, to: 1 });
  // removing a player is logged too
  const removed = { ...moved, QB: [bb] };
  await head.put(`/api/depth/${c.body.id}`, { slots: removed });
  assert.ok(t.db.all(`SELECT detail FROM audit WHERE action='depth_move' AND entity_id=?`, a).some((r) => JSON.parse(r.detail).to === null));

  // hidden from players until published
  assert.equal((await player.get(`/api/depth/${c.body.id}`)).status, 404);
  assert.ok(!(await player.get('/api/depth')).body.some((x) => x.id === c.body.id));
  await head.put(`/api/depth/${c.body.id}`, { visible_to_players: true });
  const pv = await player.get(`/api/depth/${c.body.id}`);
  assert.equal(pv.status, 200);
  assert.ok(Object.values(pv.body.cards).every((x) => x.height === undefined && x.availability === undefined), 'players do not see measurements or availability');
  assert.equal((await parent.get(`/api/depth/${c.body.id}`)).status, 200);
  // a JV player does not see varsity charts
  const jv = await t.as(t.players('p.team_id=?', t.teams['JV Red'])[0].id);
  assert.equal((await jv.get(`/api/depth/${c.body.id}`)).status, 404);
  assert.deepEqual((await jv.get('/api/depth')).body, []);
  const special = t.db.get(`SELECT id FROM depth_charts WHERE unit='special' AND visible_to_players=0`).id;
  assert.equal((await player.get(`/api/depth/${special}`)).status, 404);
});

test('archive ends access; nutrition opt-out by player or parent only', async () => {
  const target = t.players('p.team_id=?', t.teams.Freshman).find((p) => p.password_hash);
  const pc = await t.as(target.id);
  assert.equal((await pc.get('/api/me')).status, 200);
  const dc = await t.as('Defensive coordinator');
  assert.equal((await dc.post(`/api/players/${target.id}/archive`)).status, 403);
  assert.equal((await head.post(`/api/players/${target.id}/archive`)).status, 200);
  assert.equal((await pc.get('/api/me')).status, 401);
  // and they cannot simply sign back in
  const relogin = await t.anon.post('/api/auth/login', { email: target.email, password: 'password123' });
  assert.equal(relogin.status, 401);
  assert.ok(!(await head.get('/api/players')).body.some((p) => p.id === target.id));
  // restoring the player restores sign-in
  await head.post(`/api/players/${target.id}/archive`, { archived: false });
  assert.equal((await t.anon.post('/api/auth/login', { email: target.email, password: 'password123' })).status, 200);
  await head.post(`/api/players/${target.id}/archive`);
  assert.ok((await head.get('/api/players?archived=1')).body.some((p) => p.id === target.id));

  assert.equal((await dc.post(`/api/players/${player.id}/opt-out`, { opt_out: true })).status, 403);
  assert.equal((await parent.post(`/api/players/${player.id}/opt-out`, { opt_out: true })).status, 200);
  assert.equal(t.db.get('SELECT nutrition_opt_out FROM player_profiles WHERE user_id=?', player.id).nutrition_opt_out, 1);
  await player.post(`/api/players/${player.id}/opt-out`, { opt_out: false });
  assert.equal(t.db.get('SELECT nutrition_opt_out FROM player_profiles WHERE user_id=?', player.id).nutrition_opt_out, 0);
});

test('depth charts: ratings only with ratings access; scoped coaches limited to their teams/units; players from this program only', async () => {
  const src = t.db.get(`SELECT * FROM depth_charts WHERE unit='offense' AND team_id=? ORDER BY id LIMIT 1`, V);
  const tr = await trainer.get(`/api/depth/${src.id}`);
  assert.equal(tr.status, 200);
  assert.ok(Object.values(tr.body.cards).every((x) => 'height' in x && x.avg_rating === undefined), 'trainer sees measurements but not ratings');
  const jvh = await t.as('JV head coach');
  assert.equal((await jvh.post('/api/depth', { team_id: V, unit: 'offense', week_label: 'nope' })).status, 403);
  const jv = await jvh.post('/api/depth', { team_id: t.teams['JV Red'], unit: 'offense', week_label: 'JV wk' });
  assert.equal(jv.status, 200);
  assert.equal((await jvh.put(`/api/depth/${src.id}`, { week_label: 'hijack' })).status, 403);
  assert.equal((await jvh.del(`/api/depth/${src.id}`)).status, 403);
  const other = addOtherProgram(t);
  assert.equal((await jvh.put(`/api/depth/${jv.body.id}`, { slots: { QB: [other.player] } })).status, 400);
  assert.equal((await jvh.del(`/api/depth/${jv.body.id}`)).status, 200);
});

test('season rollover signs graduates out and removes them from groups and chats', async () => {
  const year = t.db.get(`SELECT min(p.class_year) y FROM player_profiles p JOIN users u ON u.id=p.user_id WHERE u.program_id=? AND p.archived=0`, head.user.program_id).y;
  const ids = t.db.all(`SELECT p.user_id id FROM player_profiles p JOIN users u ON u.id=p.user_id WHERE u.program_id=? AND p.archived=0 AND p.class_year<=?`, head.user.program_id, year).map((r) => r.id);
  const c = await t.as(ids[0]);
  assert.equal((await c.get('/api/me')).status, 200);
  const g = await head.post('/api/groups', { name: 'Seniors', members: ids });
  const chat = t.db.get('SELECT chat_id FROM chat_members WHERE user_id=? LIMIT 1', ids[0]);
  const r = await head.post('/api/players/rollover', { graduating_class: year });
  assert.equal(r.body.archived, ids.length);
  assert.equal((await c.get('/api/me')).status, 401);
  assert.equal(t.db.get(`SELECT count(*) n FROM sessions WHERE user_id IN (${ids.join(',')})`).n, 0);
  assert.equal(t.db.get('SELECT count(*) n FROM group_members WHERE group_id=?', g.body.id).n, 0);
  if (chat) assert.ok(!t.db.get('SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?', chat.chat_id, ids[0]));
  for (const id of ids) t.db.run('UPDATE player_profiles SET archived=0 WHERE user_id=?', id);
});

test('nutrition opt-out by an admin is limited to their own program', async () => {
  const other = addOtherProgram(t);
  assert.equal((await head.post(`/api/players/${other.player}/opt-out`, { opt_out: true })).status, 403);
  assert.equal(t.db.get('SELECT nutrition_opt_out FROM player_profiles WHERE user_id=?', other.player).nutrition_opt_out, 0);
});

test('F-8 body weight follows one rule: body-data staff, and families only when the head coach allows it', async () => {
  const qbc = await t.as('QB coach');
  const sc = await t.as('Strength and conditioning');
  const other = t.varsity('u.id!=?', player.id)[0];
  // a coach without body-data access sees height but never weight (profile, roster list, depth chart cards)
  const q = await qbc.get(`/api/players/${other.id}`);
  assert.equal(typeof q.body.height, 'number');
  assert.equal(q.body.weight, undefined);
  assert.ok(q.body.measurements.every((m) => m.kind === 'height'));
  assert.ok((await qbc.get('/api/players')).body.every((p) => p.weight === undefined));
  const chart = t.db.get(`SELECT id FROM depth_charts WHERE team_id=? AND unit='offense' ORDER BY id LIMIT 1`, V).id;
  const qc = await qbc.get(`/api/depth/${chart}`);
  assert.ok(Object.values(qc.body.cards).every((x) => 'height' in x && x.weight === undefined));
  // body-data staff see it everywhere
  for (const c of [head, trainer, sc]) {
    const r = await c.get(`/api/players/${other.id}`);
    assert.equal(typeof r.body.weight, 'number');
    assert.ok(r.body.measurements.some((m) => m.kind === 'weight'));
  }
  assert.ok(Object.values((await trainer.get(`/api/depth/${chart}`)).body.cards).some((x) => typeof x.weight === 'number'));
  // families: only with family_sees_bodyweight (fresh sign-ins: the rollover test above signs graduates out)
  const fresh = async (c) => t.client((await t.anon.post('/api/auth/demo', { user_id: c.id })).body.token);
  const pl = await fresh(player);
  const pa = await fresh(parent);
  await t.setSettings({ family_sees_bodyweight: true });
  const self = await pl.get(`/api/players/${player.id}`);
  assert.equal(typeof self.body.weight, 'number');
  assert.ok(self.body.measurements.some((m) => m.kind === 'weight'));
  assert.equal(typeof (await pa.get(`/api/players/${player.id}`)).body.weight, 'number');
  assert.equal((await pl.get(`/api/players/${other.id}`)).body.weight, undefined, 'never a teammate');
  const vol = await t.as('Team manager (volunteer)');
  assert.equal((await vol.get(`/api/players/${other.id}`)).body.weight, undefined, 'the setting is for families, not volunteers');
  await t.setSettings({ family_sees_bodyweight: false });
  assert.equal((await pl.get(`/api/players/${player.id}`)).body.weight, undefined);
});

test('roster import with all_or_nothing rolls back and returns 400 with the row errors', async () => {
  const before = t.db.get(`SELECT count(*) n FROM users WHERE role='player'`).n;
  const r = await head.post('/api/players/import', { all_or_nothing: true, rows: [{ name: 'Atomic One', team: 'Varsity', positions: 'WR' }, { name: '' }] });
  assert.equal(r.status, 400);
  assert.equal(r.body.created, 0);
  assert.deepEqual(r.body.errors.map((e) => e.row), [2]);
  assert.ok(r.body.error);
  assert.equal(t.db.get(`SELECT count(*) n FROM users WHERE role='player'`).n, before);
  assert.ok(!t.db.get(`SELECT 1 FROM users WHERE name='Atomic One'`));
});

test('C-3 availability: trainers are program-wide; a coach limited to groups sets only their own players', async () => {
  const qbc = await t.as('QB coach');
  const qb = t.varsity(`p.positions LIKE '%"QB"%'`)[0];
  const ol = t.varsity(`p.positions LIKE '%"OL"%'`)[0];
  assert.equal((await qbc.put(`/api/players/${ol.id}/availability`, { availability: 'limited' })).status, 403);
  assert.equal((await qbc.put(`/api/players/${qb.id}/availability`, { availability: 'limited' })).status, 200);
  assert.equal((await trainer.put(`/api/players/${ol.id}/availability`, { availability: 'limited' })).status, 200);
  const sc = await t.as('Strength and conditioning');
  assert.equal((await sc.put(`/api/players/${ol.id}/availability`, { availability: 'full' })).status, 200, 'a coach without group limits is program-wide');
  await trainer.put(`/api/players/${qb.id}/availability`, { availability: 'full' });
});

test('C-2 roster shows the same position group as the weight room (K/P, RB/TE)', async () => {
  const k = t.players(`p.positions LIKE '%"K"%'`)[0];
  const list = (await head.get('/api/players')).body;
  assert.equal(list.find((p) => p.id === k.id).group, 'K/P');
  const te = t.players(`p.positions = '["TE"]'`)[0];
  if (te) assert.equal(list.find((p) => p.id === te.id).group, 'RB/TE');
});
