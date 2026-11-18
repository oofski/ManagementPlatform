// C-4: athlete sign-up without a personal email. Team join code (typed or from the QR) → pick your name from
// the roster or add yourself → choose a username and password → signed in.
import { api } from '../api.js';
import { html, set, $, errToast } from '../ui.js';

const frame = (inner) => html`<div class="auth"><div class="box">
  <div class="brandline"><div class="mark">R</div><div><b>Program Manager</b><div class="muted" style="font-size:12px">Join your team</div></div></div>
  ${inner}</div></div>`;

export async function standalone() {
  document.title = 'Join a team · Program Manager';
  const root = $('#app');
  flow((h) => set(root, frame(h)), root);
}

export default async function join(el, ctx) {
  set(el, html`<div style="max-width:460px;margin:20px auto"><div class="card"><div class="bd">
    <h1 style="margin-bottom:6px">Join a team</h1>
    <p class="muted">You are signed in as <b>${ctx.me.user.name}</b>. To set up a new athlete account on this device, sign out first and open this page again.</p>
    <a class="btn" href="/">Back to the app</a></div></div></div>`);
}

function flow(render, root) {
  const st = { code: new URLSearchParams(location.search).get('code') || '', info: null, pick: null, add: false, name: '', jersey: '', username: '' };
  const step1 = () => render(html`<div class="card"><div class="bd">
    <h1 style="margin-bottom:6px">Join your team</h1>
    <p class="muted">Enter the team code from your coach, or scan the team QR code.</p>
    <form id="f1"><div class="field"><label for="code">Team code</label>
      <input id="code" name="code" value="${st.code}" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="8" class="mono" style="font-size:24px;letter-spacing:.2em;text-align:center;min-height:52px" required></div>
      <button class="primary" style="width:100%;justify-content:center;min-height:44px">Continue</button></form>
    <p class="muted" style="font-size:12.5px;margin:12px 0 0">Already have an account? <a href="/" data-signin>Sign in</a></p>
  </div></div>`);
  const step2 = () => render(html`<div class="card"><div class="bd">
    <h1 style="margin-bottom:2px">${st.info.team}</h1><p class="muted">${st.info.program}${st.info.school ? ` · ${st.info.school}` : ''}</p>
    ${st.info.players.length ? html`<h4 style="margin:10px 0 6px">Find your name</h4>
      <input type="search" id="q" placeholder="Type your name" style="margin-bottom:8px" autocomplete="off">
      <ul class="list" id="names" style="max-height:300px;overflow-y:auto;border:1px solid var(--line);border-radius:var(--r)">
        ${st.info.players.map((p) => html`<li class="click" data-pick="${p.id}" data-n="${p.label.toLowerCase()}"><span class="grow t">${p.label}</span><span class="s">That's me</span></li>`)}</ul>` : html`<div class="notice">Everyone on this roster already has an account. Add yourself below.</div>`}
    <div class="row" style="margin-top:12px"><button id="addme">I'm not on the list</button><span class="spacer"></span><button class="ghost" id="back">Back</button></div>
  </div></div>`);
  const step3 = () => {
    const who = st.add ? `${st.name}${st.jersey !== '' ? ` #${st.jersey}` : ''}` : st.info.players.find((p) => p.id === st.pick)?.label;
    render(html`<div class="card"><div class="bd">
      <h1 style="margin-bottom:2px">Create your sign-in</h1><p class="muted">${st.info.team} · ${who}</p>
      <form id="f3">
        ${st.add ? html`<div class="fields"><div class="field"><label for="nm">First and last name</label><input id="nm" name="name" value="${st.name}" required autocomplete="name"></div>
          <div class="field"><label for="jn">Jersey number (optional)</label><input id="jn" name="jersey" type="number" min="0" max="99" value="${st.jersey}" inputmode="numeric"></div></div>` : ''}
        <div class="field"><label for="un">Username</label><input id="un" name="username" value="${st.username}" autocomplete="username" autocapitalize="none" spellcheck="false" required pattern="[A-Za-z0-9._\\-]{3,30}">
          <div class="help">You sign in with this. Letters, numbers, dots or dashes.</div></div>
        <div class="field"><label for="pw">Password</label><input id="pw" name="password" type="password" minlength="8" autocomplete="new-password" required><div class="help">At least 8 characters.</div></div>
        <button class="primary" style="width:100%;justify-content:center;min-height:44px">Join and sign in</button>
      </form>
      <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="ghost" id="back">Back</button></div>
    </div></div>`);
  };
  const go = (fn) => { fn(); wire(); };
  const wire = () => {
    const f1 = $('#f1', root);
    if (f1) {
      f1.onsubmit = async (e) => {
        e.preventDefault();
        st.code = $('#code', root).value.trim().toUpperCase();
        try { st.info = await api.post('/api/join/lookup', { code: st.code }); go(step2); } catch (err) { errToast(err); }
      };
      const s = root.querySelector('[data-signin]');
      if (s) s.onclick = (e) => { e.preventDefault(); history.replaceState({}, '', '/'); location.reload(); };
    }
    const q = $('#q', root);
    if (q) q.oninput = () => root.querySelectorAll('[data-n]').forEach((li) => { li.style.display = li.dataset.n.includes(q.value.toLowerCase()) ? '' : 'none'; });
    root.querySelectorAll('[data-pick]').forEach((li) => {
      li.onclick = () => { st.pick = Number(li.dataset.pick); st.add = false; st.username = st.info.players.find((p) => p.id === st.pick).suggested; go(step3); };
    });
    if ($('#addme', root)) $('#addme', root).onclick = () => { st.add = true; st.pick = null; st.username = ''; go(step3); };
    if ($('#back', root)) $('#back', root).onclick = () => go($('#f3', root) ? step2 : step1);
    const f3 = $('#f3', root);
    if (f3) {
      const nm = $('#nm', root); const jn = $('#jn', root);
      const suggest = async () => {
        st.name = nm.value; st.jersey = jn.value;
        if (!nm.value.includes(' ') || $('#un', root).dataset.touched) return;
        try { const r = await api.post('/api/join/suggest', { code: st.code, name: nm.value, jersey: jn.value }); $('#un', root).value = r.username; } catch { /* ignore */ }
      };
      if (nm) { nm.onchange = suggest; jn.onchange = suggest; }
      $('#un', root).oninput = (e) => { e.target.dataset.touched = '1'; };
      f3.onsubmit = async (e) => {
        e.preventDefault();
        const body = { code: st.code, username: $('#un', root).value.trim(), password: $('#pw', root).value };
        if (st.add) { body.name = nm.value.trim(); body.jersey = jn.value; } else body.player_id = st.pick;
        try {
          await api.post('/api/join/claim', body);
          history.replaceState({}, '', '/');
          const { signedIn } = await import('../app.js');
          await signedIn();
        } catch (err) { errToast(err); }
      };
    }
  };
  go(step1);
  if (st.code) $('#f1', root).requestSubmit?.();
}
