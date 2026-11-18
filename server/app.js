// HTTP server: static files, JSON API, session cookies, module registration.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createCore, createRouter, HttpError } from './core.js';

import authModule from './modules/auth.js';
import rosterModule from './modules/roster.js';
import calendarModule from './modules/calendar.js';
import practiceModule from './modules/practice.js';
import playbookModule from './modules/playbook.js';
import attendanceModule from './modules/attendance.js';
import weightsModule from './modules/weights.js';
import commsModule from './modules/comms.js';
import equipmentModule from './modules/equipment.js';
import assignmentsModule from './modules/assignments.js';
import seasonModule from './modules/season.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export function createApp({ dbFile = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'app.db'), dev = true } = {}) {
  const db = openDb(dbFile);
  const core = createCore(db);
  const router = createRouter();
  const ctx = { db, core, router, dev, ticks: [] };
  for (const m of [authModule, rosterModule, calendarModule, practiceModule, playbookModule, attendanceModule,
    weightsModule, commsModule, equipmentModule, assignmentsModule, seasonModule]) m(ctx);

  // Modules register periodic jobs (reminders, assignment nudges). Run every minute.
  const tick = () => { for (const fn of ctx.ticks) { try { fn(); } catch (e) { console.error('tick', e); } } };
  const interval = setInterval(tick, 60_000);
  interval.unref();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/feed/')) return await handleApi(req, res, url);
      return serveStatic(res, url.pathname);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: e.message || 'Server error' });
    }
  });

  async function handleApi(req, res, url) {
    const found = router.match(req.method, url.pathname);
    if (!found) return send(res, 404, { error: 'Not found' });
    const { route, params } = found;
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]));
    const sid = cookies.sid || (req.headers.authorization || '').replace(/^Bearer /, '') || null;
    const user = core.userFromSession(sid);
    if (route.opts.auth !== false) {
      if (!user) return send(res, 401, { error: 'Sign in required' });
      if (!user._session.verified && !route.opts.unverified) return send(res, 401, { error: 'Two-step verification required', twofa: true });
    }
    let body = {};
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      const chunks = [];
      let size = 0;
      for await (const c of req) { size += c.length; if (size > 8e6) throw new HttpError(413, 'Request too large'); chunks.push(c); }
      const text = Buffer.concat(chunks).toString('utf8');
      if (text) { try { body = JSON.parse(text); } catch { throw new HttpError(400, 'Invalid JSON'); } }
    }
    const query = Object.fromEntries(url.searchParams);
    const out = { headers: {} };
    const result = await route.handler({ user, params, query, body, db, core, sid, res: out, req });
    if (result && result.__raw) {
      res.writeHead(200, { 'Content-Type': result.type, ...(result.headers || {}) });
      return res.end(result.body);
    }
    send(res, 200, result ?? { ok: true }, out.headers);
  }

  function serveStatic(res, pathname) {
    let file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    fs.createReadStream(file).pipe(res);
  }

  return { server, db, core, ctx, tick, close: () => { clearInterval(interval); server.close(); db.raw.close(); } };
}

function send(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}

// Shared helpers for modules
export const csv = (rows, cols) => {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.map((c) => esc(c.label)).join(','), ...rows.map((r) => cols.map((c) => esc(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\n');
};
export const csvResponse = (name, text) => ({ __raw: true, type: 'text/csv; charset=utf-8', body: text, headers: { 'Content-Disposition': `attachment; filename="${name}"` } });
