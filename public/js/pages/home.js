// Home screens: head coach / staff dashboard (SEA-7) and player / parent view (SEA-8).
import { api } from '../api.js';
import { icon } from '../icons.js';
import { html, set, fmtHM, fmtDT, fmtTime, fmtDate, ago, statusBadge, availBadge, empty, bar, pct, cap, todayISO } from '../ui.js';

export default async function home(el, ctx) {
  const d = await api.get('/api/home');
  if (d.role === 'staff') return staffHome(el, ctx, d);
  return familyHome(el, ctx, d);
}

function staffHome(el, ctx, d) {
  const av = d.availability || {};
  const totalPlayers = (av.available || 0) + (av.limited || 0) + (av.out || 0) + (av.cleared || 0);
  set(el, html`
  <div class="page-head"><div><h1>Overview</h1><div class="sub">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · ${ctx.me.season?.name || ''}</div></div>
    <div class="actions">${ctx.me.caps['calendar.edit'] ? html`<a class="btn" href="/calendar?new=1">${icon('plus', 14)} New event</a>` : ''}${ctx.me.caps['messages.send'] ? html`<a class="btn" href="/messages/announcements?new=1">Announcement</a>` : ''}<a class="btn primary" href="/attendance">${icon('calendar-check', 14)} Take attendance</a></div></div>
  <div id="fbelig"></div>
  ${d.conflicts ? html`<div class="notice warn">${d.conflicts} offline change(s) conflict with newer edits. <a href="/attendance">Review on the attendance page</a>.</div>` : ''}
  ${d.open_reports || d.pending_blocks ? html`<div class="notice warn">${d.open_reports ? `${d.open_reports} reported or flagged message(s)` : ''}${d.open_reports && d.pending_blocks ? ' · ' : ''}${d.pending_blocks ? `${d.pending_blocks} parent contact-block request(s)` : ''} need review. <a href="/messages/moderation">Open moderation</a></div>` : ''}
  <div class="grid g4" style="margin-bottom:14px">
    <div class="card stat"><div class="k">Available players</div><div class="v">${av.available || 0}<span class="muted" style="font-size:14px"> / ${totalPlayers}</span></div><div class="d">${av.limited || 0} limited · ${av.out || 0} out</div></div>
    <div class="card stat"><div class="k">Equipment not returned</div><div class="v">${d.deadlines.equipment_outstanding}</div><div class="d"><a href="/equipment?tab=outstanding">Outstanding list</a></div></div>
    <div class="card stat"><div class="k">Helmets due or past age</div><div class="v">${d.deadlines.helmets_due}</div><div class="d"><a href="/equipment?tab=helmets">Helmet maintenance</a></div></div>
    <div class="card stat"><div class="k">Overdue assignments</div><div class="v">${d.overdue_assignments.length}</div><div class="d">${d.unread_announcements} unread announcement(s)</div></div>
  </div>
  <div class="grid g-side">
    <div class="stack">
      <div class="card"><div class="hd"><h2>Today</h2><span class="r"><a href="/calendar">Calendar</a></span></div>
        ${d.today.length ? html`<ul class="list">${d.today.map((e) => html`<li class="click type-${e.type}" onclick="__navigate('/attendance/${e.id}')">
          <div style="width:70px" class="s">${fmtTime(e.start)}</div>
          <div class="grow"><div class="t">${e.title} ${e.status !== 'scheduled' ? statusBadge(e.status) : ''}</div><div class="s">${e.location || ''}${e.plan_id ? html` · <a href="/practice/${e.plan_id}/run" onclick="event.stopPropagation()">Run practice plan</a>` : ''}</div></div>
          <div style="width:180px"><div class="s">${e.here} here · ${e.absent + e.planned_absent} out · ${Math.max(0, e.expected - e.here - e.absent - e.planned_absent)} not in</div>${bar(pct(e.here, e.expected))}</div>
        </li>`)}</ul>` : empty('Nothing on the calendar today.')}
      </div>
      <div class="card"><div class="hd"><h2>This week</h2></div>
        ${d.week.length ? html`<ul class="list">${d.week.filter((e) => !e.start.startsWith(todayISO())).slice(0, 12).map((e) => html`<li class="click type-${e.type}" onclick="__navigate('/calendar/${e.id}')"><div style="width:120px" class="s">${fmtDate(e.start)} ${fmtTime(e.start)}</div><div class="grow t">${e.title}</div>${e.status !== 'scheduled' ? statusBadge(e.status) : html`<span class="badge">${cap(e.type)}</span>`}</li>`)}</ul>` : empty('No more events this week.')}
      </div>
      <div class="card"><div class="hd"><h2>Overdue assignments</h2><span class="r"><a href="/assignments">All assignments</a></span></div>
        ${d.overdue_assignments.length ? html`<ul class="list">${d.overdue_assignments.map((a) => html`<li class="click" onclick="__navigate('/assignments/${a.id}')"><div class="grow"><div class="t">${a.title}</div><div class="s">Due ${fmtDT(a.due)}</div></div><span class="badge bad">${a.pending} not done</span></li>`)}</ul>` : empty('Nothing overdue.')}
      </div>
    </div>
    <div class="stack">
      <div class="card"><div class="hd"><h2>Availability changes</h2><span class="r faint" style="font-size:12px">last 7 days</span></div>
        ${d.availability_changes.length ? html`<ul class="list">${d.availability_changes.map((a) => html`<li class="click" onclick="__navigate('/players/${a.entity_id}')"><div class="grow"><div class="t">${a.player}</div><div class="s">${a.by_name} · ${ago(a.at)}${a.detail?.return_date ? ` · back ${fmtDate(a.detail.return_date)}` : ''}</div></div>${availBadge(a.detail?.availability)}</li>`)}</ul>` : empty('No changes.')}
      </div>
      <div class="card"><div class="hd"><h2>Upcoming deadlines</h2></div>
        ${d.deadlines.assignments_due.length ? html`<ul class="list">${d.deadlines.assignments_due.map((a) => html`<li class="click" onclick="__navigate('/assignments/${a.id}')"><div class="grow t">${a.title}</div><div class="s">${fmtDT(a.due)}</div></li>`)}</ul>` : empty('No assignments due in the next 7 days.')}
      </div>
      <div class="card"><div class="hd"><h2>Recent announcements</h2><span class="r"><a href="/messages/announcements">All</a></span></div>
        ${d.announcements.length ? html`<ul class="list">${d.announcements.map((a) => html`<li class="click" onclick="__navigate('/messages/announcements/${a.id}')"><div class="grow"><div class="t">${a.title}</div><div class="s">${a.by_name} · ${ago(a.at)}</div></div></li>`)}</ul>` : empty('None yet.')}
      </div>
    </div>
  </div>`);
  // F-13: eligibility count on the dashboard (staff who can see eligibility).
  api.get('/api/fb/eligibility/summary').then((s) => {
    const box = el.querySelector('#fbelig');
    if (box && (s.not_cleared || s.expiring)) set(box, html`<div class="notice warn">${icon('shield', 14)}${s.cleared} of ${s.total} athletes cleared to participate · ${s.not_cleared} not cleared${s.expiring ? ` · ${s.expiring} physical(s) expiring soon` : ''}${s.expired ? ` · ${s.expired} expired` : ''}. <a href="/eligibility?status=not_cleared">Review eligibility</a></div>`);
  }).catch(() => {});
}

function familyHome(el, ctx, d) {
  const parent = d.role === 'parent';
  set(el, html`
  <div class="page-head"><div><h1>${parent ? 'Family view' : `Hi, ${ctx.me.user.name.split(' ')[0]}`}</h1><div class="sub">${ctx.me.program.name} · ${ctx.me.season?.name || ''}</div></div>
   ${!parent ? html`<div class="actions"><a class="btn primary" href="/checkin">Check in</a></div>` : ''}</div>
  ${d.unread_announcements ? html`<div class="notice">${d.unread_announcements} new announcement(s). <a href="/messages/announcements">Read them</a></div>` : ''}
  ${!d.players.length ? html`<div class="notice warn">${parent ? 'Your account is not linked to a player yet. Ask your player to invite you from their account page.' : 'Your roster profile is not set up yet.'}</div>` : ''}
  <div class="grid g-side">
    <div class="stack">
      <div class="card"><div class="hd"><h2>Next 7 days</h2><span class="r"><a href="/calendar">Calendar</a></span></div>
        ${d.events.length ? html`<ul class="list">${d.events.map((e) => html`<li class="click type-${e.type}" onclick="__navigate('/calendar/${e.id}')">
          <div style="width:118px" class="s">${fmtDate(e.start)}<br>${fmtTime(e.start)}</div>
          <div class="grow"><div class="t">${e.title} ${e.status !== 'scheduled' ? statusBadge(e.status) : ''}</div><div class="s">${e.location || ''}${e.details?.report_time ? ` · report ${fmtHM(e.details.report_time)}` : ''}${e.details?.what_to_bring ? ` · bring: ${e.details.what_to_bring}` : ''}</div></div></li>`)}</ul>` : empty('Nothing scheduled.')}
      </div>
      ${d.players.map((p) => html`<div class="card"><div class="hd"><h2>${parent ? p.name : 'My assignments'}</h2><span class="r"><a href="/assignments">All</a></span></div>
        ${p.assignments.length ? html`<ul class="list">${p.assignments.map((a) => html`<li class="click" onclick="__navigate('/assignments/${a.id}')"><div class="grow"><div class="t">${a.title}</div><div class="s">${cap(a.type)}${a.due ? ` · due ${fmtDT(a.due)}` : ''}</div></div>${statusBadge(a.display_status === 'late' ? 'late_asn' : a.display_status, cap(a.display_status))}</li>`)}</ul>` : empty('All caught up.')}
      </div>`)}
    </div>
    <div class="stack">
      ${d.players.map((p) => html`<div class="card"><div class="hd"><h2>${parent ? p.name : 'My status'}</h2>${availBadge(p.availability)}</div><div class="bd">
        <dl class="kv">
          <dt>Attendance</dt><dd>${p.attendance_rate != null ? `${p.attendance_rate}%` : '—'}</dd>
          ${p.recent_rating !== undefined ? html`<dt>Recent ratings</dt><dd>${p.recent_rating ?? '—'}</dd>` : ''}
          <dt>Need an RSVP</dt><dd>${p.rsvp_needed ? html`<a href="/calendar">${p.rsvp_needed} event(s)</a>` : 'None'}</dd>
          <dt>Equipment to confirm</dt><dd>${p.equipment_unacknowledged ? html`<a href="/equipment">${p.equipment_unacknowledged} item(s)</a>` : 'None'}</dd>
          ${!parent ? html`<dt>Forms to fill</dt><dd>${p.forms_pending ? html`<a href="/assignments?tab=forms">${p.forms_pending}</a>` : 'None'}</dd>` : ''}
          ${p.return_date ? html`<dt>Expected back</dt><dd>${fmtDate(p.return_date)}</dd>` : ''}
        </dl></div></div>
        <div class="card"><div class="hd"><h2>Goals</h2><span class="r"><a href="/development">Progress</a></span></div>
          ${p.goals.length ? html`<ul class="list">${p.goals.map((g) => html`<li><div class="grow"><div class="t">${g.title}</div><div class="s">${g.current != null ? `Now ${g.current} ${g.unit || ''} · target ${g.target}` : g.notes || ''}</div></div><div style="width:90px">${bar(g.pct)}</div></li>`)}</ul>` : empty('No goals set yet.')}
        </div>`)}
    </div>
  </div>`);
}
