// API client with an offline queue for field actions (attendance, notes, ratings, workout logs).
const QKEY = 'pm.queue.v1';
const listeners = new Set();

export class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

function readQueue() { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } }
function writeQueue(q) { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch { /* storage full or blocked */ } listeners.forEach((fn) => fn(q.length)); }
export const queueLength = () => readQueue().length;
export const onQueueChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export async function api(path, { method = 'GET', body, offline = false } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (offline && method !== 'GET') {
      const q = readQueue();
      q.push({ path, method, body, at: new Date().toISOString() });
      writeQueue(q);
      return { queued: true };
    }
    throw new ApiError(0, 'You appear to be offline');
  }
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (res.status === 503 && data && data.offline && offline && method !== 'GET') {
    const q = readQueue(); q.push({ path, method, body, at: new Date().toISOString() }); writeQueue(q);
    return { queued: true };
  }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`, data);
  return data;
}
api.get = (p) => api(p);
api.post = (p, body, opts = {}) => api(p, { method: 'POST', body: body ?? {}, ...opts });
api.put = (p, body) => api(p, { method: 'PUT', body: body ?? {} });
api.del = (p) => api(p, { method: 'DELETE' });

let flushing = false;
export async function flushQueue() {
  if (flushing || !navigator.onLine) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0; let failed = 0; const failures = [];
  try {
    let q = readQueue();
    while (q.length) {
      const item = q[0];
      try {
        const r = await fetch(item.path, { method: item.method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.body) });
        if (r.status >= 500 || r.status === 0) break;
        if (!r.ok) { failed++; failures.push((await r.json().catch(() => ({}))).error || r.status); } else sent++;
      } catch { break; }
      q = readQueue(); q.shift(); writeQueue(q);
    }
  } finally { flushing = false; }
  return { sent, failed, failures };
}
