import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, today, addDays, addOtherProgram } from './helpers.js';

let t; let head; let player; let parent; let sc; let trainer; let ex;
before(async () => {
  t = await start();
  head = await t.as('coach@ridgeview.example');
  player = await t.as('player@ridgeview.example');
  parent = await t.as('parent@ridgeview.example');
  sc = await t.as('Strength and conditioning');
  trainer = await t.as('Athletic trainer');
  ex = Object.fromEntries(t.db.all('SELECT id, name FROM exercises').map((e) => [e.name, e.id]));
});
after(() => t.close());

const round5 = (x) => Math.round(x / 5) * 5;
let progId; let asnId;

test('exercise library and multi-week programs', async () => {
  assert.equal((await player.post('/api/exercises', { name: 'Curl' })).status, 403);
  assert.equal((await sc.post('/api/exercises', { name: 'Curl', test_key: 'curl' })).status, 400);
  assert.equal((await sc.post('/api/exercises', { name: 'Front squat', category: 'Lower', test_key: 'squat' })).status, 200);
  const days = [
    { week: 1, day: 1, label: 'Lower', exercises: [{ exercise_id: ex['Back squat'], sets: 2, reps: '5', pct: 80 }, { exercise_id: ex['Romanian deadlift'], sets: 2, reps: '8' }] },
    { week: 1, day: 2, label: 'Upper', exercises: [{ exercise_id: ex['Bench press'], sets: 3, reps: '5', pct: 75 }] },
  ];
  assert.equal((await sc.post('/api/wt-programs', { name: 'Bad', days: [{ week: 1, exercises: [] }] })).status, 400);
  assert.equal((await sc.post('/api/wt-programs', { name: 'Bad', days: [{ week: 1, day: 1, exercises: [{ exercise_id: 1, sets: 0 }] }] })).status, 400);
  assert.equal((await player.post('/api/wt-programs', { name: 'x', days })).status, 403);
  const r = await sc.post('/api/wt-programs', { name: 'Test block', weeks: 1, days });
  assert.equal(r.status, 200);
  progId = r.body.id;
  const copy = await trainer.post('/api/wt-programs', { name: 'Copy', copy_from: progId, is_template: true });
  assert.equal((await sc.get(`/api/wt-programs/${copy.body.id}`)).body.days.length, 2);
  assert.equal((await player.get('/api/wt-programs')).status, 403);
});

test('assign to an audience creates calendar lift events', async () => {
  const monday = (() => { let d = addDays(today(), 7); while (new Date(d + 'T12:00').getDay() !== 1) d = addDays(d, 1); return d; })();
  assert.equal((await sc.post('/api/wt-assignments', { wt_program_id: progId, audience: [] })).status, 400);
  const r = await sc.post('/api/wt-assignments', { wt_program_id: progId, audience: [`player:${player.id}`], start_date: monday, schedule: { weekdays: [1, 4], time: '06:30', minutes: 45 } });
  assert.equal(r.status, 200);
  asnId = r.body.id;
  assert.equal(r.body.events, 2);
  const evs = t.db.all(`SELECT * FROM events WHERE type='lift' AND json_extract(details,'$.wt_assignment_id')=? ORDER BY start`, asnId);
  assert.deepEqual(evs.map((e) => e.start), [`${monday}T06:30`, `${addDays(monday, 3)}T06:30`]);
  assert.equal(evs[0].end, `${monday}T07:15`);
  assert.deepEqual(JSON.parse(evs[0].audience), [`player:${player.id}`]);
  assert.equal(t.notifications(player.id, 'New lifting program: Test block').length, 1);
  // the player sees the lift on their calendar
  const cal = await player.get(`/api/events?from=${monday}&to=${addDays(monday, 6)}&type=lift`);
  assert.ok(cal.body.some((e) => e.id === evs[0].id));
});

test('loads are computed from % of the latest tested max', async () => {
  const squatMax = t.db.get(`SELECT max(value) v FROM tests WHERE player_id=? AND test_key='squat' AND date=(SELECT max(date) FROM tests WHERE player_id=? AND test_key='squat')`, player.id, player.id).v;
  const w = await player.get(`/api/workouts/player/${player.id}/${asnId}/1/1`);
  assert.equal(w.status, 200);
  const sq = w.body.exercises.find((x) => x.original_exercise_id === ex['Back squat']);
  assert.equal(sq.tested_max, squatMax);
  assert.equal(sq.load, round5(0.8 * squatMax));
  const rdl = w.body.exercises.find((x) => x.original_exercise_id === ex['Romanian deadlift']);
  assert.equal(rdl.load, null, 'no % means no computed load');
  assert.equal(w.body.prescribed_sets, 4);
  const all = await player.get(`/api/workouts/player/${player.id}`);
  assert.ok(all.body.some((a) => a.id === asnId && a.days.length === 2));
  const other = t.varsity('u.id!=?', player.id)[0];
  assert.equal((await player.get(`/api/workouts/player/${other.id}`)).status, 403);
  assert.equal((await parent.get(`/api/workouts/player/${player.id}`)).status, 200);
  assert.equal((await player.get(`/api/workouts/player/${player.id}/${asnId}/9/9`)).status, 404);
});

test('individual overrides swap exercises and change prescription', async () => {
  assert.equal((await player.post(`/api/wt-assignments/${asnId}/overrides`, { player_id: player.id, exercise_id: ex['Back squat'], alt_exercise_id: ex['Goblet squat'] })).status, 403);
  const o = await sc.post(`/api/wt-assignments/${asnId}/overrides`, { player_id: player.id, exercise_id: ex['Back squat'], alt_exercise_id: ex['Goblet squat'], sets: 3, reps: '10', note: 'Back tightness' });
  assert.equal(o.status, 200);
  const w = await player.get(`/api/workouts/player/${player.id}/${asnId}/1/1`);
  const sq = w.body.exercises.find((x) => x.original_exercise_id === ex['Back squat']);
  assert.equal(sq.exercise_id, ex['Goblet squat']);
  assert.equal(sq.name, 'Goblet squat');
  assert.equal(sq.sets, 3);
  assert.equal(sq.reps, '10');
  assert.equal(sq.overridden, true);
  assert.equal(sq.note, 'Back tightness');
  // re-posting the same override replaces it
  await sc.post(`/api/wt-assignments/${asnId}/overrides`, { player_id: player.id, exercise_id: ex['Back squat'], alt_exercise_id: ex['Goblet squat'], sets: 2 });
  const list = await sc.get(`/api/wt-assignments/${asnId}/overrides`);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].alt_name, 'Goblet squat');
});

test('logging is idempotent by client id and updates an existing set', async () => {
  const base = { assignment_id: asnId, week: 1, day: 1, exercise_id: ex['Goblet squat'], set_no: 1, reps: 10, weight: 60 };
  const a = await player.post('/api/wt-logs', { ...base, client_id: 'log-1' });
  assert.equal(a.status, 200);
  const dup = await player.post('/api/wt-logs', { ...base, weight: 999, client_id: 'log-1' });
  assert.deepEqual(dup.body, { id: a.body.id, duplicate: true });
  const upd = await player.post('/api/wt-logs', { ...base, weight: 65, client_id: 'log-2' });
  assert.deepEqual(upd.body, { id: a.body.id, updated: true });
  assert.equal(t.db.get('SELECT weight FROM wt_logs WHERE id=?', a.body.id).weight, 65);
  assert.equal((await player.post('/api/wt-logs', { ...base, set_no: 0 })).status, 400);
  const other = t.varsity('u.id!=?', player.id)[0];
  assert.equal((await player.post('/api/wt-logs', { ...base, player_id: other.id })).status, 403);
  // finish the day via batch (offline replay)
  const b = await player.post('/api/wt-logs/batch', { items: [
    { ...base, set_no: 2, client_id: 'log-3' },
    { ...base, exercise_id: ex['Romanian deadlift'], set_no: 1, reps: 8, weight: 135, client_id: 'log-4' },
    { ...base, exercise_id: ex['Romanian deadlift'], set_no: 2, reps: 8, weight: 135, client_id: 'log-5' },
    { exercise_id: null },
  ] });
  assert.equal(b.body.results.filter((x) => x.id).length, 3);
  assert.ok(b.body.results[3].error);
  const w = await player.get(`/api/workouts/player/${player.id}/${asnId}/1/1`);
  assert.equal(w.body.complete, true);
  assert.equal(w.body.logged_sets, 4);
  // coaches can log for a player
  assert.equal((await sc.post('/api/wt-logs', { ...base, set_no: 3, player_id: player.id })).status, 200);
});

test('testing days and personal records', async () => {
  const best = t.db.get(`SELECT max(value) v FROM tests WHERE player_id=? AND test_key='bench'`, player.id).v;
  assert.equal((await player.post('/api/tests', { player_id: player.id, test_key: 'bench', value: 999 })).status, 403);
  assert.equal((await sc.post('/api/tests', { player_id: player.id, test_key: 'curl', value: 100 })).status, 400);
  assert.equal((await sc.post('/api/tests', { player_id: player.id, test_key: 'bench', value: -5 })).status, 400);
  const pr = await sc.post('/api/tests', { player_id: player.id, test_key: 'bench', value: best + 10 });
  assert.equal(pr.body.pr, true);
  const notPr = await sc.post('/api/tests', { player_id: player.id, test_key: 'bench', value: best - 10 });
  assert.equal(notPr.body.pr, false);
  const fastest = t.db.get(`SELECT min(value) v FROM tests WHERE player_id=? AND test_key='forty'`, player.id).v;
  assert.equal((await sc.post('/api/tests', { player_id: player.id, test_key: 'forty', value: fastest - 0.1 })).body.pr, true, 'lower is better for the 40');
  const mine = await player.get(`/api/tests?player_id=${player.id}`);
  assert.equal(mine.body.prs.bench.value, best + 10);
  assert.equal(mine.body.prs.forty.value, fastest - 0.1);
  const other = t.varsity('u.id!=?', player.id)[0];
  assert.equal((await player.get(`/api/tests?player_id=${other.id}`)).status, 403);
  assert.equal((await player.get('/api/tests')).status, 403);

  const batch = await sc.post('/api/tests/batch', { test_key: 'vertical', date: today(), entries: [{ player_id: player.id, value: 99 }, { player_id: other.id, value: '' }, { player_id: 999999, value: 30 }] });
  assert.equal(batch.body.results.length, 2);
  assert.equal(batch.body.prs, 1);
  assert.ok(batch.body.results[1].error);
  const imp = await sc.post('/api/tests/import', { rows: [{ name: player.user.name, test: 'broad', value: 110 }, { name: 'Nobody Here', test: 'broad', value: 100 }] });
  assert.equal(imp.body.created, 1);
  assert.equal(imp.body.errors[0].row, 2);
});

test('body weight is private to the player, parents and granted staff', async () => {
  const other = t.varsity('u.id!=?', player.id)[0];
  const own = await player.get(`/api/bodyweight/${player.id}`);
  assert.equal(own.status, 200);
  assert.ok(own.body.length >= 4);
  assert.equal((await player.get(`/api/bodyweight/${other.id}`)).status, 403);
  assert.equal((await parent.get(`/api/bodyweight/${player.id}`)).status, 200);
  assert.equal((await parent.get(`/api/bodyweight/${other.id}`)).status, 403);
  const qbc = await t.as('QB coach');
  assert.equal((await qbc.get(`/api/bodyweight/${player.id}`)).status, 403);
  assert.equal((await trainer.get(`/api/bodyweight/${player.id}`)).status, 200);
  assert.equal((await sc.get(`/api/bodyweight/${player.id}`)).status, 200, 'S&C coach has body-data permission');
  assert.equal((await head.get(`/api/bodyweight/${player.id}`)).status, 200);
  assert.ok(t.db.get(`SELECT 1 FROM audit WHERE action='view' AND entity='bodyweight' AND user_id=?`, trainer.id));

  assert.equal((await player.post('/api/bodyweight', { value: 20 })).status, 400);
  assert.equal((await player.post('/api/bodyweight', { value: 201 })).status, 200);
  assert.equal((await player.post('/api/bodyweight', { value: 201, player_id: other.id })).status, 403);
  assert.equal((await qbc.post('/api/bodyweight', { value: 201, player_id: player.id })).status, 403);
  assert.equal((await trainer.post('/api/bodyweight', { value: 202, player_id: player.id })).status, 200);
  // never on the leaderboard
  assert.equal((await player.get('/api/leaderboard?test_key=bodyweight')).status, 400);
});

let planId;
test('meal plans need trainer approval before players see them; locked plans', async () => {
  const meals = [{ name: 'Breakfast', time: '07:00' }, { name: 'Lunch', time: '12:00' }];
  const c = await sc.post('/api/meal-plans', { name: 'Coach draft', meals, audience: [`player:${player.id}`] });
  assert.equal(c.body.approved, false);
  planId = c.body.id;
  assert.ok(!(await player.get('/api/meal-plans')).body.some((m) => m.id === planId));
  assert.equal((await sc.post(`/api/meal-plans/${planId}/approve`)).status, 403);
  assert.equal((await trainer.post(`/api/meal-plans/${planId}/approve`)).status, 200);
  assert.equal(t.notifications(player.id, 'Meal plan: Coach draft').length, 1);
  assert.ok((await player.get('/api/meal-plans')).body.some((m) => m.id === planId));
  assert.ok((await parent.get('/api/meal-plans')).body.some((m) => m.id === planId));
  // a coach editing meals sends it back for approval
  await sc.put(`/api/meal-plans/${planId}`, { meals: [...meals, { name: 'Snack', time: '15:00' }] });
  assert.equal(t.db.get('SELECT approved_by FROM meal_plans WHERE id=?', planId).approved_by, null);
  assert.ok(!(await player.get('/api/meal-plans')).body.some((m) => m.id === planId));
  await trainer.post(`/api/meal-plans/${planId}/approve`);
  // only trainers lock; locked plans cannot be changed by coaches
  assert.equal((await sc.put(`/api/meal-plans/${planId}`, { locked: true })).status, 403);
  assert.equal((await trainer.put(`/api/meal-plans/${planId}`, { locked: true })).status, 200);
  assert.equal((await sc.put(`/api/meal-plans/${planId}`, { name: 'Renamed' })).status, 403);
  assert.equal((await sc.del(`/api/meal-plans/${planId}`)).status, 403);
  const tc = await trainer.post('/api/meal-plans', { name: 'Trainer plan', meals, locked: true });
  assert.equal(tc.body.approved, true);
  assert.equal(t.db.get('SELECT locked FROM meal_plans WHERE id=?', tc.body.id).locked, 1);
  assert.equal((await player.post('/api/meal-plans', { name: 'x' })).status, 403);
});

test('meal logging, adherence and nutrition opt-out', async () => {
  const d = today();
  assert.equal((await player.post('/api/meal-logs', { plan_id: planId, meal_idx: 9 })).status, 400);
  assert.equal((await player.post('/api/meal-logs', { plan_id: planId, meal_idx: 0, date: d })).status, 200);
  assert.equal((await player.post('/api/meal-logs', { plan_id: planId, meal_idx: 1, date: d })).status, 200);
  assert.equal((await player.post('/api/meal-logs', { plan_id: planId, meal_idx: 1, date: d, done: false })).status, 200);
  assert.equal((await player.post('/api/meal-logs', { plan_id: planId, hydration: true, date: d })).status, 200);
  assert.equal((await parent.post('/api/meal-logs', { plan_id: planId, meal_idx: 0, player_id: player.id })).status, 403);
  const logs = await player.get(`/api/meal-logs?date=${d}`);
  assert.equal(logs.body.meals.filter((m) => m.done).length, 1);
  assert.equal(logs.body.hydration[0].met, 1);
  const adh = await trainer.get(`/api/meal-plans/${planId}/adherence?from=${d}&to=${d}`);
  assert.equal(adh.status, 200);
  const row = adh.body.rows.find((r) => r.player_id === player.id);
  assert.equal(row.meals_done, 1);
  assert.equal(row.meals_planned, 3);
  assert.equal(row.rate, 33);
  assert.equal(row.hydration_days, 1);
  assert.equal(adh.body.opted_out, 0);
  assert.equal((await player.get(`/api/meal-plans/${planId}/adherence`)).status, 403);

  await player.post(`/api/players/${player.id}/opt-out`, { opt_out: true });
  assert.equal((await player.post('/api/meal-logs', { plan_id: planId, meal_idx: 0 })).status, 400);
  assert.ok(!(await player.get('/api/meal-plans')).body.some((m) => m.id === planId));
  const adh2 = await trainer.get(`/api/meal-plans/${planId}/adherence`);
  assert.equal(adh2.body.opted_out, 1);
  assert.equal(adh2.body.rows.length, 0);
});

test('coach dashboard shows who is behind', async () => {
  const r = await sc.get('/api/wt-dashboard');
  assert.equal(r.status, 200);
  assert.ok(r.body.assignments.length >= 2);
  const seeded = r.body.assignments.find((a) => a.program_name.startsWith('In-season'));
  const d = await sc.get(`/api/wt-dashboard?assignment_id=${seeded.id}&position=QB`);
  assert.ok(d.body.rows.length >= 1 && d.body.rows.every((x) => x.positions.includes('QB')));
  assert.ok(d.body.rows.every((x) => x.due === d.body.due_days && x.behind === x.due - x.completed));
  assert.ok(d.body.progress.squat.length >= 1);
  assert.equal((await player.get('/api/wt-dashboard')).status, 403);
  const csv = await sc.get('/api/wt-dashboard/export.csv');
  assert.ok(csv.body.startsWith('Player,Date,Exercise'));
});

test('leaderboard only when the head coach turns it on', async () => {
  const on = await player.get('/api/leaderboard?test_key=squat');
  assert.equal(on.status, 200);
  assert.ok(on.body.rows.length <= 25 && on.body.rows.length > 0);
  assert.ok(on.body.rows[0].best >= on.body.rows[1].best);
  const forty = await player.get('/api/leaderboard?test_key=forty');
  assert.ok(forty.body.rows[0].best <= forty.body.rows[1].best);
  await t.setSettings({ leaderboard: false });
  assert.equal((await player.get('/api/leaderboard')).status, 403);
  assert.equal((await sc.get('/api/leaderboard')).status, 200);
});

test('weight room data is isolated per program (reads and deletes)', async () => {
  const other = addOtherProgram(t);
  // reads
  assert.equal((await head.get(`/api/bodyweight/${other.player}`)).status, 403);
  assert.equal((await trainer.get(`/api/bodyweight/${other.player}`)).status, 403);
  assert.equal((await sc.get(`/api/tests?player_id=${other.player}`)).status, 403);
  assert.equal((await sc.get(`/api/meal-logs?player_id=${other.player}`)).status, 403);
  assert.equal((await sc.get(`/api/workouts/player/${other.player}`)).status, 403);
  assert.equal((await trainer.get(`/api/bodyweight/${player.id}`)).status, 200, 'own program still works');
  // deletes
  assert.equal((await sc.del(`/api/wt-overrides/${other.override}`)).status, 404);
  assert.equal((await sc.del(`/api/tests/${other.test}`)).status, 404);
  assert.equal((await sc.del(`/api/wt-logs/${other.wtLog}`)).status, 403);
  assert.ok(t.db.get('SELECT 1 FROM wt_overrides WHERE id=?', other.override));
  assert.ok(t.db.get('SELECT 1 FROM tests WHERE id=?', other.test));
  assert.ok(t.db.get('SELECT 1 FROM wt_logs WHERE id=?', other.wtLog));
});
