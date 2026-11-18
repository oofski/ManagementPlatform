// Module 9: Assignments and player reports — create/track watch, study, checklist, submit and quiz work;
// completion dashboard, reminders, feedback; recurring and templates; coach-built report forms.
import { api } from '../api.js';
import { html, set, $, $$, on, modal, toast, errToast, formData, options, checked, field, audienceField, wireAudience, fmtDT, ago, cap, empty, statusBadge, bar, pct,
  confirmDialog, tabs, readFileAsDataURL, raw, nowISO } from '../ui.js';

const TYPES = { watch: 'Watch film', study: 'Study plays', complete: 'Checklist', submit: 'Submit a response', quiz: 'Quiz on plays' };
const disp = (s) => statusBadge(s === 'late' ? 'late_asn' : s, cap(s));

export default async function assignments(el, ctx) {
  if (ctx.params.id) return ctx.me.caps.staff ? staffDetail(el, ctx, Number(ctx.params.id)) : playerDetail(el, ctx, Number(ctx.params.id));
  const tab = ctx.query.tab || 'list';
  const staff = ctx.me.caps.staff;
  const t = tabs([['list', 'Assignments', '/assignments'], ...(staff ? [['templates', 'Templates', '/assignments?tab=templates']] : []), ['forms', 'Report forms', '/assignments?tab=forms']], tab);
  if (tab === 'forms') return forms(el, ctx, t);
  if (!staff) return playerList(el, ctx, t);
  const list = await api.get(`/api/assignments${tab === 'templates' ? '?templates=1' : ''}`);
  const edit = ctx.me.caps['assignments.edit'];
  set(el, html`<div class="page-head"><div><h1>Assignments</h1><div class="sub">Film, plays, checklists and responses. Players get reminders automatically until they finish.</div></div>
    <div class="actions">${edit ? html`<button class="primary" id="new">New assignment</button>` : ''}</div></div>${t}
    <div class="card"><div class="bd flush tbl-wrap">${list.length ? html`<table><thead><tr><th>Assignment</th><th>Type</th><th>For</th><th>Due</th><th>Completion</th><th class="num">Late</th>${tab === 'templates' ? html`<th></th>` : ''}</tr></thead><tbody>
      ${list.map((a) => html`<tr class="click" onclick="__navigate('/assignments/${a.id}')"><td><b>${a.title}</b>${a.recurring ? html` <span class="badge">Recurring</span>` : ''}</td><td>${TYPES[a.type]}</td><td class="s">${a.audience_labels.join(', ')}</td><td>${a.due ? fmtDT(a.due) : '—'}</td>
        <td style="width:180px"><div class="row" style="flex-wrap:nowrap">${bar(pct(a.stats.completed, a.stats.total), a.stats.late ? 'warn' : '')}<span class="s">${a.stats.completed}/${a.stats.total}</span></div></td><td class="num">${a.stats.late || ''}</td>
        ${tab === 'templates' ? html`<td><button class="sm" data-use="${a.id}" onclick="event.stopPropagation()">Use</button></td>` : ''}</tr>`)}</tbody></table>` : empty(tab === 'templates' ? 'No templates. Check "Save as template" when creating an assignment.' : 'No assignments yet.')}</div></div>`);
  if ($('#new', el)) $('#new', el).onclick = () => assignmentForm(ctx);
  on(el, 'click', '[data-use]', (e, b) => assignmentForm(ctx, list.find((a) => a.id === Number(b.dataset.use))));
}

async function assignmentForm(ctx, template = null) {
  const [auds, installs, plays] = await Promise.all([api.get('/api/audiences'), api.get('/api/installs').catch(() => []), api.get('/api/plays').catch(() => [])]);
  const v = template || { type: 'watch', checklist: [], play_ids: [], audience: [] };
  const m = modal({ title: template ? `New from template: ${template.title}` : 'New assignment', wide: true,
    body: html`<form id="af"><div class="fields">${field('Type', html`<select name="type" id="ty">${options(Object.entries(TYPES), v.type)}</select>`)}${field('Title', html`<input name="title" value="${v.title || ''}" required>`)}${field('Due', html`<input type="datetime-local" name="due">`)}</div>
      ${field('Instructions', html`<textarea name="instructions">${v.instructions || ''}</textarea>`)}
      <div id="tx"></div>
      ${field('Assign to', audienceField('audience', auds, v.audience || [], { exclude: ['coaches', 'parents'] }))}
      <div class="row"><label class="check">Repeat weekly for <input type="number" name="weeks" value="1" min="1" max="20" style="width:60px"> week(s)</label><label class="check"><input type="checkbox" name="is_template"> Save as a template instead</label></div></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: async (r) => {
      const f = formData(r.querySelector('#af'));
      const body = { type: f.type, title: f.title, instructions: f.instructions, due: f.due || null, audience: f.audience, video_url: f.video_url, install_id: f.install_id ? Number(f.install_id) : null, play_ids: f.play_ids || [], checklist: (f.checklist || '').split('\n').map((x) => x.trim()).filter(Boolean), is_template: f.is_template, recurring: f.weeks > 1 ? { freq: 'weekly', count: f.weeks } : null };
      const res = await api.post('/api/assignments', body);
      toast(res.ids.length > 1 ? `Created ${res.ids.length} weekly assignments` : 'Assignment created'); ctx.navigate(f.is_template ? '/assignments?tab=templates' : `/assignments/${res.id}`);
    } }] });
  wireAudience(m.root);
  const tx = () => { const t = m.root.querySelector('#ty').value; set(m.root.querySelector('#tx'), t === 'watch' ? field('Video link', html`<input name="video_url" value="${v.video_url || ''}" placeholder="https://">`)
    : t === 'study' || t === 'quiz' ? html`<div class="fields">${t === 'study' ? field('Install sheet', html`<select name="install_id">${options(installs.map((i) => [i.id, i.name]), v.install_id ?? '', { blank: '—' })}</select>`) : ''}${field(t === 'quiz' ? 'Plays (with knowledge-check questions)' : 'Or individual plays', html`<select name="play_ids" multiple size="5">${plays.filter((p) => t !== 'quiz' || (p.data.quiz || []).length).map((p) => html`<option value="${p.id}" ${(v.play_ids || []).includes(p.id) ? raw('selected') : ''}>${p.name}</option>`)}</select>`)}</div>`
    : t === 'complete' ? field('Checklist items (one per line)', html`<textarea name="checklist">${(v.checklist || []).join('\n')}</textarea>`) : html`<p class="help">Players answer with text, a photo or a file.</p>`); };
  m.root.querySelector('#ty').onchange = tx; tx();
}

async function staffDetail(el, ctx, id) {
  const a = await api.get(`/api/assignments/${id}`);
  ctx.setTitle(a.title);
  const q = ctx.query;
  const rows = a.players.filter((p) => !q.status || p.display_status === q.status);
  const edit = ctx.me.caps['assignments.edit'];
  set(el, html`<div class="page-head"><div><h1>${a.title}</h1><div class="sub">${TYPES[a.type]} · ${a.audience_labels.join(', ')}${a.due ? ` · due ${fmtDT(a.due)}` : ''}</div></div>
    <div class="actions"><a class="btn" href="/assignments">All</a>${edit ? html`<button id="remind">Remind unfinished</button><button class="danger" id="del">Delete</button>` : ''}</div></div>
    ${a.instructions ? html`<div class="notice">${a.instructions}</div>` : ''}
    <div class="grid g4" style="margin-bottom:12px">${['completed', 'in_progress', 'not_started', 'late'].map((s) => html`<a class="card stat" href="/assignments/${id}?status=${q.status === s ? '' : s}" style="color:inherit;text-decoration:none;${q.status === s ? 'outline:2px solid var(--accent)' : ''}"><div class="k">${cap(s)}</div><div class="v">${a.stats[s]}</div></a>`)}</div>
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th>Player</th><th>Positions</th><th>Status</th><th>Submitted</th><th>Response</th><th>Feedback</th><th></th></tr></thead><tbody>
    ${rows.map((p) => html`<tr><td><b>${p.name}</b> <span class="faint">${p.jersey ?? ''}</span></td><td>${p.positions.join(', ')}</td><td>${disp(p.display_status)}${p.submitted_at && a.due && p.submitted_at > a.due ? html` <span class="badge warn">Late</span>` : ''}</td><td>${p.submitted_at ? fmtDT(p.submitted_at) : ''}</td>
      <td style="max-width:300px">${p.response ? html`<span class="s">${p.response.slice(0, 140)}${p.response.length > 140 ? '…' : ''}</span>` : ''}${p.attachment ? html` <a href="${p.attachment}" download>file</a>` : ''}${a.type === 'quiz' && p.score != null ? html`<b>${p.score}%</b>` : ''}${a.type === 'complete' ? html`<span class="s">${Object.values(p.progress || {}).filter(Boolean).length}/${a.checklist.length}</span>` : ''}</td>
      <td>${p.mark ? html`<span class="badge ${p.mark === 'complete' ? 'ok' : 'warn'}">${p.mark}</span> ` : ''}${p.score != null && a.type !== 'quiz' ? html`<b>${p.score}</b> ` : ''}<span class="s">${p.feedback || ''}</span></td>
      <td>${edit ? html`<button class="sm" data-fb="${p.player_id}">Feedback</button>` : ''}</td></tr>`)}</tbody></table>${!rows.length ? empty('Nobody in this status.') : ''}</div></div>`);
  if (!edit) return;
  $('#remind', el).onclick = async () => { const r = await api.post(`/api/assignments/${id}/remind`); toast(`Reminded ${r.sent} player(s)`); };
  $('#del', el).onclick = async () => { if (await confirmDialog('Delete this assignment and all responses?', { danger: true, ok: 'Delete' })) { await api.del(`/api/assignments/${id}`); ctx.navigate('/assignments'); } };
  on(el, 'click', '[data-fb]', (e, b) => {
    const p = a.players.find((x) => x.player_id === Number(b.dataset.fb));
    modal({ title: `Feedback for ${p.name}`, body: html`${p.response ? html`<div class="notice" style="white-space:pre-wrap">${p.response}</div>` : ''}<form id="ff">${field('Mark', html`<select name="mark">${options([['', '—'], ['complete', 'Complete'], ['incomplete', 'Incomplete (send back)']], p.mark || '')}</select>`)}${field('Score (optional)', html`<input type="number" name="score" value="${p.score ?? ''}">`)}${field('Comment', html`<textarea name="feedback">${p.feedback || ''}</textarea>`)}</form>`,
      actions: [{ label: 'Cancel' }, { label: 'Send to player', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#ff')); await api.post(`/api/assignments/${id}/feedback`, { player_id: p.player_id, mark: f.mark || undefined, score: f.score, feedback: f.feedback || undefined }); toast('Feedback sent'); ctx.reload(); } }] });
  });
}

async function playerList(el, ctx, t) {
  const list = await api.get('/api/assignments');
  const open = list.filter((a) => a.display_status !== 'completed');
  const done = list.filter((a) => a.display_status === 'completed');
  const row = (a) => html`<li class="click" onclick="__navigate('/assignments/${a.id}')"><div class="grow"><div class="t">${a.title}</div><div class="s">${TYPES[a.type]}${a.due ? ` · due ${fmtDT(a.due)}` : ''}${ctx.me.user.role === 'parent' ? ` · ${a.player_name}` : ''}${a.feedback ? ' · coach feedback' : ''}</div></div>${disp(a.display_status)}</li>`;
  set(el, html`<div class="page-head"><div><h1>Assignments</h1><div class="sub">${ctx.me.user.role === 'parent' ? 'What your player has to do and what is done.' : 'Work from your coaches. Due dates also show on your calendar.'}</div></div></div>${t}
    <div class="grid g2"><div class="card"><div class="hd"><h2>To do</h2><span class="r badge">${open.length}</span></div>${open.length ? html`<ul class="list">${open.map(row)}</ul>` : empty('All caught up.')}</div>
    <div class="card"><div class="hd"><h2>Done</h2></div>${done.length ? html`<ul class="list">${done.map(row)}</ul>` : empty('Nothing finished yet.')}</div></div>`);
}

async function playerDetail(el, ctx, id) {
  const a = await api.get(`/api/assignments/${id}`);
  ctx.setTitle(a.title);
  const st = a.mine[0];
  const player = ctx.me.user.role === 'player';
  let quizPlays = [];
  if (a.type === 'quiz') quizPlays = await Promise.all(a.plays.map((p) => api.get(`/api/plays/${p.id}?context=quiz`).catch(() => null))).then((x) => x.filter(Boolean));
  const ro = !player || st.display_status === 'completed';
  set(el, html`<div class="page-head"><div><h1>${a.title}</h1><div class="sub">${TYPES[a.type]}${a.due ? ` · due ${fmtDT(a.due)}` : ''}</div></div><div class="actions"><a class="btn" href="/assignments">Back</a>${disp(st.display_status)}</div></div>
    ${a.instructions ? html`<div class="notice">${a.instructions}</div>` : ''}
    ${st.feedback || st.mark ? html`<div class="notice ${st.mark === 'incomplete' ? 'warn' : 'ok'}"><b>Coach feedback${st.mark ? ` (${st.mark})` : ''}:</b> ${st.feedback || ''}</div>` : ''}
    <div class="card"><div class="bd" id="work">
      ${a.type === 'watch' ? html`<p><a class="btn primary" href="${a.video_url}" target="_blank" rel="noopener">Open the film</a></p>${!ro ? html`<button id="done">I watched it</button>` : ''}` : ''}
      ${a.type === 'study' ? html`<p>${a.install ? html`<a class="btn primary" href="/playbook/install/${a.install.id}">Open install sheet: ${a.install.name}</a>` : ''} ${a.plays.map((p) => html`<a class="btn" href="/playbook/play/${p.id}">${p.name}</a> `)}</p>${!ro ? html`<button id="done">I studied these plays</button>` : ''}` : ''}
      ${a.type === 'complete' ? html`<ul class="list" style="margin:-14px -14px 10px">${a.checklist.map((c, i) => html`<li><label class="check"><input type="checkbox" data-ci="${i}" ${checked(st.progress?.[i])} ${ro ? raw('disabled') : ''}> ${c}</label></li>`)}</ul>` : ''}
      ${a.type === 'submit' ? html`<form id="sf">${field('Your response', html`<textarea name="response" rows="6" ${ro ? raw('disabled') : ''}>${st.response || ''}</textarea>`)}
        ${!ro ? html`<div class="row"><label class="btn">Attach photo or file<input type="file" id="file" hidden></label><span id="fn" class="muted">${st.attachment ? 'File attached' : ''}</span><span class="spacer"></span><button type="button" id="savedraft">Save draft</button><button class="primary">Submit</button></div>` : st.attachment ? html`<a href="${st.attachment}" download>Your file</a>` : ''}</form>` : ''}
      ${a.type === 'quiz' ? (st.display_status === 'completed' ? html`<p>Your score: <b>${st.score}%</b></p>` : html`<form id="qf">${quizPlays.map((p) => html`<h3 style="margin:8px 0">${p.name}</h3>${(p.data.quiz || []).map((q, i) => html`<div class="field"><label>${q.q}</label>${q.options.map((o, j) => html`<label class="check" style="display:flex"><input type="radio" name="p${p.id}_${i}" value="${j}" ${ro ? raw('disabled') : ''}> ${o}</label>`)}</div>`)}`)}${player ? html`<button class="primary">Submit answers</button>` : ''}</form>`) : ''}
    </div></div>`);
  if (!player) return;
  const progress = (body) => api.post(`/api/assignments/${id}/progress`, body);
  if ($('#done', el)) $('#done', el).onclick = async () => { try { await progress({ done: true }); toast('Marked complete'); ctx.reload(); } catch (err) { errToast(err); } };
  on(el, 'change', '[data-ci]', async (e, c) => { try { const r = await progress({ progress: { [c.dataset.ci]: c.checked } }); if (r.status === 'completed') { toast('Checklist complete'); ctx.reload(); } } catch (err) { errToast(err); } });
  let file = null;
  if ($('#file', el)) $('#file', el).onchange = async (e) => { try { file = await readFileAsDataURL(e.target.files[0], 2_000_000); $('#fn', el).textContent = e.target.files[0].name; } catch (err) { errToast(err); } };
  if ($('#savedraft', el)) $('#savedraft', el).onclick = async () => { await progress({ response: $('[name=response]', el).value, ...(file ? { attachment: file } : {}) }); toast('Draft saved'); };
  if ($('#sf', el)) $('#sf', el).onsubmit = async (e) => { e.preventDefault(); try { const r = await progress({ response: $('[name=response]', el).value, ...(file ? { attachment: file } : {}), done: true }); toast(r.late ? 'Submitted (late)' : 'Submitted'); ctx.reload(); } catch (err) { errToast(err); } };
  if ($('#qf', el)) $('#qf', el).onsubmit = async (e) => {
    e.preventDefault();
    const answers = Object.fromEntries(quizPlays.map((p) => [p.id, (p.data.quiz || []).map((_, i) => { const c = el.querySelector(`[name="p${p.id}_${i}"]:checked`); return c ? Number(c.value) : null; })]));
    try { const r = await api.post(`/api/assignments/${id}/quiz`, { answers }); toast(`Score: ${r.score}/${r.total}`); ctx.reload(); } catch (err) { errToast(err); }
  };
}

async function forms(el, ctx, t) {
  const list = await api.get('/api/forms');
  const staff = ctx.me.caps.staff;
  if (!staff) {
    set(el, html`<div class="page-head"><div><h1>Assignments</h1><div class="sub">Report back to your coaches. Only the coaches and trainers each form is shared with see your answers.</div></div></div>${t}
      <div class="stack">${list.map((f) => html`<div class="card"><div class="hd"><h2>${f.title}</h2>${f.responded ? html`<span class="r badge ok">Sent</span>` : f.due ? html`<span class="r s muted">due ${fmtDT(f.due)}</span>` : ''}</div><div class="bd">${f.description ? html`<p class="muted">${f.description}</p>` : ''}
        <form data-form="${f.id}">${f.questions.map((q, i) => qInput(q, i, f.my_answers?.[i], ctx.me.user.role !== 'player'))}${ctx.me.user.role === 'player' ? html`<button class="primary">${f.responded ? 'Update answers' : 'Send'}</button>` : ''}</form></div></div>`)}${!list.length ? empty('No forms for you right now.') : ''}</div>`);
    on(el, 'submit', '[data-form]', async (e, f) => { e.preventDefault(); const fd = formData(f); const form = list.find((x) => x.id === Number(f.dataset.form)); try { await api.post(`/api/forms/${f.dataset.form}/respond`, { answers: form.questions.map((_, i) => fd[`q${i}`] ?? '') }); toast('Sent to your coaches'); ctx.reload(); } catch (err) { errToast(err); } });
    return;
  }
  set(el, html`<div class="page-head"><div><h1>Assignments</h1><div class="sub">Forms players fill in, such as a post-game self-evaluation or end-of-week check-in.</div></div><div class="actions">${ctx.me.caps['assignments.edit'] ? html`<button class="primary" id="new">New form</button>` : ''}</div></div>${t}
    <div class="card">${list.length ? html`<ul class="list">${list.map((f) => html`<li><div class="grow"><div class="t">${f.title}</div><div class="s">${f.questions.length} questions · ${f.audience_labels.join(', ')} · shared with ${f.share_with.join(', ') || 'author only'}</div></div><span class="s">${f.responses}/${f.expected} responded</span>${f.can_see_responses ? html`<button class="sm" data-resp="${f.id}">Responses</button>` : html`<span class="badge">Not shared with you</span>`}</li>`)}</ul>` : empty('No forms yet.')}</div>`);
  on(el, 'click', '[data-resp]', async (e, b) => {
    const r = await api.get(`/api/forms/${b.dataset.resp}/responses`);
    modal({ title: r.form.title, wide: true, body: html`${r.missing.length ? html`<p class="muted">Not yet: ${r.missing.map((m) => m.name).join(', ')}</p>` : ''}<div class="tbl-wrap"><table><thead><tr><th>Player</th>${r.form.questions.map((q) => html`<th>${q.label}</th>`)}<th>When</th></tr></thead><tbody>${r.responses.map((x) => html`<tr><td>${x.name}</td>${r.form.questions.map((_, i) => html`<td>${x.answers[i] ?? ''}</td>`)}<td class="s">${ago(x.at)}</td></tr>`)}</tbody></table></div>`, actions: [{ label: 'Close' }] });
  });
  if ($('#new', el)) $('#new', el).onclick = async () => {
    const auds = await api.get('/api/audiences');
    let qs = [{ type: 'scale', label: 'How did you play? (1-5)', required: true }, { type: 'text', label: 'What went well?' }, { type: 'text', label: 'What do you need to work on?' }];
    const m = modal({ title: 'New report form', wide: true, body: html`<form id="nf"><div class="fields">${field('Title', html`<input name="title" value="Post-game self-evaluation" required>`)}${field('Due', html`<input type="datetime-local" name="due">`)}</div>${field('Description', html`<input name="description">`)}
      <h4>Questions</h4><div id="qs"></div><button type="button" class="sm" id="addq">Add question</button>
      <div class="grid g2" style="margin-top:10px"><div>${field('Send to', audienceField('audience', auds, [], { exclude: ['coaches', 'parents'] }))}</div>
      <div>${field('Responses visible to', html`${[['head_coach', 'Head coach'], ['coach', 'All coaches'], ['trainer', 'Trainers']].map(([k, l]) => html`<label class="check" style="display:flex"><input type="checkbox" name="share_with" data-multi value="${k}" ${checked(k !== 'coach')}> ${l}</label>`)}`, 'You always see responses to your own forms.')}</div></div></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Create and send', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#nf')); await api.post('/api/forms', { ...f, due: f.due || null, questions: qs.map((q) => ({ ...q, options: q.type === 'choice' ? String(q.options || '').split(',').map((x) => x.trim()).filter(Boolean) : undefined })) }); toast('Form sent'); ctx.reload(); } }] });
    wireAudience(m.root);
    const dq = () => set(m.root.querySelector('#qs'), qs.map((q, i) => html`<div class="inline-input" style="margin-bottom:6px" data-qi="${i}"><select data-k="type" style="max-width:120px">${options([['text', 'Text'], ['scale', 'Scale 1-5'], ['yesno', 'Yes/No'], ['choice', 'Choice']], q.type)}</select><input data-k="label" value="${q.label}" placeholder="Question">${q.type === 'choice' ? html`<input data-k="options" value="${Array.isArray(q.options) ? q.options.join(', ') : q.options || ''}" placeholder="Options, comma separated">` : ''}<label class="check"><input type="checkbox" data-k="required" ${checked(q.required)}> Req.</label><button type="button" class="sm ghost danger" data-rm="${i}">✕</button></div>`));
    dq();
    m.root.querySelector('#qs').addEventListener('change', (e) => { const i = e.target.closest('[data-qi]'); if (!i) return; const q = qs[Number(i.dataset.qi)]; const k = e.target.dataset.k; q[k] = k === 'required' ? e.target.checked : e.target.value; if (k === 'type') dq(); });
    on(m.root, 'click', '[data-rm]', (e, b) => { qs.splice(Number(b.dataset.rm), 1); dq(); });
    m.root.querySelector('#addq').onclick = () => { qs.push({ type: 'text', label: '' }); dq(); };
  };
}
function qInput(q, i, val, disabled) {
  const d = disabled ? raw('disabled') : '';
  const label = html`${q.label}${q.required ? ' *' : ''}`;
  if (q.type === 'scale') return field(label, html`<div class="row">${[1, 2, 3, 4, 5].map((n) => html`<label class="check"><input type="radio" name="q${i}" value="${n}" ${checked(String(val) === String(n))} ${d}> ${n}</label>`)}</div>`);
  if (q.type === 'yesno') return field(label, html`<div class="row">${['yes', 'no'].map((n) => html`<label class="check"><input type="radio" name="q${i}" value="${n}" ${checked(val === n)} ${d}> ${cap(n)}</label>`)}</div>`);
  if (q.type === 'choice') return field(label, html`<select name="q${i}" ${d}>${options(q.options || [], val, { blank: '—' })}</select>`);
  return field(label, html`<textarea name="q${i}" ${d}>${val || ''}</textarea>`);
}
