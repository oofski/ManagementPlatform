import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, today, addOtherProgram } from './helpers.js';

let t; let head; let player; let parent; let qbc; let trainer; let ad; let vol; let season; let year;
before(async () => {
  t = await start();
  head = await t.as('coach@ridgeview.example');
  player = await t.as('player@ridgeview.example');
  parent = await t.as('parent@ridgeview.example');
  qbc = await t.as('QB coach');
  trainer = await t.as('Athletic trainer');
  ad = await t.as('Athletic director');
  vol = await t.as('Team manager (volunteer)');
  year = Number(today().slice(0, 4));
  season = t.db.get('SELECT * FROM seasons WHERE active=1');
});
after(() => t.close());

test('seasons: list, create, edit phases, activate (head coach only)', async () => {
  const list = await player.get('/api/seasons');
  assert.equal(list.body.length, 2);
  assert.equal(list.body[0].phases.length, 4);
  assert.equal((await qbc.post('/api/seasons', { name: 'Spring', start_date: `${year + 1}-03-01`, end_date: `${year + 1}-05-01` })).status, 403);
  assert.equal((await head.post('/api/seasons', { name: 'Spring', start_date: `${year + 1}-05-01`, end_date: `${year + 1}-03-01` })).status, 400);
  const c = await head.post('/api/seasons', { name: 'Spring', start_date: `${year + 1}-03-01`, end_date: `${year + 1}-05-01` });
  assert.equal(c.status, 200);
  assert.equal((await head.put(`/api/seasons/${c.body.id}`, { phases: [{ name: 'Spring ball', start: `${year + 1}-04-01` }] })).status, 400);
  assert.equal((await head.put(`/api/seasons/${c.body.id}`, { phases: [{ name: 'Spring ball', start: `${year + 1}-04-01`, end: `${year + 1}-04-30`, goals: 'Install' }] })).status, 200);
  assert.equal((await head.post(`/api/seasons/${c.body.id}/activate`)).status, 200);
  assert.equal((await head.get('/api/me')).body.season.id, c.body.id);
  await head.post(`/api/seasons/${season.id}/activate`);
  assert.equal((await head.get('/api/me')).body.season.id, season.id);
});

test('season plan: week-by-week with phases, games and week goals', async () => {
  assert.equal((await player.get(`/api/seasons/${season.id}/plan`)).status, 403);
  const p = await head.get(`/api/seasons/${season.id}/plan`);
  assert.equal(p.status, 200);
  const days = (new Date(season.end_date) - new Date(season.start_date)) / 864e5;
  assert.ok(Math.abs(p.body.weeks.length - Math.ceil(days / 7)) <= 1);
  assert.equal(p.body.weeks[0].from <= season.start_date, true);
  assert.ok(p.body.weeks.some((w) => w.phase === 'Summer' && w.phase_goals));
  const withGames = p.body.weeks.filter((w) => w.games.length);
  assert.ok(withGames.length >= 6);
  assert.ok(withGames.every((w) => w.games.every((g) => g.start >= w.from && g.start.slice(0, 10) <= w.to)));
  assert.ok(p.body.weeks.some((w) => w.key_dates.some((k) => k.type === 'assignment')));
  const wk = p.body.weeks[3];
  assert.equal((await qbc.put(`/api/seasons/${season.id}/week-goal`, { week_from: wk.from, goal: 'Finish the install' })).status, 200);
  assert.equal((await trainer.put(`/api/seasons/${season.id}/week-goal`, { week_from: wk.from, goal: 'x' })).status, 403);
  const p2 = await head.get(`/api/seasons/${season.id}/plan`);
  assert.equal(p2.body.weeks[3].week_goal, 'Finish the install');
});

test('development timeline: coaches see everything; players see their own without ratings', async () => {
  // add a rating and a depth move so the timeline has them
  const plan = t.db.get('SELECT pp.id FROM practice_plans pp JOIN events e ON e.id=pp.event_id WHERE e.start<? ORDER BY e.start DESC LIMIT 1', today()).id;
  const period = t.db.get(`SELECT id FROM periods WHERE plan_id=? AND positions LIKE '%"QB"%' LIMIT 1`, plan).id;
  await qbc.post('/api/ratings', { period_id: period, player_id: player.id, value: 5 });
  const chart = t.db.get(`SELECT * FROM depth_charts WHERE unit='offense' ORDER BY id DESC LIMIT 1`);
  const slots = JSON.parse(chart.slots);
  slots.QB = [...slots.QB.filter((x) => x !== player.id)];
  slots.QB.splice(1, 0, player.id);
  await head.put(`/api/depth/${chart.id}`, { slots });

  const d = await head.get(`/api/development/${player.id}`);
  assert.equal(d.status, 200);
  const kinds = new Set(d.body.timeline.map((x) => x.kind));
  for (const k of ['rating', 'test', 'assignment', 'depth']) assert.ok(kinds.has(k), `timeline has ${k}`);
  assert.ok(d.body.timeline.every((x, i, a) => i === 0 || (a[i - 1].date || '') >= (x.date || '')), 'newest first');
  assert.ok(d.body.trends.group_label === 'QB group');
  assert.ok(d.body.trends.ratings.length >= 1);
  assert.ok(Object.keys(d.body.trends.tests).includes('squat'));
  assert.equal(typeof d.body.attendance_rate, 'number');
  assert.ok(Array.isArray(d.body.evaluations));

  const own = await player.get(`/api/development/${player.id}`);
  assert.equal(own.status, 200);
  assert.ok(!own.body.timeline.some((x) => x.kind === 'rating' || x.kind === 'note' || x.kind === 'depth'));
  assert.equal(own.body.trends, undefined, 'trends hidden unless the program shares them');
  assert.equal(own.body.evaluations, undefined);
  assert.equal((await parent.get(`/api/development/${player.id}`)).status, 200);
  const other = t.varsity('u.id!=?', player.id)[0];
  assert.equal((await player.get(`/api/development/${other.id}`)).status, 403);
  assert.equal((await vol.get(`/api/development/${player.id}`)).status, 403);

  await t.setSettings({ players_see_ratings: true, players_see_trends: true });
  const shared = await player.get(`/api/development/${player.id}`);
  assert.ok(shared.body.timeline.some((x) => x.kind === 'rating'));
  assert.ok(!shared.body.timeline.some((x) => x.kind === 'note'), 'coach notes stay private');
  assert.ok(shared.body.trends.ratings.length >= 1);
  assert.deepEqual(shared.body.trends.group_ratings, [], 'no group comparisons for players');
  assert.deepEqual(shared.body.trends.group_tests, {});
  await t.setSettings({ players_see_ratings: false, players_see_trends: false });
});

test('position group view', async () => {
  const g = await qbc.get('/api/development-group?position=QB');
  assert.equal(g.status, 200);
  assert.ok(g.body.length >= 2 && g.body.every((p) => p.positions.includes('QB')));
  const me = g.body.find((p) => p.id === player.id);
  assert.equal(typeof me.rating_avg, 'number');
  assert.equal(typeof me.squat, 'number');
  const team = await head.get(`/api/development-group?team_id=${t.teams.Varsity}&unit=defense`);
  assert.ok(team.body.every((p) => p.team_id === t.teams.Varsity && p.units.includes('defense')));
  assert.equal((await player.get('/api/development-group')).status, 403);
  assert.equal((await vol.get('/api/development-group')).status, 403);
  const tr = await trainer.get('/api/development-group?position=QB');
  assert.equal(tr.body[0].rating_avg, null, 'trainers do not see ratings by default');
});

test('goals: test goals track progress from testing results', async () => {
  assert.equal((await player.post('/api/goals', { player_id: player.id, title: 'x' })).status, 403);
  assert.equal((await head.post('/api/goals', { player_id: player.id, title: 'Squat', kind: 'test', test_key: 'squat' })).status, 400);
  assert.equal((await head.post('/api/goals', { player_id: player.id, title: 'Squat', kind: 'test', test_key: 'curl', target: 1 })).status, 400);
  const g = await head.post('/api/goals', { player_id: player.id, title: 'Squat 340', kind: 'test', test_key: 'squat', baseline: 300, target: 340 });
  assert.equal(g.status, 200);
  assert.equal(t.notifications(player.id, 'New goal: Squat 340').length, 1);
  const sc = await t.as('Strength and conditioning');
  await sc.post('/api/tests', { player_id: player.id, test_key: 'squat', value: 320, date: `${year}-12-30` });
  let goal = (await player.get('/api/goals')).body.find((x) => x.id === g.body.id);
  assert.equal(goal.current, 320);
  assert.equal(goal.pct, 50);
  assert.equal(goal.achieved, false);
  assert.equal(goal.unit, 'lb');
  await sc.post('/api/tests', { player_id: player.id, test_key: 'squat', value: 345, date: `${year}-12-31` });
  goal = (await player.get('/api/goals')).body.find((x) => x.id === g.body.id);
  assert.equal(goal.pct, 100);
  assert.equal(goal.achieved, true);

  // lower-is-better test goal
  const f = await trainer.post('/api/goals', { player_id: player.id, title: 'Faster 40', kind: 'test', test_key: 'forty', baseline: 5.0, target: 4.8 });
  await sc.post('/api/tests', { player_id: player.id, test_key: 'forty', value: 4.9, date: `${year}-12-31` });
  const fg = (await head.get(`/api/goals?player_id=${player.id}`)).body.find((x) => x.id === f.body.id);
  assert.equal(fg.pct, 50);
  assert.equal(fg.achieved, false);

  // skill goals use manual progress
  const s = await qbc.post('/api/goals', { player_id: player.id, title: 'Footwork', kind: 'skill' });
  await qbc.put(`/api/goals/${s.body.id}`, { progress: 150 });
  assert.equal((await player.get('/api/goals')).body.find((x) => x.id === s.body.id).pct, 100);
  assert.equal((await qbc.put(`/api/goals/${s.body.id}`, { status: 'won' })).status, 400);
  await qbc.put(`/api/goals/${s.body.id}`, { status: 'achieved' });
  assert.equal((await player.get('/api/goals')).body.find((x) => x.id === s.body.id).achieved, true);
  const other = t.varsity('u.id!=?', player.id)[0];
  assert.equal((await player.get(`/api/goals?player_id=${other.id}`)).status, 403);
  assert.ok((await head.get('/api/goals')).body.length > 20);
  assert.equal((await parent.get('/api/goals')).status, 403);
  assert.ok((await parent.get(`/api/goals?player_id=${player.id}`)).body.length >= 3);
});

test('evaluations: one per evaluator per point, scores 1-5, coaches only', async () => {
  assert.equal((await trainer.post('/api/evaluations', { player_id: player.id, point: 'end', scores: { Effort: 4 } })).status, 403);
  assert.equal((await head.post('/api/evaluations', { player_id: player.id, point: 'week3', scores: {} })).status, 400);
  assert.equal((await head.post('/api/evaluations', { player_id: player.id, point: 'end', scores: { Effort: 7 } })).status, 400);
  assert.equal((await head.post('/api/evaluations', { player_id: 999999, point: 'end' })).status, 404);
  const a = await qbc.post('/api/evaluations', { player_id: player.id, point: 'end', position: 'QB', scores: { Technique: 3, Effort: 5 }, notes: 'Strong finish' });
  assert.equal(a.status, 200);
  await qbc.post('/api/evaluations', { player_id: player.id, point: 'end', position: 'QB', scores: { Technique: 4, Effort: 5 } });
  const mine = t.db.all(`SELECT * FROM evaluations WHERE player_id=? AND point='end' AND by_user=?`, player.id, qbc.id);
  assert.equal(mine.length, 1);
  assert.equal(JSON.parse(mine[0].scores).Technique, 4);
  await head.post('/api/evaluations', { player_id: player.id, point: 'end', scores: { Technique: 2 } });
  const list = await head.get('/api/evaluations?point=end');
  assert.equal(list.body.filter((e) => e.player_id === player.id).length, 2);
  assert.ok(list.body.every((e) => e.point === 'end'));
  assert.equal((await player.get('/api/evaluations')).status, 403);
  const meta = await player.get('/api/evaluations/meta');
  assert.ok(meta.body.criteria.offense.includes('Football IQ'));
});

test('end-of-season reports for a player and the team', async () => {
  const r = await head.get(`/api/season-report/player/${player.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.player.id, player.id);
  assert.ok(r.body.tests.squat.best >= r.body.tests.squat.first);
  assert.ok(r.body.evaluations.some((e) => e.point === 'end'));
  assert.ok(r.body.goals.some((g) => g.title === 'Squat 340'));
  assert.ok(r.body.ratings.n >= 1);
  assert.equal((await ad.get(`/api/season-report/player/${player.id}`)).status, 200);
  assert.equal((await player.get(`/api/season-report/player/${player.id}`)).status, 403);
  assert.equal((await parent.get(`/api/season-report/player/${player.id}`)).status, 403);
  const team = await ad.get('/api/season-report/team');
  assert.equal(team.status, 200);
  assert.ok(team.body.games.length >= 6);
  assert.ok(team.body.roster > 90);
  assert.ok(team.body.practices > 10);
  assert.equal(typeof team.body.attendance_rate, 'number');
  assert.equal((await vol.get('/api/season-report/team')).status, 403);
});

test('home screens for staff, players and parents', async () => {
  const s = await head.get('/api/home');
  assert.equal(s.status, 200);
  assert.equal(s.body.role, 'staff');
  assert.ok(Array.isArray(s.body.today) && Array.isArray(s.body.week));
  assert.ok(s.body.availability.available > 50);
  assert.equal(typeof s.body.deadlines.equipment_outstanding, 'number');
  assert.ok(s.body.deadlines.helmets_due >= 1);
  assert.ok(s.body.open_reports >= 1, 'seeded auto-flag is open');
  assert.ok(s.body.availability_changes.length >= 1);
  const dc = await t.as('Defensive coordinator');
  assert.equal((await dc.get('/api/home')).body.open_reports, 0, 'moderation counts are for admins');

  const p = await player.get('/api/home');
  assert.equal(p.body.role, 'player');
  assert.equal(p.body.players.length, 1);
  assert.equal(p.body.players[0].id, player.id);
  assert.ok(p.body.players[0].goals.some((g) => g.kind === 'test'));
  assert.equal(p.body.players[0].recent_rating, undefined, 'ratings hidden from players by default');
  assert.equal(typeof p.body.players[0].forms_pending, 'number');
  assert.ok(p.body.events.every((e) => e.title !== 'Staff meeting: game plan'));

  const pa = await parent.get('/api/home');
  assert.equal(pa.body.role, 'parent');
  assert.deepEqual(pa.body.players.map((x) => x.id), [player.id]);
  assert.equal(pa.body.players[0].forms_pending, 0);
});

test('ratings and evaluations need ratings access (trainer, AD) unless granted', async () => {
  assert.equal((await trainer.get('/api/evaluations')).status, 403);
  assert.equal((await head.get('/api/evaluations')).status, 200);
  const tr = await trainer.get(`/api/development/${player.id}`);
  assert.equal(tr.status, 200);
  assert.equal(tr.body.evaluations, undefined);
  assert.ok((await qbc.get(`/api/development/${player.id}`)).body.evaluations.length >= 1, 'coaches still see them');
  const rep = await ad.get(`/api/season-report/player/${player.id}`);
  assert.equal(rep.status, 200);
  assert.deepEqual(rep.body.evaluations, []);
  assert.equal(rep.body.ratings.avg, null);
  assert.equal((await ad.get('/api/season-report/team')).body.ratings.avg, null);
  assert.ok((await head.get(`/api/season-report/player/${player.id}`)).body.evaluations.length >= 1);
  // granting the trainer ratings access opens them up
  await t.setSettings({ trainer_ratings: true });
  assert.equal((await trainer.get('/api/evaluations')).status, 200);
  assert.ok((await trainer.get(`/api/development/${player.id}`)).body.evaluations.length >= 1);
  await t.setSettings({ trainer_ratings: false });
});

test('goals for another program\'s player are not readable', async () => {
  const other = addOtherProgram(t);
  assert.equal((await head.get(`/api/goals?player_id=${other.player}`)).status, 403);
  assert.equal((await trainer.get(`/api/goals?player_id=${other.player}`)).status, 403);
  assert.equal((await head.get(`/api/goals?player_id=${player.id}`)).status, 200);
});
