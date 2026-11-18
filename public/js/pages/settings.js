// Program settings (head coach), staff and roles, audit log, email outbox, and personal account.
import { api } from '../api.js';
import { html, set, $, on, modal, toast, errToast, formData, options, checked, field, fmtDT, ago, cap, empty, confirmDialog, tabs, ROLE, UNIT } from '../ui.js';

export default async function settings(el, ctx) {
  const r = ctx.route;
  if (r === '/account') return account(el, ctx);
  if (!ctx.me.caps.admin && !ctx.me.caps['audit.view']) return account(el, ctx);
  const t = tabs([...(ctx.me.caps.admin ? [['program', 'Program rules', '/settings'], ['staff', 'Staff and roles', '/settings/staff']] : []), ['audit', 'Audit log', '/settings/audit'], ...(ctx.me.caps.admin ? [['outbox', 'Email outbox', '/settings/outbox']] : []), ['account', 'My account', '/account']],
    r === '/settings/staff' ? 'staff' : r === '/settings/audit' ? 'audit' : r === '/settings/outbox' ? 'outbox' : 'program');
  if (r === '/settings/audit' || !ctx.me.caps.admin) return audit(el, ctx, t);
  if (r === '/settings/staff') return staff(el, ctx, t);
  if (r === '/settings/outbox') return outbox(el, ctx, t);
  return program(el, ctx, t);
}

async function program(el, ctx, t) {
  const p = await api.get('/api/program');
  const s = p.settings;
  const yn = (k, label, help) => html`<div class="field"><label class="check"><input type="checkbox" name="${k}" ${checked(s[k])}> ${label}</label>${help ? html`<div class="help">${help}</div>` : ''}</div>`;
  set(el, html`<div class="page-head"><div><h1>Settings</h1><div class="sub">The head coach controls what each role can see and share.</div></div><div class="actions"><button class="primary" id="save">Save settings</button></div></div>${t}
  <form id="sf"><div class="grid g2">
    <div class="card"><div class="hd"><h2>Program</h2></div><div class="bd"><div class="fields">${field('Program name', html`<input name="name" value="${p.name}">`)}${field('School', html`<input name="school" value="${p.school || ''}">`)}${field('State', html`<input name="state" value="${p.state || ''}" maxlength="5">`)}</div></div></div>
    <div class="card"><div class="hd"><h2>Messaging (minors)</h2></div><div class="bd"><div class="fields">${field('Messages delivered from', html`<input type="time" name="quiet_start" value="${s.quiet_start}">`)}${field('until', html`<input type="time" name="quiet_end" value="${s.quiet_end}">`)}</div>
      <div class="help" style="margin-bottom:10px">Coach messages to players and parents outside these hours wait until morning. Emergency alerts always go through. Follow your school or district policy.</div>
      ${yn('chat_files', 'Allow photos and files in chats')}${yn('parent_absence_notice', 'Notify parents when a player is marked absent (unexcused)')}</div></div>
    <div class="card"><div class="hd"><h2>Playbook access</h2></div><div class="bd">
      ${field('Coaches', html`<select name="coach_playbook">${options([['edit', 'View and edit'], ['view', 'View only'], ['none', 'No access']], s.coach_playbook)}</select>`)}
      ${yn('coach_export_plays', 'Coaches can export and print plays (watermarked and logged)')}${yn('trainer_playbook', 'Trainers can view the playbook')}
      ${field('Game mode (set by your state’s rules)', html`<select name="game_mode">${options([['booth_halftime', 'Booth and locker room only (for example Texas UIL)'], ['sideline', 'Sideline allowed (NFHS 1.6.1.2 limits apply)'], ['off', 'Off']], s.game_mode)}</select>`, 'Confirm the current rule book and your state association’s rules before using game mode.')}</div></div>
    <div class="card"><div class="hd"><h2>Sharing with players</h2></div><div class="bd">${yn('players_see_ratings', 'Players can see their own practice ratings')}${yn('players_see_trends', 'Players can see their own trend charts')}${yn('leaderboard', 'Show lifting and testing leaderboards to players', 'Body weight and body composition are never on leaderboards.')}${yn('trainer_ratings', 'Trainers can see player ratings')}
      ${field('Rating scale', html`<select name="rating_scale" data-num>${options([[5, '1 to 5'], [10, '1 to 10']], s.rating_scale)}</select>`)}</div></div>
    <div class="card"><div class="hd"><h2>Calendar and attendance</h2></div><div class="bd"><div class="fields">
      ${field('Alert after unexcused absences', html`<input type="number" name="absence_alert_threshold" value="${s.absence_alert_threshold}">`)}${field('Alert after lates', html`<input type="number" name="late_alert_threshold" value="${s.late_alert_threshold}">`)}
      ${field('Weekly practice limit (min)', html`<input type="number" name="weekly_practice_limit_min" value="${s.weekly_practice_limit_min ?? ''}">`)}${field('Weekly contact limit (min)', html`<input type="number" name="weekly_contact_limit_min" value="${s.weekly_contact_limit_min ?? ''}">`)}</div>
      <div class="help">Practice limits vary by state association; leave blank until you confirm yours. Plans show the week’s total against these.</div></div></div>
    <div class="card"><div class="hd"><h2>Equipment, security and records</h2></div><div class="bd"><div class="fields">
      ${field('Helmet age rule (years)', html`<input type="number" name="helmet_max_age_years" value="${s.helmet_max_age_years}">`)}${field('Recertify every (years)', html`<input type="number" name="helmet_recert_interval_years" value="${s.helmet_recert_interval_years}">`)}${field('Keep records for (years)', html`<input type="number" name="retention_years" value="${s.retention_years}">`)}</div>
      ${yn('staff_twofa', 'Require two-step verification for coaches and admins')}</div></div>
  </div></form>`);
  $('#save', el).onclick = async () => {
    const f = formData($('#sf', el));
    const settingsBody = {};
    for (const k of Object.keys(p.defaults)) if (k in f) settingsBody[k] = ['absence_alert_threshold', 'late_alert_threshold', 'helmet_max_age_years', 'helmet_recert_interval_years', 'retention_years', 'rating_scale'].includes(k) ? Number(f[k]) : ['weekly_practice_limit_min', 'weekly_contact_limit_min'].includes(k) ? (f[k] === '' ? null : Number(f[k])) : f[k];
    try { await api.put('/api/program', { name: f.name, school: f.school, state: f.state, settings: settingsBody }); await ctx.refreshMe(); toast('Settings saved'); } catch (err) { errToast(err); }
  };
}

const PERMS = [['calendar_edit', 'Edit calendar'], ['roster_edit', 'Edit roster'], ['practice_edit', 'Edit practice plans'], ['ratings', 'See ratings'], ['playbook', 'View playbook'], ['playbook_edit', 'Edit playbook'], ['playbook_export', 'Export plays'],
  ['equipment_manager', 'Equipment manager'], ['body_data', 'See body weight'], ['nutrition_pro', 'Approve meal plans'], ['messages', 'Send messages'], ['read_all_chats', 'Read all chats'], ['audit', 'Review audit log']];
async function staff(el, ctx, t) {
  const [list, auds] = await Promise.all([api.get('/api/staff'), api.get('/api/audiences')]);
  const scopeOpts = auds.filter((a) => ['Level', 'Team', 'Unit', 'Position group'].includes(a.kind));
  const label = (tok) => scopeOpts.find((a) => a.token === tok)?.label || tok;
  set(el, html`<div class="page-head"><div><h1>Settings</h1><div class="sub">${list.length} staff. Coaches edit events, plans and ratings for the groups they cover.</div></div><div class="actions"><button class="primary" id="inv">Invite staff</button></div></div>${t}
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Title</th><th>Covers</th><th>Extra access</th><th>Account</th><th></th></tr></thead><tbody>
    ${list.map((s) => html`<tr><td><b>${s.name}</b><div class="s muted">${s.email}</div></td><td>${ROLE[s.role]}${s.is_admin ? html` <span class="badge green">Admin</span>` : ''}</td><td>${s.title || ''}</td><td class="s">${s.scopes.map(label).join(', ') || (s.role === 'head_coach' ? 'Everything' : '—')}</td>
      <td class="s">${Object.entries(s.perms || {}).filter(([, v]) => v).map(([k]) => PERMS.find((p) => p[0] === k)?.[1] || k).join(', ')}</td><td>${s.pending ? html`<span class="badge warn">Invited</span>` : html`<span class="badge ok">Joined</span>`}</td>
      <td>${s.id !== ctx.me.user.id ? html`<button class="sm" data-e="${s.id}">Edit</button>` : ''}</td></tr>`)}</tbody></table></div></div>`);
  const form = (s = null) => modal({ title: s ? `Edit ${s.name}` : 'Invite staff', wide: true, body: html`<form id="sf"><div class="fields">${field('Name', html`<input name="name" value="${s?.name || ''}" required>`)}${!s ? field('Email', html`<input type="email" name="email" required>`) : ''}${field('Title', html`<input name="title" value="${s?.title || ''}" placeholder="LB coach">`)}
    ${field('Role', html`<select name="role">${options([['coach', 'Coach'], ['trainer', 'Trainer'], ['staff', 'Other staff (read-only)'], ['head_coach', 'Head coach']], s?.role || 'coach')}</select>`)}${field('Staff type', html`<select name="staff_kind">${options([['', '—'], ['athletic_director', 'Athletic director'], ['equipment_manager', 'Equipment manager'], ['team_manager', 'Team manager'], ['volunteer', 'Volunteer']], s?.staff_kind || '')}</select>`)}</div>
    <label class="check" style="margin-bottom:10px"><input type="checkbox" name="is_admin" ${checked(s?.is_admin)}> Admin (full access, like the head coach)</label>
    <div class="grid g2"><div>${field('Groups they cover', html`<div style="max-height:220px;overflow-y:auto;border:1px solid var(--border-strong);border-radius:5px;padding:6px 10px">${scopeOpts.map((a) => html`<label class="check" style="display:flex"><input type="checkbox" name="scopes" data-multi value="${a.token}" ${checked(s?.scopes.includes(a.token))}> ${a.kind}: ${a.label}</label>`)}</div>`)}</div>
    <div>${field('Extra access', html`${PERMS.map(([k, l]) => html`<label class="check" style="display:flex"><input type="checkbox" name="perm_${k}" ${checked(s?.perms?.[k])}> ${l}</label>`)}`)}</div></div></form>`,
  actions: [...(s ? [{ label: 'Remove from staff', danger: true, onClick: async () => { if (await confirmDialog(`Remove ${s.name}? Their access ends now.`, { danger: true, ok: 'Remove' })) { await api.del(`/api/staff/${s.id}`); ctx.reload(); } } }] : []), { label: 'Cancel' }, { label: s ? 'Save' : 'Send invite', primary: true, onClick: async (r) => {
    const f = formData(r.querySelector('#sf'));
    const perms = Object.fromEntries(PERMS.map(([k]) => [k, !!f[`perm_${k}`]]).filter(([, v]) => v));
    const body = { name: f.name, email: f.email, title: f.title, role: f.role, staff_kind: f.staff_kind || null, is_admin: f.is_admin, scopes: f.scopes, perms };
    if (s) { await api.put(`/api/staff/${s.id}`, body); toast('Saved'); } else { const res = await api.post('/api/staff', body); modal({ title: 'Invite sent', body: html`<p>An invite was emailed. You can also share this link:</p><input readonly value="${location.origin}/invite/${res.invite_code}">`, actions: [{ label: 'Done' }] }); }
    ctx.reload();
  } }] });
  $('#inv', el).onclick = () => form();
  on(el, 'click', '[data-e]', (e, b) => form(list.find((x) => x.id === Number(b.dataset.e))));
}

async function audit(el, ctx, t) {
  const q = ctx.query;
  const rows = await api.get(`/api/audit?${new URLSearchParams(q)}`);
  set(el, html`<div class="page-head"><div><h1>Settings</h1><div class="sub">Who viewed or changed sensitive records, and when.</div></div></div>${t}
    <div class="filters"><select id="ent">${options([['', 'All records'], ['event', 'Events'], ['player', 'Players'], ['play', 'Plays'], ['bodyweight', 'Body weight'], ['development', 'Development'], ['chat', 'Chats'], ['message', 'Messages'], ['eq_item', 'Equipment'], ['program', 'Settings'], ['user', 'Accounts']], q.entity || '')}</select><input id="act" placeholder="Action contains…" value="${q.action || ''}"></div>
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Detail</th></tr></thead><tbody>
    ${rows.map((a) => html`<tr><td class="s" style="white-space:nowrap">${fmtDT(a.at)}</td><td>${a.user_name || 'System'}</td><td>${cap(a.action)}</td><td class="s">${a.entity || ''} ${a.entity_id ?? ''}</td><td class="s mono" style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.detail ? JSON.stringify(a.detail) : ''}</td></tr>`)}</tbody></table>${!rows.length ? empty('No entries.') : ''}</div></div>`);
  const go = () => ctx.navigate('/settings/audit?' + new URLSearchParams(Object.fromEntries(Object.entries({ entity: $('#ent', el).value, action: $('#act', el).value }).filter(([, v]) => v))));
  $('#ent', el).onchange = go; $('#act', el).onchange = go;
}

async function outbox(el, ctx, t) {
  const rows = await api.get('/api/outbox');
  set(el, html`<div class="page-head"><div><h1>Settings</h1><div class="sub">Email the app has sent (invites, sign-in codes, alerts). Connect a mail provider for real delivery.</div></div></div>${t}
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Body</th><th>Delivers</th></tr></thead><tbody>
    ${rows.map((o) => html`<tr><td class="s" style="white-space:nowrap">${fmtDT(o.created_at)}</td><td class="s">${o.to_email}</td><td>${o.subject}</td><td class="s">${(o.body || '').slice(0, 120)}</td><td class="s">${o.deliver_at && o.deliver_at > o.created_at.replace(' ', 'T') ? fmtDT(o.deliver_at) : 'Now'}</td></tr>`)}</tbody></table>${!rows.length ? empty('No email yet.') : ''}</div></div>`);
}

async function account(el, ctx) {
  const me = await api.get('/api/me');
  const feed = await api.get('/api/calendar/feed-url');
  const player = me.user.role === 'player';
  set(el, html`<div class="page-head"><div><h1>My account</h1><div class="sub">${me.user.name} · ${ROLE[me.user.role]}${me.user.title ? ` · ${me.user.title}` : ''}</div></div></div>
  <div class="grid g2">
    <div class="card"><div class="hd"><h2>Account</h2></div><div class="bd"><form id="af">
      <dl class="kv" style="margin-bottom:12px"><dt>Email</dt><dd>${me.user.email || '—'}</dd><dt>Program</dt><dd>${me.program.name}</dd></dl>
      ${field('Phone (never shown to other members)', html`<input name="phone" value="${me.user.phone || ''}">`)}
      <label class="check" style="margin-bottom:12px"><input type="checkbox" name="notify_email" ${checked(me.user.notify_email)}> Also send notifications by email</label>
      ${field('New password', html`<input type="password" name="password" autocomplete="new-password" placeholder="Leave blank to keep">`)}
      <button class="primary">Save</button></form></div></div>
    <div class="stack">
      <div class="card"><div class="hd"><h2>Calendar subscription</h2></div><div class="bd"><p class="muted">Add to Google, Apple or Outlook calendar. Updates automatically.</p><input readonly value="${location.origin}${feed.path}"></div></div>
      ${player ? html`<div class="card"><div class="hd"><h2>Parents and guardians</h2><span class="r faint" style="font-size:12px">Up to 2</span></div>
        ${me.parents.length ? html`<ul class="list">${me.parents.map((p) => html`<li><span class="grow">${p.name}</span>${p.pending ? html`<span class="badge warn">Invited</span>` : html`<span class="badge ok">Joined</span>`}<button class="sm ghost danger" data-rm="${p.id}">Remove</button></li>`)}</ul>` : ''}
        ${me.parents.length < 2 ? html`<div class="bd"><form id="pf"><div class="fields">${field('Name', html`<input name="name" required>`)}${field('Email', html`<input type="email" name="email" required>`)}${field('Relation', html`<select name="relation">${options(['Parent', 'Guardian'])}</select>`)}</div><button class="primary">Invite</button></form></div>` : ''}</div>` : ''}
      <div class="card"><div class="hd"><h2>Notifications</h2></div><div class="bd row"><button id="test">Send me a test notification</button><button id="so">Sign out</button></div></div>
    </div></div>`);
  $('#af', el).onsubmit = async (e) => { e.preventDefault(); const f = formData(e.target); if (!f.password) delete f.password; try { await api.put('/api/me', f); toast('Saved'); } catch (err) { errToast(err); } };
  if ($('#pf', el)) $('#pf', el).onsubmit = async (e) => { e.preventDefault(); try { const r = await api.post('/api/me/parents', formData(e.target)); toast('Invite sent'); if (r.invite_code) modal({ title: 'Invite link', body: html`<p>We emailed the invite. You can also share this link:</p><input readonly value="${location.origin}/invite/${r.invite_code}">`, actions: [{ label: 'Done' }] }); ctx.reload(); } catch (err) { errToast(err); } };
  on(el, 'click', '[data-rm]', async (e, b) => { if (await confirmDialog('Disconnect this parent?')) { await api.del(`/api/me/parents/${b.dataset.rm}`); ctx.reload(); } });
  $('#so', el).onclick = async () => { await api.post('/api/auth/logout').catch(() => {}); location.href = '/'; };
  $('#test', el).onclick = async () => { await api.post('/api/notifications/test'); toast('Sent — check Alerts'); };
}
