// v2 weight room: library, templates, group layers, dateless and game-week programs, training maxes, feed, wellness,
// station, TV, testing battery, norms, composites, leaderboards, reports, weekly email, body-weight privacy.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, today, addDays, addOtherProgram } from './helpers.js';
import { ensureLibrary, LIBRARY, POS_GROUPS } from '../server/strength-data.js';

let t; let head; let sc; let qbc; let trainer; let ad; let player; let parent; let other;
const ex = (name) => t.db.get('SELECT id FROM exercises WHERE program_id=1 AND lower(name)=lower(?) ORDER BY id LIMIT 1', name)?.id;
before(async () => {
  t = await start();
  head = await t.as('coach@ridgeview.example');
  sc = await t.as('Strength and conditioning');
  qbc = await t.as('QB coach');
  trainer = await t.as('Athletic trainer');
  ad = await t.as('Athletic director');
  player = await t.as('player@ridgeview.example');
  parent = await t.as('parent@ridgeview.example');
  other = addOtherProgram(t);
});
after(() => t.close());

test('C-9 exercise library: 500+ exercises with demo links, search, custom exercises, idempotent per program', async () => {
  assert.ok(LIBRARY.length >= 500);
  const all = await sc.get('/api/exercises');
  assert.equal(all.status, 200);
  assert.ok(all.body.length >= 500, `library has ${all.body.length}`);
  assert.ok(all.body.filter((e) => !e.custom).every((e) => /^https:\/\/www\.youtube\.com\/results\?search_query=/.test(e.video_url)));
  assert.equal(new Set(all.body.map((e) => e.category)).size >= 8, true);
  const before2 = t.db.get('SELECT count(*) n FROM exercises WHERE program_id=1').n;
  t.db.run('DELETE FROM wt_library_state WHERE program_id=1');
  assert.equal(ensureLibrary(t.db, 1), 0, 'reseeding adds nothing');
  assert.equal(t.db.get('SELECT count(*) n FROM exercises WHERE program_id=1').n, before2);
  const q = await sc.get('/api/exercises?q=split%20squat');
  assert.ok(q.body.length >= 5 && q.body.every((e) => e.name.toLowerCase().includes('split squat')));
  const kb = await sc.get('/api/exercises?equipment=Kettlebell');
  assert.ok(kb.body.length >= 20 && kb.body.every((e) => e.equipment === 'Kettlebell'));
  const c = await sc.post('/api/exercises', { name: 'Ridgeview sled ladder', category: 'Conditioning', equipment: 'Sled', video_url: 'https://example.com/v' });
  assert.equal(c.status, 200);
  const custom = await sc.get('/api/exercises?custom=1');
  assert.ok(custom.body.some((e) => e.id === c.body.id && e.custom === 1 && e.equipment === 'Sled'));
  assert.equal((await player.post('/api/exercises', { name: 'x' })).status, 403);
  // a new program gets its own library on first use, and never sees ours
  const oh = await t.as(other.head);
  const theirs = await oh.get('/api/exercises');
  assert.ok(theirs.body.length >= 500);
  assert.ok(!theirs.body.some((e) => e.name === 'Ridgeview sled ladder'));
});

test('C-10 template library: every phase, F-1 position-group starters, conditioning, game week', async () => {
  const r = await sc.get('/api/strength/templates');
  assert.equal(r.status, 200);
  const phases = new Set(r.body.filter((x) => x.kind === 'lift').map((x) => x.phase));
  for (const p of ['offseason', 'summer', 'preseason', 'in_season', 'playoffs']) assert.ok(phases.has(p), p);
  for (const g of Object.keys(POS_GROUPS)) assert.ok(r.body.some((x) => x.position_group === g && x.kind === 'lift'), `starter for ${g}`);
  assert.ok(r.body.filter((x) => x.kind === 'conditioning').length >= 3);
  assert.ok(r.body.some((x) => x.template_key === 'game-week' && x.mode === 'game_week'));
  const inSeason = r.body.find((x) => x.template_key === 'phase-in-season');
  assert.equal(inSeason.days_per_week, 2, 'in-season maintenance is 2 days a week');
  assert.equal((await player.get('/api/strength/templates')).status, 403);
  // use a template: a non-template copy with the same days and metadata
  const use = await sc.post(`/api/strength/templates/${inSeason.id}/use`, { name: 'My in-season' });
  assert.equal(use.status, 200);
  const p = await sc.get(`/api/wt-programs/${use.body.id}`);
  assert.equal(p.body.is_template, 0);
  assert.equal(p.body.meta.phase, 'in_season');
  assert.equal(p.body.days.length, (await sc.get(`/api/wt-programs/${inSeason.id}`)).body.days.length);
  assert.equal((await player.post(`/api/strength/templates/${inSeason.id}/use`, {})).status, 403);
});

test('F-1 assign a block or conditioning plan to a position group in one action', async () => {
  const tpls = (await sc.get('/api/strength/templates')).body;
  const ol = tpls.find((x) => x.template_key === 'pos-ol');
  const r = await sc.post('/api/strength/assign-group', { wt_program_id: ol.id, group: 'OL', start_date: today() });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.audience, ['pos:OL']);
  const olPlayer = t.varsity("p.positions LIKE '%\"OL\"%'")[0];
  const nonOl = t.varsity("p.positions NOT LIKE '%\"OL\"%'")[0];
  assert.ok(r.body.athletes >= 5);
  const asOl = await (await t.as(olPlayer.id)).get(`/api/workouts/player/${olPlayer.id}`);
  assert.ok(asOl.body.some((a) => a.id === r.body.assignment_id));
  assert.ok(!(await sc.get(`/api/workouts/player/${nonOl.id}`)).body.some((a) => a.id === r.body.assignment_id));
  // a conditioning plan for one team's DBs becomes a list of those athletes
  const cond = tpls.find((x) => x.kind === 'conditioning');
  const r2 = await sc.post('/api/strength/assign-group', { wt_program_id: cond.id, group: 'DB', team_id: t.teams.Varsity });
  assert.equal(r2.status, 200);
  assert.ok(r2.body.audience.every((a) => a.startsWith('player:')));
  assert.equal(r2.body.athletes, t.varsity("p.positions LIKE '%\"DB\"%'").length);
  assert.equal((await sc.post('/api/strength/assign-group', { wt_program_id: ol.id, group: 'XX' })).status, 400);
  assert.equal((await player.post('/api/strength/assign-group', { wt_program_id: ol.id, group: 'OL' })).status, 403);
});

let progId; let asnId;
test('C-6 block builder: weeks, days, sets, reps, % of max, RPE, notes; C-8 mode saved', async () => {
  const days = [
    { week: 1, day: 1, label: 'Lower', exercises: [{ exercise_id: ex('Back squat'), sets: 3, reps: '5', pct: 75, rpe: 7, note: 'Fast up' }, { exercise_id: ex('Romanian deadlift'), sets: 2, reps: '8', rpe: 8 }] },
    { week: 1, day: 2, label: 'Upper', exercises: [{ exercise_id: ex('Bench press'), sets: 3, reps: '5', pct: 75 }] },
  ];
  assert.equal((await sc.post('/api/wt-programs', { name: 'Bad', days: [{ week: 1, day: 1, exercises: [{ exercise_id: ex('Back squat'), sets: 3, rpe: 14 }] }] })).status, 400);
  const r = await sc.post('/api/wt-programs', { name: 'Layer test', weeks: 2, days, meta: { mode: 'dated', phase: 'in_season' } });
  assert.equal(r.status, 200);
  progId = r.body.id;
  // copy week 1 to week 2 the way the builder does (client-side), then save
  const w2 = days.map((d) => ({ ...d, week: 2, exercises: d.exercises.map((x) => ({ ...x, pct: x.pct ? x.pct + 5 : x.pct })) }));
  assert.equal((await sc.put(`/api/wt-programs/${progId}`, { days: [...days, ...w2], meta: { mode: 'dated', kind: 'lift', phase: 'in_season' } })).status, 200);
  const p = await sc.get(`/api/wt-programs/${progId}`);
  assert.equal(p.body.days.length, 4);
  assert.equal(p.body.days[0].exercises[0].rpe, 7);
  assert.equal(p.body.days[0].exercises[0].note, 'Fast up');
  assert.equal(p.body.meta.phase, 'in_season');
  assert.equal((await sc.put(`/api/wt-programs/${progId}`, { meta: { mode: 'sometimes' } })).status, 400);
  const a = await sc.post('/api/wt-assignments', { wt_program_id: progId, audience: [`team:${t.teams.Varsity}`], start_date: today() });
  asnId = a.body.id;
});

test('C-7 team, group and athlete layers resolve per athlete', async () => {
  const qb = player.id;
  const ol = t.varsity("p.positions LIKE '%\"OL\"%'")[0].id;
  assert.equal((await sc.post(`/api/strength/assignments/${asnId}/group-overrides`, { group_token: 'pos:ZZ' })).status, 400);
  assert.equal((await player.post(`/api/strength/assignments/${asnId}/group-overrides`, { group_token: 'pos:QB' })).status, 403);
  const g = await sc.post(`/api/strength/assignments/${asnId}/group-overrides`, { group_token: 'pos:QB', exercise_id: ex('Bench press'), alt_exercise_id: ex('Dumbbell bench press'), note: 'Shoulder care' });
  assert.equal(g.status, 200);
  const g2 = await sc.post(`/api/strength/assignments/${asnId}/group-overrides`, { group_token: 'pg:OL', exercise_id: ex('Back squat'), sets: 5, rpe: 6 });
  assert.equal(g2.status, 200);
  const day = async (pid, d) => (await sc.get(`/api/workouts/player/${pid}/${asnId}/1/${d}`)).body;
  const qbUpper = await day(qb, 2);
  assert.equal(qbUpper.exercises[0].name, 'Dumbbell bench press');
  assert.equal(qbUpper.exercises[0].layer, 'group');
  assert.match(qbUpper.exercises[0].layer_label, /QB/);
  const olLower = await day(ol, 1);
  assert.equal(olLower.exercises[0].sets, 5);
  assert.equal(olLower.exercises[0].rpe, 6);
  assert.equal(olLower.exercises[0].layer, 'group');
  assert.equal((await day(ol, 2)).exercises[0].name, 'Bench press', 'OL keeps the team bench');
  // the athlete layer wins over the group layer
  await sc.post(`/api/wt-assignments/${asnId}/overrides`, { player_id: qb, exercise_id: ex('Bench press'), alt_exercise_id: ex('Floor press'), note: 'Thumb' });
  const qbUpper2 = await day(qb, 2);
  assert.equal(qbUpper2.exercises[0].name, 'Floor press');
  assert.equal(qbUpper2.exercises[0].layer, 'athlete');
  const res = await sc.get(`/api/strength/assignments/${asnId}/resolved?player_id=${ol}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.days.length, 4);
  assert.ok(res.body.roster.length >= 40);
  assert.equal(res.body.days[0].exercises[0].layer, 'group');
  assert.equal((await player.get(`/api/strength/assignments/${asnId}/resolved`)).status, 403);
  const list = await sc.get(`/api/strength/assignments/${asnId}/group-overrides`);
  assert.equal(list.body.length, 2);
  // isolation
  const oh = await t.as(other.head);
  assert.equal((await oh.get(`/api/strength/assignments/${asnId}/group-overrides`)).status, 404);
  assert.equal((await oh.del(`/api/strength/group-overrides/${g.body.id}`)).status, 404);
});

test('C-8 dateless program: the next session is the first incomplete day', async () => {
  const days = [1, 2, 3].map((d) => ({ week: 1, day: d, label: `D${d}`, exercises: [{ exercise_id: ex('Goblet squat'), sets: 1, reps: '8' }] }));
  const p = await sc.post('/api/wt-programs', { name: 'In order', weeks: 1, days, meta: { mode: 'dateless' } });
  const a = await sc.post('/api/wt-assignments', { wt_program_id: p.body.id, audience: [`player:${player.id}`] });
  const list = async () => (await player.get(`/api/workouts/player/${player.id}`)).body.find((x) => x.id === a.body.id);
  let w = await list();
  assert.equal(w.mode, 'dateless');
  assert.ok(w.days.every((d) => d.due === null));
  assert.equal(w.days.find((d) => d.next).day, 1);
  await player.post('/api/wt-logs', { assignment_id: a.body.id, week: 1, day: 1, exercise_id: ex('Goblet squat'), set_no: 1, reps: 8, weight: 50 });
  w = await list();
  assert.equal(w.days.find((d) => d.next).day, 2);
  const one = await player.get(`/api/workouts/player/${player.id}/${a.body.id}/1/2`);
  assert.equal(one.body.due, null);
  // logging against another program's assignment is refused
  assert.equal((await player.post('/api/wt-logs', { assignment_id: 999999, week: 1, day: 1, exercise_id: ex('Goblet squat'), set_no: 1, reps: 1 })).status, 404);
});

test('C-15 training maxes update from logged sets, raise % loads and post PRs and clubs to the feed', async () => {
  const pid = player.id;
  const best = Math.max(t.db.get(`SELECT max(value) v FROM tests WHERE player_id=? AND test_key='squat'`, pid).v, t.db.get(`SELECT max(value) v FROM training_maxes WHERE player_id=? AND test_key='squat'`, pid).v || 0);
  const weight = Math.ceil((best + 20) / 1.1667 / 5) * 5; // 5 reps -> Epley
  const r = await player.post('/api/wt-logs', { assignment_id: asnId, week: 1, day: 1, exercise_id: ex('Back squat'), set_no: 1, reps: 5, weight, client_id: 'tm-1' });
  assert.equal(r.status, 200);
  const e1 = Math.round(weight * (1 + 5 / 30));
  assert.deepEqual(r.body.training_max, { test_key: 'squat', value: e1, previous: r.body.training_max.previous, pr: true });
  // a lighter set does not lower or add a training max
  const light = await player.post('/api/wt-logs', { assignment_id: asnId, week: 1, day: 1, exercise_id: ex('Back squat'), set_no: 2, reps: 5, weight: 95 });
  assert.equal(light.body.training_max, undefined);
  const w = await player.get(`/api/workouts/player/${pid}/${asnId}/1/1`);
  assert.equal(w.body.exercises[0].training_max, e1);
  assert.equal(w.body.exercises[0].load, Math.round((0.75 * e1) / 5) * 5);
  const feed = await player.get('/api/strength/feed?kind=pr');
  assert.ok(feed.body.posts.some((p) => p.player_id === pid && p.title.includes(`${e1} lb`)));
  const sum = await parent.get(`/api/strength/athlete/${pid}`);
  assert.equal(sum.status, 200);
  assert.equal(sum.body.maxes.find((m) => m.key === 'squat').max, e1);
  assert.equal(sum.body.wellness_today, undefined, 'parents do not get wellness answers');
  // F-19: a test result crossing a club threshold posts a milestone once
  const bench = t.db.get(`SELECT max(value) v FROM tests WHERE player_id=? AND test_key='bench'`, pid).v;
  const target = bench < 300 ? 300 : 350;
  await sc.post('/api/tests', { player_id: pid, test_key: 'bench', value: target + 5 });
  await sc.post('/api/tests', { player_id: pid, test_key: 'bench', value: target + 10 });
  assert.equal(t.db.all(`SELECT * FROM wt_feed WHERE ref=?`, `club:${pid}:bench:${target}`).length, 1);
  assert.equal((await sc.get(`/api/strength/athlete/${other.player}`)).status, 403);
});

test('F-6 testing battery: splits, agility, rep tests to estimated 1RM, height and weight as coach-only measurements', async () => {
  const meta = await sc.get('/api/weights/meta');
  for (const k of ['forty', 'ten_split', 'pro_agility', 'l_drill', 'vertical', 'broad', 'squat', 'bench', 'clean']) assert.ok(meta.body.tests[k], k);
  assert.ok(meta.body.measures.height && meta.body.measures.weight);
  const p2 = t.varsity('u.id!=?', player.id)[1].id;
  const r = await sc.post('/api/strength/testing-day', { date: today(), entries: [
    { player_id: p2, test_key: 'forty', value: 4.88 }, { player_id: p2, test_key: 'ten_split', value: 1.62 }, { player_id: p2, test_key: 'l_drill', value: 7.31 },
    { player_id: p2, test_key: 'bench', weight: 225, reps: 6 }, { player_id: p2, test_key: 'height', value: 72 }, { player_id: p2, test_key: 'weight', value: 210 },
    { player_id: p2, test_key: 'bench', weight: 225, reps: 15 }, { player_id: other.player, test_key: 'forty', value: 4.5 },
  ] });
  assert.equal(r.status, 200);
  assert.equal(r.body.saved, 6);
  const bench = r.body.results.find((x) => x.test_key === 'bench' && !x.error);
  assert.equal(bench.value, Math.round(225 * (1 + 6 / 30)));
  assert.equal(bench.estimated, true);
  assert.ok(t.db.get('SELECT 1 FROM test_details WHERE test_id=? AND weight=225 AND reps=6', bench.id));
  assert.ok(r.body.results.find((x) => x.reps === undefined && x.error && x.test_key === 'bench'), 'over 12 reps is refused');
  assert.ok(r.body.results.find((x) => x.player_id === other.player).error, 'other program athlete refused');
  assert.ok(t.db.get(`SELECT 1 FROM measurements WHERE player_id=? AND kind='height' AND value=72`, p2));
  assert.equal((await player.post('/api/strength/testing-day', { entries: [{ player_id: player.id, test_key: 'forty', value: 4 }] })).status, 403);
  assert.equal((await player.get('/api/leaderboard?test_key=height')).status, 400, 'height and weight are never ranked');
  const bat = await sc.get(`/api/strength/battery?team_id=${t.teams.Varsity}`);
  const row = bat.body.rows.find((x) => x.id === p2);
  assert.equal(row.results.l_drill.value, 7.31);
  assert.equal(row.results.weight.value, 210);
  const batQ = await ad.get('/api/strength/battery');
  assert.ok(!batQ.body.rows.some((x) => x.results.weight), 'staff without body or ratings access do not get weights');
});

test('F-9 norms by grade and position group with a reference table', async () => {
  const r = await sc.get('/api/strength/norms?test_key=forty');
  assert.equal(r.status, 200);
  assert.ok(r.body.program.n > 50);
  assert.ok(Object.keys(r.body.by_grade).length >= 2);
  assert.ok(r.body.by_group.OL && r.body.by_group.DB);
  assert.ok(r.body.by_group.OL.p50 > r.body.by_group.DB.p50, 'linemen are slower');
  assert.ok(r.body.reference.by_group.OL);
  const pl = r.body.players[player.id];
  assert.ok(pl.grade_pct >= 0 && pl.grade_pct <= 100 && pl.group === 'QB');
  assert.equal((await player.get('/api/strength/norms')).status, 403);
  assert.equal((await sc.get('/api/strength/norms?test_key=bodyweight')).status, 400);
});

test('F-7 composite score and before-and-after comparison by position group', async () => {
  assert.equal((await sc.post('/api/strength/composites', { name: 'Bad', tests: [{ key: 'height', weight: 10 }] })).status, 400);
  const c = await sc.post('/api/strength/composites', { name: 'Speed', tests: [{ key: 'forty', weight: 2 }, { key: 'vertical', weight: 1 }] });
  assert.equal(c.status, 200);
  const s = await sc.get(`/api/strength/composites/${c.body.id}/scores?team_id=${t.teams.Varsity}`);
  assert.equal(s.status, 200);
  assert.ok(s.body.rows.length > 20);
  assert.ok(s.body.rows[0].score >= s.body.rows[s.body.rows.length - 1].score);
  assert.ok(s.body.rows.every((r) => r.score >= 0 && r.score <= 100));
  // the fastest forty with a top vertical should outscore the slowest forty
  const fast = s.body.rows.slice().sort((a, b) => a.parts.forty.value - b.parts.forty.value)[0];
  const slow = s.body.rows.slice().sort((a, b) => b.parts.forty.value - a.parts.forty.value)[0];
  assert.ok(fast.parts.forty.pct > slow.parts.forty.pct);
  const year = today().slice(0, 4);
  const cmp = await sc.get(`/api/strength/compare?test_key=squat&date_a=${year}-06-05&date_b=${year}-10-07`);
  assert.equal(cmp.status, 200);
  const ol = cmp.body.rows.find((r) => r.group === 'OL');
  assert.ok(ol.n_both > 3 && ol.change >= 0 && ol.improved === true);
  const f = await sc.get(`/api/strength/compare?test_key=forty&date_a=${year}-06-05&date_b=${year}-10-07`);
  assert.ok(f.body.rows.every((r) => r.change == null || r.improved === (r.change < 0)), 'lower is better for timed tests');
  assert.equal((await sc.get('/api/strength/compare?test_key=squat')).status, 400);
  const oh = await t.as(other.head);
  assert.equal((await oh.get(`/api/strength/composites/${c.body.id}/scores`)).status, 404);
  assert.equal((await player.post('/api/strength/composites', { name: 'x', tests: [{ key: 'forty', weight: 1 }] })).status, 403);
});

test('C-16 leaderboards by team and position group; the coach can hide them; never body weight', async () => {
  await t.setSettings({ leaderboard: true, leaderboard_hidden: [] });
  const team = await player.get(`/api/leaderboard?test_key=squat&team_id=${t.teams.Varsity}`);
  assert.equal(team.status, 200);
  assert.ok(team.body.rows.every((r) => r.team_id === t.teams.Varsity));
  const grp = await player.get('/api/leaderboard?test_key=squat&group=OL');
  assert.ok(grp.body.rows.length && grp.body.rows.every((r) => r.group === 'OL'));
  assert.ok(grp.body.rows.every((r) => r.best != null && !('weight' in r)));
  // only the head coach can change visibility
  assert.equal((await sc.put('/api/strength/settings', { leaderboard_hidden: ['group:OL'] })).status, 403);
  assert.equal((await head.put('/api/strength/settings', { leaderboard_hidden: ['group:OL', `team:${t.teams.Freshman}`] })).status, 200);
  assert.equal((await player.get('/api/leaderboard?test_key=squat&group=OL')).status, 403);
  assert.equal((await player.get(`/api/leaderboard?test_key=squat&team_id=${t.teams.Freshman}`)).status, 403);
  const prog = await player.get('/api/leaderboard?test_key=squat&limit=100');
  assert.ok(!prog.body.rows.some((r) => r.group === 'OL' || r.team_id === t.teams.Freshman), 'hidden boards are left out of the program board');
  assert.equal((await sc.get('/api/leaderboard?test_key=squat&group=OL')).status, 200, 'coaches still see hidden boards');
  await head.put('/api/strength/settings', { leaderboard_hidden: [] });
  await t.setSettings({ leaderboard: false });
  assert.equal((await player.get('/api/leaderboard?test_key=squat&group=OL')).status, 403);
  await t.setSettings({ leaderboard: true });
});

test('C-17 team feed: players see their team and the program; coaches post and remove', async () => {
  const fr = t.players('p.team_id=?', t.teams.Freshman)[0];
  const frc = await t.as(fr.id);
  const v = await sc.post('/api/strength/feed', { title: 'Varsity only note', team_id: t.teams.Varsity });
  const all = await sc.post('/api/strength/feed', { title: 'Everyone note', body: 'Hydrate' });
  assert.equal(v.status, 200);
  assert.equal((await player.post('/api/strength/feed', { title: 'hi' })).status, 403);
  assert.equal((await sc.post('/api/strength/feed', { title: '' })).status, 400);
  const mine = await player.get('/api/strength/feed');
  assert.ok(mine.body.posts.some((p) => p.id === v.body.id) && mine.body.posts.some((p) => p.id === all.body.id));
  assert.equal(mine.body.can_post, false);
  const theirs = await frc.get('/api/strength/feed');
  assert.ok(!theirs.body.posts.some((p) => p.id === v.body.id) && theirs.body.posts.some((p) => p.id === all.body.id));
  assert.ok(theirs.body.posts.every((p) => p.team_id == null || p.team_id === t.teams.Freshman));
  assert.ok((await parent.get('/api/strength/feed')).body.posts.some((p) => p.id === v.body.id));
  assert.equal((await player.del(`/api/strength/feed/${v.body.id}`)).status, 403);
  assert.equal((await sc.del(`/api/strength/feed/${v.body.id}`)).status, 200);
  assert.ok(!(await player.get('/api/strength/feed')).body.posts.some((p) => p.id === v.body.id));
  assert.ok(t.db.get(`SELECT 1 FROM audit WHERE action='remove' AND entity='wt_feed' AND entity_id=?`, v.body.id));
  const oh = await t.as(other.head);
  assert.equal((await oh.del(`/api/strength/feed/${all.body.id}`)).status, 404);
  assert.ok(!(await oh.get('/api/strength/feed')).body.posts.some((p) => p.id === all.body.id));
  // F-19 weekly awards are idempotent per week
  const week = addDays(today(), -7);
  const a1 = await sc.post('/api/strength/awards', { week_start: week });
  const a2 = await sc.post('/api/strength/awards', { week_start: week });
  assert.equal(a1.status, 200);
  assert.equal(a2.body.posted, 0);
});

test('C-18 wellness questionnaire with coach flags and per-athlete trend', async () => {
  assert.equal((await player.post('/api/wellness', { sleep_hours: 9, sleep_quality: 6, soreness: 3, mood: 3, stress: 3 })).status, 400);
  assert.equal((await parent.post('/api/wellness', { sleep_hours: 8, sleep_quality: 3, soreness: 3, mood: 3, stress: 3 })).status, 403);
  assert.equal((await player.post('/api/wellness', { date: addDays(today(), -5), sleep_hours: 8, sleep_quality: 3, soreness: 3, mood: 3, stress: 3 })).status, 400);
  const r = await player.post('/api/wellness', { sleep_hours: 5, sleep_quality: 2, soreness: 4, mood: 4, stress: 1, note: 'Exams' });
  assert.equal(r.status, 200);
  assert.ok(r.body.flags.includes('Under 6 hours of sleep') && r.body.flags.includes('High stress'));
  const again = await player.post('/api/wellness', { sleep_hours: 7, sleep_quality: 4, soreness: 4, mood: 4, stress: 4 });
  assert.deepEqual(again.body.flags, [], 'one check-in per day, updated in place');
  await player.post('/api/wellness', { sleep_hours: 5, sleep_quality: 2, soreness: 4, mood: 4, stress: 1 });
  const d = await sc.get(`/api/wellness/dashboard?team_id=${t.teams.Varsity}`);
  assert.equal(d.status, 200);
  const me = d.body.rows.find((x) => x.id === player.id);
  assert.ok(me.checkin.flags.length >= 2);
  assert.ok(d.body.flagged >= 1 && d.body.responded <= d.body.total);
  assert.equal(d.body.rows[0].checkin?.flags.length > 0, true, 'flagged athletes first');
  assert.equal((await trainer.get('/api/wellness/dashboard')).status, 200);
  assert.equal((await ad.get('/api/wellness/dashboard')).status, 403);
  assert.equal((await player.get('/api/wellness/dashboard')).status, 403);
  const tr = await sc.get(`/api/wellness/player/${player.id}`);
  assert.ok(tr.body.rows.length >= 5 && tr.body.today.stress === 1);
  const other2 = t.varsity('u.id!=?', player.id)[0];
  assert.equal((await player.get(`/api/wellness/player/${other2.id}`)).status, 403);
  assert.equal((await parent.get(`/api/wellness/player/${player.id}`)).status, 403);
  const oh = await t.as(other.head);
  assert.equal((await oh.get(`/api/wellness/player/${player.id}`)).status, 403);
});

test('C-11 station mode: 4 to 8 athletes side by side, logged by the coach, availability flagged', async () => {
  const ro = await sc.get(`/api/strength/station/roster?assignment_id=${asnId}`);
  assert.equal(ro.status, 200);
  assert.ok(ro.body.players.length >= 40);
  const limited = ro.body.players.find((p) => p.availability === 'limited');
  assert.ok(limited, 'limited athletes are on the roster with their status');
  const ids = [player.id, limited.id, ...ro.body.players.filter((p) => p.id !== player.id && p.id !== limited.id).slice(0, 2).map((p) => p.id)];
  const s = await sc.get(`/api/strength/station?assignment_id=${asnId}&players=${ids.join(',')}&week=1&day=2`);
  assert.equal(s.status, 200);
  assert.equal(s.body.players.length, 4);
  assert.equal(s.body.players.find((p) => p.id === limited.id).availability, 'limited');
  assert.ok(s.body.players.every((p) => p.workout.week === 1 && p.workout.day === 2));
  const auto = await sc.get(`/api/strength/station?assignment_id=${asnId}&players=${ids.join(',')}`);
  assert.ok(auto.body.players.every((p) => p.workout.exercises.length));
  assert.equal((await sc.get(`/api/strength/station?assignment_id=${asnId}&players=${ro.body.players.slice(0, 9).map((p) => p.id).join(',')}`)).status, 400);
  assert.equal((await sc.get(`/api/strength/station?assignment_id=${asnId}&players=${other.player}`)).status, 404);
  assert.equal((await player.get(`/api/strength/station?assignment_id=${asnId}&players=${player.id}`)).status, 403);
  assert.equal((await ad.get('/api/strength/station/roster')).status, 403);
  // a tap logs a set for that athlete; replays of the same client id are ignored (offline queue)
  const target = s.body.players[2];
  const body = { player_id: target.id, assignment_id: asnId, week: 1, day: 2, exercise_id: target.workout.exercises[0].exercise_id, set_no: 1, reps: 5, weight: 185, client_id: 'station-1' };
  assert.equal((await sc.post('/api/wt-logs', body)).status, 200);
  assert.equal((await sc.post('/api/wt-logs/batch', { items: [body, { ...body, set_no: 2, client_id: 'station-2' }] })).body.results[0].duplicate, true);
  assert.equal(t.db.get('SELECT count(*) n FROM wt_logs WHERE player_id=? AND assignment_id=? AND week=1 AND day=2', target.id, asnId).n, 2);
  assert.equal((await sc.post('/api/wt-logs', { ...body, player_id: other.player, client_id: 'station-x' })).status, 403);
});

test('C-14 TV display: the day for a team or group, read-only for staff', async () => {
  const r = await qbc.get(`/api/strength/tv?assignment_id=${asnId}&week=1&day=2`);
  assert.equal(r.status, 200);
  assert.equal(r.body.day.label, 'Upper');
  assert.equal(r.body.exercises[0].name, 'Bench press');
  assert.ok(r.body.exercises[0].variants.some((v) => /QB/.test(v.group) && /Dumbbell bench press/.test(v.text)));
  const qbView = await qbc.get(`/api/strength/tv?assignment_id=${asnId}&week=1&day=2&group=pg:QB`);
  assert.equal(qbView.body.exercises[0].name, 'Dumbbell bench press');
  assert.ok(!JSON.stringify(r.body).includes('"load"'), 'no athlete loads on a shared screen');
  assert.equal((await player.get('/api/strength/tv')).status, 403);
});

test('F-5 game week: volume scales by days to the next game, activation lift the day before', async () => {
  const g = t.db.get(`SELECT * FROM events WHERE type='game' AND audience=? AND substr(start,1,10)>? ORDER BY start LIMIT 1`, JSON.stringify([`team:${t.teams.Varsity}`]), addDays(today(), 3));
  assert.ok(g, 'a future varsity game');
  const gd = g.start.slice(0, 10);
  const gw = t.app.ctx.strength.gameWeekFor;
  const prof = t.app.ctx.wt.profileOf(player.id);
  assert.equal(gw(prof, addDays(gd, -5), 1).factor, 1);
  assert.equal(gw(prof, addDays(gd, -3), 1).factor, 0.75);
  assert.equal(gw(prof, addDays(gd, -2), 1).factor, 0.5);
  assert.equal(gw(prof, addDays(gd, -1), 1).activation, true);
  assert.equal(gw(prof, gd, 1).activation, true);
  const days = [1, 2].map((d) => ({ week: 1, day: d, label: `Day ${d}`, exercises: [{ exercise_id: ex('Back squat'), sets: 4, reps: '5', pct: 75 }] }));
  const p = await sc.post('/api/wt-programs', { name: 'GW', weeks: 1, days, meta: { mode: 'game_week' } });
  const a = await sc.post('/api/wt-assignments', { wt_program_id: p.body.id, audience: [`player:${player.id}`], start_date: addDays(gd, -2) });
  const d1 = (await player.get(`/api/workouts/player/${player.id}/${a.body.id}/1/1`)).body;
  assert.equal(d1.exercises[0].sets, 2);
  assert.equal(d1.exercises[0].pct, 70);
  assert.equal(d1.game_week.days_out, 2);
  const d2 = (await player.get(`/api/workouts/player/${player.id}/${a.body.id}/1/2`)).body;
  assert.equal(d2.label, 'Game-day activation');
  assert.ok(d2.exercises.some((x) => x.name === 'Box jump'));
  const prev = await sc.get(`/api/strength/game-week?team_id=${t.teams.Varsity}`);
  assert.equal(prev.status, 200);
  assert.ok(prev.body.next_game && prev.body.days.length >= 1);
  const mk = await sc.post('/api/strength/game-week', { team_id: t.teams.Varsity });
  assert.equal(mk.status, 200);
  assert.equal((await sc.get(`/api/wt-programs/${mk.body.program_id}`)).body.meta.mode, 'game_week');
  assert.equal((await player.post('/api/strength/game-week', { team_id: t.teams.Varsity })).status, 403);
});

test('C-21 reports by athlete, group and team with CSV; C-20 streaks from lift attendance', async () => {
  const from = addDays(today(), -28);
  const r = await sc.get(`/api/strength/reports?from=${from}&to=${today()}&team_id=${t.teams.Varsity}`);
  assert.equal(r.status, 200);
  const me = r.body.rows.find((x) => x.id === player.id);
  assert.ok(me.sessions_due >= 1 && me.sets >= 1, JSON.stringify(me));
  assert.ok(me.lift_total >= 1 && me.attendance != null);
  assert.ok(Number.isInteger(me.streak));
  assert.ok(r.body.rows.some((x) => x.prs >= 1));
  const byG = await sc.get(`/api/strength/reports?from=${from}&to=${today()}&by=group`);
  assert.ok(byG.body.rows.some((x) => x.name === 'OL' && x.athletes > 3));
  const byT = await ad.get(`/api/strength/reports?from=${from}&to=${today()}&by=team`);
  assert.equal(byT.status, 200, 'the athletic director sees reports');
  assert.ok(byT.body.rows.some((x) => x.name === 'Varsity'));
  const csv = await sc.get(`/api/strength/reports/export.csv?from=${from}&to=${today()}&by=group`);
  assert.ok(csv.headers.get('content-type').startsWith('text/csv'));
  assert.ok(csv.body.startsWith('Position group,Athletes,Sessions due'));
  assert.equal((await player.get('/api/strength/reports')).status, 403);
  assert.equal((await sc.get(`/api/strength/reports?from=${today()}&to=${from}`)).status, 400);
  const seeded = (await sc.get('/api/wt-dashboard')).body.assignments.find((a) => a.program_name.startsWith('In-season'));
  const dash = await sc.get(`/api/wt-dashboard?assignment_id=${seeded.id}`);
  assert.ok(dash.body.rows.some((x) => x.streak > 0), 'streaks on the dashboard');
  assert.ok(dash.body.rows.some((x) => x.availability === 'limited' || x.availability === 'out'));
});

test('C-22 weekly email to athlete, parent and AD: scheduled, idempotent per week, with a preview', async () => {
  const pv = await sc.get(`/api/strength/weekly-report/preview?player_id=${player.id}`);
  assert.equal(pv.status, 200);
  assert.match(pv.body.athlete.body, /You logged/);
  assert.match(pv.body.parent.subject, /weight room week/);
  assert.ok(pv.body.ad.body.includes('Varsity'));
  assert.equal((await player.get('/api/strength/weekly-report/preview')).status, 403);
  const before2 = t.db.get('SELECT count(*) n FROM outbox').n;
  const run = t.app.ctx.strength.weeklyReport;
  // pick the configured weekday/hour for "now"
  await head.put('/api/strength/settings', { weekly_report_enabled: true, weekly_report_weekday: 3, weekly_report_hour: 7 });
  let wed = today(); while (new Date(`${wed}T12:00`).getDay() !== 3) wed = addDays(wed, 1);
  assert.equal(run(1, { now: `${wed}T06:30` }).skipped, 'not yet');
  t.db.run('DELETE FROM wt_report_log WHERE program_id=1');
  const sent = run(1, { now: `${wed}T07:05` });
  assert.ok(sent.athletes > 50 && sent.parents > 20 && sent.ad === 1);
  assert.equal(run(1, { now: `${wed}T08:00` }).skipped, 'already sent');
  assert.ok(t.db.get('SELECT count(*) n FROM outbox').n > before2);
  const adUser = t.db.get(`SELECT id FROM users WHERE staff_kind='athletic_director'`).id;
  assert.ok(t.notifications(adUser, 'Weekly weight room report').length >= 1);
  assert.ok(t.notifications(player.id, 'Your weight room week').length >= 1);
  assert.ok(t.notifications(t.parentsOf(player.id)[0], '%weight room week').length >= 1);
  await head.put('/api/strength/settings', { weekly_report_enabled: false });
  assert.equal(run(1, { now: `${addDays(wed, 7)}T07:05` }).skipped, 'disabled');
  assert.equal((await sc.post('/api/strength/weekly-report/send')).status, 403);
  assert.equal((await head.put('/api/strength/settings', { weekly_report_weekday: 9 })).status, 400);
});

test('F-8 body weight trend is coach-only by default and never on leaderboards', async () => {
  const s = await sc.get(`/api/bodyweight/${player.id}`);
  assert.equal(s.status, 200);
  assert.ok(s.body.some((m) => m.kind === 'weight'), 'coaches see testing-day and roster weights in the trend');
  assert.equal((await player.get(`/api/bodyweight/${player.id}`)).status, 403);
  assert.equal((await parent.get(`/api/bodyweight/${player.id}`)).status, 403);
  assert.equal((await qbc.get(`/api/bodyweight/${player.id}`)).status, 403);
  assert.equal((await parent.post('/api/bodyweight', { value: 200, player_id: player.id })).status, 403);
  const meta = await player.get('/api/strength/meta');
  assert.equal(meta.body.settings.family_sees_bodyweight, false);
  assert.equal(meta.body.can_edit, false);
});
