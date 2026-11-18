// Desktop hand-off: Google (and Clever) refuse sign-in inside embedded browsers, so the Windows app opens these
// flows in the system browser. The app keeps a secret hand-off value that never goes through the browser and
// polls POST /api/auth/handoff with it; the browser finishes on the server's callback page, which marks the
// hand-off ready. Single use, valid for 15 minutes.
import crypto from 'node:crypto';
import { token } from '../core.js';

export const HANDOFF_TTL_MS = 15 * 60_000;
export const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const shortCode = () => Array.from(crypto.randomBytes(4), (b) => ALPHA[b % ALPHA.length]).join('');

export function createHandoff(db, { kind, provider, state, userId = null }) {
  const secret = token(32);
  const code = shortCode();
  db.run('DELETE FROM auth_handoffs WHERE created_at<?', Date.now() - HANDOFF_TTL_MS);
  db.run('INSERT INTO auth_handoffs (handoff_hash, kind, provider, state, user_id, code, created_at) VALUES (?,?,?,?,?,?,?)', sha(secret), kind, provider, state, userId, code, Date.now());
  return { handoff: secret, code };
}
export const handoffForState = (db, state) => (state ? db.get('SELECT * FROM auth_handoffs WHERE state=?', String(state)) : null);
export function finishHandoff(db, h, { userId, error } = {}) {
  if (!h) return;
  db.run('UPDATE auth_handoffs SET status=?, message=?, user_id=coalesce(?, user_id) WHERE handoff_hash=?', error ? 'error' : 'ready', error || null, userId ?? null, h.handoff_hash);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// A plain page for the system browser at the end of a desktop flow (or any flow that has nowhere to go back to).
export function resultPage({ title, message, ok = true, code = null, redirect = null, headers = {} }) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${redirect ? `<meta http-equiv="refresh" content="0;url=${esc(redirect)}">` : ''}<title>${esc(title)} · Program Manager</title>
<style>
:root{--bg:#fbfbfa;--panel:#fff;--line:#e7e7e3;--ink:#17171a;--muted:#6e6e78;--ok:#1f7a4a;--bad:#c0362c}
@media (prefers-color-scheme:dark){:root{--bg:#111113;--panel:#18181b;--line:#2a2a30;--ink:#ededef;--muted:#9d9da7;--ok:#4fbf86;--bad:#f07a70}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:14px/1.5 Inter,"Segoe UI",system-ui,sans-serif;padding:20px;box-sizing:border-box}
.box{max-width:420px;width:100%;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:22px 24px}
.brand{display:flex;gap:10px;align-items:center;margin-bottom:16px;font-weight:600}.mark{width:28px;height:28px;border-radius:6px;background:var(--ink);color:var(--panel);display:grid;place-items:center;font-weight:700}
h1{font-size:17px;margin:0 0 6px}.st{color:var(--${ok ? 'ok' : 'bad'})}p{color:var(--muted);margin:0 0 10px}
.code{font:600 18px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.18em;border:1px solid var(--line);border-radius:6px;padding:6px 10px;display:inline-block;color:var(--ink)}
</style></head><body><div class="box"><div class="brand"><div class="mark">P</div>Program Manager</div>
<h1 class="st">${esc(title)}</h1><p>${esc(message)}</p>
${code ? `<p>Code shown in the app: <span class="code">${esc(code)}</span></p>` : ''}
${redirect ? `<p><a href="${esc(redirect)}">Continue</a></p>` : '<p>You can close this tab.</p>'}
</div></body></html>`;
  return { __raw: true, type: 'text/html; charset=utf-8', headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers }, body };
}
