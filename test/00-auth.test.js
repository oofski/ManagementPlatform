import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';

let t;
before(async () => { t = await start(); });
after(() => t.close());

const codeFor = (userId) => {
  const row = t.db.get(`SELECT body FROM outbox WHERE user_id=? AND subject='Your sign-in code' ORDER BY id DESC LIMIT 1`, userId);
  return row.body.match(/(\d{6})/)[1];
};

test('unauthenticated API calls are rejected', async () => {
  const r = await t.anon.get('/api/me');
  assert.equal(r.status, 401);
});

test('password sign-in: wrong password is rejected', async () => {
  const r = await t.anon.post('/api/auth/login', { email: 'coach@ridgeview.example', password: 'nope' });
  assert.equal(r.status, 401);
});

test('staff sign-in requires the two-step code from the email outbox', async () => {
  const r = await t.anon.post('/api/auth/login', { email: 'COACH@ridgeview.example', password: 'password123' });
  assert.equal(r.status, 200);
  assert.equal(r.body.twofa, true);
  const c = t.client(r.body.token);
  const blocked = await c.get('/api/me');
  assert.equal(blocked.status, 401);
  assert.equal(blocked.body.twofa, true);
  const head = t.user('coach@ridgeview.example');
  const bad = await c.post('/api/auth/verify', { code: '000000x' });
  assert.equal(bad.status, 400);
  const ok = await c.post('/api/auth/verify', { code: codeFor(head.id) });
  assert.equal(ok.status, 200);
  const me = await c.get('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role, 'head_coach');
  assert.equal(me.body.caps.admin, true);
  assert.equal(me.body.user.password_hash, undefined);
  // logout ends the session
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/me')).status, 401);
});

test('players sign in without a second step', async () => {
  const r = await t.anon.post('/api/auth/login', { email: 'player@ridgeview.example', password: 'password123' });
  assert.equal(r.status, 200);
  assert.equal(r.body.twofa, false);
  const me = await t.client(r.body.token).get('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role, 'player');
  assert.equal(me.body.caps.staff, false);
  assert.ok(me.body.parents.length >= 1);
});

test('staff invites: head coach invites, invitee accepts once, staff accounts get two-step', async () => {
  const head = await t.as('coach@ridgeview.example');
  const inv = await head.post('/api/staff', { name: 'New Coach', email: 'new.coach@ridgeview.example', role: 'coach', title: 'TE coach', scopes: ['pos:TE'] });
  assert.equal(inv.status, 200);
  assert.ok(inv.body.invite_code);
  assert.ok(t.db.get(`SELECT 1 FROM outbox WHERE to_email='new.coach@ridgeview.example'`), 'invite email queued');
  const dup = await head.post('/api/staff', { name: 'Again', email: 'new.coach@ridgeview.example', role: 'coach' });
  assert.equal(dup.status, 400);
  const badRole = await head.post('/api/staff', { name: 'X', email: 'x@ridgeview.example', role: 'player' });
  assert.equal(badRole.status, 400);

  const info = await t.anon.get(`/api/invite/${inv.body.invite_code}`);
  assert.equal(info.status, 200);
  assert.equal(info.body.role, 'coach');
  const short = await t.anon.post(`/api/invite/${inv.body.invite_code}/accept`, { password: 'short' });
  assert.equal(short.status, 400);
  const acc = await t.anon.post(`/api/invite/${inv.body.invite_code}/accept`, { password: 'longenough1' });
  assert.equal(acc.status, 200);
  assert.equal(acc.body.twofa, true);
  const again = await t.anon.post(`/api/invite/${inv.body.invite_code}/accept`, { password: 'longenough1' });
  assert.equal(again.status, 404);
  const login = await t.anon.post('/api/auth/login', { email: 'new.coach@ridgeview.example', password: 'longenough1' });
  assert.equal(login.status, 200);
  const staff = await head.get('/api/staff');
  const row = staff.body.find((s) => s.email === 'new.coach@ridgeview.example');
  assert.deepEqual(row.scopes, ['pos:TE']);
});

test('players invite at most two parents; parents accept without two-step', async () => {
  const pl = t.players().find((p) => t.parentsOf(p.id).length === 0 && p.password_hash);
  const c = await t.as(pl.id);
  const a = await c.post('/api/me/parents', { name: 'Parent One', email: 'p1.test@family.example' });
  assert.equal(a.status, 200);
  assert.ok(a.body.invite_code);
  const b = await c.post('/api/me/parents', { name: 'Parent Two', email: 'p2.test@family.example', relation: 'Guardian' });
  assert.equal(b.status, 200);
  const third = await c.post('/api/me/parents', { name: 'Parent Three', email: 'p3.test@family.example' });
  assert.equal(third.status, 400);
  assert.match(third.body.error, /at most 2/);
  const acc = await t.anon.post(`/api/invite/${a.body.invite_code}/accept`, { password: 'parentpass1' });
  assert.equal(acc.status, 200);
  assert.equal(acc.body.twofa, false);
  const me = await t.client(acc.body.token).get('/api/me');
  assert.equal(me.body.user.role, 'parent');
  assert.deepEqual(me.body.linked.map((x) => x.id), [pl.id]);
});

test('player cannot invite a parent using a staff email; staff cannot invite parents', async () => {
  const pl = t.players().find((p) => t.parentsOf(p.id).length === 0 && !t.db.get('SELECT 1 FROM parent_links WHERE player_id=?', p.id) && p.email !== null && p.id !== t.user('player@ridgeview.example').id);
  const c = await t.as(pl.id);
  const r = await c.post('/api/me/parents', { name: 'Sneaky', email: 'coach@ridgeview.example' });
  assert.equal(r.status, 400);
  const dc = await t.as('Defensive coordinator');
  assert.equal((await dc.post('/api/me/parents', { name: 'x', email: 'y@z.example' })).status, 403);
});

test('staff management and program settings are head-coach (admin) only', async () => {
  const dc = await t.as('Defensive coordinator');
  const head = await t.as('coach@ridgeview.example');
  assert.equal((await dc.post('/api/staff', { name: 'X', email: 'xx@ridgeview.example', role: 'coach' })).status, 403);
  const qb = t.user('QB coach');
  assert.equal((await dc.put(`/api/staff/${qb.id}`, { title: 'Hacked' })).status, 403);
  assert.equal((await dc.del(`/api/staff/${qb.id}`)).status, 403);
  assert.equal((await dc.put('/api/program', { settings: { leaderboard: false } })).status, 403);

  const upd = await head.put(`/api/staff/${qb.id}`, { scopes: ['pos:QB', 'pos:RB'], title: 'QB/RB coach' });
  assert.equal(upd.status, 200);
  assert.deepEqual(t.db.all('SELECT scope FROM staff_scopes WHERE user_id=? ORDER BY scope', qb.id).map((r) => r.scope), ['pos:QB', 'pos:RB']);

  // non-admin staff see colleagues without contact details; players see names only
  const list = await dc.get('/api/staff');
  assert.equal(list.status, 200);
  assert.ok(list.body.every((s) => s.email === undefined && s.phone === undefined));
  const pl = await t.as('player@ridgeview.example');
  const plist = await pl.get('/api/staff');
  assert.deepEqual(Object.keys(plist.body[0]).sort(), ['id', 'name', 'role', 'title']);

  // removing a staff member deactivates them and ends their sessions
  const vol = await t.as('Team manager (volunteer)');
  assert.equal((await vol.get('/api/me')).status, 200);
  assert.equal((await head.del(`/api/staff/${vol.id}`)).status, 200);
  assert.equal((await vol.get('/api/me')).status, 401);
  assert.equal((await head.del(`/api/staff/${head.id}`)).status, 400);
});

test('program settings update is persisted and audited', async () => {
  const head = await t.as('coach@ridgeview.example');
  const r = await head.put('/api/program', { settings: { absence_alert_threshold: 5, not_a_setting: 1 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.absence_alert_threshold, 5);
  assert.equal(r.body.settings.not_a_setting, undefined);
  const g = await head.get('/api/program');
  assert.equal(g.body.settings.absence_alert_threshold, 5);
  const pl = await t.as('player@ridgeview.example');
  assert.equal((await pl.get('/api/program')).status, 403);
});

test('audit log is visible to admins and the athletic director only', async () => {
  const head = await t.as('coach@ridgeview.example');
  const ad = await t.as('Athletic director');
  const dc = await t.as('Defensive coordinator');
  const pl = await t.as('player@ridgeview.example');
  const h = await head.get('/api/audit?action=update_settings');
  assert.equal(h.status, 200);
  assert.ok(h.body.length >= 1);
  assert.ok(h.body.every((a) => a.action.includes('update_settings')));
  assert.equal((await ad.get('/api/audit')).status, 200);
  assert.equal((await dc.get('/api/audit')).status, 403);
  assert.equal((await pl.get('/api/audit')).status, 403);
});

test('custom groups are managed by coaches and usable as audiences', async () => {
  const dc = await t.as('Defensive coordinator');
  const pl = await t.as('player@ridgeview.example');
  const ids = t.varsity().slice(0, 3).map((p) => p.id);
  assert.equal((await pl.post('/api/groups', { name: 'Nope' })).status, 403);
  const g = await dc.post('/api/groups', { name: 'Scout team', members: ids });
  assert.equal(g.status, 200);
  const res = await dc.post('/api/audiences/resolve', { audience: [`group:${g.body.id}`] });
  assert.equal(res.body.players, 3);
  assert.deepEqual(res.body.labels, ['Scout team']);
  const aud = await dc.get('/api/audiences');
  assert.ok(aud.body.some((a) => a.token === `group:${g.body.id}`));
  const paud = await pl.get('/api/audiences');
  assert.ok(!paud.body.some((a) => a.kind === 'Player'), 'players do not get the roster in the audience picker');
});

test('notifications: list, open and open-all', async () => {
  const pl = await t.as('player@ridgeview.example');
  await pl.post('/api/notifications/test');
  const list = await pl.get('/api/notifications');
  const n = list.body.find((x) => x.title === 'Test notification');
  assert.ok(n);
  await pl.post(`/api/notifications/${n.id}/open`);
  assert.ok(t.db.get('SELECT opened_at FROM notifications WHERE id=?', n.id).opened_at);
  await pl.post('/api/notifications/open-all');
  assert.equal((await pl.get('/api/me')).body.unread, 0);
});

test('two-step verification: five wrong codes end the session', async () => {
  const r = await t.anon.post('/api/auth/login', { email: 'coach@ridgeview.example', password: 'password123' });
  assert.equal(r.body.twofa, true);
  const c = t.client(r.body.token);
  for (let i = 0; i < 4; i++) assert.equal((await c.post('/api/auth/verify', { code: 'wrong' })).status, 400);
  const last = await c.post('/api/auth/verify', { code: 'wrong' });
  assert.equal(last.status, 401);
  assert.ok(!t.db.get('SELECT 1 FROM sessions WHERE id=?', r.body.token), 'session deleted');
  // even the right code no longer works on that session
  assert.equal((await c.post('/api/auth/verify', { code: codeFor(t.user('coach@ridgeview.example').id) })).status, 401);
});

test('an archived player session is rejected even if it still exists', async () => {
  const p = t.players()[5];
  const c = await t.as(p.id);
  assert.equal((await c.get('/api/me')).status, 200);
  t.db.run('UPDATE player_profiles SET archived=1 WHERE user_id=?', p.id); // e.g. archived without session clean-up
  assert.equal((await c.get('/api/me')).status, 401);
  t.db.run('UPDATE player_profiles SET archived=0 WHERE user_id=?', p.id);
});
