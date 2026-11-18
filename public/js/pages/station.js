// C-11 shared-tablet station mode: a coach picks 4 to 8 athletes and logs load and reps per set for each, side by side.
// Works offline (C-13): sets go through the offline queue with a client id, and the last loaded station is cached.
import { api, uid, queueLength, onQueueChange, flushQueue } from '../api.js';
import { html, set, $, $$, on, toast, errToast, options, empty, cap, availBadge } from '../ui.js';
import { icon } from '../icons.js';

const KEY = 'pm.station.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked */ } };

export default async function station(el, ctx) {
  if (!ctx.me.caps['weights.edit']) { set(el, html`<div class="page-head"><div><h1>Station mode</h1></div></div>${empty('Station mode is for coaches and trainers who log sets for athletes on a shared tablet.')}`); return; }
  const st = { ...load(), ...(ctx.query.assignment ? { assignment_id: Number(ctx.query.assignment) } : {}) };
  const shell = (inner) => set(el, html`<div class="wr-full wr-station"><div class="wr-bar"><b>Station mode</b><span class="spacer"></span><span id="sq" class="badge warn" hidden></span><span id="sn" class="badge" hidden>Offline</span>${inner.bar || ''}<a class="btn" href="/weights">${icon('x', 14)} Exit</a></div><div class="wr-body">${inner.body}</div></div>`);
  const syncBadges = () => { const q = $('#sq', el); if (!q) return; const n = queueLength(); q.hidden = !n; q.textContent = `${n} waiting to sync`; $('#sn', el).hidden = navigator.onLine; };
  const offQ = onQueueChange(syncBadges);
  const onl = async () => { syncBadges(); if (navigator.onLine) { const r = await flushQueue(); if (r.sent) toast(`Synced ${r.sent} set${r.sent > 1 ? 's' : ''}`); if (!queueLength()) $$('.wr-srow.queued', el).forEach((x) => x.classList.toggle('queued', false)); syncBadges(); } };
  window.addEventListener('online', onl); window.addEventListener('offline', syncBadges);
  new MutationObserver((_, obs) => { if (!document.body.contains(el)) { offQ(); window.removeEventListener('online', onl); window.removeEventListener('offline', syncBadges); obs.disconnect(); } }).observe(document.body, { childList: true, subtree: true });

  async function setup() {
    let r;
    try { r = await api.get(`/api/strength/station/roster${st.assignment_id ? `?assignment_id=${st.assignment_id}` : ''}`); } catch (e) {
      if (st.players?.length && st.cache) return run(true);
      throw e;
    }
    if (!r.assignment) { shell({ body: empty('No programs are assigned yet. Assign one in the weight room first.') }); return; }
    st.assignment_id = r.assignment.id;
    const chosen = new Set((st.players || []).filter((id) => r.players.some((p) => p.id === id)));
    const dayVal = st.day || 'next';
    shell({ body: html`<div class="wr-setup"><div class="filters"><select id="as">${options(r.assignments.map((a) => [a.id, `${a.program_name} · ${a.audience_labels.join(', ')}`]), r.assignment.id)}</select>
        <select id="dy"><option value="next">Each athlete's next session</option>${options(r.assignment.days.map((d) => [`${d.week}:${d.day}`, `Week ${d.week}, day ${d.day}${d.label ? `: ${d.label}` : ''}${d.due ? ` (${d.due})` : ''}`]), dayVal)}</select>
        <input type="search" id="fq" placeholder="Find an athlete"></div>
      <p class="muted">Pick 4 to 8 athletes for this rack. <b id="nsel">${chosen.size}</b> picked. Limited and out athletes are flagged.</p>
      <div class="wr-roster" id="ros">${r.players.map((p) => html`<button type="button" class="wr-chip ${chosen.has(p.id) ? 'sel' : ''} ${p.availability !== 'available' ? 'flag' : ''}" data-p="${p.id}" data-n="${p.name.toLowerCase()}"><b>${p.name}</b><span>${p.jersey != null ? `#${p.jersey} · ` : ''}${p.group || p.positions.join('/')}${p.availability !== 'available' ? ` · ${cap(p.availability)}` : ''}</span></button>`)}</div>
      <div class="wr-setup-go"><button class="primary wr-bigbtn" id="go">Start logging</button></div></div>` });
    $('#as', el).onchange = (e) => { st.assignment_id = Number(e.target.value); st.players = []; st.day = 'next'; save(st); setup(); };
    $('#dy', el).onchange = (e) => { st.day = e.target.value; };
    $('#fq', el).oninput = (e) => { const q = e.target.value.toLowerCase(); $$('[data-p]', el).forEach((b) => { b.hidden = q && !b.dataset.n.includes(q); }); };
    on($('.wr-full', el), 'click', '[data-p]', (e, b) => {
      const id = Number(b.dataset.p);
      if (chosen.has(id)) chosen.delete(id); else { if (chosen.size >= 8) return toast('Up to 8 athletes per station', 'warn'); chosen.add(id); }
      b.classList.toggle('sel', chosen.has(id)); $('#nsel', el).textContent = chosen.size;
    });
    $('#go', el).onclick = () => { if (!chosen.size) return toast('Pick at least one athlete', 'warn'); st.players = [...chosen]; st.day = $('#dy', el).value; save(st); run(); };
  }

  async function run(fromCache = false) {
    const q = new URLSearchParams({ assignment_id: st.assignment_id, players: st.players.join(',') });
    if (st.day && st.day !== 'next') { const [w, d] = st.day.split(':'); q.set('week', w); q.set('day', d); }
    let data;
    if (!fromCache) { try { data = await api.get(`/api/strength/station?${q}`); st.cache = { key: String(q), data }; save(st); } catch (e) { if (st.cache?.key === String(q)) { data = st.cache.data; toast('Offline: showing the last loaded station. Sets will sync later.', 'warn'); } else throw e; } }
    else { data = st.cache.data; toast('Offline: showing the last loaded station.', 'warn'); }
    const locallyLogged = new Set(st.logged || []);
    shell({ bar: html`<span class="wr-bar-t">${data.assignment.program_name}</span><button id="chg">${icon('users', 14)} Athletes</button><button id="rf">Refresh</button>`,
      body: html`<div class="wr-st-grid" style="--n:${data.players.length}">${data.players.map((p) => html`<section class="wr-ath ${p.availability && p.availability !== 'available' ? 'flag' : ''}" data-pid="${p.id}">
        <header><div><b>${p.name}</b> <span class="faint">${p.jersey != null ? `#${p.jersey}` : ''}</span></div><div class="s">${p.workout.label ? `${p.workout.label} · ` : ''}W${p.workout.week}D${p.workout.day}${p.availability && p.availability !== 'available' ? html` ${availBadge(p.availability)}` : ''}</div>
          ${p.avail_note && p.availability !== 'available' ? html`<div class="s wr-warn">${p.avail_note}</div>` : ''}</header>
        ${p.workout.exercises.map((x) => html`<div class="wr-ex" data-ex="${x.exercise_id}" data-w="${p.workout.week}" data-d="${p.workout.day}"><div class="wr-ex-h"><b>${x.name}</b><span class="s muted">${x.sets} × ${x.reps || ''}${x.pct ? ` @ ${x.pct}%` : ''}${x.rpe ? ` · RPE ${x.rpe}` : ''}${x.layer !== 'team' ? ' · changed' : ''}</span></div>
          <div class="wr-shead"><span></span><span>Weight (lb)</span><span>Reps</span><span></span></div>
          ${Array.from({ length: x.sets }, (_, i) => { const l = x.logged.find((y) => y.set_no === i + 1); const k = `${p.id}:${x.exercise_id}:${p.workout.week}:${p.workout.day}:${i + 1}`; const done = !!l || locallyLogged.has(k); return html`<div class="wr-srow ${done ? 'done' : ''}" data-set="${i + 1}" data-key="${k}">
            <span class="wr-sn">${i + 1}</span>
            <span class="wr-tap"><button type="button" data-st="weight:-5" aria-label="Less weight">−</button><input type="number" inputmode="decimal" data-k="weight" value="${l?.weight ?? x.load ?? ''}" aria-label="Weight"><button type="button" data-st="weight:5" aria-label="More weight">+</button></span>
            <span class="wr-tap wr-reps"><button type="button" data-st="reps:-1" aria-label="Fewer reps">−</button><input type="number" inputmode="numeric" data-k="reps" value="${l?.reps ?? (String(x.reps).match(/^\d+$/) ? x.reps : '')}" aria-label="Reps"><button type="button" data-st="reps:1" aria-label="More reps">+</button></span>
            <button type="button" class="wr-ok" data-log aria-label="Log set">${icon('check', 18)}</button></div>`; })}</div>`)}
      </section>`)}</div>` });
    syncBadges();
    $('#chg', el).onclick = () => setup();
    $('#rf', el).onclick = () => run();
    on($('.wr-full', el), 'click', '[data-st]', (e, b) => { const [k, dv] = b.dataset.st.split(':'); const inp = b.parentElement.querySelector(`[data-k=${k}]`); inp.value = Math.max(0, (Number(inp.value) || 0) + Number(dv)); b.closest('.wr-srow').classList.remove('done'); });
    on($('.wr-full', el), 'click', '[data-log]', async (e, b) => {
      const row = b.closest('.wr-srow'); const exEl = b.closest('.wr-ex'); const pid = Number(b.closest('[data-pid]').dataset.pid);
      const body = { player_id: pid, assignment_id: data.assignment.id, week: Number(exEl.dataset.w), day: Number(exEl.dataset.d), exercise_id: Number(exEl.dataset.ex), set_no: Number(row.dataset.set),
        weight: Number(row.querySelector('[data-k=weight]').value) || 0, reps: Number(row.querySelector('[data-k=reps]').value) || 0, client_id: uid() };
      if (!body.reps) return toast('Enter the reps', 'warn');
      b.disabled = true;
      try {
        const r = await api.post('/api/wt-logs', body, { offline: true });
        row.classList.add('done'); row.classList.toggle('queued', !!r.queued);
        st.logged = [...new Set([...(st.logged || []), row.dataset.key])].slice(-400); save(st);
        if (r.training_max?.pr) toast(`${b.closest('[data-pid]').querySelector('header b').textContent}: new PR, estimated ${r.training_max.value} lb`);
        // carry the load to the next set
        const next = row.nextElementSibling;
        if (next && next.classList.contains('wr-srow') && !next.classList.contains('done')) { const nw = next.querySelector('[data-k=weight]'); if (!nw.value) nw.value = body.weight; }
      } catch (err) { errToast(err); } finally { b.disabled = false; syncBadges(); }
    });
  }
  if (ctx.query.resume && st.players?.length) return run().catch(() => setup());
  return setup();
}
