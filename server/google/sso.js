// School sign-in: "Sign in with Google" (OpenID Connect: openid email profile) and Clever Instant Login, using the
// OAuth clients the head coach configured under Settings › Integrations › Setup. A person signs in only when an
// active account in that program already uses the verified email address; nobody is created here.
// In the Windows app the flow runs in the system browser and finishes through a desktop hand-off.
import { need, token, nowLocal } from '../core.js';
import * as G from './client.js';
import { cleverConfig, cleverAuthorizeUrl, cleverExchange, cleverIdentity } from './clever.js';
import { sha, createHandoff, handoffForState, finishHandoff, resultPage, HANDOFF_TTL_MS } from './handoff.js';

const STATE_TTL_MS = 15 * 60_000;
const LABEL = { google: 'Google', clever: 'Clever' };
const cookieOf = (req, name) => {
  for (const c of String(req?.headers?.cookie || '').split(';')) {
    const i = c.indexOf('=');
    if (i > 0 && c.slice(0, i).trim() === name) return c.slice(i + 1).trim();
  }
  return null;
};

export const SSO_ERRORS = {
  state: 'The sign-in link expired or was opened in a different browser. Try again.',
  access_denied: 'Sign-in was cancelled.',
  exchange: 'The sign-in could not be completed. Try again.',
  unverified: 'That account does not have a verified email address.',
  domain: 'Use your school account to sign in.',
  no_account: 'No Program Manager account uses this email address. Ask your head coach to add you with this address, then sign in again.',
  archived: 'This account is no longer on the roster.',
  not_configured: 'School sign-in is not set up for this program.',
};

export default function sso(ctx, { creds }) {
  const { router, db, core } = ctx;
  const googleCfg = (programId, origin) => G.config({ creds: creds.get(programId, 'google'), origin });
  const cleverCfg = (programId, origin) => cleverConfig({ creds: creds.get(programId, 'clever'), origin });
  const cfgFor = (provider, programId, origin) => (provider === 'google' ? googleCfg(programId, origin) : cleverCfg(programId, origin));

  // Which school sign-in buttons the sign-in page shows.
  function available(provider, origin) {
    return creds.programsWithSignin(provider).filter((p) => cfgFor(provider, p.program_id, origin).configured);
  }
  router.get('/api/auth/sso/providers', ({ req }) => {
    const origin = G.originFrom(req);
    const out = {};
    for (const p of ['google', 'clever']) out[p] = available(p, origin).map((x) => ({ id: x.program_id, name: x.name }));
    return out;
  }, { auth: false });

  router.post('/api/auth/sso/:provider/start', ({ params, body, res, req }) => {
    const provider = params.provider;
    need(LABEL[provider], 404, 'Unknown sign-in provider');
    const origin = G.originFrom(req);
    const list = available(provider, origin);
    need(list.length, 503, `Sign-in with ${LABEL[provider]} is not set up. The head coach turns it on under Settings › Integrations › Setup.`);
    const prog = body.program_id ? list.find((p) => p.program_id === Number(body.program_id)) : list.length === 1 ? list[0] : null;
    need(prog, 400, 'Choose your program first');
    const cfg = cfgFor(provider, prog.program_id, origin);
    need(cfg.appUrl, 503, 'The app address is unknown. Set APP_URL in the server environment.');
    const state = token(24);
    const nonce = token(18);
    db.run('DELETE FROM sso_states WHERE created_at<?', Date.now() - STATE_TTL_MS);
    let handoff = null; let browser = null;
    if (body.desktop) handoff = createHandoff(db, { kind: 'signin', provider, state });
    else {
      // Binds the flow to this browser so someone else's sign-in link cannot sign you in to their account.
      browser = token(18);
      res.headers['Set-Cookie'] = `pm_sso=${browser}; HttpOnly; Path=/api/auth; SameSite=Lax; Max-Age=${STATE_TTL_MS / 1000}`;
    }
    db.run('INSERT INTO sso_states (state, provider, program_id, nonce, browser_hash, handoff_hash, created_at) VALUES (?,?,?,?,?,?,?)',
      state, provider, prog.program_id, nonce, browser ? sha(browser) : null, handoff ? sha(handoff.handoff) : null, Date.now());
    const url = provider === 'google' ? G.signinUrl(cfg, { state, nonce, hd: prog.options.hd || null }) : cleverAuthorizeUrl(cfg, { state });
    return { url, ...(handoff ? { handoff: handoff.handoff, code: handoff.code } : {}) };
  }, { auth: false });

  async function identify(provider, cfg, st, code, options) {
    if (provider === 'google') {
      const tok = await G.exchangeSigninCode(cfg, code);
      const c = G.claimsFromIdToken(tok.id_token);
      // The ID token came straight from Google's token endpoint over TLS with our secret, so its claims are
      // trusted without a signature check (OpenID Connect Core 3.1.3.7); audience, issuer, expiry and nonce are still checked.
      const aud = Array.isArray(c?.aud) ? c.aud : [c?.aud];
      if (!c || !aud.includes(cfg.clientId) || !cfg.issuers.includes(c.iss) || !(Number(c.exp) * 1000 > Date.now()) || c.nonce !== st.nonce) return { error: 'exchange' };
      if (!c.email || !(c.email_verified === true || c.email_verified === 'true')) return { error: 'unverified' };
      const hd = String(options.hd || '').trim().toLowerCase();
      if (hd && String(c.hd || '').toLowerCase() !== hd) return { error: 'domain', email: c.email };
      return { email: c.email, name: c.name || null };
    }
    const tok = await cleverExchange(cfg, code);
    const who = await cleverIdentity(cfg, tok.access_token);
    if (!who.email) return { error: 'unverified' };
    return { email: who.email, name: who.name };
  }

  async function callback(provider, { query, req }) {
    const origin = G.originFrom(req);
    const st = query.state ? db.get('SELECT * FROM sso_states WHERE state=? AND provider=?', String(query.state), provider) : null;
    if (st) db.run('DELETE FROM sso_states WHERE state=?', st.state); // single use
    const h = st?.handoff_hash ? db.get('SELECT * FROM auth_handoffs WHERE handoff_hash=?', st.handoff_hash) : null;
    const browserCookie = cookieOf(req, 'pm_sso');
    const clear = { 'Set-Cookie': 'pm_sso=; HttpOnly; Path=/api/auth; Max-Age=0' };
    const fail = (code, extra = {}) => {
      if (h) {
        finishHandoff(db, h, { error: SSO_ERRORS[code] || 'Sign-in failed.' });
        return resultPage({ title: 'Sign-in did not finish', message: `${SSO_ERRORS[code] || 'Sign-in failed.'} Go back to Program Manager to try again.`, ok: false });
      }
      const q = new URLSearchParams({ sso_error: code, ...(extra.email ? { email: extra.email } : {}) });
      return resultPage({ title: 'Signing in', message: 'Returning to the app…', redirect: `/?${q}`, headers: clear });
    };
    if (!st || st.created_at < Date.now() - STATE_TTL_MS) return fail('state');
    if (!h && !(st.browser_hash && browserCookie && sha(browserCookie) === st.browser_hash)) return fail('state');
    if (h && h.created_at < Date.now() - HANDOFF_TTL_MS) return fail('state');
    if (query.error) return fail(query.error === 'access_denied' ? 'access_denied' : 'exchange');
    if (!query.code) return fail('exchange');
    const cfg = cfgFor(provider, st.program_id, origin);
    if (!cfg.configured) return fail('not_configured');
    const options = creds.get(st.program_id, provider)?.options || {};
    if (!options.sso) return fail('not_configured');
    let who;
    try { who = await identify(provider, cfg, st, String(query.code), options); } catch { return fail('exchange'); }
    if (who.error) return fail(who.error, who);
    const u = db.get('SELECT * FROM users WHERE lower(email)=lower(?) AND active=1 AND program_id=?', who.email, st.program_id);
    if (!u) {
      db.insert('audit', { program_id: st.program_id, user_id: null, action: 'sso_rejected', entity: 'user', entity_id: null, detail: JSON.stringify({ provider, reason: 'no_account', email: who.email }) });
      return fail('no_account', { email: who.email });
    }
    if (u.role === 'player' && db.get('SELECT archived FROM player_profiles WHERE user_id=?', u.id)?.archived) return fail('archived');
    // A verified school address proves the invite reached its owner.
    if (u.invite_code) db.update('users', u.id, { invite_code: null, joined_at: u.joined_at || nowLocal() });
    if (h) {
      finishHandoff(db, h, { userId: u.id });
      return resultPage({ title: 'You are signed in', message: `Signed in as ${who.email}. You can return to Program Manager.`, code: h.code });
    }
    const out = { headers: {} };
    ctx.auth.signIn(u, out, provider);
    return resultPage({ title: 'Signing in', message: 'Returning to the app…', redirect: '/', headers: { 'Set-Cookie': [out.headers['Set-Cookie'], clear['Set-Cookie']] } });
  }
  router.get('/api/auth/google/callback', (c) => callback('google', c), { auth: false });
  router.get('/api/auth/clever/callback', (c) => callback('clever', c), { auth: false });

  // The desktop app polls this with its secret hand-off value.
  router.post('/api/auth/handoff', ({ body, res }) => {
    need(typeof body.handoff === 'string' && body.handoff.length >= 20, 400, 'Missing hand-off');
    const h = db.get('SELECT * FROM auth_handoffs WHERE handoff_hash=?', sha(body.handoff));
    if (!h) return { status: 'expired' };
    if (h.created_at < Date.now() - HANDOFF_TTL_MS) { db.run('DELETE FROM auth_handoffs WHERE handoff_hash=?', h.handoff_hash); return { status: 'expired' }; }
    if (h.status === 'pending') return { status: 'pending', code: h.code };
    db.run('DELETE FROM auth_handoffs WHERE handoff_hash=?', h.handoff_hash);
    if (h.status === 'error') return { status: 'error', message: h.message };
    if (h.kind === 'signin') {
      const u = db.get('SELECT * FROM users WHERE id=? AND active=1', h.user_id);
      need(u, 401, 'This account is no longer active');
      const r = ctx.auth.signIn(u, res, `${h.provider}_desktop`);
      return { status: 'done', twofa: r.twofa, token: r.token };
    }
    return { status: 'done', kind: h.kind };
  }, { auth: false });
}

export { handoffForState };
