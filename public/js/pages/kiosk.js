// C-19: shared-tablet check-in. Athletes tap their number and name for the current event; a coach PIN exits.
import { api } from '../api.js';
import { html, set, $, on, modal, toast, fmtDT, raw } from '../ui.js';
import { icon } from '../icons.js';

export default async function kiosk(el, ctx) {
  const id = ctx.params.id;
  let data = await api.get(`/api/fb/kiosk/${id}`);
  if (data.ended) { set(el, html`<div class="notice">This kiosk was closed. <a href="/attendance/${data.event.id}">Back to attendance</a></div>`); return; }
  ctx.setTitle('Check-in kiosk');
  let q = '';
  const box = document.createElement('div');
  box.className = 'fb-kiosk';
  el.appendChild(box);
  const label = { present: 'Present', late: 'Tardy', left_early: 'Left early', excused: 'Excused', unexcused: 'Absent' };
  const draw = () => {
    const list = data.players.filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.jersey ?? '') === q);
    const here = data.players.filter((p) => p.status && ['present', 'late', 'left_early'].includes(p.status)).length;
    set(box, html`<div class="fb-kiosk-top"><div><h1>${data.event.title}</h1><div class="muted">${fmtDT(data.event.start)}${data.event.location ? ` · ${data.event.location}` : ''} · ${here} of ${data.players.length} checked in</div></div>
      <span class="spacer"></span><button id="exit">${icon('logout', 14)} Exit kiosk</button></div>
      <div class="fb-kiosk-search"><input type="search" id="kq" placeholder="Type your name or number" value="${q}" autocomplete="off"></div>
      <div class="fb-kiosk-grid">${list.map((p) => html`<button class="fb-kiosk-tile ${p.status ? 'done' : ''}" data-pid="${p.id}" ${p.status ? raw('aria-disabled="true"') : ''}>
        <span class="n">${p.jersey ?? ''}</span><span class="nm">${p.name}</span><span class="st">${p.status ? html`${icon('check', 13)} ${label[p.status] || p.status}` : 'Tap to check in'}</span></button>`)}</div>
      ${!list.length ? html`<div class="empty">No one matches. Ask a coach.</div>` : ''}`);
    const inp = $('#kq', box);
    inp.oninput = () => { q = inp.value.trim().toLowerCase(); const pos = inp.selectionStart; draw(); const n = $('#kq', box); n.focus(); n.setSelectionRange(pos, pos); };
  };
  draw();
  const refresh = async () => { try { data = await api.get(`/api/fb/kiosk/${id}`); if (!document.activeElement?.matches('#kq')) draw(); } catch { /* offline */ } };
  const timer = setInterval(() => { if (!document.body.contains(box)) return clearInterval(timer); refresh(); }, 20000);
  on(box, 'click', '[data-pid]', (e, b) => {
    const p = data.players.find((x) => x.id === Number(b.dataset.pid));
    if (!p || p.status) return;
    modal({
      title: 'Check in', body: html`<p style="font-size:18px;text-align:center;margin:10px 0"><b>${p.jersey != null ? `#${p.jersey} ` : ''}${p.name}</b></p><p class="muted" style="text-align:center">Is this you?</p>`,
      actions: [{ label: 'No' }, { label: 'Yes, check me in', primary: true, onClick: async () => {
        const r = await api.post(`/api/fb/kiosk/${id}/checkin`, { player_id: p.id });
        p.status = r.status;
        toast(`${p.name.split(' ')[0]}: ${r.already ? 'already checked in' : label[r.status] || r.status}`, r.status === 'late' ? 'warn' : '');
        q = ''; draw();
      } }],
    });
  });
  // Coach PIN to leave kiosk mode. Back/forward stays on the kiosk until it is closed.
  let closed = false;
  const stay = () => {
    window.removeEventListener('popstate', stay);
    if (!closed && document.body.contains(box)) ctx.navigate(`/kiosk/${id}`, { replace: true });
  };
  window.addEventListener('popstate', stay);
  on(box, 'click', '#exit', () => modal({
    title: 'Coach PIN', body: html`<form id="pf"><input id="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" style="font-size:24px;letter-spacing:.3em;text-align:center" placeholder="PIN"></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Exit kiosk', primary: true, onClick: async (r) => {
      const res = await api.post(`/api/fb/kiosk/${id}/exit`, { pin: r.querySelector('#pin').value });
      closed = true; window.removeEventListener('popstate', stay);
      ctx.navigate(`/attendance/${res.event_id}`, { replace: true });
    } }],
  }));
}
