// Module 5: Attendance — event picker, few-tap marking (all present then exceptions), planned absences from RSVPs,
// live dashboard, group filters, self check-in codes, offline marking with conflict review, reports and export.
import { api } from '../api.js';
import { html, set, $, $$, on, modal, toast, errToast, options, checked, fmtDT, fmtTime, fmtDate, ago, cap, empty, statusBadge, availBadge, bar, pct, todayISO, addDaysISO, UNIT, tabs, nowISO, esc } from '../ui.js';

// C-19: the stored 'late' status reads as Tardy and 'unexcused' as Absent.
const ST = [['present', 'Present'], ['late', 'Tardy'], ['left_early', 'Left early'], ['excused', 'Excused'], ['unexcused', 'Absent']];
const atabs = (a) => tabs([['events', 'Events', '/attendance'], ['reports', 'History and reports', '/attendance/reports']], a);

export default async function attendance(el, ctx) {
  if (ctx.route === '/attendance/reports') return reports(el, ctx);
  if (ctx.params.id) return sheet(el, ctx, Number(ctx.params.id));
  const [events, conflicts] = await Promise.all([api.get('/api/attendance/events'), api.get('/api/conflicts')]);
  const today = events.filter((e) => e.start.startsWith(todayISO()));
  const past = events.filter((e) => e.start < todayISO());
  const next = events.filter((e) => e.start > todayISO() + 'T23:59').reverse();
  const row = (e) => html`<li class="click type-${e.type}" onclick="__navigate('/attendance/${e.id}')"><div style="width:130px" class="s">${fmtDate(e.start)}<br>${fmtTime(e.start)}</div>
    <div class="grow"><div class="t">${e.title} ${e.status !== 'scheduled' ? statusBadge(e.status) : ''}</div><div class="s">${e.marked}/${e.expected} marked</div></div><div style="width:160px">${bar(pct(e.here, e.expected))}<div class="s">${e.here} present</div></div></li>`;
  set(el, html`<div class="page-head"><div><h1>Attendance</h1><div class="sub">Mark everyone present, then change the exceptions.</div></div></div>${atabs('events')}
    ${conflicts.length ? html`<div class="card" style="margin-bottom:14px"><div class="hd"><h2>Offline changes that conflict</h2><span class="r faint" style="font-size:12px">Both versions kept — choose one</span></div><ul class="list">${conflicts.map((c) => html`<li><div class="grow"><div class="t">${c.entity_key}</div><div class="s">Saved: ${cap(c.server_value.status)} · Offline edit by ${c.user_name}: ${cap(c.client_value.status)}</div></div><button class="sm" data-keep="server" data-c="${c.id}">Keep saved</button><button class="sm" data-keep="client" data-c="${c.id}">Use offline edit</button></li>`)}</ul></div>` : ''}
    <div class="grid g-side"><div class="stack">
      <div class="card"><div class="hd"><h2>Today</h2></div>${today.length ? html`<ul class="list">${today.map(row)}</ul>` : empty('No events today.')}</div>
      <div class="card"><div class="hd"><h2>Recent</h2></div>${past.length ? html`<ul class="list">${past.slice(0, 20).map(row)}</ul>` : empty('No recent events.')}</div>
    </div><div class="card"><div class="hd"><h2>Coming up</h2></div>${next.length ? html`<ul class="list">${next.slice(0, 12).map(row)}</ul>` : empty('Nothing coming up.')}</div></div>`);
  on(el, 'click', '[data-keep]', async (e, b) => { await api.post(`/api/conflicts/${b.dataset.c}/resolve`, { keep: b.dataset.keep }); toast('Resolved'); ctx.reload(); });
}

async function sheet(el, ctx, id) {
  const q = { ...ctx.query };
  const st = await api.get('/api/structure');
  let data = await api.get(`/api/attendance/${id}?${new URLSearchParams(q)}`);
  const loadedAt = nowISO();
  ctx.setTitle(`Attendance · ${data.event.title}`);
  const mine = ctx.me.user.role === 'coach' && ctx.me.scopes.length;
  const codes = [...new Set(st.positions.map((p) => p.code))];
  const teams = st.levels.flatMap((l) => l.teams.map((t) => [t.id, t.name === l.name ? t.name : `${l.name} ${t.name}`]));
  const local = {}; // optimistic statuses while offline
  const draw = () => {
    const c = data.counts;
    const isPlanned = (p) => p.attendance && !p.attendance.confirmed;
    set(el, html`<div class="page-head"><div><h1>${data.event.title}</h1><div class="sub">${fmtDT(data.event.start)} · ${data.event.location || ''}</div></div>
      <div class="actions"><a class="btn" href="/attendance">Events</a><a class="btn" href="/calendar/${id}">Event</a><button id="fbkiosk">Tablet kiosk</button><button id="code">${data.code ? `Check-in code: ${data.code.code}` : 'Show check-in code'}</button><button class="primary" id="all">Mark all present</button></div></div>
      ${data.conflicts ? html`<div class="notice warn">${data.conflicts} offline change(s) for this event conflict with newer edits. <a href="/attendance">Review</a></div>` : ''}
      <div class="grid g4" style="margin-bottom:12px">
        <div class="card stat"><div class="k">Present</div><div class="v" style="color:var(--ok)">${c.present + c.left_early}</div><div class="d">of ${c.expected} expected</div></div>
        <div class="card stat"><div class="k">Tardy</div><div class="v" style="color:var(--warn)">${c.late}</div></div>
        <div class="card stat"><div class="k">Not checked in</div><div class="v">${c.not_checked_in}</div><div class="d">${c.planned_absent} planned absence(s) to confirm</div></div>
        <div class="card stat"><div class="k">Absent</div><div class="v" style="color:var(--bad)">${c.excused + c.unexcused}</div><div class="d">${c.excused} excused · ${c.unexcused} unexcused · ${c.unavailable} limited/out</div></div>
      </div>
      <div class="filters">
        <select data-f="team_id"><option value="">All teams</option>${options(teams, q.team_id)}</select>
        <select data-f="unit"><option value="">All units</option>${options(Object.entries(UNIT), q.unit)}</select>
        <select data-f="position"><option value="">All positions</option>${options(codes, q.position)}</select>
        ${mine ? html`<label class="check"><input type="checkbox" id="mine" ${checked(q.mine)}> My group only</label>` : ''}
        <select id="show" style="width:auto">${options([['', 'Everyone'], ['not_in', 'Not checked in'], ['absent', 'Absent'], ['planned', 'Planned absences']], q.show || '')}</select>
        <span class="spacer"></span><span class="faint" style="font-size:12px">Live · refreshes every 15 s</span>
        ${c.planned_absent ? html`<button class="sm" id="confirm">Confirm ${c.planned_absent} planned absence(s)</button>` : ''}
      </div>
      <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th>#</th><th>Player</th><th>Group</th><th>Status</th><th>RSVP</th><th>Attendance</th><th>Reason</th></tr></thead><tbody>
      ${data.players.filter((p) => !q.show || (q.show === 'not_in' ? !p.attendance : q.show === 'absent' ? ['excused', 'unexcused'].includes(p.attendance?.status) : isPlanned(p))).map((p) => { const cur = local[p.id] || (p.attendance && p.attendance.confirmed ? p.attendance.status : null); return html`<tr class="att-row" data-pid="${p.id}">
        <td class="num">${p.jersey ?? ''}</td><td><b>${p.name}</b>${p.attendance?.source === 'self' ? html` <span class="badge blue">Self check-in</span>` : ''}</td>
        <td class="s">${p.team || ''} · ${p.positions.join('/')}</td><td>${availBadge(p.availability)}</td>
        <td>${p.rsvp ? statusBadge(p.rsvp.status) : html`<span class="faint">—</span>`}${isPlanned(p) ? html` <span class="badge warn">Planned: ${p.attendance.reason || 'absent'}</span>` : ''}</td>
        <td><div class="stbtns">${ST.map(([k, l]) => html`<button class="${cur === k ? `on ${k}` : ''}" data-st="${k}">${l}</button>`)}</div></td>
        <td><input class="sm" data-reason value="${p.attendance?.reason && p.attendance.reason !== 'RSVP' ? p.attendance.reason : ''}" placeholder="Reason" style="min-width:120px;min-height:28px"></td></tr>`; })}
      </tbody></table>${!data.players.length ? empty('No players expected for this event.') : ''}</div></div>`);
  };
  draw();
  const refresh = async () => { try { data = await api.get(`/api/attendance/${id}?${new URLSearchParams(q)}`); draw(); } catch { /* offline */ } };
  const timer = setInterval(() => { if (!document.body.contains(el)) return clearInterval(timer); if (!document.activeElement?.matches('input[data-reason]')) refresh(); }, 15000);
  el.addEventListener('change', (e) => {
    const f = e.target.closest('[data-f]'); if (f) { q[f.dataset.f] = f.value; ctx.navigate(`/attendance/${id}?${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v)))}`); }
    if (e.target.id === 'mine') { q.mine = e.target.checked ? '1' : ''; ctx.navigate(`/attendance/${id}?${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v)))}`); }
    if (e.target.id === 'show') { q.show = e.target.value; draw(); }
    if (e.target.matches('[data-reason]')) {
      const tr = e.target.closest('[data-pid]'); const pid = Number(tr.dataset.pid);
      const p = data.players.find((x) => x.id === pid);
      const status = local[pid] || p.attendance?.status; if (!status) return toast('Pick a status first', 'warn');
      mark(pid, status, e.target.value);
    }
  });
  const mark = async (pid, status, reason) => {
    local[pid] = status;
    const p = data.players.find((x) => x.id === pid);
    try {
      const r = await api.post(`/api/attendance/${id}/mark`, { player_id: pid, status, reason: reason ?? null, base_at: p.attendance?.at || loadedAt, client_at: nowISO() }, { offline: true });
      if (r.queued) toast('Saved on this device — will sync', 'warn');
      else if (r.conflict) toast('Someone else changed this player since you loaded the page; both versions were kept for review', 'warn');
      else { delete local[pid]; await refresh(); return; }
      draw();
    } catch (err) { delete local[pid]; errToast(err); draw(); }
  };
  on(el, 'click', '[data-st]', (e, b) => { const tr = b.closest('[data-pid]'); mark(Number(tr.dataset.pid), b.dataset.st, tr.querySelector('[data-reason]').value || null); });
  on(el, 'click', '#all', async () => {
    const ids = data.players.filter((p) => !p.attendance).map((p) => p.id);
    try { const r = await api.post(`/api/attendance/${id}/all-present`, { player_ids: ids }, { offline: true }); toast(r.queued ? 'Saved offline' : `${r.marked} marked present. Now change the exceptions.`); refresh(); } catch (err) { errToast(err); }
  });
  on(el, 'click', '#fbkiosk', async () => (await import('./fb-attendance.js')).startKiosk(ctx, id));
  on(el, 'click', '#confirm', async () => { const r = await api.post(`/api/attendance/${id}/confirm`, {}); toast(`${r.confirmed} planned absence(s) confirmed as excused`); refresh(); });
  on(el, 'click', '#code', async () => {
    const r = data.code ? { code: data.code.code, expires_at: data.code.expires_at } : await api.post(`/api/attendance/${id}/code`, { minutes: 120 });
    const url = `${location.origin}/checkin?code=${r.code}`;
    const m = modal({ title: 'Player check-in', body: html`<div style="text-align:center"><div id="qr" style="display:inline-block;background:#fff;padding:10px;min-height:20px"></div>
      <div style="font-size:42px;font-weight:700;letter-spacing:.15em;margin:8px 0" class="mono">${r.code}</div>
      <p class="muted">Players open <b>Check in</b> in the app and enter this code, or scan the QR code. Expires ${fmtTime(r.expires_at)}. Arrivals more than 5 minutes after the start are marked late.</p></div>`,
    actions: [{ label: 'New code', onClick: async () => { await api.post(`/api/attendance/${id}/code`, { minutes: 120 }); refresh(); } }, { label: 'Close' }] });
    renderQR(m.root.querySelector('#qr'), url);
    refresh();
  });
}

// QR code drawing uses a small library from a CDN when available; the typed code always works.
function renderQR(box, text) {
  const go = () => { try { new window.QRCode(box, { text, width: 200, height: 200 }); } catch { /* ignore */ } };
  if (window.QRCode) return go();
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
  s.onload = go; s.onerror = () => { box.remove(); };
  document.head.appendChild(s);
}

async function reports(el, ctx) {
  const q = ctx.query;
  const [r, st] = await Promise.all([api.get(`/api/attendance-report?${new URLSearchParams(q)}`), api.get('/api/structure')]);
  const teams = st.levels.flatMap((l) => l.teams.map((t) => [t.id, t.name === l.name ? t.name : `${l.name} ${t.name}`]));
  const flagged = (p) => p.unexcused >= r.thresholds.absences || p.late >= r.thresholds.lates;
  set(el, html`<div class="page-head"><div><h1>Attendance</h1><div class="sub">${fmtDate(r.from, { year: true })} to ${fmtDate(r.to, { year: true })} · alert thresholds: ${r.thresholds.absences} unexcused absences or ${r.thresholds.lates} lates</div></div>
    <div class="actions"><a class="btn" href="/api/attendance-report/export.csv?${new URLSearchParams(q)}" download>Export spreadsheet</a></div></div>${atabs('reports')}
    <div class="filters"><label class="check">From <input type="date" data-f="from" value="${r.from}" style="width:auto"></label><label class="check">To <input type="date" data-f="to" value="${r.to}" style="width:auto"></label>
      <select data-f="team_id"><option value="">All teams</option>${options(teams, q.team_id)}</select>
      <select data-f="type"><option value="">All event types</option>${options([['practice', 'Practice'], ['game', 'Game'], ['lift', 'Lift'], ['film', 'Film'], ['social', 'Team event']], q.type)}</select></div>
    <div class="grid g4" style="margin-bottom:14px">${r.by_type.map((t) => html`<div class="card stat"><div class="k">${cap(t.type)}</div><div class="v">${t.rate}%</div><div class="d">${t.attended} of ${t.total} check-ins</div></div>`)}</div>
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th>Player</th><th class="num">#</th><th class="num">Events</th><th class="num">Present</th><th class="num">Tardy</th><th class="num">Left early</th><th class="num">Excused</th><th class="num">Absent</th><th>Rate</th></tr></thead><tbody>
      ${r.players.map((p) => html`<tr class="click" onclick="__navigate('/players/${p.player_id}')"><td><b>${p.name}</b> ${flagged(p) ? html`<span class="badge bad">Over threshold</span>` : ''}</td><td class="num">${p.jersey ?? ''}</td><td class="num">${p.total}</td><td class="num">${p.present}</td><td class="num">${p.late}</td><td class="num">${p.left_early}</td><td class="num">${p.excused}</td><td class="num">${p.unexcused}</td><td style="width:150px"><div class="row" style="flex-wrap:nowrap">${bar(p.rate, p.rate < 80 ? 'bad' : p.rate < 90 ? 'warn' : '')}<span class="s">${p.rate}%</span></div></td></tr>`)}
    </tbody></table>${!r.players.length ? empty('No attendance recorded in this range.') : ''}</div></div>
    <div id="fbtrends" style="margin-top:14px"></div>`);
  import('./fb-attendance.js').then((m) => m.trendsSection($('#fbtrends', el), q, st)).catch(() => {}); // C-20
  $$('[data-f]', el).forEach((s) => { s.onchange = () => ctx.navigate('/attendance/reports?' + new URLSearchParams(Object.fromEntries(Object.entries({ ...q, [s.dataset.f]: s.value }).filter(([, v]) => v)))); });
}
