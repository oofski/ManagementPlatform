// Module 1: Calendar — events with audiences and types, recurrence, game-week templates, status changes,
// change log, reminders, urgent alerts with acknowledgment, RSVP, and an ICS subscribe feed.
import { fail, need, nowLocal, addMinutes, addDays, parseLocal, fmtLocal, today, token } from '../core.js';
import { j, jAll } from '../db.js';

export const EVENT_TYPES = ['game', 'practice', 'lift', 'film', 'meeting', 'social', 'camp', 'other'];
export const RSVP_REASONS = ['sick', 'injured', 'family', 'academic', 'transportation', 'other'];
const TYPE_FIELDS = {
  game: ['opponent', 'home_away', 'kickoff', 'bus_departure', 'report_time', 'uniform'],
  practice: ['what_to_bring', 'indoor_outdoor'],
  lift: ['what_to_bring', 'wt_assignment_id'],
  social: ['head_count', 'cost'],
  film: ['what_to_bring'],
  meeting: ['agenda'],
  // F-4: summer and position camps.
  camp: ['location_details', 'what_to_bring', 'cost'],
  other: [],
};

export default function calendar(ctx) {
  const { router, db, core } = ctx;
  const { can, isStaff, isAdmin, audit, notify } = core;

  const getEvent = (pid, id) => j(db.get('SELECT * FROM events WHERE id=? AND program_id=?', id, pid), 'audience', 'details', 'reminders');
  const canEdit = (u, e) => isAdmin(u) || (can(u, 'calendar.edit') && (e.created_by === u.id || core.managesAudience(u, e.audience)));
  const recipients = (e) => core.resolveRecipients(e.program_id, e.audience);

  function cleanDetails(type, d = {}) {
    const keep = TYPE_FIELDS[type] || [];
    return Object.fromEntries(Object.entries(d).filter(([k, v]) => keep.includes(k) && v !== '' && v != null));
  }
  function validate(b, partial = false) {
    if (!partial || b.type !== undefined) need(EVENT_TYPES.includes(b.type), 400, 'Unknown event type');
    if (!partial || b.title !== undefined) need(b.title && String(b.title).trim(), 400, 'Title is required');
    if (!partial || b.start !== undefined) need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(b.start || ''), 400, 'Start must be YYYY-MM-DDTHH:MM');
    if (b.end) need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(b.end) && (!b.start || b.end >= b.start), 400, 'End must be after start');
    if (b.audience !== undefined) need(Array.isArray(b.audience) && b.audience.length, 400, 'Pick at least one audience');
  }

  function shape(e, u) {
    const out = { ...e, audience_labels: core.describeAudience(e.program_id, e.audience) };
    const mine = db.get('SELECT status, reason FROM rsvps WHERE event_id=? AND user_id=?', e.id, u.id);
    out.my_rsvp = mine || null;
    const linked = core.linkedPlayers(u).filter((pid) => u.role === 'parent');
    if (linked.length) {
      out.player_rsvps = linked.map((pid) => ({ player_id: pid, name: db.get('SELECT name FROM users WHERE id=?', pid).name, ...(db.get('SELECT status, reason FROM rsvps WHERE event_id=? AND user_id=?', e.id, pid) || { status: null }) }));
    }
    out.can_edit = canEdit(u, e);
    out.plan_id = db.get('SELECT id FROM practice_plans WHERE event_id=? LIMIT 1', e.id)?.id ?? null;
    if (isStaff(u)) {
      const c = db.all('SELECT status, count(*) n FROM rsvps WHERE event_id=? GROUP BY status', e.id);
      out.rsvp_counts = Object.fromEntries(c.map((r) => [r.status, r.n]));
    }
    return out;
  }

  router.get('/api/calendar/meta', () => ({ types: EVENT_TYPES, fields: TYPE_FIELDS, reasons: RSVP_REASONS }));

  router.get('/api/events', ({ user, query }) => {
    const from = query.from || addDays(today(), -31);
    const to = query.to || addDays(today(), 62);
    let rows = jAll(db.all('SELECT * FROM events WHERE program_id=? AND start>=? AND start<=? ORDER BY start', user.program_id, from, `${to}T23:59`), 'audience', 'details', 'reminders');
    if (query.type) rows = rows.filter((e) => e.type === query.type);
    // CAL-1: each user sees one calendar filtered to their groups. Admins see all, or filter to a group.
    const filterTok = query.audience;
    rows = rows.filter((e) => core.inAudience(user, e.audience));
    if (filterTok) {
      const ids = new Set(core.resolvePlayers(user.program_id, [filterTok]));
      rows = rows.filter((e) => e.audience.includes(filterTok) || e.audience.includes('program') || core.resolvePlayers(user.program_id, e.audience).some((p) => ids.has(p)));
    }
    return rows.map((e) => shape(e, user));
  });

  router.get('/api/events/:id', ({ user, params }) => {
    const e = getEvent(user.program_id, Number(params.id));
    need(e && core.inAudience(user, e.audience), 404, 'Event not found');
    const out = shape(e, user);
    if (isStaff(user)) {
      const expected = core.resolvePlayers(e.program_id, e.audience);
      const rs = db.all(`SELECT r.*, u.name, u.role, b.name by_name FROM rsvps r JOIN users u ON u.id=r.user_id LEFT JOIN users b ON b.id=r.by_user WHERE r.event_id=? ORDER BY u.name`, e.id);
      out.rsvps = rs;
      out.expected_players = expected.length;
      const responded = new Set(rs.map((r) => r.user_id));
      out.no_response = expected.filter((id) => !responded.has(id)).length;
      out.staff_going = rs.filter((r) => r.role !== 'player' && r.role !== 'parent' && r.status === 'going').map((r) => r.name);
      out.history = jAll(db.all(`SELECT a.at, a.action, a.detail, u.name user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.entity='event' AND a.entity_id=? ORDER BY a.id DESC`, e.id), 'detail');
      out.alerts = db.all(`SELECT ref, title, min(created_at) sent, count(*) total, sum(opened_at IS NOT NULL) opened FROM notifications WHERE ref LIKE ? GROUP BY ref ORDER BY sent DESC`, `event:${e.id}:urgent:%`);
    }
    if (e.series_id) out.series_count = db.get('SELECT count(*) n FROM events WHERE series_id=?', e.series_id).n;
    return out;
  });

  function createOne(user, b, seriesId = null) {
    const id = db.insert('events', {
      program_id: user.program_id, season_id: core.currentSeason(user.program_id)?.id, type: b.type, title: b.title.trim(), start: b.start,
      end: b.end || null, location: b.location || null, audience: b.type === 'meeting' && !b.audience ? ['coaches'] : b.audience,
      details: cleanDetails(b.type, b.details), rsvp_deadline: b.rsvp_deadline || null, reminders: b.reminders || core.settings(user.program_id).reminder_defaults,
      series_id: seriesId, created_by: user.id, updated_at: nowLocal(),
    });
    audit(user, 'create', 'event', id, { title: b.title, start: b.start });
    return id;
  }

  // Expand a weekly/daily repeat rule into start dates.
  function expand(start, repeat) {
    const out = [];
    const until = repeat.until || addDays(start.slice(0, 10), 7 * 12);
    const days = repeat.days && repeat.days.length ? repeat.days.map(Number) : [parseLocal(start).getDay()];
    const time = start.slice(11);
    let d = parseLocal(start.slice(0, 10) + 'T00:00');
    const end = parseLocal(until + 'T23:59');
    while (d <= end && out.length < 200) {
      const ok = repeat.freq === 'daily' || days.includes(d.getDay());
      if (ok) out.push(`${fmtLocal(d).slice(0, 10)}T${time}`);
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  router.post('/api/events', ({ user, body }) => {
    need(can(user, 'calendar.edit'), 403, 'You cannot create events');
    if (body.type === 'meeting' && !body.audience) body.audience = ['coaches'];
    validate(body);
    need(isAdmin(user) || core.managesAudience(user, body.audience), 403, 'You can only create events for your own groups');
    if (body.repeat && body.repeat.freq) {
      const dur = body.end ? (parseLocal(body.end) - parseLocal(body.start)) / 60000 : null;
      const sid = db.insert('event_series', { program_id: user.program_id, rule: body.repeat });
      const starts = expand(body.start, body.repeat);
      need(starts.length, 400, 'The repeat rule produced no dates');
      const ids = db.tx(() => starts.map((s) => createOne(user, { ...body, start: s, end: dur != null ? addMinutes(s, dur) : null }, sid)));
      notify(user.program_id, core.resolveRecipients(user.program_id, body.audience).filter((id) => id !== user.id), { kind: 'update', title: `New: ${body.title}`, body: `${ids.length} sessions starting ${body.start.replace('T', ' ')}`, link: `/calendar/${ids[0]}`, ref: `event:${ids[0]}:new` });
      return { id: ids[0], ids, series_id: sid };
    }
    const id = createOne(user, body);
    notify(user.program_id, core.resolveRecipients(user.program_id, body.audience).filter((x) => x !== user.id), { kind: 'update', title: `New: ${body.title}`, body: body.start.replace('T', ' ') + (body.location ? ` at ${body.location}` : ''), link: `/calendar/${id}`, ref: `event:${id}:new` });
    return { id };
  });

  const IMPORTANT = ['start', 'end', 'location'];
  function applyEdit(user, e, b, keepDate) {
    const upd = { updated_at: nowLocal() };
    for (const k of ['title', 'location', 'rsvp_deadline']) if (b[k] !== undefined) upd[k] = b[k] || null;
    if (b.type) upd.type = b.type;
    if (b.audience) upd.audience = b.audience;
    if (b.reminders) upd.reminders = b.reminders;
    if (b.details) {
      upd.details = cleanDetails(b.type || e.type, b.details);
      // Lift events stay linked to their weight-room program day when the details are replaced.
      if ((b.type || e.type) === 'lift') for (const k of ['wt_assignment_id', 'week', 'day']) if (e.details?.[k] != null) upd.details[k] = e.details[k];
    }
    if (b.start) upd.start = keepDate ? `${e.start.slice(0, 10)}T${b.start.slice(11)}` : b.start;
    if (b.end !== undefined) upd.end = b.end ? (keepDate ? `${(e.end || e.start).slice(0, 10)}T${b.end.slice(11)}` : b.end) : null;
    const changed = Object.keys(upd).filter((k) => k !== 'updated_at' && JSON.stringify(upd[k]) !== JSON.stringify(e[k]));
    db.update('events', e.id, upd);
    if (changed.length) audit(user, 'edit', 'event', e.id, Object.fromEntries(changed.map((k) => [k, { from: e[k], to: upd[k] }])));
    return changed;
  }
  router.put('/api/events/:id', ({ user, body, params }) => {
    const e = getEvent(user.program_id, Number(params.id));
    need(e, 404, 'Event not found');
    need(canEdit(user, e), 403, 'You cannot edit this event');
    validate({ ...e, ...body }, true);
    if (body.audience) need(isAdmin(user) || core.managesAudience(user, body.audience), 403, 'You can only assign your own groups');
    let changed = [];
    if (body.scope === 'series' && e.series_id) {
      const all = jAll(db.all('SELECT * FROM events WHERE series_id=? AND start>=?', e.series_id, body.include_past ? '0' : e.start.slice(0, 10)), 'audience', 'details', 'reminders');
      db.tx(() => { for (const x of all) changed = [...new Set([...changed, ...applyEdit(user, x, body, true)])]; });
    } else {
      if (e.series_id && body.scope === 'one') audit(user, 'detach_occurrence', 'event', e.id);
      changed = applyEdit(user, e, body, false);
    }
    if (changed.length) {
      const fresh = getEvent(user.program_id, e.id);
      const urgent = changed.some((c) => IMPORTANT.includes(c));
      const ref = `event:${e.id}:${urgent ? 'urgent' : 'update'}:${Date.now()}`;
      notify(user.program_id, recipients(fresh).filter((x) => x !== user.id), {
        kind: urgent ? 'urgent' : 'update', title: `${urgent ? 'Changed' : 'Updated'}: ${fresh.title}`,
        body: `${changed.join(', ')} updated. Now ${fresh.start.replace('T', ' ')}${fresh.location ? ' at ' + fresh.location : ''}`, link: `/calendar/${e.id}`, ref,
      });
    }
    return { ok: true, changed };
  });

  router.del('/api/events/:id', ({ user, params, query }) => {
    const e = getEvent(user.program_id, Number(params.id));
    need(e, 404, 'Event not found');
    need(canEdit(user, e), 403, 'You cannot delete this event');
    const victims = query.scope === 'series' && e.series_id ? db.all('SELECT id FROM events WHERE series_id=? AND start>=?', e.series_id, e.start.slice(0, 10)).map((r) => r.id) : [e.id];
    const rec = recipients(e).filter((x) => x !== user.id);
    db.tx(() => { for (const id of victims) { db.run('DELETE FROM events WHERE id=?', id); audit(user, 'delete', 'event', id, { title: e.title, start: e.start }); } });
    notify(user.program_id, rec, { kind: 'urgent', title: `Removed: ${e.title}`, body: `${victims.length > 1 ? victims.length + ' sessions' : e.start.replace('T', ' ')} removed from the calendar`, ref: `event:${e.id}:urgent:${Date.now()}` });
    return { ok: true, deleted: victims.length };
  });

  // CAL-6: quick status change with urgent alert
  router.post('/api/events/:id/status', ({ user, params, body }) => {
    const e = getEvent(user.program_id, Number(params.id));
    need(e, 404, 'Event not found');
    need(canEdit(user, e), 403, 'You cannot change this event');
    need(['scheduled', 'indoors', 'delayed', 'cancelled'].includes(body.status), 400, 'Unknown status');
    const upd = { status: body.status, status_note: body.note || null, updated_at: nowLocal() };
    if (body.status === 'delayed' && body.delay_minutes) {
      upd.start = addMinutes(e.start, Number(body.delay_minutes));
      if (e.end) upd.end = addMinutes(e.end, Number(body.delay_minutes));
    }
    if (body.status === 'indoors' && body.location) upd.location = body.location;
    db.update('events', e.id, upd);
    audit(user, 'status', 'event', e.id, { status: body.status, note: body.note, delay_minutes: body.delay_minutes });
    const label = { scheduled: 'Back on schedule', indoors: 'Moved indoors', delayed: 'Delayed', cancelled: 'Cancelled' }[body.status];
    const ref = `event:${e.id}:urgent:${Date.now()}`;
    const sent = notify(user.program_id, recipients(e).filter((x) => x !== user.id), {
      kind: 'urgent', title: `${label}: ${e.title}`,
      body: [body.note, upd.start && upd.start !== e.start ? `New start ${upd.start.replace('T', ' ')}` : null, upd.location ? `Location: ${upd.location}` : null].filter(Boolean).join('. '),
      link: `/calendar/${e.id}`, ref, emergency: !!body.emergency,
    });
    return { ok: true, ref, sent };
  });

  // CAL-10: acknowledgments for an urgent alert
  router.get('/api/events/:id/acks', ({ user, params, query }) => {
    need(isStaff(user), 403, 'Staff only');
    const e = getEvent(user.program_id, Number(params.id));
    need(e, 404, 'Event not found');
    const ref = query.ref || db.get(`SELECT ref FROM notifications WHERE ref LIKE ? ORDER BY id DESC LIMIT 1`, `event:${e.id}:urgent:%`)?.ref;
    if (!ref) return { ref: null, opened: [], not_opened: [] };
    const rows = db.all('SELECT n.opened_at, u.id, u.name, u.role FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.ref=? ORDER BY u.name', ref);
    return { ref, opened: rows.filter((r) => r.opened_at), not_opened: rows.filter((r) => !r.opened_at) };
  });

  // CAL-5: game-week template
  router.post('/api/events/game-week', ({ user, body }) => {
    need(can(user, 'calendar.edit'), 403, 'You cannot create events');
    need(/^\d{4}-\d{2}-\d{2}$/.test(body.game_date || ''), 400, 'Game date is required');
    need(body.opponent, 400, 'Opponent is required');
    need(isAdmin(user) || (body.audience && body.audience.length), 400, 'Pick who this game week is for');
    const audience = body.audience && body.audience.length ? body.audience : ['program'];
    need(isAdmin(user) || core.managesAudience(user, audience), 403, 'You can only create events for your own groups');
    const gd = parseLocal(body.game_date + 'T00:00');
    const monday = new Date(gd); monday.setDate(gd.getDate() - ((gd.getDay() + 6) % 7));
    const mondayStr = fmtLocal(monday).slice(0, 10);
    const template = body.template || core.settings(user.program_id).game_week_template;
    const kickoff = body.kickoff || '19:00';
    const ids = db.tx(() => {
      const out = [];
      for (const t of template) {
        const date = addDays(mondayStr, t.day);
        if (date >= body.game_date) continue;
        out.push(createOne(user, { type: t.type, title: `${t.title} (vs ${body.opponent})`, start: `${date}T${t.start}`, end: t.end ? `${date}T${t.end}` : null, location: t.location, audience: t.type === 'meeting' ? ['coaches'] : audience }));
      }
      const report = addMinutes(`${body.game_date}T${kickoff}`, -120);
      out.push(createOne(user, {
        type: 'game', title: `${body.home_away === 'away' ? '@' : 'vs'} ${body.opponent}`, start: `${body.game_date}T${kickoff}`, end: addMinutes(`${body.game_date}T${kickoff}`, 180),
        location: body.location || (body.home_away === 'away' ? body.opponent : 'Home stadium'), audience,
        details: { opponent: body.opponent, home_away: body.home_away || 'home', kickoff, report_time: report.slice(11), bus_departure: body.home_away === 'away' ? addMinutes(report, -45).slice(11) : undefined, uniform: body.uniform },
      }));
      return out;
    });
    notify(user.program_id, core.resolveRecipients(user.program_id, audience).filter((x) => x !== user.id), { kind: 'update', title: `Game week posted: ${body.opponent}`, body: `${ids.length} events added`, link: `/calendar/${ids[ids.length - 1]}` });
    return { ids };
  });

  // CAL-11: RSVP
  router.post('/api/events/:id/rsvp', ({ user, params, body }) => {
    const e = getEvent(user.program_id, Number(params.id));
    need(e && core.inAudience(user, e.audience), 404, 'Event not found');
    need(['going', 'not_going', 'maybe'].includes(body.status), 400, 'Choose going, not going or maybe');
    if (body.status === 'not_going') need(RSVP_REASONS.includes(body.reason), 400, 'A reason is required when not going');
    let target = user.id;
    if (body.for_player) {
      target = Number(body.for_player);
      need(core.linkedPlayers(user).includes(target)
        || (isStaff(user) && (target === user.id || core.resolvePlayers(user.program_id, e.audience).includes(target))), 403, 'You can only reply for your own player');
    }
    need(user.role !== 'parent' || body.for_player, 400, 'Parents reply on behalf of their player');
    if (e.rsvp_deadline && nowLocal() > e.rsvp_deadline) need(isStaff(user), 400, 'The RSVP deadline has passed. Contact a coach.');
    need(e.status !== 'cancelled', 400, 'This event was cancelled');
    db.run(`INSERT INTO rsvps (event_id, user_id, status, reason, note, by_user, at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(event_id, user_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, note=excluded.note, by_user=excluded.by_user, at=excluded.at`,
    e.id, target, body.status, body.status === 'not_going' ? body.reason : null, body.note || null, user.id, nowLocal());
    // CAL-12: RSVP becomes planned attendance (pre-marked, coach confirms).
    const isPlayer = db.get(`SELECT 1 FROM users WHERE id=? AND role='player'`, target);
    if (isPlayer) {
      const att = db.get('SELECT * FROM attendance WHERE event_id=? AND player_id=?', e.id, target);
      if (body.status === 'not_going') {
        if (!att || att.source === 'rsvp') db.run(`INSERT INTO attendance (event_id, player_id, status, reason, source, confirmed, by_user, at) VALUES (?,?,?,?,?,0,?,?)
          ON CONFLICT(event_id, player_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, source='rsvp', confirmed=0`, e.id, target, 'excused', body.reason, 'rsvp', user.id, nowLocal());
      } else if (att && att.source === 'rsvp' && !att.confirmed) db.run('DELETE FROM attendance WHERE event_id=? AND player_id=?', e.id, target);
    }
    audit(user, 'rsvp', 'event', e.id, { for: target, status: body.status, reason: body.reason });
    return { ok: true };
  });

  // CAL-13: email event details to me
  router.post('/api/events/:id/email', ({ user, params }) => {
    const e = getEvent(user.program_id, Number(params.id));
    need(e && core.inAudience(user, e.audience), 404, 'Event not found');
    need(user.email, 400, 'Your account has no email address');
    const lines = [`${e.title}`, `When: ${e.start.replace('T', ' ')}${e.end ? ' to ' + e.end.slice(11) : ''}`, e.location ? `Where: ${e.location}` : null,
      ...Object.entries(e.details).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)].filter(Boolean);
    db.insert('outbox', { user_id: user.id, to_email: user.email, subject: `Event: ${e.title}`, body: lines.join('\n'), deliver_at: nowLocal() });
    return { ok: true };
  });

  router.get('/api/calendar/feed-url', ({ user }) => {
    let t = db.get('SELECT cal_token FROM users WHERE id=?', user.id).cal_token;
    if (!t) { t = token(16); db.update('users', user.id, { cal_token: t }); }
    return { path: `/feed/${t}.ics` };
  });

  // ICS feed (one-way sync to Google, Apple and Outlook)
  router.get('/feed/:file', ({ params }) => {
    const t = params.file.replace(/\.ics$/, '');
    const u = db.get('SELECT * FROM users WHERE cal_token=? AND active=1', t);
    need(u, 404, 'Unknown calendar');
    u.perms = JSON.parse(u.perms || '{}');
    const rows = jAll(db.all('SELECT * FROM events WHERE program_id=? AND start>=? ORDER BY start', u.program_id, addDays(today(), -60)), 'audience', 'details').filter((e) => core.inAudience(u, e.audience));
    const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const dt = (s) => s.replace(/[-:]/g, '') + '00';
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Program Manager//Calendar//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Team calendar', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
    for (const e of rows) {
      const desc = [e.status !== 'scheduled' ? `STATUS: ${e.status.toUpperCase()} ${e.status_note || ''}` : null, ...Object.entries(e.details).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)].filter(Boolean).join('\n');
      lines.push('BEGIN:VEVENT', `UID:event-${e.id}@program-manager`, `DTSTAMP:${dt(nowLocal())}`, `DTSTART:${dt(e.start)}`, `DTEND:${dt(e.end || addMinutes(e.start, 60))}`,
        `SUMMARY:${esc((e.status === 'cancelled' ? 'CANCELLED: ' : '') + e.title)}`, `LOCATION:${esc(e.location)}`, `DESCRIPTION:${esc(desc)}`,
        `STATUS:${e.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return { __raw: true, type: 'text/calendar; charset=utf-8', body: lines.join('\r\n') };
  }, { auth: false });

  // CAL-9: reminders before events (default 24h and 2h)
  function sendReminders(now = nowLocal()) {
    const horizon = addMinutes(now, 60 * 24 * 7);
    const rows = jAll(db.all(`SELECT * FROM events WHERE start>? AND start<=? AND status!='cancelled'`, now, horizon), 'audience', 'reminders');
    let sent = 0;
    for (const e of rows) {
      // Only the nearest due reminder is sent; earlier ones that were missed are marked done.
      const due = (e.reminders || []).filter((off) => addMinutes(e.start, -off) <= now && !db.get('SELECT 1 FROM reminder_log WHERE event_id=? AND offset_min=?', e.id, off)).sort((a, b) => a - b);
      for (const off of due.slice(1)) db.run('INSERT INTO reminder_log VALUES (?,?)', e.id, off);
      for (const off of due.slice(0, 1)) {
        db.run('INSERT INTO reminder_log VALUES (?,?)', e.id, off);
        const label = off >= 1440 ? `${Math.round(off / 1440)} day` : off >= 60 ? `${Math.round(off / 60)} hours` : `${off} minutes`;
        notify(e.program_id, recipients(e), { kind: 'reminder', title: `Reminder: ${e.title}`, body: `Starts ${e.start.replace('T', ' ')} (in about ${label})${e.location ? ' at ' + e.location : ''}`, link: `/calendar/${e.id}`, from: 'system', email: off >= 1440 });
        sent++;
      }
    }
    return sent;
  }
  ctx.ticks.push(() => sendReminders());
  ctx.sendReminders = sendReminders;
  router.post('/api/calendar/run-reminders', ({ user }) => {
    need(isAdmin(user), 403, 'Admins only');
    return { sent: sendReminders() };
  });
}
