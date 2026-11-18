// Google OAuth 2.0 and REST client with plain fetch, plus AES-256-GCM encryption of tokens at rest.
// Tokens never leave this file in responses or logs: callers get parsed API data only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from '../core.js';

// Feature -> scopes (incremental authorization asks only for what the user picks).
export const FEATURES = {
  gmail: { label: 'Gmail', scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.modify'], help: 'Turn labeled emails into calendar drafts, label imported mail, and optionally send program email.' },
  calendar: { label: 'Google Calendar', scopes: ['https://www.googleapis.com/auth/calendar'], help: 'Push team events to a Google calendar and import events for review.' },
  sheets: { label: 'Google Sheets', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'], help: 'Import the roster and test maxes; export roster, attendance and equipment lists.' },
  docs: { label: 'Google Docs', scopes: ['https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/drive.file'], help: 'Export practice plans and season reports as Google Docs.' },
};
// openid/email/profile let the app show which Google account is connected (email, name and photo).
export const BASE_SCOPES = ['openid', 'email', 'profile'];
export const SIGNIN_SCOPES = ['openid', 'email', 'profile'];
export const SCOPE = {
  gmailRead: 'https://www.googleapis.com/auth/gmail.readonly', gmailSend: 'https://www.googleapis.com/auth/gmail.send', gmailModify: 'https://www.googleapis.com/auth/gmail.modify',
  calendar: 'https://www.googleapis.com/auth/calendar', sheets: 'https://www.googleapis.com/auth/spreadsheets', docs: 'https://www.googleapis.com/auth/documents', driveFile: 'https://www.googleapis.com/auth/drive.file',
};
export const featuresFromScopes = (scopes) => Object.keys(FEATURES).filter((f) => FEATURES[f].scopes.every((s) => scopes.includes(s)));

// The public address of the app: APP_URL when set, otherwise the address the request came in on
// (X-Forwarded-Proto / X-Forwarded-Host from a proxy such as Render, else the Host header).
export function originFrom(req) {
  if (!req || !req.headers) return '';
  const h = req.headers;
  const first = (v) => String(v || '').split(',')[0].trim();
  const host = first(h['x-forwarded-host']) || first(h.host);
  if (!host || !/^[a-z0-9.\-:[\]]+$/i.test(host)) return '';
  let proto = first(h['x-forwarded-proto']).toLowerCase();
  if (proto !== 'http' && proto !== 'https') proto = req.socket?.encrypted ? 'https' : 'http';
  return `${proto}://${host}`;
}
export function appUrlFor(origin) {
  return (process.env.APP_URL || origin || '').replace(/\/+$/, '');
}
export const REDIRECT_PATHS = { connect: '/api/google/callback', google: '/api/auth/google/callback', clever: '/api/auth/clever/callback' };

// creds: the Client ID and secret the head coach saved in the app ({ client_id, client_secret }), or null.
// Saved credentials win; GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are the fallback.
export function config({ creds = null, origin = '' } = {}) {
  const env = process.env;
  const appUrl = appUrlFor(origin);
  const fromApp = !!(creds && creds.client_id && creds.client_secret);
  const clientId = fromApp ? creds.client_id : env.GOOGLE_CLIENT_ID;
  const clientSecret = fromApp ? creds.client_secret : env.GOOGLE_CLIENT_SECRET;
  const missing = fromApp ? [] : ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].filter((k) => !env[k]);
  const apiBase = (env.GOOGLE_API_BASE || '').replace(/\/+$/, '');
  return {
    configured: !missing.length, missing, source: fromApp ? 'app' : missing.length ? null : 'env',
    clientId, clientSecret, appUrl, appUrlFromEnv: !!env.APP_URL,
    redirectUri: appUrl ? `${appUrl}${REDIRECT_PATHS.connect}` : null,
    signinRedirectUri: appUrl ? `${appUrl}${REDIRECT_PATHS.google}` : null,
    issuers: env.GOOGLE_ISSUER ? [env.GOOGLE_ISSUER] : ['https://accounts.google.com', 'accounts.google.com'],
    authUrl: env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    revokeUrl: env.GOOGLE_REVOKE_URL || (apiBase ? `${apiBase}/revoke` : 'https://oauth2.googleapis.com/revoke'),
    hosts: apiBase ? { gmail: apiBase, calendar: apiBase, sheets: apiBase, docs: apiBase, drive: apiBase, upload: apiBase, userinfo: apiBase }
      : { gmail: 'https://gmail.googleapis.com', calendar: 'https://www.googleapis.com', sheets: 'https://sheets.googleapis.com', docs: 'https://docs.googleapis.com', drive: 'https://www.googleapis.com', upload: 'https://www.googleapis.com', userinfo: 'https://openidconnect.googleapis.com' },
    tokenKeyFromEnv: !!env.TOKEN_KEY,
  };
}
export function notConfiguredMessage(cfg = config()) {
  return `Google is not set up yet. The head coach adds the Google Client ID and Client secret under Settings › Integrations › Setup (or sets ${cfg.missing.join(', ')} in the server environment). See docs/google-setup.md.`;
}
export function requireConfigured(cfg = config()) {
  if (!cfg.configured) throw new HttpError(503, notConfiguredMessage(cfg));
  return cfg;
}

// ---------- token encryption (AES-256-GCM, key from TOKEN_KEY via scrypt) ----------
export function createVault(db) {
  let key = null;
  function secret() {
    if (process.env.TOKEN_KEY) return process.env.TOKEN_KEY;
    const file = db.get('PRAGMA database_list')?.file || '';
    if (!file) {
      // In-memory database (tests): a per-process key is enough because the data dies with the process.
      console.warn('[google] TOKEN_KEY is not set; using a temporary key for this in-memory database.');
      return crypto.randomBytes(32).toString('hex');
    }
    const keyFile = path.join(path.dirname(file), '.token-key');
    if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf8').trim();
    const k = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyFile, k + '\n', { mode: 0o600 });
    console.warn(`[google] TOKEN_KEY is not set. Generated a key and saved it to ${keyFile}. Set TOKEN_KEY in the environment for production; losing the key means users must reconnect Google.`);
    return k;
  }
  const getKey = () => (key ||= crypto.scryptSync(secret(), 'program-manager:google-tokens:v1', 32));
  return {
    encrypt(plain) {
      if (plain == null) return null;
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
      const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
      return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
    },
    decrypt(enc) {
      if (!enc) return null;
      const buf = Buffer.from(String(enc).replace(/^v1:/, ''), 'base64');
      const d = crypto.createDecipheriv('aes-256-gcm', getKey(), buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
    },
  };
}

// ---------- OAuth ----------
export function authorizeUrl(cfg, { state, scopes, loginHint }) {
  const q = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: scopes.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  if (loginHint) q.set('login_hint', loginHint);
  return `${cfg.authUrl}?${q}`;
}
// OpenID Connect sign-in ("Sign in with Google"): no offline access, just who the person is.
export function signinUrl(cfg, { state, nonce, hd }) {
  const q = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.signinRedirectUri, response_type: 'code', scope: SIGNIN_SCOPES.join(' '),
    state, nonce, prompt: 'select_account',
  });
  if (hd) q.set('hd', hd);
  return `${cfg.authUrl}?${q}`;
}
export async function exchangeSigninCode(cfg, code) {
  const r = await postForm(cfg.tokenUrl, { code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.signinRedirectUri, grant_type: 'authorization_code' });
  if (!r.ok || !r.data.id_token) throw new HttpError(400, `Google sign-in failed: ${r.data.error_description || r.data.error || r.status}`);
  return r.data;
}
// Checks a Client ID / secret pair without a user: Google answers invalid_client for a wrong pair and
// invalid_grant for a made-up code when the pair is right.
export async function checkClient(cfg) {
  const r = await postForm(cfg.tokenUrl, { code: 'program-manager-check', client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri || 'https://localhost/api/google/callback', grant_type: 'authorization_code' });
  if (r.data.error === 'invalid_client' || r.data.error === 'unauthorized_client') return { ok: false, error: 'Google did not accept this Client ID and Client secret. Copy both again from Google Cloud › Credentials.' };
  if (r.data.error === 'invalid_grant' || r.data.error === 'redirect_uri_mismatch' || r.ok) return { ok: true };
  return { ok: false, error: `Google answered: ${r.data.error_description || r.data.error || `HTTP ${r.status}`}` };
}
async function postForm(url, params) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(15000) });
  } catch (e) { throw new HttpError(502, `Could not reach Google (${e.name === 'TimeoutError' ? 'timed out' : 'network error'})`); }
  const text = await res.text();
  let data = {}; try { data = JSON.parse(text); } catch { /* not json */ }
  return { ok: res.ok, status: res.status, data };
}
export async function exchangeCode(cfg, code) {
  const r = await postForm(cfg.tokenUrl, { code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code' });
  if (!r.ok || !r.data.access_token) throw new HttpError(400, `Google sign-in failed: ${r.data.error_description || r.data.error || r.status}`);
  return r.data;
}
export async function refreshAccess(cfg, refreshToken) {
  const r = await postForm(cfg.tokenUrl, { refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' });
  if (!r.ok || !r.data.access_token) {
    const e = new HttpError(r.data.error === 'invalid_grant' ? 401 : 502, r.data.error === 'invalid_grant' ? 'Google access was revoked or expired. Reconnect Google under Integrations.' : `Google token refresh failed (${r.data.error || r.status})`);
    e.revoked = r.data.error === 'invalid_grant';
    throw e;
  }
  return r.data;
}
export async function revoke(cfg, tokenValue) {
  try { const r = await postForm(cfg.revokeUrl, { token: tokenValue }); return r.ok; } catch { return false; }
}
// Email from the id_token returned directly by the token endpoint over TLS (no signature check needed there).
export function emailFromIdToken(idToken) {
  return claimsFromIdToken(idToken)?.email || null;
}
export function claimsFromIdToken(idToken) {
  try { return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
}
export { postForm };

// ---------- REST calls ----------
// getAccess(force) returns a valid access token (refreshing when needed); it is supplied by the module.
export async function gfetch(cfg, getAccess, service, p, { method = 'GET', query, body, raw, contentType, headers = {} } = {}) {
  const url = `${cfg.hosts[service]}${p}${query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== ''))}` : ''}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const access = await getAccess(attempt > 0);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${access}`, ...(body !== undefined || raw !== undefined ? { 'Content-Type': contentType || 'application/json' } : {}), ...headers },
        body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) { throw new HttpError(502, `Could not reach Google ${service} (${e.name === 'TimeoutError' ? 'timed out' : 'network error'})`); }
    if (res.status === 401 && attempt === 0) continue;
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data && data.error && (data.error.message || data.error)) || `HTTP ${res.status}`;
      const e = new HttpError(res.status === 404 ? 404 : res.status === 403 ? 403 : 502, `Google ${service}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
      e.googleStatus = res.status;
      throw e;
    }
    return data;
  }
  throw new HttpError(401, 'Google rejected the access token. Reconnect Google under Integrations.');
}
