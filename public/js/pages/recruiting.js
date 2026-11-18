// F-18 recruiting profile: verified testing results, PRs, GPA, film, contact; coach approval;
// one-page printable export for seniors.
import { api } from '../api.js';
import { html, set, $, modal, toast, formData, field, fmtDate, empty, avatar, raw } from '../ui.js';
import { icon } from '../icons.js';

const STATUS = { draft: ['', 'Draft'], pending: ['warn', 'Waiting for coach approval'], approved: ['ok', 'Approved'] };
const badge = (s) => html`<span class="badge ${STATUS[s]?.[0] || ''}">${STATUS[s]?.[1] || s}</span>`;

export default async function recruiting(el, ctx) {
  if (ctx.params.id) return profile(el, ctx, Number(ctx.params.id));
  if (!ctx.me.caps.staff) return ctx.navigate(`/recruiting/${ctx.me.user.id}`, { replace: true });
  const list = await api.get('/api/fb/recruiting');
  set(el, html`<div class="page-head"><div><h1>Recruiting</h1><div class="sub">Seniors and juniors. A coach approves each profile before it can be exported.</div></div></div>
    <div class="card"><div class="bd flush tbl-wrap"><table><thead><tr><th class="num">#</th><th>Athlete</th><th>Class</th><th>Positions</th><th class="num">GPA</th><th>Film</th><th>Status</th></tr></thead><tbody>
    ${list.map((r) => html`<tr class="click" onclick="__navigate('/recruiting/${r.id}')"><td class="num">${r.jersey ?? ''}</td><td><b>${r.name}</b>${r.senior ? html` <span class="badge">Senior</span>` : ''}</td><td>${r.class_year || ''}</td><td>${r.positions.join(', ')}</td>
      <td class="num">${r.gpa ?? ''}</td><td>${r.film_url ? 'Yes' : html`<span class="faint">—</span>`}</td><td>${badge(r.status)}</td></tr>`)}
    </tbody></table>${!list.length ? empty('No seniors or juniors on the roster.') : ''}</div></div>`);
}

async function profile(el, ctx, id) {
  const r = await api.get(`/api/fb/recruiting/${id}`);
  const p = r.player;
  ctx.setTitle(`Recruiting: ${p.name}`);
  const ht = p.height ? `${Math.floor(p.height / 12)}'${p.height % 12}"` : '—';
  set(el, html`<div class="page-head no-print"><div><h1>${p.name}</h1><div class="sub">Recruiting profile ${badge(r.status)}${r.approved_by ? html` <span class="muted">· approved by ${r.approved_by} ${fmtDate(r.approved_at)}</span>` : ''}</div></div>
    <div class="actions">${ctx.me.caps.staff ? html`<a class="btn" href="/recruiting">All profiles</a>` : ''}
      ${r.can_edit ? html`<button id="edit">Edit</button>` : ''}
      ${r.can_approve && r.status !== 'approved' ? html`<button class="primary" id="approve">Approve</button>` : ''}
      ${r.can_approve && r.status === 'approved' ? html`<button id="unapprove">Withdraw approval</button>` : ''}
      <button id="print" ${r.status === 'approved' ? '' : raw('disabled title="A coach approves the profile first"')}>${icon('printer', 14)} Export PDF</button></div></div>
    ${r.status !== 'approved' ? html`<div class="notice warn no-print">This profile can be exported after a coach approves it. Any edit sends it back for approval.</div>` : ''}
    <div class="card fb-onepage"><div class="bd">
      <div class="row" style="gap:14px;align-items:flex-start;margin-bottom:12px">${avatar(p.name, p.photo, 'lg')}
        <div class="grow"><h1 style="font-size:22px">${p.name}${p.jersey != null ? html` <span class="muted">#${p.jersey}</span>` : ''}</h1>
          <div>${[p.positions.join(' / '), p.class_year ? `Class of ${p.class_year}` : null, r.program?.school].filter(Boolean).join(' · ')}</div>
          <div class="muted">${[r.program?.name, p.team].filter(Boolean).join(' · ')}</div></div>
        <dl class="kv" style="min-width:180px"><dt>Height</dt><dd>${ht}</dd>${p.weight ? html`<dt>Weight</dt><dd>${p.weight} lb</dd>` : ''}<dt>GPA</dt><dd>${r.gpa ?? '—'}</dd></dl></div>
      ${r.bio ? html`<p>${r.bio}</p>` : ''}
      <div class="grid g2">
        <div><h4 style="margin-bottom:6px">Verified testing</h4>${r.tests.length ? html`<table><tbody>${r.tests.map((t) => html`<tr><td>${t.label}</td><td class="num"><b>${t.value}</b> ${t.unit}</td><td class="s">${fmtDate(t.date, { year: true, dow: false })}${t.verified ? html` · verified by ${t.by_name}` : ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">No tests recorded.</p>`}</div>
        <div><h4 style="margin-bottom:6px">Lifting maxes (coach-recorded)</h4>${r.lifts.length ? html`<table><tbody>${r.lifts.map((l) => html`<tr><td>${l.name}</td><td class="num"><b>${l.weight}</b> lb</td></tr>`)}</tbody></table>` : html`<p class="muted">No coach-recorded maxes.</p>`}</div>
      </div>
      <div class="grid g2" style="margin-top:12px">
        <div><h4 style="margin-bottom:6px">Film</h4>${r.film_url ? html`<a href="${r.film_url}" target="_blank" rel="noopener">${r.film_url}</a>` : html`<span class="muted">—</span>`}</div>
        <div><h4 style="margin-bottom:6px">Contact</h4><div>${r.contact_email || ''}${r.contact_phone ? ` · ${r.contact_phone}` : ''}</div>
          ${r.coach ? html`<div class="muted">Coach: ${r.coach.name}${r.coach.title ? `, ${r.coach.title}` : ''}${r.coach.email ? ` · ${r.coach.email}` : ''}</div>` : ''}</div>
      </div>
      <p class="faint" style="font-size:11px;margin-top:14px">Testing results come from the program's testing records${r.approved_by ? `; profile approved by ${r.approved_by}` : ''}.</p>
    </div></div>`);
  if ($('#print', el)) $('#print', el).onclick = () => window.print();
  if ($('#approve', el)) $('#approve', el).onclick = async () => { await api.post(`/api/fb/recruiting/${id}/approve`, { approve: true }); toast('Approved'); ctx.reload(); };
  if ($('#unapprove', el)) $('#unapprove', el).onclick = async () => { await api.post(`/api/fb/recruiting/${id}/approve`, { approve: false }); ctx.reload(); };
  if ($('#edit', el)) $('#edit', el).onclick = () => modal({
    title: 'Edit recruiting profile', wide: true,
    body: html`<form id="rf"><div class="fields">${field('GPA', html`<input type="number" step="0.01" min="0" max="5" name="gpa" value="${r.gpa ?? ''}">`)}${field('Film link', html`<input type="url" name="film_url" value="${r.film_url || ''}" placeholder="https://">`)}
      ${field('Contact email', html`<input type="email" name="contact_email" value="${r.contact_email || ''}">`)}${field('Contact phone', html`<input type="tel" name="contact_phone" value="${r.contact_phone || ''}">`)}</div>
      ${field('Short bio', html`<textarea name="bio" rows="3" maxlength="1200">${r.bio || ''}</textarea>`)}<p class="help">Testing results and PRs come from the testing records and cannot be edited here.</p></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (m) => { const f = formData(m.querySelector('#rf')); f.gpa = f.gpa === '' ? null : f.gpa; await api.put(`/api/fb/recruiting/${id}`, f); toast('Saved; waiting for coach approval'); ctx.reload(); } }],
  });
}
