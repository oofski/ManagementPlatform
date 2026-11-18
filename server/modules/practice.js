// Module 2: Practice planning — drill library, plans with ordered periods and groups, templates,
// run mode status, quick notes, per-drill player ratings (offline-safe with client ids), summaries.
import { fail, need, nowLocal, addMinutes, addDays, parseLocal, fmtLocal, today } from '../core.js';
import { j, jAll } from '../db.js';

export const NOTE_TAGS = ['went well', 'needs work', 'injury concern', 'effort', 'technique', 'assignment error'];

export default function practice(ctx) {
  const { router, db, core } = ctx;
  const { can, isStaff, isAdmin, audit, notify } = core;

  const planOf = (pid, id) => db.get('SELECT * FROM practice_plans WHERE id=? AND program_id=?', id, pid);
  const staffOnly = (u) => need(isStaff(u), 403, 'Staff only');
  // Non-admin coaches with group scopes change only plans they wrote or whose practice is for their groups.
  const canManagePlan = (u, plan) => {
    if (isAdmin(u) || plan.created_by === u.id || !core.staffScopes(u.id).length) return true;
    const ev = plan.event_id ? j(db.get('SELECT audience FROM events WHERE id=?', plan.event_id), 'audience') : null;
    return !!ev && core.managesAudience(u, ev.audience);
  };

  // ---------- drills ----------
  router.get('/api/drills', ({ user, query }) => {
    staffOnly(user);
    let rows = jAll(db.all('SELECT d.*, u.name author FROM drills d LEFT JOIN users u ON u.id=d.created_by WHERE d.program_id=? ORDER BY d.name', user.program_id), 'positions');
    if (query.q) { const q = query.q.toLowerCase(); rows = rows.filter((d) => [d.name, d.description, d.skills, d.points].join(' ').toLowerCase().includes(q)); }
    if (query.position) rows = rows.filter((d) => d.positions.includes(query.position));
    if (query.unit) rows = rows.filter((d) => d.unit === query.unit);
    if (query.skill) rows = rows.filter((d) => (d.skills || '').toLowerCase().includes(query.skill.toLowerCase()));
    return rows;
  });
  const drillFields = (b) => ({
    name: b.name, description: b.description || null, points: b.points || null, equipment: b.equipment || null, media_url: b.media_url || null,
    unit: b.unit || null, positions: (b.positions || []).map((x) => String(x).toUpperCase()), skills: b.skills || null, duration: Number(b.duration) || 10,
  });
  router.post('/api/drills', ({ user, body }) => {
    need(can(user, 'practice.edit'), 403, 'Coaches only');
    need(body.name, 400, 'Name is required');
    const id = db.insert('drills', { program_id: user.program_id, ...drillFields(body), created_by: user.id });
    audit(user, 'create', 'drill', id);
    return { id };
  });
  router.put('/api/drills/:id', ({ user, params, body }) => {
    need(can(user, 'practice.edit'), 403, 'Coaches only');
    const d = db.get('SELECT * FROM drills WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    need(d, 404, 'Drill not found');
    db.update('drills', d.id, drillFields({ ...j(d, 'positions'), ...body }));
    audit(user, 'edit', 'drill', d.id);
    return { ok: true };
  });
  router.del('/api/drills/:id', ({ user, params }) => {
    need(can(user, 'practice.edit'), 403, 'Coaches only');
    db.run('DELETE FROM drills WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    return { ok: true };
  });

  // ---------- plans ----------
  function planDetail(user, plan) {
    const periods = jAll(db.all(`SELECT p.*, d.name drill_name, d.points drill_points, d.equipment drill_equipment, d.media_url drill_media, u.name coach_name
      FROM periods p LEFT JOIN drills d ON d.id=p.drill_id LEFT JOIN users u ON u.id=p.coach_id WHERE p.plan_id=? ORDER BY p.sort, p.id`, plan.id), 'positions', 'play_ids');
    const event = plan.event_id ? j(db.get('SELECT * FROM events WHERE id=?', plan.event_id), 'audience', 'details') : null;
    for (const p of periods) {
      p.plays = p.play_ids.length ? db.all(`SELECT id, name, formation FROM plays WHERE id IN (${p.play_ids.map(() => '?').join(',')})`, ...p.play_ids) : [];
    }
    const notes = jAll(db.all(`SELECT n.*, u.name coach_name, pl.name player_name FROM practice_notes n LEFT JOIN users u ON u.id=n.coach_id LEFT JOIN users pl ON pl.id=n.player_id WHERE n.plan_id=? ORDER BY n.id DESC`, plan.id), 'tags');
    const ratings = can(user, 'ratings.view') ? db.all(`SELECT r.*, u.name player_name, c.name coach_name FROM ratings r JOIN users u ON u.id=r.player_id LEFT JOIN users c ON c.id=r.coach_id WHERE r.plan_id=? ORDER BY r.id DESC`, plan.id) : [];
    const total = periods.reduce((s, p) => s + (p.status === 'skipped' ? 0 : p.duration), 0);
    const contact = periods.reduce((s, p) => s + (p.contact && p.status !== 'skipped' ? p.duration : 0), 0);
    // PRAC-13 / CAL-15: weekly practice time against the configured state limit.
    let week = null;
    const date = event ? event.start.slice(0, 10) : null;
    if (date) {
      const d = parseLocal(date + 'T00:00'); const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const from = fmtLocal(mon).slice(0, 10); const to = addDays(from, 6);
      const all = jAll(db.all(`SELECT e.id, e.start, e.end, e.audience FROM events e WHERE e.program_id=? AND e.type='practice' AND e.status!='cancelled' AND e.start>=? AND e.start<=?`, plan.program_id, from, to + 'T23:59'), 'audience');
      // Only count practices for the same players (a JV practice does not count toward varsity's weekly limit).
      const mine = new Set(core.resolvePlayers(plan.program_id, event.audience));
      const evs = all.filter((ev) => ev.id === event.id || ev.audience.some((t) => event.audience.includes(t))
        || core.resolvePlayers(plan.program_id, ev.audience).some((id) => mine.has(id)));
      let minutes = 0; let contactMin = 0;
      for (const ev of evs) {
        const pl = db.get('SELECT id FROM practice_plans WHERE event_id=?', ev.id);
        if (pl) {
          const r = db.get(`SELECT sum(duration) t, sum(CASE WHEN contact=1 THEN duration ELSE 0 END) c FROM periods WHERE plan_id=? AND status!='skipped'`, pl.id);
          minutes += r.t || 0; contactMin += r.c || 0;
        } else if (ev.end) minutes += (parseLocal(ev.end) - parseLocal(ev.start)) / 60000;
      }
      const s = core.settings(plan.program_id);
      week = { from, to, minutes, contact_minutes: contactMin, limit: s.weekly_practice_limit_min, contact_limit: s.weekly_contact_limit_min };
    }
    return { ...plan, event, periods, notes, ratings, total_minutes: total, contact_minutes: contact, week };
  }

  router.get('/api/plans', ({ user, query }) => {
    staffOnly(user);
    const rows = db.all(`SELECT pp.*, e.start event_start, e.title event_title, u.name author,
      (SELECT count(*) FROM periods WHERE plan_id=pp.id) period_count, (SELECT sum(duration) FROM periods WHERE plan_id=pp.id) minutes
      FROM practice_plans pp LEFT JOIN events e ON e.id=pp.event_id LEFT JOIN users u ON u.id=pp.created_by
      WHERE pp.program_id=? ${query.templates ? 'AND pp.is_template=1' : query.all ? '' : 'AND pp.is_template=0'} ORDER BY coalesce(e.start, pp.created_at) DESC`, user.program_id);
    return query.event_id ? rows.filter((r) => r.event_id === Number(query.event_id)) : rows;
  });
  router.get('/api/plans/:id', ({ user, params }) => {
    staffOnly(user);
    const plan = planOf(user.program_id, Number(params.id));
    need(plan, 404, 'Plan not found');
    return planDetail(user, plan);
  });
  function copyPeriods(fromId, toId) {
    for (const p of db.all('SELECT * FROM periods WHERE plan_id=? ORDER BY sort, id', fromId)) {
      const { id, plan_id, ...rest } = p;
      db.insert('periods', { ...rest, plan_id: toId, status: 'pending', status_note: null });
    }
  }
  function retime(planId) {
    const plan = db.get('SELECT * FROM practice_plans WHERE id=?', planId);
    let t = plan.start_time;
    if (!t && plan.event_id) t = db.get('SELECT start FROM events WHERE id=?', plan.event_id)?.start?.slice(11);
    if (!t) return;
    let cur = `2000-01-01T${t}`;
    for (const p of db.all('SELECT id, duration FROM periods WHERE plan_id=? ORDER BY sort, id', planId)) {
      db.run('UPDATE periods SET start_time=? WHERE id=?', cur.slice(11), p.id);
      cur = addMinutes(cur, p.duration || 0);
    }
  }
  function createPlan(user, b) {
    if (b.event_id) {
      const e = db.get('SELECT * FROM events WHERE id=? AND program_id=?', Number(b.event_id), user.program_id);
      need(e && ['practice', 'lift', 'other', 'film'].includes(e.type), 400, 'Plans attach to a practice event');
      need(!db.get('SELECT 1 FROM practice_plans WHERE event_id=?', e.id), 400, 'That practice already has a plan');
    }
    const ev = b.event_id ? db.get('SELECT title, start FROM events WHERE id=?', Number(b.event_id)) : null;
    const id = db.insert('practice_plans', {
      program_id: user.program_id, event_id: b.event_id ? Number(b.event_id) : null, name: b.name || ev?.title || 'Practice plan',
      is_template: b.is_template ? 1 : 0, notes: b.notes || null, start_time: b.start_time || ev?.start?.slice(11) || null, created_by: user.id, updated_at: nowLocal(),
    });
    const src = b.copy_from || b.template_id;
    if (src) { need(planOf(user.program_id, Number(src)), 404, 'Source plan not found'); copyPeriods(Number(src), id); }
    retime(id);
    audit(user, 'create', 'plan', id, { from: src || null });
    return id;
  }
  router.post('/api/plans', ({ user, body }) => {
    need(can(user, 'practice.edit'), 403, 'Coaches only');
    return { id: createPlan(user, body) };
  });
  router.put('/api/plans/:id', ({ user, params, body }) => {
    need(can(user, 'practice.edit'), 403, 'Coaches only');
    const plan = planOf(user.program_id, Number(params.id));
    need(plan, 404, 'Plan not found');
    need(canManagePlan(user, plan), 403, 'You can only edit plans you wrote or for your own groups');
    if (body.periods) {
      need(Array.isArray(body.periods), 400, 'Periods must be a list');
      // Drills, plays and coaches referenced by a period must belong to this program.
      for (const p of body.periods) {
        if (p.drill_id) need(db.get('SELECT 1 FROM drills WHERE id=? AND program_id=?', Number(p.drill_id), user.program_id), 400, 'Unknown drill');
        if (p.coach_id) need(db.get(`SELECT 1 FROM users WHERE id=? AND program_id=? AND role IN ('head_coach','coach','trainer','staff')`, Number(p.coach_id), user.program_id), 400, 'Unknown coach');
        for (const id of p.play_ids || []) need(db.get('SELECT 1 FROM plays WHERE id=? AND program_id=?', Number(id), user.program_id), 400, 'Unknown play');
      }
    }
    const upd = { updated_at: nowLocal() };
    for (const k of ['name', 'notes', 'start_time']) if (body[k] !== undefined) upd[k] = body[k];
    if (body.is_template !== undefined) upd.is_template = body.is_template ? 1 : 0;
    db.update('practice_plans', plan.id, upd);
    if (body.periods) {
      db.tx(() => {
        const keep = new Set();
        body.periods.forEach((p, i) => {
          const fields = {
            sort: i, duration: Math.max(1, Number(p.duration) || 5), location: p.location || null, unit: p.unit || null, group_label: p.group_label || null,
            positions: (p.positions || []).map((x) => String(x).toUpperCase()), coach_id: p.coach_id ? Number(p.coach_id) : null, drill_id: p.drill_id ? Number(p.drill_id) : null,
            play_ids: (p.play_ids || []).map(Number), contact: p.contact ? 1 : 0,
          };
          if (p.id && db.get('SELECT 1 FROM periods WHERE id=? AND plan_id=?', Number(p.id), plan.id)) { db.update('periods', Number(p.id), fields); keep.add(Number(p.id)); } else keep.add(db.insert('periods', { plan_id: plan.id, ...fields }));
        });
        for (const r of db.all('SELECT id FROM periods WHERE plan_id=?', plan.id)) if (!keep.has(r.id)) db.run('DELETE FROM periods WHERE id=?', r.id);
      });
    }
    retime(plan.id);
    audit(user, 'edit', 'plan', plan.id, Object.keys(body));
    return planDetail(user, planOf(user.program_id, plan.id));
  });
  router.del('/api/plans/:id', ({ user, params }) => {
    need(can(user, 'practice.edit'), 403, 'Coaches only');
    const plan = planOf(user.program_id, Number(params.id));
    need(plan, 404, 'Plan not found');
    need(canManagePlan(user, plan), 403, 'You can only delete plans you wrote or for your own groups');
    db.run('DELETE FROM practice_plans WHERE id=? AND program_id=?', plan.id, user.program_id);
    return { ok: true };
  });
  router.post('/api/plans/:id/save-template', ({ user, params, body }) => {
    need(can(user, 'practice.edit'), 403, 'Coaches only');
    const plan = planOf(user.program_id, Number(params.id));
    need(plan, 404, 'Plan not found');
    return { id: createPlan(user, { name: body.name || `${plan.name} (template)`, is_template: true, copy_from: plan.id, start_time: plan.start_time }) };
  });
  // PRAC-3 + CAL-5: build plans for every practice in a game week from a template
  router.post('/api/plans/game-week', ({ user, body }) => {
    need(can(user, 'practice.edit'), 403, 'Coaches only');
    need(/^\d{4}-\d{2}-\d{2}$/.test(body.week_of || ''), 400, 'week_of date is required');
    const d = parseLocal(body.week_of + 'T00:00'); const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const from = fmtLocal(mon).slice(0, 10);
    const evs = db.all(`SELECT id, title FROM events WHERE program_id=? AND type='practice' AND start>=? AND start<=? ORDER BY start`, user.program_id, from, addDays(from, 6) + 'T23:59');
    const created = [];
    const templates = body.template_ids || [];
    evs.forEach((e, i) => {
      if (db.get('SELECT 1 FROM practice_plans WHERE event_id=?', e.id)) return;
      const tpl = templates[i] ?? templates[templates.length - 1] ?? body.template_id;
      created.push(createPlan(user, { event_id: e.id, name: e.title, template_id: tpl || null }));
    });
    return { created };
  });

  // PRAC-5: run mode period status
  router.post('/api/periods/:id/status', ({ user, params, body }) => {
    need(can(user, 'practice.edit'), 403, 'Coaches only');
    const p = db.get('SELECT p.* FROM periods p JOIN practice_plans pp ON pp.id=p.plan_id WHERE p.id=? AND pp.program_id=?', Number(params.id), user.program_id);
    need(p, 404, 'Period not found');
    need(['pending', 'done', 'skipped', 'changed'].includes(body.status), 400, 'Unknown status');
    db.update('periods', p.id, { status: body.status, status_note: body.note || null, ...(body.duration ? { duration: Number(body.duration) } : {}) });
    audit(user, 'period_status', 'plan', p.plan_id, { period: p.id, status: body.status });
    return { ok: true };
  });

  // PRAC-8 / PRAC-12: players in this period's group, with unit, level and availability/absence flags
  router.get('/api/periods/:id/roster', ({ user, params }) => {
    staffOnly(user);
    const p = j(db.get('SELECT p.*, pp.event_id, pp.program_id FROM periods p JOIN practice_plans pp ON pp.id=p.plan_id WHERE p.id=? AND pp.program_id=?', Number(params.id), user.program_id), 'positions');
    need(p, 404, 'Period not found');
    return periodRoster(user, p);
  });
  function periodRoster(user, p) {
    const ev = p.event_id ? j(db.get('SELECT audience FROM events WHERE id=?', p.event_id), 'audience') : null;
    let ids = core.resolvePlayers(user.program_id, ev ? ev.audience : ['program']);
    const rows = ids.map((id) => j(db.get(`SELECT u.id, u.name, pp.jersey, pp.units, pp.positions, pp.availability, pp.photo, l.name level, t.name team FROM users u JOIN player_profiles pp ON pp.user_id=u.id
      LEFT JOIN teams t ON t.id=pp.team_id LEFT JOIN levels l ON l.id=t.level_id WHERE u.id=?`, id), 'units', 'positions'));
    let out = rows.filter((r) => (!p.unit || r.units.includes(p.unit)) && (!p.positions.length || r.positions.some((x) => p.positions.includes(x))));
    const att = p.event_id ? Object.fromEntries(db.all('SELECT player_id, status FROM attendance WHERE event_id=?', p.event_id).map((a) => [a.player_id, a.status])) : {};
    const mine = db.all('SELECT player_id, value FROM ratings WHERE period_id=? AND coach_id=?', p.id, user.id);
    const myR = Object.fromEntries(mine.map((r) => [r.player_id, r.value]));
    out = out.map((r) => ({ ...r, attendance: att[r.id] || null, flagged: r.availability !== 'available' || ['excused', 'unexcused'].includes(att[r.id]), my_rating: myR[r.id] ?? null }));
    out.sort((a, b) => (a.positions[0] || '').localeCompare(b.positions[0] || '') || (a.jersey ?? 999) - (b.jersey ?? 999));
    return out;
  }
  router.get('/api/plans/:id/roster', ({ user, params }) => {
    staffOnly(user);
    const plan = planOf(user.program_id, Number(params.id));
    need(plan, 404, 'Plan not found');
    return periodRoster(user, { id: 0, event_id: plan.event_id, unit: null, positions: [] });
  });

  // PRAC-6: quick notes (idempotent by client_id for offline replays)
  router.post('/api/practice-notes', ({ user, body }) => {
    need(can(user, 'practice.edit') || user.role === 'trainer', 403, 'Staff only');
    if (body.client_id) { const dup = db.get('SELECT id FROM practice_notes WHERE client_id=?', body.client_id); if (dup) return { id: dup.id, duplicate: true }; }
    need((body.tags && body.tags.length) || body.text, 400, 'Add a tag or a note');
    let date = body.date || today();
    if (body.plan_id) {
      const plan = planOf(user.program_id, Number(body.plan_id)); need(plan, 404, 'Plan not found');
      if (plan.event_id) date = db.get('SELECT start FROM events WHERE id=?', plan.event_id).start.slice(0, 10);
    }
    let drill = body.drill_id || null;
    if (body.period_id && !drill) drill = db.get('SELECT drill_id FROM periods WHERE id=?', Number(body.period_id))?.drill_id ?? null;
    const id = db.insert('practice_notes', {
      plan_id: body.plan_id || null, period_id: body.period_id || null, drill_id: drill, player_id: body.player_id || null,
      group_label: body.group_label || null, tags: body.tags || [], text: body.text || null, coach_id: user.id, date, client_id: body.client_id || null,
    });
    if ((body.tags || []).includes('injury concern') && body.player_id) {
      const name = db.get('SELECT name FROM users WHERE id=?', body.player_id)?.name;
      const trainers = db.all(`SELECT id FROM users WHERE program_id=? AND role IN ('trainer','head_coach') AND active=1`, user.program_id).map((r) => r.id);
      notify(user.program_id, trainers, { kind: 'urgent', title: `Injury concern: ${name}`, body: body.text || 'Flagged during practice', link: `/players/${body.player_id}`, from: 'system', email: false });
    }
    return { id };
  });
  router.del('/api/practice-notes/:id', ({ user, params }) => {
    const n = db.get('SELECT * FROM practice_notes WHERE id=?', Number(params.id));
    need(n && (n.coach_id === user.id || isAdmin(user)), 403, 'You can only remove your own notes');
    db.run('DELETE FROM practice_notes WHERE id=?', n.id);
    return { ok: true };
  });

  // PRAC-7: ratings (one tap per player; idempotent by client_id; re-rating updates the coach's rating)
  function saveRating(user, b) {
    if (b.client_id) { const dup = db.get('SELECT id FROM ratings WHERE client_id=?', b.client_id); if (dup) return { id: dup.id, duplicate: true }; }
    const scale = core.settings(user.program_id).rating_scale;
    const v = Number(b.value);
    need(Number.isInteger(v) && v >= 1 && v <= scale, 400, `Rating must be 1 to ${scale}`);
    const pl = db.get(`SELECT id FROM users WHERE id=? AND program_id=? AND role='player'`, Number(b.player_id), user.program_id);
    need(pl, 404, 'Player not found');
    need(isAdmin(user) || !core.staffScopes(user.id).length || core.managesAudience(user, [`player:${pl.id}`]), 403, 'You can only rate players in your own groups');
    let period = null; let date = b.date || today(); let planId = b.plan_id || null; let drill = b.drill_id || null;
    if (b.period_id) {
      period = db.get('SELECT p.*, pp.event_id FROM periods p JOIN practice_plans pp ON pp.id=p.plan_id WHERE p.id=? AND pp.program_id=?', Number(b.period_id), user.program_id);
      need(period, 404, 'Period not found');
      j(period, 'positions');
      need(periodRoster(user, period).some((r) => r.id === pl.id), 400, 'That player is not in this period');
      planId = period.plan_id; drill = period.drill_id;
      if (period.event_id) date = db.get('SELECT start FROM events WHERE id=?', period.event_id).start.slice(0, 10);
      const existing = db.get('SELECT id FROM ratings WHERE period_id=? AND player_id=? AND coach_id=?', period.id, pl.id, user.id);
      if (existing) { db.run('UPDATE ratings SET value=?, at=? WHERE id=?', v, nowLocal(), existing.id); return { id: existing.id, updated: true }; }
    }
    const id = db.insert('ratings', { plan_id: planId, period_id: period?.id ?? null, drill_id: drill, player_id: pl.id, value: v, coach_id: user.id, date, season_id: core.currentSeason(user.program_id)?.id, client_id: b.client_id || null });
    return { id };
  }
  router.post('/api/ratings', ({ user, body }) => {
    need(can(user, 'ratings.edit'), 403, 'Only coaches rate players');
    return saveRating(user, body);
  });
  router.post('/api/ratings/batch', ({ user, body }) => {
    need(can(user, 'ratings.edit'), 403, 'Only coaches rate players');
    const results = [];
    for (const item of body.items || []) { try { results.push(saveRating(user, item)); } catch (e) { results.push({ error: e.message }); } }
    return { results };
  });
  router.del('/api/ratings/:id', ({ user, params }) => {
    const r = db.get('SELECT * FROM ratings WHERE id=?', Number(params.id));
    need(r && (r.coach_id === user.id || isAdmin(user)), 403, 'You can only remove your own ratings');
    db.run('DELETE FROM ratings WHERE id=?', r.id);
    return { ok: true };
  });

  // PRAC-10: practice summary shared with staff
  function summary(user, plan) {
    const d = planDetail({ ...user, role: 'head_coach' }, plan);
    const done = d.periods.filter((p) => p.status === 'done').length;
    const byPlayer = db.all(`SELECT r.player_id, u.name, round(avg(r.value),2) avg, count(*) n FROM ratings r JOIN users u ON u.id=r.player_id WHERE r.plan_id=? GROUP BY r.player_id ORDER BY avg DESC`, plan.id);
    return {
      plan_id: plan.id, name: plan.name, date: d.event?.start?.slice(0, 10) || null,
      periods_total: d.periods.length, periods_done: done, periods_skipped: d.periods.filter((p) => p.status === 'skipped').length,
      periods_changed: d.periods.filter((p) => p.status === 'changed').map((p) => ({ drill: p.drill_name, note: p.status_note })),
      notes: d.notes.map((n) => ({ tags: n.tags, text: n.text, player: n.player_name, coach: n.coach_name })),
      top: byPlayer.slice(0, 5), bottom: byPlayer.length > 5 ? byPlayer.slice(-5).reverse() : [],
    };
  }
  router.get('/api/plans/:id/summary', ({ user, params }) => {
    need(can(user, 'ratings.view') || isAdmin(user), 403, 'Coaches only');
    const plan = planOf(user.program_id, Number(params.id));
    need(plan, 404, 'Plan not found');
    return summary(user, plan);
  });
  router.post('/api/plans/:id/share-summary', ({ user, params }) => {
    need(can(user, 'practice.edit'), 403, 'Coaches only');
    const plan = planOf(user.program_id, Number(params.id));
    need(plan, 404, 'Plan not found');
    const s = summary(user, plan);
    const staff = db.all(`SELECT id FROM users WHERE program_id=? AND role IN ('head_coach','coach') AND active=1`, user.program_id).map((r) => r.id);
    notify(user.program_id, staff, { kind: 'update', title: `Practice summary: ${plan.name}`, body: `${s.periods_done}/${s.periods_total} periods done, ${s.notes.length} notes${s.top[0] ? `, top rated ${s.top[0].name} (${s.top[0].avg})` : ''}`, link: `/practice/${plan.id}/summary`, from: 'system' });
    audit(user, 'share_summary', 'plan', plan.id);
    return s;
  });
  router.get('/api/practice/meta', () => ({ tags: NOTE_TAGS }));
}
