// Small UI toolkit: safe HTML templating, DOM helpers, modals, toasts, formatting, charts, pickers.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => ({ __html: String(s ?? '') });
function rend(v) {
  if (v == null || v === false || v === true) return '';
  if (Array.isArray(v)) return v.map(rend).join('');
  if (typeof v === 'object' && v.__html !== undefined) return v.__html;
  return esc(String(v));
}
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += rend(vals[i]); });
  return raw(out);
}
export const set = (el, h) => { el.innerHTML = rend(h); return el; };
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export function on(el, evt, sel, fn) {
  const h = (e) => { const t = e.target.closest(sel); if (t && el.contains(t)) fn(e, t); };
  el.addEventListener(evt, h);
  return () => el.removeEventListener(evt, h);
}

// ---------- toasts ----------
let toastBox;
export function toast(msg, kind = '') {
  if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'toasts'; toastBox.setAttribute('role', 'status'); document.body.appendChild(toastBox); }
  const t = document.createElement('div');
  t.className = `toast ${kind}`; t.textContent = msg;
  toastBox.appendChild(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 3500);
}
export const errToast = (e) => toast(e?.message || String(e), 'bad');

// ---------- modal ----------
export function modal({ title, body, wide = false, actions = [], onOpen }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = rend(html`<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="hd"><h2>${title}</h2><button class="ghost icon" data-x aria-label="Close">✕</button></div>
    <div class="bd">${body}</div>
    ${actions.length ? html`<div class="ft">${actions.map((a, i) => html`<button data-a="${i}" class="${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}">${a.label}</button>`)}</div>` : ''}
  </div>`);
  const close = () => { bg.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  bg.querySelector('[data-x]').onclick = close;
  const root = bg.querySelector('.modal');
  bg.querySelectorAll('[data-a]').forEach((b) => {
    b.onclick = async () => {
      const a = actions[Number(b.dataset.a)];
      if (!a.onClick) return close();
      b.disabled = true;
      try { const r = await a.onClick(root, close); if (r !== false) close(); } catch (e) { errToast(e); } finally { b.disabled = false; }
    };
  });
  document.body.appendChild(bg);
  const first = root.querySelector('.bd input, .bd select, .bd textarea');
  if (first) setTimeout(() => first.focus(), 30);
  if (onOpen) onOpen(root, close);
  return { root, close };
}
export function confirmDialog(message, { title = 'Please confirm', ok = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = modal({ title, body: html`<p>${message}</p>`, actions: [{ label: 'Cancel', onClick: () => resolve(false) }, { label: ok, primary: !danger, danger, onClick: () => resolve(true) }] });
    m.root.closest('.modal-bg').querySelector('[data-x]').addEventListener('click', () => resolve(false));
  });
}

// ---------- forms ----------
export function formData(root) {
  const out = {};
  for (const el of root.querySelectorAll('[name]')) {
    const k = el.name;
    if (el.type === 'checkbox') {
      if (el.dataset.multi !== undefined || root.querySelectorAll(`[name="${k}"]`).length > 1) { out[k] ||= []; if (el.checked) out[k].push(el.dataset.num !== undefined ? Number(el.value) : el.value); } else out[k] = el.checked;
    } else if (el.type === 'radio') { if (el.checked) out[k] = el.value; } else if (el.multiple) out[k] = [...el.selectedOptions].map((o) => o.value);
    else if (el.type === 'number' || el.dataset.num !== undefined) out[k] = el.value === '' ? null : Number(el.value);
    else out[k] = el.value;
  }
  return out;
}
export const opt = (value, label, selected) => html`<option value="${value}" ${String(selected) === String(value) ? raw('selected') : ''}>${label}</option>`;
export const options = (list, selected, { blank } = {}) => [blank !== undefined ? opt('', blank, selected ?? '') : '', ...list.map((o) => (Array.isArray(o) ? opt(o[0], o[1], selected) : opt(o, o, selected)))];
export const checked = (b) => (b ? raw('checked') : '');
export const field = (label, control, help) => html`<div class="field"><label>${label}</label>${control}${help ? html`<div class="help">${help}</div>` : ''}</div>`;

// Audience picker (shared by calendar, playbook, chats, assignments, weights)
export function audienceField(name, list, selected = [], { exclude = [] } = {}) {
  const groups = {};
  for (const a of list) if (!exclude.includes(a.token) && !exclude.includes(a.kind)) (groups[a.kind] ||= []).push(a);
  const sel = new Set(selected);
  return html`<div class="aud-picker" style="border:1px solid var(--border-strong);border-radius:5px;max-height:220px;overflow-y:auto;padding:6px 10px">
    <input type="search" placeholder="Filter groups and players" data-aud-filter style="margin-bottom:6px">
    ${Object.entries(groups).map(([kind, items]) => html`<div data-aud-group><div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin:6px 0 2px">${kind}</div>
      ${items.map((a) => html`<label class="check" style="display:flex;padding:2px 0" data-aud-item="${a.label.toLowerCase()}"><input type="checkbox" name="${name}" data-multi value="${a.token}" ${checked(sel.has(a.token))}> ${a.label}</label>`)}</div>`)}
  </div>`;
}
export function wireAudience(root) {
  root.querySelectorAll('[data-aud-filter]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const q = inp.value.toLowerCase();
      const box = inp.closest('.aud-picker');
      box.querySelectorAll('[data-aud-item]').forEach((l) => { l.style.display = !q || l.dataset.audItem.includes(q) ? 'flex' : 'none'; });
    });
  });
}

// ---------- formatting ----------
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const pad = (n) => String(n).padStart(2, '0');
export const parse = (s) => { if (!s) return null; const [d, t = '00:00'] = String(s).replace(' ', 'T').split('T'); const [y, m, dd] = d.split('-').map(Number); const [hh, mm] = t.split(':').map(Number); return new Date(y, m - 1, dd, hh || 0, mm || 0); };
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isoDT = (d) => `${iso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const todayISO = () => iso(new Date());
export const nowISO = () => isoDT(new Date());
export function fmtDate(s, { year = false, dow = true } = {}) { const d = parse(s); if (!d) return ''; return `${dow ? DOW[d.getDay()] + ' ' : ''}${MON[d.getMonth()]} ${d.getDate()}${year ? ', ' + d.getFullYear() : ''}`; }
export function fmtTime(s) { const d = parse(s); if (!d) return ''; const h = d.getHours(); return `${((h + 11) % 12) + 1}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`; }
export const fmtDT = (s) => (s ? `${fmtDate(s)} · ${fmtTime(s)}` : '');
export function fmtHM(hm) { if (!hm) return ''; return fmtTime(`2000-01-01T${hm}`); }
export function ago(s) {
  const d = parse(s); if (!d) return '';
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`; if (m < 1440) return `${Math.round(m / 60)} h ago`;
  if (m < 10080) return `${Math.round(m / 1440)} d ago`; return fmtDate(s);
}
export const addDaysISO = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const mondayOf = (s) => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
export const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).replace(/_/g, ' ') : '');
export const ROLE = { head_coach: 'Head coach', coach: 'Coach', trainer: 'Trainer', staff: 'Staff', player: 'Player', parent: 'Parent' };
export const UNIT = { offense: 'Offense', defense: 'Defense', special: 'Special teams' };
export const initials = (n) => String(n || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
export const avatar = (name, photo, cls = '') => html`<span class="av ${cls}">${photo ? html`<img src="${photo}" alt="">` : initials(name)}</span>`;
export function availBadge(a) {
  if (!a) return '';
  return html`<span class="badge ${a === 'available' ? 'ok' : a === 'limited' ? 'warn' : 'bad'}">${cap(a)}</span>`;
}
const ST = { present: 'ok', late: 'warn', left_early: 'warn', excused: 'blue', unexcused: 'bad', going: 'ok', not_going: 'bad', maybe: 'warn', completed: 'ok', in_progress: 'blue', not_started: '', late_asn: 'bad', scheduled: '', indoors: 'blue', delayed: 'warn', cancelled: 'bad', done: 'ok', skipped: '', changed: 'warn', pending: '' };
export const statusBadge = (s, label) => html`<span class="badge ${ST[s] ?? ''}">${label || cap(s === 'not_going' ? 'not going' : s)}</span>`;
export const empty = (msg) => html`<div class="empty">${msg}</div>`;
export const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
export const bar = (v, cls = '') => html`<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, v || 0))}%"></i></div>`;

// ---------- charts (inline SVG) ----------
export function lineChart(series, { height = 180, yMin, yMax, labels = true, yFmt = (v) => v } = {}) {
  const W = 600; const H = height; const P = { l: 36, r: 10, t: 10, b: 24 };
  const all = series.flatMap((s) => s.points);
  if (!all.length) return empty('No data yet');
  const xs = [...new Set(all.map((p) => p[0]))].sort();
  const ys = all.map((p) => p[1]);
  const lo = yMin ?? Math.min(...ys); const hi = yMax ?? Math.max(...ys);
  const span = hi - lo || 1;
  const x = (k) => P.l + (xs.length === 1 ? (W - P.l - P.r) / 2 : (xs.indexOf(k) / (xs.length - 1)) * (W - P.l - P.r));
  const y = (v) => P.t + (1 - (v - lo) / span) * (H - P.t - P.b);
  const colors = ['var(--accent)', 'var(--faint)', 'var(--blue)', 'var(--warn)'];
  const ticks = [lo, lo + span / 2, hi];
  const step = Math.max(1, Math.ceil(xs.length / 6));
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend chart">
    <g class="grid">${ticks.map((t) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${P.l - 6}" y="${y(t) + 3}" text-anchor="end">${esc(yFmt(Math.round(t * 10) / 10))}</text>`).join('')}</g>
    ${labels ? xs.map((k, i) => (i % step === 0 || i === xs.length - 1 ? `<text x="${x(k)}" y="${H - 6}" text-anchor="middle">${esc(String(k).length === 10 ? fmtDate(k, { dow: false }) : k)}</text>` : '')).join('') : ''}
    ${series.map((s, si) => { const pts = s.points.slice().sort((a, b) => (a[0] > b[0] ? 1 : -1)); const c = s.color || colors[si % colors.length]; return `<polyline fill="none" stroke="${c}" stroke-width="2" ${s.dashed ? 'stroke-dasharray="5 4"' : ''} points="${pts.map((p) => `${x(p[0])},${y(p[1])}`).join(' ')}"/>${pts.map((p) => `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="3" fill="${c}"><title>${esc(s.label)}: ${esc(p[1])}</title></circle>`).join('')}`; }).join('')}
  </svg>`);
}
export const legend = (items) => html`<div class="row" style="gap:14px;font-size:12px;color:var(--muted);margin-top:4px">${items.map((it, i) => html`<span class="row" style="gap:5px"><span style="width:14px;height:2px;background:${it.color || ['var(--accent)', 'var(--faint)', 'var(--blue)', 'var(--warn)'][i]};display:inline-block"></span>${it.label}</span>`)}</div>`;

// ---------- misc ----------
export function download(name, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function parseCSV(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const clean = rows.filter((r) => r.some((x) => x.trim()));
  if (!clean.length) return [];
  const head = clean[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return clean.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}
export function readFileAsDataURL(file, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) return reject(new Error(`File must be under ${Math.round(maxBytes / 1e6)} MB`));
    const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(file);
  });
}
export function tabs(items, active) {
  return html`<div class="tabs">${items.map(([key, label, href]) => html`<a href="${href}" class="${key === active ? 'on' : ''}">${label}</a>`)}</div>`;
}
export function sortRows(rows, key, dir = 1) {
  return rows.slice().sort((a, b) => { const x = a[key]; const y = b[key]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * dir; });
}
