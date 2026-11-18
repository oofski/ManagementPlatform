// Player self check-in with the code a coach shows (ATT-1).
import { api } from '../api.js';
import { html, set, $, toast, errToast, cap } from '../ui.js';

export default async function checkin(el, ctx) {
  set(el, html`<div style="max-width:420px;margin:20px auto"><div class="card"><div class="bd">
    <h1 style="margin-bottom:6px">Check in</h1><p class="muted">Enter the code your coach is showing.</p>
    <form id="f"><input id="code" name="code" value="${ctx.query.code || ''}" autocomplete="off" autocapitalize="characters" maxlength="8" style="font-size:28px;letter-spacing:.2em;text-align:center;min-height:56px" class="mono" required>
    <button class="primary" style="width:100%;justify-content:center;margin-top:10px;min-height:44px">Check in</button></form>
    <div id="res" style="margin-top:12px"></div></div></div></div>`);
  const submit = async () => {
    try {
      const r = await api.post('/api/checkin', { code: $('#code', el).value });
      set($('#res', el), html`<div class="notice ${r.status === 'late' ? 'warn' : 'ok'}">${r.already ? 'You were already checked in' : 'Checked in'}${r.event ? ` for ${r.event}` : ''}: <b>${cap(r.status)}</b></div>`);
      toast('Checked in');
    } catch (err) { errToast(err); }
  };
  $('#f', el).onsubmit = (e) => { e.preventDefault(); submit(); };
  if (ctx.query.code && ctx.me.user.role === 'player') submit();
}
