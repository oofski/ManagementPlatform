// Module 1: Calendar — month/agenda views filtered to the user's groups, event create/edit (types, audiences,
// recurrence), game-week template, quick status changes, RSVP, acknowledgments, change log, subscribe link.
import { api } from '../api.js';
import { html, set, $, on, modal, toast, errToast, formData, options, checked, field, audienceField, wireAudience, fmtDate, fmtTime, fmtDT, ago,
  parse, iso, todayISO, addDaysISO, mondayOf, statusBadge, cap, empty, confirmDialog, raw, ROLE } from '../ui.js';

const TYPE_LABEL = { game: 'Game', practice: 'Practice', lift: 'Lift', film: 'Film', meeting: 'Staff meeting', social: 'Team event', other: 'Other' };
const FIELD_LABEL = { opponent: 'Opponent', home_away: 'Home or away', kickoff: 'Kickoff', bus_departure: 'Bus departure', report_time: 'Report time', uniform: 'Uniform', what_to_bring: 'What to bring', indoor_outdoor: 'Indoor or outdoor', head_count: 'Head count', cost: 'Cost', agenda: 'Agenda', wt_assignment_id: 'Lifting program' };
const REASONS = ['sick', 'injured', 'family', 'academic', 'transportation', 'other'];

export default async function calendar(el, ctx) {
  if (ctx.params.id) return detail(el, ctx, Number(ctx.params.id));
  const staff = ctx.me.caps.staff;
  const view = ctx.query.view || (window.innerWidth < 700 ? 'agenda' : 'month');
  const anchor = ctx.query.d || todayISO();
  const first = parse(anchor.slice(0, 7) + '-01');
  const gridStart = mondayOf(iso(first));
  const gridEnd = addDaysISO(gridStart, 41);
  const from = view === 'month' ? gridStart : addDaysISO(todayISO(), -7);
  const to = view === 'month' ? gridEnd : addDaysISO(todayISO(), 45);
  const qs = new URLSearchParams({ from, to, ...(ctx.query.type ? { type: ctx.query.type } : {}), ...(ctx.query.aud ? { audience: ctx.query.aud } : {}) });
  const [events, audiences, asn] = await Promise.all([
    api.get(`/api/events?${qs}`), staff ? api.get('/api/audiences') : Promise.resolve([]),
    !staff ? api.get('/api/assignments').catch(() => []) : Promise.resolve([]),
  ]);
  const dueItems = asn.filter((a) => a.due).map((a) => ({ id: a.id, title: `Due: ${a.title}`, start: a.due, type: 'other', asn: true }));
  const all = [...events, ...dueItems];
  const byDay = {};
  for (const e of all) (byDay[e.start.slice(0, 10)] ||= []).push(e);
  const link = (o) => '/calendar?' + new URLSearchParams({ view, d: anchor, ...(ctx.query.type ? { type: ctx.query.type } : {}), ...(ctx.query.aud ? { aud: ctx.query.aud } : {}), ...o });
  const monthLabel = first.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const evLink = (e) => (e.asn ? `/assignments/${e.id}` : `/calendar/${e.id}`);

  set(el, html`
  <div class="page-head"><div><h1>Calendar</h1><div class="sub">${staff ? 'Every event for your groups. Filter by group or type.' : 'Your schedule, RSVPs and due dates.'}</div></div>
    <div class="actions">
      <button id="sub">Subscribe</button>
      ${ctx.me.caps['calendar.edit'] ? html`<button id="gw">Game week</button><button class="primary" id="new">New event</button>` : ''}
    </div></div>
  <div class="filters">
    <div class="seg"><button class="${view === 'month' ? 'on' : ''}" onclick="__navigate('${link({ view: 'month' })}')">Month</button><button class="${view === 'agenda' ? 'on' : ''}" onclick="__navigate('${link({ view: 'agenda' })}')">Agenda</button></div>
    ${view === 'month' ? html`<button onclick="__navigate('${link({ d: iso(new Date(first.getFullYear(), first.getMonth() - 1, 1)) })}')">‹</button><b style="min-width:130px;text-align:center">${monthLabel}</b><button onclick="__navigate('${link({ d: iso(new Date(first.getFullYear(), first.getMonth() + 1, 1)) })}')">›</button><button onclick="__navigate('${link({ d: todayISO() })}')">Today</button>` : ''}
    <select id="ft"><option value="">All types</option>${options(Object.entries(TYPE_LABEL), ctx.query.type)}</select>
    ${staff ? html`<select id="fa"><option value="">All my groups</option>${options(audiences.filter((a) => a.kind !== 'Player').map((a) => [a.token, `${a.kind}: ${a.label}`]), ctx.query.aud)}</select>` : ''}
  </div>
  ${view === 'month' ? html`<div class="card" style="overflow:hidden"><div class="cal">
    ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => html`<div class="dow">${d}</div>`)}
    ${Array.from({ length: 42 }, (_, i) => { const day = addDaysISO(gridStart, i); const list = byDay[day] || []; return html`<div class="day ${day.slice(5, 7) !== anchor.slice(5, 7) ? 'other' : ''} ${day === todayISO() ? 'today' : ''}">
      <span class="num">${Number(day.slice(8))}</span>
      ${list.slice(0, 4).map((e) => html`<a class="ev type-${e.type} ${e.status === 'cancelled' ? 'cancelled' : ''}" href="${evLink(e)}" title="${e.title}"><span class="tm">${fmtTime(e.start).replace(':00', '').replace(' ', '').toLowerCase()}</span><span class="tx">${e.title}</span></a>`)}
      ${list.length > 4 ? html`<a class="faint" style="font-size:11px" href="${link({ view: 'agenda' })}">+${list.length - 4} more</a>` : ''}
    </div>`; })}
  </div></div>` : html`<div class="card agenda">${Object.keys(byDay).sort().filter((d) => d >= addDaysISO(todayISO(), -7)).map((day) => html`<div class="date">${fmtDate(day, { year: false })}${day === todayISO() ? ' · Today' : ''}</div>
      <ul class="list">${byDay[day].sort((a, b) => (a.start > b.start ? 1 : -1)).map((e) => html`<li class="click type-${e.type}" onclick="__navigate('${evLink(e)}')">
        <div style="width:78px" class="s">${fmtTime(e.start)}${e.end ? html`<br>${fmtTime(e.end)}` : ''}</div>
        <div class="grow"><div class="t">${e.title} ${e.status && e.status !== 'scheduled' ? statusBadge(e.status) : ''}</div><div class="s">${e.location || ''}${e.audience_labels ? ` · ${e.audience_labels.join(', ')}` : ''}</div></div>
        ${e.my_rsvp ? statusBadge(e.my_rsvp.status) : ''}${e.rsvp_counts ? html`<span class="s">${e.rsvp_counts.going || 0} going · ${e.rsvp_counts.not_going || 0} out</span>` : ''}
      </li>`)}</ul>`)}${!all.length ? empty('No events in this range.') : ''}</div>`}`);

  $('#ft', el).onchange = (e) => ctx.navigate(link({ type: e.target.value }));
  if ($('#fa', el)) $('#fa', el).onchange = (e) => ctx.navigate(link({ aud: e.target.value }));
  $('#sub', el).onclick = subscribe;
  if ($('#new', el)) $('#new', el).onclick = () => eventForm(ctx, audiences);
  if ($('#gw', el)) $('#gw', el).onclick = () => gameWeek(ctx, audiences);
  if (ctx.query.new && ctx.me.caps['calendar.edit']) eventForm(ctx, audiences);
}

async function subscribe() {
  const { path } = await api.get('/api/calendar/feed-url');
  const url = location.origin + path;
  modal({
    title: 'Subscribe to your calendar',
    body: html`<p>Add this link to Google Calendar ("From URL"), Apple Calendar ("New calendar subscription") or Outlook ("Subscribe from web"). It updates automatically and only shows events for your groups.</p>
      <div class="inline-input"><input readonly value="${url}" id="feed"><button id="cp">Copy</button></div>
      <p class="help">Sync is one way, out of the app. Keep this link private.</p>`,
    actions: [{ label: 'Done' }],
    onOpen: (r) => { r.querySelector('#cp').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { r.querySelector('#feed').select(); } }; },
  });
}

function typeFields(type, d = {}) {
  const t = (k, ph = '') => field(FIELD_LABEL[k], html`<input name="d_${k}" value="${d[k] || ''}" placeholder="${ph}">`);
  if (type === 'game') return html`<div class="fields">${t('opponent')}${field('Home or away', html`<select name="d_home_away">${options([['home', 'Home'], ['away', 'Away'], ['neutral', 'Neutral']], d.home_away || 'home')}</select>`)}${field('Kickoff', html`<input type="time" name="d_kickoff" value="${d.kickoff || ''}">`)}${field('Bus departure', html`<input type="time" name="d_bus_departure" value="${d.bus_departure || ''}">`)}${field('Report time', html`<input type="time" name="d_report_time" value="${d.report_time || ''}">`)}${t('uniform', 'Home black')}</div>`;
  if (type === 'practice') return html`<div class="fields">${t('what_to_bring', 'Full pads, water')}${field('Indoor or outdoor', html`<select name="d_indoor_outdoor">${options([['outdoor', 'Outdoor'], ['indoor', 'Indoor']], d.indoor_outdoor || 'outdoor')}</select>`)}</div>`;
  if (type === 'social') return html`<div class="fields">${t('head_count', 'Expected guests')}${t('cost', 'Free')}</div><div class="help" style="margin-bottom:10px">Set an RSVP deadline below.</div>`;
  if (type === 'lift' || type === 'film') return html`<div class="fields">${t('what_to_bring')}</div>`;
  if (type === 'meeting') return html`${field('Agenda', html`<textarea name="d_agenda">${d.agenda || ''}</textarea>`)}<div class="help" style="margin-bottom:10px">Staff meetings are visible to coaches only.</div>`;
  return '';
}

export function eventForm(ctx, audiences, e = null, onDone) {
  const isEdit = !!e;
  const v = e || { type: 'practice', start: `${todayISO()}T15:30`, end: `${todayISO()}T17:30`, audience: [], details: {}, reminders: [1440, 120] };
  const m = modal({
    title: isEdit ? 'Edit event' : 'New event', wide: true,
    body: html`<form id="ef">
      <div class="fields">
        ${field('Type', html`<select name="type" id="etype">${options(Object.entries(TYPE_LABEL), v.type)}</select>`)}
        ${field('Title', html`<input name="title" value="${v.title || ''}" required>`)}
        ${field('Location', html`<input name="location" value="${v.location || ''}">`)}
      </div>
      <div class="fields">
        ${field('Starts', html`<input type="datetime-local" name="start" value="${v.start}" required>`)}
        ${field('Ends', html`<input type="datetime-local" name="end" value="${v.end || ''}">`)}
        ${field('RSVP deadline', html`<input type="datetime-local" name="rsvp_deadline" value="${v.rsvp_deadline || ''}">`)}
      </div>
      <div id="tf">${typeFields(v.type, v.details)}</div>
      ${field('Audience', audienceField('audience', audiences, v.audience), 'Everyone in these groups, their parents and their coaches will see this event.')}
      <div class="fields">
        ${field('Reminders', html`<div class="row"><label class="check"><input type="checkbox" name="r1440" ${checked(v.reminders.includes(1440))}> 24 hours</label><label class="check"><input type="checkbox" name="r120" ${checked(v.reminders.includes(120))}> 2 hours</label><label class="check"><input type="checkbox" name="r30" ${checked(v.reminders.includes(30))}> 30 min</label></div>`)}
        ${!isEdit ? field('Repeat', html`<select name="freq" id="freq">${options([['', 'Does not repeat'], ['weekly', 'Weekly on…'], ['daily', 'Every day']], '')}</select>`) : ''}
      </div>
      ${!isEdit ? html`<div id="rep" hidden class="row" style="margin-bottom:12px">
        ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => html`<label class="check"><input type="checkbox" name="days" data-multi data-num value="${i}"> ${d}</label>`)}
        <label class="check">until <input type="date" name="until" style="width:auto"></label></div>` : ''}
      ${isEdit && v.series_id ? field('Apply changes to', html`<select name="scope">${options([['one', 'This event only'], ['series', 'This and later events in the series']], 'one')}</select>`, 'Series changes keep each date and update times, place, audience and details.') : ''}
    </form>`,
    actions: [{ label: 'Cancel' }, {
      label: isEdit ? 'Save changes' : 'Create event', primary: true,
      onClick: async (root) => {
        const f = formData(root.querySelector('#ef'));
        const details = Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith('d_')).map(([k, val]) => [k.slice(2), val]));
        const body = { type: f.type, title: f.title, location: f.location, start: f.start, end: f.end || null, rsvp_deadline: f.rsvp_deadline || null, audience: f.audience || [], details,
          reminders: [f.r1440 && 1440, f.r120 && 120, f.r30 && 30].filter(Boolean) };
        if (body.type === 'meeting' && !body.audience.length) body.audience = ['coaches'];
        if (!isEdit && f.freq) body.repeat = { freq: f.freq, days: f.days, until: f.until || null };
        if (isEdit) { body.scope = f.scope || 'one'; const r = await api.put(`/api/events/${e.id}`, body); toast(r.changed.length ? `Saved. ${r.changed.join(', ')} changed; the audience was notified.` : 'No changes'); onDone ? onDone() : ctx.reload(); }
        else { const r = await api.post('/api/events', body); toast(r.ids ? `Created ${r.ids.length} events` : 'Event created'); ctx.navigate(`/calendar/${r.id}`); }
      },
    }],
  });
  wireAudience(m.root);
  const t = m.root.querySelector('#etype');
  t.onchange = () => set(m.root.querySelector('#tf'), typeFields(t.value, {}));
  const fq = m.root.querySelector('#freq');
  if (fq) fq.onchange = () => { m.root.querySelector('#rep').hidden = fq.value !== 'weekly'; };
}

function gameWeek(ctx, audiences) {
  const nextFri = (() => { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7)); return iso(d); })();
  const m = modal({
    title: 'Generate a game week',
    body: html`<p class="muted">Creates the standard week (film, install practices, walkthrough, staff meeting) leading up to the game, plus the game itself. Edit any event afterwards.</p>
    <form id="gf"><div class="fields">
      ${field('Opponent', html`<input name="opponent" required>`)}
      ${field('Game date', html`<input type="date" name="game_date" value="${nextFri}" required>`)}
      ${field('Kickoff', html`<input type="time" name="kickoff" value="19:00">`)}
      ${field('Home or away', html`<select name="home_away">${options([['home', 'Home'], ['away', 'Away']], 'home')}</select>`)}
      ${field('Uniform', html`<input name="uniform" placeholder="Home black">`)}
      ${field('Location', html`<input name="location" placeholder="Ridgeview Stadium">`)}
    </div>${field('Audience', audienceField('audience', audiences, []), 'Leave empty for the whole program.')}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Create week', primary: true, onClick: async (root) => {
      const f = formData(root.querySelector('#gf'));
      const r = await api.post('/api/events/game-week', f);
      toast(`Added ${r.ids.length} events`);
      ctx.navigate(`/calendar?view=agenda`);
    } }],
  });
  wireAudience(m.root);
}

async function detail(el, ctx, id) {
  const e = await api.get(`/api/events/${id}`);
  const staff = ctx.me.caps.staff;
  ctx.setTitle(e.title);
  const deadlinePassed = e.rsvp_deadline && new Date() > parse(e.rsvp_deadline);
  const rsvpBlock = (label, current, forPlayer) => html`<div class="row" style="margin-bottom:8px" data-rsvp-for="${forPlayer || ''}">
    <span style="min-width:120px">${label}</span>
    ${['going', 'maybe', 'not_going'].map((s) => html`<button class="sm ${current?.status === s ? 'primary' : ''}" data-rsvp="${s}" ${deadlinePassed && !staff ? raw('disabled') : ''}>${s === 'not_going' ? 'Not going' : cap(s)}</button>`)}
    ${current?.status === 'not_going' ? html`<span class="muted">(${current.reason})</span>` : ''}
  </div>`;
  const D = e.details || {};
  set(el, html`
  <div class="page-head"><div><div class="row"><h1>${e.title}</h1>${e.status !== 'scheduled' ? statusBadge(e.status) : ''}<span class="badge">${TYPE_LABEL[e.type]}</span></div>
    <div class="sub">${fmtDT(e.start)}${e.end ? ` – ${fmtTime(e.end)}` : ''}${e.location ? ` · ${e.location}` : ''}</div></div>
    <div class="actions">
      <a class="btn" href="/calendar">Back</a>
      <button id="mail">Email me details</button>
      ${staff && e.type !== 'meeting' ? html`<a class="btn" href="/attendance/${e.id}">Attendance</a>` : ''}
      ${staff && ['practice', 'lift', 'film', 'other'].includes(e.type) ? (e.plan_id ? html`<a class="btn" href="/practice/${e.plan_id}">Practice plan</a>` : ctx.me.caps['practice.edit'] && e.type === 'practice' ? html`<button id="mkplan">Create practice plan</button>` : '') : ''}
      ${e.can_edit ? html`<button id="edit">Edit</button><button class="danger" id="del">Delete</button>` : ''}
    </div></div>
  ${e.status_note ? html`<div class="notice ${e.status === 'cancelled' ? 'bad' : 'warn'}">${e.status_note}</div>` : ''}
  <div class="grid g-side">
    <div class="stack">
      <div class="card"><div class="hd"><h2>Details</h2></div><div class="bd"><dl class="kv">
        <dt>When</dt><dd>${fmtDT(e.start)}${e.end ? ` to ${fmtTime(e.end)}` : ''}</dd>
        ${e.location ? html`<dt>Where</dt><dd>${e.location}</dd>` : ''}
        <dt>For</dt><dd>${e.audience_labels.join(', ')}</dd>
        ${Object.entries(D).filter(([k]) => k !== 'wt_assignment_id' && k !== 'week' && k !== 'day').map(([k, val]) => html`<dt>${FIELD_LABEL[k] || cap(k)}</dt><dd>${['kickoff', 'report_time', 'bus_departure'].includes(k) ? fmtTime(`2000-01-01T${val}`) : cap(String(val))}</dd>`)}
        ${D.wt_assignment_id ? html`<dt>Workout</dt><dd><a href="/weights">Week ${D.week}, day ${D.day}</a></dd>` : ''}
        ${e.rsvp_deadline ? html`<dt>RSVP by</dt><dd>${fmtDT(e.rsvp_deadline)}${deadlinePassed ? ' (passed)' : ''}</dd>` : ''}
        ${e.series_count ? html`<dt>Series</dt><dd>One of ${e.series_count} recurring events</dd>` : ''}
      </dl></div></div>
      ${e.type !== 'meeting' || staff ? html`<div class="card"><div class="hd"><h2>RSVP</h2>${deadlinePassed ? html`<span class="r badge warn">Deadline passed</span>` : ''}</div><div class="bd" id="rsvp">
        ${ctx.me.user.role !== 'parent' ? rsvpBlock(staff ? 'Me (staff coverage)' : 'Me', e.my_rsvp, null) : ''}
        ${(e.player_rsvps || []).map((p) => rsvpBlock(p.name, p.status ? p : null, p.player_id))}
        <p class="help">Not going needs a reason. Your RSVP becomes planned attendance for coaches.</p>
      </div></div>` : ''}
      ${staff && e.can_edit ? html`<div class="card"><div class="hd"><h2>Quick status change</h2><span class="r faint" style="font-size:12px">Sends an urgent alert</span></div><div class="bd row">
        <button data-st="indoors">Moved indoors</button><button data-st="delayed">Delayed</button><button data-st="cancelled" class="danger">Cancel</button>${e.status !== 'scheduled' ? html`<button data-st="scheduled">Back on schedule</button>` : ''}
      </div></div>` : ''}
      ${staff && e.history ? html`<div class="card"><div class="hd"><h2>Change log</h2></div>${e.history.length ? html`<ul class="list">${e.history.map((h) => html`<li><div class="grow"><div class="t">${h.user_name || 'System'} · ${cap(h.action)}</div><div class="s">${h.detail ? Object.entries(h.detail).map(([k, v]) => (v && typeof v === 'object' && 'to' in v ? `${k}: ${fmtVal(v.from)} → ${fmtVal(v.to)}` : `${k}: ${fmtVal(v)}`)).join(' · ') : ''}</div></div><div class="s">${ago(h.at)}</div></li>`)}</ul>` : empty('No changes yet.')}</div>` : ''}
    </div>
    ${staff ? html`<div class="stack">
      <div class="card"><div class="hd"><h2>Responses</h2></div><div class="bd">
        <div class="grid g3" style="gap:8px;margin-bottom:10px">
          <div><div class="faint" style="font-size:12px">Going</div><b style="font-size:18px">${e.rsvp_counts?.going || 0}</b></div>
          <div><div class="faint" style="font-size:12px">Not going</div><b style="font-size:18px">${e.rsvp_counts?.not_going || 0}</b></div>
          <div><div class="faint" style="font-size:12px">No reply</div><b style="font-size:18px">${e.no_response}</b></div>
        </div>
        <div class="s muted">Staff going: ${e.staff_going.length ? e.staff_going.join(', ') : 'none yet'}</div>
      </div>
      ${e.rsvps.length ? html`<ul class="list" style="border-top:1px solid var(--border);max-height:340px;overflow-y:auto">${e.rsvps.map((r) => html`<li><div class="grow"><div class="t">${r.name}</div><div class="s">${ROLE[r.role]}${r.by_name && r.by_name !== r.name ? ` · by ${r.by_name}` : ''}${r.reason ? ` · ${r.reason}` : ''}</div></div>${statusBadge(r.status)}</li>`)}</ul>` : ''}</div>
      <div class="card"><div class="hd"><h2>Urgent alerts</h2></div>${e.alerts.length ? html`<ul class="list">${e.alerts.map((a) => html`<li class="click" data-ack="${a.ref}"><div class="grow"><div class="t">${a.title}</div><div class="s">${ago(a.sent)}</div></div><span class="badge ${a.opened === a.total ? 'ok' : 'warn'}">${a.opened}/${a.total} opened</span></li>`)}</ul>` : empty('No urgent alerts sent.')}</div>
    </div>` : ''}
  </div>`);

  $('#mail', el).onclick = async () => { try { await api.post(`/api/events/${id}/email`); toast('Sent to your email'); } catch (err) { errToast(err); } };
  on(el, 'click', '[data-rsvp]', async (ev, b) => {
    const status = b.dataset.rsvp;
    const forPlayer = b.closest('[data-rsvp-for]').dataset.rsvpFor || undefined;
    let reason;
    if (status === 'not_going') {
      reason = await new Promise((res) => modal({ title: 'Reason for not going', body: html`<select id="rs">${options(REASONS.map((r) => [r, cap(r)]))}</select>`, actions: [{ label: 'Cancel', onClick: () => res(null) }, { label: 'Save', primary: true, onClick: (r) => res(r.querySelector('#rs').value) }] }));
      if (!reason) return;
    }
    try { await api.post(`/api/events/${id}/rsvp`, { status, reason, for_player: forPlayer ? Number(forPlayer) : undefined }); toast('RSVP saved'); ctx.reload(); } catch (err) { errToast(err); }
  });
  on(el, 'click', '[data-st]', async (ev, b) => {
    const st = b.dataset.st;
    modal({
      title: { indoors: 'Move indoors', delayed: 'Delay event', cancelled: 'Cancel event', scheduled: 'Back on schedule' }[st],
      body: html`<form id="sf">${st === 'delayed' ? field('Delay by (minutes)', html`<input type="number" name="delay_minutes" value="30" min="5" step="5">`) : ''}${st === 'indoors' ? field('New location', html`<input name="location" value="Field house">`) : ''}
        ${field('Note to the team', html`<input name="note" placeholder="${st === 'cancelled' ? 'Lightning in the area' : 'Optional'}">`)}
        <label class="check"><input type="checkbox" name="emergency"> Emergency (ignore quiet hours)</label></form>`,
      actions: [{ label: 'Cancel' }, { label: 'Send alert', primary: st !== 'cancelled', danger: st === 'cancelled', onClick: async (r) => {
        const f = formData(r.querySelector('#sf'));
        const res = await api.post(`/api/events/${id}/status`, { status: st, ...f });
        toast(`Alert sent to ${res.sent} people`); ctx.reload();
      } }],
    });
  });
  on(el, 'click', '[data-ack]', async (ev, li) => {
    const a = await api.get(`/api/events/${id}/acks?ref=${encodeURIComponent(li.dataset.ack)}`);
    modal({ title: 'Who has opened the alert', wide: true, body: html`<div class="grid g2"><div><h4>Opened (${a.opened.length})</h4><ul class="list">${a.opened.map((r) => html`<li><div class="grow">${r.name}</div><span class="s">${ROLE[r.role]} · ${ago(r.opened_at)}</span></li>`)}</ul></div>
      <div><h4>Not opened (${a.not_opened.length})</h4><ul class="list">${a.not_opened.map((r) => html`<li><div class="grow">${r.name}</div><span class="s">${ROLE[r.role]}</span></li>`)}</ul></div></div>`, actions: [{ label: 'Close' }] });
  });
  if ($('#edit', el)) $('#edit', el).onclick = async () => eventForm(ctx, await api.get('/api/audiences'), e);
  if ($('#del', el)) $('#del', el).onclick = async () => {
    let scope = '';
    if (e.series_id) {
      scope = await new Promise((res) => modal({ title: 'Delete recurring event', body: html`<p>Delete only this event, or this and every later event in the series?</p>`, actions: [{ label: 'Cancel', onClick: () => res(null) }, { label: 'This event', onClick: () => res('one') }, { label: 'This and later', danger: true, onClick: () => res('series') }] }));
      if (!scope) return;
    } else if (!(await confirmDialog('Delete this event? Everyone in the audience is notified.', { danger: true, ok: 'Delete' }))) return;
    await api.del(`/api/events/${id}?scope=${scope}`); toast('Deleted'); ctx.navigate('/calendar');
  };
  if ($('#mkplan', el)) $('#mkplan', el).onclick = async () => { const r = await api.post('/api/plans', { event_id: id }); ctx.navigate(`/practice/${r.id}`); };
}
const fmtVal = (v) => (v == null ? '—' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v).replace('T', ' '));
