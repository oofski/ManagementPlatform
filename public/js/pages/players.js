// Module 4: Players and teams — roster with filters, sort, import/export; player profile; teams, positions, groups.
import { api } from '../api.js';
import { html, set, $, $$, on, modal, toast, errToast, formData, options, checked, field, avatar, availBadge, cap, empty, confirmDialog, UNIT,
  fmtDate, todayISO, parseCSV, readFileAsDataURL, sortRows, raw, tabs, lineChart } from '../ui.js';

export default async function players(el, ctx) {
  if (ctx.route === '/teams') return teams(el, ctx);
  if (ctx.params.id) return profile(el, ctx, Number(ctx.params.id));
  return roster(el, ctx);
}
const rtabs = (a, ctx) => (ctx.me.caps.staff ? tabs([['roster', 'Roster', '/players'], ['teams', 'Teams, positions and groups', '/teams']], a) : '');

async function roster(el, ctx) {
  const q = ctx.query;
  const [list, st] = await Promise.all([api.get('/api/players' + (q.archived ? '?archived=1' : '')), api.get('/api/structure')]);
  const staff = ctx.me.caps.staff;
  const edit = ctx.me.caps['roster.edit'];
  // F-8: height for coaches and trainers; body weight only for staff with body-data access.
  const seeHt = ctx.me.user.role !== 'staff' || ctx.me.caps['body.view'];
  const seeWt = !!ctx.me.caps['body.view'];
  const codes = [...new Set(st.positions.map((p) => p.code))];
  let sortKey = q.sort || 'name'; let dir = q.dir === 'desc' ? -1 : 1;
  const filtered = () => {
    let r = list;
    if (q.level_id) r = r.filter((p) => p.level_id === Number(q.level_id));
    if (q.team_id) r = r.filter((p) => p.team_id === Number(q.team_id));
    if (q.unit) r = r.filter((p) => p.units.includes(q.unit));
    if (q.position) r = r.filter((p) => p.positions.includes(q.position));
    if (q.group) r = r.filter((p) => p.group === q.group); // C-2: one position group per athlete (same as the weight room)
    if (q.availability) r = r.filter((p) => p.availability === q.availability);
    if (q.q) r = r.filter((p) => p.name.toLowerCase().includes(q.q.toLowerCase()) || String(p.jersey) === q.q);
    return sortRows(r, sortKey, dir);
  };
  const rows = filtered();
  const teamsAll = st.levels.flatMap((l) => l.teams.map((t) => [t.id, t.name === l.name ? t.name : `${l.name} ${t.name}`]));
  const th = (k, l, cls = '') => html`<th class="sortable ${cls}" data-sort="${k}">${l}${sortKey === k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  set(el, html`<div class="page-head"><div><h1>Players</h1><div class="sub">${rows.length} of ${list.length} players${q.archived ? ' (including archived)' : ''}</div></div>
    <div class="actions">${staff ? html`<a class="btn" href="/api/players/export.csv" download>Export</a>` : ''}${edit ? html`<button id="fbjoin">Team join codes</button><button id="imp">Import spreadsheet</button><button class="primary" id="add">Add player</button>` : ''}${ctx.me.caps.admin ? html`<button id="roll">Season rollover</button>` : ''}</div></div>
    ${rtabs('roster', ctx)}
    <div class="filters">
      <input type="search" id="q" placeholder="Name or number" value="${q.q || ''}">
      <select data-f="level_id"><option value="">All levels</option>${options(st.levels.map((l) => [l.id, l.name]), q.level_id)}</select>
      <select data-f="team_id"><option value="">All teams</option>${options(teamsAll, q.team_id)}</select>
      <select data-f="unit"><option value="">All units</option>${options(Object.entries(UNIT), q.unit)}</select>
      <select data-f="position"><option value="">All positions</option>${options(codes, q.position)}</select>
      ${staff ? html`<select data-f="group"><option value="">All position groups</option>${options([...new Set(list.map((p) => p.group).filter(Boolean))].sort().map((g) => [g, `${g} group`]), q.group)}</select>` : ''}
      ${staff ? html`<select data-f="availability"><option value="">Any status</option>${options([['available', 'Full'], ['limited', 'Limited'], ['out', 'Out'], ['cleared', 'Cleared']], q.availability)}</select>` : ''}
      ${ctx.me.caps.admin ? html`<label class="check"><input type="checkbox" id="arch" ${checked(q.archived)}> Show archived</label>` : ''}
    </div>
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th></th>${th('jersey', '#', 'num')}${th('name', 'Name')}${th('team', 'Team')}<th>Units</th><th>Positions</th>${th('class_year', 'Class', 'num')}
      ${staff ? html`${seeHt ? th('height', 'Ht', 'num') : ''}${seeWt ? th('weight', 'Wt', 'num') : ''}${th('availability', 'Status')}<th>Account</th>` : ''}</tr></thead>
      <tbody>${rows.map((p) => html`<tr class="click" onclick="__navigate('/players/${p.id}')"><td style="width:40px">${avatar(p.name, p.photo)}</td><td class="num"><b>${p.jersey ?? ''}</b></td><td><b>${p.name}</b>${p.archived ? html` <span class="badge">Archived</span>` : ''}</td><td>${p.team || ''}</td>
        <td>${p.units.map((u) => html`<span class="badge">${UNIT[u]}</span> `)}</td><td>${p.positions.join(', ')}</td><td class="num">${p.class_year || ''}</td>
        ${staff ? html`${seeHt ? html`<td class="num">${p.height ? `${Math.floor(p.height / 12)}'${p.height % 12}"` : ''}</td>` : ''}${seeWt ? html`<td class="num">${p.weight ?? ''}</td>` : ''}<td>${availBadge(p.availability)}</td><td>${p.joined ? html`<span class="badge ok">Joined</span>` : html`<span class="badge warn">Invited</span>`}</td>` : ''}</tr>`)}</tbody></table>
      ${!rows.length ? empty('No players match these filters.') : ''}</div></div>`);
  const go = (patch) => ctx.navigate('/players?' + new URLSearchParams(Object.fromEntries(Object.entries({ ...q, ...patch }).filter(([, v]) => v))));
  $$('[data-f]', el).forEach((s) => { s.onchange = () => go({ [s.dataset.f]: s.value }); });
  $('#q', el).onchange = (e) => go({ q: e.target.value });
  if ($('#arch', el)) $('#arch', el).onchange = (e) => go({ archived: e.target.checked ? '1' : '' });
  on(el, 'click', '[data-sort]', (e, t) => { const k = t.dataset.sort; go({ sort: k, dir: sortKey === k && dir > 0 ? 'desc' : 'asc' }); });
  if (edit) {
    $('#add', el).onclick = () => playerForm(ctx, st, null);
    $('#imp', el).onclick = () => importDialog(ctx);
    $('#fbjoin', el).onclick = async () => (await import('./fb-profile.js')).joinCodesDialog(ctx); // C-4
  }
  if ($('#roll', el)) $('#roll', el).onclick = () => rollover(ctx, st, list);
}

export function playerForm(ctx, st, p) {
  const codes = st.positions;
  const v = p || { units: [], positions: [] };
  modal({
    title: p ? `Edit ${p.name}` : 'Add player', wide: true,
    body: html`<form id="pf"><div class="fields">
      ${field('Name', html`<input name="name" value="${v.name || ''}" required>`)}${field('Email (for the invite)', html`<input type="email" name="email" value="${v.email || ''}">`)}
      ${field('Team', html`<select name="team_id">${options(st.levels.flatMap((l) => l.teams.map((t) => [t.id, t.name === l.name ? t.name : `${l.name} ${t.name}`])), v.team_id ?? '', { blank: '—' })}</select>`)}
      ${field('Jersey', html`<input type="number" name="jersey" value="${v.jersey ?? ''}" min="0" max="99">`)}${field('Class year', html`<input type="number" name="class_year" value="${v.class_year ?? ''}">`)}
      ${field('Primary position group', html`<select name="primary_group">${options([...new Set(codes.map((c) => c.code))], v.primary_group || v.positions[0] || '', { blank: '—' })}</select>`, 'The one group this athlete sits in for lifting, attendance and reports')}
      ${field('Hand', html`<select name="hand">${options(['Right', 'Left', 'Both'], v.hand || 'Right')}</select>`)}
      ${field('Height (inches)', html`<input type="number" name="height" value="${v.height ?? ''}">`)}${ctx.me.caps['body.view'] ? field('Weight (lb)', html`<input type="number" name="weight" value="${v.weight ?? ''}">`) : ''}${field('Measured on', html`<input type="date" name="measured_on" value="${todayISO()}">`)}
    </div>
    ${field('Units', html`<div class="row">${Object.entries(UNIT).map(([k, l]) => html`<label class="check"><input type="checkbox" name="units" data-multi value="${k}" ${checked(v.units.includes(k))}> ${l}</label>`)}</div>`)}
    ${field('Positions', html`<div class="row">${['offense', 'defense', 'special'].map((u) => html`<div><span class="faint" style="font-size:11px">${UNIT[u]}</span><br>${codes.filter((c) => c.unit === u).map((c) => html`<label class="check" style="margin-right:8px"><input type="checkbox" name="positions" data-multi value="${c.code}" ${checked(v.positions.includes(c.code))}> ${c.code}</label>`)}</div>`)}</div>`)}
    </form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => {
      const f = formData(r.querySelector('#pf'));
      f.team_id = f.team_id ? Number(f.team_id) : null;
      const res = p ? await api.put(`/api/players/${p.id}`, f) : await api.post('/api/players', f);
      if (res.warning) toast(res.warning, 'warn'); else toast('Saved');
      if (!p) ctx.navigate(`/players/${res.id}`); else ctx.reload();
    } }],
  });
}

function importDialog(ctx) {
  let rows = [];
  const m = modal({
    title: 'Import roster from a spreadsheet', wide: true,
    body: html`<p>Upload a CSV file (save your spreadsheet as CSV). Columns: <span class="mono">name, grade (or class_year), position, jersey, team, email, parent_name, parent_email, parent_phone, parent2_name, parent2_email, parent2_phone, units, height, weight, hand</span>. Grade can be 9 to 12 or Fr, So, Jr, Sr. Positions can be separated by spaces or slashes; the first is the primary group. Each parent listed gets an invite and is linked to the player (up to 2).</p>
      <div class="row"><input type="file" accept=".csv,text/csv" id="file" style="width:auto"><button class="sm" id="tpl">Download template</button></div><div id="prev" style="margin-top:12px"></div>`,
    actions: [{ label: 'Cancel' }, { label: 'Import', primary: true, onClick: async () => {
      if (!rows.length) { toast('Choose a file first', 'warn'); return false; }
      const r = await api.post('/api/players/import', { rows });
      toast(`Imported ${r.created} player(s)${r.errors.length ? `, ${r.errors.length} skipped` : ''}`, r.errors.length ? 'warn' : '');
      if (r.errors.length) modal({ title: 'Rows that were skipped', body: html`<ul>${r.errors.map((e) => html`<li>Row ${e.row}: ${e.error}</li>`)}</ul>`, actions: [{ label: 'OK' }] });
      ctx.reload();
    } }],
  });
  m.root.querySelector('#tpl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['name,grade,position,jersey,team,email,parent_name,parent_email,parent_phone,parent2_name,parent2_email,parent2_phone,height,weight,hand\nJordan Smith,10,WR RET,12,JV Red,,Lisa Smith,lsmith@example.com,555-0101,,,,70,165,Right\n'], { type: 'text/csv' })); a.download = 'roster-template.csv'; a.click(); };
  m.root.querySelector('#file').onchange = async (e) => {
    const text = await e.target.files[0].text();
    rows = parseCSV(text);
    set(m.root.querySelector('#prev'), rows.length ? html`<p><b>${rows.length}</b> rows found.</p><div class="tbl-wrap" style="max-height:240px"><table><thead><tr>${Object.keys(rows[0]).map((k) => html`<th>${k}</th>`)}</tr></thead><tbody>${rows.slice(0, 20).map((r) => html`<tr>${Object.values(r).map((v) => html`<td>${v}</td>`)}</tr>`)}</tbody></table></div>` : html`<div class="notice warn">No rows found.</div>`);
  };
}

function rollover(ctx, st, list) {
  const year = new Date().getFullYear();
  modal({
    title: 'Season rollover', wide: true,
    body: html`<p>Move players up a level and archive graduates. Archived players keep their history; their access ends.</p>
      <form id="rf">${field('Archive players with class year up to', html`<input type="number" name="grad" value="${year}">`)}
      ${field('Start a new season (optional)', html`<input name="new_season" placeholder="Fall ${year + 1}">`, 'Every athlete’s tests, PRs and attendance rate for this season are saved to their history first.')}
      <h4 style="margin:10px 0 6px">Move teams</h4>${st.levels.flatMap((l) => l.teams.map((t) => html`<div class="inline-input" style="margin-bottom:6px"><span style="width:140px">${l.name} ${t.name === l.name ? '' : t.name}</span><span>→</span><select name="to_${t.id}">${options(st.levels.flatMap((x) => x.teams.map((y) => [y.id, y.name === x.name ? y.name : `${x.name} ${y.name}`])), '', { blank: 'Stay' })}</select></div>`))}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Run rollover', danger: true, onClick: async (r) => {
      const f = formData(r.querySelector('#rf'));
      const moves = [];
      for (const [k, v] of Object.entries(f)) if (k.startsWith('to_') && v) for (const p of list.filter((x) => x.team_id === Number(k.slice(3)) && (!f.grad || x.class_year > f.grad))) moves.push({ player_id: p.id, team_id: Number(v) });
      const res = await api.post('/api/players/rollover', { moves, graduating_class: f.grad, new_season: f.new_season ? { name: f.new_season } : null });
      toast(`Saved ${res.snapshot?.athletes ?? 0} season records. Moved ${res.moved}, archived ${res.archived}`); ctx.reload();
    } }],
  });
}

async function profile(el, ctx, id) {
  const p = await api.get(`/api/players/${id}`);
  const st = await api.get('/api/structure');
  const staff = ctx.me.caps.staff; const self = ctx.me.user.id === id;
  const mine = self || ctx.me.linked.some((x) => x.id === id);
  const edit = ctx.me.caps['roster.edit'];
  ctx.setTitle(p.name);
  const hist = (kind) => (p.measurements || []).filter((m) => m.kind === kind);
  const fmtH = (h) => (h ? `${Math.floor(h / 12)}'${h % 12}"` : '—');
  set(el, html`<div class="page-head"><div class="row" style="gap:14px">${avatar(p.name, p.photo, 'lg')}<div><h1>${p.name} ${p.jersey != null ? html`<span class="muted">#${p.jersey}</span>` : ''}</h1>
    <div class="sub">${[p.team, p.units?.map((u) => UNIT[u]).join(', '), p.positions?.join(', '), p.class_year ? `Class of ${p.class_year}` : null].filter(Boolean).join(' · ')}</div>
    <div class="row" style="margin-top:6px">${availBadge(p.availability)}${p.return_date ? html`<span class="muted">back ${fmtDate(p.return_date)}</span>` : ''}${p.archived ? html`<span class="badge">Archived</span>` : ''}</div></div></div>
    <div class="actions"><a class="btn" href="/players">Roster</a>
      ${staff && ctx.me.caps['season.view'] ? html`<a class="btn" href="/development/player/${id}">Development</a>` : ''}
      ${ctx.me.caps['availability.edit'] ? html`<button id="av">Set availability</button>` : ''}
      ${edit ? html`<button class="primary" id="edit">Edit details</button>` : ''}
      ${ctx.me.caps.admin ? html`<button id="arch">${p.archived ? 'Restore' : 'Archive'}</button><button class="danger" id="purge">Delete data</button>` : ''}</div></div>
  <div class="grid g-side">
    <div class="stack">
      <div class="card"><div class="hd"><h2>Profile</h2><span class="r faint" style="font-size:12px">Coach-set fields are locked to coaches</span></div><div class="bd"><dl class="kv">
        <dt>Team</dt><dd>${p.team || '—'}</dd><dt>Units</dt><dd>${(p.units || []).map((u) => UNIT[u]).join(', ') || '—'}</dd><dt>Positions</dt><dd>${(p.positions || []).join(', ') || '—'}</dd>
        <dt>Jersey</dt><dd>${p.jersey ?? '—'}</dd><dt>Class</dt><dd>${p.class_year || '—'}</dd>
        ${p.hand !== undefined ? html`<dt>Hand</dt><dd>${p.hand || '—'}</dd>` : ''}
        ${p.height !== undefined ? html`<dt>Height</dt><dd>${fmtH(p.height)}</dd>` : ''}${p.weight !== undefined ? html`<dt>Weight</dt><dd>${p.weight ? `${p.weight} lb` : '—'}</dd>` : ''}
        ${p.avail_note ? html`<dt>Availability note</dt><dd>${p.avail_note}</dd>` : ''}
        ${p.email && staff ? html`<dt>Account</dt><dd>${p.joined ? 'Joined' : html`Invited <button class="sm" id="reinv">Resend invite</button>`}</dd>` : ''}
      </dl></div></div>
      ${p.personal ? html`<div class="card"><div class="hd"><h2>About</h2></div><div class="bd">
        ${self ? html`<form id="me"><div class="fields">${[['nickname', 'Nickname'], ['hometown', 'Hometown'], ['pronouns', 'Pronouns'], ['favorite_player', 'Favorite player'], ['walkup_song', 'Walk-up song']].map(([k, l]) => field(l, html`<input name="${k}" value="${p.personal[k] || ''}" maxlength="200">`))}</div>
          ${field('Goals for the season', html`<textarea name="goals">${p.personal.goals || ''}</textarea>`)}
          <div class="row"><button class="primary">Save</button><label class="btn">Change photo<input type="file" accept="image/*" id="photo" hidden></label>${p.photo ? html`<button type="button" id="nophoto">Remove photo</button>` : ''}</div></form>`
        : html`<dl class="kv">${Object.entries(p.personal).filter(([, v]) => v).map(([k, v]) => html`<dt>${cap(k)}</dt><dd>${v}</dd>`)}</dl>${!Object.values(p.personal).some(Boolean) ? html`<p class="muted">Nothing added yet.</p>` : ''}${edit && p.photo ? html`<button class="sm" id="rmphoto">Remove photo</button>` : ''}`}
      </div></div>` : ''}
      ${p.measurements ? html`<div class="card"><div class="hd"><h2>${hist('weight').length ? 'Height and weight over the season' : 'Height'}</h2></div><div class="bd">
        ${hist('weight').length ? lineChart([{ label: 'Weight (lb)', points: hist('weight').map((m) => [m.date, m.value]) }]) : ''}
        <div class="s muted">Height: ${hist('height').map((m) => `${fmtH(m.value)} on ${fmtDate(m.date, { dow: false })}`).join(' · ') || '—'}</div>
      </div></div>` : ''}
    </div>
    <div class="stack">
      ${p.parents ? html`<div class="card"><div class="hd"><h2>Parents and guardians</h2></div>${p.parents.length ? html`<ul class="list">${p.parents.map((x) => html`<li><span class="grow">${x.name}</span><span class="s">${x.relation}</span>${x.pending ? html`<span class="badge warn">Invited</span>` : html`<span class="badge ok">Joined</span>`}</li>`)}</ul>` : empty('No parents connected. Players invite up to 2.')}</div>` : ''}
      <div id="fbx" class="stack"></div>
      ${mine || staff ? html`<div class="card"><div class="hd"><h2>Equipment</h2><span class="r"><a href="/equipment${staff ? `?player=${id}` : ''}">Details</a></span></div><div class="bd" id="eq"><span class="muted">Loading…</span></div></div>` : ''}
    </div>
  </div>`);
  import('./fb-profile.js').then((m) => m.profileExtras($('#fbx', el), ctx, p)).catch(() => {}); // C-20, C-24, F-12, F-13, F-18
  if ($('#eq', el)) api.get(`/api/eq/player/${id}`).then((items) => set($('#eq', el), items.filter((i) => !i.returned_at).length ? html`<ul class="list" style="margin:-14px">${items.filter((i) => !i.returned_at).map((i) => html`<li><span class="grow">${i.type_name}${i.serial ? ` ${i.serial}` : ''}</span><span class="s">${i.size || ''}</span></li>`)}</ul>` : html`<span class="muted">Nothing issued.</span>`)).catch(() => {});
  if ($('#edit', el)) $('#edit', el).onclick = () => playerForm(ctx, st, p);
  if ($('#av', el)) $('#av', el).onclick = () => modal({
    title: 'Set availability', body: html`<form id="af">${field('Status', html`<select name="availability">${options([['available', 'Full'], ['limited', 'Limited'], ['out', 'Out'], ['cleared', 'Cleared']], p.availability)}</select>`)}
      ${field('Expected return date', html`<input type="date" name="return_date" value="${p.return_date || ''}">`)}${field('Note (staff and player only)', html`<input name="note" value="${p.avail_note || ''}" placeholder="No contact; cleared for walkthrough">`, 'Keep it to availability. Detailed medical records do not belong here.')}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => { await api.put(`/api/players/${id}/availability`, formData(r.querySelector('#af'))); toast('Availability updated; staff notified'); ctx.reload(); } }],
  });
  if ($('#me', el)) {
    $('#me', el).onsubmit = async (e) => { e.preventDefault(); try { await api.put(`/api/players/${id}`, { personal: formData(e.target) }); toast('Saved'); } catch (err) { errToast(err); } };
    $('#photo', el).onchange = async (e) => { try { const url = await readFileAsDataURL(e.target.files[0]); await api.put(`/api/players/${id}`, { photo: url }); ctx.reload(); } catch (err) { errToast(err); } };
    if ($('#nophoto', el)) $('#nophoto', el).onclick = async () => { await api.put(`/api/players/${id}`, { photo: null }); ctx.reload(); };
  }
  if ($('#rmphoto', el)) $('#rmphoto', el).onclick = async () => { await api.put(`/api/players/${id}`, { remove_photo: true }); toast('Photo removed'); ctx.reload(); };
  if ($('#reinv', el)) $('#reinv', el).onclick = async () => { const r = await api.post(`/api/players/${id}/invite`); modal({ title: 'Invite link', body: html`<p>The invite was emailed. You can also share this link:</p><input readonly value="${location.origin}/invite/${r.invite_code}">`, actions: [{ label: 'Done' }] }); };
  if ($('#arch', el)) $('#arch', el).onclick = async () => { if (await confirmDialog(p.archived ? 'Restore this player to the roster?' : 'Archive this player? Their access ends now and their history is kept.')) { await api.post(`/api/players/${id}/archive`, { archived: !p.archived }); ctx.reload(); } };
  if ($('#purge', el)) $('#purge', el).onclick = async () => { if (await confirmDialog('Permanently delete this player and their records at the school’s request? This cannot be undone.', { danger: true, ok: 'Delete permanently' })) { await api.del(`/api/players/${id}`); toast('Player data deleted'); ctx.navigate('/players'); } };
}

async function teams(el, ctx) {
  const [st, groups, list] = await Promise.all([api.get('/api/structure'), api.get('/api/groups'), api.get('/api/players')]);
  const admin = ctx.me.caps.admin; const edit = ctx.me.caps['roster.edit'];
  const count = (tid) => list.filter((p) => p.team_id === tid).length;
  set(el, html`<div class="page-head"><div><h1>Players</h1><div class="sub">Program → level → teams → players. Position lists are editable for your program.</div></div></div>${rtabs('teams', ctx)}
  <div class="grid g3">
    <div class="card"><div class="hd"><h2>Levels and teams</h2><span class="r">${admin ? html`<button class="sm" id="addl">Add level</button>` : ''}</span></div>
      ${st.levels.map((l) => html`<div style="border-bottom:1px solid var(--border)"><div class="row" style="padding:9px 14px"><b>${l.name}</b><span class="spacer"></span>${edit ? html`<button class="sm" data-addt="${l.id}">Add team</button>` : ''}${admin ? html`<button class="sm ghost danger" data-dell="${l.id}">✕</button>` : ''}</div>
        <ul class="list">${l.teams.map((t) => html`<li><span class="grow">${t.name}</span><a class="s" href="/players?team_id=${t.id}">${count(t.id)} players</a>${edit ? html`<button class="sm ghost" data-rent="${t.id}" data-name="${t.name}">Rename</button><button class="sm ghost danger" data-delt="${t.id}">✕</button>` : ''}</li>`)}</ul></div>`)}
    </div>
    <div class="card"><div class="hd"><h2>Positions</h2><span class="r">${admin ? html`<button class="sm" id="addp">Add position</button>` : ''}</span></div>
      ${['offense', 'defense', 'special'].map((u) => html`<div style="padding:9px 14px;border-bottom:1px solid var(--border)"><h4 style="margin-bottom:6px">${UNIT[u]}</h4><div class="row">${st.positions.filter((p) => p.unit === u).map((p) => html`<span class="badge">${p.code}${admin ? html` <a href="#" data-delp="${p.id}" style="color:inherit">✕</a>` : ''}</span>`)}</div></div>`)}
    </div>
    <div class="card"><div class="hd"><h2>Custom groups</h2><span class="r">${edit ? html`<button class="sm" id="addg">New group</button>` : ''}</span></div>
      ${groups.length ? html`<ul class="list">${groups.map((g) => html`<li><div class="grow"><div class="t">${g.name}</div><div class="s">${g.members.map((m) => m.name).join(', ') || 'No members'}</div></div>${edit ? html`<button class="sm" data-editg="${g.id}">Edit</button>` : ''}</li>`)}</ul>` : empty('Create groups such as Captains to use as audiences.')}
    </div>
  </div>`);
  const ask = (title, label, value, fn) => modal({ title, body: html`<form id="x">${field(label, html`<input name="v" value="${value || ''}" required>`)}</form>`, actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => { await fn(formData(r.querySelector('#x')).v); ctx.reload(); } }] });
  if ($('#addl', el)) $('#addl', el).onclick = () => ask('Add level', 'Level name', '', (v) => api.post('/api/levels', { name: v }));
  on(el, 'click', '[data-addt]', (e, b) => ask('Add team', 'Team name', '', (v) => api.post('/api/teams', { name: v, level_id: Number(b.dataset.addt) })));
  on(el, 'click', '[data-rent]', (e, b) => ask('Rename team', 'Team name', b.dataset.name, (v) => api.put(`/api/teams/${b.dataset.rent}`, { name: v })));
  on(el, 'click', '[data-delt]', async (e, b) => { try { await api.del(`/api/teams/${b.dataset.delt}`); ctx.reload(); } catch (err) { errToast(err); } });
  on(el, 'click', '[data-dell]', async (e, b) => { if (await confirmDialog('Delete this level and its teams?', { danger: true, ok: 'Delete' })) { try { await api.del(`/api/levels/${b.dataset.dell}`); ctx.reload(); } catch (err) { errToast(err); } } });
  on(el, 'click', '[data-delp]', async (e, b) => { e.preventDefault(); await api.del(`/api/positions/${b.dataset.delp}`); ctx.reload(); });
  if ($('#addp', el)) $('#addp', el).onclick = () => modal({ title: 'Add position', body: html`<form id="x"><div class="fields">${field('Code', html`<input name="code" required placeholder="SLOT">`)}${field('Unit', html`<select name="unit">${options(Object.entries(UNIT))}</select>`)}</div></form>`, actions: [{ label: 'Cancel' }, { label: 'Add', primary: true, onClick: async (r) => { await api.post('/api/positions', formData(r.querySelector('#x'))); ctx.reload(); } }] });
  const groupForm = (g) => {
    const m = modal({ title: g ? `Edit ${g.name}` : 'New group', wide: true, body: html`<form id="gf">${field('Name', html`<input name="name" value="${g?.name || ''}" required>`)}
      <input type="search" placeholder="Filter players" id="gq" style="margin-bottom:6px"><div style="max-height:300px;overflow-y:auto;columns:2">${list.map((p) => html`<label class="check" style="display:flex" data-n="${p.name.toLowerCase()}"><input type="checkbox" name="members" data-multi data-num value="${p.id}" ${checked(g?.members.some((x) => x.id === p.id))}> ${p.name} <span class="faint">${p.jersey ?? ''}</span></label>`)}</div></form>`,
    actions: [...(g ? [{ label: 'Delete group', danger: true, onClick: async () => { await api.del(`/api/groups/${g.id}`); ctx.reload(); } }] : []), { label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#gf')); if (g) await api.put(`/api/groups/${g.id}`, f); else await api.post('/api/groups', f); ctx.reload(); } }] });
    m.root.querySelector('#gq').oninput = (e) => m.root.querySelectorAll('[data-n]').forEach((l) => { l.style.display = l.dataset.n.includes(e.target.value.toLowerCase()) ? 'flex' : 'none'; });
  };
  if ($('#addg', el)) $('#addg', el).onclick = () => groupForm(null);
  on(el, 'click', '[data-editg]', (e, b) => groupForm(groups.find((g) => g.id === Number(b.dataset.editg))));
}
