import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, today, addDays, addMinutes, nowLocal } from './helpers.js';

let t; let head; let player; let parent; let V;
before(async () => {
  t = await start();
  head = await t.as('coach@ridgeview.example');
  player = await t.as('player@ridgeview.example');
  parent = await t.as('parent@ridgeview.example');
  V = t.teams.Varsity;
});
after(() => t.close());

const future = (days, time = '15:30') => `${addDays(today(), days)}T${time}`;

test('meta lists event types and RSVP reasons', async () => {
  const r = await player.get('/api/calendar/meta');
  assert.ok(r.body.types.includes('game'));
  assert.ok(r.body.reasons.includes('sick'));
});

test('create event with audience: validation, type fields, delivery to the audience only', async () => {
  assert.equal((await head.post('/api/events', { type: 'bogus', title: 'x', start: future(3), audience: ['program'] })).status, 400);
  assert.equal((await head.post('/api/events', { type: 'practice', title: '', start: future(3), audience: ['program'] })).status, 400);
  assert.equal((await head.post('/api/events', { type: 'practice', title: 'x', start: '2026-1-1', audience: ['program'] })).status, 400);
  assert.equal((await head.post('/api/events', { type: 'practice', title: 'x', start: future(3), end: future(2), audience: ['program'] })).status, 400);
  assert.equal((await head.post('/api/events', { type: 'practice', title: 'x', start: future(3), audience: [] })).status, 400);

  const r = await head.post('/api/events', {
    type: 'game', title: 'vs Test Opponent', start: future(5, '19:00'), end: future(5, '22:00'), location: 'Ridgeview Stadium', audience: [`team:${V}`],
    details: { opponent: 'Test Opponent', home_away: 'home', what_to_bring: 'ignored for games' },
  });
  assert.equal(r.status, 200);
  const ev = await head.get(`/api/events/${r.body.id}`);
  assert.equal(ev.body.details.opponent, 'Test Opponent');
  assert.equal(ev.body.details.what_to_bring, undefined, 'fields not belonging to the type are dropped');
  assert.deepEqual(ev.body.audience_labels, ['Varsity']);
  assert.ok(ev.body.expected_players > 40);
  // Varsity player sees it; a freshman does not
  assert.equal((await player.get(`/api/events/${r.body.id}`)).status, 200);
  const fr = await t.as(t.players('p.team_id=?', t.teams.Freshman)[0].id);
  assert.equal((await fr.get(`/api/events/${r.body.id}`)).status, 404);
  assert.ok(!(await fr.get(`/api/events?from=${today()}&to=${addDays(today(), 10)}`)).body.some((e) => e.id === r.body.id));
  // new-event notification reached the player
  assert.ok(t.notifications(player.id, 'New: vs Test Opponent').length === 1);
  assert.equal(t.notifications(fr.id, 'New: vs Test Opponent').length, 0);
});

test('meetings default to coaches only and players cannot see them', async () => {
  const r = await head.post('/api/events', { type: 'meeting', title: 'Staff huddle', start: future(2, '07:00') });
  assert.equal(r.status, 200);
  const e = t.db.get('SELECT audience FROM events WHERE id=?', r.body.id);
  assert.deepEqual(JSON.parse(e.audience), ['coaches']);
  assert.equal((await player.get(`/api/events/${r.body.id}`)).status, 404);
  const dc = await t.as('Defensive coordinator');
  assert.equal((await dc.get(`/api/events/${r.body.id}`)).status, 200);
});

test('players, parents and trainers cannot create events', async () => {
  for (const c of [player, parent, await t.as('Athletic trainer')]) {
    assert.equal((await c.post('/api/events', { type: 'practice', title: 'x', start: future(3), audience: ['program'] })).status, 403);
  }
});

test('non-admin coaches are limited to their own groups', async () => {
  const qb = await t.as('QB coach');
  const no = await qb.post('/api/events', { type: 'film', title: 'QB film', start: future(4), audience: [`team:${V}`] });
  assert.equal(no.status, 403);
  const yes = await qb.post('/api/events', { type: 'film', title: 'QB film', start: future(4), audience: ['pos:QB'] });
  assert.equal(yes.status, 200);
  // the defensive coordinator cannot edit the QB coach's event or the head coach's varsity event
  const dc = await t.as('Defensive coordinator');
  assert.equal((await dc.put(`/api/events/${yes.body.id}`, { title: 'Hijack' })).status, 403);
  const hv = await head.post('/api/events', { type: 'practice', title: 'Varsity extra', start: future(4), audience: [`team:${V}`] });
  assert.equal((await dc.post(`/api/events/${hv.body.id}/status`, { status: 'cancelled' })).status, 403);
  assert.equal((await dc.del(`/api/events/${hv.body.id}`)).status, 403);
  // a JV head coach covers JV teams through the level scope
  const jvh = await t.as('JV head coach');
  assert.equal((await jvh.post('/api/events', { type: 'practice', title: 'JV red', start: future(4), audience: [`team:${t.teams['JV Red']}`] })).status, 200);
  // and can edit their own event, but cannot move it to varsity
  const own = await qb.put(`/api/events/${yes.body.id}`, { audience: [`team:${V}`] });
  assert.equal(own.status, 403);
});

test('recurring series: edit one occurrence vs whole series', async () => {
  const first = addDays(today(), 7);
  const r = await head.post('/api/events', {
    type: 'practice', title: 'Summer 7v7', start: `${first}T09:00`, end: `${first}T10:30`, audience: [`team:${V}`],
    repeat: { freq: 'daily', until: addDays(first, 4) },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ids.length, 5);
  const ev = await head.get(`/api/events/${r.body.ids[0]}`);
  assert.equal(ev.body.series_count, 5);

  // edit one
  const one = await head.put(`/api/events/${r.body.ids[2]}`, { scope: 'one', title: 'Summer 7v7 (scrimmage)' });
  assert.equal(one.status, 200);
  const titles = t.db.all(`SELECT title FROM events WHERE series_id=? ORDER BY start`, r.body.series_id).map((x) => x.title);
  assert.deepEqual(titles.filter((x) => x.includes('scrimmage')).length, 1);

  // edit the series from the second occurrence: time changes, dates are kept
  const s = await head.put(`/api/events/${r.body.ids[1]}`, { scope: 'series', start: `${addDays(first, 1)}T10:00`, end: `${addDays(first, 1)}T11:30` });
  assert.equal(s.status, 200);
  assert.ok(s.body.changed.includes('start'));
  const rows = t.db.all('SELECT start, end FROM events WHERE series_id=? ORDER BY start', r.body.series_id);
  assert.equal(rows[0].start, `${first}T09:00`, 'earlier occurrence untouched');
  for (let i = 1; i < 5; i++) {
    assert.equal(rows[i].start, `${addDays(first, i)}T10:00`);
    assert.equal(rows[i].end, `${addDays(first, i)}T11:30`);
  }
  // important change sends an urgent notice and is in the change log
  assert.ok(t.notifications(player.id, 'Changed: Summer 7v7%').some((n) => n.kind === 'urgent'));
  const det = await head.get(`/api/events/${r.body.ids[3]}`);
  assert.ok(det.body.history.some((h) => h.action === 'edit' && h.detail.start));

  // weekly repeat on chosen weekdays
  const w = await head.post('/api/events', { type: 'lift', title: 'AM lift', start: `${first}T06:30`, audience: [`team:${V}`], repeat: { freq: 'weekly', days: [1, 3, 5], until: addDays(first, 13) } });
  const days = t.db.all('SELECT start FROM events WHERE series_id=?', w.body.series_id).map((x) => new Date(x.start).getDay());
  assert.ok(days.length >= 5 && days.length <= 7);
  assert.ok(days.every((d) => [1, 3, 5].includes(d)));

  // delete the rest of the series
  const del = await head.del(`/api/events/${r.body.ids[3]}?scope=series`);
  assert.equal(del.body.deleted, 2);
  assert.equal(t.db.get('SELECT count(*) n FROM events WHERE series_id=?', r.body.series_id).n, 3);
});

test('game-week template builds the week leading up to the game', async () => {
  // next Friday at least a week away
  let gd = addDays(today(), 8);
  while (new Date(gd + 'T12:00').getDay() !== 5) gd = addDays(gd, 1);
  const r = await head.post('/api/events/game-week', { game_date: gd, opponent: 'Template Tigers', home_away: 'away', kickoff: '19:00', audience: [`team:${V}`] });
  assert.equal(r.status, 200);
  const evs = r.body.ids.map((id) => t.db.get('SELECT * FROM events WHERE id=?', id));
  assert.equal(evs.length, 7); // 6 template events Mon-Thu + game
  const game = evs[evs.length - 1];
  assert.equal(game.type, 'game');
  assert.equal(game.start, `${gd}T19:00`);
  const det = JSON.parse(game.details);
  assert.equal(det.report_time, '17:00');
  assert.equal(det.bus_departure, '16:15');
  assert.ok(evs.slice(0, -1).every((e) => e.start < gd));
  const meeting = evs.find((e) => e.type === 'meeting');
  assert.deepEqual(JSON.parse(meeting.audience), ['coaches']);
  assert.equal((await head.post('/api/events/game-week', { game_date: gd })).status, 400);
  const qb = await t.as('QB coach');
  assert.equal((await qb.post('/api/events/game-week', { game_date: gd, opponent: 'X' })).status, 403);
});

test('status change sends urgent notifications and tracks acknowledgments', async () => {
  const e = await head.post('/api/events', { type: 'practice', title: 'Status practice', start: future(2), end: future(2, '17:30'), location: 'Main field', audience: [`team:${V}`] });
  assert.equal((await head.post(`/api/events/${e.body.id}/status`, { status: 'exploded' })).status, 400);
  const d = await head.post(`/api/events/${e.body.id}/status`, { status: 'delayed', delay_minutes: 30, note: 'Lightning' });
  assert.equal(d.status, 200);
  assert.ok(d.body.sent > 40);
  const row = t.db.get('SELECT start, end, status FROM events WHERE id=?', e.body.id);
  assert.equal(row.start, addMinutes(future(2), 30));
  assert.equal(row.end, addMinutes(future(2, '17:30'), 30));
  assert.equal(row.status, 'delayed');

  const mine = (await player.get('/api/notifications')).body.find((n) => n.ref === d.body.ref);
  assert.equal(mine.kind, 'urgent');
  assert.match(mine.title, /^Delayed: Status practice/);
  // parents of audience players get it too
  assert.ok(t.notifications(parent.id).some((n) => n.ref === d.body.ref));

  let acks = await head.get(`/api/events/${e.body.id}/acks`);
  assert.equal(acks.body.ref, d.body.ref);
  assert.ok(acks.body.not_opened.some((u) => u.id === player.id));
  await player.post(`/api/notifications/${mine.id}/open`);
  acks = await head.get(`/api/events/${e.body.id}/acks?ref=${encodeURIComponent(d.body.ref)}`);
  assert.ok(acks.body.opened.some((u) => u.id === player.id));
  assert.ok(!acks.body.not_opened.some((u) => u.id === player.id));
  assert.equal((await player.get(`/api/events/${e.body.id}/acks`)).status, 403);

  const det = await head.get(`/api/events/${e.body.id}`);
  assert.equal(det.body.alerts[0].opened, 1);

  // cancel: ICS feed and RSVP reflect it
  const c = await head.post(`/api/events/${e.body.id}/status`, { status: 'cancelled' });
  assert.equal(c.status, 200);
  const rs = await player.post(`/api/events/${e.body.id}/rsvp`, { status: 'going' });
  assert.equal(rs.status, 400);
});

test('RSVP: not going requires a reason and pre-marks attendance; changing back clears it', async () => {
  const e = await head.post('/api/events', { type: 'practice', title: 'RSVP practice', start: future(3), audience: [`team:${V}`] });
  const id = e.body.id;
  assert.equal((await player.post(`/api/events/${id}/rsvp`, { status: 'yes' })).status, 400);
  assert.equal((await player.post(`/api/events/${id}/rsvp`, { status: 'not_going' })).status, 400);
  assert.equal((await player.post(`/api/events/${id}/rsvp`, { status: 'not_going', reason: 'bored' })).status, 400);
  assert.equal((await player.post(`/api/events/${id}/rsvp`, { status: 'not_going', reason: 'sick', note: 'Flu' })).status, 200);
  let att = t.db.get('SELECT * FROM attendance WHERE event_id=? AND player_id=?', id, player.id);
  assert.equal(att.status, 'excused');
  assert.equal(att.source, 'rsvp');
  assert.equal(att.confirmed, 0);
  const ev = await player.get(`/api/events/${id}`);
  assert.deepEqual(ev.body.my_rsvp, { status: 'not_going', reason: 'sick' });
  const staffView = await head.get(`/api/events/${id}`);
  assert.equal(staffView.body.rsvp_counts.not_going, 1);
  assert.equal(staffView.body.no_response, staffView.body.expected_players - 1);

  assert.equal((await player.post(`/api/events/${id}/rsvp`, { status: 'going' })).status, 200);
  att = t.db.get('SELECT * FROM attendance WHERE event_id=? AND player_id=?', id, player.id);
  assert.equal(att, undefined);

  // a freshman cannot RSVP to a varsity event
  const fr = await t.as(t.players('p.team_id=?', t.teams.Freshman)[0].id);
  assert.equal((await fr.post(`/api/events/${id}/rsvp`, { status: 'going' })).status, 404);
});

test('RSVP deadline blocks players but not staff', async () => {
  const e = await head.post('/api/events', { type: 'social', title: 'Closed dinner', start: future(3, '18:00'), audience: ['program'], rsvp_deadline: addMinutes(nowLocal(), -5) });
  assert.equal((await player.post(`/api/events/${e.body.id}/rsvp`, { status: 'going' })).status, 400);
  assert.equal((await head.post(`/api/events/${e.body.id}/rsvp`, { status: 'going', for_player: player.id })).status, 200);
});

test('parents RSVP on behalf of their own child only', async () => {
  const e = await head.post('/api/events', { type: 'game', title: 'Parent RSVP game', start: future(6, '19:00'), audience: [`team:${V}`] });
  const id = e.body.id;
  assert.equal((await parent.post(`/api/events/${id}/rsvp`, { status: 'going' })).status, 400);
  const other = t.varsity('u.id!=?', player.id)[0];
  assert.equal((await parent.post(`/api/events/${id}/rsvp`, { status: 'going', for_player: other.id })).status, 403);
  assert.equal((await parent.post(`/api/events/${id}/rsvp`, { status: 'not_going', reason: 'family', for_player: player.id })).status, 200);
  const r = t.db.get('SELECT * FROM rsvps WHERE event_id=? AND user_id=?', id, player.id);
  assert.equal(r.by_user, parent.id);
  assert.equal(r.status, 'not_going');
  const pv = await parent.get(`/api/events/${id}`);
  assert.equal(pv.body.player_rsvps[0].status, 'not_going');
  assert.equal(t.db.get('SELECT source FROM attendance WHERE event_id=? AND player_id=?', id, player.id).source, 'rsvp');
});

test('ICS feed: subscribe URL works without sign-in and only lists the user\'s events', async () => {
  const meet = await head.post('/api/events', { type: 'meeting', title: 'Secret staff meeting', start: future(1, '07:00') });
  const pr = await head.post('/api/events', { type: 'practice', title: 'Feed practice; pads', start: future(1), audience: [`team:${V}`] });
  await head.post(`/api/events/${pr.body.id}/status`, { status: 'cancelled' });
  const u = await player.get('/api/calendar/feed-url');
  assert.match(u.body.path, /^\/feed\/.+\.ics$/);
  const feed = await t.anon.get(u.body.path);
  assert.equal(feed.status, 200);
  assert.match(feed.headers.get('content-type'), /text\/calendar/);
  assert.ok(feed.body.startsWith('BEGIN:VCALENDAR'));
  assert.ok(feed.body.includes('SUMMARY:CANCELLED: Feed practice\\; pads'));
  assert.ok(feed.body.includes(`UID:event-${pr.body.id}@program-manager`));
  assert.ok(!feed.body.includes('Secret staff meeting'));
  const hu = await head.get('/api/calendar/feed-url');
  const hfeed = await t.anon.get(hu.body.path);
  assert.ok(hfeed.body.includes('Secret staff meeting'));
  assert.equal((await t.anon.get('/feed/not-a-token.ics')).status, 404);
});

test('event list: one calendar filtered per user, with audience filter for admins', async () => {
  const from = addDays(today(), -21); const to = addDays(today(), 14);
  const all = await head.get(`/api/events?from=${from}&to=${to}`);
  const jv = await head.get(`/api/events?from=${from}&to=${to}&audience=level:${t.levels.JV}`);
  assert.ok(jv.body.length < all.body.length);
  assert.ok(jv.body.some((e) => e.title === 'JV practice'));
  assert.ok(!jv.body.some((e) => e.title === 'Varsity practice'));
  const mine = await player.get(`/api/events?from=${from}&to=${to}`);
  assert.ok(!mine.body.some((e) => e.title === 'JV practice'));
  assert.ok(mine.body.every((e) => e.rsvp_counts === undefined), 'players do not get RSVP counts');
  const games = await player.get(`/api/events?from=${from}&to=${to}&type=game`);
  assert.ok(games.body.length && games.body.every((e) => e.type === 'game'));
});

test('only the nearest due reminder is sent, once, via ctx.sendReminders', async () => {
  const startAt = addMinutes(nowLocal(), 60);
  const e = await head.post('/api/events', { type: 'practice', title: 'Reminder practice', start: startAt, audience: [`player:${player.id}`], reminders: [1440, 120] });
  assert.equal(e.status, 200);
  const sent = t.app.ctx.sendReminders();
  assert.ok(sent >= 1);
  const mine = t.notifications(player.id, 'Reminder: Reminder practice');
  assert.equal(mine.length, 1, 'the missed 24h reminder is skipped when the 2h one is due');
  assert.ok(mine.every((n) => n.kind === 'reminder'));
  assert.ok(t.notifications(parent.id, 'Reminder: Reminder practice').length === 1, 'parents are reminded too');
  // short-notice reminders are push only; only day-before reminders are emailed
  assert.equal(t.db.get(`SELECT count(*) n FROM outbox WHERE user_id=? AND subject='Reminder: Reminder practice'`, player.id).n, 0);
  t.app.ctx.sendReminders();
  assert.equal(t.notifications(player.id, 'Reminder: Reminder practice').length, 1, 'not repeated');
  // admins can trigger the job; others cannot
  assert.equal((await player.post('/api/calendar/run-reminders')).status, 403);
  assert.equal((await head.post('/api/calendar/run-reminders')).status, 200);
});

test('email me the event details', async () => {
  const e = await head.post('/api/events', { type: 'game', title: 'Email game', start: future(4, '19:00'), location: 'Away field', audience: [`team:${V}`], details: { opponent: 'Mailers' } });
  assert.equal((await player.post(`/api/events/${e.body.id}/email`)).status, 200);
  const mail = t.db.get(`SELECT * FROM outbox WHERE user_id=? AND subject='Event: Email game'`, player.id);
  assert.match(mail.body, /Where: Away field/);
  assert.match(mail.body, /opponent: Mailers/);
});
