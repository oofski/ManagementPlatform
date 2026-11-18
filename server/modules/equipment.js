// Module 8: Equipment inventory — catalog, serialized and bulk items, issue (with jersey numbers), bulk kits,
// returns, outstanding list/export, player acknowledgment, helmet recertification/age flags and fits,
// item history, inventory counts with low-stock reorder list, and scan lookup by serial/QR tag.
import { fail, need, nowLocal, today } from '../core.js';
import { j, jAll } from '../db.js';
import { csv, csvResponse } from '../app.js';

export default function equipment(ctx) {
  const { router, db, core } = ctx;
  const { can, isStaff, isAdmin, audit, notify } = core;
  const manage = (u) => need(can(u, 'equipment.manage'), 403, 'Only the head coach or equipment manager can issue and receive equipment');
  const view = (u) => need(can(u, 'equipment.view'), 403, 'Staff only');
  const typeOf = (pid, id) => db.get('SELECT * FROM eq_types WHERE id=? AND program_id=?', id, pid);
  const itemOf = (pid, id) => db.get('SELECT i.*, t.name type_name, t.category, t.tracking, t.cost FROM eq_items i JOIN eq_types t ON t.id=i.type_id WHERE i.id=? AND t.program_id=?', id, pid);
  const year = () => Number(today().slice(0, 4));

  // ---------- catalog ----------
  router.get('/api/eq/types', ({ user }) => {
    view(user);
    return db.all(`SELECT t.*, (SELECT coalesce(sum(qty),0) FROM eq_items WHERE type_id=t.id AND retired=0) stock,
      (SELECT count(*) FROM eq_issues WHERE type_id=t.id AND returned_at IS NULL) out_count FROM eq_types t WHERE t.program_id=? ORDER BY t.category, t.name`, user.program_id);
  });
  router.post('/api/eq/types', ({ user, body }) => {
    manage(user); need(body.name, 400, 'Name is required');
    need(['serial', 'bulk'].includes(body.tracking || 'bulk'), 400, 'Tracking is serial or bulk');
    return { id: db.insert('eq_types', { program_id: user.program_id, name: body.name, category: body.category || 'other', brand: body.brand || null, model: body.model || null, tracking: body.tracking || 'bulk', cost: Number(body.cost) || 0, low_stock: Number(body.low_stock ?? 2) }) };
  });
  router.put('/api/eq/types/:id', ({ user, params, body }) => {
    manage(user);
    need(typeOf(user.program_id, Number(params.id)), 404, 'Not found');
    db.update('eq_types', Number(params.id), Object.fromEntries(['name', 'category', 'brand', 'model', 'cost', 'low_stock'].filter((k) => body[k] !== undefined).map((k) => [k, body[k]])));
    return { ok: true };
  });
  router.del('/api/eq/types/:id', ({ user, params }) => {
    manage(user);
    const id = Number(params.id);
    need(!db.get('SELECT 1 FROM eq_issues WHERE type_id=?', id), 400, 'This type has issue history; retire its items instead');
    db.run('DELETE FROM eq_types WHERE id=? AND program_id=?', id, user.program_id);
    return { ok: true };
  });
  router.get('/api/eq/items', ({ user, query }) => {
    view(user);
    const rows = db.all(`SELECT i.*, t.name type_name, t.category, t.tracking,
      (SELECT u.name FROM eq_issues s JOIN users u ON u.id=s.player_id WHERE s.item_id=i.id AND s.returned_at IS NULL LIMIT 1) holder
      FROM eq_items i JOIN eq_types t ON t.id=i.type_id WHERE t.program_id=? ${query.type_id ? 'AND i.type_id=?' : ''} ORDER BY t.name, i.size, i.serial`, user.program_id, ...(query.type_id ? [Number(query.type_id)] : []));
    return rows;
  });
  router.post('/api/eq/items', ({ user, body }) => {
    manage(user);
    const t = typeOf(user.program_id, Number(body.type_id));
    need(t, 404, 'Item type not found');
    if (t.tracking === 'serial') {
      need(body.serial, 400, 'Serial number is required');
      need(!db.get('SELECT 1 FROM eq_items i JOIN eq_types t ON t.id=i.type_id WHERE t.program_id=? AND i.serial=?', user.program_id, body.serial), 400, 'That serial number already exists');
      return { id: db.insert('eq_items', { type_id: t.id, serial: body.serial, size: body.size || null, qty: 1, condition: body.condition || 'good', manuf_year: body.manuf_year || null, recert_year: body.recert_year || null, recert_facility: body.recert_facility || null, allows_recert: body.allows_recert === false ? 0 : 1 }) };
    }
    // bulk: one stock row per size
    const ex = db.get('SELECT * FROM eq_items WHERE type_id=? AND size IS ? AND retired=0', t.id, body.size || null);
    if (ex) { db.run('UPDATE eq_items SET qty=qty+? WHERE id=?', Number(body.qty) || 0, ex.id); return { id: ex.id }; }
    return { id: db.insert('eq_items', { type_id: t.id, size: body.size || null, qty: Number(body.qty) || 0, condition: 'new' }) };
  });
  router.put('/api/eq/items/:id', ({ user, params, body }) => {
    manage(user);
    const it = itemOf(user.program_id, Number(params.id));
    need(it, 404, 'Item not found');
    db.update('eq_items', it.id, Object.fromEntries(['serial', 'size', 'qty', 'condition', 'manuf_year', 'recert_year', 'recert_facility', 'allows_recert', 'retired'].filter((k) => body[k] !== undefined).map((k) => [k, body[k] === '' ? null : body[k]])));
    audit(user, 'edit', 'eq_item', it.id, body);
    return { ok: true };
  });
  router.get('/api/eq/lookup', ({ user, query }) => {
    view(user);
    const it = db.get('SELECT i.*, t.name type_name, t.tracking FROM eq_items i JOIN eq_types t ON t.id=i.type_id WHERE t.program_id=? AND (i.serial=? OR i.id=?)', user.program_id, String(query.code || '').trim(), Number(String(query.code || '').replace(/^ITEM-/, '')) || -1);
    need(it, 404, 'No item with that tag');
    it.open_issue = db.get('SELECT s.*, u.name player_name FROM eq_issues s JOIN users u ON u.id=s.player_id WHERE s.item_id=? AND s.returned_at IS NULL', it.id) || null;
    return it;
  });

  // ---------- issue / return ----------
  function issue(user, b) {
    const pid = Number(b.player_id);
    need(db.get(`SELECT 1 FROM users WHERE id=? AND program_id=? AND role='player'`, pid, user.program_id), 404, 'Player not found');
    const t = typeOf(user.program_id, Number(b.type_id));
    need(t, 404, 'Item type not found');
    let itemId = null; let size = b.size || null; const qty = Number(b.qty) || 1;
    if (t.tracking === 'serial') {
      let it = b.item_id ? itemOf(user.program_id, Number(b.item_id)) : null;
      if (!it) it = db.get(`SELECT i.* FROM eq_items i WHERE i.type_id=? AND i.retired=0 AND (? IS NULL OR i.size=?) AND NOT EXISTS (SELECT 1 FROM eq_issues s WHERE s.item_id=i.id AND s.returned_at IS NULL) ORDER BY i.id LIMIT 1`, t.id, size, size);
      need(it && it.type_id === t.id, 400, `No available ${t.name}${size ? ' in size ' + size : ''}`);
      need(!db.get('SELECT 1 FROM eq_issues WHERE item_id=? AND returned_at IS NULL', it.id), 400, `${t.name} ${it.serial} is already issued`);
      itemId = it.id; size = it.size;
    } else {
      const stock = db.get('SELECT * FROM eq_items WHERE type_id=? AND size IS ? AND retired=0', t.id, size);
      need(stock && stock.qty >= qty, 400, `Not enough ${t.name}${size ? ' size ' + size : ''} in stock`);
      db.run('UPDATE eq_items SET qty=qty-? WHERE id=?', qty, stock.id);
      itemId = stock.id;
    }
    const id = db.insert('eq_issues', { program_id: user.program_id, item_id: itemId, type_id: t.id, player_id: pid, size, qty, season_id: core.currentSeason(user.program_id)?.id, issued_at: b.date || today(), condition_out: b.condition || (t.tracking === 'serial' ? db.get('SELECT condition FROM eq_items WHERE id=?', itemId).condition : 'new'), issued_by: user.id });
    audit(user, 'issue', 'eq_item', itemId, { player: pid, issue: id });
    return id;
  }
  function setJersey(user, pid, jersey) {
    if (jersey === undefined || jersey === null || jersey === '') return null;
    need(db.get(`SELECT 1 FROM users WHERE id=? AND program_id=? AND role='player'`, pid, user.program_id), 404, 'Player not found');
    db.run('UPDATE player_profiles SET jersey=? WHERE user_id=?', Number(jersey), pid);
    const p = db.get('SELECT team_id FROM player_profiles WHERE user_id=?', pid);
    const dup = db.get(`SELECT u.name FROM player_profiles pp JOIN users u ON u.id=pp.user_id WHERE pp.team_id=? AND pp.jersey=? AND pp.user_id!=? AND pp.archived=0`, p.team_id, Number(jersey), pid);
    audit(user, 'assign_jersey', 'player', pid, { jersey: Number(jersey) });
    return dup ? `Jersey #${jersey} is also assigned to ${dup.name} on this team` : null;
  }
  router.post('/api/eq/issue', ({ user, body }) => {
    manage(user);
    const warning = setJersey(user, Number(body.player_id), body.jersey);
    const id = body.type_id ? issue(user, body) : null;
    if (id) notify(user.program_id, [Number(body.player_id)], { kind: 'update', title: 'Equipment issued', body: 'Please confirm you received it', link: '/equipment', from: 'system', email: false });
    return { id, warning };
  });
  router.post('/api/eq/bulk-issue', ({ user, body }) => {
    manage(user);
    need(Array.isArray(body.player_ids) && body.player_ids.length && Array.isArray(body.kit) && body.kit.length, 400, 'Pick players and kit items');
    const results = [];
    for (const pid of body.player_ids) {
      for (const k of body.kit) {
        const size = k.size === 'per_player' ? (body.sizes?.[pid]?.[k.type_id] ?? null) : (k.size || null);
        try { results.push({ player_id: pid, type_id: k.type_id, id: db.tx(() => issue(user, { player_id: pid, type_id: k.type_id, size, qty: k.qty || 1 })) }); } catch (e) { results.push({ player_id: pid, type_id: k.type_id, error: e.message }); }
      }
    }
    notify(user.program_id, body.player_ids, { kind: 'update', title: 'Equipment issued', body: 'Please confirm you received your kit', link: '/equipment', from: 'system', email: false });
    return { issued: results.filter((r) => r.id).length, errors: results.filter((r) => r.error) };
  });
  router.post('/api/eq/issues/:id/return', ({ user, params, body }) => {
    manage(user);
    const s = db.get('SELECT s.*, t.tracking FROM eq_issues s JOIN eq_types t ON t.id=s.type_id WHERE s.id=? AND s.program_id=?', Number(params.id), user.program_id);
    need(s, 404, 'Issue record not found');
    need(!s.returned_at, 400, 'Already checked in');
    need(['returned', 'damaged', 'lost'].includes(body.status), 400, 'Status must be returned, damaged or lost');
    db.update('eq_issues', s.id, { returned_at: body.date || today(), return_status: body.status, condition_in: body.condition || null, received_by: user.id });
    if (s.tracking === 'serial') {
      if (body.status === 'lost') db.run('UPDATE eq_items SET retired=1, condition=? WHERE id=?', 'lost', s.item_id);
      else db.run('UPDATE eq_items SET condition=? WHERE id=?', body.condition || (body.status === 'damaged' ? 'damaged' : 'good'), s.item_id);
    } else if (body.status === 'returned') db.run('UPDATE eq_items SET qty=qty+? WHERE id=?', s.qty, s.item_id);
    audit(user, `return_${body.status}`, 'eq_item', s.item_id, { issue: s.id, player: s.player_id });
    return { ok: true };
  });
  router.post('/api/eq/issues/:id/ack', ({ user, params }) => {
    const s = db.get('SELECT * FROM eq_issues WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    need(s && core.linkedPlayers(user).includes(s.player_id), 403, 'Only the player or a parent can acknowledge');
    db.run('UPDATE eq_issues SET acknowledged_at=coalesce(acknowledged_at, ?) WHERE id=?', nowLocal(), s.id);
    audit(user, 'acknowledge', 'eq_issue', s.id);
    return { ok: true };
  });
  router.get('/api/eq/issues', ({ user, query }) => {
    view(user);
    return db.all(`SELECT s.*, t.name type_name, t.cost, i.serial, u.name player_name, pp.jersey FROM eq_issues s JOIN eq_types t ON t.id=s.type_id LEFT JOIN eq_items i ON i.id=s.item_id
      JOIN users u ON u.id=s.player_id JOIN player_profiles pp ON pp.user_id=u.id WHERE s.program_id=? ${query.open ? 'AND s.returned_at IS NULL' : ''} ${query.player_id ? 'AND s.player_id=?' : ''} ORDER BY s.id DESC LIMIT 1000`,
    user.program_id, ...(query.player_id ? [Number(query.player_id)] : []));
  });
  router.get('/api/eq/player/:id', ({ user, params }) => {
    const pid = Number(params.id);
    const inProgram = !!db.get(`SELECT 1 FROM users WHERE id=? AND program_id=? AND role='player'`, pid, user.program_id);
    need((isStaff(user) && inProgram) || core.linkedPlayers(user).includes(pid), 403, 'No access');
    return db.all(`SELECT s.id, s.size, s.qty, s.issued_at, s.condition_out, s.returned_at, s.return_status, s.acknowledged_at, t.name type_name, t.cost, i.serial
      FROM eq_issues s JOIN eq_types t ON t.id=s.type_id LEFT JOIN eq_items i ON i.id=s.item_id WHERE s.player_id=? ORDER BY s.returned_at IS NOT NULL, s.id DESC`, pid);
  });

  // EQP-6: outstanding items with replacement cost
  function outstanding(user) {
    const rows = db.all(`SELECT s.id, s.player_id, u.name player_name, pp.jersey, t.name type_name, i.serial, s.size, s.qty, t.cost, s.issued_at, s.return_status
      FROM eq_issues s JOIN eq_types t ON t.id=s.type_id LEFT JOIN eq_items i ON i.id=s.item_id JOIN users u ON u.id=s.player_id JOIN player_profiles pp ON pp.user_id=u.id
      WHERE s.program_id=? AND (s.returned_at IS NULL OR s.return_status='lost') ORDER BY u.name`, user.program_id);
    const by = {};
    for (const r of rows) {
      const p = by[r.player_id] ||= { player_id: r.player_id, name: r.player_name, jersey: r.jersey, items: [], total_cost: 0 };
      p.items.push(r); p.total_cost += (r.cost || 0) * r.qty;
    }
    return Object.values(by);
  }
  router.get('/api/eq/outstanding', ({ user }) => { view(user); return outstanding(user); });
  router.get('/api/eq/outstanding.csv', ({ user }) => {
    view(user);
    const rows = outstanding(user).flatMap((p) => p.items.map((i) => ({ ...i, name: p.name, jersey: p.jersey })));
    audit(user, 'export', 'equipment', null);
    return csvResponse('outstanding-equipment.csv', csv(rows, [{ label: 'Player', key: 'name' }, { label: 'Jersey', key: 'jersey' }, { label: 'Item', key: 'type_name' }, { label: 'Serial', key: 'serial' }, { label: 'Size', key: 'size' }, { label: 'Qty', key: 'qty' }, { label: 'Status', get: (r) => r.return_status || 'not returned' }, { label: 'Replacement cost', get: (r) => ((r.cost || 0) * r.qty).toFixed(2) }]));
  });

  // EQP-8: helmets
  function helmetFlags(it, s) {
    const flags = [];
    const y = year();
    if (it.manuf_year && y - it.manuf_year >= s.helmet_max_age_years) flags.push(`Past program age rule (${s.helmet_max_age_years} years)`);
    if (!it.allows_recert && it.manuf_year && y - it.manuf_year >= 5) flags.push('Past 5-year useful life (no recertification allowed)');
    const interval = it.manuf_year && it.manuf_year < 2017 ? 1 : s.helmet_recert_interval_years;
    if (it.allows_recert) {
      if (!it.recert_year) flags.push('No recertification on record');
      else if (y - it.recert_year >= interval) flags.push(`Recertification due (every ${interval} year${interval > 1 ? 's' : ''})`);
    }
    return flags;
  }
  router.get('/api/eq/helmets', ({ user }) => {
    view(user);
    const s = core.settings(user.program_id);
    return db.all(`SELECT i.*, t.name type_name, t.brand, t.model, (SELECT u.name FROM eq_issues x JOIN users u ON u.id=x.player_id WHERE x.item_id=i.id AND x.returned_at IS NULL) holder,
      (SELECT date FROM helmet_fits f WHERE f.item_id=i.id ORDER BY date DESC LIMIT 1) last_fit FROM eq_items i JOIN eq_types t ON t.id=i.type_id WHERE t.program_id=? AND t.category='helmet' AND i.retired=0 ORDER BY i.serial`, user.program_id)
      .map((it) => ({ ...it, flags: helmetFlags(it, s) }));
  });
  router.post('/api/eq/fits', ({ user, body }) => {
    manage(user);
    const it = itemOf(user.program_id, Number(body.item_id));
    need(it && it.category === 'helmet', 404, 'Helmet not found');
    const id = db.insert('helmet_fits', { item_id: it.id, player_id: Number(body.player_id), season_id: core.currentSeason(user.program_id)?.id, date: body.date || today(), notes: body.notes || null, by_user: user.id });
    audit(user, 'helmet_fit', 'eq_item', it.id, { player: body.player_id });
    return { id };
  });
  // EQP-9: item history across seasons
  router.get('/api/eq/items/:id/history', ({ user, params }) => {
    view(user);
    const it = itemOf(user.program_id, Number(params.id));
    need(it, 404, 'Item not found');
    return {
      item: it,
      issues: db.all(`SELECT s.*, u.name player_name, se.name season_name FROM eq_issues s JOIN users u ON u.id=s.player_id LEFT JOIN seasons se ON se.id=s.season_id WHERE s.item_id=? ORDER BY s.id DESC`, it.id),
      fits: db.all('SELECT f.*, u.name player_name FROM helmet_fits f JOIN users u ON u.id=f.player_id WHERE f.item_id=? ORDER BY f.date DESC', it.id),
      changes: jAll(db.all(`SELECT a.at, a.action, a.detail, u.name user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.entity='eq_item' AND a.entity_id=? ORDER BY a.id DESC`, it.id), 'detail'),
    };
  });
  // EQP-11: inventory counts, low stock and reorder list
  router.get('/api/eq/inventory', ({ user }) => {
    view(user);
    const types = db.all('SELECT * FROM eq_types WHERE program_id=? ORDER BY category, name', user.program_id);
    const rows = [];
    for (const t of types) {
      if (t.tracking === 'serial') {
        const total = db.get('SELECT count(*) n FROM eq_items WHERE type_id=? AND retired=0', t.id).n;
        const out = db.get('SELECT count(*) n FROM eq_issues s JOIN eq_items i ON i.id=s.item_id WHERE s.type_id=? AND s.returned_at IS NULL AND i.retired=0', t.id).n;
        rows.push({ type_id: t.id, name: t.name, category: t.category, tracking: t.tracking, size: 'all', available: total - out, issued: out, low: total - out <= t.low_stock, low_stock: t.low_stock, cost: t.cost });
      } else {
        for (const it of db.all('SELECT * FROM eq_items WHERE type_id=? AND retired=0 ORDER BY size', t.id)) {
          const out = db.get('SELECT coalesce(sum(qty),0) n FROM eq_issues WHERE item_id=? AND returned_at IS NULL', it.id).n;
          rows.push({ type_id: t.id, name: t.name, category: t.category, tracking: t.tracking, size: it.size, available: it.qty, issued: out, low: it.qty <= t.low_stock, low_stock: t.low_stock, cost: t.cost });
        }
      }
    }
    const reorder = rows.filter((r) => r.low).map((r) => ({ ...r, suggested: Math.max(r.low_stock * 2 - r.available, 1), est_cost: (Math.max(r.low_stock * 2 - r.available, 1) * (r.cost || 0)).toFixed(2) }));
    return { rows, reorder };
  });
}
