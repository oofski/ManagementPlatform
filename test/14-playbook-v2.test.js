// Playbook v2 (docs/requirements-v2-playbook.md): playbooks own their plays, play tags, duplicates, formations with a cap,
// positions, custom routes, preferences (Defensive Coordinator Mode) and the Playcaller call log.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, addOtherProgram } from './helpers.js';

let t; let head; let dc; let player; let parent; let other; let off; let def;
before(async () => {
  t = await start();
  head = await t.as('coach@ridgeview.example');
  dc = await t.as('Defensive coordinator');
  player = await t.as('player@ridgeview.example');
  parent = await t.as('parent@ridgeview.example');
  other = addOtherProgram(t);
  off = t.db.get(`SELECT id FROM playbooks WHERE name='Varsity offense'`).id;
  def = t.db.get(`SELECT id FROM playbooks WHERE name='Varsity defense'`).id;
});
after(() => t.close());

test('PB-1/PL-1: a play must live in a playbook of this program', async () => {
  const otherBook = t.db.insert('playbooks', { program_id: other.program_id, name: 'Other book' });
  assert.equal((await head.post('/api/plays', { name: 'X', playbook_id: 99999 })).status, 400);
  assert.equal((await head.post('/api/plays', { name: 'X', playbook_id: otherBook })).status, 400);
  const ok = await head.post('/api/plays', { name: 'Home play', playbook_id: off });
  assert.equal(ok.status, 200);
  assert.equal((await head.put(`/api/plays/${ok.body.id}`, { playbook_id: null })).status, 400);
  assert.equal((await head.put(`/api/plays/${ok.body.id}`, { playbook_id: otherBook })).status, 400);
  // a program without playbooks cannot add plays
  const oh = await t.as(other.head);
  t.db.run('DELETE FROM playbooks WHERE program_id=?', other.program_id);
  assert.equal((await oh.post('/api/plays', { name: 'Orphan' })).status, 400);
  // legacy plays without a playbook get one when the list is read
  t.db.run('UPDATE plays SET playbook_id=NULL WHERE id=?', ok.body.id);
  const books = await head.get('/api/playbooks');
  const unsorted = books.body.find((b) => b.name === 'Unsorted plays');
  assert.ok(unsorted);
  assert.equal(t.db.get('SELECT playbook_id FROM plays WHERE id=?', ok.body.id).playbook_id, unsorted.id);
});

test('PB-2/PB-6: rename, counts, and delete removes every play inside (and its references)', async () => {
  const b = (await head.post('/api/playbooks', { name: 'Goal line' })).body.id;
  assert.equal((await head.put(`/api/playbooks/${b}`, { name: '  ' })).status, 400);
  assert.equal((await head.put(`/api/playbooks/${b}`, { name: 'Goal line package' })).status, 200);
  const p1 = (await head.post('/api/plays', { name: 'GL Sneak', playbook_id: b, side: 'offense' })).body.id;
  const p2 = (await head.post('/api/plays', { name: 'GL Bear', playbook_id: b, side: 'defense' })).body.id;
  const got = await head.get(`/api/playbooks/${b}`);
  assert.equal(got.body.name, 'Goal line package');
  assert.equal(got.body.play_count, 2);
  const row = (await head.get('/api/playbooks')).body.find((x) => x.id === b);
  assert.equal(row.offense_count, 1); assert.equal(row.defense_count, 1);
  const inst = (await head.post('/api/installs', { name: 'GL install', play_ids: [p1], audience: [`player:${player.id}`] })).body.id;
  assert.equal((await player.get(`/api/plays/${p1}`)).status, 200);
  // other programs and players cannot delete it
  const oh = await t.as(other.head);
  assert.equal((await oh.del(`/api/playbooks/${b}`)).status, 404);
  assert.equal((await player.del(`/api/playbooks/${b}`)).status, 403);
  const d = await head.del(`/api/playbooks/${b}`);
  assert.equal(d.status, 200);
  assert.equal(d.body.plays_deleted, 2);
  assert.equal(t.db.get('SELECT count(*) n FROM plays WHERE id IN (?,?)', p1, p2).n, 0);
  assert.deepEqual(JSON.parse(t.db.get('SELECT play_ids FROM install_sheets WHERE id=?', inst).play_ids), []);
  // a new play that happens to reuse a deleted id does not inherit the old audience
  const fresh = (await head.post('/api/plays', { name: 'Fresh secret', playbook_id: off })).body.id;
  assert.equal((await player.get(`/api/plays/${fresh}`)).status, 404);
  assert.ok(t.db.get(`SELECT 1 FROM audit WHERE action='delete' AND entity='playbook' AND entity_id=?`, b));
});

test('PL-3: duplicate adds "(Copy)"; Duplicate to Playbook copies into another playbook', async () => {
  const src = (await head.post('/api/plays', { name: 'Mesh', playbook_id: off, situation: { play_type: ['Pass'] } })).body.id;
  const c1 = await head.post(`/api/plays/${src}/duplicate`, {});
  const copy = (await head.get(`/api/plays/${c1.body.id}`)).body;
  assert.equal(copy.name, 'Mesh (Copy)');
  assert.equal(copy.playbook_id, off);
  assert.deepEqual(copy.situation.play_type, ['Pass']);
  const c2 = await head.post(`/api/plays/${src}/duplicate`, { playbook_id: def });
  assert.equal((await head.get(`/api/plays/${c2.body.id}`)).body.playbook_id, def);
  const otherBook = t.db.insert('playbooks', { program_id: other.program_id, name: 'Theirs' });
  assert.equal((await head.post(`/api/plays/${src}/duplicate`, { playbook_id: otherBook })).status, 400);
  assert.equal((await player.post(`/api/plays/${src}/duplicate`, {})).status, 403);
});

test('PL-4: play tags are checkbox values that drive grouping filters; restore brings them back', async () => {
  const id = (await head.post('/api/plays', { name: 'Tagged', playbook_id: off, situation: { play_type: ['Pass', 'Bogus'], distance: ['Short'], down_distance: ['3rd & Short', 'nope'] } })).body.id;
  let p = (await head.get(`/api/plays/${id}`)).body;
  assert.deepEqual(p.situation, { play_type: ['Pass'], distance: ['Short'], down_distance: ['3rd & Short'] });
  assert.ok((await head.get('/api/plays?down_distance=3rd%20%26%20Short')).body.some((x) => x.id === id));
  assert.ok(!(await head.get('/api/plays?play_type=Run')).body.some((x) => x.id === id));
  await head.put(`/api/plays/${id}`, { situation: { play_type: ['Run'] } });
  await head.post(`/api/plays/${id}/restore`, { version: 1 });
  p = (await head.get(`/api/plays/${id}`)).body;
  assert.deepEqual(p.situation.play_type, ['Pass']);
});

test('PL-5: export stays coach-only and never for players or parents', async () => {
  const smash = t.db.get(`SELECT id FROM plays WHERE name LIKE '%Smash'`).id;
  assert.equal((await player.get(`/api/plays/${smash}/export`)).status, 403);
  assert.equal((await parent.get(`/api/plays/${smash}/export`)).status, 403);
  assert.equal((await player.get('/api/playbook/config')).body.can_export, false);
  assert.equal((await head.get(`/api/plays/${smash}/export`)).status, 200);
});

test('PL-6: Defensive Coordinator Mode is a per-user preference', async () => {
  assert.equal((await dc.get('/api/playbook/config')).body.dc_mode, false);
  assert.equal((await dc.put('/api/pb/prefs', { dc_mode: true })).body.dc_mode, true);
  assert.equal((await dc.get('/api/playbook/config')).body.dc_mode, true);
  assert.equal((await head.get('/api/playbook/config')).body.dc_mode, false, 'other coaches are unaffected');
  for (let i = 0; i < 10; i++) await dc.put('/api/pb/prefs', { recent_route: `lib:r${i}` });
  await dc.put('/api/pb/prefs', { recent_route: 'lib:r5' });
  const pr = (await dc.get('/api/pb/prefs')).body;
  assert.equal(pr.recent_routes.length, 8);
  assert.equal(pr.recent_routes[0], 'lib:r5');
  assert.equal((await player.get('/api/pb/prefs')).status, 403);
});

test('FM-1..FM-3: formations can be opened, renamed, duplicated and capped', async () => {
  const f = (await head.post('/api/formations', { name: 'Empty', side: 'offense', data: [{ id: 'x', team: 'O', x: 10, y: 32 }] })).body.id;
  assert.equal((await head.post('/api/formations', { name: 'Bad', data: 'nope' })).status, 400);
  assert.equal((await head.get(`/api/formations/${f}`)).body.data.length, 1);
  assert.equal((await head.put(`/api/formations/${f}`, { name: 'Empty 2x2' })).status, 200);
  const dup = await head.post(`/api/formations/${f}/duplicate`);
  assert.equal((await head.get(`/api/formations/${dup.body.id}`)).body.name, 'Empty 2x2 (Copy)');
  const oh = await t.as(other.head);
  assert.equal((await oh.get(`/api/formations/${f}`)).status, 404);
  assert.equal((await oh.put(`/api/formations/${f}`, { name: 'x' })).status, 404);
  assert.equal((await player.get(`/api/formations/${f}`)).status, 403);
  // cap
  const n = t.db.get('SELECT count(*) n FROM formations WHERE program_id=1').n;
  await t.setSettings({ formation_limit: n });
  assert.equal((await head.get('/api/playbook/config')).body.formation_limit, n);
  const blocked = await head.post('/api/formations', { name: 'Over', side: 'offense', data: [] });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, new RegExp(`${n} saved formations`));
  assert.equal((await head.post(`/api/formations/${f}/duplicate`)).status, 400);
  await t.setSettings({ formation_limit: null });
  assert.equal((await head.post('/api/formations', { name: 'Now fine', side: 'defense', data: [] })).status, 200);
});

test('PS-1..PS-3: positions are validated, shared across the program and editable only with edit access', async () => {
  const list = (await head.get('/api/pb/positions')).body;
  assert.ok(list.length >= 20, 'default positions are created');
  const rb = list.find((p) => p.abbr === 'RB');
  const lt = list.find((p) => p.abbr === 'LT'); const rt = list.find((p) => p.abbr === 'RT');
  assert.equal(lt.mirror_id, rt.id, 'Smart Flip pairs');
  assert.ok(list.find((p) => p.abbr === 'C').is_center);
  assert.equal((await head.put(`/api/pb/positions/${rb.id}`, { letter: 'ABCD' })).status, 400);
  assert.equal((await head.put(`/api/pb/positions/${rb.id}`, { abbr: 'ABCDE' })).status, 400);
  assert.equal((await head.put(`/api/pb/positions/${rb.id}`, { color: 'pink' })).status, 400);
  assert.equal((await head.put(`/api/pb/positions/${rb.id}`, { name: 'Halfback', letter: 'HB', color: 'green', abbr: 'HB' })).status, 200);
  const after = (await player.get('/api/pb/positions')).body.find((p) => p.id === rb.id);
  assert.deepEqual([after.name, after.letter, after.color], ['Halfback', 'HB', 'green'], 'players see the same positions to draw shared plays');
  assert.equal((await parent.get('/api/pb/positions')).status, 403);
  const oh = await t.as(other.head);
  assert.equal((await oh.put(`/api/pb/positions/${rb.id}`, { name: 'Hacked' })).status, 404);
  assert.equal((await oh.put(`/api/pb/positions/${(await oh.get('/api/pb/positions')).body[0].id}`, { mirror_id: rb.id })).status, 400);
  await t.setSettings({ coach_playbook: 'view' });
  assert.equal((await dc.put(`/api/pb/positions/${rb.id}`, { name: 'Nope' })).status, 403);
  await t.setSettings({ coach_playbook: 'edit' });
  const add = await head.post('/api/pb/positions', { name: 'Wing', letter: 'W', side: 'O' });
  assert.equal(add.status, 200);
  assert.equal((await head.del(`/api/pb/positions/${add.body.id}`)).status, 200);
});

test('RT-1..RT-3: custom routes with Smart Distance on by default', async () => {
  assert.equal((await head.post('/api/pb/routes', { name: 'Empty' })).status, 400);
  assert.equal((await head.post('/api/pb/routes', { name: 'Bad', data: { points: [['a', 2]] } })).status, 400);
  const r = await head.post('/api/pb/routes', { name: 'Deep out', data: { points: [[0, -11], [-7, -11]] } });
  assert.equal(r.status, 200);
  let got = (await head.get(`/api/pb/routes/${r.body.id}`)).body;
  assert.equal(got.smart, true); assert.equal(got.grp, 'Custom');
  assert.equal((await head.put(`/api/pb/routes/${r.body.id}`, { name: 'Deep out (12)', smart: false, grp: 'Outs' })).status, 200);
  got = (await head.get(`/api/pb/routes/${r.body.id}`)).body;
  assert.deepEqual([got.name, got.smart, got.grp], ['Deep out (12)', false, 'Outs']);
  const d = await head.post(`/api/pb/routes/${r.body.id}/duplicate`);
  assert.equal((await head.get(`/api/pb/routes/${d.body.id}`)).body.name, 'Deep out (12) (Copy)');
  assert.ok((await head.get('/api/pb/routes')).body.length >= 2);
  assert.equal((await player.get('/api/pb/routes')).status, 403);
  const oh = await t.as(other.head);
  assert.equal((await oh.get(`/api/pb/routes/${r.body.id}`)).status, 404);
  assert.equal((await oh.del(`/api/pb/routes/${r.body.id}`)).status, 404);
  assert.equal((await head.del(`/api/pb/routes/${d.body.id}`)).status, 200);
});

test('PC-4: the play call log records calls for staff only', async () => {
  const zone = t.db.get(`SELECT id FROM plays WHERE name='Inside Zone Left'`).id;
  assert.equal((await head.post('/api/pb/calls', { play_id: zone, down: 5 })).status, 400);
  assert.equal((await head.post('/api/pb/calls', { play_id: other.play })).status, 404);
  const c = await dc.post('/api/pb/calls', { play_id: zone, down: 3, distance: 2, result: '+3, first down' });
  assert.equal(c.status, 200);
  const log = (await head.get(`/api/pb/calls?playbook_id=${off}`)).body;
  const row = log.find((x) => x.id === c.body.id);
  assert.equal(row.play_name, 'Inside Zone Left'); assert.equal(row.down, 3); assert.equal(row.by_name, dc.user.name);
  assert.equal((await player.get('/api/pb/calls')).status, 403);
  assert.equal((await player.post('/api/pb/calls', { play_id: zone })).status, 403);
  const oh = await t.as(other.head);
  assert.ok(!(await oh.get('/api/pb/calls')).body.some((x) => x.id === c.body.id));
  assert.equal((await oh.del(`/api/pb/calls/${c.body.id}`)).status, 404);
  assert.equal((await head.del(`/api/pb/calls/${c.body.id}`)).status, 200);
});

test('v2 play data (curved points, optional routes, zones, text) round-trips and flips server-side', async () => {
  const data = {
    players: [{ id: 'a', team: 'O', type: 'circle_letter', position_id: null, x: 20, y: 32, path: [[20, 20], [25, 15, 1]], opts: [{ id: 'o1', parent: 'primary', from: [20, 20], points: [[10, 16]] }] }],
    zones: [{ id: 'z', shape: 'oval', x: 40, y: 10, w: 10, h: 6 }], texts: [{ id: 't', x: 80, y: 50, text: 'Read' }], ball: { x: 50, y: 31 }, view: 'defense',
  };
  const id = (await head.post('/api/plays', { name: 'V2 data', playbook_id: off, data })).body.id;
  const back = (await head.get(`/api/plays/${id}`)).body.data;
  assert.deepEqual(back.players[0].path[1], [25, 15, 1]);
  assert.equal(back.view, 'defense');
  const f = (await head.post(`/api/plays/${id}/duplicate`, { flip: true })).body.id;
  const fl = (await head.get(`/api/plays/${f}`)).body.data;
  assert.deepEqual(fl.players[0].path[1], [75, 15, 1]);
  assert.deepEqual(fl.players[0].opts[0].points[0], [90, 16]);
  assert.equal(fl.zones[0].x, 50);
  assert.equal(fl.texts[0].x, 20);
});
