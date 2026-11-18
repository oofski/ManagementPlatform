import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, today, addDays, addMinutes, nowLocal } from './helpers.js';

let t; let head; let player; let parent; let qbc; let trainer; let V; let install; let smash; let zone;
before(async () => {
  t = await start();
  head = await t.as('coach@ridgeview.example');
  player = await t.as('player@ridgeview.example');
  parent = await t.as('parent@ridgeview.example');
  qbc = await t.as('QB coach');
  trainer = await t.as('Athletic trainer');
  V = t.teams.Varsity;
  install = t.db.get('SELECT id FROM install_sheets LIMIT 1').id;
  smash = t.db.get(`SELECT id FROM plays WHERE name LIKE '%Smash'`).id;
  zone = t.db.get(`SELECT id FROM plays WHERE name LIKE 'Inside Zone%'`).id;
});
after(() => t.close());

const future = (d) => `${addDays(today(), d)}T21:00`;

test('assignment types are validated; coaches only', async () => {
  const aud = [`player:${player.id}`];
  assert.equal((await player.post('/api/assignments', { type: 'watch', title: 'x', video_url: 'v', audience: aud })).status, 403);
  assert.equal((await trainer.post('/api/assignments', { type: 'watch', title: 'x', video_url: 'v', audience: aud })).status, 403);
  const bad = [
    { type: 'read', title: 'x', audience: aud },
    { type: 'watch', title: '', video_url: 'v', audience: aud },
    { type: 'watch', title: 'x', audience: aud },
    { type: 'study', title: 'x', audience: aud },
    { type: 'complete', title: 'x', audience: aud, checklist: [] },
    { type: 'quiz', title: 'x', audience: aud },
    { type: 'submit', title: 'x', audience: [] },
  ];
  for (const b of bad) assert.equal((await head.post('/api/assignments', b)).status, 400, JSON.stringify(b));
  for (const b of [
    { type: 'watch', title: 'Watch it', video_url: 'https://example.com/v', audience: aud },
    { type: 'study', title: 'Study it', install_id: install, audience: aud },
    { type: 'complete', title: 'Do it', checklist: ['a'], audience: aud },
    { type: 'submit', title: 'Write it', audience: aud },
    { type: 'quiz', title: 'Quiz it', play_ids: [smash], audience: aud },
  ]) assert.equal((await qbc.post('/api/assignments', b)).status, 200, b.type);
  const meta = await player.get('/api/assignments/meta');
  assert.deepEqual(meta.body.types, ['watch', 'study', 'complete', 'submit', 'quiz']);
});

test('status per player, including late', async () => {
  const past = addMinutes(nowLocal(), -60);
  const a = await head.post('/api/assignments', { type: 'submit', title: 'Late self-eval', due: past, audience: ['pos:QB'] });
  const qbs = t.players(`p.positions LIKE '%"QB"%'`);
  const d = await head.get(`/api/assignments/${a.body.id}`);
  assert.equal(d.body.stats.total, qbs.length);
  assert.equal(d.body.stats.late, qbs.length);
  assert.ok(d.body.players.every((p) => p.display_status === 'late'));
  assert.equal(t.notifications(player.id, 'New assignment: Late self-eval').length, 1);

  const mine = (await player.get('/api/assignments')).body.find((x) => x.id === a.body.id);
  assert.equal(mine.display_status, 'late');
  assert.equal((await player.post(`/api/assignments/${a.body.id}/progress`, { done: true })).status, 400, 'need a response first');
  const sub = await player.post(`/api/assignments/${a.body.id}/progress`, { response: 'Need a quicker release', done: true });
  assert.equal(sub.body.status, 'completed');
  assert.equal(sub.body.late, true);
  const after = await head.get(`/api/assignments/${a.body.id}`);
  assert.equal(after.body.stats.completed, 1);
  assert.equal(after.body.players.find((p) => p.player_id === player.id).response, 'Need a quicker release');
  // other players cannot touch it; parents see their child's status
  const lb = await t.as(t.varsity(`p.positions LIKE '%"LB"%'`)[0].id);
  assert.equal((await lb.post(`/api/assignments/${a.body.id}/progress`, { response: 'x' })).status, 404);
  assert.equal((await lb.get(`/api/assignments/${a.body.id}`)).status, 404);
  assert.equal((await parent.post(`/api/assignments/${a.body.id}/progress`, { response: 'x' })).status, 403);
  const pv = await parent.get(`/api/assignments/${a.body.id}`);
  assert.equal(pv.body.mine[0].status, 'completed');
  assert.ok((await parent.get('/api/assignments')).body.some((x) => x.id === a.body.id && x.player_name === player.user.name));
});

test('checklist progress moves not started -> in progress -> completed', async () => {
  const a = await head.post('/api/assignments', { type: 'complete', title: 'Checklist', checklist: ['Film', 'Hydrate'], due: future(2), audience: [`player:${player.id}`] });
  let r = await player.post(`/api/assignments/${a.body.id}/progress`, { progress: { 0: true } });
  assert.equal(r.body.status, 'in_progress');
  assert.equal((await player.post(`/api/assignments/${a.body.id}/progress`, { done: true })).status, 400);
  r = await player.post(`/api/assignments/${a.body.id}/progress`, { progress: { 1: true } });
  assert.equal(r.body.status, 'completed');
  assert.equal(r.body.late, false);
  const st = t.db.get('SELECT * FROM assignment_status WHERE assignment_id=? AND player_id=?', a.body.id, player.id);
  assert.deepEqual(JSON.parse(st.progress), { 0: true, 1: true });
  assert.ok(st.submitted_at);
});

test('assignment quiz scores across plays', async () => {
  const a = await head.post('/api/assignments', { type: 'quiz', title: 'Play quiz', play_ids: [smash, zone], due: future(1), audience: [`player:${player.id}`] });
  const r = await player.post(`/api/assignments/${a.body.id}/quiz`, { answers: { [smash]: [1, 1], [zone]: [0] } });
  assert.deepEqual(r.body, { score: 2, total: 3 });
  const st = t.db.get('SELECT status, score FROM assignment_status WHERE assignment_id=? AND player_id=?', a.body.id, player.id);
  assert.deepEqual(st, { status: 'completed', score: 67 });
  const lb = await t.as(t.varsity(`p.positions LIKE '%"LB"%'`)[0].id);
  assert.equal((await lb.post(`/api/assignments/${a.body.id}/quiz`, { answers: {} })).status, 404);
});

test('reminders: due-soon players are reminded once; manual nudge; overdue', async () => {
  const a = await head.post('/api/assignments', { type: 'watch', title: 'Reminder film', video_url: 'https://example.com/f', due: addMinutes(nowLocal(), 120), audience: ['pos:QB'] });
  const qbs = t.players(`p.positions LIKE '%"QB"%'`);
  // one QB already finished
  await player.post(`/api/assignments/${a.body.id}/progress`, { done: true });
  t.app.ctx.remindAssignments();
  assert.equal(t.notifications(player.id, 'Due soon: Reminder film').length, 0, 'completed players are not reminded');
  const other = qbs.find((p) => p.id !== player.id);
  assert.equal(t.notifications(other.id, 'Due soon: Reminder film').length, 1);
  assert.equal(t.db.get('SELECT count(*) n FROM assignment_status WHERE assignment_id=? AND reminded_at IS NOT NULL', a.body.id).n, qbs.length - 1);
  t.app.ctx.remindAssignments();
  assert.equal(t.notifications(other.id, 'Due soon: Reminder film').length, 1, 'not repeated');
  // coach nudge sends again to everyone still pending
  assert.equal((await player.post(`/api/assignments/${a.body.id}/remind`)).status, 403);
  const n = await head.post(`/api/assignments/${a.body.id}/remind`);
  assert.equal(n.body.sent, qbs.length - 1);
  assert.equal(t.notifications(other.id, 'Due soon: Reminder film').length, 2);
  // once overdue, one more reminder goes out
  t.db.run('UPDATE assignments SET due=? WHERE id=?', addMinutes(nowLocal(), -30), a.body.id);
  t.db.run('UPDATE assignment_status SET reminded_at=? WHERE assignment_id=?', addMinutes(nowLocal(), -60), a.body.id);
  t.app.ctx.remindAssignments();
  assert.equal(t.notifications(other.id, 'Overdue: Reminder film').length, 1);
});

test('feedback and marks', async () => {
  const a = await head.post('/api/assignments', { type: 'submit', title: 'Feedback me', due: future(3), audience: [`player:${player.id}`] });
  await player.post(`/api/assignments/${a.body.id}/progress`, { response: 'Done', done: true });
  assert.equal((await head.post(`/api/assignments/${a.body.id}/feedback`, { player_id: player.id, mark: 'great' })).status, 400);
  assert.equal((await player.post(`/api/assignments/${a.body.id}/feedback`, { player_id: player.id, feedback: 'x' })).status, 403);
  const other = t.varsity('u.id!=?', player.id)[0];
  assert.equal((await head.post(`/api/assignments/${a.body.id}/feedback`, { player_id: other.id, feedback: 'x' })).status, 404);
  const f = await head.post(`/api/assignments/${a.body.id}/feedback`, { player_id: player.id, feedback: 'Go deeper', mark: 'incomplete' });
  assert.equal(f.status, 200);
  let st = t.db.get('SELECT * FROM assignment_status WHERE assignment_id=? AND player_id=?', a.body.id, player.id);
  assert.equal(st.status, 'in_progress');
  assert.equal(st.feedback, 'Go deeper');
  assert.equal(st.mark, 'incomplete');
  assert.equal(t.notifications(player.id, 'Coach feedback: Feedback me').length, 1);
  await head.post(`/api/assignments/${a.body.id}/feedback`, { player_id: player.id, mark: 'complete', score: 9 });
  st = t.db.get('SELECT * FROM assignment_status WHERE assignment_id=? AND player_id=?', a.body.id, player.id);
  assert.equal(st.feedback, 'Go deeper', 'feedback kept when only marking');
  assert.equal(st.mark, 'complete');
  assert.equal(st.score, 9);
  const mine = (await player.get('/api/assignments')).body.find((x) => x.id === a.body.id);
  assert.equal(mine.feedback, 'Go deeper');
});

test('recurring assignments and templates', async () => {
  const due = future(2);
  const r = await head.post('/api/assignments', { type: 'watch', title: 'Weekly film', video_url: 'https://example.com/w', due, audience: [`team:${V}`], recurring: { freq: 'weekly', count: 3 } });
  assert.equal(r.body.ids.length, 3);
  const rows = r.body.ids.map((id) => t.db.get('SELECT due, parent_id FROM assignments WHERE id=?', id));
  assert.deepEqual(rows.map((x) => x.due), [due, addDays(due, 7), addDays(due, 14)]);
  assert.deepEqual(rows.map((x) => x.parent_id), [null, r.body.ids[0], r.body.ids[0]]);
  const tpl = await head.post('/api/assignments', { type: 'watch', title: 'Film template', video_url: 'https://example.com/t', is_template: true });
  assert.equal(tpl.status, 200);
  assert.ok((await head.get('/api/assignments?templates=1')).body.some((a) => a.id === tpl.body.id));
  assert.ok(!(await head.get('/api/assignments')).body.some((a) => a.id === tpl.body.id));
  const fromTpl = await head.post('/api/assignments', { copy_from: tpl.body.id, title: 'Film from template', due: future(4), audience: ['pos:QB'] });
  const d = await head.get(`/api/assignments/${fromTpl.body.id}`);
  assert.equal(d.body.video_url, 'https://example.com/t');
  assert.equal(d.body.is_template, 0);
  assert.ok(d.body.stats.total >= 1);
});

test('report forms: responses visible only to staff it is shared with', async () => {
  assert.equal((await head.post('/api/forms', { title: 'Empty', questions: [] })).status, 400);
  assert.equal((await head.post('/api/forms', { title: 'Bad choice', questions: [{ type: 'choice', label: 'Pick', options: ['one'] }] })).status, 400);
  const f = await head.post('/api/forms', {
    title: 'Body check', audience: ['pos:QB'], share_with: ['trainer'],
    questions: [{ type: 'scale', label: 'How do you feel?', required: true }, { type: 'text', label: 'Anything else?' }],
  });
  assert.equal(f.status, 200);
  const pf = (await player.get('/api/forms')).body.find((x) => x.id === f.body.id);
  assert.equal(pf.responded, false);
  assert.equal(pf.share_with, undefined);
  assert.equal((await player.post(`/api/forms/${f.body.id}/respond`, { answers: ['', 'x'] })).status, 400);
  assert.equal((await player.post(`/api/forms/${f.body.id}/respond`, { answers: ['4', 'Sore shoulder'] })).status, 200);
  assert.equal((await player.post(`/api/forms/${f.body.id}/respond`, { answers: ['5', 'Better'] })).status, 200, 'resubmitting updates');
  const lb = await t.as(t.varsity(`p.positions LIKE '%"LB"%'`)[0].id);
  assert.equal((await lb.post(`/api/forms/${f.body.id}/respond`, { answers: ['3'] })).status, 404);
  assert.ok(!(await lb.get('/api/forms')).body.some((x) => x.id === f.body.id));

  const tr = await trainer.get(`/api/forms/${f.body.id}/responses`);
  assert.equal(tr.status, 200);
  assert.equal(tr.body.responses.length, 1);
  assert.deepEqual(tr.body.responses[0].answers, ['5', 'Better']);
  assert.ok(tr.body.missing.length >= 1);
  assert.equal((await head.get(`/api/forms/${f.body.id}/responses`)).status, 200);
  assert.equal((await qbc.get(`/api/forms/${f.body.id}/responses`)).status, 403);
  assert.equal((await player.get(`/api/forms/${f.body.id}/responses`)).status, 403);
  assert.equal((await parent.get(`/api/forms/${f.body.id}/responses`)).status, 403);
  const staffList = (await qbc.get('/api/forms')).body.find((x) => x.id === f.body.id);
  assert.equal(staffList.can_see_responses, false);
  assert.equal(staffList.responses, 1);
  // sharing with a specific coach by id
  const shared = await qbc.post('/api/forms', { title: 'QB coach form', audience: ['pos:QB'], share_with: [trainer.id], questions: [{ type: 'yesno', label: 'Ready?' }] });
  assert.equal((await trainer.get(`/api/forms/${shared.body.id}/responses`)).status, 200);
  assert.equal((await qbc.get(`/api/forms/${shared.body.id}/responses`)).status, 200, 'the author always sees responses');
  const dc = await t.as('Defensive coordinator');
  assert.equal((await dc.put(`/api/forms/${shared.body.id}`, { title: 'x' })).status, 403);
  assert.equal((await parent.get('/api/forms')).body.length, 0);
});
