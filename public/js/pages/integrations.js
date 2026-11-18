// Integrations: connect your own Google account (Gmail, Calendar, Sheets, Docs), review event drafts made from
// email, choose how program email is delivered, push and import calendars, import and export sheets, export docs.
import { api } from '../api.js';
import { html, set, $, on, toast, errToast, formData, options, checked, field, audienceField, wireAudience, fmtDT, ago, empty, tabs, todayISO, addDaysISO } from '../ui.js';
import { connection, setup } from './integrations-setup.js';

const TYPES = [['game', 'Game'], ['practice', 'Practice'], ['lift', 'Lift'], ['film', 'Film'], ['meeting', 'Staff meeting'], ['social', 'Team event'], ['camp', 'Camp'], ['other', 'Other']];
const TABS = [['connection', 'Connection'], ['gmail', 'Gmail'], ['calendar', 'Calendar'], ['sheets', 'Sheets'], ['docs', 'Docs'], ['setup', 'Setup']];
// Disables a button and shows what is happening while fn runs.
async function busy(btn, label, fn) {
  const was = btn.innerHTML;
  btn.disabled = true; btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = was; }
}
const ERRORS = {
  state: 'The sign-in link expired or did not match this session. Try connecting again.',
  signed_out: 'You were signed out during the Google sign-in. Sign in and try again.',
  access_denied: 'Google access was not granted.',
  exchange: 'Google did not accept the sign-in. Try again.',
  no_refresh_token: 'Google did not return offline access. Disconnect, then connect again.',
  not_configured: 'Google is not set up on this server yet.',
  staff_only: 'Only staff can connect Google.',
};
const link = (href, label) => html`<a href="${href}" target="_blank" rel="noopener">${label}</a>`;
const resultNotice = (r, what) => html`<div class="notice ok">${what} created. ${link(r.url, 'Open in Google')}</div>`;

export default async function integrations(el, ctx) {
  if (!ctx.me.caps.staff) { set(el, html`<div class="notice">Only staff can connect Google accounts.</div>`); return; }
  const st = await api.get('/api/google/status');
  const visible = TABS.filter(([k]) => k !== 'setup' || st.is_admin);
  const tab = visible.some(([k]) => k === ctx.query.tab) ? ctx.query.tab : (!st.configured && st.is_admin ? 'setup' : 'connection');
  const flash = ctx.query.google === 'connected' ? html`<div class="notice ok">Google is connected.</div>`
    : ctx.query.google_error ? html`<div class="notice bad">${ERRORS[ctx.query.google_error] || `Google sign-in failed (${ctx.query.google_error}).`}</div>` : '';
  set(el, html`<div class="page-head"><div><h1>Integrations</h1><div class="sub">Connect your own Google account. Nothing is shared with other staff, and you can disconnect at any time.</div></div></div>
    ${tabs(visible.map(([k, label]) => [k, k === 'gmail' && st.pending_drafts ? `${label} (${st.pending_drafts})` : label, `/settings/integrations?tab=${k}`]), tab)}
    ${flash}
    ${!st.configured && !['connection', 'setup'].includes(tab) ? html`<div class="notice warn">${st.is_admin ? html`Google is not set up yet. <a href="/settings/integrations?tab=setup">Set it up</a>` : 'Google is not set up yet. Ask your head coach to set it up under Integrations › Setup.'}</div>` : ''}
    <div id="tab"></div>`);
  const box = $('#tab', el);
  const has = (f) => !!st.connection?.features.includes(f);
  const needFeature = (f, label) => {
    if (!st.configured || has(f)) return '';
    const c = st.connection;
    const msg = !c ? 'Connect your Google account to use this.' : c.granted.includes(f) ? `${label} is turned off for your connection.` : `Your connection does not include ${label} yet.`;
    return html`<div class="card"><div class="bd"><div class="empty">${msg} <a href="/settings/integrations?tab=connection">${c ? `Turn on ${label}` : 'Connect Google'}</a></div></div></div>`;
  };
  try {
    if (tab === 'setup') return await setup(box, ctx);
    if (tab === 'connection') return connection(box, st, ctx);
    if (tab === 'gmail') return await gmail(box, ctx, st, has('gmail'), needFeature('gmail', 'Gmail'));
    if (tab === 'calendar') return await calendar(box, ctx, st, has('calendar'), needFeature('calendar', 'Google Calendar'));
    if (tab === 'sheets') return sheets(box, ctx, st, has('sheets'), needFeature('sheets', 'Google Sheets'));
    if (tab === 'docs') return await docs(box, ctx, st, has('docs'), needFeature('docs', 'Google Docs'));
  } catch (e) { set(box, html`<div class="notice bad">${e.message}</div>`); }
}

// ---------- Connection and Setup: see integrations-setup.js ----------

// ---------- Gmail ----------
async function gmail(box, ctx, st, ok, missing) {
  const c = st.connection;
  const [labels, drafts, auds] = await Promise.all([
    ok ? api.get('/api/google/gmail/labels').catch(() => []) : Promise.resolve([]),
    api.get('/api/google/drafts'),
    api.get('/api/audiences'),
  ]);
  const labelNames = [...new Set([...(c?.gmail_label ? [c.gmail_label] : []), ...labels.map((l) => l.name)])];
  const senderCard = st.is_admin ? html`<div class="card"><div class="hd"><h2>Program email</h2></div><div class="bd">
      <p class="muted">By default, email is only written to the outbox (simulated). Choose a staff Gmail to deliver it for real. Quiet hours still apply.</p>
      <div class="fields">${field('Send program email through', html`<select id="sender">${options([['', 'Nobody (outbox only)'], ...(st.sender_options || []).map((o) => [o.user_id, `${o.name} (${o.email || 'Gmail'})`])], st.sender?.user_id ?? '')}</select>`,
        'Only staff who connected Gmail and agreed below appear here.')}</div>
      ${st.sender && !st.sender.ready ? html`<div class="notice warn">${st.sender.name}'s Gmail is not connected with send access, so email stays in the outbox.</div>` : ''}
      <button id="save-sender" ${st.configured ? '' : 'disabled'}>Save</button></div></div>`
    : st.sender ? html`<div class="notice">Program email is sent through ${st.sender.name}'s Gmail.</div>` : '';
  set(box, html`${missing}
  <div class="grid g2">
    <div class="card"><div class="hd"><h2>Which emails to read</h2></div><div class="bd">
      ${ok ? html`<form id="gs"><div class="fields">
        ${field('Gmail label', html`<select name="gmail_label">${options([['', 'No label (use the search below)'], ...labelNames.map((n) => [n, n])], c.gmail_label || '')}</select>`, 'In Gmail, create a label such as "Team Calendar" and add it to schedule emails (or use a filter).')}
        ${field('Search (optional)', html`<input name="gmail_query" value="${c.gmail_query || ''}" placeholder="from:ad@school.org subject:schedule">`, 'Gmail search words, combined with the label.')}
      </div>
      <div class="field"><label class="check"><input type="checkbox" name="auto_scan" ${checked(c.auto_scan)}> Check for new emails every 10 minutes</label></div>
      <div class="field"><label class="check"><input type="checkbox" name="apply_imported_label" ${checked(c.apply_imported_label)}> Label approved emails "Imported" in Gmail</label></div>
      <div class="field"><label class="check"><input type="checkbox" name="allow_program_send" ${checked(c.allow_program_send)}> The head coach may send program email from my Gmail</label></div>
      </form>
      <div class="row"><button id="save-gs">Save</button><button class="primary" id="scan">Scan now</button><button id="peek">Show recent emails</button></div>
      <div class="help">${c.last_scan_at ? `Last checked ${ago(c.last_scan_at)}.` : 'Not checked yet.'}${c.auto_scan ? ' New emails are checked every 10 minutes.' : ''}</div>
      <div id="scan-out"></div>
      <div id="peek-out"></div>` : html`<p class="muted">Connect Gmail to turn labeled emails into calendar drafts.</p>`}
    </div></div>
    ${senderCard}
  </div>
  <div class="card"><div class="hd"><h2>Review queue</h2><span class="badge" id="draft-count">${drafts.length} waiting</span></div><div class="bd">
    <p class="muted">Each email becomes one or more drafts. Check the details, pick who it is for, then approve to put it on the calendar.</p>
    <div id="approved"></div>
    <div id="drafts">${drafts.length ? drafts.map((d) => draftCard(d, auds)) : emptyQueue(ok)}</div>
  </div></div>`);
  const refreshCount = () => {
    const n = box.querySelectorAll('[data-draft]').length;
    $('#draft-count', box).textContent = `${n} waiting`;
    if (!n) set($('#drafts', box), emptyQueue(ok));
  };
  wireAudience(box);
  const saveGs = $('#save-gs', box);
  if (saveGs) saveGs.onclick = async () => {
    const f = formData($('#gs', box));
    try { await api.put('/api/google/gmail/settings', f); toast('Gmail settings saved'); } catch (e) { errToast(e); }
  };
  const scan = $('#scan', box);
  if (scan) scan.onclick = () => busy(scan, 'Scanning Gmail…', async () => {
    try {
      const r = await api.post('/api/google/gmail/scan', {});
      const fresh = await api.get('/api/google/drafts');
      set($('#drafts', box), fresh.length ? fresh.map((d) => draftCard(d, auds)) : emptyQueue(ok));
      wireAudience(box);
      refreshCount();
      set($('#scan-out', box), r.label_missing
        ? html`<div class="notice warn">Gmail label "${c.gmail_label}" was not found. Create it in Gmail or pick another label above.</div>`
        : html`<div class="notice ${r.drafts_created ? 'ok' : ''}">Checked ${r.checked} email${r.checked === 1 ? '' : 's'} (${r.new_messages} new): ${r.drafts_created ? `${r.drafts_created} draft${r.drafts_created === 1 ? '' : 's'} added to the review queue below.` : 'no new events found.'}</div>`);
    } catch (e) { errToast(e); }
  });
  const peek = $('#peek', box);
  if (peek) peek.onclick = () => busy(peek, 'Loading…', async () => {
    try {
      const r = await api.get('/api/google/gmail/messages');
      set($('#peek-out', box), r.messages.length ? html`<ul class="list">${r.messages.map((m) => html`<li><div class="grow"><div class="t">${m.subject || '(no subject)'}</div><div class="s">${m.from} · ${fmtDT(m.received_at)}</div></div>${m.scanned ? html`<span class="badge ok">Scanned</span>` : html`<span class="badge">New</span>`} ${link(m.link, 'Open')}</li>`)}</ul>`
        : html`<div class="empty">${r.label_missing ? `No Gmail label named "${r.label}".` : 'No matching emails in the last 60 days.'}</div>`);
    } catch (e) { errToast(e); }
  });
  const ss = $('#save-sender', box);
  if (ss) ss.onclick = async () => {
    const v = $('#sender', box).value;
    try { await api.put('/api/google/gmail/sender', { user_id: v ? Number(v) : null }); toast(v ? 'Program email will go out through Gmail' : 'Program email stays in the outbox'); ctx.reload(); } catch (e) { errToast(e); }
  };
  on(box, 'click', '[data-approve]', async (e, b) => {
    const form = b.closest('form');
    const f = formData(form);
    const body = { type: f.type, title: f.title, start: f.start, end: f.end || null, location: f.location || null, audience: f.audience || [] };
    if (!body.audience.length) return toast('Pick who this event is for', 'bad');
    b.disabled = true;
    try {
      const r = await api.post(`/api/google/drafts/${b.dataset.approve}/approve`, body);
      form.closest('[data-draft]').remove();
      $('#approved', box).insertAdjacentHTML('beforeend', html`<div class="notice ok">${body.title} added to the calendar. <a href="/calendar/${r.event_id}">Open event</a>${r.label_error ? ` (Gmail label not applied: ${r.label_error})` : r.labeled ? ' · Labeled "Imported" in Gmail' : ''}</div>`.__html);
      refreshCount();
    } catch (err) { errToast(err); b.disabled = false; }
  });
  on(box, 'click', '[data-dismiss]', async (e, b) => {
    try { await api.post(`/api/google/drafts/${b.dataset.dismiss}/dismiss`); b.closest('[data-draft]').remove(); toast('Draft dismissed'); refreshCount(); } catch (err) { errToast(err); }
  });
}
const emptyQueue = (ok) => empty(ok ? 'Nothing to review. Add the label to schedule emails in Gmail and click Scan now, or import a Google calendar.' : 'Nothing to review.');
function draftCard(d, auds) {
  const conf = Math.round((d.confidence ?? 0) * 100);
  return html`<div class="card" data-draft="${d.id}"><div class="hd"><h2>${d.subject || d.title}</h2>
      <span class="badge ${conf >= 75 ? 'ok' : conf >= 50 ? 'warn' : 'bad'}">${conf}% sure</span> <span class="badge">${d.source === 'gcal' ? 'Google Calendar' : 'Gmail'}</span></div>
    <div class="bd">
      ${d.snippet ? html`<p class="muted">“${d.snippet}”${d.sender ? ` · ${d.sender}` : ''} ${d.message_link ? link(d.message_link, 'Open source') : ''}</p>` : ''}
      ${(d.notes || []).length ? html`<div class="notice warn">${d.notes.join('. ')}</div>` : ''}
      <form onsubmit="return false"><div class="fields">
        ${field('Type', html`<select name="type">${options(TYPES, d.type)}</select>`)}
        ${field('Title', html`<input name="title" value="${d.title || ''}" required>`)}
        ${field('Start', html`<input type="datetime-local" name="start" value="${d.start || ''}" required>`)}
        ${field('End', html`<input type="datetime-local" name="end" value="${d.end || ''}">`)}
        ${field('Location', html`<input name="location" value="${d.location || ''}">`)}
      </div>
      ${field('Who is it for', audienceField('audience', auds, d.audience || []))}
      <div class="row"><button class="primary" data-approve="${d.id}">Approve</button><button data-dismiss="${d.id}">Dismiss</button></div></form>
    </div></div>`;
}

// ---------- Calendar ----------
async function calendar(box, ctx, st, ok, missing) {
  const cals = ok ? await api.get('/api/google/calendar/calendars').catch((e) => { errToast(e); return []; }) : [];
  const from = todayISO(); const to = addDaysISO(from, 60);
  const calOpts = (list) => options(list.map((c) => [c.id, `${c.summary}${c.primary ? ' (primary)' : ''}`]), list.find((c) => c.primary)?.id);
  set(box, html`${missing}${ok ? html`<div class="grid g2">
    <div class="card"><div class="hd"><h2>Push team events to Google</h2></div><div class="bd">
      <p class="muted">Copies the events you can see in the app to a Google calendar. Pushing again updates changed events instead of duplicating them; cancelled events are marked, deleted ones are removed.</p>
      <form id="pf"><div class="fields">
        ${field('Google calendar', html`<select name="calendar_id">${calOpts(cals.filter((c) => c.writable))}</select>`)}
        ${field('From', html`<input type="date" name="from" value="${from}">`)}${field('To', html`<input type="date" name="to" value="${to}">`)}
      </div></form>
      <button class="primary" id="push">Push events</button><div id="push-out"></div>
    </div></div>
    <div class="card"><div class="hd"><h2>Import from Google</h2></div><div class="bd">
      <p class="muted">Events from a Google calendar (for example the athletic department's) go to the review queue on the Gmail tab, not straight onto the team calendar.</p>
      <form id="if"><div class="fields">
        ${field('Google calendar', html`<select name="calendar_id">${calOpts(cals)}</select>`)}
        ${field('From', html`<input type="date" name="from" value="${from}">`)}${field('To', html`<input type="date" name="to" value="${addDaysISO(from, 30)}">`)}
      </div></form>
      <button id="import">Import for review</button><div id="import-out"></div>
    </div></div></div>` : ''}`);
  const push = $('#push', box);
  if (push) push.onclick = () => busy(push, 'Pushing events…', async () => {
    try {
      const r = await api.post('/api/google/calendar/push', formData($('#pf', box)));
      const total = r.created + r.updated + r.unchanged;
      set($('#push-out', box), html`<div class="notice ${r.errors.length ? 'warn' : 'ok'}">${total || r.removed ? `${r.created} added, ${r.updated} updated, ${r.unchanged} unchanged, ${r.removed} removed.` : 'No team events in those dates.'}${r.errors.length ? ` ${r.errors.length} failed: ${r.errors[0].error}` : ''} ${link('https://calendar.google.com/calendar/r', 'Open Google Calendar')}</div>`);
    } catch (e) { errToast(e); }
  });
  const imp = $('#import', box);
  if (imp) imp.onclick = () => busy(imp, 'Importing…', async () => {
    try {
      const r = await api.post('/api/google/calendar/import', formData($('#if', box)));
      set($('#import-out', box), r.drafts_created
        ? html`<div class="notice ok">${r.drafts_created} draft${r.drafts_created === 1 ? '' : 's'} added to the review queue${r.skipped ? ` (${r.skipped} skipped: already imported, cancelled or pushed from this app)` : ''}. <a href="/settings/integrations?tab=gmail">Review now</a></div>`
        : html`<div class="notice">No new events to import${r.skipped ? ` (${r.skipped} already imported, cancelled or pushed from this app)` : ''}.</div>`);
    } catch (e) { errToast(e); }
  });
}

// ---------- Sheets ----------
function sheets(box, ctx, st, ok, missing) {
  const caps = ctx.me.caps;
  const previewTable = (r) => {
    const cols = [...new Set(r.rows.flatMap((x) => Object.keys(x)))];
    return html`<p class="muted">${r.total} row${r.total === 1 ? '' : 's'} found. First ${r.rows.length}:</p><div class="tbl-wrap"><table><thead><tr>${cols.map((c) => html`<th>${c}</th>`)}</tr></thead><tbody>${r.rows.map((x) => html`<tr>${cols.map((c) => html`<td>${x[c] ?? ''}</td>`)}</tr>`)}</tbody></table></div>`;
  };
  const importResult = (r) => html`<div class="notice ${r.errors.length ? 'warn' : 'ok'}">${r.created} imported.${r.errors.length ? html` ${r.errors.length} row${r.errors.length > 1 ? 's' : ''} skipped: ${r.errors.slice(0, 5).map((e) => `row ${e.row} (${e.error})`).join('; ')}` : ''}</div>`;
  set(box, html`${missing}${ok ? html`<div class="grid g2">
    ${caps['roster.edit'] ? html`<div class="card"><div class="hd"><h2>Import roster from a sheet</h2></div><div class="bd">
      <p class="muted">The first row is the header: Name, Email, Jersey, Class, Team, Units, Positions, Height, Weight. Rows work the same as the CSV import.</p>
      <form id="rf"><div class="fields">${field('Google Sheet link', html`<input name="url" placeholder="https://docs.google.com/spreadsheets/d/...">`)}${field('Tab (optional)', html`<input name="sheet" placeholder="Sheet1">`)}</div>
      <div class="field"><label class="check"><input type="checkbox" name="all_or_nothing"> Import nothing if any row has a problem</label></div></form>
      <div class="row"><button id="r-prev">Preview</button><button class="primary" id="r-imp">Import roster</button></div><div id="r-out"></div>
    </div></div>` : ''}
    ${caps['weights.edit'] ? html`<div class="card"><div class="hd"><h2>Import test maxes</h2></div><div class="bd">
      <p class="muted">Either one column per test (Name, Squat, Bench, Clean, 40, Vertical...) or Name, Test, Value and Date columns.</p>
      <form id="tf"><div class="fields">${field('Google Sheet link', html`<input name="url" placeholder="https://docs.google.com/spreadsheets/d/...">`)}${field('Tab (optional)', html`<input name="sheet">`)}${field('Test date', html`<input type="date" name="date" value="${todayISO()}">`)}</div></form>
      <div class="row"><button id="t-prev">Preview</button><button class="primary" id="t-imp">Import maxes</button></div><div id="t-out"></div>
    </div></div>` : ''}
    <div class="card"><div class="hd"><h2>Export to a new spreadsheet</h2></div><div class="bd">
      <form id="xf"><div class="fields">${field('Attendance from', html`<input type="date" name="from">`)}${field('to', html`<input type="date" name="to">`)}</div></form>
      <div class="row"><button data-export="roster">Roster</button><button data-export="attendance">Attendance report</button>${caps['equipment.view'] ? html`<button data-export="equipment">Outstanding equipment</button>` : ''}</div>
      <div id="x-out"></div>
    </div></div></div>` : ''}`);
  const run = (btn, path, form, out, render) => busy(btn, 'Importing…', async () => {
    const f = formData($(form, box));
    if (!f.url) return toast('Paste the Google Sheet link first', 'bad');
    set($(out, box), html`<div class="notice">Reading the sheet…</div>`);
    try { set($(out, box), render(await api.post(path, f))); } catch (e) { set($(out, box), html`<div class="notice bad">${e.message}</div>`); }
  });
  const wire = (id, fn) => { const b = $(id, box); if (b) b.onclick = () => fn(b); };
  wire('#r-imp', (b) => run(b, '/api/google/sheets/roster-import', '#rf', '#r-out', importResult));
  wire('#t-imp', (b) => run(b, '/api/google/sheets/tests-import', '#tf', '#t-out', importResult));
  // Preview buttons send preview: true.
  for (const [id, form, path, out] of [['#r-prev', '#rf', '/api/google/sheets/roster-import', '#r-out'], ['#t-prev', '#tf', '/api/google/sheets/tests-import', '#t-out']]) {
    const b = $(id, box);
    if (b) b.onclick = () => busy(b, 'Reading…', async () => {
      const f = formData($(form, box));
      if (!f.url) return toast('Paste the Google Sheet link first', 'bad');
      try { set($(out, box), previewTable(await api.post(path, { ...f, preview: true }))); } catch (e) { set($(out, box), html`<div class="notice bad">${e.message}</div>`); }
    });
  }
  on(box, 'click', '[data-export]', (e, b) => busy(b, 'Creating spreadsheet…', async () => {
    try {
      const f = formData($('#xf', box));
      const r = await api.post('/api/google/sheets/export', { kind: b.dataset.export, from: f.from || undefined, to: f.to || undefined });
      set($('#x-out', box), resultNotice(r, `Spreadsheet with ${r.rows} row${r.rows === 1 ? '' : 's'}`));
    } catch (err) { errToast(err); }
  }));
}

// ---------- Docs ----------
async function docs(box, ctx, st, ok, missing) {
  const caps = ctx.me.caps;
  const [plans, players] = ok ? await Promise.all([api.get('/api/plans').catch(() => []), caps['season.view'] || caps['audit.view'] ? api.get('/api/players').catch(() => []) : Promise.resolve([])]) : [[], []];
  set(box, html`${missing}${ok ? html`<div class="grid g2">
    <div class="card"><div class="hd"><h2>Practice plan</h2></div><div class="bd">
      <p class="muted">Creates a Google Doc with the period table and notes.</p>
      ${plans.length ? html`${field('Plan', html`<select id="plan">${options(plans.map((p) => [p.id, `${p.event_start ? `${fmtDT(p.event_start)} · ` : ''}${p.name}`]))}</select>`)}<button class="primary" id="plan-x">Export to Google Docs</button>` : empty(html`No practice plans yet. <a href="/practice">Create one</a>`)}
      <div id="plan-out"></div>
    </div></div>
    <div class="card"><div class="hd"><h2>Player season report</h2></div><div class="bd">
      <p class="muted">Attendance, ratings, assignments, testing, evaluations and goals for the current season.</p>
      ${players.length ? html`${field('Player', html`<select id="player">${options(players.map((p) => [p.id, `${p.name}${p.jersey != null ? ` #${p.jersey}` : ''}${p.team ? ` · ${p.team}` : ''}`]))}</select>`)}<button class="primary" id="player-x">Export to Google Docs</button>`
        : html`<div class="empty">Season reports are available to coaches and the athletic director.</div>`}
      <div id="player-out"></div>
    </div></div></div>` : ''}`);
  const go = (btnId, selId, path, key, out, what) => {
    const b = $(btnId, box);
    if (!b) return;
    b.onclick = () => busy(b, 'Creating document…', async () => {
      try { const r = await api.post(path, { [key]: Number($(selId, box).value) }); set($(out, box), resultNotice(r, what)); } catch (e) { errToast(e); }
    });
  };
  go('#plan-x', '#plan', '/api/google/docs/practice-plan', 'plan_id', '#plan-out', 'Google Doc');
  go('#player-x', '#player', '/api/google/docs/season-report', 'player_id', '#player-out', 'Season report');
}
