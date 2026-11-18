import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, today, addDays, addOtherProgram } from './helpers.js';

let t; let head; let player; let trainer; let V; let drills = {};
before(async () => {
  t = await start();
  head = await t.as('coach@ridgeview.example');
  player = await t.as('player@ridgeview.example');
  trainer = await t.as('Athletic trainer');
  V = t.teams.Varsity;
});
after(() => t.close());

test('drill library: search, filters and permissions', async () => {
  assert.equal((await player.get('/api/drills')).status, 403);
  assert.equal((await trainer.post('/api/drills', { name: 'Nope' })).status, 403);
  assert.equal((await head.post('/api/drills', {})).status, 400);
  const r = await head.post('/api/drills', { name: 'QB pocket movement', description: 'Climb and slide', skills: 'pocket, footwork', unit: 'offense', positions: ['qb'], duration: 12 });
  assert.equal(r.status, 200);
  drills.pocket = r.body.id;
  const q = await head.get('/api/drills?q=pocket');
  assert.ok(q.body.some((d) => d.id === r.body.id));
  const pos = await head.get('/api/drills?position=QB');
  assert.ok(pos.body.find((d) => d.id === r.body.id).positions.includes('QB'), 'positions are upper-cased');
  assert.ok(pos.body.every((d) => d.positions.includes('QB')));
  const unit = await head.get('/api/drills?unit=defense');
  assert.ok(unit.body.length && unit.body.every((d) => d.unit === 'defense'));
  const dc = await t.as('Defensive coordinator');
  assert.equal((await dc.put(`/api/drills/${r.body.id}`, { duration: 15 })).status, 200);
  assert.equal(t.db.get('SELECT duration FROM drills WHERE id=?', r.body.id).duration, 15);
  assert.equal(t.db.get('SELECT name FROM drills WHERE id=?', r.body.id).name, 'QB pocket movement');
  drills.tackle = t.db.get(`SELECT id FROM drills WHERE name='Tackling circuit'`).id;
});

let planId; let periods;
test('practice plan with ordered periods is retimed from the start time', async () => {
  assert.equal((await trainer.post('/api/plans', { name: 'x' })).status, 403);
  const r = await head.post('/api/plans', { name: 'Thursday plan', start_time: '15:30' });
  assert.equal(r.status, 200);
  planId = r.body.id;
  const u = await head.put(`/api/plans/${planId}`, {
    periods: [
      { duration: 10, drill_id: drills.pocket, unit: 'offense', positions: ['QB'], group_label: 'QBs', location: 'North', contact: false },
      { duration: 15, drill_id: drills.tackle, unit: 'defense', group_label: 'Defense', contact: true },
      { duration: 20, group_label: 'Team', contact: true },
    ],
  });
  assert.equal(u.status, 200);
  periods = u.body.periods;
  assert.deepEqual(periods.map((p) => p.start_time), ['15:30', '15:40', '15:55']);
  assert.equal(u.body.total_minutes, 45);
  assert.equal(u.body.contact_minutes, 35);
  assert.equal(periods[0].drill_name, 'QB pocket movement');
  // reorder and drop the last period, keeping ids
  const u2 = await head.put(`/api/plans/${planId}`, { periods: [{ ...periods[1] }, { ...periods[0] }] });
  assert.deepEqual(u2.body.periods.map((p) => p.id), [periods[1].id, periods[0].id]);
  assert.deepEqual(u2.body.periods.map((p) => p.start_time), ['15:30', '15:45']);
  assert.equal(t.db.get('SELECT count(*) n FROM periods WHERE plan_id=?', planId).n, 2);
  assert.equal((await player.get(`/api/plans/${planId}`)).status, 403);
});

test('templates: save as template and copy into a new plan', async () => {
  const s = await head.post(`/api/plans/${planId}/save-template`, { name: 'Thursday template' });
  assert.equal(s.status, 200);
  const tpls = await head.get('/api/plans?templates=1');
  assert.ok(tpls.body.some((p) => p.id === s.body.id && p.is_template === 1));
  const plans = await head.get('/api/plans');
  assert.ok(!plans.body.some((p) => p.id === s.body.id), 'templates are not listed with plans');
  const copy = await head.post('/api/plans', { name: 'Copied', copy_from: s.body.id, start_time: '16:00' });
  const d = await head.get(`/api/plans/${copy.body.id}`);
  assert.equal(d.body.periods.length, 2);
  assert.equal(d.body.periods[0].start_time, '16:00');
  assert.ok(d.body.periods.every((p) => p.status === 'pending'));
  assert.equal((await head.post('/api/plans', { name: 'Bad', copy_from: 999999 })).status, 404);
});

let evPlan; let evPeriods; let eventId;
test('plan attached to a practice event; period roster filtered by unit and position', async () => {
  const e = await head.post('/api/events', { type: 'practice', title: 'Roster practice', start: `${addDays(today(), 2)}T15:30`, audience: [`team:${V}`] });
  eventId = e.body.id;
  const game = await head.post('/api/events', { type: 'game', title: 'No plans for games', start: `${addDays(today(), 3)}T19:00`, audience: [`team:${V}`] });
  assert.equal((await head.post('/api/plans', { event_id: game.body.id })).status, 400);
  const p = await head.post('/api/plans', { event_id: eventId, template_id: t.db.get(`SELECT id FROM practice_plans WHERE name='Tuesday template'`).id });
  assert.equal(p.status, 200);
  evPlan = p.body.id;
  assert.equal((await head.post('/api/plans', { event_id: eventId })).status, 400, 'one plan per practice');
  const d = await head.get(`/api/plans/${evPlan}`);
  assert.equal(d.body.name, 'Roster practice');
  assert.equal(d.body.event.id, eventId);
  assert.equal(d.body.periods[0].start_time, '15:30');
  assert.ok(d.body.week.minutes > 0);
  evPeriods = d.body.periods;

  const qbPeriod = evPeriods.find((x) => JSON.stringify(x.positions) === '["QB"]');
  const r = await head.get(`/api/periods/${qbPeriod.id}/roster`);
  assert.equal(r.status, 200);
  assert.ok(r.body.length >= 1);
  assert.ok(r.body.every((x) => x.positions.includes('QB') && x.units.includes('offense')));
  assert.ok(r.body.some((x) => x.id === player.id));
  const varsityIds = new Set(t.varsity().map((x) => x.id));
  assert.ok(r.body.every((x) => varsityIds.has(x.id)), 'only players in the event audience');

  const defPeriod = evPeriods.find((x) => x.unit === 'defense' && x.positions.length === 3);
  const dr = await head.get(`/api/periods/${defPeriod.id}/roster`);
  assert.ok(dr.body.length > 5);
  assert.ok(dr.body.every((x) => x.units.includes('defense') && x.positions.some((pp) => ['DL', 'LB', 'DB'].includes(pp))));

  // a player planned absent by RSVP is flagged in the period roster
  await player.post(`/api/events/${eventId}/rsvp`, { status: 'not_going', reason: 'sick' });
  const r2 = await head.get(`/api/periods/${qbPeriod.id}/roster`);
  assert.equal(r2.body.find((x) => x.id === player.id).flagged, true);
  const whole = await head.get(`/api/plans/${evPlan}/roster`);
  assert.equal(whole.body.length, varsityIds.size);
});

test('run mode: period status updates', async () => {
  const p = evPeriods[0];
  assert.equal((await head.post(`/api/periods/${p.id}/status`, { status: 'weird' })).status, 400);
  assert.equal((await head.post(`/api/periods/${p.id}/status`, { status: 'changed', note: 'Moved inside', duration: 5 })).status, 200);
  assert.equal((await head.post(`/api/periods/${evPeriods[1].id}/status`, { status: 'done' })).status, 200);
  assert.equal((await head.post(`/api/periods/${evPeriods[2].id}/status`, { status: 'skipped' })).status, 200);
  assert.equal((await trainer.post(`/api/periods/${p.id}/status`, { status: 'done' })).status, 403);
  const row = t.db.get('SELECT status, status_note, duration FROM periods WHERE id=?', p.id);
  assert.deepEqual(row, { status: 'changed', status_note: 'Moved inside', duration: 5 });
});

test('ratings: validation, idempotent by client_id, re-rating updates', async () => {
  const p = evPeriods.find((x) => JSON.stringify(x.positions) === '["QB"]');
  assert.equal((await trainer.post('/api/ratings', { period_id: p.id, player_id: player.id, value: 3 })).status, 403);
  assert.equal((await player.post('/api/ratings', { period_id: p.id, player_id: player.id, value: 3 })).status, 403);
  assert.equal((await head.post('/api/ratings', { period_id: p.id, player_id: player.id, value: 9 })).status, 400);
  assert.equal((await head.post('/api/ratings', { period_id: p.id, player_id: player.id, value: 2.5 })).status, 400);
  assert.equal((await head.post('/api/ratings', { period_id: p.id, player_id: 999999, value: 3 })).status, 404);

  const qbc = await t.as('QB coach');
  const a = await qbc.post('/api/ratings', { period_id: p.id, player_id: player.id, value: 4, client_id: 'rate-1' });
  assert.equal(a.status, 200);
  const dup = await qbc.post('/api/ratings', { period_id: p.id, player_id: player.id, value: 1, client_id: 'rate-1' });
  assert.deepEqual(dup.body, { id: a.body.id, duplicate: true });
  assert.equal(t.db.get('SELECT value FROM ratings WHERE id=?', a.body.id).value, 4);
  const upd = await qbc.post('/api/ratings', { period_id: p.id, player_id: player.id, value: 5, client_id: 'rate-2' });
  assert.deepEqual(upd.body, { id: a.body.id, updated: true });
  const row = t.db.get('SELECT * FROM ratings WHERE id=?', a.body.id);
  assert.equal(row.value, 5);
  assert.equal(row.date, addDays(today(), 2), 'rating date is the practice date');
  assert.equal(row.drill_id, p.drill_id);
  // a second coach can rate the same rep separately
  const b = await head.post('/api/ratings', { period_id: p.id, player_id: player.id, value: 3 });
  assert.notEqual(b.body.id, a.body.id);
  // batch replay (offline) with mixed results
  const other = t.varsity('u.id!=?', player.id)[0];
  const batch = await qbc.post('/api/ratings/batch', { items: [{ period_id: p.id, player_id: other.id, value: 2, client_id: 'b-1' }, { period_id: p.id, player_id: other.id, value: 0 }, { client_id: 'rate-1', value: 1, player_id: player.id }] });
  assert.ok(batch.body.results[0].id);
  assert.ok(batch.body.results[1].error);
  assert.equal(batch.body.results[2].duplicate, true);
  const roster = await qbc.get(`/api/periods/${p.id}/roster`);
  assert.equal(roster.body.find((x) => x.id === player.id).my_rating, 5);
  // only own ratings can be removed (unless admin)
  assert.equal((await qbc.del(`/api/ratings/${b.body.id}`)).status, 403);
  assert.equal((await qbc.del(`/api/ratings/${batch.body.results[0].id}`)).status, 200);
});

test('quick notes: tags or text required, idempotent, injury concern alerts the trainer', async () => {
  assert.equal((await player.post('/api/practice-notes', { plan_id: evPlan, text: 'x' })).status, 403);
  assert.equal((await head.post('/api/practice-notes', { plan_id: evPlan })).status, 400);
  const n = await head.post('/api/practice-notes', { plan_id: evPlan, period_id: evPeriods[1].id, player_id: player.id, tags: ['injury concern'], text: 'Favoring left ankle', client_id: 'note-1' });
  assert.equal(n.status, 200);
  const dup = await head.post('/api/practice-notes', { plan_id: evPlan, tags: ['effort'], client_id: 'note-1' });
  assert.deepEqual(dup.body, { id: n.body.id, duplicate: true });
  const row = t.db.get('SELECT * FROM practice_notes WHERE id=?', n.body.id);
  assert.equal(row.date, addDays(today(), 2));
  assert.equal(row.drill_id, evPeriods[1].drill_id);
  const alert = t.notifications(trainer.id, `Injury concern: ${player.user.name}`);
  assert.equal(alert.length, 1);
  assert.equal(alert[0].kind, 'urgent');
  // trainers can add notes too
  assert.equal((await trainer.post('/api/practice-notes', { plan_id: evPlan, tags: ['went well'] })).status, 200);
  const dc = await t.as('Defensive coordinator');
  assert.equal((await dc.del(`/api/practice-notes/${n.body.id}`)).status, 403);
  const d = await head.get(`/api/plans/${evPlan}`);
  assert.equal(d.body.notes.length, 2);
});

test('practice summary: counts, notes and top players; coaches only; share notifies staff', async () => {
  const s = await head.get(`/api/plans/${evPlan}/summary`);
  assert.equal(s.status, 200);
  assert.equal(s.body.periods_total, evPeriods.length);
  assert.equal(s.body.periods_done, 1);
  assert.equal(s.body.periods_skipped, 1);
  assert.equal(s.body.periods_changed[0].note, 'Moved inside');
  assert.equal(s.body.notes.length, 2);
  assert.equal(s.body.date, addDays(today(), 2));
  assert.ok(s.body.top.some((x) => x.player_id === player.id));
  assert.equal((await player.get(`/api/plans/${evPlan}/summary`)).status, 403);
  assert.equal((await trainer.get(`/api/plans/${evPlan}/summary`)).status, 403, 'trainer ratings are off by default');
  const sh = await head.post(`/api/plans/${evPlan}/share-summary`);
  assert.equal(sh.status, 200);
  const dc = t.user('Defensive coordinator');
  assert.equal(t.notifications(dc.id, 'Practice summary: Roster practice').length, 1);
  // trainers see ratings in plan detail only when the head coach allows it
  assert.equal((await trainer.get(`/api/plans/${evPlan}`)).body.ratings.length, 0);
  await t.setSettings({ trainer_ratings: true });
  assert.ok((await trainer.get(`/api/plans/${evPlan}`)).body.ratings.length > 0);
});

test('game-week plans are created for every practice of the week from templates', async () => {
  let mon = addDays(today(), 21); // beyond the seeded weeks
  while (new Date(mon + 'T12:00').getDay() !== 1) mon = addDays(mon, 1);
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await head.post('/api/events', { type: 'practice', title: `GW practice ${i}`, start: `${addDays(mon, i)}T15:30`, audience: [`team:${V}`] })).body.id);
  const tpl = t.db.get(`SELECT id FROM practice_plans WHERE name='Tuesday template'`).id;
  const r = await head.post('/api/plans/game-week', { week_of: addDays(mon, 2), template_id: tpl });
  assert.equal(r.status, 200);
  assert.equal(r.body.created.length, 3);
  for (const id of ids) assert.ok(t.db.get('SELECT id FROM practice_plans WHERE event_id=?', id));
  const again = await head.post('/api/plans/game-week', { week_of: mon, template_id: tpl });
  assert.equal(again.body.created.length, 0);
});

test('weekly practice total only counts practices for the same players', async () => {
  const day = addDays(today(), 120);
  const ev = async (title, audience, s, e) => (await head.post('/api/events', { type: 'practice', title, start: `${day}T${s}`, end: `${day}T${e}`, audience })).body.id;
  const varsityEv = await ev('Varsity week check', [`team:${V}`], '15:00', '17:00');
  await ev('JV week check', [`team:${t.teams['JV Red']}`], '15:00', '16:30'); // 90 min, other players
  await ev('Program walkthrough', ['program'], '18:00', '18:30'); // 30 min, includes varsity
  const plan = await head.post('/api/plans', { event_id: varsityEv });
  const r = await head.put(`/api/plans/${plan.body.id}`, { periods: [{ duration: 60 }, { duration: 40, contact: true }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.week.minutes, 130);
  assert.equal(r.body.week.contact_minutes, 40);
});

test('plans only reference this program\'s drills, plays and coaches; scoped coaches edit their own plans', async () => {
  const other = addOtherProgram(t);
  const plan = await head.post('/api/plans', { name: 'Scope plan', start_time: '15:30' });
  for (const bad of [{ drill_id: other.drill }, { play_ids: [other.play] }, { coach_id: other.coach }]) {
    assert.equal((await head.put(`/api/plans/${plan.body.id}`, { periods: [{ duration: 10, ...bad }] })).status, 400);
  }
  const mine = await head.put(`/api/plans/${plan.body.id}`, { periods: [{ duration: 10, drill_id: drills.tight || t.db.get('SELECT id FROM drills WHERE program_id=? LIMIT 1', head.user.program_id).id }] });
  assert.equal(mine.status, 200);
  // a position coach cannot edit or delete the head coach's plan, but can manage their own
  const qbc = await t.as('QB coach');
  assert.equal((await qbc.put(`/api/plans/${plan.body.id}`, { name: 'Hijack' })).status, 403);
  assert.equal((await qbc.del(`/api/plans/${plan.body.id}`)).status, 403);
  const own = await qbc.post('/api/plans', { name: 'QB plan' });
  assert.equal((await qbc.put(`/api/plans/${own.body.id}`, { name: 'QB plan 2' })).status, 200);
  assert.equal((await qbc.del(`/api/plans/${own.body.id}`)).status, 200);
});

test('ratings: only players in the period group, and scoped coaches rate only their own players', async () => {
  const ev = await head.post('/api/events', { type: 'practice', title: 'Rating scope', start: `${addDays(today(), 2)}T15:30`, audience: [`team:${V}`] });
  const plan = await head.post('/api/plans', { event_id: ev.body.id });
  const d = await head.put(`/api/plans/${plan.body.id}`, { periods: [{ duration: 10, unit: 'defense' }, { duration: 10, unit: 'offense', positions: ['QB'] }] });
  const [defP, qbP] = d.body.periods;
  const qb = t.varsity(`p.positions LIKE '%"QB"%'`)[0];
  const lineman = t.varsity(`p.units LIKE '%"defense"%' AND p.positions NOT LIKE '%"QB"%'`)[0];
  const jv = t.players('p.team_id=?', t.teams['JV Red'])[0];
  assert.equal((await head.post('/api/ratings', { period_id: qbP.id, player_id: lineman.id, value: 3 })).status, 400, 'not in the QB period');
  assert.equal((await head.post('/api/ratings', { period_id: defP.id, player_id: jv.id, value: 3 })).status, 400, 'not at this practice');
  assert.equal((await head.post('/api/ratings', { period_id: defP.id, player_id: lineman.id, value: 3 })).status, 200);
  const qbc = await t.as('QB coach');
  assert.equal((await qbc.post('/api/ratings', { period_id: defP.id, player_id: lineman.id, value: 3 })).status, 403, 'not the QB coach\'s player');
  assert.equal((await qbc.post('/api/ratings', { period_id: qbP.id, player_id: qb.id, value: 4 })).status, 200);
});
