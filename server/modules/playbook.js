// Module 3: Playbook and play designer — plays stored as structured data (positions, paths, timing),
// formations, playbooks/folders/tags, version history, audience delivery, view-only security with
// view log and watermark identity, install sheets, knowledge checks and game-mode rules.
import { fail, need, nowLocal } from '../core.js';
import { j, jAll } from '../db.js';

export default function playbook(ctx) {
  const { router, db, core } = ctx;
  const { can, isStaff, isAdmin, audit, notify } = core;

  const playOf = (pid, id) => j(db.get('SELECT * FROM plays WHERE id=? AND program_id=?', id, pid), 'tags', 'data', 'assignments');

  // Which plays can a non-staff user see? Shares (play or playbook) and install sheets addressed to them.
  function visiblePlayIds(u) {
    if (u.role === 'parent') return new Set();
    const ids = new Set();
    for (const s of jAll(db.all('SELECT * FROM play_shares WHERE program_id=?', u.program_id), 'audience')) {
      if (!core.inAudience(u, s.audience)) continue;
      if (s.play_id) ids.add(s.play_id);
      if (s.playbook_id) for (const r of db.all('SELECT id FROM plays WHERE playbook_id=?', s.playbook_id)) ids.add(r.id);
    }
    for (const i of jAll(db.all('SELECT * FROM install_sheets WHERE program_id=?', u.program_id), 'audience', 'play_ids')) {
      if (core.inAudience(u, i.audience)) for (const id of i.play_ids) ids.add(id);
    }
    // Plays a player was assigned to study or quiz on (directly or through an install sheet).
    if (u.role === 'player') {
      for (const a of jAll(db.all(`SELECT a.play_ids, a.install_id FROM assignments a JOIN assignment_status s ON s.assignment_id=a.id
        WHERE s.player_id=? AND a.program_id=?`, u.id, u.program_id), 'play_ids')) {
        for (const id of a.play_ids || []) ids.add(Number(id));
        if (a.install_id) {
          const i = j(db.get('SELECT play_ids FROM install_sheets WHERE id=? AND program_id=?', a.install_id, u.program_id), 'play_ids');
          for (const id of i?.play_ids || []) ids.add(Number(id));
        }
      }
    }
    return ids;
  }
  // Install sheets may only list plays from the user's own program.
  const programPlayIds = (u, list) => {
    const ids = (list || []).map(Number);
    for (const id of ids) need(db.get('SELECT 1 FROM plays WHERE id=? AND program_id=?', id, u.program_id), 400, 'Unknown play in this install');
    return ids;
  };
  const canView = (u, play) => (isStaff(u) ? can(u, 'playbook.view') : visiblePlayIds(u).has(play.id));
  const requireEdit = (u) => need(can(u, 'playbook.edit'), 403, 'You do not have edit access to the playbook');

  router.get('/api/playbook/config', ({ user }) => {
    const s = core.settings(user.program_id);
    const program = db.get('SELECT state FROM programs WHERE id=?', user.program_id);
    return {
      game_mode: s.game_mode, state: program.state, can_edit: can(user, 'playbook.edit'), can_export: can(user, 'playbook.export'),
      watermark: `${user.name} · ${nowLocal().replace('T', ' ')}`,
      game_mode_note: {
        sideline: 'Sideline use allowed by your program setting. Do not show tablets to players inside the 9-yard marks (NFHS).',
        booth_halftime: 'Restricted to coaching booth and locker room/halftime use (for example Texas UIL). Confirm before each use.',
        off: 'Game mode is turned off for this program.',
      }[s.game_mode],
    };
  });

  // ---------- playbooks ----------
  router.get('/api/playbooks', ({ user }) => {
    if (!isStaff(user)) {
      const ids = visiblePlayIds(user);
      return db.all('SELECT * FROM playbooks WHERE program_id=? ORDER BY name', user.program_id).filter((b) => db.all('SELECT id FROM plays WHERE playbook_id=?', b.id).some((p) => ids.has(p.id)));
    }
    need(can(user, 'playbook.view'), 403, 'No playbook access');
    return db.all('SELECT b.*, (SELECT count(*) FROM plays WHERE playbook_id=b.id) play_count FROM playbooks b WHERE program_id=? ORDER BY name', user.program_id);
  });
  router.post('/api/playbooks', ({ user, body }) => {
    requireEdit(user); need(body.name, 400, 'Name is required');
    const id = db.insert('playbooks', { program_id: user.program_id, name: body.name, side: body.side || null, description: body.description || null });
    audit(user, 'create', 'playbook', id);
    return { id };
  });
  router.put('/api/playbooks/:id', ({ user, params, body }) => {
    requireEdit(user);
    need(db.get('SELECT 1 FROM playbooks WHERE id=? AND program_id=?', Number(params.id), user.program_id), 404, 'Not found');
    db.update('playbooks', Number(params.id), { ...(body.name && { name: body.name }), ...(body.description !== undefined && { description: body.description }) });
    return { ok: true };
  });
  router.del('/api/playbooks/:id', ({ user, params }) => {
    requireEdit(user);
    db.run('UPDATE plays SET playbook_id=NULL WHERE playbook_id=? AND program_id=?', Number(params.id), user.program_id);
    db.run('DELETE FROM playbooks WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    return { ok: true };
  });

  // ---------- formations ----------
  router.get('/api/formations', ({ user }) => {
    need(can(user, 'playbook.view'), 403, 'No playbook access');
    return jAll(db.all('SELECT * FROM formations WHERE program_id=? ORDER BY side, name', user.program_id), 'data');
  });
  router.post('/api/formations', ({ user, body }) => {
    requireEdit(user); need(body.name && body.data, 400, 'Name and players are required');
    const id = db.insert('formations', { program_id: user.program_id, name: body.name, side: body.side || 'offense', data: body.data });
    return { id };
  });
  router.del('/api/formations/:id', ({ user, params }) => {
    requireEdit(user);
    db.run('DELETE FROM formations WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    return { ok: true };
  });

  // ---------- plays ----------
  function listShape(p) {
    return { id: p.id, name: p.name, side: p.side, formation: p.formation, folder: p.folder, tags: p.tags, playbook_id: p.playbook_id, version: p.version, updated_at: p.updated_at, updated_by_name: p.updated_by_name, data: p.data };
  }
  router.get('/api/plays', ({ user, query }) => {
    let rows = jAll(db.all('SELECT p.*, u.name updated_by_name FROM plays p LEFT JOIN users u ON u.id=p.updated_by WHERE p.program_id=? ORDER BY p.folder, p.name', user.program_id), 'tags', 'data', 'assignments');
    if (isStaff(user)) need(can(user, 'playbook.view'), 403, 'No playbook access');
    else { const ids = visiblePlayIds(user); rows = rows.filter((p) => ids.has(p.id)); }
    if (query.playbook_id) rows = rows.filter((p) => p.playbook_id === Number(query.playbook_id));
    if (query.side) rows = rows.filter((p) => p.side === query.side);
    if (query.folder) rows = rows.filter((p) => p.folder === query.folder);
    if (query.tag) rows = rows.filter((p) => p.tags.includes(query.tag));
    if (query.q) { const q = query.q.toLowerCase(); rows = rows.filter((p) => [p.name, p.formation, p.folder, p.tags.join(' '), p.coaching_points].join(' ').toLowerCase().includes(q)); }
    if (!isStaff(user)) return rows.map(listShape).map((p) => ({ ...p, data: { ...p.data, quiz: (p.data?.quiz || []).map(({ answer, ...q }) => q) } }));
    return rows.map(listShape);
  });
  router.get('/api/plays/:id', ({ user, params, query }) => {
    const p = playOf(user.program_id, Number(params.id));
    need(p && canView(user, p), 404, 'Play not found');
    // PLAY-7: every view is logged.
    db.insert('play_views', { play_id: p.id, install_id: query.install ? Number(query.install) : null, user_id: user.id, context: query.context || 'view' });
    if (!isStaff(user)) {
      // players get the play without other teams' admin metadata, with quiz answers removed
      const data = { ...p.data, quiz: (p.data.quiz || []).map(({ answer, ...q }) => q) };
      return { ...p, data, can_edit: false, watermark: `${user.name} · ${nowLocal().replace('T', ' ')}` };
    }
    return { ...p, can_edit: can(user, 'playbook.edit'), can_export: can(user, 'playbook.export'), watermark: `${user.name} · ${nowLocal().replace('T', ' ')}` };
  });
  function playFields(b) {
    const f = {};
    for (const k of ['name', 'side', 'formation', 'folder', 'coaching_points', 'video_url']) if (b[k] !== undefined) f[k] = b[k] || null;
    if (b.playbook_id !== undefined) f.playbook_id = b.playbook_id ? Number(b.playbook_id) : null;
    if (b.tags) f.tags = b.tags.map((t) => String(t).trim()).filter(Boolean);
    if (b.data) { need(Array.isArray(b.data.players), 400, 'Play data needs a players list'); f.data = b.data; }
    if (b.assignments) f.assignments = b.assignments;
    return f;
  }
  router.post('/api/plays', ({ user, body }) => {
    requireEdit(user); need(body.name, 400, 'Name is required');
    const f = playFields({ data: { players: [] }, ...body });
    const id = db.insert('plays', { program_id: user.program_id, side: 'offense', ...f, version: 1, updated_by: user.id, updated_at: nowLocal() });
    db.insert('play_versions', { play_id: id, version: 1, snapshot: db.get('SELECT * FROM plays WHERE id=?', id), by_user: user.id, summary: 'Created' });
    audit(user, 'create', 'play', id);
    return { id };
  });
  router.put('/api/plays/:id', ({ user, params, body }) => {
    requireEdit(user);
    const p = playOf(user.program_id, Number(params.id));
    need(p, 404, 'Play not found');
    if (body.base_version && body.base_version !== p.version) {
      // Collaboration: someone else saved first. Tell the client so it can reload rather than overwrite silently.
      if (!body.force) fail(409, `This play was changed by someone else (now version ${p.version}). Reload to see their changes.`);
    }
    const f = playFields(body);
    const version = p.version + 1;
    db.update('plays', p.id, { ...f, version, updated_by: user.id, updated_at: nowLocal() });
    db.insert('play_versions', { play_id: p.id, version, snapshot: db.get('SELECT * FROM plays WHERE id=?', p.id), by_user: user.id, summary: body.summary || Object.keys(f).join(', ') });
    audit(user, 'edit', 'play', p.id, { version, fields: Object.keys(f) });
    return { ok: true, version };
  });
  router.del('/api/plays/:id', ({ user, params }) => {
    requireEdit(user);
    db.run('DELETE FROM plays WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    audit(user, 'delete', 'play', Number(params.id));
    return { ok: true };
  });
  router.post('/api/plays/:id/duplicate', ({ user, params, body }) => {
    requireEdit(user);
    const p = playOf(user.program_id, Number(params.id));
    need(p, 404, 'Play not found');
    let data = p.data;
    if (body.flip) data = flip(data);
    const id = db.insert('plays', { program_id: user.program_id, playbook_id: p.playbook_id, name: body.name || `${p.name}${body.flip ? ' (flipped)' : ' copy'}`, side: p.side, formation: p.formation, folder: p.folder, tags: p.tags, data, coaching_points: p.coaching_points, assignments: p.assignments, video_url: p.video_url, version: 1, updated_by: user.id, updated_at: nowLocal() });
    db.insert('play_versions', { play_id: id, version: 1, snapshot: db.get('SELECT * FROM plays WHERE id=?', id), by_user: user.id, summary: `Copied from ${p.name}` });
    return { id };
  });
  function flip(data) {
    const fx = (pt) => [100 - pt[0], pt[1]];
    return { ...data, players: data.players.map((pl) => ({ ...pl, x: 100 - pl.x, path: (pl.path || []).map(fx), motion: (pl.motion || []).map(fx) })) };
  }
  router.get('/api/plays/:id/versions', ({ user, params }) => {
    need(can(user, 'playbook.view'), 403, 'No playbook access');
    need(playOf(user.program_id, Number(params.id)), 404, 'Play not found');
    return db.all('SELECT v.id, v.version, v.at, v.summary, u.name by_name FROM play_versions v LEFT JOIN users u ON u.id=v.by_user WHERE v.play_id=? ORDER BY v.version DESC', Number(params.id));
  });
  router.post('/api/plays/:id/restore', ({ user, params, body }) => {
    requireEdit(user);
    const p = playOf(user.program_id, Number(params.id));
    need(p, 404, 'Play not found');
    const v = db.get('SELECT * FROM play_versions WHERE play_id=? AND version=?', p.id, Number(body.version));
    need(v, 404, 'Version not found');
    const snap = j(JSON.parse(v.snapshot), 'tags', 'data', 'assignments');
    const version = p.version + 1;
    db.update('plays', p.id, { name: snap.name, data: snap.data, tags: snap.tags, assignments: snap.assignments, coaching_points: snap.coaching_points, formation: snap.formation, version, updated_by: user.id, updated_at: nowLocal() });
    db.insert('play_versions', { play_id: p.id, version, snapshot: db.get('SELECT * FROM plays WHERE id=?', p.id), by_user: user.id, summary: `Restored version ${v.version}` });
    audit(user, 'restore', 'play', p.id, { version: v.version });
    return { ok: true, version };
  });
  router.get('/api/plays/:id/views', ({ user, params }) => {
    need(isStaff(user) && can(user, 'playbook.view'), 403, 'Staff only');
    need(playOf(user.program_id, Number(params.id)), 404, 'Play not found');
    return db.all(`SELECT v.at, v.context, u.name, u.role FROM play_views v JOIN users u ON u.id=v.user_id WHERE v.play_id=? ORDER BY v.id DESC LIMIT 300`, Number(params.id));
  });
  // PLAY-7: export only when the head coach allows it, watermarked and logged.
  router.get('/api/plays/:id/export', ({ user, params }) => {
    need(can(user, 'playbook.export'), 403, 'Exporting plays is turned off by the head coach');
    const p = playOf(user.program_id, Number(params.id));
    need(p, 404, 'Play not found');
    audit(user, 'export', 'play', p.id);
    db.insert('play_views', { play_id: p.id, user_id: user.id, context: 'export' });
    return { ...p, watermark: `Exported by ${user.name} ${nowLocal().replace('T', ' ')}` };
  });

  // ---------- delivery (PLAY-6) ----------
  router.get('/api/play-shares', ({ user }) => {
    need(isStaff(user), 403, 'Staff only');
    return jAll(db.all(`SELECT s.*, p.name play_name, b.name playbook_name, u.name by_name FROM play_shares s LEFT JOIN plays p ON p.id=s.play_id LEFT JOIN playbooks b ON b.id=s.playbook_id LEFT JOIN users u ON u.id=s.by_user WHERE s.program_id=? ORDER BY s.id DESC`, user.program_id), 'audience')
      .map((s) => ({ ...s, audience_labels: core.describeAudience(user.program_id, s.audience) }));
  });
  router.post('/api/play-shares', ({ user, body }) => {
    requireEdit(user);
    need((body.play_id || body.playbook_id) && Array.isArray(body.audience) && body.audience.length, 400, 'Pick a play or playbook and an audience');
    need(!body.audience.includes('parents'), 400, 'Parents do not have playbook access');
    if (body.play_id) need(playOf(user.program_id, Number(body.play_id)), 404, 'Play not found');
    const id = db.insert('play_shares', { program_id: user.program_id, play_id: body.play_id || null, playbook_id: body.playbook_id || null, audience: body.audience, by_user: user.id });
    const name = body.play_id ? db.get('SELECT name FROM plays WHERE id=?', body.play_id).name : db.get('SELECT name FROM playbooks WHERE id=?', body.playbook_id)?.name;
    notify(user.program_id, core.resolvePlayers(user.program_id, body.audience), { kind: 'update', title: `New in your playbook: ${name}`, link: body.play_id ? `/playbook/play/${body.play_id}` : '/playbook', email: false });
    audit(user, 'share', body.play_id ? 'play' : 'playbook', body.play_id || body.playbook_id, { audience: body.audience });
    return { id };
  });
  router.del('/api/play-shares/:id', ({ user, params }) => {
    requireEdit(user);
    db.run('DELETE FROM play_shares WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    audit(user, 'unshare', 'play_share', Number(params.id));
    return { ok: true };
  });

  // ---------- install sheets (PLAY-8) ----------
  function installShape(user, i) {
    const plays = i.play_ids.map((id) => db.get('SELECT id, name, formation, side, coaching_points FROM plays WHERE id=?', id)).filter(Boolean);
    const out = { ...i, plays, audience_labels: core.describeAudience(user.program_id, i.audience) };
    if (isStaff(user)) {
      const expected = core.resolvePlayers(user.program_id, i.audience);
      const viewed = new Set(db.all('SELECT DISTINCT user_id FROM play_views WHERE install_id=?', i.id).map((r) => r.user_id));
      out.expected = expected.length;
      out.viewed = expected.filter((id) => viewed.has(id)).length;
      out.not_viewed = expected.filter((id) => !viewed.has(id)).map((id) => db.get('SELECT id, name FROM users WHERE id=?', id));
    }
    return out;
  }
  router.get('/api/installs', ({ user }) => {
    let rows = jAll(db.all('SELECT * FROM install_sheets WHERE program_id=? ORDER BY id DESC', user.program_id), 'play_ids', 'audience');
    if (isStaff(user)) need(can(user, 'playbook.view'), 403, 'No playbook access');
    else { if (user.role === 'parent') return []; rows = rows.filter((i) => core.inAudience(user, i.audience)); }
    return rows.map((i) => installShape(user, i));
  });
  router.get('/api/installs/:id', ({ user, params }) => {
    const i = j(db.get('SELECT * FROM install_sheets WHERE id=? AND program_id=?', Number(params.id), user.program_id), 'play_ids', 'audience');
    need(i && (isStaff(user) ? can(user, 'playbook.view') : user.role !== 'parent' && core.inAudience(user, i.audience)), 404, 'Install sheet not found');
    db.insert('play_views', { install_id: i.id, user_id: user.id, context: 'install' });
    const out = installShape(user, i);
    out.plays = i.play_ids.map((id) => playOf(user.program_id, id)).filter(Boolean).map((p) => ({ ...p, data: { ...p.data, quiz: isStaff(user) ? p.data.quiz : (p.data.quiz || []).map(({ answer, ...q }) => q) } }));
    out.watermark = `${user.name} · ${nowLocal().replace('T', ' ')}`;
    return out;
  });
  router.post('/api/installs', ({ user, body }) => {
    requireEdit(user); need(body.name, 400, 'Name is required');
    need(!(body.audience || []).includes('parents'), 400, 'Parents do not have playbook access');
    const id = db.insert('install_sheets', { program_id: user.program_id, name: body.name, play_ids: programPlayIds(user, body.play_ids), notes: body.notes || null, audience: body.audience || [], created_by: user.id });
    if ((body.audience || []).length) notify(user.program_id, core.resolvePlayers(user.program_id, body.audience), { kind: 'update', title: `Install sheet: ${body.name}`, link: `/playbook/install/${id}`, email: false });
    audit(user, 'create', 'install', id);
    return { id };
  });
  router.put('/api/installs/:id', ({ user, params, body }) => {
    requireEdit(user);
    const i = db.get('SELECT * FROM install_sheets WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    need(i, 404, 'Install sheet not found');
    if (body.audience) need(!body.audience.includes('parents'), 400, 'Parents do not have playbook access');
    db.update('install_sheets', i.id, { ...(body.name && { name: body.name }), ...(body.notes !== undefined && { notes: body.notes }), ...(body.play_ids && { play_ids: programPlayIds(user, body.play_ids) }), ...(body.audience && { audience: body.audience }) });
    audit(user, 'edit', 'install', i.id);
    return { ok: true };
  });
  router.del('/api/installs/:id', ({ user, params }) => {
    requireEdit(user);
    db.run('DELETE FROM install_sheets WHERE id=? AND program_id=?', Number(params.id), user.program_id);
    return { ok: true };
  });

  // ---------- knowledge checks (PLAY-10) ----------
  router.post('/api/plays/:id/quiz', ({ user, params, body }) => {
    const p = playOf(user.program_id, Number(params.id));
    need(p && canView(user, p), 404, 'Play not found');
    need(user.role === 'player', 400, 'Only players take knowledge checks');
    const quiz = p.data.quiz || [];
    need(quiz.length, 400, 'This play has no questions');
    const answers = body.answers || [];
    const score = quiz.reduce((s, q, i) => s + (Number(answers[i]) === Number(q.answer) ? 1 : 0), 0);
    db.insert('quiz_results', { play_id: p.id, player_id: user.id, score, total: quiz.length, answers });
    return { score, total: quiz.length, correct: quiz.map((q) => q.answer) };
  });
  router.get('/api/plays/:id/quiz-results', ({ user, params }) => {
    need(isStaff(user) && can(user, 'playbook.view'), 403, 'Staff only');
    need(playOf(user.program_id, Number(params.id)), 404, 'Play not found');
    return db.all('SELECT q.*, u.name FROM quiz_results q JOIN users u ON u.id=q.player_id WHERE q.play_id=? ORDER BY q.id DESC', Number(params.id));
  });

  // Tag and folder lists for filters
  router.get('/api/playbook/facets', ({ user }) => {
    need(can(user, 'playbook.view') || !isStaff(user), 403, 'No playbook access');
    if (user.role === 'parent') return { folders: [], tags: [], formations: [] };
    let rows = jAll(db.all('SELECT id, folder, tags, formation FROM plays WHERE program_id=?', user.program_id), 'tags');
    if (!isStaff(user)) { const ids = visiblePlayIds(user); rows = rows.filter((r) => ids.has(r.id)); }
    return {
      folders: [...new Set(rows.map((r) => r.folder).filter(Boolean))].sort(),
      tags: [...new Set(rows.flatMap((r) => r.tags))].sort(),
      formations: [...new Set(rows.map((r) => r.formation).filter(Boolean))].sort(),
    };
  });
}
