// Module 9: Assignments and player reports — watch/study/complete/submit/quiz assignments to any audience,
// per-player status with late tracking, automatic reminders, feedback and marks, recurring + templates,
// and coach-built report forms whose responses are visible only to the staff they are shared with.
import { fail, need, nowLocal, addDays, addMinutes, today } from '../core.js';
import { j, jAll } from '../db.js';

export const ASN_TYPES = ['watch', 'study', 'complete', 'submit', 'quiz'];

export default function assignments(ctx) {
  const { router, db, core } = ctx;
  const { can, isStaff, isAdmin, audit, notify } = core;
  const editor = (u) => need(can(u, 'assignments.edit'), 403, 'Coaches only');
  // Non-admin coaches change only assignments they created or whose audience is inside their groups.
  // (A coach without group scopes works program-wide, as for attendance.)
  const ownsAsn = (u, a) => isAdmin(u) || a.created_by === u.id || !core.staffScopes(u.id).length
    || (a.audience.length > 0 && core.managesAudience(u, a.audience));
  const asnOf = (pid, id) => j(db.get('SELECT * FROM assignments WHERE id=? AND program_id=?', id, pid), 'audience', 'checklist', 'play_ids', 'recurring');

  const displayStatus = (st, due) => {
    if (!st) return 'not_started';
    if (st.status === 'completed') return 'completed';
    if (due && nowLocal() > due) return 'late';
    return st.status;
  };
  function seed(a) {
    for (const pid of core.resolvePlayers(a.program_id, a.audience)) db.run('INSERT OR IGNORE INTO assignment_status (assignment_id, player_id) VALUES (?,?)', a.id, pid);
  }
  function stats(a) {
    const rows = db.all('SELECT * FROM assignment_status WHERE assignment_id=?', a.id);
    const c = { total: rows.length, not_started: 0, in_progress: 0, completed: 0, late: 0 };
    for (const r of rows) c[displayStatus(r, a.due)]++;
    return c;
  }

  router.get('/api/assignments/meta', () => ({ types: ASN_TYPES }));
  router.get('/api/assignments', ({ user, query }) => {
    if (isStaff(user)) {
      const rows = jAll(db.all(`SELECT a.*, u.name author FROM assignments a LEFT JOIN users u ON u.id=a.created_by WHERE a.program_id=? AND a.is_template=? ORDER BY coalesce(a.due, a.created_at) DESC`, user.program_id, query.templates ? 1 : 0), 'audience', 'checklist', 'play_ids', 'recurring');
      return rows.map((a) => ({ ...a, audience_labels: core.describeAudience(user.program_id, a.audience), stats: stats(a) }));
    }
    const mine = core.linkedPlayers(user);
    if (!mine.length) return [];
    const rows = jAll(db.all(`SELECT a.*, s.player_id, s.status, s.progress, s.response, s.attachment, s.submitted_at, s.feedback, s.mark, s.score, u.name author FROM assignments a JOIN assignment_status s ON s.assignment_id=a.id
      LEFT JOIN users u ON u.id=a.created_by WHERE a.program_id=? AND s.player_id IN (${mine.map(() => '?').join(',')}) ORDER BY a.due IS NULL, a.due`, user.program_id, ...mine), 'audience', 'checklist', 'play_ids', 'progress');
    return rows.map((r) => ({ ...r, display_status: displayStatus(r, r.due), player_name: db.get('SELECT name FROM users WHERE id=?', r.player_id).name }));
  });
  router.get('/api/assignments/:id', ({ user, params }) => {
    const a = asnOf(user.program_id, Number(params.id));
    need(a, 404, 'Assignment not found');
    a.install = a.install_id ? db.get('SELECT id, name FROM install_sheets WHERE id=?', a.install_id) : null;
    a.plays = a.play_ids.length ? db.all(`SELECT id, name FROM plays WHERE id IN (${a.play_ids.map(() => '?').join(',')})`, ...a.play_ids) : [];
    if (isStaff(user)) {
      const rows = jAll(db.all(`SELECT s.*, u.name, pp.jersey, pp.positions, pp.team_id FROM assignment_status s JOIN users u ON u.id=s.player_id JOIN player_profiles pp ON pp.user_id=u.id WHERE s.assignment_id=? ORDER BY u.name`, a.id), 'progress', 'positions');
      return { ...a, audience_labels: core.describeAudience(user.program_id, a.audience), stats: stats(a), players: rows.map((r) => ({ ...r, display_status: displayStatus(r, a.due) })) };
    }
    const mine = core.linkedPlayers(user);
    const st = jAll(db.all(`SELECT * FROM assignment_status WHERE assignment_id=? AND player_id IN (${mine.map(() => '?').join(',') || 'NULL'})`, a.id, ...mine), 'progress');
    need(st.length, 404, 'Assignment not found');
    return { ...a, mine: st.map((s) => ({ ...s, display_status: displayStatus(s, a.due), player_name: db.get('SELECT name FROM users WHERE id=?', s.player_id).name })) };
  });
  function create(user, b, parentId = null) {
    need(ASN_TYPES.includes(b.type), 400, 'Unknown assignment type');
    need(b.title, 400, 'Title is required');
    if (!b.is_template) need(Array.isArray(b.audience) && b.audience.length, 400, 'Pick who this is for');
    if (b.type === 'watch') need(b.video_url, 400, 'Watch assignments need a video link');
    if (b.type === 'study') need(b.install_id || (b.play_ids || []).length, 400, 'Study assignments need an install sheet or plays');
    if (b.type === 'complete') need((b.checklist || []).length, 400, 'Checklist assignments need at least one item');
    if (b.type === 'quiz') need((b.play_ids || []).length, 400, 'Quizzes need plays with questions');
    const id = db.insert('assignments', {
      program_id: user.program_id, title: b.title, instructions: b.instructions || null, type: b.type, due: b.due || null, audience: b.audience || [],
      video_url: b.video_url || null, install_id: b.install_id || null, play_ids: (b.play_ids || []).map(Number), checklist: b.checklist || [],
      recurring: b.recurring || null, parent_id: parentId, is_template: b.is_template ? 1 : 0, season_id: core.currentSeason(user.program_id)?.id, created_by: user.id,
    });
    const a = asnOf(user.program_id, id);
    if (!a.is_template) {
      seed(a);
      notify(user.program_id, core.resolvePlayers(user.program_id, a.audience), { kind: 'update', title: `New assignment: ${a.title}`, body: a.due ? `Due ${a.due.replace('T', ' ')}` : '', link: `/assignments/${id}`, ref: `asn:${id}`, email: false });
    }
    audit(user, 'create', 'assignment', id);
    return id;
  }
  router.post('/api/assignments', ({ user, body }) => {
    editor(user);
    let b = body;
    if (body.copy_from) {
      const src = asnOf(user.program_id, Number(body.copy_from));
      need(src, 404, 'Template not found');
      const { id, created_at, created_by, parent_id, is_template, ...rest } = src;
      b = { ...rest, ...Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'copy_from')) };
    }
    const ids = [create(user, b)];
    // ASN-7: recurring, e.g. weekly film for N weeks
    if (!b.is_template && b.recurring && b.recurring.freq === 'weekly' && b.due) {
      const n = Math.min(Number(b.recurring.count) || 1, 20);
      for (let i = 1; i < n; i++) ids.push(create(user, { ...b, due: addDays(b.due, 7 * i) }, ids[0]));
    }
    return { id: ids[0], ids };
  });
  router.put('/api/assignments/:id', ({ user, params, body }) => {
    editor(user);
    const a = asnOf(user.program_id, Number(params.id));
    need(a, 404, 'Assignment not found');
    need(ownsAsn(user, a), 403, 'You can only change assignments you created or for your own groups');    const upd = {};
    for (const k of ['title', 'instructions', 'due', 'video_url']) if (body[k] !== undefined) upd[k] = body[k] || null;
    for (const k of ['checklist', 'play_ids', 'audience']) if (body[k]) upd[k] = body[k];
    if (body.install_id !== undefined) upd.install_id = body.install_id || null;
    db.update('assignments', a.id, upd);
    if (body.audience) seed(asnOf(user.program_id, a.id));
    audit(user, 'edit', 'assignment', a.id);
    return { ok: true };
  });
  router.del('/api/assignments/:id', ({ user, params }) => {
    editor(user);
    const a = asnOf(user.program_id, Number(params.id));
    need(a, 404, 'Assignment not found');
    need(ownsAsn(user, a), 403, 'You can only delete assignments you created or for your own groups');
    db.run('DELETE FROM assignments WHERE id=? AND program_id=?', a.id, user.program_id);
    return { ok: true };
  });

  // Player progress / submission
  router.post('/api/assignments/:id/progress', ({ user, params, body }) => {
    const a = asnOf(user.program_id, Number(params.id));
    need(a, 404, 'Assignment not found');
    need(user.role === 'player', 403, 'Players update their own assignments');
    const st = j(db.get('SELECT * FROM assignment_status WHERE assignment_id=? AND player_id=?', a.id, user.id), 'progress');
    need(st, 404, 'This assignment is not for you');
    const upd = {};
    if (body.progress) upd.progress = { ...st.progress, ...body.progress };
    if (body.response !== undefined) upd.response = String(body.response).slice(0, 10000);
    if (body.attachment !== undefined) { need(!body.attachment || (String(body.attachment).startsWith('data:') && body.attachment.length < 3_000_000), 400, 'Attachments must be under 2 MB'); upd.attachment = body.attachment || null; }
    let status = st.status === 'not_started' ? 'in_progress' : st.status;
    if (a.type === 'complete') {
      const p = upd.progress || st.progress;
      if (a.checklist.every((_, i) => p[i])) status = 'completed';
    }
    if (body.done) {
      if (a.type === 'submit') need((upd.response ?? st.response) || (upd.attachment ?? st.attachment), 400, 'Add a response or a file before submitting');
      if (a.type === 'complete') need(a.checklist.every((_, i) => (upd.progress || st.progress)[i]), 400, 'Finish every checklist item first');
      status = 'completed';
    }
    upd.status = status;
    if (status === 'completed' && st.status !== 'completed') upd.submitted_at = nowLocal();
    db.update('assignment_status', user.id, upd, `assignment_id=${Number(a.id)} AND player_id`);
    return { ok: true, status: displayStatus({ status }, a.due), late: status === 'completed' && a.due && nowLocal() > a.due };
  });
  router.post('/api/assignments/:id/quiz', ({ user, params, body }) => {
    const a = asnOf(user.program_id, Number(params.id));
    need(a && a.type === 'quiz', 404, 'Quiz not found');
    need(db.get('SELECT 1 FROM assignment_status WHERE assignment_id=? AND player_id=?', a.id, user.id), 404, 'This quiz is not for you');
    let score = 0; let total = 0;
    const plays = a.play_ids.map((id) => j(db.get('SELECT * FROM plays WHERE id=? AND program_id=?', Number(id), user.program_id), 'data')).filter(Boolean);
    need(plays.some((p) => (p.data.quiz || []).length), 400, 'This quiz has no questions yet');
    for (const play of plays) {
      const quiz = play.data.quiz || [];
      if (!quiz.length) continue;
      const ans = (body.answers || {})[play.id] || [];
      const s = quiz.reduce((acc, q, i) => acc + (Number(ans[i]) === Number(q.answer) ? 1 : 0), 0);
      db.insert('quiz_results', { play_id: play.id, player_id: user.id, score: s, total: quiz.length, answers: ans });
      score += s; total += quiz.length;
    }
    db.run(`UPDATE assignment_status SET status='completed', submitted_at=?, score=?, progress=? WHERE assignment_id=? AND player_id=?`, nowLocal(), total ? Math.round((score / total) * 100) : null, JSON.stringify({ score, total }), a.id, user.id);
    return { score, total };
  });
  router.post('/api/assignments/:id/feedback', ({ user, params, body }) => {
    editor(user);
    const a = asnOf(user.program_id, Number(params.id));
    need(a, 404, 'Assignment not found');
    const pid = Number(body.player_id);
    need(db.get('SELECT 1 FROM assignment_status WHERE assignment_id=? AND player_id=?', a.id, pid), 404, 'Player not on this assignment');
    if (body.mark) need(['complete', 'incomplete'].includes(body.mark), 400, 'Mark is complete or incomplete');
    db.run('UPDATE assignment_status SET feedback=coalesce(?, feedback), mark=coalesce(?, mark), score=coalesce(?, score), status=CASE WHEN ?=\'incomplete\' THEN \'in_progress\' ELSE status END WHERE assignment_id=? AND player_id=?',
      body.feedback ?? null, body.mark ?? null, body.score ?? null, body.mark ?? null, a.id, pid);
    notify(user.program_id, [pid], { kind: 'update', title: `Coach feedback: ${a.title}`, body: body.feedback || (body.mark ? `Marked ${body.mark}` : ''), link: `/assignments/${a.id}`, email: false });
    audit(user, 'feedback', 'assignment', a.id, { player: pid, mark: body.mark });
    return { ok: true };
  });

  // ASN-4: automatic reminders for players who have not completed an assignment
  function remind(now = nowLocal(), force = null) {
    const soon = addMinutes(now, 24 * 60);
    const rows = jAll(db.all(`SELECT * FROM assignments WHERE is_template=0 AND due IS NOT NULL AND ${force ? 'id=?' : 'due<=? AND due>=?'}`, ...(force ? [force] : [soon, addDays(now.slice(0, 10), -1)])), 'audience');
    let sent = 0;
    for (const a of rows) {
      const late = now > a.due;
      const pending = db.all(`SELECT player_id FROM assignment_status WHERE assignment_id=? AND status!='completed' ${force ? '' : `AND (reminded_at IS NULL OR (${late ? 1 : 0}=1 AND reminded_at<?))`}`, a.id, ...(force ? [] : [a.due])).map((r) => r.player_id);
      if (!pending.length) continue;
      notify(a.program_id, pending, { kind: 'reminder', title: `${late ? 'Overdue' : 'Due soon'}: ${a.title}`, body: `Due ${a.due.replace('T', ' ')}`, link: `/assignments/${a.id}`, from: 'system', email: false });
      for (const pid of pending) db.run('UPDATE assignment_status SET reminded_at=? WHERE assignment_id=? AND player_id=?', now, a.id, pid);
      sent += pending.length;
    }
    return sent;
  }
  ctx.ticks.push(() => remind());
  ctx.remindAssignments = remind;
  router.post('/api/assignments/:id/remind', ({ user, params }) => {
    editor(user);
    need(asnOf(user.program_id, Number(params.id)), 404, 'Assignment not found');
    return { sent: remind(nowLocal(), Number(params.id)) };
  });

  // ---------- report forms (ASN-6) ----------
  const formOf = (pid, id) => j(db.get('SELECT * FROM forms WHERE id=? AND program_id=?', id, pid), 'questions', 'audience', 'share_with');
  const canSeeResponses = (u, f) => isAdmin(u) || f.created_by === u.id || f.share_with.includes(u.id) || f.share_with.includes(u.role);
  router.get('/api/forms', ({ user }) => {
    const rows = jAll(db.all('SELECT f.*, u.name author FROM forms f LEFT JOIN users u ON u.id=f.created_by WHERE f.program_id=? ORDER BY f.id DESC', user.program_id), 'questions', 'audience', 'share_with');
    if (isStaff(user)) {
      return rows.map((f) => ({ ...f, can_see_responses: canSeeResponses(user, f), audience_labels: core.describeAudience(user.program_id, f.audience), expected: core.resolvePlayers(user.program_id, f.audience).length, responses: db.get('SELECT count(*) n FROM form_responses WHERE form_id=?', f.id).n }));
    }
    if (user.role !== 'player') return [];
    return rows.filter((f) => core.resolvePlayers(user.program_id, f.audience).includes(user.id)).map((f) => ({ id: f.id, title: f.title, description: f.description, questions: f.questions, due: f.due, author: f.author, responded: !!db.get('SELECT 1 FROM form_responses WHERE form_id=? AND player_id=?', f.id, user.id), my_answers: j(db.get('SELECT answers FROM form_responses WHERE form_id=? AND player_id=?', f.id, user.id), 'answers')?.answers || null }));
  });
  function validQuestions(qs) {
    need(Array.isArray(qs) && qs.length, 400, 'Add at least one question');
    for (const q of qs) {
      need(q.label && ['text', 'scale', 'choice', 'yesno'].includes(q.type), 400, 'Each question needs a label and type');
      if (q.type === 'choice') need(Array.isArray(q.options) && q.options.length >= 2, 400, 'Choice questions need two options');
    }
    return qs;
  }
  router.post('/api/forms', ({ user, body }) => {
    editor(user); need(body.title, 400, 'Title is required');
    const id = db.insert('forms', { program_id: user.program_id, title: body.title, description: body.description || null, questions: validQuestions(body.questions), audience: body.audience || [], share_with: body.share_with || [], due: body.due || null, created_by: user.id });
    if ((body.audience || []).length) notify(user.program_id, core.resolvePlayers(user.program_id, body.audience), { kind: 'update', title: `Please complete: ${body.title}`, link: `/assignments?tab=forms`, email: false });
    audit(user, 'create', 'form', id);
    return { id };
  });
  router.put('/api/forms/:id', ({ user, params, body }) => {
    editor(user);
    const f = formOf(user.program_id, Number(params.id));
    need(f && (f.created_by === user.id || isAdmin(user)), 403, 'Only the form author can edit it');
    const upd = {};
    for (const k of ['title', 'description', 'due']) if (body[k] !== undefined) upd[k] = body[k];
    if (body.questions) upd.questions = validQuestions(body.questions);
    for (const k of ['audience', 'share_with']) if (body[k]) upd[k] = body[k];
    db.update('forms', f.id, upd);
    return { ok: true };
  });
  router.del('/api/forms/:id', ({ user, params }) => {
    editor(user);
    const f = formOf(user.program_id, Number(params.id));
    need(f && (f.created_by === user.id || isAdmin(user)), 403, 'Only the form author can delete it');
    db.run('DELETE FROM forms WHERE id=?', f.id);
    return { ok: true };
  });
  router.post('/api/forms/:id/respond', ({ user, params, body }) => {
    const f = formOf(user.program_id, Number(params.id));
    need(f && user.role === 'player' && core.resolvePlayers(user.program_id, f.audience).includes(user.id), 404, 'Form not found');
    const ans = body.answers || [];
    f.questions.forEach((q, i) => { if (q.required) need(ans[i] !== undefined && ans[i] !== '', 400, `Answer: ${q.label}`); });
    db.run('INSERT INTO form_responses (form_id, player_id, answers, at) VALUES (?,?,?,?) ON CONFLICT(form_id, player_id) DO UPDATE SET answers=excluded.answers, at=excluded.at', f.id, user.id, JSON.stringify(ans), nowLocal());
    return { ok: true };
  });
  router.get('/api/forms/:id/responses', ({ user, params }) => {
    const f = formOf(user.program_id, Number(params.id));
    need(f && isStaff(user) && canSeeResponses(user, f), 403, 'Responses are visible only to the coaches and trainers this form is shared with');
    audit(user, 'view', 'form_responses', f.id);
    const rows = jAll(db.all('SELECT r.*, u.name FROM form_responses r JOIN users u ON u.id=r.player_id WHERE r.form_id=? ORDER BY r.at DESC', f.id), 'answers');
    const responded = new Set(rows.map((r) => r.player_id));
    const missing = core.resolvePlayers(user.program_id, f.audience).filter((id) => !responded.has(id)).map((id) => db.get('SELECT id, name FROM users WHERE id=?', id));
    return { form: f, responses: rows, missing };
  });
}
