// C-18 daily wellness questionnaire for athletes (sleep, sleep quality, soreness, mood, stress) with a personal trend.
// Coaches use the Wellness tab of the weight room for the team dashboard.
import { api, uid } from '../api.js';
import { html, set, $, $$, on, toast, errToast, empty, fmtDate, lineChart, legend, todayISO } from '../ui.js';

const Q = [
  ['sleep_quality', 'How well did you sleep?', ['Very poorly', 'Poorly', 'OK', 'Well', 'Very well']],
  ['soreness', 'How sore are you?', ['Very sore', 'Sore', 'A little', 'Barely', 'Not sore']],
  ['mood', 'How is your mood?', ['Very low', 'Low', 'OK', 'Good', 'Great']],
  ['stress', 'How stressed are you?', ['Very stressed', 'Stressed', 'Some', 'A little', 'Relaxed']],
];

export default async function wellness(el, ctx) {
  if (ctx.me.caps.staff) { ctx.navigate('/weights?tab=wellness', { replace: true }); return; }
  if (ctx.me.user.role !== 'player') { set(el, html`<div class="page-head"><div><h1>Wellness check-in</h1></div></div>${empty('The daily check-in is filled in by athletes and seen by their strength coaches and trainers.')}`); return; }
  const w = await api.get(`/api/wellness/player/${ctx.me.user.id}`);
  const cur = w.today || {};
  const ans = { sleep_hours: cur.sleep_hours ?? '', ...Object.fromEntries(Q.map(([k]) => [k, cur[k] ?? null])) };
  set(el, html`<div class="page-head"><div><h1>Daily check-in</h1><div class="sub">${fmtDate(todayISO())}. Your strength coaches and athletic trainer see this; it helps them adjust your lifts.</div></div><div class="actions"><a class="btn" href="/weights">Weight room</a></div></div>
    <div class="grid g-side wr-grid"><div class="card"><div class="bd"><form id="wf">
      <div class="field"><label>Hours of sleep last night</label><span class="wr-step wr-big"><button type="button" class="icon" data-h="-0.5" aria-label="Less sleep">−</button><input type="number" inputmode="decimal" step="0.5" min="0" max="16" name="sleep_hours" value="${ans.sleep_hours}" required><button type="button" class="icon" data-h="0.5" aria-label="More sleep">+</button></span></div>
      ${Q.map(([k, label, words]) => html`<div class="field"><label>${label}</label><div class="wr-scale" data-q="${k}">${words.map((wd, i) => html`<button type="button" class="${ans[k] === i + 1 ? 'on' : ''}" data-v="${i + 1}"><b>${i + 1}</b><span>${wd}</span></button>`)}</div></div>`)}
      <div class="field"><label>Anything your coach should know? (optional)</label><textarea name="note" maxlength="500">${cur.note || ''}</textarea></div>
      <button class="primary" style="height:40px;width:100%">${w.today ? 'Update check-in' : 'Submit check-in'}</button></form></div></div>
    <div class="stack"><div class="card"><div class="hd"><h2>Last 4 weeks</h2></div><div class="bd">${w.rows.length ? html`${lineChart([{ label: 'Wellness score', points: w.rows.map((r) => [r.date, r.score]) }, { label: 'Sleep hours x10', points: w.rows.map((r) => [r.date, r.sleep_hours * 10]), dashed: true }], { height: 170, yMin: 0, yMax: 100 })}${legend([{ label: 'Wellness score (0-100)' }, { label: 'Sleep hours × 10' }])}` : html`<p class="muted">Your trend appears after a few check-ins.</p>`}</div>
      ${w.rows.length ? html`<ul class="list">${w.rows.slice(-7).reverse().map((r) => html`<li><span class="grow">${fmtDate(r.date)}</span><span class="s">${r.sleep_hours} h</span>${r.flags.length ? html`<span class="badge warn">${r.flags[0]}</span>` : html`<span class="badge ok">${r.score}</span>`}</li>`)}</ul>` : ''}</div></div></div>`);
  on(el, 'click', '[data-h]', (e, b) => { const i = $('[name=sleep_hours]', el); i.value = Math.max(0, Math.min(16, (Number(i.value) || 0) + Number(b.dataset.h))); });
  on(el, 'click', '.wr-scale button', (e, b) => { const box = b.closest('[data-q]'); ans[box.dataset.q] = Number(b.dataset.v); $$('button', box).forEach((x) => x.classList.toggle('on', x === b)); });
  $('#wf', el).onsubmit = async (e) => {
    e.preventDefault();
    if (Q.some(([k]) => !ans[k])) return toast('Answer each question', 'warn');
    const body = { sleep_hours: Number($('[name=sleep_hours]', el).value), ...Object.fromEntries(Q.map(([k]) => [k, ans[k]])), note: $('[name=note]', el).value, date: todayISO(), client_id: uid() };
    try { const r = await api.post('/api/wellness', body, { offline: true }); toast(r.queued ? 'Saved offline; it will sync when you reconnect' : r.flags.length ? 'Saved. Your coach will see the flags and may check in with you.' : 'Saved. Thanks.'); if (!r.queued) ctx.reload(); } catch (err) { errToast(err); }
  };
}
