// Module 3: Playbook and play designer — library with search/filters, designer (players, routes, motion,
// formations, assignments, quiz), animated viewer with watermark and view-only protection, versions,
// delivery to audiences, install sheets with view tracking, knowledge checks and game mode.
import { api } from '../api.js';
import { html, set, $, $$, on, modal, toast, errToast, formData, options, checked, field, audienceField, wireAudience, fmtDT, ago, cap, empty,
  confirmDialog, raw, tabs, ROLE, esc } from '../ui.js';
import { renderPlay, thumb, svgPoint, watermarkHtml, animator, PATH_TYPES } from '../field.js';

export default async function playbook(el, ctx) {
  const r = ctx.route;
  if (r === '/playbook/play/:id/edit') return designer(el, ctx, ctx.params.id);
  if (r === '/playbook/play/:id') return viewer(el, ctx, Number(ctx.params.id));
  if (r === '/playbook/installs') return installs(el, ctx);
  if (r === '/playbook/install/:id') return install(el, ctx, Number(ctx.params.id));
  if (r === '/playbook/game') return gameMode(el, ctx);
  if (r === '/playbook/shares') return shares(el, ctx);
  return library(el, ctx);
}
const staffTabs = (active) => tabs([['plays', 'Plays', '/playbook'], ['installs', 'Install sheets', '/playbook/installs'], ['shares', 'Delivery', '/playbook/shares'], ['game', 'Game mode', '/playbook/game']], active);
const protect = (root) => { root.addEventListener('contextmenu', (e) => e.preventDefault()); root.addEventListener('copy', (e) => e.preventDefault()); root.addEventListener('dragstart', (e) => e.preventDefault()); };

async function library(el, ctx) {
  const staff = ctx.me.caps.staff;
  const q = ctx.query;
  const [plays, books, facets, cfg] = await Promise.all([api.get(`/api/plays?${new URLSearchParams(q)}`), api.get('/api/playbooks'), api.get('/api/playbook/facets').catch(() => ({ folders: [], tags: [] })), api.get('/api/playbook/config')]);
  const edit = cfg.can_edit;
  set(el, html`<div class="page-head"><div><h1>${staff ? 'Playbook' : 'My plays'}</h1><div class="sub">${staff ? 'Plays are view-only inside the app, watermarked and logged.' : 'Plays your coaches assigned to you. View-only and watermarked with your name.'}</div></div>
    <div class="actions">${edit ? html`<button id="nb">New playbook</button><button class="primary" id="np">New play</button>` : ''}${!staff ? html`<a class="btn" href="/playbook/installs">Install sheets</a>` : ''}</div></div>
    ${staff ? staffTabs('plays') : ''}
    <div class="filters"><input type="search" id="q" placeholder="Search plays" value="${q.q || ''}" style="min-width:220px">
      <select id="pb"><option value="">All playbooks</option>${options(books.map((b) => [b.id, b.name]), q.playbook_id)}</select>
      <select id="side"><option value="">All sides</option>${options([['offense', 'Offense'], ['defense', 'Defense'], ['special', 'Special teams']], q.side)}</select>
      <select id="folder"><option value="">All folders</option>${options(facets.folders, q.folder)}</select>
      <select id="tag"><option value="">All tags</option>${options(facets.tags, q.tag)}</select></div>
    ${plays.length ? html`<div class="grid g4">${plays.map((p) => html`<a class="card" href="/playbook/play/${p.id}" style="color:inherit;text-decoration:none">
      <div class="play-thumb no-copy">${raw(thumb(p.data))}</div>
      <div class="bd" style="padding:9px 11px"><b>${p.name}</b><div class="s muted">${[p.formation, p.folder].filter(Boolean).join(' · ')}</div>
      <div class="row" style="margin-top:5px;gap:4px">${p.tags.slice(0, 3).map((t) => html`<span class="badge">${t}</span>`)}</div></div></a>`)}</div>`
    : empty(staff ? 'No plays match. Create one with New play.' : 'No plays have been assigned to you yet.')}
    ${staff && books.length ? html`<div class="card" style="margin-top:14px"><div class="hd"><h2>Playbooks</h2></div><ul class="list">${books.map((b) => html`<li><div class="grow"><div class="t">${b.name}</div><div class="s">${b.description || ''} · ${b.play_count} plays</div></div>${edit ? html`<button class="sm" data-share-book="${b.id}">Send to players</button>` : ''}</li>`)}</ul></div>` : ''}`);
  const go = () => ctx.navigate('/playbook?' + new URLSearchParams(Object.fromEntries(Object.entries({ q: $('#q', el).value, playbook_id: $('#pb', el).value, side: $('#side', el).value, folder: $('#folder', el).value, tag: $('#tag', el).value }).filter(([, v]) => v))));
  for (const id of ['q', 'pb', 'side', 'folder', 'tag']) $(`#${id}`, el).onchange = go;
  if ($('#np', el)) $('#np', el).onclick = () => ctx.navigate('/playbook/play/new/edit');
  if ($('#nb', el)) $('#nb', el).onclick = () => modal({ title: 'New playbook', body: html`<form id="bf">${field('Name', html`<input name="name" required>`)}${field('Side', html`<select name="side">${options([['offense', 'Offense'], ['defense', 'Defense'], ['special', 'Special teams']])}</select>`)}${field('Description', html`<input name="description">`)}</form>`, actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: async (r) => { await api.post('/api/playbooks', formData(r.querySelector('#bf'))); ctx.reload(); } }] });
  on(el, 'click', '[data-share-book]', (e, b) => shareDialog(ctx, { playbook_id: Number(b.dataset.shareBook) }));
  protect(el);
}

async function shareDialog(ctx, target) {
  const auds = await api.get('/api/audiences');
  const m = modal({
    title: 'Send to players', body: html`<p class="muted">Players see only what is assigned to them. Parents never get playbook access. Access ends automatically when a player leaves the roster or group.</p>${audienceField('audience', auds, [], { exclude: ['parents', 'coaches'] })}`,
    actions: [{ label: 'Cancel' }, { label: 'Send', primary: true, onClick: async (r) => { const f = formData(r); await api.post('/api/play-shares', { ...target, audience: f.audience || [] }); toast('Sent'); } }],
  });
  wireAudience(m.root);
}

// ---------- Viewer ----------
async function viewer(el, ctx, id) {
  const p = await api.get(`/api/plays/${id}`);
  const staff = ctx.me.caps.staff;
  ctx.setTitle(p.name);
  let highlight = null;
  const myPos = !staff ? null : null;
  set(el, html`<div class="page-head"><div><h1>${p.name}</h1><div class="sub">${[cap(p.side), p.formation, p.folder].filter(Boolean).join(' · ')} · version ${p.version}</div></div>
    <div class="actions"><a class="btn" href="/playbook">Back</a>
      ${p.can_edit ? html`<a class="btn" href="/playbook/play/${id}/edit">Edit</a><button id="dup">Duplicate</button><button id="flip">Flip copy</button><button id="share">Send to players</button>` : ''}
      ${p.can_export ? html`<button id="exp">Export</button>` : ''}
      ${staff ? html`<a class="btn" href="/playbook/game?play=${id}">Game mode</a>` : ''}</div></div>
  <div class="designer">
    <div>
      <div class="field-wrap no-copy" id="fw">${raw(renderPlay(p.data))}${raw(watermarkHtml(p.watermark))}</div>
      <div class="row" style="margin-top:8px">
        <button class="primary" id="playb">Play</button><button id="reset">Reset</button><button id="back1">‹ Step</button><button id="fwd1">Step ›</button>
        <div class="seg">${[0.5, 1, 2].map((s) => html`<button data-speed="${s}" class="${s === 1 ? 'on' : ''}">${s}x</button>`)}</div>
        <span class="muted" id="tlabel"></span>
        <span class="spacer"></span>
        <select id="hl" style="width:auto"><option value="">Highlight a position</option>${options([...new Set(p.data.players.map((x) => x.label))])}</select>
      </div>
    </div>
    <div class="stack no-copy">
      ${p.coaching_points ? html`<div class="card"><div class="hd"><h3>Coaching points</h3></div><div class="bd">${p.coaching_points}</div></div>` : ''}
      <div class="card"><div class="hd"><h3>Assignments</h3></div>${Object.keys(p.assignments || {}).length ? html`<ul class="list">${Object.entries(p.assignments).map(([k, v]) => html`<li><b style="width:44px">${k}</b><span class="grow">${v}</span></li>`)}</ul>` : empty('No written assignments.')}</div>
      ${p.video_url ? html`<div class="card"><div class="bd"><a href="${p.video_url}" target="_blank" rel="noopener">Watch video</a></div></div>` : ''}
      ${!staff && (p.data.quiz || []).length ? html`<div class="card"><div class="hd"><h3>Knowledge check</h3></div><div class="bd" id="quiz">${p.data.quiz.map((q, i) => html`<div class="field"><label>${i + 1}. ${q.q}</label>${q.options.map((o, j) => html`<label class="check" style="display:flex"><input type="radio" name="q${i}" value="${j}"> ${o}</label>`)}</div>`)}<button class="primary" id="qsub">Submit answers</button></div></div>` : ''}
      ${staff ? html`<div class="card"><div class="hd"><h3>History and views</h3></div><div class="bd row"><button class="sm" id="ver">Version history</button><button class="sm" id="views">View log</button>${(p.data.quiz || []).length ? html`<button class="sm" id="qr">Quiz results</button>` : ''}</div></div>` : ''}
    </div>
  </div>`);
  protect(el);
  const fw = $('#fw', el);
  const draw = (t) => { fw.innerHTML = renderPlay(p.data, { t, highlight }) + watermarkHtml(p.watermark); $('#tlabel', el).textContent = t == null ? '' : t < 0 ? 'Pre-snap motion' : `${t.toFixed(1)} s`; };
  const anim = animator(p.data, draw);
  $('#playb', el).onclick = () => { if (anim.playing) { anim.pause(); $('#playb', el).textContent = 'Play'; } else { anim.play(); $('#playb', el).textContent = 'Pause'; } };
  $('#reset', el).onclick = () => { anim.reset(); $('#playb', el).textContent = 'Play'; };
  $('#back1', el).onclick = () => anim.step(-0.5);
  $('#fwd1', el).onclick = () => anim.step(0.5);
  on(el, 'click', '[data-speed]', (e, b) => { anim.setSpeed(Number(b.dataset.speed)); $$('[data-speed]', el).forEach((x) => x.classList.toggle('on', x === b)); });
  $('#hl', el).onchange = (e) => { highlight = e.target.value || null; draw(anim.time > -1.6 ? anim.time : null); };
  if ($('#qsub', el)) $('#qsub', el).onclick = async () => {
    const answers = p.data.quiz.map((_, i) => { const c = el.querySelector(`input[name=q${i}]:checked`); return c ? Number(c.value) : null; });
    try { const r = await api.post(`/api/plays/${id}/quiz`, { answers }); toast(`You scored ${r.score} of ${r.total}`); } catch (err) { errToast(err); }
  };
  if (!staff) return;
  if ($('#dup', el)) $('#dup', el).onclick = async () => { const r = await api.post(`/api/plays/${id}/duplicate`, {}); ctx.navigate(`/playbook/play/${r.id}/edit`); };
  if ($('#flip', el)) $('#flip', el).onclick = async () => { const r = await api.post(`/api/plays/${id}/duplicate`, { flip: true }); toast('Flipped copy created'); ctx.navigate(`/playbook/play/${r.id}`); };
  if ($('#share', el)) $('#share', el).onclick = () => shareDialog(ctx, { play_id: id });
  if ($('#exp', el)) $('#exp', el).onclick = async () => {
    const x = await api.get(`/api/plays/${id}/export`);
    const w = window.open('', '_blank');
    w.document.write(`<title>${esc(x.name)}</title><body style="font-family:Arial;margin:24px"><h2>${esc(x.name)}</h2><div style="max-width:900px">${renderPlay(x.data)}</div><p>${esc(x.coaching_points || '')}</p><ul>${Object.entries(x.assignments || {}).map(([k, v]) => `<li><b>${esc(k)}</b>: ${esc(v)}</li>`).join('')}</ul><p style="color:#888">${esc(x.watermark)}</p><script>print()</script>`);
  };
  $('#ver', el).onclick = async () => {
    const v = await api.get(`/api/plays/${id}/versions`);
    const m = modal({ title: 'Version history', body: html`<ul class="list" style="margin:-16px">${v.map((x) => html`<li><div class="grow"><div class="t">Version ${x.version} · ${x.by_name || ''}</div><div class="s">${x.summary || ''} · ${fmtDT(x.at)}</div></div>${p.can_edit && x.version !== p.version ? html`<button class="sm" data-restore="${x.version}">Restore</button>` : ''}</li>`)}</ul>`, actions: [{ label: 'Close' }] });
    on(m.root, 'click', '[data-restore]', async (e, b) => { await api.post(`/api/plays/${id}/restore`, { version: Number(b.dataset.restore) }); m.close(); toast('Restored'); ctx.reload(); });
  };
  $('#views', el).onclick = async () => {
    const v = await api.get(`/api/plays/${id}/views`);
    modal({ title: 'Who opened this play', wide: true, body: v.length ? html`<table><thead><tr><th>Person</th><th>Role</th><th>How</th><th>When</th></tr></thead><tbody>${v.map((x) => html`<tr><td>${x.name}</td><td>${ROLE[x.role]}</td><td>${x.context}</td><td>${fmtDT(x.at)}</td></tr>`)}</tbody></table>` : empty('No views yet.'), actions: [{ label: 'Close' }] });
  };
  if ($('#qr', el)) $('#qr', el).onclick = async () => {
    const v = await api.get(`/api/plays/${id}/quiz-results`);
    modal({ title: 'Knowledge check results', body: v.length ? html`<table><thead><tr><th>Player</th><th class="num">Score</th><th>When</th></tr></thead><tbody>${v.map((x) => html`<tr><td>${x.name}</td><td class="num">${x.score}/${x.total}</td><td>${fmtDT(x.at)}</td></tr>`)}</tbody></table>` : empty('No results yet.'), actions: [{ label: 'Close' }] });
  };
}

// ---------- Designer ----------
async function designer(el, ctx, idParam) {
  const isNew = idParam === 'new';
  const [play, books, formations, cfg] = await Promise.all([
    isNew ? Promise.resolve({ name: 'New play', side: 'offense', data: { players: [], ball: { x: 50, y: 31.5 }, quiz: [] }, tags: [], assignments: {}, version: 0 }) : api.get(`/api/plays/${idParam}`),
    api.get('/api/playbooks'), api.get('/api/formations'), api.get('/api/playbook/config'),
  ]);
  if (!cfg.can_edit) { set(el, html`<div class="notice bad">You do not have edit access to the playbook.</div>`); return; }
  const data = JSON.parse(JSON.stringify(play.data));
  data.quiz ||= []; data.ball ||= { x: 50, y: 31.5 };
  let tool = 'select'; let sel = null; let drawing = null; let drag = null;
  const meta = { ...play, assignments: { ...(play.assignments || {}) } };
  const selected = () => data.players.find((p) => p.id === sel);
  set(el, html`<div class="page-head"><div><h1>${isNew ? 'New play' : `Edit: ${play.name}`}</h1><div class="sub">Click to place players, choose a path tool and click points on the field. Double-click or press Enter to finish a path.</div></div>
    <div class="actions"><a class="btn" href="${isNew ? '/playbook' : `/playbook/play/${idParam}`}">Cancel</a>${!isNew ? html`<button class="danger" id="del">Delete</button>` : ''}<button class="primary" id="save">Save play</button></div></div>
    <div class="designer">
      <div>
        <div class="tool-row" id="tools">
          ${[['select', 'Select / move'], ['O', 'Add O'], ['square', 'Add square'], ['X', 'Add X'], ['path', 'Draw path'], ['motion', 'Draw motion']].map(([k, l]) => html`<button data-tool="${k}" class="${k === tool ? 'on' : ''}">${l}</button>`)}
          <span class="spacer"></span>
          <button id="clearp">Clear path</button><button id="delp">Delete player</button><button id="flipb">Flip</button>
        </div>
        <div class="field-wrap" id="fw"></div>
        <div class="row" style="margin-top:8px">
          <select id="formation" style="width:auto"><option value="">Load a formation…</option>${options(formations.map((f) => [f.id, `${f.name} (${f.side})`]))}</select>
          <button id="savef">Save players as formation</button><button id="preview">Preview animation</button>
        </div>
      </div>
      <div class="stack">
        <div class="card"><div class="hd"><h3>Selected player</h3></div><div class="bd" id="psel"></div></div>
        <div class="card"><div class="hd"><h3>Play</h3></div><div class="bd"><form id="mf">
          ${field('Name', html`<input name="name" value="${meta.name}">`)}
          <div class="fields">${field('Side', html`<select name="side">${options([['offense', 'Offense'], ['defense', 'Defense'], ['special', 'Special teams']], meta.side)}</select>`)}${field('Playbook', html`<select name="playbook_id">${options(books.map((b) => [b.id, b.name]), meta.playbook_id ?? '', { blank: '—' })}</select>`)}</div>
          <div class="fields">${field('Formation', html`<input name="formation" value="${meta.formation || ''}">`)}${field('Folder', html`<input name="folder" value="${meta.folder || ''}">`)}</div>
          ${field('Tags (comma separated)', html`<input name="tags" value="${(meta.tags || []).join(', ')}" placeholder="3rd down, red zone">`)}
          ${field('Coaching points', html`<textarea name="coaching_points">${meta.coaching_points || ''}</textarea>`)}
          ${field('Video link', html`<input name="video_url" value="${meta.video_url || ''}">`)}
        </form></div></div>
        <div class="card"><div class="hd"><h3>Assignments by position</h3></div><div class="bd" id="asg"></div></div>
        <div class="card"><div class="hd"><h3>Knowledge check</h3><span class="r"><button class="sm" id="addq">Add question</button></span></div><div class="bd" id="quiz"></div></div>
      </div>
    </div>`);
  const fw = $('#fw', el);
  const draw = (t = null) => { fw.innerHTML = renderPlay(data, { selected: sel, t, extra: drawing && drawing.pts.length ? `<polyline points="${[drawing.start, ...drawing.pts].map((p) => p.join(',')).join(' ')}" fill="none" stroke="#ffd666" stroke-width="0.5" stroke-dasharray="1 .6"/>` : '' }); };
  const drawSel = () => {
    const p = selected();
    set($('#psel', el), p ? html`<div class="fields">
      ${field('Label', html`<input data-pk="label" value="${p.label || ''}">`)}
      ${field('Shape', html`<select data-pk="shape">${options([['O', 'O'], ['square', 'Square'], ['X', 'X']], p.shape)}</select>`)}
      ${field('Path type', html`<select data-pk="path_type">${options(PATH_TYPES.map((x) => [x, cap(x)]), p.path_type || 'route')}</select>`)}
      ${field('Start delay (s)', html`<input type="number" step="0.1" min="0" data-pk="delay" value="${p.delay || 0}">`)}</div>
      <div class="s muted">${p.path?.length || 0} path points · ${p.motion?.length || 0} motion points</div>` : html`<p class="muted">Select a player on the field.</p>`);
  };
  const drawAsg = () => {
    const labels = [...new Set(data.players.map((p) => p.label).filter(Boolean))];
    set($('#asg', el), labels.length ? labels.map((l) => field(l, html`<input data-asg="${l}" value="${meta.assignments[l] || ''}">`)) : html`<p class="muted">Add players first.</p>`);
  };
  const drawQuiz = () => {
    set($('#quiz', el), data.quiz.length ? data.quiz.map((q, i) => html`<div class="field" data-qi="${i}" style="border-bottom:1px solid var(--border);padding-bottom:8px">
      <input data-qk="q" value="${q.q}" placeholder="Question" style="margin-bottom:4px">
      ${q.options.map((o, j) => html`<div class="inline-input" style="margin-bottom:3px"><input type="radio" name="ans${i}" data-qa="${j}" ${checked(Number(q.answer) === j)} title="Correct answer"><input data-qo="${j}" value="${o}" placeholder="Option ${j + 1}"></div>`)}
      <button class="sm ghost danger" data-qdel="${i}">Remove</button></div>`) : html`<p class="muted">Optional questions players answer after studying the play.</p>`);
  };
  draw(); drawSel(); drawAsg(); drawQuiz();
  const setTool = (t) => { tool = t; drawing = null; $$('[data-tool]', el).forEach((b) => b.classList.toggle('on', b.dataset.tool === t)); draw(); };
  on(el, 'click', '[data-tool]', (e, b) => setTool(b.dataset.tool));
  const finish = () => {
    if (!drawing) return;
    const p = data.players.find((x) => x.id === drawing.id);
    if (p && drawing.pts.length) { if (drawing.kind === 'motion') p.motion = drawing.pts; else p.path = drawing.pts; }
    drawing = null; draw(); drawSel();
  };
  const svg = () => fw.querySelector('svg');
  fw.addEventListener('pointerdown', (e) => {
    const pt = svgPoint(svg(), e);
    const g = e.target.closest('[data-player]');
    if (tool === 'select') {
      if (g) { sel = g.dataset.player; drag = { id: sel, ox: pt[0], oy: pt[1] }; fw.setPointerCapture(e.pointerId); } else sel = null;
      draw(); drawSel(); return;
    }
    if (['O', 'X', 'square'].includes(tool)) {
      const team = tool === 'X' ? 'D' : 'O';
      const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      data.players.push({ id, label: tool === 'X' ? 'X' : tool === 'square' ? 'C' : '', shape: tool, team, x: pt[0], y: pt[1], path: [], path_type: team === 'D' ? 'coverage' : 'route', delay: 0 });
      sel = id; draw(); drawSel(); drawAsg(); return;
    }
    if (tool === 'path' || tool === 'motion') {
      if (!drawing) {
        if (!g) { toast('Click a player to start the path', 'warn'); return; }
        const p = data.players.find((x) => x.id === g.dataset.player);
        sel = p.id;
        const start = tool === 'path' && p.motion?.length ? p.motion[p.motion.length - 1] : [p.x, p.y];
        drawing = { id: p.id, kind: tool, start, pts: [] };
      } else drawing.pts.push(pt);
      draw();
    }
  });
  fw.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const pt = svgPoint(svg(), e);
    const p = data.players.find((x) => x.id === drag.id);
    const dx = pt[0] - drag.ox; const dy = pt[1] - drag.oy;
    p.x = Math.round((p.x + dx) * 10) / 10; p.y = Math.round((p.y + dy) * 10) / 10;
    p.path = (p.path || []).map(([x, y]) => [Math.round((x + dx) * 10) / 10, Math.round((y + dy) * 10) / 10]);
    p.motion = (p.motion || []).map(([x, y]) => [Math.round((x + dx) * 10) / 10, Math.round((y + dy) * 10) / 10]);
    drag.ox = pt[0]; drag.oy = pt[1];
    draw();
  });
  fw.addEventListener('pointerup', () => { drag = null; });
  fw.addEventListener('dblclick', finish);
  const keyH = (e) => { if (!document.body.contains(fw)) return document.removeEventListener('keydown', keyH); if (e.key === 'Enter' && drawing) { e.preventDefault(); finish(); } if (e.key === 'Escape') { drawing = null; draw(); } };
  document.addEventListener('keydown', keyH);
  $('#psel', el).addEventListener('input', (e) => {
    const p = selected(); const k = e.target.dataset.pk; if (!p || !k) return;
    p[k] = k === 'delay' ? Number(e.target.value) : e.target.value;
    if (k === 'shape') p.team = p.shape === 'X' ? 'D' : 'O';
    draw(); if (k === 'label') drawAsg();
  });
  $('#asg', el).addEventListener('input', (e) => { if (e.target.dataset.asg) meta.assignments[e.target.dataset.asg] = e.target.value; });
  $('#quiz', el).addEventListener('input', (e) => {
    const box = e.target.closest('[data-qi]'); if (!box) return; const q = data.quiz[Number(box.dataset.qi)];
    if (e.target.dataset.qk) q.q = e.target.value; if (e.target.dataset.qo !== undefined) q.options[Number(e.target.dataset.qo)] = e.target.value; if (e.target.dataset.qa !== undefined) q.answer = Number(e.target.dataset.qa);
  });
  on($('#quiz', el), 'click', '[data-qdel]', (e, b) => { data.quiz.splice(Number(b.dataset.qdel), 1); drawQuiz(); });
  $('#addq', el).onclick = () => { data.quiz.push({ q: '', options: ['', '', ''], answer: 0 }); drawQuiz(); };
  $('#clearp', el).onclick = () => { const p = selected(); if (p) { p.path = []; p.motion = []; draw(); drawSel(); } };
  $('#delp', el).onclick = () => { if (!sel) return; data.players = data.players.filter((p) => p.id !== sel); sel = null; draw(); drawSel(); drawAsg(); };
  $('#flipb', el).onclick = () => { for (const p of data.players) { p.x = Math.round((100 - p.x) * 10) / 10; p.path = (p.path || []).map(([x, y]) => [Math.round((100 - x) * 10) / 10, y]); p.motion = (p.motion || []).map(([x, y]) => [Math.round((100 - x) * 10) / 10, y]); } draw(); };
  $('#formation', el).onchange = (e) => {
    const f = formations.find((x) => x.id === Number(e.target.value)); if (!f) return;
    const keep = data.players.filter((p) => (f.side === 'defense' ? p.team !== 'D' : p.team !== 'O'));
    data.players = [...keep, ...JSON.parse(JSON.stringify(f.data)).map((p) => ({ ...p, id: `${p.id}-${Math.random().toString(36).slice(2, 6)}` }))];
    if (!$('[name=formation]', el).value) $('[name=formation]', el).value = f.name;
    e.target.value = ''; draw(); drawAsg();
  };
  $('#savef', el).onclick = () => modal({ title: 'Save formation', body: html`<form id="ff">${field('Name', html`<input name="name" required>`)}${field('Side', html`<select name="side">${options([['offense', 'Offense players'], ['defense', 'Defense players']])}</select>`)}</form>`, actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => {
    const f = formData(r.querySelector('#ff')); const team = f.side === 'defense' ? 'D' : 'O';
    await api.post('/api/formations', { name: f.name, side: f.side, data: data.players.filter((p) => p.team === team).map((p) => ({ ...p, path: [], motion: [] })) }); toast('Formation saved');
  } }] });
  $('#preview', el).onclick = () => { const a = animator(data, (t) => draw(t)); a.play(); };
  const save = async (force = false) => {
    const f = formData($('#mf', el));
    const body = { ...f, playbook_id: f.playbook_id ? Number(f.playbook_id) : null, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), data, assignments: Object.fromEntries(Object.entries(meta.assignments).filter(([k, v]) => v && data.players.some((p) => p.label === k))), base_version: play.version, force };
    data.quiz = data.quiz.filter((q) => q.q && q.options.filter(Boolean).length >= 2).map((q) => ({ ...q, options: q.options.filter(Boolean) }));
    try {
      if (isNew) { const r = await api.post('/api/plays', body); toast('Play created'); ctx.navigate(`/playbook/play/${r.id}`); } else { await api.put(`/api/plays/${idParam}`, body); toast('Saved'); ctx.navigate(`/playbook/play/${idParam}`); }
    } catch (err) {
      if (err.status === 409 && (await confirmDialog(`${err.message} Save anyway as a new version on top of theirs?`, { ok: 'Save anyway' }))) return save(true);
      errToast(err);
    }
  };
  $('#save', el).onclick = () => save();
  if ($('#del', el)) $('#del', el).onclick = async () => { if (await confirmDialog('Delete this play for everyone?', { danger: true, ok: 'Delete' })) { await api.del(`/api/plays/${idParam}`); ctx.navigate('/playbook'); } };
}

// ---------- Delivery ----------
async function shares(el, ctx) {
  const list = await api.get('/api/play-shares');
  const cfg = await api.get('/api/playbook/config');
  set(el, html`<div class="page-head"><div><h1>Playbook</h1><div class="sub">What each group of players can see. Remove a row to revoke access immediately.</div></div></div>${staffTabs('shares')}
    <div class="card"><div class="bd flush tbl-wrap">${list.length ? html`<table><thead><tr><th>Play or playbook</th><th>Sent to</th><th>By</th><th>When</th><th></th></tr></thead><tbody>${list.map((s) => html`<tr><td>${s.play_name ? html`<a href="/playbook/play/${s.play_id}">${s.play_name}</a>` : html`<b>${s.playbook_name}</b> (whole playbook)`}</td><td>${s.audience_labels.join(', ')}</td><td>${s.by_name}</td><td>${fmtDT(s.at)}</td><td>${cfg.can_edit ? html`<button class="sm danger" data-rev="${s.id}">Revoke</button>` : ''}</td></tr>`)}</tbody></table>` : empty('Nothing has been sent to players yet.')}</div></div>`);
  on(el, 'click', '[data-rev]', async (e, b) => { await api.del(`/api/play-shares/${b.dataset.rev}`); toast('Access revoked'); ctx.reload(); });
}

// ---------- Install sheets ----------
async function installs(el, ctx) {
  const staff = ctx.me.caps.staff;
  const [list, cfg] = await Promise.all([api.get('/api/installs'), api.get('/api/playbook/config')]);
  set(el, html`<div class="page-head"><div><h1>${staff ? 'Playbook' : 'Install sheets'}</h1><div class="sub">Ordered sets of plays with coaching points, assigned to a group. Coaches see who has opened each one.</div></div>
    <div class="actions">${cfg.can_edit ? html`<button class="primary" id="new">New install sheet</button>` : ''}</div></div>${staff ? staffTabs('installs') : ''}
    <div class="card">${list.length ? html`<ul class="list">${list.map((i) => html`<li class="click" onclick="__navigate('/playbook/install/${i.id}')"><div class="grow"><div class="t">${i.name}</div><div class="s">${i.plays.length} plays · ${i.audience_labels.join(', ') || 'Not assigned'}</div></div>${staff ? html`<span class="badge ${i.viewed === i.expected ? 'ok' : 'warn'}">${i.viewed}/${i.expected} viewed</span>` : ''}</li>`)}</ul>` : empty('No install sheets yet.')}</div>`);
  if ($('#new', el)) $('#new', el).onclick = () => installForm(ctx);
}
async function installForm(ctx, inst = null) {
  const [plays, auds] = await Promise.all([api.get('/api/plays'), api.get('/api/audiences')]);
  const chosen = inst ? inst.plays.map((p) => p.id) : [];
  const m = modal({
    title: inst ? 'Edit install sheet' : 'New install sheet', wide: true,
    body: html`<form id="if">${field('Name', html`<input name="name" value="${inst?.name || ''}" required>`)}${field('Notes for players', html`<textarea name="notes">${inst?.notes || ''}</textarea>`)}
      <div class="grid g2"><div>${field('Plays (in order checked)', html`<div style="max-height:260px;overflow-y:auto;border:1px solid var(--border-strong);border-radius:5px;padding:6px 10px">${plays.map((p) => html`<label class="check" style="display:flex"><input type="checkbox" name="play_ids" data-multi data-num value="${p.id}" ${checked(chosen.includes(p.id))}> ${p.name} <span class="faint">${p.formation || ''}</span></label>`)}</div>`)}</div>
      <div>${field('Assign to', audienceField('audience', auds, inst?.audience || [], { exclude: ['parents', 'coaches'] }))}</div></div></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => {
      const f = formData(r.querySelector('#if'));
      if (inst) { await api.put(`/api/installs/${inst.id}`, f); ctx.reload(); } else { const res = await api.post('/api/installs', f); ctx.navigate(`/playbook/install/${res.id}`); }
    } }],
  });
  wireAudience(m.root);
}
async function install(el, ctx, id) {
  const i = await api.get(`/api/installs/${id}`);
  const staff = ctx.me.caps.staff;
  const cfg = await api.get('/api/playbook/config');
  ctx.setTitle(i.name);
  set(el, html`<div class="page-head"><div><h1>${i.name}</h1><div class="sub">${i.audience_labels.join(', ')}</div></div>
    <div class="actions"><a class="btn" href="/playbook/installs">Back</a>${cfg.can_edit ? html`<button id="edit">Edit</button><button class="danger" id="del">Delete</button>` : ''}</div></div>
    ${i.notes ? html`<div class="notice">${i.notes}</div>` : ''}
    ${staff ? html`<div class="card" style="margin-bottom:14px"><div class="hd"><h2>Viewed by ${i.viewed} of ${i.expected}</h2></div>${i.not_viewed.length ? html`<div class="bd"><span class="muted">Not opened yet:</span> ${i.not_viewed.map((p) => p.name).join(', ')}</div>` : html`<div class="bd muted">Everyone has opened it.</div>`}</div>` : ''}
    <div class="stack no-copy">${i.plays.map((p, n) => html`<div class="card"><div class="hd"><h2>${n + 1}. ${p.name}</h2><span class="r"><a href="/playbook/play/${p.id}?install=${id}">Open and animate</a></span></div><div class="bd grid g2">
      <div class="field-wrap">${raw(renderPlay(p.data))}${raw(watermarkHtml(i.watermark))}</div>
      <div>${p.coaching_points ? html`<p><b>Coaching points:</b> ${p.coaching_points}</p>` : ''}<dl class="kv">${Object.entries(p.assignments || {}).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl></div>
    </div></div>`)}</div>`);
  protect(el);
  if ($('#edit', el)) $('#edit', el).onclick = () => installForm(ctx, i);
  if ($('#del', el)) $('#del', el).onclick = async () => { if (await confirmDialog('Delete this install sheet?', { danger: true, ok: 'Delete' })) { await api.del(`/api/installs/${id}`); ctx.navigate('/playbook/installs'); } };
}

// ---------- Game mode (PLAY-9) ----------
const GKEY = 'pm.gameplays.v1';
async function gameMode(el, ctx) {
  const cfg = await api.get('/api/playbook/config').catch(() => ({ game_mode: 'booth_halftime', game_mode_note: '' }));
  let plays = [];
  try { plays = await api.get('/api/plays'); try { localStorage.setItem(GKEY, JSON.stringify(plays)); } catch { /* full */ } } catch { try { plays = JSON.parse(localStorage.getItem(GKEY) || '[]'); } catch { plays = []; } }
  set(el, html`<div class="page-head"><div><h1>Playbook</h1><div class="sub">Open a play full screen, move players or draw over it, and show it. Works offline once plays are loaded here.</div></div></div>${staffTabs('game')}
    <div class="notice ${cfg.game_mode === 'off' ? 'bad' : 'warn'}"><b>${ctx.me.program.state} rule setting:</b> ${cfg.game_mode_note} <a href="/settings">Change in settings</a></div>
    ${cfg.game_mode === 'off' ? '' : html`<div class="card"><div class="bd">
      ${cfg.game_mode === 'booth_halftime' ? html`<label class="check" style="margin-bottom:10px"><input type="checkbox" id="ack"> I am in the coaching booth or the locker room (not on the sideline).</label>` : ''}
      <div class="inline-input"><select id="gp">${options(plays.map((p) => [p.id, p.name]), ctx.query.play)}</select><button class="primary" id="open">Open full screen</button></div>
      <p class="help">${plays.length} plays cached on this device for offline use.</p></div></div>`}`);
  if (cfg.game_mode === 'off') return;
  $('#open', el).onclick = () => {
    if ($('#ack', el) && !$('#ack', el).checked) return toast('Confirm you are in the booth or locker room first', 'warn');
    const p = plays.find((x) => x.id === Number($('#gp', el).value));
    if (p) openGame(p, ctx, plays);
  };
}
function openGame(play, ctx, plays) {
  const data = JSON.parse(JSON.stringify(play.data));
  const g = document.createElement('div');
  g.className = 'gamemode';
  g.innerHTML = `<div class="bar-top"><b>${esc(play.name)}</b><span style="opacity:.6;font-size:12px">${esc(ctx.me.user.name)}</span><span style="flex:1"></span>
    <select id="gsw" style="width:auto;background:#1c2a22;color:#fff;border-color:#2e4337">${plays.map((p) => `<option value="${p.id}" ${p.id === play.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <button data-m="move" class="sm">Move players</button><button data-m="draw" class="sm">Draw</button><button id="gclear" class="sm">Clear drawing</button><button id="ganim" class="sm">Animate</button><button id="greset" class="sm">Reset</button><button id="gx" class="sm">Close</button></div>
    <div class="stage"><div class="field-wrap" id="gfw" style="position:relative"></div></div>`;
  document.body.appendChild(g);
  if (g.requestFullscreen) g.requestFullscreen().catch(() => {});
  const fw = g.querySelector('#gfw');
  let mode = 'move'; let drag = null; let strokes = []; let cur = null;
  const draw = (t = null) => {
    fw.innerHTML = renderPlay(data, { t, extra: strokes.map((s) => `<polyline points="${s.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#ffd666" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round"/>`).join('') }) + watermarkHtml(ctx.me.user.name);
  };
  draw();
  const setMode = (m) => { mode = m; g.querySelectorAll('[data-m]').forEach((b) => { b.style.outline = b.dataset.m === m ? '2px solid #ffd666' : ''; }); };
  setMode('move');
  g.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => setMode(b.dataset.m); });
  fw.addEventListener('pointerdown', (e) => {
    const svg = fw.querySelector('svg'); const pt = svgPoint(svg, e);
    fw.setPointerCapture(e.pointerId);
    if (mode === 'draw') { cur = [pt]; strokes.push(cur); return; }
    const t = e.target.closest('[data-player]'); if (t) drag = data.players.find((p) => p.id === t.dataset.player);
  });
  fw.addEventListener('pointermove', (e) => {
    const svg = fw.querySelector('svg'); if (!svg) return; const pt = svgPoint(svg, e);
    if (cur) { cur.push(pt); draw(); } else if (drag) { const dx = pt[0] - drag.x; const dy = pt[1] - drag.y; drag.x = pt[0]; drag.y = pt[1]; drag.path = (drag.path || []).map(([x, y]) => [x + dx, y + dy]); draw(); }
  });
  fw.addEventListener('pointerup', () => { cur = null; drag = null; });
  g.querySelector('#gclear').onclick = () => { strokes = []; draw(); };
  g.querySelector('#greset').onclick = () => { Object.assign(data, JSON.parse(JSON.stringify(play.data))); strokes = []; draw(); };
  g.querySelector('#ganim').onclick = () => animator(data, (t) => draw(t)).play();
  g.querySelector('#gsw').onchange = (e) => { g.remove(); openGame(plays.find((p) => p.id === Number(e.target.value)), ctx, plays); };
  g.querySelector('#gx').onclick = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); g.remove(); };
  g.addEventListener('contextmenu', (e) => e.preventDefault());
  api.get(`/api/plays/${play.id}?context=game`).catch(() => {});
}
