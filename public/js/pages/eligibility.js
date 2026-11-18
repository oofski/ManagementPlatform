// F-13 eligibility roster (who is cleared, expiring physicals) and F-14 digital forms with parent e-signature.
import { api } from '../api.js';
import { html, set, $, $$, on, modal, toast, errToast, formData, field, options, fmtDate, fmtDT, empty, tabs, todayISO } from '../ui.js';
import { fbMe, eligibilityForm, eligBadge } from './fb-profile.js';

const ITEMS = [['physical', 'Physical'], ['consent', 'Consent'], ['emergency_contact', 'Emergency'], ['insurance', 'Insurance'], ['fees_paid', 'Fees'], ['academic', 'Academic']];

export default async function eligibility(el, ctx) {
  if (!ctx.me.caps.staff) return parentForms(el, ctx);
  if (ctx.route === '/forms' || ctx.query.tab === 'forms') return staffForms(el, ctx);
  return roster(el, ctx);
}
const etabs = (a) => tabs([['roster', 'Checklist', '/eligibility'], ['forms', 'Forms and signatures', '/forms']], a);

async function roster(el, ctx) {
  const q = ctx.query;
  const [r, st, me] = await Promise.all([api.get('/api/fb/eligibility'), api.get('/api/structure'), fbMe()]);
  const teams = st.levels.flatMap((l) => l.teams.map((t) => [t.id, t.name === l.name ? t.name : `${l.name} ${t.name}`]));
  let list = r.players;
  if (q.team_id) list = list.filter((p) => p.team_id === Number(q.team_id));
  if (q.status === 'cleared') list = list.filter((p) => p.cleared);
  if (q.status === 'not_cleared') list = list.filter((p) => !p.cleared);
  if (q.status === 'expiring') list = list.filter((p) => p.expiring);
  if (q.status === 'expired') list = list.filter((p) => p.expired);
  if (q.missing) list = list.filter((p) => !p.items[q.missing]);
  if (q.q) list = list.filter((p) => p.name.toLowerCase().includes(q.q.toLowerCase()) || String(p.jersey) === q.q);
  const all = r.players;
  const sum = { cleared: all.filter((p) => p.cleared).length, not: all.filter((p) => !p.cleared).length, expiring: all.filter((p) => p.expiring).length, expired: all.filter((p) => p.expired).length };
  set(el, html`<div class="page-head"><div><h1>Eligibility</h1><div class="sub">Physical, parent consent, emergency contact, insurance, fees and academic status for every athlete. Physicals are flagged ${r.warn_days} days before they expire.</div></div></div>
    ${etabs('roster')}
    <div class="grid g4" style="margin-bottom:12px">
      <div class="card stat"><div class="k">Cleared</div><div class="v" style="color:var(--ok)">${sum.cleared}</div><div class="d">of ${all.length} athletes</div></div>
      <div class="card stat"><div class="k">Not cleared</div><div class="v" style="color:var(--bad)">${sum.not}</div><div class="d"><a href="/eligibility?status=not_cleared">Show</a></div></div>
      <div class="card stat"><div class="k">Physicals expiring</div><div class="v" style="color:var(--warn)">${sum.expiring}</div><div class="d"><a href="/eligibility?status=expiring">Show</a></div></div>
      <div class="card stat"><div class="k">Physicals expired</div><div class="v" style="color:var(--bad)">${sum.expired}</div><div class="d"><a href="/eligibility?status=expired">Show</a></div></div>
    </div>
    <div class="filters">
      <input type="search" id="q" placeholder="Name or number" value="${q.q || ''}">
      <select data-f="team_id"><option value="">All teams</option>${options(teams, q.team_id)}</select>
      <select data-f="status">${options([['', 'Any status'], ['cleared', 'Cleared'], ['not_cleared', 'Not cleared'], ['expiring', 'Physical expiring'], ['expired', 'Physical expired']], q.status || '')}</select>
      <select data-f="missing">${options([['', 'Missing anything'], ...ITEMS.map(([k, l]) => [k, `Missing: ${l.toLowerCase()}`])], q.missing || '')}</select>
    </div>
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th class="num">#</th><th>Athlete</th><th>Team</th>${ITEMS.map(([, l]) => html`<th>${l}</th>`)}<th>Physical expires</th><th>Status</th>${me.eligibility_edit ? html`<th></th>` : ''}</tr></thead><tbody>
    ${list.map((p) => html`<tr><td class="num">${p.jersey ?? ''}</td><td><a href="/players/${p.player_id}"><b>${p.name}</b></a></td><td class="s">${p.team || ''}</td>
      ${ITEMS.map(([k]) => html`<td><span class="dot ${p.items[k] ? 'ok' : 'bad'}" title="${p.items[k] ? 'Done' : 'Missing'}"></span>${k === 'academic' && p.academic && p.academic !== 'eligible' ? html` <span class="s">${p.academic}</span>` : ''}</td>`)}
      <td class="s">${p.physical_expires ? html`${fmtDate(p.physical_expires, { year: true, dow: false })} ${p.expired ? html`<span class="badge bad">Expired</span>` : p.expiring ? html`<span class="badge warn">Soon</span>` : ''}` : html`<span class="faint">None on file</span>`}</td>
      <td>${eligBadge(p)}</td>${me.eligibility_edit ? html`<td><button class="sm" data-edit="${p.player_id}">Edit</button></td>` : ''}</tr>`)}
    </tbody></table>${!list.length ? empty('No athletes match these filters.') : ''}</div></div>`);
  const go = (patch) => ctx.navigate('/eligibility?' + new URLSearchParams(Object.fromEntries(Object.entries({ ...q, ...patch }).filter(([, v]) => v))));
  $$('[data-f]', el).forEach((s) => { s.onchange = () => go({ [s.dataset.f]: s.value }); });
  $('#q', el).onchange = (e) => go({ q: e.target.value });
  on(el, 'click', '[data-edit]', (e, b) => { const p = all.find((x) => x.player_id === Number(b.dataset.edit)); eligibilityForm(ctx, p.player_id, p.name, p, () => ctx.reload()); });
}

async function staffForms(el, ctx) {
  const forms = await api.get('/api/fb/forms');
  const admin = ctx.me.caps.admin;
  set(el, html`<div class="page-head"><div><h1>Eligibility</h1><div class="sub">Parents sign these in the app with a typed name and a drawn signature. Signing updates the checklist.</div></div>
    <div class="actions">${admin ? html`<button class="primary" id="new">New form</button>` : ''}</div></div>${etabs('forms')}
    <div class="card"><ul class="list">${forms.map((f) => html`<li><div class="grow"><div class="t">${f.title} <span class="badge">${f.kind === 'consent' ? 'Consent' : f.kind === 'emergency' ? 'Emergency contact' : 'Other'}</span></div>
      <div class="s">${f.signed} of ${f.total} athletes signed</div></div><button class="sm" data-sigs="${f.id}">Signatures</button>${admin ? html`<button class="sm" data-editf="${f.id}">Edit</button>` : ''}</li>`)}</ul>
      ${!forms.length ? empty('No forms yet.') : ''}</div>`);
  const formDialog = (f) => modal({
    title: f ? `Edit ${f.title}` : 'New form', wide: true,
    body: html`<form id="ff">${f ? '' : field('Kind', html`<select name="kind">${options([['consent', 'Consent (checks Parent consent)'], ['emergency', 'Emergency contact (checks Emergency contact)'], ['other', 'Other']])}</select>`)}
      ${field('Title', html`<input name="title" value="${f?.title || ''}" required>`)}${field('Text parents agree to', html`<textarea name="body" rows="10">${f?.body || ''}</textarea>`)}</form>`,
    actions: [...(f ? [{ label: 'Retire form', danger: true, onClick: async () => { await api.put(`/api/fb/forms/${f.id}`, { active: false }); ctx.reload(); } }] : []), { label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => {
      const d = formData(r.querySelector('#ff'));
      if (f) await api.put(`/api/fb/forms/${f.id}`, d); else await api.post('/api/fb/forms', d);
      ctx.reload();
    } }],
  });
  if ($('#new', el)) $('#new', el).onclick = () => formDialog(null);
  on(el, 'click', '[data-editf]', (e, b) => formDialog(forms.find((f) => f.id === Number(b.dataset.editf))));
  on(el, 'click', '[data-sigs]', async (e, b) => {
    try {
      const rows = await api.get(`/api/fb/forms/${b.dataset.sigs}/signatures`);
      modal({ title: 'Signatures', wide: true, body: rows.length ? html`<div class="tbl-wrap"><table><thead><tr><th>Athlete</th><th>Signed by</th><th>Typed name</th><th>Signature</th><th>When</th><th>IP address</th></tr></thead><tbody>
        ${rows.map((s) => html`<tr><td>${s.player}</td><td>${s.signer}</td><td>${s.typed_name}</td><td><img src="${s.signature}" alt="Signature" style="height:32px;max-width:140px;background:#fff;border:1px solid var(--line)"></td><td class="s">${fmtDT(s.signed_at)}</td><td class="s mono">${s.ip || ''}</td></tr>`)}</tbody></table></div>` : empty('No signatures yet.'), actions: [{ label: 'Close' }] });
    } catch (err) { errToast(err); }
  });
}

async function parentForms(el, ctx) {
  const forms = await api.get('/api/fb/forms');
  const parent = ctx.me.user.role === 'parent';
  set(el, html`<div class="page-head"><div><h1>Forms</h1><div class="sub">${parent ? 'Sign each form once per season for each athlete. Your typed name, signature, the time and your IP address are saved with the form.' : 'A parent or guardian signs these forms for you.'}</div></div></div>
    ${forms.length ? forms.map((f) => html`<div class="card" style="margin-bottom:12px"><div class="hd"><h2>${f.title}</h2></div><div class="bd">
      <div style="white-space:pre-wrap;max-height:160px;overflow-y:auto;margin-bottom:10px" class="muted">${f.body || ''}</div>
      <ul class="list" style="margin:0 -14px -14px">${(f.children || []).map((c) => html`<li><span class="grow t">${c.name}</span>${c.signed_at ? html`<span class="badge ok">Signed ${fmtDate(c.signed_at)}</span><span class="s">${c.signer || ''}</span>` : html`<span class="badge warn">Not signed</span>`}
        ${parent ? html`<button class="sm ${c.signed_at ? '' : 'primary'}" data-sign="${f.id}" data-pid="${c.player_id}">${c.signed_at ? 'Sign again' : 'Sign'}</button>` : ''}</li>`)}</ul></div></div>`) : empty('No forms to sign right now.')}`);
  on(el, 'click', '[data-sign]', (e, b) => signDialog(ctx, forms.find((f) => f.id === Number(b.dataset.sign)), Number(b.dataset.pid)));
}

function signDialog(ctx, f, playerId) {
  const child = f.children.find((c) => c.player_id === playerId);
  let drawn = false;
  const m = modal({
    title: `${f.title}: ${child.name}`, wide: true,
    body: html`<div style="white-space:pre-wrap;max-height:200px;overflow-y:auto;border:1px solid var(--line);border-radius:var(--r);padding:10px;margin-bottom:12px">${f.body || ''}</div>
      <form id="sf">
      ${f.kind === 'emergency' ? html`<div class="fields">
        ${field('Emergency contact name', html`<input name="contact_name" required>`)}${field('Phone', html`<input name="contact_phone" type="tel" required>`)}${field('Relationship', html`<input name="relation" placeholder="Parent, aunt, neighbor">`)}
        ${field('Second contact (optional)', html`<input name="contact2_name">`)}${field('Second phone', html`<input name="contact2_phone" type="tel">`)}
        ${field('Physician', html`<input name="physician">`)}${field('Physician phone', html`<input name="physician_phone" type="tel">`)}
        ${field('Allergies', html`<input name="allergies">`)}${field('Medications', html`<input name="medications">`)}</div>` : ''}
      ${field('Type your full name', html`<input name="typed_name" value="${ctx.me.user.name}" required autocomplete="name">`)}
      <div class="field"><label>Draw your signature</label><canvas id="sig" class="fb-sig" width="600" height="160" aria-label="Signature pad"></canvas>
        <div class="row" style="margin-top:4px"><span class="help">Use your finger or mouse. Signed ${todayISO()}.</span><span class="spacer"></span><button type="button" class="sm ghost" id="clr">Clear</button></div></div>
      <label class="check"><input type="checkbox" name="agree"> I am ${child.name}’s parent or guardian and I agree to this form.</label></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Sign form', primary: true, onClick: async (r) => {
      const d = formData(r.querySelector('#sf'));
      if (!drawn) { toast('Draw your signature first', 'warn'); return false; }
      const { typed_name, agree, ...rest } = d;
      await api.post(`/api/fb/forms/${f.id}/sign`, { player_id: playerId, typed_name, agree: !!agree, signature: r.querySelector('#sig').toDataURL('image/png'), data: rest });
      toast('Signed. Thank you.'); ctx.reload();
    } }],
  });
  const c = m.root.querySelector('#sig'); const g = c.getContext('2d');
  g.lineWidth = 2.4; g.lineCap = 'round'; g.strokeStyle = '#17171a';
  let down = false;
  const pt = (e) => { const b = c.getBoundingClientRect(); return [((e.clientX - b.left) / b.width) * c.width, ((e.clientY - b.top) / b.height) * c.height]; };
  c.addEventListener('pointerdown', (e) => { down = true; c.setPointerCapture(e.pointerId); const [x, y] = pt(e); g.beginPath(); g.moveTo(x, y); e.preventDefault(); });
  c.addEventListener('pointermove', (e) => { if (!down) return; const [x, y] = pt(e); g.lineTo(x, y); g.stroke(); drawn = true; e.preventDefault(); });
  c.addEventListener('pointerup', () => { down = false; });
  m.root.querySelector('#clr').onclick = () => { g.clearRect(0, 0, c.width, c.height); drawn = false; };
}
