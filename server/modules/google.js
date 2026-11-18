// Google Workspace integration: per-user OAuth connections (Gmail, Calendar, Sheets, Docs), Gmail -> calendar
// drafts with a review queue, program email delivered through a chosen staff Gmail, Google Calendar push and
// import, Sheets roster/test imports and exports, and Docs exports.
//
// Existing rules are reused by calling the app's own route handlers (router.match) with the signed-in user:
// approving a draft goes through POST /api/events (calendar.edit + managesAudience), imports go through
// POST /api/players/import and POST /api/tests/import, and exports read the same reports the app shows.
import crypto from 'node:crypto';
import { HttpError, need, nowLocal, addDays, addMinutes, today, fmtLocal, parseLocal, token } from '../core.js';
import { j, jAll } from '../db.js';
import * as G from '../google/client.js';
import { parseEmail, htmlToText, guessType, findOpponent } from '../google/parser.js';
import { EVENT_TYPES } from './calendar.js';
import { TESTS } from './weights.js';

const SCAN_EVERY_MS = 10 * 60_000;
const STATE_TTL_MS = 15 * 60_000;
const IMPORTED_LABEL = 'Imported';

export default function google(ctx) {
  const { router, db, core } = ctx;
  const { isStaff, isAdmin, audit, notify } = core;
  const vault = G.createVault(db);
  const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
  const dt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

  // ---------- helpers ----------
  const staffOnly = (u) => need(isStaff(u), 403, 'Only staff can use Google integrations');
  const accountOf = (u) => j(db.get('SELECT * FROM google_accounts WHERE user_id=? AND program_id=?', u.id, u.program_id), 'scopes');
  function connected(u, feature) {
    const cfg = G.requireConfigured();
    staffOnly(u);
    const acct = accountOf(u);
    need(acct, 400, 'Connect your Google account first (Integrations › Connection).');
    if (feature) {
      const f = G.FEATURES[feature];
      need(f.scopes.every((s) => acct.scopes.includes(s)), 403, `Your Google connection does not include ${f.label}. Reconnect with ${f.label} ticked.`);
    }
    return { cfg, acct, gapi: gapiFor(cfg, acct) };
  }
  function accessFor(cfg, acct) {
    return async (force) => {
      const row = db.get('SELECT access_token_enc, access_expires_at, refresh_token_enc FROM google_accounts WHERE id=?', acct.id);
      need(row, 400, 'Google account is no longer connected');
      if (!force && row.access_token_enc && Number(row.access_expires_at) > Date.now() + 60_000) return vault.decrypt(row.access_token_enc);
      const refresh = vault.decrypt(row.refresh_token_enc);
      need(refresh, 401, 'No Google refresh token is stored. Reconnect Google.');
      try {
        const t = await G.refreshAccess(cfg, refresh);
        db.update('google_accounts', acct.id, {
          access_token_enc: vault.encrypt(t.access_token), access_expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000,
          ...(t.refresh_token ? { refresh_token_enc: vault.encrypt(t.refresh_token) } : {}), last_error: null, updated_at: nowLocal(),
        });
        return t.access_token;
      } catch (e) {
        db.update('google_accounts', acct.id, { last_error: e.message, updated_at: nowLocal() });
        throw e;
      }
    };
  }
  const gapiFor = (cfg, acct) => (service, p, opts) => G.gfetch(cfg, accessFor(cfg, acct), service, p, opts);
  // Call one of the app's own routes as this user, so its validation and permission rules apply unchanged.
  async function call(method, p, user, { query = {}, body = {} } = {}) {
    const found = router.match(method, p);
    if (!found) throw new HttpError(500, `Internal route missing: ${method} ${p}`);
    return found.route.handler({ user, params: found.params, query, body: JSON.parse(JSON.stringify(body)), db, core, sid: null, res: { headers: {} }, req: null });
  }
  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const userRow = (id) => { const u = db.get('SELECT * FROM users WHERE id=?', id); if (u) u.perms = JSON.parse(u.perms || '{}'); return u; };
  function publicAccount(a) {
    return {
      email: a.email, scopes: a.scopes, features: G.featuresFromScopes(a.scopes), connected_at: a.connected_at,
      gmail_label: a.gmail_label, gmail_query: a.gmail_query, apply_imported_label: !!a.apply_imported_label, auto_scan: !!a.auto_scan,
      allow_program_send: !!a.allow_program_send, last_scan_at: a.last_scan_at, last_error: a.last_error,
    };
  }

  // ---------- status, connect, callback, disconnect ----------
  router.get('/api/google/status', ({ user }) => {
    staffOnly(user);
    const cfg = G.config();
    const acct = accountOf(user);
    const s = core.settings(user.program_id);
    const senderRow = s.gmail_send_user_id ? db.get(`SELECT u.id, u.name, g.email, g.scopes, g.allow_program_send FROM users u LEFT JOIN google_accounts g ON g.user_id=u.id
      WHERE u.id=? AND u.program_id=?`, s.gmail_send_user_id, user.program_id) : null;
    const out = {
      configured: cfg.configured, missing: cfg.missing, message: cfg.configured ? null : G.notConfiguredMessage(cfg),
      redirect_uri: cfg.redirectUri, token_key_set: cfg.tokenKeyFromEnv,
      features: Object.entries(G.FEATURES).map(([key, f]) => ({ key, label: f.label, help: f.help })),
      connection: acct ? publicAccount(acct) : null, is_admin: isAdmin(user),
      pending_drafts: db.get(`SELECT count(*) n FROM gmail_drafts WHERE user_id=? AND status='pending'`, user.id).n,
      sender: senderRow ? { user_id: senderRow.id, name: senderRow.name, email: senderRow.email, ready: !!(senderRow.scopes && JSON.parse(senderRow.scopes).includes(G.SCOPE.gmailSend)) } : null,
    };
    if (isAdmin(user)) {
      out.sender_options = jAll(db.all(`SELECT g.user_id, g.email, g.scopes, g.allow_program_send, u.name FROM google_accounts g JOIN users u ON u.id=g.user_id
        WHERE g.program_id=? AND u.active=1 ORDER BY u.name`, user.program_id), 'scopes')
        .filter((r) => r.scopes.includes(G.SCOPE.gmailSend) && (r.allow_program_send || r.user_id === user.id))
        .map((r) => ({ user_id: r.user_id, name: r.name, email: r.email }));
    }
    return out;
  });

  router.post('/api/google/connect', ({ user, body, sid }) => {
    const cfg = G.requireConfigured();
    staffOnly(user);
    need(sid, 401, 'Sign in again before connecting Google');
    const feats = [...new Set((body.features || []).filter((f) => G.FEATURES[f]))];
    need(feats.length, 400, 'Pick at least one feature to connect');
    const state = token(24);
    db.run('DELETE FROM google_oauth_states WHERE created_at<? OR user_id=?', Date.now() - STATE_TTL_MS, user.id);
    db.insert('google_oauth_states', { state, user_id: user.id, session_hash: sha(sid), features: feats, created_at: Date.now() });
    const scopes = [...new Set([...G.BASE_SCOPES, ...feats.flatMap((f) => G.FEATURES[f].scopes)])];
    return { url: G.authorizeUrl(cfg, { state, scopes, loginHint: accountOf(user)?.email || user.email }) };
  });

  const back = (q) => {
    const to = `/settings/integrations?tab=connection&${q}`;
    return {
      __raw: true, type: 'text/html; charset=utf-8', headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      body: `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escHtml(to)}"><title>Google</title><p>Returning to the app… <a href="${escHtml(to)}">Continue</a></p>`,
    };
  };
  // OAuth redirect target. The browser arrives with the app's session cookie (SameSite=Lax allows top-level GETs).
  router.get('/api/google/callback', async ({ user, query, sid }) => {
    const cfg = G.config();
    if (!cfg.configured) return back('google_error=not_configured');
    if (!user || !user._session.verified) return back('google_error=signed_out');
    const st = query.state ? db.get('SELECT * FROM google_oauth_states WHERE state=?', String(query.state)) : null;
    if (st) db.run('DELETE FROM google_oauth_states WHERE state=?', st.state); // single use
    if (!st || st.user_id !== user.id || st.session_hash !== sha(sid) || st.created_at < Date.now() - STATE_TTL_MS) {
      audit(user, 'google_connect_rejected', 'google', user.id, { reason: 'state_mismatch' });
      return back('google_error=state');
    }
    if (query.error) return back(`google_error=${encodeURIComponent(String(query.error).slice(0, 40))}`);
    if (!isStaff(user)) return back('google_error=staff_only');
    if (!query.code) return back('google_error=no_code');
    let tok;
    try { tok = await G.exchangeCode(cfg, String(query.code)); } catch (e) {
      audit(user, 'google_connect_failed', 'google', user.id, { reason: e.message.slice(0, 120) });
      return back('google_error=exchange');
    }
    const scopes = String(tok.scope || '').split(/\s+/).filter(Boolean);
    let email = G.emailFromIdToken(tok.id_token);
    if (!email) {
      try {
        const info = await G.gfetch(cfg, async () => tok.access_token, 'userinfo', '/v1/userinfo');
        email = info?.email || null;
      } catch { /* email is informational */ }
    }
    const existing = accountOf(user);
    const refreshEnc = tok.refresh_token ? vault.encrypt(tok.refresh_token) : existing?.refresh_token_enc;
    if (!refreshEnc) return back('google_error=no_refresh_token');
    const row = {
      email, scopes, refresh_token_enc: refreshEnc, access_token_enc: vault.encrypt(tok.access_token),
      access_expires_at: Date.now() + (Number(tok.expires_in) || 3600) * 1000, last_error: null, updated_at: nowLocal(),
    };
    if (existing) {
      // A different Google account invalidates cached label ids.
      if (existing.email !== email) row.imported_label_id = null;
      db.update('google_accounts', existing.id, row);
    } else db.insert('google_accounts', { ...row, program_id: user.program_id, user_id: user.id, connected_at: nowLocal() });
    audit(user, 'google_connect', 'google', user.id, { email, features: G.featuresFromScopes(scopes) });
    return back('google=connected');
  }, { auth: false });

  router.post('/api/google/disconnect', async ({ user }) => {
    staffOnly(user);
    const acct = accountOf(user);
    need(acct, 404, 'No Google account is connected');
    const cfg = G.config();
    let revoked = false;
    if (cfg.configured) {
      let rt = null; try { rt = vault.decrypt(acct.refresh_token_enc); } catch { /* key changed */ }
      if (rt) revoked = await G.revoke(cfg, rt);
    }
    db.run('DELETE FROM google_accounts WHERE id=?', acct.id);
    audit(user, 'google_disconnect', 'google', user.id, { email: acct.email, revoked });
    return { ok: true, revoked, message: cfg.configured ? null : G.notConfiguredMessage(cfg) };
  });

  // ---------- Gmail settings, labels and messages ----------
  router.put('/api/google/gmail/settings', ({ user, body }) => {
    G.requireConfigured();
    staffOnly(user);
    const acct = accountOf(user);
    need(acct, 400, 'Connect your Google account first');
    const upd = { updated_at: nowLocal() };
    if (body.gmail_label !== undefined) upd.gmail_label = String(body.gmail_label || '').trim().slice(0, 100) || null;
    if (body.gmail_query !== undefined) upd.gmail_query = String(body.gmail_query || '').trim().slice(0, 300) || null;
    for (const k of ['apply_imported_label', 'auto_scan', 'allow_program_send']) if (body[k] !== undefined) upd[k] = body[k] ? 1 : 0;
    db.update('google_accounts', acct.id, upd);
    if (body.allow_program_send === false) {
      // Withdrawing consent also stops program email going out through this account.
      const s = core.settings(user.program_id);
      if (s.gmail_send_user_id === user.id && !isAdmin(user)) setSender(user.program_id, null);
    }
    return { ok: true, connection: publicAccount(accountOf(user)) };
  });

  async function labelIdByName(gapi, name, { create = false } = {}) {
    const r = await gapi('gmail', '/gmail/v1/users/me/labels');
    const found = (r?.labels || []).find((l) => l.name.toLowerCase() === String(name).toLowerCase());
    if (found) return found.id;
    if (!create) return null;
    const c = await gapi('gmail', '/gmail/v1/users/me/labels', { method: 'POST', body: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' } });
    return c.id;
  }
  router.get('/api/google/gmail/labels', async ({ user }) => {
    const { gapi } = connected(user, 'gmail');
    const r = await gapi('gmail', '/gmail/v1/users/me/labels');
    return (r?.labels || []).filter((l) => l.type !== 'system').map((l) => ({ id: l.id, name: l.name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  // The search: the chosen label (if any) and the free-text query (if any). An explicit query overrides both.
  async function searchMessages(gapi, acct, { query, max = 20 } = {}) {
    const q = { maxResults: Math.min(Number(max) || 20, 50) };
    let labelMissing = false;
    if (query) q.q = String(query);
    else {
      if (acct.gmail_label) {
        const id = await labelIdByName(gapi, acct.gmail_label);
        if (!id) labelMissing = true; else q.labelIds = id;
      }
      q.q = [acct.gmail_query, 'newer_than:60d'].filter(Boolean).join(' ');
      if (labelMissing && !acct.gmail_query) return { messages: [], label_missing: true };
    }
    const r = await gapi('gmail', '/gmail/v1/users/me/messages', { query: q });
    return { messages: r?.messages || [], label_missing: labelMissing };
  }
  const b64 = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  function decodeMessage(m) {
    const headers = Object.fromEntries((m.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
    let plain = ''; let htmlPart = '';
    const walk = (p) => {
      if (!p || p.filename) return;
      if (p.mimeType === 'text/plain' && p.body?.data && !plain) plain = b64(p.body.data);
      else if (p.mimeType === 'text/html' && p.body?.data && !htmlPart) htmlPart = b64(p.body.data);
      (p.parts || []).forEach(walk);
    };
    walk(m.payload);
    return {
      id: m.id, subject: headers.subject || '', from: headers.from || '', snippet: m.snippet || '',
      receivedAt: m.internalDate ? fmtLocal(new Date(Number(m.internalDate))) : nowLocal(),
      body: plain || htmlToText(htmlPart) || m.snippet || '',
    };
  }
  const gmailLink = (acct, id) => `https://mail.google.com/mail/?authuser=${encodeURIComponent(acct.email || '')}#all/${encodeURIComponent(id)}`;

  router.get('/api/google/gmail/messages', async ({ user, query }) => {
    const { acct, gapi } = connected(user, 'gmail');
    const found = await searchMessages(gapi, acct, { query: query.q, max: query.max || 15 });
    const out = [];
    for (const m of found.messages) {
      const full = await gapi('gmail', `/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}`, { query: { format: 'metadata', metadataHeaders: 'Subject' } });
      const d = decodeMessage(full);
      const queued = db.get(`SELECT 1 FROM google_seen WHERE user_id=? AND source='gmail' AND source_id=?`, user.id, m.id);
      out.push({ id: m.id, subject: d.subject, from: d.from, received_at: d.receivedAt, snippet: d.snippet, scanned: !!queued, link: gmailLink(acct, m.id) });
    }
    return { messages: out, label_missing: found.label_missing, label: acct.gmail_label };
  });

  // ---------- drafts ----------
  function defaultAudience(u, groups, type, text) {
    if (groups && groups.length) {
      const levels = db.all('SELECT id, name FROM levels WHERE program_id=?', u.program_id);
      const toks = groups.map((g) => levels.find((l) => l.name.toLowerCase() === g || (g === 'jv' && /junior varsity|^jv/i.test(l.name)) || (g === 'freshman' && /^fresh/i.test(l.name))))
        .filter(Boolean).map((l) => `level:${l.id}`);
      if (toks.length) return [...new Set(toks)];
    }
    if (type === 'meeting' && /\b(coaches|staff)\b/i.test(text || '')) return ['coaches'];
    if (isAdmin(u)) return ['program'];
    const scopes = core.staffScopes(u.id);
    return scopes.length ? scopes : ['program'];
  }
  function insertDraft(u, d) {
    const r = db.run(`INSERT OR IGNORE INTO gmail_drafts (program_id, user_id, source, source_id, draft_index, message_link, subject, sender, received_at, snippet,
      type, title, start, end, location, audience, details, confidence, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    u.program_id, u.id, d.source, d.source_id, d.draft_index || 0, d.message_link || null, (d.subject || '').slice(0, 300), (d.sender || '').slice(0, 200), d.received_at || null,
    (d.snippet || '').slice(0, 400), d.type, (d.title || '').slice(0, 200), d.start, d.end || null, d.location || null,
    JSON.stringify(d.audience || ['program']), JSON.stringify(d.details || {}), d.confidence ?? null, JSON.stringify(d.notes || []));
    return Number(r.changes);
  }
  async function scanAccount(acct, { query } = {}) {
    const cfg = G.requireConfigured();
    const gapi = gapiFor(cfg, acct);
    const u = userRow(acct.user_id);
    const found = await searchMessages(gapi, acct, { query, max: 25 });
    let fresh = 0; let created = 0;
    for (const m of found.messages) {
      if (db.get(`SELECT 1 FROM google_seen WHERE user_id=? AND source='gmail' AND source_id=?`, acct.user_id, m.id)) continue;
      const full = await gapi('gmail', `/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}`, { query: { format: 'full' } });
      const msg = decodeMessage(full);
      const drafts = parseEmail({ subject: msg.subject, body: msg.body, receivedAt: msg.receivedAt });
      db.tx(() => {
        db.run(`INSERT OR IGNORE INTO google_seen (user_id, source, source_id) VALUES (?, 'gmail', ?)`, acct.user_id, m.id);
        drafts.forEach((d, i) => {
          created += insertDraft(u, {
            ...d, source: 'gmail', source_id: m.id, draft_index: i, message_link: gmailLink(acct, m.id), subject: msg.subject, sender: msg.from,
            received_at: msg.receivedAt, audience: defaultAudience(u, d.groups, d.type, `${msg.subject} ${msg.body}`),
          });
        });
      });
      fresh++;
    }
    db.update('google_accounts', acct.id, { last_scan_at: nowLocal(), last_error: found.label_missing && !acct.gmail_query ? `Gmail label "${acct.gmail_label}" was not found` : null });
    return { checked: found.messages.length, new_messages: fresh, drafts_created: created, label_missing: found.label_missing };
  }
  router.post('/api/google/gmail/scan', async ({ user, body }) => {
    const { acct } = connected(user, 'gmail');
    const r = await scanAccount(acct, { query: body.query });
    audit(user, 'google_gmail_scan', 'google', user.id, { checked: r.checked, drafts: r.drafts_created, query: body.query ? 'custom' : 'label' });
    return r;
  });

  let scanning = false;
  async function scanAll() {
    if (scanning || !G.config().configured) return { skipped: true };
    scanning = true;
    let total = 0;
    try {
      const rows = jAll(db.all(`SELECT g.* FROM google_accounts g JOIN users u ON u.id=g.user_id WHERE g.auto_scan=1 AND u.active=1`), 'scopes')
        .filter((a) => a.scopes.includes(G.SCOPE.gmailRead));
      for (const acct of rows) {
        try {
          const r = await scanAccount(acct);
          total += r.drafts_created;
          if (r.drafts_created) {
            notify(acct.program_id, [acct.user_id], {
              kind: 'update', title: `${r.drafts_created} event draft${r.drafts_created > 1 ? 's' : ''} from Gmail`,
              body: 'Review them before they go on the calendar.', link: '/settings/integrations?tab=gmail', from: 'system', email: false,
            });
          }
        } catch (e) {
          db.update('google_accounts', acct.id, { last_error: e.message, updated_at: nowLocal() });
        }
      }
    } finally { scanning = false; }
    return { drafts_created: total };
  }

  const shapeDraft = (d) => {
    j(d, 'audience', 'details', 'notes');
    return { ...d, audience_labels: core.describeAudience(d.program_id, d.audience) };
  };
  const draftOf = (u, id) => db.get('SELECT * FROM gmail_drafts WHERE id=? AND user_id=? AND program_id=?', id, u.id, u.program_id);
  router.get('/api/google/drafts', ({ user, query }) => {
    staffOnly(user);
    const status = ['pending', 'approved', 'dismissed'].includes(query.status) ? query.status : query.status === 'all' ? null : 'pending';
    return db.all(`SELECT * FROM gmail_drafts WHERE user_id=? AND program_id=? ${status ? 'AND status=?' : ''} ORDER BY start, id LIMIT 300`, user.id, user.program_id, ...(status ? [status] : [])).map(shapeDraft);
  });
  function draftEdits(b) {
    const upd = {};
    if (b.type !== undefined) { need(EVENT_TYPES.includes(b.type), 400, 'Unknown event type'); upd.type = b.type; }
    if (b.title !== undefined) { need(String(b.title || '').trim(), 400, 'Title is required'); upd.title = String(b.title).trim().slice(0, 200); }
    if (b.start !== undefined) { need(dt.test(b.start || ''), 400, 'Start must be YYYY-MM-DDTHH:MM'); upd.start = b.start; }
    if (b.end !== undefined) { need(!b.end || dt.test(b.end), 400, 'End must be YYYY-MM-DDTHH:MM'); upd.end = b.end || null; }
    if (b.location !== undefined) upd.location = String(b.location || '').trim().slice(0, 200) || null;
    if (b.audience !== undefined) { need(Array.isArray(b.audience) && b.audience.length && b.audience.every((t) => typeof t === 'string'), 400, 'Pick at least one audience'); upd.audience = b.audience; }
    if (b.details !== undefined) { need(b.details && typeof b.details === 'object' && !Array.isArray(b.details), 400, 'Details must be an object'); upd.details = b.details; }
    return upd;
  }
  router.put('/api/google/drafts/:id', ({ user, params, body }) => {
    staffOnly(user);
    const d = draftOf(user, Number(params.id));
    need(d, 404, 'Draft not found');
    need(d.status === 'pending', 400, 'This draft was already handled');
    const upd = draftEdits(body);
    if (Object.keys(upd).length) db.update('gmail_drafts', d.id, upd);
    return shapeDraft(draftOf(user, d.id));
  });
  router.post('/api/google/drafts/:id/dismiss', ({ user, params }) => {
    staffOnly(user);
    const d = draftOf(user, Number(params.id));
    need(d, 404, 'Draft not found');
    need(d.status === 'pending', 400, 'This draft was already handled');
    db.update('gmail_drafts', d.id, { status: 'dismissed', decided_at: nowLocal(), decided_by: user.id });
    return { ok: true };
  });
  router.post('/api/google/drafts/:id/approve', async ({ user, params, body }) => {
    staffOnly(user);
    const d = draftOf(user, Number(params.id));
    need(d, 404, 'Draft not found');
    need(d.status === 'pending', 400, 'This draft was already handled');
    const edits = draftEdits(body || {});
    const m = { ...j({ ...d }, 'audience', 'details'), ...edits };
    // Same validation and permission rules as creating an event by hand (calendar.edit + managesAudience).
    const r = await call('POST', '/api/events', user, { body: { type: m.type, title: m.title, start: m.start, end: m.end || null, location: m.location, audience: m.audience, details: m.details || {} } });
    const ev = db.get('SELECT details FROM events WHERE id=?', r.id);
    db.update('events', r.id, { details: { ...JSON.parse(ev.details || '{}'), source: d.source, message_link: d.message_link } });
    db.update('gmail_drafts', d.id, { ...edits, status: 'approved', event_id: r.id, decided_at: nowLocal(), decided_by: user.id });
    audit(user, 'google_import_event', 'event', r.id, { source: d.source, draft_id: d.id });
    let labeled = null; let labelError = null;
    const acct = accountOf(user);
    if (d.source === 'gmail' && acct && acct.apply_imported_label && acct.scopes.includes(G.SCOPE.gmailModify) && G.config().configured) {
      try {
        const gapi = gapiFor(G.config(), acct);
        let lid = acct.imported_label_id;
        if (!lid) { lid = await labelIdByName(gapi, IMPORTED_LABEL, { create: true }); db.update('google_accounts', acct.id, { imported_label_id: lid }); }
        await gapi('gmail', `/gmail/v1/users/me/messages/${encodeURIComponent(d.source_id)}/modify`, { method: 'POST', body: { addLabelIds: [lid] } });
        labeled = true;
      } catch (e) { labeled = false; labelError = e.message; }
    }
    return { ok: true, event_id: r.id, labeled, label_error: labelError };
  });

  // ---------- program email through Gmail ----------
  function setSender(programId, uid) {
    const p = db.get('SELECT settings FROM programs WHERE id=?', programId);
    const cur = JSON.parse(p.settings || '{}');
    const maxId = db.get('SELECT coalesce(max(id),0) n FROM outbox').n;
    const keep = cur.gmail_send_user_id && cur.gmail_send_after_id != null;
    const next = { ...cur, gmail_send_user_id: uid || null, gmail_send_after_id: uid ? (keep ? cur.gmail_send_after_id : maxId) : null };
    db.run('UPDATE programs SET settings=? WHERE id=?', JSON.stringify(next), programId);
    return next;
  }
  router.put('/api/google/gmail/sender', ({ user, body }) => {
    G.requireConfigured();
    need(isAdmin(user), 403, 'Only the head coach can choose how program email is sent');
    const uid = body.user_id ? Number(body.user_id) : null;
    if (uid) {
      const a = j(db.get(`SELECT g.*, u.role FROM google_accounts g JOIN users u ON u.id=g.user_id WHERE g.user_id=? AND g.program_id=? AND u.active=1`, uid, user.program_id), 'scopes');
      need(a, 400, 'That staff member has not connected Google');
      need(a.scopes.includes(G.SCOPE.gmailSend), 400, 'That connection does not include Gmail');
      need(a.user_id === user.id || a.allow_program_send, 400, 'That staff member has not agreed to send program email from their Gmail');
    }
    const next = setSender(user.program_id, uid);
    audit(user, 'google_gmail_sender', 'program', user.program_id, { user_id: uid });
    return { ok: true, gmail_send_user_id: next.gmail_send_user_id };
  });

  const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
  const oneLine = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();
  function mime({ fromName, fromEmail, to, subject, body }) {
    const appUrl = G.config().appUrl;
    // Outbox bodies use app paths ("/invite/abc"); make them clickable links in real email.
    const text = appUrl ? String(body || '').replace(/(^|\s)(\/(?:invite|calendar|assignments|messages|players|practice|weights|equipment|development|settings|checkin)\b[^\s]*)/g, `$1${appUrl}$2`) : String(body || '');
    const lines = [
      `From: ${encWord(oneLine(fromName))} <${oneLine(fromEmail)}>`, `To: ${oneLine(to)}`, `Subject: ${encWord(oneLine(subject))}`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '',
      Buffer.from(text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n'),
    ];
    return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
  }
  let sending = false;
  async function deliverOutbox({ limit = 25 } = {}) {
    const out = { sent: 0, failed: 0 };
    if (sending) return { ...out, skipped: true };
    const cfg = G.config();
    if (!cfg.configured) return out;
    sending = true;
    try {
      for (const p of db.all('SELECT id, name FROM programs')) {
        const s = core.settings(p.id);
        if (!s.gmail_send_user_id) continue;
        const acct = j(db.get(`SELECT g.*, u.role, u.is_admin FROM google_accounts g JOIN users u ON u.id=g.user_id WHERE g.user_id=? AND g.program_id=? AND u.active=1`, s.gmail_send_user_id, p.id), 'scopes');
        if (!acct || !acct.scopes.includes(G.SCOPE.gmailSend)) continue;
        if (!(acct.allow_program_send || acct.role === 'head_coach' || acct.is_admin)) continue;
        // Mail queued before sending was turned on stays simulated (it may be months old).
        const afterId = s.gmail_send_after_id ?? setSender(p.id, s.gmail_send_user_id).gmail_send_after_id;
        const rows = db.all(`SELECT o.* FROM outbox o JOIN users u ON u.id=o.user_id LEFT JOIN google_outbox_log l ON l.outbox_id=o.id
          WHERE u.program_id=? AND o.sent_at IS NULL AND (o.deliver_at IS NULL OR o.deliver_at<=?) AND o.id>? AND o.to_email LIKE '%_@_%'
          AND coalesce(l.attempts,0)<3 ORDER BY o.id LIMIT ?`, p.id, nowLocal(), afterId, limit);
        const gapi = gapiFor(cfg, acct);
        for (const r of rows) {
          try {
            const res = await gapi('gmail', '/gmail/v1/users/me/messages/send', { method: 'POST', body: { raw: mime({ fromName: p.name, fromEmail: acct.email, to: r.to_email, subject: r.subject, body: r.body }) } });
            db.update('outbox', r.id, { sent_at: nowLocal() });
            db.run(`INSERT INTO google_outbox_log (outbox_id, attempts, gmail_id, at) VALUES (?,1,?,?) ON CONFLICT(outbox_id) DO UPDATE SET gmail_id=excluded.gmail_id, last_error=NULL, at=excluded.at`, r.id, res?.id || null, nowLocal());
            out.sent++;
          } catch (e) {
            db.run(`INSERT INTO google_outbox_log (outbox_id, attempts, last_error, at) VALUES (?,1,?,?) ON CONFLICT(outbox_id) DO UPDATE SET attempts=attempts+1, last_error=excluded.last_error, at=excluded.at`, r.id, e.message.slice(0, 300), nowLocal());
            out.failed++;
            if (e.status === 401 || e.revoked) break; // the account needs reconnecting; leave the rest queued
          }
        }
      }
    } finally { sending = false; }
    return out;
  }

  // ---------- Google Calendar ----------
  const tz = () => process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  router.get('/api/google/calendar/calendars', async ({ user }) => {
    const { gapi } = connected(user, 'calendar');
    const r = await gapi('calendar', '/calendar/v3/users/me/calendarList', { query: { maxResults: 100 } });
    return (r?.items || []).map((c) => ({ id: c.id, summary: c.summaryOverride || c.summary, primary: !!c.primary, access_role: c.accessRole, writable: ['owner', 'writer'].includes(c.accessRole) }));
  });
  function gcalPayload(e, appUrl) {
    const end = e.end || addMinutes(e.start, 60);
    const desc = [
      e.status && e.status !== 'scheduled' ? `Status: ${e.status.toUpperCase()}${e.status_note ? ` (${e.status_note})` : ''}` : null,
      e.audience_labels?.length ? `For: ${e.audience_labels.join(', ')}` : null,
      ...Object.entries(e.details || {}).filter(([k]) => !['source', 'message_link', 'wt_assignment_id', 'week', 'day'].includes(k)).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`),
      appUrl ? `${appUrl}/calendar/${e.id}` : null,
    ].filter(Boolean).join('\n');
    return {
      summary: `${e.status === 'cancelled' ? 'CANCELLED: ' : ''}${e.title}`, location: e.location || '', description: desc,
      start: { dateTime: `${e.start}:00`, timeZone: tz() }, end: { dateTime: `${end}:00`, timeZone: tz() },
      extendedProperties: { private: { pm_event_id: String(e.id) } },
      ...(e.status === 'cancelled' ? { transparency: 'transparent' } : {}),
    };
  }
  router.post('/api/google/calendar/push', async ({ user, body }) => {
    const { cfg, gapi } = connected(user, 'calendar');
    const cal = String(body.calendar_id || 'primary');
    const from = /^\d{4}-\d{2}-\d{2}$/.test(body.from || '') ? body.from : today();
    const to = /^\d{4}-\d{2}-\d{2}$/.test(body.to || '') ? body.to : addDays(from, 60);
    need(to >= from, 400, 'The end date must be after the start date');
    // The same list the user sees in the app's calendar (audience rules applied).
    const events = await call('GET', '/api/events', user, { query: { from, to } });
    const res = { created: 0, updated: 0, unchanged: 0, removed: 0, errors: [] };
    const base = `/calendar/v3/calendars/${encodeURIComponent(cal)}/events`;
    for (const e of events) {
      const payload = gcalPayload(e, cfg.appUrl);
      const hash = sha(JSON.stringify(payload));
      const created = db.get('SELECT created_at FROM events WHERE id=?', e.id)?.created_at || null;
      let link = db.get('SELECT * FROM gcal_links WHERE user_id=? AND event_id=? AND calendar_id=?', user.id, e.id, cal);
      if (link && link.event_created !== created) { db.run('DELETE FROM gcal_links WHERE id=?', link.id); link = null; } // event id was reused
      try {
        if (link && link.hash === hash) { res.unchanged++; continue; }
        if (link) {
          try {
            await gapi('calendar', `${base}/${encodeURIComponent(link.google_event_id)}`, { method: 'PUT', body: payload });
            db.update('gcal_links', link.id, { hash, pushed_at: nowLocal() });
            res.updated++;
            continue;
          } catch (err) {
            if (![404, 410].includes(err.googleStatus)) throw err;
            db.run('DELETE FROM gcal_links WHERE id=?', link.id); // removed on Google's side: create it again
          }
        }
        const g = await gapi('calendar', base, { method: 'POST', body: payload });
        db.insert('gcal_links', { program_id: user.program_id, user_id: user.id, event_id: e.id, event_created: created, calendar_id: cal, google_event_id: g.id, hash, pushed_at: nowLocal() });
        res.created++;
      } catch (err) { res.errors.push({ event_id: e.id, error: err.message }); }
    }
    // Events deleted from the app since the last push are removed from the Google calendar.
    const gone = db.all(`SELECT l.* FROM gcal_links l LEFT JOIN events e ON e.id=l.event_id AND e.program_id=l.program_id WHERE l.user_id=? AND l.calendar_id=? AND (e.id IS NULL OR e.created_at IS NOT l.event_created)`, user.id, cal);
    for (const l of gone) {
      try { await gapi('calendar', `${base}/${encodeURIComponent(l.google_event_id)}`, { method: 'DELETE' }); } catch (err) { if (![404, 410].includes(err.googleStatus)) { res.errors.push({ event_id: l.event_id, error: err.message }); continue; } }
      db.run('DELETE FROM gcal_links WHERE id=?', l.id);
      res.removed++;
    }
    audit(user, 'google_calendar_push', 'google', user.id, { calendar: cal === 'primary' ? 'primary' : 'other', from, to, ...res, errors: res.errors.length });
    return res;
  });
  router.post('/api/google/calendar/import', async ({ user, body }) => {
    const { gapi } = connected(user, 'calendar');
    const cal = String(body.calendar_id || 'primary');
    const from = /^\d{4}-\d{2}-\d{2}$/.test(body.from || '') ? body.from : today();
    const to = /^\d{4}-\d{2}-\d{2}$/.test(body.to || '') ? body.to : addDays(from, 30);
    const r = await gapi('calendar', `/calendar/v3/calendars/${encodeURIComponent(cal)}/events`, {
      query: { timeMin: parseLocal(`${from}T00:00`).toISOString(), timeMax: parseLocal(`${to}T23:59`).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: 250 },
    });
    const u = userRow(user.id);
    let created = 0; let skipped = 0;
    db.tx(() => {
      for (const it of r?.items || []) {
        const sid = `${cal}:${it.id}`;
        const ours = it.extendedProperties?.private?.pm_event_id || db.get('SELECT 1 FROM gcal_links WHERE user_id=? AND google_event_id=?', user.id, it.id);
        if (it.status === 'cancelled' || ours || db.get(`SELECT 1 FROM google_seen WHERE user_id=? AND source='gcal' AND source_id=?`, user.id, sid)) { skipped++; continue; }
        const allDay = !it.start?.dateTime;
        const start = allDay ? `${it.start?.date}T08:00` : fmtLocal(new Date(it.start.dateTime));
        if (!dt.test(start)) { skipped++; continue; }
        const end = allDay ? null : it.end?.dateTime ? fmtLocal(new Date(it.end.dateTime)) : null;
        const title = String(it.summary || 'Untitled event');
        const type = guessType(title, it.description || '');
        const opp = type === 'game' ? findOpponent(title) : null;
        db.run(`INSERT OR IGNORE INTO google_seen (user_id, source, source_id) VALUES (?, 'gcal', ?)`, user.id, sid);
        created += insertDraft(u, {
          source: 'gcal', source_id: sid, message_link: it.htmlLink || null, subject: title, sender: it.organizer?.email || null,
          received_at: nowLocal(), snippet: String(it.description || '').replace(/\s+/g, ' ').slice(0, 240), type, title, start, end: end && end >= start ? end : null,
          location: it.location || null, details: opp ? { opponent: opp.opponent, home_away: opp.home_away } : {}, confidence: allDay ? 0.6 : 0.9,
          notes: allDay ? ['All-day event; start set to 08:00'] : [], audience: defaultAudience(u, [], type, title),
        });
      }
    });
    audit(user, 'google_calendar_import', 'google', user.id, { drafts: created, skipped });
    return { drafts_created: created, skipped };
  });

  // ---------- Google Sheets ----------
  const sheetId = (url) => {
    const s = String(url || '').trim();
    const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(s);
    if (m) return m[1];
    return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null;
  };
  const headKey = (h) => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  async function readSheet(gapi, body) {
    const id = sheetId(body.url);
    need(id, 400, 'Paste the Google Sheet link (https://docs.google.com/spreadsheets/d/...)');
    const range = body.sheet ? `'${String(body.sheet).replace(/'/g, "''")}'` : 'A1:ZZ2000';
    const r = await gapi('sheets', `/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}`, { query: { majorDimension: 'ROWS' } });
    const values = (r?.values || []).filter((row) => row.some((c) => String(c ?? '').trim()));
    need(values.length >= 2, 400, 'The sheet needs a header row and at least one data row');
    const headers = values[0].map(headKey);
    const rows = values.slice(1).map((row) => Object.fromEntries(headers.map((h, i) => [h, String(row[i] ?? '').trim()])));
    return { id, headers, rows };
  }
  const ROSTER_ALIASES = {
    name: ['name', 'player', 'player_name', 'full_name'], email: ['email', 'e_mail', 'email_address'], jersey: ['jersey', 'number', 'no', 'jersey_number', 'num'],
    class_year: ['class_year', 'class', 'grad_year', 'graduation_year', 'year'], hand: ['hand', 'handedness'], team: ['team', 'level', 'squad'],
    units: ['units', 'unit', 'side'], positions: ['positions', 'position', 'pos'], height: ['height', 'height_in', 'ht'], weight: ['weight', 'weight_lb', 'wt'],
  };
  function rosterRow(r) {
    const out = {};
    for (const [k, names] of Object.entries(ROSTER_ALIASES)) { const h = names.find((n) => r[n] !== undefined && r[n] !== ''); if (h) out[k] = r[h]; }
    if (!out.name && (r.first_name || r.last_name)) out.name = `${r.first_name || ''} ${r.last_name || ''}`.trim();
    return out;
  }
  router.post('/api/google/sheets/roster-import', async ({ user, body }) => {
    const { gapi } = connected(user, 'sheets');
    need(core.can(user, 'roster.edit'), 403, 'Coaches only');
    const sheet = await readSheet(gapi, body);
    const rows = sheet.rows.map(rosterRow);
    if (body.preview) return { headers: sheet.headers, total: rows.length, rows: rows.slice(0, 10) };
    // The same import path as the CSV roster import.
    const r = await call('POST', '/api/players/import', user, { body: { rows, all_or_nothing: !!body.all_or_nothing } });
    audit(user, 'google_import_roster', 'roster', null, { rows: rows.length, created: r.created, errors: r.errors.length });
    return r;
  });
  const TEST_ALIASES = { squat: /squat/, bench: /bench/, clean: /clean/, deadlift: /dead/, forty: /^(40|forty)/, pro_agility: /agility|5_10_5|shuttle/, vertical: /vert/, broad: /broad/ };
  function testRows(sheet, date) {
    const h = sheet.headers;
    const nameKey = h.find((x) => ['name', 'player', 'player_name'].includes(x));
    const jerseyKey = h.find((x) => ['jersey', 'number', 'no', 'num'].includes(x));
    const dateKey = h.find((x) => x === 'date' || x === 'test_date');
    const base = (r) => ({ name: nameKey ? r[nameKey] : undefined, jersey: jerseyKey ? r[jerseyKey] : undefined, date: (dateKey && r[dateKey]) || date || undefined });
    if (h.includes('value') && (h.includes('test') || h.includes('test_key'))) {
      return sheet.rows.map((r) => {
        const raw = headKey(r.test_key || r.test);
        const key = TESTS[raw] ? raw : Object.keys(TEST_ALIASES).find((k) => TEST_ALIASES[k].test(raw)) || raw;
        return { ...base(r), test_key: key, value: r.value };
      });
    }
    // Wide format: one column per test (Name | Squat | Bench | 40 ...).
    const cols = h.map((x) => [x, TESTS[x] ? x : Object.keys(TEST_ALIASES).find((k) => TEST_ALIASES[k].test(x))]).filter(([, k]) => k);
    need(cols.length, 400, 'No test columns found. Use columns like Name, Squat, Bench, Clean, 40, Vertical, or Test and Value.');
    return sheet.rows.flatMap((r) => cols.filter(([c]) => r[c] !== '').map(([c, k]) => ({ ...base(r), test_key: k, value: r[c] })));
  }
  router.post('/api/google/sheets/tests-import', async ({ user, body }) => {
    const { gapi } = connected(user, 'sheets');
    need(core.can(user, 'weights.edit'), 403, 'Coaches and trainers only');
    need(!body.date || /^\d{4}-\d{2}-\d{2}$/.test(body.date), 400, 'Date must be YYYY-MM-DD');
    const sheet = await readSheet(gapi, body);
    const rows = testRows(sheet, body.date);
    if (body.preview) return { headers: sheet.headers, total: rows.length, rows: rows.slice(0, 10) };
    const r = await call('POST', '/api/tests/import', user, { body: { rows } });
    audit(user, 'google_import_tests', 'tests', null, { rows: rows.length, created: r.created, errors: r.errors.length });
    return r;
  });

  async function newSpreadsheet(gapi, title, tab, values) {
    const s = await gapi('sheets', '/v4/spreadsheets', { method: 'POST', body: { properties: { title }, sheets: [{ properties: { title: tab, gridProperties: { frozenRowCount: 1 } } }] } });
    const range = `'${tab}'!A1`;
    await gapi('sheets', `/v4/spreadsheets/${encodeURIComponent(s.spreadsheetId)}/values/${encodeURIComponent(range)}`, { method: 'PUT', query: { valueInputOption: 'RAW' }, body: { range, majorDimension: 'ROWS', values } });
    return { spreadsheet_id: s.spreadsheetId, url: s.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${s.spreadsheetId}/edit` };
  }
  const cell = (v) => (v == null ? '' : typeof v === 'number' ? v : String(v));
  router.post('/api/google/sheets/export', async ({ user, body }) => {
    const { gapi } = connected(user, 'sheets');
    const program = db.get('SELECT name FROM programs WHERE id=?', user.program_id).name;
    let values; let tab; let title;
    if (body.kind === 'roster') {
      const players = await call('GET', '/api/players', user);
      tab = 'Roster'; title = `${program} roster ${today()}`;
      values = [['Name', 'Jersey', 'Class', 'Team', 'Units', 'Positions', 'Height (in)', 'Weight (lb)', 'Hand', 'Availability', 'Email'],
        ...players.map((p) => [p.name, p.jersey, p.class_year, p.team, (p.units || []).join(' '), (p.positions || []).join(' '), p.height, p.weight, p.hand, p.availability, p.email].map(cell))];
    } else if (body.kind === 'attendance') {
      const r = await call('GET', '/api/attendance-report', user, { query: { ...(body.from ? { from: body.from } : {}), ...(body.to ? { to: body.to } : {}), ...(body.type ? { type: body.type } : {}) } });
      tab = 'Attendance'; title = `${program} attendance ${r.from} to ${r.to}`;
      values = [['Player', 'Jersey', 'Events', 'Present', 'Late', 'Left early', 'Excused', 'Unexcused', 'Attendance %'],
        ...r.players.map((p) => [p.name, p.jersey, p.total, p.present, p.late, p.left_early, p.excused, p.unexcused, p.rate].map(cell))];
    } else if (body.kind === 'equipment') {
      const list = await call('GET', '/api/eq/outstanding', user);
      tab = 'Outstanding'; title = `${program} outstanding equipment ${today()}`;
      values = [['Player', 'Jersey', 'Item', 'Serial', 'Size', 'Qty', 'Status', 'Replacement cost'],
        ...list.flatMap((p) => p.items.map((i) => [p.name, p.jersey, i.type_name, i.serial, i.size, i.qty, i.return_status || 'not returned', Number(((i.cost || 0) * i.qty).toFixed(2))].map(cell)))];
    } else throw new HttpError(400, 'Choose roster, attendance or equipment');
    const out = await newSpreadsheet(gapi, title, tab, values);
    audit(user, 'google_export', body.kind, null, { to: 'sheets', rows: values.length - 1 });
    return { ...out, rows: values.length - 1 };
  });

  // ---------- Google Docs (HTML converted to a Doc by Drive, which keeps headings and tables) ----------
  async function newDoc(gapi, title, bodyHtml) {
    const boundary = `pm${token(12).replace(/[^a-zA-Z0-9]/g, '')}`;
    const meta = { name: title, mimeType: 'application/vnd.google-apps.document' };
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title></head><body>${bodyHtml}</body></html>`;
    const raw = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n--${boundary}--`;
    const f = await gapi('upload', '/upload/drive/v3/files', { method: 'POST', query: { uploadType: 'multipart', fields: 'id,name,webViewLink' }, raw, contentType: `multipart/related; boundary=${boundary}` });
    return { document_id: f.id, url: f.webViewLink || `https://docs.google.com/document/d/${f.id}/edit` };
  }
  const table = (head, rows) => `<table border="1" cellpadding="4" style="border-collapse:collapse"><tr>${head.map((h) => `<th>${escHtml(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${escHtml(c ?? '')}</td>`).join('')}</tr>`).join('')}</table>`;
  router.post('/api/google/docs/practice-plan', async ({ user, body }) => {
    const { gapi } = connected(user, 'docs');
    need(body.plan_id, 400, 'Pick a practice plan');
    const plan = await call('GET', `/api/plans/${Number(body.plan_id)}`, user);
    const when = plan.event ? `${plan.event.title} · ${plan.event.start.replace('T', ' ')}${plan.event.location ? ` · ${plan.event.location}` : ''}` : (plan.is_template ? 'Template' : '');
    const html = [
      `<h1>${escHtml(plan.name)}</h1>`, when ? `<p>${escHtml(when)}</p>` : '',
      `<p>Total ${plan.total_minutes} min, contact ${plan.contact_minutes} min.</p>`,
      '<h2>Periods</h2>',
      table(['#', 'Start', 'Min', 'Group', 'Unit', 'Drill', 'Coach', 'Plays', 'Contact', 'Status'], plan.periods.map((p, i) => [
        i + 1, p.start_time || '', p.duration, p.group_label || (p.positions || []).join(' '), p.unit || '', p.drill_name || '', p.coach_name || '',
        (p.plays || []).map((x) => x.name).join(', '), p.contact ? 'Yes' : '', p.status === 'pending' ? '' : `${p.status}${p.status_note ? `: ${p.status_note}` : ''}`])),
    ].join('');
    // planDetail returns coach notes as `notes`; the plan's own text notes come from the row.
    const planText = db.get('SELECT notes FROM practice_plans WHERE id=? AND program_id=?', plan.id, user.program_id)?.notes;
    const coachNotes = Array.isArray(plan.notes) ? plan.notes.slice().reverse() : [];
    const notesHtml = (planText ? `<h2>Plan notes</h2><p>${escHtml(planText).replace(/\n/g, '<br>')}</p>` : '')
      + (coachNotes.length ? `<h2>Coach notes</h2><ul>${coachNotes.map((n) => `<li>${escHtml([(n.tags || []).join(', '), n.player_name, n.group_label, n.text].filter(Boolean).join(' · '))}${n.coach_name ? ` <i>(${escHtml(n.coach_name)})</i>` : ''}</li>`).join('')}</ul>` : '');
    const out = await newDoc(gapi, `Practice plan: ${plan.name}`, html + notesHtml);
    audit(user, 'google_export', 'plan', plan.id, { to: 'docs' });
    return out;
  });
  router.post('/api/google/docs/season-report', async ({ user, body }) => {
    const { gapi } = connected(user, 'docs');
    need(body.player_id, 400, 'Pick a player');
    const r = await call('GET', `/api/season-report/player/${Number(body.player_id)}`, user);
    const p = r.player;
    const html = [
      `<h1>${escHtml(p.name)}: season report</h1>`,
      `<p>${escHtml([p.jersey != null ? `#${p.jersey}` : null, p.level, p.team && p.team !== p.level ? p.team : null, (p.positions || []).join(' '), p.class_year ? `Class of ${p.class_year}` : null, r.season?.name].filter(Boolean).join(' · '))}</p>`,
      '<h2>Summary</h2>',
      table(['Measure', 'Value'], [
        ['Attendance', r.attendance_rate != null ? `${r.attendance_rate}%` : 'No records'],
        ['Practice ratings', r.ratings?.n ? `${r.ratings.avg} average over ${r.ratings.n}` : 'None'],
        ['Assignments completed', r.assignments?.total ? `${r.assignments.done || 0} of ${r.assignments.total}` : 'None'],
      ]),
      Object.keys(r.tests || {}).length ? `<h2>Testing</h2>${table(['Test', 'First', 'Latest', 'Best'], Object.values(r.tests).map((t) => [t.label, `${t.first} ${t.unit}`, `${t.last} ${t.unit}`, `${t.best} ${t.unit}`]))}` : '',
      (r.evaluations || []).length ? `<h2>Evaluations</h2>${r.evaluations.map((e) => `<h3>${escHtml(e.point)}</h3>${table(['Area', 'Score'], Object.entries(e.scores || {}).map(([k, v]) => [k.replace(/_/g, ' '), v]))}${e.notes ? `<p>${escHtml(e.notes)}</p>` : ''}`).join('')}` : '',
      (r.goals || []).length ? `<h2>Goals</h2>${table(['Goal', 'Progress', 'Status'], r.goals.map((g) => [g.title, g.progress != null ? `${g.progress}%` : '', g.status]))}` : '',
      `<p><i>Generated ${escHtml(String(r.generated_at || nowLocal()).replace('T', ' '))}</i></p>`,
    ].join('');
    const out = await newDoc(gapi, `Season report: ${p.name}`, html);
    audit(user, 'google_export', 'player', p.id, { to: 'docs', report: 'season' });
    return out;
  });

  // ---------- background jobs (ticks run every minute; Gmail scans every 10 minutes) ----------
  let lastScan = Date.now();
  ctx.ticks.push(() => {
    if (!G.config().configured) return;
    deliverOutbox().catch((e) => console.error('[google] outbox delivery failed:', e.message));
    if (Date.now() - lastScan >= SCAN_EVERY_MS) {
      lastScan = Date.now();
      scanAll().catch((e) => console.error('[google] Gmail scan failed:', e.message));
    }
  });
  ctx.google = { scanAll, scanAccount, deliverOutbox, vault };
}
