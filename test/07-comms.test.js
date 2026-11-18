import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, NEVER_QUIET, ALWAYS_QUIET, addDays, today } from './helpers.js';

let t; let head; let player; let parent; let ad; let qbc; let V; let teamChat;
before(async () => {
  t = await start();
  head = await t.as('coach@ridgeview.example');
  player = await t.as('player@ridgeview.example');
  parent = await t.as('parent@ridgeview.example');
  ad = await t.as('Athletic director');
  qbc = await t.as('QB coach');
  V = t.teams.Varsity;
  teamChat = t.db.get(`SELECT id FROM chats WHERE name='Varsity team'`).id;
});
after(() => t.close());

const msgs = async (c, chat) => (await c.get(`/api/chats/${chat}/messages`)).body;

test('chat creation adds the audience, covering staff and (optionally) parents', async () => {
  assert.equal((await player.post('/api/chats', { name: 'x', audience: ['pos:QB'] })).status, 403);
  const r = await qbc.post('/api/chats', { name: 'QB room', audience: ['pos:QB'], allow_parents: true });
  assert.equal(r.status, 200);
  const c = await qbc.get(`/api/chats/${r.body.id}`);
  const ids = c.body.members.map((m) => m.id);
  assert.ok(ids.includes(player.id) && ids.includes(qbc.id) && ids.includes(head.id));
  assert.ok(ids.includes(parent.id), 'parents of members join when allowed');
  assert.ok(c.body.adults >= 2);
  assert.ok(!c.body.members.some((m) => 'email' in m || 'phone' in m), 'no contact details in member lists');
  const lb = await t.as(t.varsity(`p.positions LIKE '%"LB"%'`)[0].id);
  assert.equal((await lb.get(`/api/chats/${r.body.id}`)).status, 404);
  assert.equal((await lb.post(`/api/chats/${r.body.id}/messages`, { body: 'hi' })).status, 403);
});

test('two-adult rule: removing the second adult and posting to a one-adult chat are rejected', async () => {
  const r = await head.post('/api/chats', { name: 'One player', audience: [`user:${player.id}`] });
  const members = (await head.get(`/api/chats/${r.body.id}`)).body.members;
  const adults = members.filter((m) => m.role !== 'player' && m.id !== head.id);
  // remove adults until only the head coach is left with the player
  for (const a of adults.slice(0, -1)) assert.equal((await head.del(`/api/chats/${r.body.id}/members/${a.id}`)).status, 200);
  const last = adults[adults.length - 1];
  const no = await head.del(`/api/chats/${r.body.id}/members/${last.id}`);
  assert.equal(no.status, 400);
  assert.match(no.body.error, /Two-adult rule/);
  // a chat that somehow lost its second adult cannot be used
  t.db.run('DELETE FROM chat_members WHERE chat_id=? AND user_id=?', r.body.id, last.id);
  const post = await head.post(`/api/chats/${r.body.id}/messages`, { body: 'Just us' });
  assert.equal(post.status, 400);
  assert.match(post.body.error, /Two-adult rule/);
});

test('players cannot message a coach privately; question threads add a second adult', async () => {
  const q = await player.post('/api/chats/question', { coach_id: qbc.id, text: 'Can I get extra reps?' });
  assert.equal(q.status, 200);
  const c = await player.get(`/api/chats/${q.body.id}`);
  const ids = c.body.members.map((m) => m.id).sort();
  assert.deepEqual(ids, [player.id, qbc.id, t.parentsOf(player.id).sort()[0]].sort());
  assert.equal(c.body.kind, 'question');
  assert.equal(t.notifications(qbc.id, `New question from ${player.user.name}`).length, 1);
  // without an accepted parent, another coach (head coach first) is the second adult
  const lone = t.players().find((p) => p.password_hash && !t.db.get('SELECT 1 FROM parent_links l JOIN users u ON u.id=l.parent_id WHERE l.player_id=? AND u.invite_code IS NULL', p.id));
  const lc = await t.as(lone.id);
  const q2 = await lc.post('/api/chats/question', { coach_id: qbc.id, text: 'Question' });
  const m2 = (await lc.get(`/api/chats/${q2.body.id}`)).body.members.map((m) => m.id).sort();
  assert.deepEqual(m2, [lone.id, qbc.id, head.id].sort());
  // asking the head coach picks a different coach as the second adult
  const q3 = await lc.post('/api/chats/question', { coach_id: head.id, text: 'Question for head' });
  const m3 = (await lc.get(`/api/chats/${q3.body.id}`)).body;
  assert.equal(m3.adults, 2);
  assert.equal((await lc.post('/api/chats/question', { coach_id: qbc.id, text: '  ' })).status, 400);
  assert.equal((await lc.post('/api/chats/question', { coach_id: player.id, text: 'hi' })).status, 404);
  assert.equal((await head.post('/api/chats/question', { coach_id: qbc.id, text: 'hi' })).status, 400);
  // a parent's question includes their player
  const pq = await parent.post('/api/chats/question', { coach_id: qbc.id, text: 'Parent question' });
  const pm = (await parent.get(`/api/chats/${pq.body.id}`)).body.members.map((m) => m.id).sort();
  assert.deepEqual(pm, [parent.id, qbc.id, player.id].sort());
});

test('quiet hours delay staff messages to players; emergencies go through', async () => {
  await t.setSettings(ALWAYS_QUIET);
  const m = await head.post(`/api/chats/${teamChat}/messages`, { body: 'Late night film notes' });
  assert.equal(m.status, 200);
  assert.equal(m.body.delivered, false);
  assert.equal(m.body.deliver_at, `${addDays(today(), 1)}T00:00`);
  assert.ok(!(await msgs(player, teamChat)).some((x) => x.id === m.body.id), 'held until allowed hours');
  const own = (await msgs(head, teamChat)).find((x) => x.id === m.body.id);
  assert.equal(own.pending, true);
  // the in-app notification is held too
  assert.ok(!(await player.get('/api/notifications')).body.some((n) => n.title === `${head.user.name} in Varsity team` && n.body === 'Late night film notes'));
  assert.ok(t.notifications(player.id, `${head.user.name} in Varsity team`).some((n) => n.deliver_at === `${addDays(today(), 1)}T00:00`));

  const e = await head.post(`/api/chats/${teamChat}/messages`, { body: 'Practice cancelled, stay home', emergency: true });
  assert.equal(e.body.delivered, true);
  const seen = (await msgs(player, teamChat)).find((x) => x.id === e.body.id);
  assert.equal(seen.emergency, true);
  assert.ok((await player.get('/api/notifications')).body.some((n) => n.kind === 'urgent' && n.body === 'Practice cancelled, stay home'));

  // players are not held, and cannot send emergencies
  const p = await player.post(`/api/chats/${teamChat}/messages`, { body: 'ok coach', emergency: true });
  assert.equal(p.body.delivered, true);
  assert.equal(t.db.get('SELECT emergency FROM messages WHERE id=?', p.body.id).emergency, 0);
  // staff-only chat is not held
  const staffChat = t.db.get(`SELECT id FROM chats WHERE name='Coaching staff'`).id;
  assert.equal((await head.post(`/api/chats/${staffChat}/messages`, { body: 'Staff note' })).body.delivered, true);

  // announcements follow the same rule
  const a = await head.post('/api/announcements', { title: 'Quiet announcement', body: 'Tomorrow', audience: [`team:${V}`] });
  assert.equal(a.body.delayed, true);
  assert.ok(!(await player.get('/api/announcements')).body.some((x) => x.id === a.body.id));
  const ea = await head.post('/api/announcements', { title: 'Emergency announcement', audience: [`team:${V}`], emergency: true });
  assert.equal(ea.body.delayed, false);
  assert.ok((await player.get('/api/announcements')).body.some((x) => x.id === ea.body.id));
  assert.equal(t.db.get(`SELECT subject FROM outbox WHERE user_id=? AND subject LIKE '%Emergency announcement'`, player.id).subject, '[URGENT] Emergency announcement');
  await t.setSettings(NEVER_QUIET);
  assert.ok((await msgs(player, teamChat)).some((x) => x.id === m.body.id) === false, 'still held until the scheduled time');
});

test('announcements: audience, read receipts, coaches only', async () => {
  assert.equal((await player.post('/api/announcements', { title: 'x', audience: ['program'] })).status, 403);
  assert.equal((await head.post('/api/announcements', { title: 'x', audience: [] })).status, 400);
  const a = await head.post('/api/announcements', { title: 'Jersey pickup', body: 'Friday', audience: [`team:${V}`] });
  assert.ok(a.body.sent > 40);
  const jv = await t.as(t.players('p.team_id=? AND u.password_hash IS NOT NULL', t.teams['JV Red'])[0].id);
  assert.ok(!(await jv.get('/api/announcements')).body.some((x) => x.id === a.body.id));
  const pl = (await player.get('/api/announcements')).body.find((x) => x.id === a.body.id);
  assert.equal(pl.read, false);
  assert.ok((await parent.get('/api/announcements')).body.some((x) => x.id === a.body.id), 'parents of the audience get it');
  await player.post(`/api/announcements/${a.body.id}/read`);
  const reads = await head.get(`/api/announcements/${a.body.id}/reads`);
  assert.ok(reads.body.find((r) => r.id === player.id).opened_at);
  const staffView = (await head.get('/api/announcements')).body.find((x) => x.id === a.body.id);
  assert.equal(staffView.opened, 1);
  assert.equal((await player.get(`/api/announcements/${a.body.id}/reads`)).status, 403);
});

test('sender can remove a message; admins still see the original', async () => {
  const m = await player.post(`/api/chats/${teamChat}/messages`, { body: 'Oops wrong chat' });
  const other = t.varsity('u.id!=?', player.id)[0];
  const oc = await t.as(other.id);
  assert.equal((await oc.del(`/api/messages/${m.body.id}`)).status, 403);
  assert.equal((await head.del(`/api/messages/${m.body.id}`)).status, 403);
  assert.equal((await player.del(`/api/messages/${m.body.id}`)).status, 200);
  const pv = (await msgs(oc, teamChat)).find((x) => x.id === m.body.id);
  assert.equal(pv.removed, true);
  assert.equal(pv.body, undefined);
  const hv = (await msgs(head, teamChat)).find((x) => x.id === m.body.id);
  assert.equal(hv.body, 'Oops wrong chat');
  assert.equal(hv.removed_by_sender, true);
  const adv = (await msgs(ad, teamChat)).find((x) => x.id === m.body.id);
  assert.equal(adv.body, 'Oops wrong chat');
  assert.ok(t.db.get(`SELECT 1 FROM audit WHERE action='read_chat' AND entity_id=? AND user_id=?`, teamChat, ad.id), 'non-member admin reads are audited');
});

test('moderation: report, hide, lock and mute', async () => {
  const m = await player.post(`/api/chats/${teamChat}/messages`, { body: 'This is rude' });
  const other = await t.as(t.varsity('u.id!=?', player.id)[0].id);
  const rep = await other.post(`/api/messages/${m.body.id}/report`, { reason: 'Rude' });
  assert.equal(rep.status, 200);
  assert.ok(t.notifications(head.id, 'A message was reported').length >= 1);
  assert.ok(t.notifications(ad.id, 'A message was reported').length >= 1);
  assert.equal((await player.get('/api/reports')).status, 403);
  const reports = await head.get('/api/reports');
  assert.ok(reports.body.some((r) => r.id === rep.body.id && r.reporter === other.user.name));
  assert.equal((await ad.get('/api/reports')).status, 200);
  assert.equal((await ad.post(`/api/reports/${rep.body.id}/resolve`, {})).status, 403);
  await head.post(`/api/reports/${rep.body.id}/resolve`, { resolution: 'hidden' });
  assert.equal(t.db.get('SELECT resolved FROM message_reports WHERE id=?', rep.body.id).resolved, 1);

  assert.equal((await qbc.post(`/api/messages/${m.body.id}/hide`)).status, 403);
  await head.post(`/api/messages/${m.body.id}/hide`);
  assert.ok(!(await msgs(other, teamChat)).some((x) => x.id === m.body.id));
  assert.equal((await msgs(head, teamChat)).find((x) => x.id === m.body.id).hidden, true);

  assert.equal((await qbc.post(`/api/chats/${teamChat}/lock`)).status, 403);
  await head.post(`/api/chats/${teamChat}/lock`);
  assert.equal((await player.post(`/api/chats/${teamChat}/messages`, { body: 'hello?' })).status, 403);
  assert.equal((await head.post(`/api/chats/${teamChat}/messages`, { body: 'Chat locked for the night' })).status, 200);
  await head.post(`/api/chats/${teamChat}/lock`, { locked: false });

  await head.post(`/api/chats/${teamChat}/members/${player.id}/mute`);
  const muted = await player.post(`/api/chats/${teamChat}/messages`, { body: 'hello?' });
  assert.equal(muted.status, 403);
  assert.match(muted.body.error, /muted/);
  await head.post(`/api/chats/${teamChat}/members/${player.id}/mute`, { muted: false });
  assert.equal((await player.post(`/api/chats/${teamChat}/messages`, { body: 'thanks' })).status, 200);
});

test('risky language is flagged automatically', async () => {
  const m = await player.post(`/api/chats/${teamChat}/messages`, { body: "Don't tell your parents, meet me alone" });
  assert.equal(m.body.flagged, true);
  const reports = await head.get('/api/reports');
  assert.ok(reports.body.some((r) => r.message_id === m.body.id && r.reason.startsWith('Automatic flag')));
  assert.equal((await msgs(head, teamChat)).find((x) => x.id === m.body.id).flagged, true);
  assert.equal((await msgs(player, teamChat)).find((x) => x.id === m.body.id).flagged, undefined, 'only admins see flags');
  const clean = await player.post(`/api/chats/${teamChat}/messages`, { body: 'Great practice' });
  assert.equal(clean.body.flagged, false);
});

test('parent contact block: request, head coach applies, AD notified, messages hidden', async () => {
  const room = (await t.db.all(`SELECT id FROM chats WHERE name='QB room'`))[0].id;
  assert.equal((await player.post('/api/contact-blocks', { player_id: player.id, coach_id: qbc.id })).status, 403);
  const otherKid = t.varsity('u.id!=?', player.id)[0];
  assert.equal((await parent.post('/api/contact-blocks', { player_id: otherKid.id, coach_id: qbc.id })).status, 403);
  const r = await parent.post('/api/contact-blocks', { player_id: player.id, coach_id: qbc.id, reason: 'Personal' });
  assert.equal(r.status, 200);
  assert.ok(t.notifications(head.id, 'Contact block requested').length === 1);
  assert.equal((await qbc.post(`/api/contact-blocks/${r.body.id}/apply`)).status, 403);
  const before = await qbc.post(`/api/chats/${room}/messages`, { body: 'Before the block' });
  const ap = await head.post(`/api/contact-blocks/${r.body.id}/apply`, {});
  assert.equal(ap.status, 200);
  assert.equal(ap.body.notified_ad, 1);
  assert.equal(t.notifications(ad.id, 'Contact block applied').length, 1);
  assert.equal(t.notifications(parent.id, 'Contact block applied').length, 1);
  const list = await parent.get('/api/contact-blocks');
  assert.equal(list.body[0].status, 'applied');
  assert.equal((await qbc.get('/api/contact-blocks')).body.length, 0);

  const notesBefore = t.notifications(player.id, `${qbc.user.name} in QB room`).length;
  const after = await qbc.post(`/api/chats/${room}/messages`, { body: 'After the block' });
  assert.equal(t.notifications(player.id, `${qbc.user.name} in QB room`).length, notesBefore, 'blocked player is not notified');
  const pv = await msgs(player, room);
  assert.ok(!pv.some((x) => x.id === after.body.id || x.id === before.body.id));
  assert.ok(!(await msgs(parent, room)).some((x) => x.id === after.body.id));
  assert.ok((await msgs(head, room)).some((x) => x.id === after.body.id));
  // nor does the chat list leak it as the last-message preview or count it as unread
  const preview = (await player.get('/api/chats')).body.find((c) => c.id === room);
  assert.notEqual(preview.last?.body, 'After the block');
  assert.equal(preview.unread, 0);
  assert.equal((await head.get('/api/chats')).body.find((c) => c.id === room).last.body, 'After the block');
  // announcements from the blocked coach skip the player
  const a = await qbc.post('/api/announcements', { title: 'QB meeting', audience: ['pos:QB'] });
  assert.equal(t.db.get('SELECT count(*) n FROM notifications WHERE ref=? AND user_id=?', `ann:${a.body.id}`, player.id).n, 0);
});

test('contact details are never exposed to members', async () => {
  const dir = await player.get('/api/directory');
  assert.ok(dir.body.length > 10);
  assert.ok(dir.body.every((u) => Object.keys(u).sort().join() === 'id,name,role,title'));
  const list = await player.get('/api/chats');
  assert.ok(list.body.length >= 2);
  for (const c of list.body) assert.equal(c.member, true);
  const m = await msgs(player, teamChat);
  assert.ok(m.every((x) => !('email' in x) && !('phone' in x)));
  assert.equal((await player.get('/api/chats?all=1')).body.length, list.body.length, 'all=1 needs admin');
  assert.ok((await ad.get('/api/chats?all=1')).body.length > (await ad.get('/api/chats')).body.length);
});

test('polls and reactions', async () => {
  assert.equal((await player.post(`/api/chats/${teamChat}/messages`, { poll: { question: 'Pizza?', options: ['Yes', 'No'] } })).status, 400);
  const p = await head.post(`/api/chats/${teamChat}/messages`, { poll: { question: 'Team meal?', options: ['Pizza', 'Tacos'] } });
  assert.equal((await player.post(`/api/messages/${p.body.id}/vote`, { option: 5 })).status, 400);
  await player.post(`/api/messages/${p.body.id}/vote`, { option: 1 });
  await player.post(`/api/messages/${p.body.id}/react`, { emoji: '🏈' });
  assert.equal((await player.post(`/api/messages/${p.body.id}/react`, { emoji: '💩' })).status, 400);
  const m = (await msgs(player, teamChat)).find((x) => x.id === p.body.id);
  assert.equal(m.poll.options[1].votes, 1);
  assert.equal(m.poll.my_vote, 1);
  assert.equal(m.reactions[0].emoji, '🏈');
  await player.post(`/api/messages/${p.body.id}/react`, { emoji: '🏈' });
  assert.equal((await msgs(player, teamChat)).find((x) => x.id === p.body.id).reactions.length, 0, 'reacting again toggles off');
});

test('attachments obey the chat file setting', async () => {
  const ok = await player.post(`/api/chats/${teamChat}/messages`, { attachment: 'data:image/png;base64,AAAA' });
  assert.equal(ok.status, 200);
  assert.equal((await player.post(`/api/chats/${teamChat}/messages`, { attachment: 'http://x.example/a.png' })).status, 400);
  await t.setSettings({ chat_files: false });
  assert.equal((await player.post(`/api/chats/${teamChat}/messages`, { attachment: 'data:image/png;base64,AAAA' })).status, 403);
  await t.setSettings({ chat_files: true });
  assert.equal((await player.post(`/api/chats/${teamChat}/messages`, { body: ' ' })).status, 400);
});
