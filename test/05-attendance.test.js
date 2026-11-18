import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, today, addDays, addMinutes, nowLocal, addOtherProgram } from './helpers.js';

let t; let head; let player; let V; let eventId; let roster;
before(async () => {
  t = await start();
  head = await t.as('coach@ridgeview.example');
  player = await t.as('player@ridgeview.example');
  V = t.teams.Varsity;
  const e = await head.post('/api/events', { type: 'practice', title: 'Attendance practice', start: addMinutes(nowLocal(), 30), audience: [`team:${V}`] });
  eventId = e.body.id;
  roster = t.varsity();
});
after(() => t.close());

test('attendance is staff only', async () => {
  assert.equal((await player.get(`/api/attendance/${eventId}`)).status, 403);
  assert.equal((await player.post(`/api/attendance/${eventId}/mark`, { player_id: player.id, status: 'present' })).status, 403);
  const meta = await player.get('/api/attendance/meta');
  assert.deepEqual(meta.body.statuses, ['present', 'late', 'left_early', 'excused', 'unexcused']);
});

test('planned absences from RSVP show on the sheet', async () => {
  await player.post(`/api/events/${eventId}/rsvp`, { status: 'not_going', reason: 'academic' });
  const s = await head.get(`/api/attendance/${eventId}`);
  assert.equal(s.status, 200);
  assert.equal(s.body.counts.expected, roster.length);
  assert.equal(s.body.counts.planned_absent, 1);
  const me = s.body.players.find((p) => p.id === player.id);
  assert.equal(me.rsvp.status, 'not_going');
  assert.equal(me.attendance.confirmed, 0);
  assert.equal(me.attendance.reason, 'academic');
});

test('coach marks players; validation and group limits', async () => {
  const a = roster.find((p) => p.id !== player.id && p.positions.includes('DL'));
  assert.equal((await head.post(`/api/attendance/${eventId}/mark`, { player_id: a.id, status: 'asleep' })).status, 400);
  const jv = t.players('p.team_id=?', t.teams['JV Red'])[0];
  assert.equal((await head.post(`/api/attendance/${eventId}/mark`, { player_id: jv.id, status: 'present' })).status, 400, 'not in the event');
  assert.equal((await head.post(`/api/attendance/${eventId}/mark`, { player_id: a.id, status: 'late', reason: 'Class ran over' })).status, 200);
  const qbc = await t.as('QB coach');
  assert.equal((await qbc.post(`/api/attendance/${eventId}/mark`, { player_id: a.id, status: 'present' })).status, 403, 'QB coach cannot mark a DL');
  const otherQb = roster.find((p) => p.positions.includes('QB') && p.id !== player.id);
  assert.equal((await qbc.post(`/api/attendance/${eventId}/mark`, { player_id: otherQb.id, status: 'present' })).status, 200);
  const trainer = await t.as('Athletic trainer');
  assert.equal((await trainer.post(`/api/attendance/${eventId}/mark`, { player_id: a.id, status: 'present' })).status, 403);
  // "my group" filter for a scoped coach
  const mine = await qbc.get(`/api/attendance/${eventId}?mine=1`);
  assert.ok(mine.body.players.length >= 1 && mine.body.players.every((p) => p.positions.includes('QB')));
  const row = t.db.get('SELECT * FROM attendance WHERE event_id=? AND player_id=?', eventId, a.id);
  assert.equal(row.status, 'late');
  assert.equal(row.confirmed, 1);
  assert.ok(t.db.get(`SELECT 1 FROM audit WHERE action='attendance' AND entity_id=?`, eventId));
});

test('mark all present leaves existing marks and RSVP pre-marks; confirm planned', async () => {
  const r = await head.post(`/api/attendance/${eventId}/all-present`);
  assert.equal(r.status, 200);
  assert.equal(r.body.marked, roster.length - 3);
  const s = await head.get(`/api/attendance/${eventId}`);
  assert.equal(s.body.counts.planned_absent, 1);
  assert.equal(s.body.counts.late, 1);
  assert.equal(s.body.counts.not_checked_in, 0);
  assert.equal(s.body.counts.present, roster.length - 2);
  const c = await head.post(`/api/attendance/${eventId}/confirm`);
  assert.equal(c.body.confirmed, 1);
  const me = t.db.get('SELECT * FROM attendance WHERE event_id=? AND player_id=?', eventId, player.id);
  assert.equal(me.confirmed, 1);
  assert.equal(me.status, 'excused');
  const ev = await head.get('/api/attendance/events');
  const row = ev.body.find((x) => x.id === eventId);
  assert.equal(row.expected, roster.length);
  assert.equal(row.marked, roster.length);
});

test('self check-in with a code', async () => {
  const e = await head.post('/api/events', { type: 'lift', title: 'Check-in lift', start: addMinutes(nowLocal(), 30), audience: [`team:${V}`] });
  const code = await head.post(`/api/attendance/${e.body.id}/code`, { minutes: 60 });
  assert.equal(code.status, 200);
  assert.match(code.body.code, /^[A-Z2-9]+$/);
  assert.equal((await player.post('/api/checkin', { code: 'WRONG1' })).status, 400);
  const ok = await player.post('/api/checkin', { code: code.body.code.toLowerCase() });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'present');
  const again = await player.post('/api/checkin', { code: code.body.code });
  assert.equal(again.body.already, true);
  const jv = await t.as(t.players('p.team_id=? AND u.password_hash IS NOT NULL', t.teams['JV Black'])[0].id);
  assert.equal((await jv.post('/api/checkin', { code: code.body.code })).status, 400);
  assert.equal((await head.post('/api/checkin', { code: code.body.code })).status, 403);
  const row = t.db.get('SELECT * FROM attendance WHERE event_id=? AND player_id=?', e.body.id, player.id);
  assert.equal(row.source, 'self');
  const sheet = await head.get(`/api/attendance/${e.body.id}`);
  assert.equal(sheet.body.code.code, code.body.code);

  // checking in more than 5 minutes after the start counts as late
  const late = await head.post('/api/events', { type: 'lift', title: 'Late lift', start: addMinutes(nowLocal(), -20), audience: [`team:${V}`] });
  const lc = await head.post(`/api/attendance/${late.body.id}/code`, {});
  assert.equal((await player.post('/api/checkin', { code: lc.body.code })).body.status, 'late');
  // expired codes are rejected
  t.db.run('UPDATE checkin_codes SET expires_at=? WHERE event_id=?', addMinutes(nowLocal(), -1), late.body.id);
  assert.equal((await player.post('/api/checkin', { code: lc.body.code })).status, 400);
});

test('offline conflict: an edit based on an older value is flagged, not applied', async () => {
  const target = roster.find((p) => p.id !== player.id && p.positions.includes('OL'));
  await head.post(`/api/attendance/${eventId}/mark`, { player_id: target.id, status: 'present' });
  const oc = await t.as('Offensive coordinator');
  const r = await oc.post(`/api/attendance/${eventId}/mark`, { player_id: target.id, status: 'unexcused', base_at: '2000-01-01T00:00', client_at: '2000-01-01T00:05' });
  assert.deepEqual(r.body, { conflict: true });
  assert.equal(t.db.get('SELECT status FROM attendance WHERE event_id=? AND player_id=?', eventId, target.id).status, 'present');
  const sheet = await head.get(`/api/attendance/${eventId}`);
  assert.equal(sheet.body.conflicts, 1);
  const list = await head.get('/api/conflicts');
  const c = list.body.find((x) => x.entity_key === `${eventId}:${target.id}`);
  assert.equal(c.server_value.status, 'present');
  assert.equal(c.client_value.status, 'unexcused');
  assert.equal((await player.get('/api/conflicts')).status, 403);
  // same value or same user is not a conflict
  const same = await oc.post(`/api/attendance/${eventId}/mark`, { player_id: target.id, status: 'present', base_at: '2000-01-01T00:00' });
  assert.deepEqual(same.body, { ok: true });
  // resolve keeping the client value
  await head.post(`/api/conflicts/${c.id}/resolve`, { keep: 'client' });
  assert.equal(t.db.get('SELECT status FROM attendance WHERE event_id=? AND player_id=?', eventId, target.id).status, 'unexcused');
  assert.equal((await head.get('/api/conflicts')).body.length, 0);
});

test('batch marking (offline replay) reports per-item results', async () => {
  const [a, b] = roster.filter((p) => p.id !== player.id).slice(2, 4);
  const r = await head.post(`/api/attendance/${eventId}/batch`, { items: [{ player_id: a.id, status: 'left_early' }, { player_id: b.id, status: 'nope' }] });
  assert.deepEqual(r.body.results[0], { ok: true });
  assert.ok(r.body.results[1].error);
});

test('alert thresholds notify the head coach once per count', async () => {
  await t.setSettings({ absence_alert_threshold: 2, late_alert_threshold: 0 });
  // pick a player with no unexcused absences so far this season
  const target = roster.find((p) => p.id !== player.id && !t.db.get(`SELECT 1 FROM attendance WHERE player_id=? AND status='unexcused'`, p.id));
  const evs = [];
  for (let i = 0; i < 2; i++) evs.push((await head.post('/api/events', { type: 'practice', title: `Alert practice ${i}`, start: `${addDays(today(), -1)}T1${i}:00`, audience: [`team:${V}`] })).body.id);
  await head.post(`/api/attendance/${evs[0]}/mark`, { player_id: target.id, status: 'unexcused' });
  assert.equal(t.notifications(head.id, `Attendance alert: ${target.name}`).length, 0);
  await head.post(`/api/attendance/${evs[1]}/mark`, { player_id: target.id, status: 'unexcused' });
  const n = t.notifications(head.id, `Attendance alert: ${target.name}`);
  assert.equal(n.length, 1);
  assert.match(n[0].body, /2 unexcused absences/);
  assert.equal(n[0].kind, 'urgent');
  // re-marking the same status does not alert again
  await head.post(`/api/attendance/${evs[1]}/mark`, { player_id: target.id, status: 'unexcused' });
  assert.equal(t.notifications(head.id, `Attendance alert: ${target.name}`).length, 1);
  // late threshold 0 disables late alerts
  const beforeLate = t.notifications(head.id, `Attendance alert: ${player.user.name}`).length;
  await head.post(`/api/attendance/${evs[0]}/mark`, { player_id: player.id, status: 'late' });
  assert.equal(t.notifications(head.id, `Attendance alert: ${player.user.name}`).length, beforeLate);
});

test('parents are told about unexcused absences only when the setting is on', async () => {
  const parentId = t.parentsOf(player.id)[0];
  const e = await head.post('/api/events', { type: 'practice', title: 'Absent practice', start: `${addDays(today(), -2)}T15:30`, audience: [`team:${V}`] });
  await head.post(`/api/attendance/${e.body.id}/mark`, { player_id: player.id, status: 'unexcused' });
  assert.equal(t.notifications(parentId, `${player.user.name} was marked absent`).length, 0);
  await t.setSettings({ parent_absence_notice: true });
  await head.post(`/api/attendance/${e.body.id}/mark`, { player_id: player.id, status: 'present' });
  await head.post(`/api/attendance/${e.body.id}/mark`, { player_id: player.id, status: 'unexcused' });
  assert.equal(t.notifications(parentId, `${player.user.name} was marked absent`).length, 1);
});

test('reports: per-player rates, by type, CSV export, player history', async () => {
  const r = await head.get(`/api/attendance-report?from=${addDays(today(), -60)}&to=${addDays(today(), 7)}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.players.length > 40);
  const me = r.body.players.find((p) => p.player_id === player.id);
  assert.ok(me.total > 0);
  assert.equal(me.rate, Math.round(((me.present + me.late + me.left_early) / me.total) * 100));
  assert.ok(r.body.by_type.some((x) => x.type === 'practice'));
  assert.equal(r.body.thresholds.absences, 2);
  const typed = await head.get(`/api/attendance-report?type=lift&from=${addDays(today(), -60)}&to=${addDays(today(), 7)}`);
  assert.deepEqual(typed.body.by_type.map((x) => x.type), ['lift']);
  const csv = await head.get('/api/attendance-report/export.csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.ok(csv.body.startsWith('Player,Jersey,Events'));
  assert.equal((await player.get('/api/attendance-report')).status, 403);
  const hist = await player.get(`/api/attendance/player/${player.id}`);
  assert.ok(hist.body.some((x) => x.event_id === eventId));
  const other = roster.find((p) => p.id !== player.id);
  assert.equal((await player.get(`/api/attendance/player/${other.id}`)).status, 403);
  const parent = await t.as('parent@ridgeview.example');
  assert.equal((await parent.get(`/api/attendance/player/${player.id}`)).status, 200);
});

test('attendance is isolated per program and all-present only marks players in the event', async () => {
  const other = addOtherProgram(t);
  assert.equal((await head.get(`/api/attendance/player/${other.player}`)).status, 403);
  assert.equal((await head.del(`/api/attendance/${other.event}/${other.player}`)).status, 404);
  assert.ok(t.db.get('SELECT 1 FROM attendance WHERE event_id=? AND player_id=?', other.event, other.player), 'other program record untouched');
  const e = await head.post('/api/events', { type: 'practice', title: 'All-present filter', start: addMinutes(nowLocal(), 90), audience: [`team:${V}`] });
  const jv = t.players('p.team_id=?', t.teams['JV Red'])[0].id;
  const r = await head.post(`/api/attendance/${e.body.id}/all-present`, { player_ids: [roster[0].id, jv, other.player] });
  assert.equal(r.body.marked, 1);
  assert.deepEqual(t.db.all('SELECT player_id FROM attendance WHERE event_id=?', e.body.id).map((x) => x.player_id), [roster[0].id]);
});
