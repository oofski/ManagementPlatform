// Player profile additions (attendance streak, return-to-play stage, eligibility checklist, emergency contact,
// season history, recruiting link) and the team join-code dialog on the roster.
import { api } from '../api.js';
import { html, set, on, modal, toast, formData, field, options, checked, fmtDate, ago } from '../ui.js';
import { icon } from '../icons.js';
import { playerAttendanceCard } from './fb-attendance.js';

let meCache = null;
export const fbMe = async () => (meCache ||= await api.get('/api/fb/me'));

export function renderQR(box, text, size = 200) {
  const go = () => { try { box.innerHTML = ''; new window.QRCode(box, { text, width: size, height: size }); } catch { /* typed code still works */ } };
  if (window.QRCode) return go();
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
  s.onload = go; s.onerror = () => { box.remove(); };
  document.head.appendChild(s);
}

// C-4: per-team join codes with QR; coaches rotate or disable them.
export async function joinCodesDialog() {
  const m = modal({ title: 'Team join codes', wide: true, body: html`<div id="jc"><span class="muted">Loading…</span></div>` });
  const box = m.root.querySelector('#jc');
  const draw = async () => {
    const list = await api.get('/api/fb/join-codes');
    set(box, html`<p class="muted">Athletes without a school email open <b>${location.origin}/join</b>, enter their team code, pick their name and choose a username. Rotate a code if it is shared outside the team.</p>
      <div class="tbl-wrap"><table><thead><tr><th>Team</th><th>Code</th><th class="num">Joined</th><th class="num">Waiting</th><th></th></tr></thead><tbody>
      ${list.map((t) => html`<tr><td><b>${t.team}</b></td><td>${t.code ? html`<span class="mono" style="font-size:15px;letter-spacing:.1em">${t.code.code}</span> ${t.code.active ? '' : html`<span class="badge">Disabled</span>`}` : html`<span class="faint">None</span>`}</td>
        <td class="num">${t.code?.uses ?? 0}</td><td class="num">${t.waiting}</td>
        <td style="white-space:nowrap">${t.code && t.code.active ? html`<button class="sm" data-qr="${t.code.code}" data-team="${t.team}">${icon('qr', 13)} QR</button>` : ''}
          <button class="sm" data-rot="${t.team_id}">${t.code ? 'Rotate' : 'Create code'}</button>
          ${t.code ? html`<button class="sm ghost" data-act="${t.code.id}" data-on="${t.code.active ? 0 : 1}">${t.code.active ? 'Disable' : 'Enable'}</button>` : ''}</td></tr>`)}
      </tbody></table></div>`);
  };
  await draw();
  on(box, 'click', '[data-rot]', async (e, b) => { await api.post('/api/fb/join-codes', { team_id: Number(b.dataset.rot) }); toast('New code created; the old code no longer works'); draw(); });
  on(box, 'click', '[data-act]', async (e, b) => { await api.put(`/api/fb/join-codes/${b.dataset.act}`, { active: b.dataset.on === '1' }); draw(); });
  on(box, 'click', '[data-qr]', (e, b) => {
    const url = `${location.origin}/join?code=${b.dataset.qr}`;
    const q = modal({ title: `Join ${b.dataset.team}`, body: html`<div style="text-align:center"><div id="qr" style="display:inline-block;background:#fff;padding:10px;min-height:20px"></div>
      <div class="mono" style="font-size:38px;font-weight:700;letter-spacing:.15em;margin:8px 0">${b.dataset.qr}</div><p class="muted">Scan, or open ${location.origin}/join and enter the code.</p></div>`,
    actions: [{ label: 'Print', onClick: () => { window.print(); return false; } }, { label: 'Close' }] });
    renderQR(q.root.querySelector('#qr'), url);
  });
}

const ELIG_LABELS = { physical: 'Physical on file', consent: 'Parent consent', emergency_contact: 'Emergency contact', insurance: 'Insurance', fees_paid: 'Fees paid', academic: 'Academic eligibility' };
export const eligBadge = (e) => (e.cleared ? html`<span class="badge ok">Cleared</span>` : html`<span class="badge bad">Not cleared</span>`);

export function eligibilityForm(ctx, playerId, name, e, done) {
  modal({
    title: `Eligibility: ${name}`, wide: true,
    body: html`<form id="ef"><div class="fields">
      ${field('Physical date', html`<input type="date" name="physical_date" value="${e.physical_date || ''}">`)}
      ${field('Physical expires', html`<input type="date" name="physical_expires" value="${e.physical_expires || ''}">`, 'Leave blank to use one year from the physical date')}
      ${field('Academic status', html`<select name="academic">${options([['eligible', 'Eligible'], ['probation', 'Probation'], ['ineligible', 'Ineligible']], e.academic || '', { blank: 'Not checked' })}</select>`)}
      ${field('Insurance note', html`<input name="insurance_note" value="${e.insurance_note || ''}">`)}${field('Fees note', html`<input name="fees_note" value="${e.fees_note || ''}">`)}
    </div>
    <div class="row" style="gap:16px;margin:6px 0 10px">${[['consent', 'Parent consent'], ['emergency_contact', 'Emergency contact'], ['insurance', 'Insurance'], ['fees_paid', 'Fees paid']].map(([k, l]) => html`<label class="check"><input type="checkbox" name="${k}" ${checked(e.items[k])}> ${l}</label>`)}</div>
    ${field('Notes', html`<input name="notes" value="${e.notes || ''}">`)}
    <p class="help">Consent and emergency contact are checked automatically when a parent signs the form.</p></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => {
      const f = formData(r.querySelector('#ef'));
      if (!f.physical_expires && f.physical_date) delete f.physical_expires;
      await api.put(`/api/fb/eligibility/${playerId}`, f); toast('Eligibility saved'); done();
    } }],
  });
}

export async function profileExtras(el, ctx, p) {
  if (!el) return;
  const staff = ctx.me.caps.staff;
  const mine = ctx.me.user.id === p.id || ctx.me.linked.some((x) => x.id === p.id);
  if (!staff && !mine) return;
  const me = await fbMe();
  const parts = [];
  const add = (key) => { const d = document.createElement('div'); d.dataset.part = key; el.appendChild(d); parts.push(d); return d; };
  // C-20 attendance streak and trend
  playerAttendanceCard(add('att'), p.id).catch(() => {});
  // F-12 return-to-play stage (coaches see the stage, not the medical notes)
  const cBox = add('rtp');
  api.get(`/api/fb/concussions?player_id=${p.id}&status=active`).then((list) => {
    const c = list[0]; if (!c) return;
    set(cBox, html`<div class="card"><div class="hd"><h2>Return to play</h2><span class="r"><span class="badge bad">Out</span></span></div><div class="bd">
      <p><b>Stage ${c.stage} of ${c.stages}:</b> ${c.stage_label}</p>${bar6(c.stage, c.stages)}
      <p class="muted" style="margin-top:8px">${me.medical ? html`<a href="/safety?tab=concussion">Open the case</a> to sign off a stage or add notes.` : 'Medical details are visible to the athletic trainer only.'}</p></div></div>`);
  }).catch(() => {});
  // F-13 eligibility
  if (me.eligibility_view || mine) {
    const eBox = add('elig');
    const loadElig = () => api.get(`/api/fb/eligibility/player/${p.id}`).then((e) => {
      set(eBox, html`<div class="card"><div class="hd"><h2>Eligibility</h2><span class="r">${eligBadge(e)} ${me.eligibility_edit ? html`<button class="sm" data-edit-elig>Edit</button>` : ''}</span></div>
        <ul class="list">${Object.entries(ELIG_LABELS).map(([k, l]) => html`<li><span class="dot ${e.items[k] ? 'ok' : 'bad'}"></span><span class="grow">${l}</span><span class="s">${!e.items[k] ? html`<span class="badge bad">Missing</span> ` : ''}${k === 'physical' && e.physical_expires ? html`${e.expired ? html`<span class="badge bad">Expired</span> ` : e.expiring ? html`<span class="badge warn">Expires soon</span> ` : ''}until ${fmtDate(e.physical_expires, { year: true })}` : k === 'academic' && e.academic ? e.academic : ''}</span></li>`)}</ul>
        ${!staff && !e.cleared && ctx.me.user.role === 'parent' ? html`<div class="ft"><a href="/forms">Sign the forms</a></div>` : ''}</div>`);
      const b = eBox.querySelector('[data-edit-elig]');
      if (b) b.onclick = () => eligibilityForm(ctx, p.id, p.name, e, loadElig);
    }).catch(() => {});
    loadElig();
  }
  // F-14 emergency contact from the signed form
  const emBox = add('em');
  api.get(`/api/fb/emergency/${p.id}`).then((s) => {
    if (!s) return;
    set(emBox, html`<div class="card"><div class="hd"><h2>Emergency contact</h2><span class="r faint" style="font-size:12px">signed ${ago(s.signed_at)}</span></div><div class="bd"><dl class="kv">
      <dt>Contact</dt><dd>${s.data.contact_name || '—'} ${s.data.relation ? html`<span class="muted">(${s.data.relation})</span>` : ''}</dd><dt>Phone</dt><dd>${s.data.contact_phone || '—'}</dd>
      ${s.data.contact2_name ? html`<dt>Second contact</dt><dd>${s.data.contact2_name} ${s.data.contact2_phone || ''}</dd>` : ''}
      ${s.data.allergies ? html`<dt>Allergies</dt><dd>${s.data.allergies}</dd>` : ''}${s.data.medications ? html`<dt>Medications</dt><dd>${s.data.medications}</dd>` : ''}</dl></div></div>`);
  }).catch(() => {});
  // C-24 season history
  const hBox = add('hist');
  api.get(`/api/fb/history/${p.id}`).then((rows) => {
    if (!rows.length) return;
    set(hBox, html`<div class="card"><div class="hd"><h2>Season history</h2></div><div class="bd flush tbl-wrap"><table><thead><tr><th>Season</th><th>Team</th><th class="num">Attendance</th><th>Best tests</th></tr></thead><tbody>
      ${rows.map((r) => html`<tr><td><b>${r.season_name}</b>${r.graduated ? html` <span class="badge">Graduated</span>` : ''}</td><td>${r.team || '—'}</td><td class="num">${r.attendance_rate == null ? '—' : `${r.attendance_rate}%`}</td>
        <td class="s">${Object.values(r.tests).map((t) => `${t.label} ${t.value}${t.unit ? ' ' + t.unit : ''}`).join(' · ') || '—'}</td></tr>`)}</tbody></table></div></div>`);
  }).catch(() => {});
  // F-18 recruiting profile link
  if (staff || mine) {
    const rBox = add('rec');
    set(rBox, html`<div class="card"><div class="bd row"><span>Recruiting profile${p.class_year ? html` <span class="muted">· class of ${p.class_year}</span>` : ''}</span><span class="spacer"></span><a class="btn sm" href="/recruiting/${p.id}">Open</a></div></div>`);
  }
}
const bar6 = (stage, n) => html`<div class="row" style="gap:3px;flex-wrap:nowrap">${Array.from({ length: n }, (_, i) => html`<span style="flex:1;height:6px;border-radius:3px;background:${i < stage - 1 ? 'var(--ok)' : i === stage - 1 ? 'var(--warn)' : 'var(--line)'}"></span>`)}</div>`;
export { bar6 };
