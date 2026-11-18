import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, addOtherProgram } from './helpers.js';

let t; let head; let player; let parent; let dc; let V; let smash; let cover4;
before(async () => {
  t = await start();
  head = await t.as('coach@ridgeview.example');
  player = await t.as('player@ridgeview.example');
  parent = await t.as('parent@ridgeview.example');
  dc = await t.as('Defensive coordinator');
  V = t.teams.Varsity;
  smash = t.db.get(`SELECT id FROM plays WHERE name LIKE '%Smash'`).id;
  cover4 = t.db.get(`SELECT id FROM plays WHERE name LIKE '%Cover 4'`).id;
});
after(() => t.close());

const players = [{ id: 'qb', label: 'QB', team: 'O', x: 50, y: 38, path: [[50, 42]] }, { id: 'x', label: 'X', team: 'O', x: 10, y: 32, path: [[10, 10]] }];

let playId;
test('plays CRUD with version history, stale-save 409 and restore', async () => {
  assert.equal((await head.post('/api/plays', { name: 'Bad', data: { nope: true } })).status, 400);
  const c = await head.post('/api/plays', { name: 'Test Slant', side: 'offense', formation: 'Gun 2x2', folder: 'Quick', tags: ['pass', ' 3rd down '], data: { players } });
  assert.equal(c.status, 200);
  playId = c.body.id;
  const g = await head.get(`/api/plays/${playId}`);
  assert.equal(g.body.version, 1);
  assert.deepEqual(g.body.tags, ['pass', '3rd down']);
  assert.equal(g.body.data.players.length, 2);
  assert.equal(g.body.can_edit, true);
  assert.match(g.body.watermark, /Dana Whitfield/);

  const u1 = await head.put(`/api/plays/${playId}`, { base_version: 1, coaching_points: 'Win inside', summary: 'Points' });
  assert.equal(u1.status, 200);
  assert.equal(u1.body.version, 2);
  // a second coach still editing version 1 is told to reload
  const stale = await dc.put(`/api/plays/${playId}`, { base_version: 1, name: 'Overwrite' });
  assert.equal(stale.status, 409);
  assert.match(stale.body.error, /version 2/);
  assert.equal(t.db.get('SELECT name FROM plays WHERE id=?', playId).name, 'Test Slant');
  const forced = await dc.put(`/api/plays/${playId}`, { base_version: 1, force: true, name: 'Test Slant v3' });
  assert.equal(forced.body.version, 3);

  const v = await head.get(`/api/plays/${playId}/versions`);
  assert.deepEqual(v.body.map((x) => x.version), [3, 2, 1]);
  assert.equal(v.body[1].summary, 'Points');
  const r = await head.post(`/api/plays/${playId}/restore`, { version: 1 });
  assert.equal(r.body.version, 4);
  const after = await head.get(`/api/plays/${playId}`);
  assert.equal(after.body.name, 'Test Slant');
  assert.equal(after.body.coaching_points, null);
  assert.equal((await head.post(`/api/plays/${playId}/restore`, { version: 99 })).status, 404);

  const dup = await head.post(`/api/plays/${playId}/duplicate`, { flip: true });
  const flipped = await head.get(`/api/plays/${dup.body.id}`);
  assert.equal(flipped.body.name, 'Test Slant (flipped)');
  assert.equal(flipped.body.data.players[1].x, 90);
  assert.deepEqual(flipped.body.data.players[1].path, [[90, 10]]);
  assert.equal((await head.del(`/api/plays/${dup.body.id}`)).status, 200);
  assert.equal((await head.get(`/api/plays/${dup.body.id}`)).status, 404);

  const list = await head.get('/api/plays?tag=pass&folder=Quick');
  assert.deepEqual(list.body.map((p) => p.id), [playId]);
  const q = await head.get('/api/plays?q=slant');
  assert.ok(q.body.some((p) => p.id === playId));
});

test('edit access follows the head coach settings; trainers have no playbook by default', async () => {
  const trainer = await t.as('Athletic trainer');
  assert.equal((await trainer.get('/api/plays')).status, 403);
  assert.equal((await player.post('/api/plays', { name: 'x' })).status, 403);
  await t.setSettings({ coach_playbook: 'view' });
  assert.equal((await dc.put(`/api/plays/${playId}`, { name: 'Nope' })).status, 403);
  assert.equal((await dc.get(`/api/plays/${playId}`)).status, 200);
  await t.setSettings({ coach_playbook: 'none' });
  assert.equal((await dc.get('/api/plays')).status, 403);
  await t.setSettings({ coach_playbook: 'edit', trainer_playbook: true });
  assert.equal((await trainer.get('/api/plays')).status, 200);
  assert.equal((await trainer.put(`/api/plays/${playId}`, { name: 'Nope' })).status, 403);
  await t.setSettings({ trainer_playbook: false });
});

test('players only see plays shared with them; quiz answers are hidden', async () => {
  const list = await player.get('/api/plays');
  assert.equal(list.status, 200);
  const ids = list.body.map((p) => p.id);
  assert.ok(ids.includes(smash));
  assert.ok(!ids.includes(cover4), 'defense playbook is shared with the defense only');
  assert.ok(!ids.includes(playId), 'unshared play is hidden');
  assert.equal((await player.get(`/api/plays/${playId}`)).status, 404);
  assert.equal((await player.get(`/api/plays/${cover4}`)).status, 404);
  const p = await player.get(`/api/plays/${smash}`);
  assert.equal(p.status, 200);
  assert.ok(p.body.data.quiz.length >= 1);
  assert.ok(p.body.data.quiz.every((q) => q.answer === undefined));
  assert.equal(p.body.can_edit, false);
  // a defender sees the defense playbook
  const lb = t.varsity(`p.units LIKE '%defense%'`)[0];
  const lbc = await t.as(lb.id);
  assert.equal((await lbc.get(`/api/plays/${cover4}`)).status, 200);
  const books = await player.get('/api/playbooks');
  assert.ok(books.body.every((b) => b.name !== 'Varsity defense'));

  // share the new play to this player only
  assert.equal((await head.post('/api/play-shares', { play_id: playId, audience: ['parents'] })).status, 400);
  assert.equal((await head.post('/api/play-shares', { play_id: playId })).status, 400);
  const s = await head.post('/api/play-shares', { play_id: playId, audience: [`player:${player.id}`] });
  assert.equal(s.status, 200);
  assert.equal((await player.get(`/api/plays/${playId}`)).status, 200);
  assert.equal(t.notifications(player.id, 'New in your playbook: Test Slant').length, 1);
  assert.equal((await lbc.get(`/api/plays/${playId}`)).status, 404);
  const shares = await head.get('/api/play-shares');
  assert.ok(shares.body.find((x) => x.id === s.body.id).audience_labels[0] === player.user.name);
  await head.del(`/api/play-shares/${s.body.id}`);
  assert.equal((await player.get(`/api/plays/${playId}`)).status, 404);
});

test('parents have no playbook access', async () => {
  assert.deepEqual((await parent.get('/api/plays')).body, []);
  assert.deepEqual((await parent.get('/api/installs')).body, []);
  assert.deepEqual((await parent.get('/api/playbooks')).body, []);
  assert.equal((await parent.get(`/api/plays/${smash}`)).status, 404);
  const inst = t.db.get('SELECT id FROM install_sheets LIMIT 1').id;
  assert.equal((await parent.get(`/api/installs/${inst}`)).status, 404);
  assert.equal((await head.post('/api/installs', { name: 'For parents', audience: ['parents'] })).status, 400);
});

test('export is blocked unless the head coach allows it; exports are logged', async () => {
  assert.equal((await dc.get(`/api/plays/${smash}/export`)).status, 403);
  assert.equal((await player.get(`/api/plays/${smash}/export`)).status, 403);
  const h = await head.get(`/api/plays/${smash}/export`);
  assert.equal(h.status, 200);
  assert.match(h.body.watermark, /^Exported by Dana Whitfield/);
  await t.setSettings({ coach_export_plays: true });
  assert.equal((await dc.get(`/api/plays/${smash}/export`)).status, 200);
  assert.equal((await player.get(`/api/plays/${smash}/export`)).status, 403);
  await t.setSettings({ coach_export_plays: false });
  assert.ok(t.db.get(`SELECT 1 FROM audit WHERE action='export' AND entity='play' AND entity_id=? AND user_id=?`, smash, dc.id));
  const cfg = await dc.get('/api/playbook/config');
  assert.equal(cfg.body.can_export, false);
  assert.equal(cfg.body.game_mode, 'booth_halftime');
});

test('every view is logged and visible to staff', async () => {
  await player.get(`/api/plays/${smash}?context=film`);
  const v = await head.get(`/api/plays/${smash}/views`);
  assert.equal(v.status, 200);
  assert.ok(v.body.some((x) => x.name === player.user.name && x.context === 'film'));
  assert.ok(v.body.some((x) => x.context === 'export'));
  assert.equal((await player.get(`/api/plays/${smash}/views`)).status, 403);
});

test('install sheets track who has viewed them', async () => {
  const qbs = t.players(`p.positions LIKE '%"QB"%'`);
  const i = await head.post('/api/installs', { name: 'QB install', play_ids: [smash, playId], notes: 'Learn it', audience: ['pos:QB'] });
  assert.equal(i.status, 200);
  assert.equal(t.notifications(player.id, 'Install sheet: QB install').length, 1);
  let s = await head.get(`/api/installs/${i.body.id}`);
  assert.equal(s.body.expected, qbs.length);
  assert.equal(s.body.viewed, 0);
  assert.equal(s.body.not_viewed.length, qbs.length);
  assert.ok(s.body.plays[0].data.quiz[0].answer !== undefined, 'staff see quiz answers');

  const pv = await player.get(`/api/installs/${i.body.id}`);
  assert.equal(pv.status, 200);
  assert.equal(pv.body.plays.length, 2);
  assert.ok(pv.body.plays[0].data.quiz.every((q) => q.answer === undefined));
  assert.equal(pv.body.expected, undefined);
  // install sheets make their plays visible to the audience
  assert.equal((await player.get(`/api/plays/${playId}`)).status, 200);

  s = await head.get(`/api/installs/${i.body.id}`);
  assert.equal(s.body.viewed, 1);
  assert.ok(!s.body.not_viewed.some((x) => x.id === player.id));
  const list = await head.get('/api/installs');
  assert.equal(list.body.find((x) => x.id === i.body.id).viewed, 1);
  // a non-QB does not see it
  const lb = await t.as(t.varsity(`p.positions LIKE '%"LB"%'`)[0].id);
  assert.equal((await lb.get(`/api/installs/${i.body.id}`)).status, 404);
  assert.ok(!(await lb.get('/api/installs')).body.some((x) => x.id === i.body.id));
});

test('knowledge checks: players are scored, staff review results', async () => {
  const r = await player.post(`/api/plays/${smash}/quiz`, { answers: [1, 0] });
  assert.equal(r.status, 200);
  assert.equal(r.body.score, 1);
  assert.equal(r.body.total, 2);
  const perfect = await player.post(`/api/plays/${smash}/quiz`, { answers: [1, 1] });
  assert.equal(perfect.body.score, 2);
  assert.equal((await head.post(`/api/plays/${smash}/quiz`, { answers: [1, 1] })).status, 400);
  assert.equal((await player.post(`/api/plays/${playId}/quiz`, { answers: [] })).status, 400, 'play without questions');
  const res = await head.get(`/api/plays/${smash}/quiz-results`);
  assert.equal(res.body.filter((x) => x.player_id === player.id).length, 2);
  assert.equal((await player.get(`/api/plays/${smash}/quiz-results`)).status, 403);
});

test('playbooks and formations', async () => {
  const b = await dc.post('/api/playbooks', { name: 'Red zone', side: 'offense' });
  assert.equal(b.status, 200);
  await head.put(`/api/plays/${playId}`, { playbook_id: b.body.id });
  const books = await head.get('/api/playbooks');
  assert.equal(books.body.find((x) => x.id === b.body.id).play_count, 1);
  const f = await head.post('/api/formations', { name: 'Empty', side: 'offense', data: players });
  assert.equal(f.status, 200);
  assert.ok((await head.get('/api/formations')).body.some((x) => x.name === 'Empty'));
  assert.equal((await player.get('/api/formations')).status, 403);
  // v2 (PB-6): deleting a playbook deletes the plays inside it (move playId out first; later tests use it)
  const home = t.db.get(`SELECT id FROM playbooks WHERE name='Varsity offense'`).id;
  await head.put(`/api/plays/${playId}`, { playbook_id: home });
  const doomed = (await head.post('/api/plays', { name: 'Doomed', playbook_id: b.body.id })).body.id;
  await head.del(`/api/playbooks/${b.body.id}`);
  assert.equal(t.db.get('SELECT 1 FROM plays WHERE id=?', doomed), undefined);
  assert.equal(t.db.get('SELECT playbook_id FROM plays WHERE id=?', playId).playbook_id, home);
  const facets = await head.get('/api/playbook/facets');
  assert.ok(facets.body.folders.includes('Quick'));
});

test('play list never carries quiz answers for players', async () => {
  const list = await player.get('/api/plays');
  const withQuiz = list.body.filter((p) => (p.data.quiz || []).length);
  assert.ok(withQuiz.length, 'some visible play has questions');
  assert.ok(withQuiz.every((p) => p.data.quiz.every((q) => q.answer === undefined)));
  const staff = await head.get('/api/plays');
  assert.ok(staff.body.some((p) => (p.data.quiz || []).some((q) => q.answer !== undefined)), 'staff still see answers');
});

test('facets: parents get nothing, players only see facets of their visible plays', async () => {
  await head.post('/api/plays', { name: 'Secret facet play', folder: 'Secret folder', tags: ['secret-tag'], formation: 'Secret formation' });
  const staff = await head.get('/api/playbook/facets');
  assert.ok(staff.body.folders.includes('Secret folder'));
  const pl = await player.get('/api/playbook/facets');
  assert.equal(pl.status, 200);
  assert.ok(!pl.body.folders.includes('Secret folder') && !pl.body.tags.includes('secret-tag') && !pl.body.formations.includes('Secret formation'));
  assert.deepEqual((await parent.get('/api/playbook/facets')).body, { folders: [], tags: [], formations: [] });
});

test('plays assigned as quiz/study (directly or via an install sheet) become visible to that player', async () => {
  const quiz = [{ q: 'Read?', options: ['a', 'b'], answer: 0 }];
  const qPlay = (await head.post('/api/plays', { name: 'Assigned quiz play', data: { players: [], quiz } })).body.id;
  const sPlay = (await head.post('/api/plays', { name: 'Assigned study play' })).body.id;
  const inst = (await head.post('/api/installs', { name: 'Unshared install', play_ids: [sPlay] })).body.id;
  assert.equal((await player.get(`/api/plays/${qPlay}`)).status, 404);
  const a1 = await head.post('/api/assignments', { type: 'quiz', title: 'Assigned quiz', audience: [`player:${player.id}`], play_ids: [qPlay] });
  const a2 = await head.post('/api/assignments', { type: 'study', title: 'Assigned study', audience: [`player:${player.id}`], install_id: inst });
  assert.equal(a1.status, 200); assert.equal(a2.status, 200);
  const got = await player.get(`/api/plays/${qPlay}`);
  assert.equal(got.status, 200);
  assert.ok(got.body.data.quiz.every((q) => q.answer === undefined));
  assert.equal((await player.get(`/api/plays/${sPlay}`)).status, 200);
  assert.ok((await player.get('/api/plays')).body.some((p) => p.id === qPlay));
  // other players and parents do not get them
  const other = await t.as(t.players('u.id!=?', player.id)[3].id);
  assert.equal((await other.get(`/api/plays/${qPlay}`)).status, 404);
  assert.equal((await parent.get(`/api/plays/${qPlay}`)).status, 404);
});

test('views, quiz results and installs are limited to this program\'s plays', async () => {
  const other = addOtherProgram(t);
  assert.deepEqual((await head.get(`/api/plays/${other.play}/views`)).status, 404);
  assert.deepEqual((await head.get(`/api/plays/${other.play}/quiz-results`)).status, 404);
  assert.equal((await head.post('/api/installs', { name: 'Leaky', play_ids: [other.play] })).status, 400);
  const inst = await head.post('/api/installs', { name: 'Fine', play_ids: [smash] });
  assert.equal((await head.put(`/api/installs/${inst.body.id}`, { play_ids: [smash, other.play] })).status, 400);
  // quiz results need playbook access, not just a staff role
  const vol = await t.as('Team manager (volunteer)');
  assert.equal((await vol.get(`/api/plays/${smash}/quiz-results`)).status, 403);
});
