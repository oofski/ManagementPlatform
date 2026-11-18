// Health and safety: availability board (F-10), heat-acclimatization log and schedule (F-11),
// concussion return-to-play tracker (F-12). Coaches see the stage; medical notes are for the trainer only.
import { api } from '../api.js';
import { html, set, $, on, modal, toast, formData, field, options, fmtDate, fmtDT, ago, empty, tabs, todayISO, availBadge } from '../ui.js';
import { fbMe, bar6 } from './fb-profile.js';

const EQUIP = [['helmet', 'Helmet only'], ['shells', 'Helmet and shoulder pads'], ['full', 'Full pads']];
const EQL = Object.fromEntries(EQUIP);

export default async function safety(el, ctx) {
  const tab = ctx.query.tab || 'availability';
  const head = html`<div class="page-head"><div><h1>Health and safety</h1><div class="sub">Availability, heat acclimatization and return to play.</div></div></div>
    ${tabs([['availability', 'Availability', '/safety'], ['heat', 'Heat acclimatization', '/safety?tab=heat'], ['concussion', 'Return to play', '/safety?tab=concussion']], tab)}`;
  const me = await fbMe();
  if (tab === 'heat') return heat(el, ctx, head, me);
  if (tab === 'concussion') return concussion(el, ctx, head, me);
  return availability(el, ctx, head);
}

async function availability(el, ctx, head) {
  const list = await api.get('/api/players');
  const flagged = list.filter((p) => p.availability !== 'available');
  const by = (a) => flagged.filter((p) => p.availability === a);
  const canEdit = ctx.me.caps['availability.edit'];
  const section = (a, title, note) => html`<div class="card"><div class="hd"><h2>${title}</h2><span class="r">${availBadge(a)} <span class="faint" style="font-size:12px">${by(a).length}</span></span></div>
    ${by(a).length ? html`<ul class="list">${by(a).map((p) => html`<li class="click" onclick="__navigate('/players/${p.id}')"><span class="grow"><span class="t">${p.jersey != null ? `#${p.jersey} ` : ''}${p.name}</span><span class="s"> · ${p.team || ''} · ${p.positions.join('/')}</span></span>
      <span class="s">${p.return_date ? `back ${fmtDate(p.return_date)}` : ''}</span>${canEdit ? html`<button class="sm" data-av="${p.id}" onclick="event.stopPropagation()">Change</button>` : ''}</li>`)}</ul>` : empty(note)}</div>`;
  set(el, html`${head}<p class="muted">Limited athletes are flagged on the roster, on the lift and on the practice run sheet. Set a status from the player profile or here.</p>
    <div class="grid g3">${section('limited', 'Limited', 'No limited athletes.')}${section('out', 'Out', 'No one is out.')}${section('cleared', 'Cleared to return', 'No recent clearances.')}</div>`);
  on(el, 'click', '[data-av]', (e, b) => {
    const p = list.find((x) => x.id === Number(b.dataset.av));
    modal({ title: `Availability: ${p.name}`, body: html`<form id="af">${field('Status', html`<select name="availability">${options([['available', 'Full'], ['limited', 'Limited'], ['out', 'Out'], ['cleared', 'Cleared']], p.availability)}</select>`)}
      ${field('Expected return date', html`<input type="date" name="return_date" value="${p.return_date || ''}">`)}${field('Note (staff and player only)', html`<input name="note" placeholder="No contact; cleared for walkthrough">`)}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => { await api.put(`/api/players/${p.id}/availability`, formData(r.querySelector('#af'))); toast('Saved'); ctx.reload(); } }] });
  });
}

export function heatBanner(c) {
  if (!c || (!c.active && !c.warnings?.length)) return '';
  return html`<div class="notice ${c.warnings.some((w) => w.level === 'bad') ? 'bad' : c.warnings.length ? 'warn' : ''}">
    ${c.active ? html`<b>Heat acclimatization day ${c.day}:</b> ${c.rule.note || `${EQL[c.rule.equipment]}, up to ${c.rule.max_practices} practice(s) and ${c.rule.max_minutes} minutes`}.` : ''}
    ${c.warnings.length ? html`<ul style="margin:4px 0 0 18px;padding:0">${c.warnings.map((w) => html`<li>${w.text}</li>`)}</ul>` : c.active ? ' This plan is within the schedule.' : ''}</div>`;
}

async function heat(el, ctx, head, me) {
  const [d, st] = await Promise.all([api.get('/api/fb/heat'), api.get('/api/structure')]);
  const teams = st.levels.flatMap((l) => l.teams.map((t) => [t.id, t.name === l.name ? t.name : `${l.name} ${t.name}`]));
  const admin = ctx.me.caps.admin;
  set(el, html`${head}
    ${heatBanner(d.today)}
    <div class="grid g-side">
      <div class="stack" style="min-width:0">
        ${me.heat_log ? html`<div class="card"><div class="hd"><h2>Log a reading</h2></div><div class="bd"><form id="hf"><div class="fields">
          ${field('Date', html`<input type="date" name="date" value="${todayISO()}" required>`)}
          ${field('Reading', html`<select name="reading_type">${options([['wbgt', 'WBGT (°F)'], ['heat_index', 'Heat index (°F)']], 'wbgt')}</select>`)}
          ${field('Value', html`<input type="number" step="0.1" name="reading" required inputmode="decimal">`)}
          ${field('Duration (min)', html`<input type="number" name="duration_min" min="0">`)}
          ${field('Equipment', html`<select name="equipment">${options(EQUIP, '')}</select>`)}
          ${field('Team', html`<select name="team_id">${options(teams, '', { blank: 'All' })}</select>`)}
        </div>${field('Notes', html`<input name="notes" placeholder="Extra water breaks, moved indoors">`)}<button class="primary">Save reading</button></form></div></div>` : ''}
        <div class="card"><div class="hd"><h2>Log</h2><span class="r faint" style="font-size:12px">since ${fmtDate(d.from, { dow: false })}</span></div><div class="bd flush tbl-wrap"><table><thead><tr><th>Date</th><th>Day</th><th>Reading</th><th class="num">Min</th><th>Equipment</th><th>Team</th><th>By</th><th></th></tr></thead><tbody>
          ${d.logs.map((l) => html`<tr><td>${fmtDate(l.date)}</td><td>${l.day ?? '—'}</td><td>${l.reading_type === 'wbgt' ? 'WBGT' : 'Heat index'} ${l.reading}${(d.limits[l.reading_type] && l.reading >= d.limits[l.reading_type].stop) ? html` <span class="badge bad">Stop</span>` : (d.limits[l.reading_type] && l.reading >= d.limits[l.reading_type].caution) ? html` <span class="badge warn">Caution</span>` : ''}</td>
            <td class="num">${l.duration_min ?? ''}</td><td>${EQL[l.equipment] || '—'}${l.over ? html` <span class="badge bad">Over schedule</span>` : ''}</td><td class="s">${l.team_name || 'All'}</td><td class="s">${l.by_name || ''}</td>
            <td>${me.heat_log ? html`<button class="sm ghost" data-del="${l.id}" aria-label="Delete">✕</button>` : ''}</td></tr>`)}
        </tbody></table>${!d.logs.length ? empty('No readings logged yet.') : ''}</div></div>
      </div>
      <div class="card" style="min-width:0"><div class="hd"><h2>State schedule</h2>${admin ? html`<span class="r"><button class="sm" id="edit">Edit</button></span>` : ''}</div><div class="bd">
        <p class="muted">${d.start_date ? html`Day 1 was ${fmtDate(d.start_date, { year: true })}.` : 'Set the first practice date to turn on day-by-day checks.'} Practice plans show a warning when a day goes over the schedule.</p>
        <div class="tbl-wrap"><table><thead><tr><th>Days</th><th>Equipment</th><th class="num">A day</th><th class="num">Max min</th><th>Contact</th></tr></thead><tbody>
          ${d.schedule.map((r) => html`<tr><td style="white-space:nowrap">${r.from}–${r.to}</td><td>${({ helmet: 'Helmet', shells: 'Shells', full: 'Full pads' })[r.equipment] || r.equipment}</td><td class="num">${r.max_practices}</td><td class="num">${r.max_minutes}</td><td>${r.contact ? 'Yes' : 'No'}</td></tr>`)}</tbody></table></div>
        <p class="help" style="margin-top:8px">Limits: heat index caution ${d.limits.heat_index?.caution}, stop ${d.limits.heat_index?.stop} · WBGT caution ${d.limits.wbgt?.caution}, stop ${d.limits.wbgt?.stop}. Use your state association's rules.</p>
      </div></div>
    </div>`);
  if ($('#hf', el)) $('#hf', el).onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api.post('/api/fb/heat', formData(e.target)); toast(r.check.warnings.length ? r.check.warnings[0].text : 'Saved', r.check.warnings.length ? 'warn' : ''); ctx.reload(); } catch (err) { toast(err.message, 'bad'); }
  };
  on(el, 'click', '[data-del]', async (e, b) => { await api.del(`/api/fb/heat/${b.dataset.del}`); ctx.reload(); });
  if ($('#edit', el)) $('#edit', el).onclick = () => modal({
    title: 'Heat acclimatization schedule', wide: true,
    body: html`<form id="sf">${field('Day 1 (first practice)', html`<input type="date" name="start" value="${d.start_date || ''}">`)}
      <div class="tbl-wrap"><table><thead><tr><th>From day</th><th>To day</th><th>Equipment</th><th>Practices a day</th><th>Max minutes</th><th>Contact</th><th>Note</th></tr></thead><tbody>
      ${d.schedule.map((r, i) => html`<tr data-i="${i}"><td><input type="number" data-k="from" value="${r.from}" style="width:60px"></td><td><input type="number" data-k="to" value="${r.to}" style="width:60px"></td>
        <td><select data-k="equipment">${options(EQUIP, r.equipment)}</select></td><td><input type="number" data-k="max_practices" value="${r.max_practices}" style="width:60px"></td>
        <td><input type="number" data-k="max_minutes" value="${r.max_minutes}" style="width:70px"></td><td><input type="checkbox" data-k="contact" ${r.contact ? 'checked' : ''}></td><td><input data-k="note" value="${r.note || ''}"></td></tr>`)}</tbody></table></div></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => {
      const rows = [...r.querySelectorAll('tr[data-i]')].map((tr) => Object.fromEntries([...tr.querySelectorAll('[data-k]')].map((x) => [x.dataset.k, x.type === 'checkbox' ? x.checked : x.type === 'number' ? Number(x.value) : x.value])));
      await api.put('/api/program', { settings: { heat_start_date: r.querySelector('[name=start]').value || null, heat_schedule: rows } });
      toast('Schedule saved'); ctx.reload();
    } }],
  });
}

async function concussion(el, ctx, head, me) {
  const [cases, players] = await Promise.all([api.get('/api/fb/concussions'), api.get('/api/players')]);
  const active = cases.filter((c) => c.status === 'active'); const closed = cases.filter((c) => c.status !== 'active');
  const canOpen = ctx.me.caps['availability.edit'] || me.medical;
  const caseCard = (c) => html`<div class="card"><div class="hd"><h2><a href="/players/${c.player_id}">${c.jersey != null ? `#${c.jersey} ` : ''}${c.player}</a></h2><span class="r">${c.status === 'active' ? html`<span class="badge bad">Out</span>` : html`<span class="badge ok">Cleared ${fmtDate(c.closed_at)}</span>`}</span></div><div class="bd">
    <p><b>Stage ${c.stage} of ${c.stages}:</b> ${c.stage_label}${c.status !== 'active' ? ' (complete)' : ''}</p>${bar6(c.status === 'active' ? c.stage : c.stages + 1, c.stages)}
    <p class="s muted" style="margin-top:8px">Injured ${fmtDate(c.injury_date, { year: true })}${c.signoffs.length ? ` · last sign-off ${c.signoffs[c.signoffs.length - 1].signed_by}, ${ago(c.signoffs[c.signoffs.length - 1].signed_at)}` : ''}</p>
    ${c.notes ? html`<h4 style="margin:10px 0 4px">Medical notes</h4>${c.notes.length ? html`<ul class="list" style="margin:0 -14px">${c.notes.map((n) => html`<li><div class="grow"><div class="t" style="white-space:pre-wrap;font-weight:400">${n.note}</div><div class="s">Stage ${n.stage} · ${n.by_name} · ${fmtDT(n.at)}</div></div></li>`)}</ul>` : html`<p class="muted">None.</p>`}` : ''}
    </div>${me.medical && c.status === 'active' ? html`<div class="ft"><button class="primary sm" data-adv="${c.id}">${c.stage >= c.stages ? 'Sign off and clear to play' : `Sign off stage ${c.stage}`}</button><button class="sm" data-note="${c.id}">Add note</button></div>` : ''}</div>`;
  set(el, html`${head}
    <div class="row" style="margin-bottom:12px"><p class="muted grow" style="margin:0">${me.medical ? 'You are a designated medical professional: you sign off each stage and keep the medical notes.' : 'Coaches see the stage only. The athletic trainer signs off each stage; medical notes stay with the trainer.'} The athlete stays out until the last stage is signed off.</p>
      ${canOpen ? html`<button class="primary" id="open">Start protocol</button>` : ''}</div>
    <div class="grid g2">${active.map(caseCard)}</div>${!active.length ? empty('No athletes are in the protocol.') : ''}
    ${closed.length ? html`<h4 style="margin:18px 0 8px">Completed</h4><div class="grid g2">${closed.slice(0, 10).map(caseCard)}</div>` : ''}`);
  if ($('#open', el)) $('#open', el).onclick = () => modal({
    title: 'Start return-to-play protocol', body: html`<form id="of">${field('Athlete', html`<select name="player_id">${options(players.map((p) => [p.id, `${p.name}${p.jersey != null ? ` #${p.jersey}` : ''}`]))}</select>`)}
      ${field('Date of injury', html`<input type="date" name="injury_date" value="${todayISO()}">`)}
      ${me.medical ? field('Medical note', html`<textarea name="note" rows="3"></textarea>`) : html`<p class="help">The athlete is set to Out right away and the athletic trainer is notified.</p>`}</form>`,
    actions: [{ label: 'Cancel' }, { label: 'Start', primary: true, onClick: async (r) => { const f = formData(r.querySelector('#of')); f.player_id = Number(f.player_id); await api.post('/api/fb/concussions', f); toast('Protocol started; athlete set to Out'); ctx.reload(); } }],
  });
  on(el, 'click', '[data-adv]', (e, b) => {
    const c = cases.find((x) => x.id === Number(b.dataset.adv));
    modal({ title: `Sign off stage ${c.stage}: ${c.stage_label}`, body: html`<form id="nf">${field('Medical note (optional)', html`<textarea name="note" rows="3"></textarea>`)}<p class="help">${c.stage >= c.stages ? 'This completes the protocol and sets the athlete to Cleared.' : `Moves ${c.player} to stage ${c.stage + 1}.`}</p></form>`,
      actions: [{ label: 'Cancel' }, { label: 'Sign off', primary: true, onClick: async (r) => { await api.post(`/api/fb/concussions/${c.id}/advance`, formData(r.querySelector('#nf'))); toast('Signed off'); ctx.reload(); } }] });
  });
  on(el, 'click', '[data-note]', (e, b) => modal({ title: 'Medical note', body: html`<form id="nf"><textarea name="note" rows="4" required></textarea></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async (r) => { await api.post(`/api/fb/concussions/${b.dataset.note}/notes`, formData(r.querySelector('#nf'))); ctx.reload(); } }] }));
}
