// Clever Instant Login (OAuth 2.0 authorization code). Every endpoint can be overridden by env for tests.
import { HttpError } from '../core.js';
import { appUrlFor, REDIRECT_PATHS } from './client.js';

export function cleverConfig({ creds = null, origin = '' } = {}) {
  const env = process.env;
  const appUrl = appUrlFor(origin);
  const fromApp = !!(creds && creds.client_id && creds.client_secret);
  const clientId = fromApp ? creds.client_id : env.CLEVER_CLIENT_ID;
  const clientSecret = fromApp ? creds.client_secret : env.CLEVER_CLIENT_SECRET;
  const missing = fromApp ? [] : ['CLEVER_CLIENT_ID', 'CLEVER_CLIENT_SECRET'].filter((k) => !env[k]);
  const apiBase = (env.CLEVER_API_BASE || 'https://api.clever.com').replace(/\/+$/, '');
  return {
    configured: !missing.length, missing, source: fromApp ? 'app' : missing.length ? null : 'env', clientId, clientSecret, appUrl,
    redirectUri: appUrl ? `${appUrl}${REDIRECT_PATHS.clever}` : null,
    authUrl: env.CLEVER_AUTH_URL || 'https://clever.com/oauth/authorize',
    tokenUrl: env.CLEVER_TOKEN_URL || 'https://clever.com/oauth/tokens',
    meUrl: env.CLEVER_ME_URL || `${apiBase}/v3.0/me`,
    apiBase,
  };
}

export function cleverAuthorizeUrl(cfg, { state }) {
  const q = new URLSearchParams({ response_type: 'code', client_id: cfg.clientId, redirect_uri: cfg.redirectUri, state });
  return `${cfg.authUrl}?${q}`;
}

async function call(url, init, what) {
  let res;
  try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) }); } catch (e) {
    throw new HttpError(502, `Could not reach Clever (${e.name === 'TimeoutError' ? 'timed out' : 'network error'})`);
  }
  const text = await res.text();
  let data = {}; try { data = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) throw new HttpError(400, `Clever ${what} failed: ${data.error_description || data.error || res.status}`);
  return data;
}

export async function cleverExchange(cfg, code) {
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const data = await call(cfg.tokenUrl, {
    method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, grant_type: 'authorization_code', redirect_uri: cfg.redirectUri }),
  }, 'sign-in');
  if (!data.access_token) throw new HttpError(400, 'Clever sign-in failed: no access token');
  return data;
}

// Checks a Client ID / secret pair: a wrong pair is refused as invalid_client, a right one fails on the made-up code.
export async function cleverCheck(cfg) {
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  let res; let data = {};
  try {
    res = await fetch(cfg.tokenUrl, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: 'program-manager-check', grant_type: 'authorization_code', redirect_uri: cfg.redirectUri || '' }), signal: AbortSignal.timeout(15000) });
    try { data = JSON.parse(await res.text()); } catch { /* not json */ }
  } catch { return { ok: false, error: 'Could not reach Clever.' }; }
  if (res.status === 401 || data.error === 'invalid_client') return { ok: false, error: 'Clever did not accept this Client ID and Client secret.' };
  return { ok: true };
}

// Who signed in: /v3.0/me gives the user's id and type; the email is on the user record.
export async function cleverIdentity(cfg, accessToken) {
  const auth = { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } };
  const me = await call(cfg.meUrl, auth, 'profile');
  const d = me.data || {};
  let email = d.email || null; let name = d.name || null;
  if (!email && d.id) {
    const u = await call(`${cfg.apiBase}/v3.0/users/${encodeURIComponent(d.id)}`, auth, 'profile');
    email = u.data?.email || null;
    name = u.data?.name || name;
  }
  const fullName = name && typeof name === 'object' ? [name.first, name.last].filter(Boolean).join(' ') : name;
  return { id: d.id || null, type: d.type || me.type || null, email, name: fullName || null };
}
