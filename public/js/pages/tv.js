// C-14 TV and whiteboard display: the day's workout in big type for the weight-room screen. Read-only, refreshes itself.
import { api } from '../api.js';
import { html, set, $, options, empty, fmtDate, fmtTime, nowISO } from '../ui.js';
import { icon } from '../icons.js';

export default async function tv(el, ctx) {
  let q = { assignment_id: ctx.query.assignment || '', week: ctx.query.week || '', day: ctx.query.day || '', group: ctx.query.group || '' };
  let groups = [];
  try { const m = await api.get('/api/strength/meta'); groups = [...m.groups.map((g) => [`pg:${g}`, `${g} group`]), ...m.teams.map((t) => [`team:${t.id}`, t.name])]; } catch { /* keep going */ }
  let timer = null; let clock = null;
  const draw = async () => {
    if (!document.body.contains(el)) { clearInterval(timer); clearInterval(clock); return; }
    let r;
    try { r = await api.get(`/api/strength/tv?${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v)))}`); } catch (e) {
      if (!$('.wr-tv', el)) set(el, html`<div class="wr-full wr-tv"><div class="wr-body">${empty(e.status === 403 ? 'The TV display is for staff accounts.' : 'Waiting for the connection…')}</div></div>`);
      return;
    }
    if (!r.day) { set(el, html`<div class="wr-full wr-tv"><div class="wr-bar"><b>TV display</b><span class="spacer"></span><a class="btn" href="/weights">Exit</a></div><div class="wr-body">${empty('No programs are assigned yet.')}</div></div>`); return; }
    set(el, html`<div class="wr-full wr-tv"><div class="wr-bar no-print"><select id="ta">${options(r.assignments.map((a) => [a.id, `${a.program_name} · ${a.audience_labels.join(', ')}`]), r.assignment.id)}</select>
        <select id="td">${options(r.days.map((d) => [`${d.week}:${d.day}`, `W${d.week}D${d.day}${d.label ? ` ${d.label}` : ''}${d.due ? ` · ${fmtDate(d.due, { dow: false })}` : ''}`]), `${r.day.week}:${r.day.day}`)}</select>
        <select id="tg"><option value="">Everyone</option>${options(groups, q.group)}</select><span class="spacer"></span><button id="fs">${icon('external', 14)} Full screen</button><a class="btn" href="/weights">Exit</a></div>
      <div class="wr-tv-head"><div><div class="wr-tv-k">${r.assignment.audience_labels.join(', ')}${r.group ? ` · ${r.group}` : ''}</div><h1>${r.day.label || `Week ${r.day.week}, day ${r.day.day}`}</h1><div class="wr-tv-k">${r.assignment.program_name} · week ${r.day.week}, day ${r.day.day}${r.day.due ? ` · ${fmtDate(r.day.due)}` : ''}</div></div>
        <div class="wr-tv-clock" id="clk">${fmtTime(nowISO())}</div></div>
      ${r.game_week ? html`<div class="wr-tv-banner">${r.game_week.label}${r.game_week.next_game ? ` · ${r.game_week.next_game.title}` : ''}</div>` : ''}
      <div class="wr-tv-main"><ol class="wr-tv-list">${r.exercises.map((x) => html`<li><div class="wr-tv-ex">${x.name}</div><div class="wr-tv-rx">${x.sets} × ${x.reps || ''}${x.pct ? html` <span>@ ${x.pct}%</span>` : ''}${x.rpe ? html` <span>RPE ${x.rpe}</span>` : ''}${x.rest ? html` <span>rest ${x.rest}</span>` : ''}</div>
          ${x.note ? html`<div class="wr-tv-note">${x.note}</div>` : ''}${(x.variants || []).map((v) => html`<div class="wr-tv-var"><b>${v.group}:</b> ${v.text}</div>`)}</li>`)}</ol>
        ${r.prs.length ? html`<aside class="wr-tv-side"><div class="wr-tv-k">Recent PRs and milestones</div><ul>${r.prs.map((p) => html`<li>${p}</li>`)}</ul></aside>` : ''}</div>
      <div class="wr-tv-foot">Loads are on each athlete's phone or the station tablet. Updated ${fmtTime(r.at)}.</div></div>`);
    $('#ta', el).onchange = (e) => { q = { assignment_id: e.target.value, week: '', day: '', group: q.group }; draw(); };
    $('#td', el).onchange = (e) => { const [w, d] = e.target.value.split(':'); q = { ...q, week: w, day: d }; draw(); };
    $('#tg', el).onchange = (e) => { q = { ...q, group: e.target.value }; draw(); };
    $('#fs', el).onclick = () => { const f = $('.wr-tv', el); (f.requestFullscreen || f.webkitRequestFullscreen || (() => {})).call(f); };
  };
  await draw();
  timer = setInterval(draw, 60000);
  clock = setInterval(() => { if (!document.body.contains(el)) { clearInterval(timer); clearInterval(clock); return; } const c = $('#clk', el); if (c) c.textContent = fmtTime(nowISO()); }, 10000);
}
