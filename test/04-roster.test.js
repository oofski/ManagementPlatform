import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';

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
  assert.ok(self.body.measurements.length >= 2);
  const kid = await parent.get(`/api/players/${player.id}`);
  assert.equal(typeof kid.body.weight, 'number');
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

  const dc = await t.as('Defensive coordinator');
  const c = await dc.post('/api/depth', { team_id: V, unit: 'offense', week_label: 'Test week', copy_from: src.id });
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
