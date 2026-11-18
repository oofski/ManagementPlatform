import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, today, addOtherProgram } from './helpers.js';

let t; let head; let eq; let dc; let player; let parent; let year;
before(async () => {
  t = await start();
  head = await t.as('coach@ridgeview.example');
  eq = await t.as('Equipment manager');
  dc = await t.as('Defensive coordinator');
  player = await t.as('player@ridgeview.example');
  parent = await t.as('parent@ridgeview.example');
  year = Number(today().slice(0, 4));
});
after(() => t.close());

let helmetType; let shirtType; let helmetA; let helmetB;
const fresh = () => t.players('p.team_id=?', t.teams.Freshman);

test('permissions: only the head coach and equipment manager manage; staff view; players do not', async () => {
  assert.equal((await dc.post('/api/eq/types', { name: 'X' })).status, 403);
  assert.equal((await dc.post('/api/eq/issue', { player_id: player.id, type_id: 1 })).status, 403);
  assert.equal((await dc.get('/api/eq/types')).status, 200);
  assert.equal((await player.get('/api/eq/types')).status, 403);
  assert.equal((await player.get('/api/eq/outstanding')).status, 403);
  assert.equal((await parent.get('/api/eq/helmets')).status, 403);
  const vol = await t.as('Team manager (volunteer)');
  assert.equal((await vol.post('/api/eq/issue', { player_id: player.id, type_id: 1 })).status, 403);
  const h = await head.post('/api/eq/types', { name: 'Head coach type', tracking: 'bulk' });
  assert.equal(h.status, 200);
  assert.equal((await eq.post('/api/eq/types', { name: 'Bad', tracking: 'rfid' })).status, 400);
});

test('serialized items: unique serials, issue, double-issue blocked, return', async () => {
  helmetType = (await eq.post('/api/eq/types', { name: 'Test helmet', category: 'helmet', tracking: 'serial', cost: 400, low_stock: 1 })).body.id;
  assert.equal((await eq.post('/api/eq/items', { type_id: helmetType })).status, 400, 'serial required');
  helmetA = (await eq.post('/api/eq/items', { type_id: helmetType, serial: 'TH-001', size: 'L', manuf_year: year - 2, recert_year: year })).body.id;
  helmetB = (await eq.post('/api/eq/items', { type_id: helmetType, serial: 'TH-002', size: 'L', manuf_year: year - 2, recert_year: year })).body.id;
  assert.equal((await eq.post('/api/eq/items', { type_id: helmetType, serial: 'TH-001' })).status, 400);
  assert.equal((await eq.post('/api/eq/items', { type_id: helmetType, serial: 'RH-10400' })).status, 400, 'serial already used by a seeded helmet');

  const [a, b, c] = fresh();
  const i1 = await eq.post('/api/eq/issue', { player_id: a.id, type_id: helmetType, item_id: helmetA, jersey: 44 });
  assert.equal(i1.status, 200);
  assert.equal(t.db.get('SELECT jersey FROM player_profiles WHERE user_id=?', a.id).jersey, 44);
  assert.equal(t.notifications(a.id, 'Equipment issued').length, 1);
  const twice = await eq.post('/api/eq/issue', { player_id: b.id, type_id: helmetType, item_id: helmetA });
  assert.equal(twice.status, 400);
  assert.match(twice.body.error, /already issued/);
  // without an item id the next free one is picked
  const i2 = await eq.post('/api/eq/issue', { player_id: b.id, type_id: helmetType, size: 'L' });
  assert.equal(t.db.get('SELECT item_id FROM eq_issues WHERE id=?', i2.body.id).item_id, helmetB);
  assert.equal((await eq.post('/api/eq/issue', { player_id: c.id, type_id: helmetType, size: 'L' })).status, 400, 'none left');
  assert.equal((await eq.post('/api/eq/issue', { player_id: head.id, type_id: helmetType })).status, 404, 'only players');

  const look = await dc.get('/api/eq/lookup?code=TH-001');
  assert.equal(look.body.open_issue.player_id, a.id);
  assert.equal((await dc.get(`/api/eq/lookup?code=ITEM-${helmetB}`)).body.serial, 'TH-002');
  assert.equal((await dc.get('/api/eq/lookup?code=NOPE')).status, 404);

  assert.equal((await eq.post(`/api/eq/issues/${i1.body.id}/return`, { status: 'stolen' })).status, 400);
  assert.equal((await dc.post(`/api/eq/issues/${i1.body.id}/return`, { status: 'returned' })).status, 403);
  const ret = await eq.post(`/api/eq/issues/${i1.body.id}/return`, { status: 'returned', condition: 'fair' });
  assert.equal(ret.status, 200);
  assert.equal((await eq.post(`/api/eq/issues/${i1.body.id}/return`, { status: 'returned' })).status, 400);
  assert.equal(t.db.get('SELECT condition FROM eq_items WHERE id=?', helmetA).condition, 'fair');
  // available again
  assert.equal((await eq.post('/api/eq/issue', { player_id: c.id, type_id: helmetType, item_id: helmetA })).status, 200);
  const hist = await dc.get(`/api/eq/items/${helmetA}/history`);
  assert.equal(hist.body.issues.length, 2);
  assert.ok(hist.body.changes.some((x) => x.action === 'return_returned'));
  // lost items are retired and stay on the outstanding list
  await eq.post(`/api/eq/issues/${i2.body.id}/return`, { status: 'lost' });
  assert.equal(t.db.get('SELECT retired FROM eq_items WHERE id=?', helmetB).retired, 1);
  const out = await dc.get('/api/eq/outstanding');
  assert.ok(out.body.find((p) => p.player_id === b.id).items.some((x) => x.return_status === 'lost'));
});

test('bulk stock: one row per size, quantities go down on issue and back on return', async () => {
  shirtType = (await eq.post('/api/eq/types', { name: 'Test shirt', category: 'practice gear', tracking: 'bulk', cost: 20, low_stock: 4 })).body.id;
  const s1 = await eq.post('/api/eq/items', { type_id: shirtType, size: 'L', qty: 5 });
  const s2 = await eq.post('/api/eq/items', { type_id: shirtType, size: 'L', qty: 3 });
  assert.equal(s1.body.id, s2.body.id);
  assert.equal(t.db.get('SELECT qty FROM eq_items WHERE id=?', s1.body.id).qty, 8);
  const [a] = fresh();
  const tooMany = await eq.post('/api/eq/issue', { player_id: a.id, type_id: shirtType, size: 'L', qty: 9 });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.error, /Not enough/);
  assert.equal((await eq.post('/api/eq/issue', { player_id: a.id, type_id: shirtType, size: 'M' })).status, 400, 'no stock row for that size');
  const iss = await eq.post('/api/eq/issue', { player_id: a.id, type_id: shirtType, size: 'L', qty: 2 });
  assert.equal(t.db.get('SELECT qty FROM eq_items WHERE id=?', s1.body.id).qty, 6);
  await eq.post(`/api/eq/issues/${iss.body.id}/return`, { status: 'returned' });
  assert.equal(t.db.get('SELECT qty FROM eq_items WHERE id=?', s1.body.id).qty, 8);
  const iss2 = await eq.post('/api/eq/issue', { player_id: a.id, type_id: shirtType, size: 'L', qty: 1 });
  await eq.post(`/api/eq/issues/${iss2.body.id}/return`, { status: 'damaged' });
  assert.equal(t.db.get('SELECT qty FROM eq_items WHERE id=?', s1.body.id).qty, 7, 'damaged returns do not go back into stock');
});

test('bulk issue a kit to several players with per-player sizes', async () => {
  const ps = fresh().slice(3, 6);
  t.db.run('UPDATE eq_items SET qty=2 WHERE type_id=? AND size=?', shirtType, 'L');
  await eq.post('/api/eq/items', { type_id: shirtType, size: 'XL', qty: 1 });
  const r = await eq.post('/api/eq/bulk-issue', {
    player_ids: ps.map((p) => p.id),
    kit: [{ type_id: shirtType, size: 'per_player' }],
    sizes: { [ps[0].id]: { [shirtType]: 'L' }, [ps[1].id]: { [shirtType]: 'XL' }, [ps[2].id]: { [shirtType]: 'XL' } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.issued, 2);
  assert.equal(r.body.errors.length, 1);
  assert.equal(r.body.errors[0].player_id, ps[2].id);
  assert.equal((await eq.post('/api/eq/bulk-issue', { player_ids: [], kit: [] })).status, 400);
  assert.equal(t.notifications(ps[0].id, 'Equipment issued').length, 1);
});

test('outstanding list with replacement cost and CSV export', async () => {
  const out = await eq.get('/api/eq/outstanding');
  const me = out.body.find((p) => p.player_id === player.id);
  assert.ok(me.items.length >= 2);
  assert.equal(me.total_cost, me.items.reduce((s, i) => s + (i.cost || 0) * i.qty, 0));
  const csv = await eq.get('/api/eq/outstanding.csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.ok(csv.body.split('\n')[0].includes('Replacement cost'));
  assert.ok(csv.body.includes(player.user.name));
});

test('players and parents acknowledge their own issued items', async () => {
  const mine = await player.get(`/api/eq/player/${player.id}`);
  assert.equal(mine.status, 200);
  const item = mine.body.find((x) => !x.returned_at);
  const other = t.varsity('u.id!=?', player.id)[0];
  assert.equal((await player.get(`/api/eq/player/${other.id}`)).status, 403);
  const otherIssue = t.db.get('SELECT id FROM eq_issues WHERE player_id=? LIMIT 1', other.id).id;
  assert.equal((await player.post(`/api/eq/issues/${otherIssue}/ack`)).status, 403);
  assert.equal((await eq.post(`/api/eq/issues/${item.id}/ack`)).status, 403, 'staff cannot acknowledge for the player');
  assert.equal((await player.post(`/api/eq/issues/${item.id}/ack`)).status, 200);
  const at = t.db.get('SELECT acknowledged_at FROM eq_issues WHERE id=?', item.id).acknowledged_at;
  assert.ok(at);
  await player.post(`/api/eq/issues/${item.id}/ack`);
  assert.equal(t.db.get('SELECT acknowledged_at FROM eq_issues WHERE id=?', item.id).acknowledged_at, at, 'first acknowledgment is kept');
  const second = mine.body.filter((x) => !x.returned_at && !x.acknowledged_at && x.id !== item.id)[0];
  assert.equal((await parent.post(`/api/eq/issues/${second.id}/ack`)).status, 200);
  const home = await player.get('/api/home');
  assert.equal(typeof home.body.players[0].equipment_unacknowledged, 'number');
});

test('helmet flags for age, recertification and useful life; fits', async () => {
  const old = (await eq.post('/api/eq/items', { type_id: helmetType, serial: 'TH-OLD', manuf_year: year - 12, recert_year: year })).body.id;
  const norecert = (await eq.post('/api/eq/items', { type_id: helmetType, serial: 'TH-NR', manuf_year: year - 3 })).body.id;
  const due = (await eq.post('/api/eq/items', { type_id: helmetType, serial: 'TH-DUE', manuf_year: year - 3, recert_year: year - 2 })).body.id;
  const life = (await eq.post('/api/eq/items', { type_id: helmetType, serial: 'TH-LIFE', manuf_year: year - 6, allows_recert: false })).body.id;
  const ok = helmetA;
  const list = await dc.get('/api/eq/helmets');
  const flags = Object.fromEntries(list.body.map((h) => [h.id, h.flags]));
  assert.ok(flags[old].some((f) => f.startsWith('Past program age rule')));
  assert.ok(flags[norecert].includes('No recertification on record'));
  assert.ok(flags[due].some((f) => f.startsWith('Recertification due')));
  assert.ok(flags[life].some((f) => f.startsWith('Past 5-year useful life')));
  assert.deepEqual(flags[ok], []);
  assert.ok(!list.body.some((h) => h.id === helmetB), 'retired helmets are not listed');
  assert.equal((await dc.post('/api/eq/fits', { item_id: ok, player_id: player.id })).status, 403);
  assert.equal((await eq.post('/api/eq/fits', { item_id: t.db.get(`SELECT id FROM eq_items WHERE type_id=? LIMIT 1`, shirtType).id, player_id: player.id })).status, 404);
  assert.equal((await eq.post('/api/eq/fits', { item_id: ok, player_id: player.id, notes: 'Snug' })).status, 200);
  assert.equal((await dc.get('/api/eq/helmets')).body.find((h) => h.id === ok).last_fit, today());
  // a stricter program age rule flags more helmets
  await t.setSettings({ helmet_max_age_years: 2 });
  assert.ok((await dc.get('/api/eq/helmets')).body.find((h) => h.id === ok).flags.some((f) => f.startsWith('Past program age rule')));
});

test('inventory counts and reorder list', async () => {
  const inv = await dc.get('/api/eq/inventory');
  const shirtL = inv.body.rows.find((r) => r.type_id === shirtType && r.size === 'L');
  assert.equal(shirtL.available, 1);
  assert.equal(shirtL.low, true);
  const re = inv.body.reorder.find((r) => r.type_id === shirtType && r.size === 'L');
  assert.equal(re.suggested, 7);
  assert.equal(re.est_cost, '140.00');
  const helm = inv.body.rows.find((r) => r.type_id === helmetType);
  assert.equal(helm.size, 'all');
  assert.equal(helm.issued, 1);
});

test('equipment: another program\'s player cannot be read or have a jersey changed', async () => {
  const other = addOtherProgram(t);
  assert.equal((await eq.get(`/api/eq/player/${other.player}`)).status, 403);
  assert.equal((await head.get(`/api/eq/player/${other.player}`)).status, 403);
  assert.equal((await eq.post('/api/eq/issue', { player_id: other.player, jersey: 99 })).status, 404);
  assert.equal(t.db.get('SELECT jersey FROM player_profiles WHERE user_id=?', other.player).jersey, 7);
  assert.ok(!t.db.get(`SELECT 1 FROM audit WHERE action='assign_jersey' AND entity_id=?`, other.player));
});
