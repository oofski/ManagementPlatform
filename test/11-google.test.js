// Google Workspace integration: OAuth connect with state check, encrypted tokens, the email parser,
// Gmail scan -> drafts -> approve, dedupe, outbox delivery through Gmail, Calendar push/import, Sheets, Docs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { start, today, addDays } from './helpers.js';
import { parseEmail } from '../server/google/parser.js';

// ---------- fake Google ----------
const REFRESH = '1//fake-refresh-SECRET-7f3a';
const fake = {
  grantScope: '', access: new Set(), n: 0, tokenCalls: [], revoked: [], sent: [], modified: [], queries: [],
  labels: [{ id: 'Label_1', name: 'Team Calendar', type: 'user' }, { id: 'INBOX', name: 'INBOX', type: 'system' }],
  messages: {}, calendars: { primary: {}, 'team@group.calendar.google.com': {} }, sheets: {}, created: {}, uploads: [],
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const spoken = (d) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8))}`;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
function addMessage(id, { subject, body, labels = ['Label_1'], html = false }) {
  fake.messages[id] = {
    id, threadId: id, labelIds: labels, snippet: body.slice(0, 80), internalDate: String(Date.now()),
    payload: { mimeType: 'multipart/alternative', headers: [{ name: 'Subject', value: subject }, { name: 'From', value: 'AD <ad@school.example>' }],
      parts: [{ mimeType: html ? 'text/html' : 'text/plain', body: { data: b64(body) } }] },
  };
}
const jwt = (o) => `x.${Buffer.from(JSON.stringify(o)).toString('base64url')}.sig`;

function fakeHandler(req, res) {
  const url = new URL(req.url, 'http://x');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const p = url.pathname;
    if (p === '/token') {
      const f = Object.fromEntries(new URLSearchParams(raw));
      fake.tokenCalls.push(f.grant_type);
      if (f.client_id !== 'test-client' || f.client_secret !== 'test-secret') return send(401, { error: 'invalid_client' });
      if (f.grant_type === 'authorization_code') {
        if (f.code !== 'good-code' || f.redirect_uri !== 'https://pm.example.com/api/google/callback') return send(400, { error: 'invalid_grant' });
        const at = `ya29.fake-access-${++fake.n}`; fake.access.add(at);
        return send(200, { access_token: at, refresh_token: REFRESH, expires_in: 3600, scope: fake.grantScope, token_type: 'Bearer', id_token: jwt({ email: 'headcoach@gmail.example' }) });
      }
      if (f.grant_type === 'refresh_token') {
        if (f.refresh_token !== REFRESH || fake.revoked.includes(REFRESH)) return send(400, { error: 'invalid_grant' });
        const at = `ya29.fake-access-${++fake.n}`; fake.access.add(at);
        return send(200, { access_token: at, expires_in: 3600, scope: fake.grantScope, token_type: 'Bearer' });
      }
      return send(400, { error: 'unsupported_grant_type' });
    }
    if (p === '/revoke') { fake.revoked.push(Object.fromEntries(new URLSearchParams(raw)).token); return send(200, {}); }
    const auth = (req.headers.authorization || '').replace('Bearer ', '');
    if (!fake.access.has(auth)) return send(401, { error: { message: 'Invalid Credentials' } });
    const body = raw && (req.headers['content-type'] || '').includes('json') ? JSON.parse(raw) : null;
    let m;
    // Gmail
    if (p === '/gmail/v1/users/me/labels') {
      if (req.method === 'POST') { const l = { id: `Label_${fake.labels.length + 1}`, name: body.name, type: 'user' }; fake.labels.push(l); return send(200, l); }
      return send(200, { labels: fake.labels });
    }
    if (p === '/gmail/v1/users/me/messages' && req.method === 'GET') {
      fake.queries.push(Object.fromEntries(url.searchParams));
      const lid = url.searchParams.get('labelIds');
      const list = Object.values(fake.messages).filter((x) => !lid || x.labelIds.includes(lid));
      return send(200, { messages: list.map((x) => ({ id: x.id, threadId: x.threadId })), resultSizeEstimate: list.length });
    }
    if (p === '/gmail/v1/users/me/messages/send') { fake.sent.push(body.raw); return send(200, { id: `sent-${fake.sent.length}` }); }
    if ((m = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)\/modify$/.exec(p))) { fake.modified.push({ id: m[1], ...body }); return send(200, { id: m[1] }); }
    if ((m = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(p))) return fake.messages[m[1]] ? send(200, fake.messages[m[1]]) : send(404, { error: { message: 'Not Found' } });
    // Calendar
    if (p === '/calendar/v3/users/me/calendarList') return send(200, { items: [{ id: 'primary', summary: 'Coach', primary: true, accessRole: 'owner' }, { id: 'team@group.calendar.google.com', summary: 'Team', accessRole: 'writer' }] });
    if ((m = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(p))) {
      const cal = fake.calendars[decodeURIComponent(m[1])];
      if (!cal) return send(404, { error: { message: 'Not Found' } });
      const eid = m[2] && decodeURIComponent(m[2]);
      if (req.method === 'GET') return send(200, { items: Object.values(cal) });
      if (req.method === 'POST') { const id = `g${Object.keys(fake.created).length + 1}x${Math.random().toString(36).slice(2, 6)}`; cal[id] = { ...body, id }; fake.created[id] = true; return send(200, cal[id]); }
      if (!cal[eid]) return send(404, { error: { message: 'Not Found' } });
      if (req.method === 'PUT') { cal[eid] = { ...body, id: eid }; return send(200, cal[eid]); }
      if (req.method === 'DELETE') { delete cal[eid]; res.writeHead(204); return res.end(); }
    }
    // Sheets
    if (p === '/v4/spreadsheets' && req.method === 'POST') {
      const id = `new-sheet-${Object.keys(fake.sheets).length + 1}`;
      fake.sheets[id] = { title: body.properties.title, values: null };
      return send(200, { spreadsheetId: id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit` });
    }
    if ((m = /^\/v4\/spreadsheets\/([^/]+)\/values\/(.+)$/.exec(p))) {
      const s = fake.sheets[decodeURIComponent(m[1])];
      if (!s) return send(404, { error: { message: 'Requested entity was not found.' } });
      if (req.method === 'PUT') { s.values = body.values; return send(200, { updatedRows: body.values.length }); }
      return send(200, { range: decodeURIComponent(m[2]), values: s.values });
    }
    // Drive upload (HTML converted to a Google Doc)
    if (p === '/upload/drive/v3/files' && req.method === 'POST') {
      const id = `doc-${fake.uploads.length + 1}`;
      fake.uploads.push({ id, type: req.headers['content-type'], raw });
      return send(200, { id, name: 'doc', webViewLink: `https://docs.google.com/document/d/${id}/edit` });
    }
    return send(404, { error: { message: `fake: no route ${req.method} ${p}` } });
  });
}

let t; let head; let player; let trainer; let dc; let fakeServer;
const ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APP_URL', 'GOOGLE_AUTH_URL', 'GOOGLE_TOKEN_URL', 'GOOGLE_API_BASE', 'TOKEN_KEY'];
before(async () => {
  fakeServer = http.createServer(fakeHandler);
  await new Promise((r) => fakeServer.listen(0, '127.0.0.1', r));
  const g = `http://127.0.0.1:${fakeServer.address().port}`;
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', APP_URL: 'https://pm.example.com',
    GOOGLE_AUTH_URL: `${g}/auth`, GOOGLE_TOKEN_URL: `${g}/token`, GOOGLE_API_BASE: g, TOKEN_KEY: 'test-token-key-0123456789',
  });
  t = await start();
  head = await t.as('coach@ridgeview.example');
  player = await t.as('player@ridgeview.example');
  trainer = await t.as('Athletic trainer');
  dc = await t.as('Defensive coordinator');
});
after(() => { t.close(); fakeServer.close(); for (const k of ENV) delete process.env[k]; });

const ALL = ['gmail', 'calendar', 'sheets', 'docs'];
async function connect(client, features = ALL, scope) {
  const r = await client.post('/api/google/connect', { features });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const u = new URL(r.body.url);
  fake.grantScope = scope ?? u.searchParams.get('scope');
  const cb = await client.get(`/api/google/callback?code=good-code&state=${encodeURIComponent(u.searchParams.get('state'))}`);
  return { url: u, cb };
}

// ---------- parser ----------
const REF = '2026-11-18T09:00'; // a Wednesday
const one = (subject, body = '') => { const d = parseEmail({ subject, body, receivedAt: REF }); assert.equal(d.length, 1, JSON.stringify(d)); return d[0]; };

test('parser: explicit dates in several formats', () => {
  assert.equal(one('Game Friday Nov 20 7pm').start, '2026-11-20T19:00');
  assert.equal(one('Banquet', 'The banquet is November 21st at 6:30 PM.').start, '2026-11-21T18:30');
  assert.equal(one('Practice 11/21 3:30-5:30').start, '2026-11-21T15:30');
  assert.equal(one('Lift 12/2/2026 6:30am').start, '2026-12-02T06:30');
  assert.equal(one('Camp 2027-06-14 9:00 AM').start, '2027-06-14T09:00');
  assert.equal(one('Awards 21 November 7:00 PM').start, '2026-11-21T19:00');
  // No year: dates long past roll to next year, recent ones stay.
  assert.equal(one('Spring game Apr 3 noon').start, '2027-04-03T12:00');
  assert.equal(one('Recap of Nov 2 meeting at 7:00 PM').start, '2026-11-02T19:00');
  // A weekday that does not match the date is flagged and lowers confidence.
  const bad = one('Game Thursday Nov 20 7pm');
  assert.ok(bad.notes.some((n) => /does not match/.test(n)));
  assert.ok(bad.confidence < one('Game Friday Nov 20 7pm').confidence);
});

test('parser: relative dates and weekdays mean the next occurrence', () => {
  assert.equal(one('Practice tomorrow 3:30pm').start, '2026-11-19T15:30');
  assert.equal(one('Film today 3pm').start, '2026-11-18T15:00');
  assert.equal(one('Walkthrough tonight at 6:00 PM').start, '2026-11-18T18:00');
  assert.equal(one('Film Thursday 3pm').start, '2026-11-19T15:00');
  assert.equal(one('Lift Monday 6:30am').start, '2026-11-23T06:30');
  assert.equal(one('Meeting Wednesday 7pm').start, '2026-11-18T19:00', 'same weekday is that day');
  assert.equal(one('Meeting next Wednesday 7pm').start, '2026-11-25T19:00');
  assert.equal(one('Lift Sat 8am').start, '2026-11-21T08:00');
  // Lowercase abbreviations are ordinary words, not weekdays.
  assert.deepEqual(parseEmail({ subject: 'We sat down', body: 'Nothing scheduled.', receivedAt: REF }), []);
});

test('parser: times, ranges and am/pm inference', () => {
  const r = one('Practice 11/21 3:30-5:30');
  assert.equal(r.end, '2026-11-21T17:30');
  assert.ok(r.notes.some((n) => /Assumed PM/.test(n)));
  assert.equal(one('Lift 11/21 6-7:30am').start, '2026-11-21T06:00');
  assert.equal(one('Lift 11/21 6-7:30am').end, '2026-11-21T07:30');
  const x = one('Clinic 11/21 11-1pm');
  assert.equal(x.start, '2026-11-21T11:00'); assert.equal(x.end, '2026-11-21T13:00');
  assert.equal(one('Game 11/20 7:00 PM').start, '2026-11-20T19:00');
  assert.equal(one('Game 11/20', 'Kickoff at 7').start, '2026-11-20T19:00', 'bare hour after kickoff, PM for games');
  assert.equal(one('Practice 11/21 4:00 to 6:00 p.m.').end, '2026-11-21T18:00');
  assert.equal(one('Film 11/21 noon').start, '2026-11-21T12:00');
  const none = one('Practice Friday');
  assert.equal(none.start, '2026-11-20T15:30');
  assert.ok(none.notes.some((n) => /No time found/.test(n)));
  assert.ok(none.confidence < 0.6);
  // Scores and counts are not times.
  assert.equal(one('Game recap 11/20', 'We won 21-14 with 3-5 players out.').notes.some((n) => /No time found/.test(n)), true);
});

test('parser: locations, titles, types and opponents', () => {
  const g = one('Varsity vs Lincoln Friday Nov 20 7pm', 'Location: Ridgeview Stadium\nBus leaves at 4:30 PM. Report 5:15pm.');
  assert.equal(g.type, 'game');
  assert.equal(g.title, 'Varsity vs Lincoln');
  assert.equal(g.location, 'Ridgeview Stadium');
  assert.deepEqual(g.details, { bus_departure: '16:30', report_time: '17:15', kickoff: '19:00', opponent: 'Lincoln', home_away: 'home' });
  assert.deepEqual(g.groups, ['varsity']);
  assert.ok(g.confidence >= 0.8);
  assert.match(g.snippet, /Varsity vs Lincoln/);
  const away = one('JV game @ Central High Sat 11/21 10am');
  assert.equal(away.type, 'game');
  assert.equal(away.details.opponent, 'Central High');
  assert.equal(away.details.home_away, 'away');
  assert.equal(away.location, 'Central High');
  assert.deepEqual(away.groups, ['jv']);
  assert.equal(one('Practice tomorrow', 'We will be at the Field House from 3:30-5:30.').location, 'Field House');
  assert.equal(one('Film Thursday 3pm @ Film Room').location, 'Film Room');
  assert.equal(one('Re: Fwd: Parent meeting next Wednesday', 'Meet at 7 in the cafeteria. Where: Ridgeview Cafeteria').location, 'Ridgeview Cafeteria');
  assert.equal(one('Re: Fwd: Parent meeting next Wednesday').title, 'Parent meeting');
  assert.equal(one('Practice moved to Friday Nov 20 at 3:30').title, 'Practice moved');
  assert.equal(one('Team banquet Nov 21 6pm').type, 'social');
  assert.equal(one('Film session Thursday 3pm').type, 'film');
  assert.equal(one('Morning lift Monday 6am').type, 'lift');
  assert.equal(one('Booster club meeting 11/24 7pm').type, 'meeting');
  assert.equal(one('Practice 11/24 3:30-5:30').type, 'practice');
  assert.equal(one('Reminder 11/24 5pm').type, 'other');
  assert.equal(one('Meeting 11/24 6pm', 'Contact me@coach.example for details').location, null, 'email addresses are not places');
});

test('parser: one draft per date in a schedule email, none without a date', () => {
  const d = parseEmail({
    subject: 'Next week', receivedAt: REF,
    body: 'Here is the plan:\n- 11/24 Lift 6:30-7:30am at Weight Room\n- 11/25 Practice 3:30-5:30\n- 11/28 Game @ Central High 7pm\n\nThanks, Coach\n\nOn Tue, Nov 17, 2026 at 8:00 AM AD wrote:\n> Old date 12/12 9am',
  });
  assert.equal(d.length, 3, 'quoted reply is ignored');
  assert.deepEqual(d.map((x) => [x.type, x.start, x.end]), [['lift', '2026-11-24T06:30', '2026-11-24T07:30'], ['practice', '2026-11-25T15:30', '2026-11-25T17:30'], ['game', '2026-11-28T19:00', null]]);
  assert.equal(d[0].location, 'Weight Room');
  assert.equal(d[0].title, 'Lift');
  assert.equal(d[2].details.opponent, 'Central High');
  assert.ok(d.every((x) => x.snippet && x.confidence > 0 && x.confidence <= 1));
  assert.deepEqual(parseEmail({ subject: 'Lunch?', body: 'Want to grab lunch sometime?', receivedAt: REF }), []);
  // A repeated mention of the same date is one event.
  assert.equal(parseEmail({ subject: 'Game Friday Nov 20 7pm', body: 'See you Friday!', receivedAt: REF }).length, 1);
});

// ---------- not configured ----------
test('every endpoint explains which env vars to set when Google is not configured', async () => {
  const saved = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  try {
    const s = await head.get('/api/google/status');
    assert.equal(s.status, 200);
    assert.equal(s.body.configured, false);
    assert.deepEqual(s.body.missing, ['GOOGLE_CLIENT_ID']);
    assert.match(s.body.message, /GOOGLE_CLIENT_ID/);
    for (const [m, p] of [['post', '/api/google/connect'], ['post', '/api/google/gmail/scan'], ['get', '/api/google/gmail/labels'], ['post', '/api/google/calendar/push'], ['post', '/api/google/sheets/export'], ['post', '/api/google/docs/practice-plan']]) {
      const r = await head[m](p, m === 'get' ? undefined : {});
      assert.equal(r.status, 503, p);
      assert.match(r.body.error, /GOOGLE_CLIENT_ID/, p);
    }
  } finally { process.env.GOOGLE_CLIENT_ID = saved; }
});

// ---------- OAuth ----------
test('connect flow: scopes per feature, state bound to the session, staff only', async () => {
  assert.equal((await player.post('/api/google/connect', { features: ['gmail'] })).status, 403);
  assert.equal((await player.get('/api/google/status')).status, 403);
  assert.equal((await head.post('/api/google/connect', { features: [] })).status, 400);
  // Only the scopes for the picked features are requested.
  const g = await head.post('/api/google/connect', { features: ['calendar'] });
  const gu = new URL(g.body.url);
  assert.equal(gu.searchParams.get('scope'), 'openid email https://www.googleapis.com/auth/calendar');
  assert.equal(gu.searchParams.get('access_type'), 'offline');
  assert.equal(gu.searchParams.get('prompt'), 'consent');
  assert.equal(gu.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(gu.searchParams.get('redirect_uri'), 'https://pm.example.com/api/google/callback');
  assert.equal(gu.searchParams.get('client_id'), 'test-client');

  const r = await head.post('/api/google/connect', { features: ALL });
  const u = new URL(r.body.url);
  for (const s of ['gmail.readonly', 'gmail.send', 'gmail.modify', 'auth/calendar', 'spreadsheets', 'drive.file', 'documents']) assert.ok(u.searchParams.get('scope').includes(s), s);
  const state = u.searchParams.get('state');
  fake.grantScope = u.searchParams.get('scope');
  // Wrong state, someone else's state, another session's state, and no session are all rejected.
  assert.match((await head.get('/api/google/callback?code=good-code&state=forged')).body, /google_error=state/);
  const dcR = await dc.post('/api/google/connect', { features: ['gmail'] });
  const dcState = new URL(dcR.body.url).searchParams.get('state');
  assert.match((await head.get(`/api/google/callback?code=good-code&state=${dcState}`)).body, /google_error=state/);
  const other = await t.request('POST', '/api/auth/demo', { user_id: head.id });
  const r2 = await head.post('/api/google/connect', { features: ALL });
  const state2 = new URL(r2.body.url).searchParams.get('state');
  assert.match((await t.client(other.body.token).get(`/api/google/callback?code=good-code&state=${state2}`)).body, /google_error=state/);
  assert.match((await t.anon.get(`/api/google/callback?code=good-code&state=${state2}`)).body, /google_error=signed_out/);
  assert.equal(t.db.get('SELECT count(*) n FROM google_accounts').n, 0);
  // A fresh state works once.
  const r3 = await head.post('/api/google/connect', { features: ALL });
  const state3 = new URL(r3.body.url).searchParams.get('state');
  const ok = await head.get(`/api/google/callback?code=good-code&state=${state3}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /text\/html/);
  assert.match(ok.body, /google=connected/);
  assert.match((await head.get(`/api/google/callback?code=good-code&state=${state3}`)).body, /google_error=state/, 'state is single use');
  void state;
  const s = await head.get('/api/google/status');
  assert.equal(s.body.connection.email, 'headcoach@gmail.example');
  assert.deepEqual(s.body.connection.features.sort(), [...ALL].sort());
  assert.ok(t.db.get(`SELECT 1 FROM audit WHERE action='google_connect' AND user_id=?`, head.id));
  assert.ok(t.db.get(`SELECT 1 FROM audit WHERE action='google_connect_rejected'`));
});

test('tokens are encrypted at rest and never returned', async () => {
  const tables = t.db.all(`SELECT name FROM sqlite_master WHERE type='table'`).map((r) => r.name);
  const plain = [REFRESH, ...fake.access];
  for (const tb of tables) {
    const dump = JSON.stringify(t.db.all(`SELECT * FROM "${tb}"`));
    for (const p of plain) assert.ok(!dump.includes(p), `${tb} contains a plaintext token`);
  }
  const row = t.db.get('SELECT * FROM google_accounts WHERE user_id=?', head.id);
  assert.match(row.refresh_token_enc, /^v1:/);
  assert.equal(t.app.ctx.google.vault.decrypt(row.refresh_token_enc), REFRESH);
  const status = JSON.stringify((await head.get('/api/google/status')).body);
  for (const p of plain) assert.ok(!status.includes(p));
  assert.ok(!status.includes('token_enc'));
  // An expired access token is refreshed with the stored refresh token.
  t.db.run('UPDATE google_accounts SET access_expires_at=0 WHERE user_id=?', head.id);
  const before = fake.tokenCalls.filter((x) => x === 'refresh_token').length;
  const labels = await head.get('/api/google/gmail/labels');
  assert.equal(labels.status, 200);
  assert.deepEqual(labels.body.map((l) => l.name), ['Team Calendar']);
  assert.equal(fake.tokenCalls.filter((x) => x === 'refresh_token').length, before + 1);
});

// ---------- Gmail -> drafts -> events ----------
test('scan the label, queue drafts, dedupe by message id, and notify on background scans', async () => {
  const d1 = addDays(today(), 3); const d2 = addDays(today(), 4);
  addMessage('m1', { subject: `Varsity vs Lincoln ${spoken(d1)} 7pm`, body: 'Location: Ridgeview Stadium\nBus leaves at 4:30 PM.' });
  addMessage('m2', { subject: 'This week', body: `<p>${spoken(d1)} Practice 3:30-5:30 at Main Field</p><p>${spoken(d2)} Film 3pm @ Film Room</p>`, html: true });
  addMessage('m3', { subject: 'Thanks', body: 'Great job everyone.' });
  addMessage('m4', { subject: `Unlabeled ${spoken(d1)} 6pm`, body: 'x', labels: ['INBOX'] });
  assert.equal((await player.post('/api/google/gmail/scan')).status, 403);
  assert.equal((await trainer.post('/api/google/gmail/scan')).status, 400, 'not connected');
  const r = await head.post('/api/google/gmail/scan');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.checked, 3);
  assert.equal(r.body.new_messages, 3);
  assert.equal(r.body.drafts_created, 3);
  assert.equal(fake.queries.at(-1).labelIds, 'Label_1');
  const again = await head.post('/api/google/gmail/scan');
  assert.equal(again.body.new_messages, 0);
  assert.equal(again.body.drafts_created, 0);
  const list = await head.get('/api/google/drafts');
  assert.equal(list.body.length, 3);
  const game = list.body.find((d) => d.source_id === 'm1');
  assert.equal(game.type, 'game');
  assert.equal(game.start, `${d1}T19:00`);
  assert.equal(game.location, 'Ridgeview Stadium');
  assert.deepEqual(game.audience, [`level:${t.levels.Varsity}`]);
  assert.match(game.message_link, /#all\/m1$/);
  assert.deepEqual(list.body.filter((d) => d.source_id === 'm2').map((d) => d.type).sort(), ['film', 'practice']);
  assert.deepEqual((await dc.get('/api/google/drafts')).body, [], 'drafts are per user');
  // Messages list shows what has been scanned.
  const msgs = await head.get('/api/google/gmail/messages');
  assert.equal(msgs.body.messages.length, 3);
  assert.ok(msgs.body.messages.every((m) => m.scanned));
  // Background scan picks up new mail and notifies the user.
  addMessage('m5', { subject: `Booster club meeting ${spoken(d2)} 7pm`, body: 'Cafeteria' });
  const bg = await t.app.ctx.google.scanAll();
  assert.equal(bg.drafts_created, 1);
  assert.ok(t.notifications(head.id, '%draft% from Gmail').length >= 1);
});

test('approve creates an event with the calendar rules; dismiss and permissions', async () => {
  const drafts = (await head.get('/api/google/drafts')).body;
  const game = drafts.find((d) => d.source_id === 'm1');
  assert.equal((await player.post(`/api/google/drafts/${game.id}/approve`)).status, 403);
  assert.equal((await dc.post(`/api/google/drafts/${game.id}/approve`)).status, 404, 'another coach cannot touch my drafts');
  assert.equal((await head.put(`/api/google/drafts/${game.id}`, { start: 'friday' })).status, 400);
  const ed = await head.put(`/api/google/drafts/${game.id}`, { title: 'Varsity vs Lincoln (Senior night)' });
  assert.equal(ed.body.title, 'Varsity vs Lincoln (Senior night)');
  const ap = await head.post(`/api/google/drafts/${game.id}/approve`, { location: 'Home stadium' });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  const ev = t.db.get('SELECT * FROM events WHERE id=?', ap.body.event_id);
  assert.equal(ev.title, 'Varsity vs Lincoln (Senior night)');
  assert.equal(ev.location, 'Home stadium');
  assert.equal(ev.type, 'game');
  const det = JSON.parse(ev.details);
  assert.equal(det.source, 'gmail');
  assert.match(det.message_link, /m1$/);
  assert.equal(det.opponent, 'Lincoln');
  assert.equal(det.bus_departure, '16:30');
  assert.equal(ap.body.labeled, true);
  const imported = fake.labels.find((l) => l.name === 'Imported');
  assert.ok(imported, 'Imported label created');
  assert.deepEqual(fake.modified.at(-1), { id: 'm1', addLabelIds: [imported.id] });
  assert.equal((await head.post(`/api/google/drafts/${game.id}/approve`)).status, 400, 'already approved');
  assert.ok(t.db.get(`SELECT 1 FROM audit WHERE action='google_import_event' AND entity_id=?`, ap.body.event_id));
  // Dismiss
  const film = drafts.find((d) => d.type === 'film');
  assert.equal((await head.post(`/api/google/drafts/${film.id}/dismiss`)).status, 200);
  assert.equal((await head.get('/api/google/drafts?status=dismissed')).body.length, 1);
  // A trainer (staff without calendar.edit) cannot approve; a coach can only use their own groups.
  const mk = (uid, audience) => t.db.insert('gmail_drafts', { program_id: 1, user_id: uid, source: 'gmail', source_id: `x${uid}`, type: 'practice', title: 'Extra practice', start: `${addDays(today(), 5)}T15:30`, audience });
  const td = mk(trainer.id, ['program']);
  const tr = await trainer.post(`/api/google/drafts/${td}/approve`);
  assert.equal(tr.status, 403);
  assert.match(tr.body.error, /cannot create events/);
  const cd = mk(dc.id, ['program']);
  const c1 = await dc.post(`/api/google/drafts/${cd}/approve`);
  assert.equal(c1.status, 403);
  assert.match(c1.body.error, /own groups/);
  assert.equal(t.db.get('SELECT status FROM gmail_drafts WHERE id=?', cd).status, 'pending');
  assert.equal((await dc.put(`/api/google/drafts/${cd}`, { audience: ['unit:defense'] })).status, 200);
  const c2 = await dc.post(`/api/google/drafts/${cd}/approve`);
  assert.equal(c2.status, 200, JSON.stringify(c2.body));
  assert.equal(c2.body.labeled, null, 'no Google connection, no label');
});

// ---------- outbox through Gmail ----------
test('outbox is delivered through the chosen Gmail, respecting deliver_at', async () => {
  const pl = t.user('player@ridgeview.example');
  const old = t.db.insert('outbox', { user_id: pl.id, to_email: pl.email, subject: 'Old simulated mail', body: 'x', deliver_at: '2000-01-01T00:00' });
  // Not configured yet: nothing is sent.
  assert.equal((await t.app.ctx.google.deliverOutbox()).sent, 0);
  assert.equal((await dc.put('/api/google/gmail/sender', { user_id: head.id })).status, 403);
  assert.equal((await head.put('/api/google/gmail/sender', { user_id: dc.id })).status, 400, 'not connected');
  const set = await head.put('/api/google/gmail/sender', { user_id: head.id });
  assert.equal(set.status, 200);
  const due = t.db.insert('outbox', { user_id: pl.id, to_email: pl.email, subject: 'Practice moved — indoors', body: 'See /calendar/1 for details', deliver_at: '2000-01-01T00:00' });
  const later = t.db.insert('outbox', { user_id: pl.id, to_email: pl.email, subject: 'Quiet hours', body: 'later', deliver_at: '2999-01-01T05:00' });
  const r = await t.app.ctx.google.deliverOutbox();
  assert.equal(r.sent, 1);
  const raw = Buffer.from(fake.sent.at(-1), 'base64url').toString('utf8');
  assert.match(raw, new RegExp(`To: ${pl.email}`));
  assert.match(raw, /From: .*<headcoach@gmail\.example>/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
  const bodyText = Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.equal(bodyText, 'See https://pm.example.com/calendar/1 for details');
  assert.ok(t.db.get('SELECT sent_at FROM outbox WHERE id=?', due).sent_at);
  assert.equal(t.db.get('SELECT sent_at FROM outbox WHERE id=?', later).sent_at, null);
  assert.equal(t.db.get('SELECT sent_at FROM outbox WHERE id=?', old).sent_at, null, 'mail queued before turning it on stays simulated');
  assert.equal((await t.app.ctx.google.deliverOutbox()).sent, 0, 'sent once');
  const st = await head.get('/api/google/status');
  assert.equal(st.body.sender.user_id, head.id);
  assert.equal(st.body.sender.ready, true);
  await head.put('/api/google/gmail/sender', { user_id: null });
  t.db.insert('outbox', { user_id: pl.id, to_email: pl.email, subject: 'After off', body: 'x', deliver_at: '2000-01-01T00:00' });
  assert.equal((await t.app.ctx.google.deliverOutbox()).sent, 0);
});

// ---------- Calendar ----------
test('calendar push is idempotent, updates changes and removes deleted events; import queues drafts', async () => {
  const cals = await head.get('/api/google/calendar/calendars');
  assert.deepEqual(cals.body.map((c) => c.id), ['primary', 'team@group.calendar.google.com']);
  const from = today(); const to = addDays(today(), 10);
  const p1 = await head.post('/api/google/calendar/push', { calendar_id: 'team@group.calendar.google.com', from, to });
  assert.equal(p1.status, 200, JSON.stringify(p1.body));
  assert.ok(p1.body.created > 0);
  assert.deepEqual(p1.body.errors, []);
  const cal = fake.calendars['team@group.calendar.google.com'];
  assert.equal(Object.keys(cal).length, p1.body.created);
  const p2 = await head.post('/api/google/calendar/push', { calendar_id: 'team@group.calendar.google.com', from, to });
  assert.equal(p2.body.created, 0);
  assert.equal(p2.body.updated, 0);
  assert.equal(p2.body.unchanged, p1.body.created);
  // Edit, cancel and delete in the app, then push again.
  const [a, b, c] = t.db.all('SELECT l.event_id, l.google_event_id FROM gcal_links l WHERE l.user_id=? ORDER BY l.event_id LIMIT 3', head.id);
  assert.equal((await head.put(`/api/events/${a.event_id}`, { title: 'Renamed in app' })).status, 200);
  assert.equal((await head.post(`/api/events/${b.event_id}/status`, { status: 'cancelled', note: 'Weather' })).status, 200);
  assert.equal((await head.del(`/api/events/${c.event_id}`)).status, 200);
  const p3 = await head.post('/api/google/calendar/push', { calendar_id: 'team@group.calendar.google.com', from, to });
  assert.equal(p3.body.created, 0);
  assert.equal(p3.body.updated, 2);
  assert.equal(p3.body.removed, 1);
  assert.equal(cal[a.google_event_id].summary, 'Renamed in app');
  assert.match(cal[b.google_event_id].summary, /^CANCELLED: /);
  assert.equal(cal[c.google_event_id], undefined);
  assert.equal(cal[a.google_event_id].extendedProperties.private.pm_event_id, String(a.event_id));
  // Removed on Google's side: pushed again as a new event.
  delete cal[a.google_event_id];
  t.db.run('UPDATE gcal_links SET hash=NULL WHERE event_id=?', a.event_id);
  const p4 = await head.post('/api/google/calendar/push', { calendar_id: 'team@group.calendar.google.com', from, to });
  assert.equal(p4.body.created, 1);
  // A player cannot push.
  assert.equal((await player.post('/api/google/calendar/push', { from, to })).status, 403);

  // Import: our own pushed events are skipped; others become drafts once.
  cal.ext1 = { id: 'ext1', summary: 'Scrimmage vs Westside', location: 'Westside HS', start: { dateTime: `${addDays(today(), 6)}T18:00:00` }, end: { dateTime: `${addDays(today(), 6)}T20:00:00` }, htmlLink: 'https://calendar.google.com/event?eid=ext1' };
  const im = await head.post('/api/google/calendar/import', { calendar_id: 'team@group.calendar.google.com', from, to });
  assert.equal(im.status, 200);
  assert.equal(im.body.drafts_created, 1);
  const d = (await head.get('/api/google/drafts')).body.find((x) => x.source === 'gcal');
  assert.equal(d.type, 'game');
  assert.equal(d.start, `${addDays(today(), 6)}T18:00`);
  assert.equal(d.details.opponent, 'Westside');
  assert.equal((await head.post('/api/google/calendar/import', { calendar_id: 'team@group.calendar.google.com', from, to })).body.drafts_created, 0);
});

// ---------- Sheets ----------
test('sheets: roster and test-max imports reuse the app import; exports create spreadsheets', async () => {
  fake.sheets.roster1 = { values: [['Name', 'Team', 'Units', 'Position', 'Number', 'Class', 'Height', 'Weight'], ['Sheet Player', 'Varsity', 'Off', 'WR', '88', '2027', '70', '170'], ['', '', '', '', '', '', '', ''], ['', 'JV Red', 'def', 'LB', '', '', '', '']] };
  const url = 'https://docs.google.com/spreadsheets/d/roster1/edit#gid=0';
  assert.equal((await head.post('/api/google/sheets/roster-import', { url: 'https://example.com/x' })).status, 400);
  assert.equal((await trainer.post('/api/google/sheets/roster-import', { url })).status, 400, 'trainer not connected');
  const pv = await head.post('/api/google/sheets/roster-import', { url, preview: true });
  assert.equal(pv.body.total, 2);
  assert.deepEqual(pv.body.rows[0], { name: 'Sheet Player', jersey: '88', class_year: '2027', team: 'Varsity', units: 'Off', positions: 'WR', height: '70', weight: '170' });
  assert.equal(t.db.get(`SELECT count(*) n FROM users WHERE name='Sheet Player'`).n, 0, 'preview imports nothing');
  const im = await head.post('/api/google/sheets/roster-import', { url });
  assert.equal(im.status, 200, JSON.stringify(im.body));
  assert.equal(im.body.created, 1);
  assert.deepEqual(im.body.errors.map((e) => e.row), [2]);
  const sp = t.db.get(`SELECT p.* FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.name='Sheet Player'`);
  assert.equal(sp.team_id, t.teams.Varsity);
  assert.equal(sp.jersey, 88);
  assert.deepEqual(JSON.parse(sp.positions), ['WR']);
  assert.ok(t.db.get(`SELECT 1 FROM audit WHERE action='google_import_roster'`));

  fake.sheets.maxes = { values: [['Name', 'Squat', 'Bench', '40 yard'], ['Sheet Player', '315', '225', '4.9'], ['Nobody Here', '100', '', '']] };
  const tm = await head.post('/api/google/sheets/tests-import', { url: 'https://docs.google.com/spreadsheets/d/maxes/edit', date: today() });
  assert.equal(tm.status, 200, JSON.stringify(tm.body));
  assert.equal(tm.body.created, 3);
  assert.equal(tm.body.errors.length, 1);
  assert.deepEqual(t.db.all(`SELECT test_key, value FROM tests t JOIN users u ON u.id=t.player_id WHERE u.name='Sheet Player' ORDER BY test_key`).map((r) => [r.test_key, r.value]), [['bench', 225], ['forty', 4.9], ['squat', 315]]);

  for (const kind of ['roster', 'attendance', 'equipment']) {
    const ex = await head.post('/api/google/sheets/export', { kind });
    assert.equal(ex.status, 200, `${kind}: ${JSON.stringify(ex.body)}`);
    assert.match(ex.body.url, /^https:\/\/docs\.google\.com\/spreadsheets\/d\/new-sheet-\d+\/edit$/);
    const s = fake.sheets[ex.body.spreadsheet_id];
    assert.equal(s.values.length, ex.body.rows + 1);
    assert.equal(s.values[0][0], kind === 'equipment' || kind === 'attendance' ? 'Player' : 'Name');
  }
  const roster = Object.values(fake.sheets).find((s) => s.title && /roster/.test(s.title));
  assert.ok(roster.values.some((r) => r[0] === 'Sheet Player'));
  assert.equal((await head.post('/api/google/sheets/export', { kind: 'nope' })).status, 400);
  assert.equal(t.db.get(`SELECT count(*) n FROM audit WHERE action='google_export'`).n, 3);
});

// ---------- Docs ----------
test('docs: practice plan and season report export to new Google Docs', async () => {
  const plan = t.db.get(`SELECT p.id, p.name FROM practice_plans p WHERE p.event_id IS NOT NULL AND (SELECT count(*) FROM periods WHERE plan_id=p.id)>0 LIMIT 1`);
  const r = await head.post('/api/google/docs/practice-plan', { plan_id: plan.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.url, /^https:\/\/docs\.google\.com\/document\/d\/doc-\d+\/edit$/);
  const up = fake.uploads.at(-1);
  assert.match(up.type, /^multipart\/related; boundary=/);
  assert.match(up.raw, /"mimeType":"application\/vnd\.google-apps\.document"/);
  assert.ok(up.raw.includes('<table'));
  assert.ok(up.raw.includes('<h2>Periods</h2>'));
  assert.equal((await head.post('/api/google/docs/practice-plan', { plan_id: 999999 })).status, 404);
  const pl = t.user('player@ridgeview.example');
  const s = await head.post('/api/google/docs/season-report', { player_id: pl.id });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.ok(fake.uploads.at(-1).raw.includes(`${pl.name}: season report`));
  assert.equal((await player.post('/api/google/docs/season-report', { player_id: pl.id })).status, 403);
  assert.ok(t.db.get(`SELECT 1 FROM audit WHERE action='google_export' AND entity='player'`));
});

// ---------- disconnect ----------
test('disconnect revokes the token and removes the connection', async () => {
  const r = await head.post('/api/google/disconnect');
  assert.equal(r.status, 200);
  assert.equal(r.body.revoked, true);
  assert.ok(fake.revoked.includes(REFRESH));
  assert.equal(t.db.get('SELECT count(*) n FROM google_accounts WHERE user_id=?', head.id).n, 0);
  assert.equal((await head.get('/api/google/status')).body.connection, null);
  assert.equal((await head.post('/api/google/gmail/scan')).status, 400);
  assert.equal((await head.post('/api/google/disconnect')).status, 404);
  assert.ok(t.db.get(`SELECT 1 FROM audit WHERE action='google_disconnect'`));
});
