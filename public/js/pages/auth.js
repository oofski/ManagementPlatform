// Sign-in, two-step verification, invite acceptance.
import { api } from '../api.js';
import { html, set, $, on, toast, errToast, formData, ROLE } from '../ui.js';
import { signedIn } from '../app.js';

const frame = (inner) => set($('#app'), html`<div class="auth"><div class="box">
  <div class="brandline"><div class="mark">R</div><div><b>Program Manager</b><div class="muted" style="font-size:12px">Football program operations</div></div></div>
  ${inner}</div></div>`);

export async function login() {
  document.title = 'Sign in · Program Manager';
  let demo = [];
  try { demo = await api.get('/api/auth/demo-users'); } catch { /* not in dev */ }
  const groups = {};
  for (const u of demo) (groups[u.role] ||= []).push(u);
  frame(html`<div class="card"><div class="bd">
    <h1 style="margin-bottom:12px">Sign in</h1>
    <form id="f">
      <div class="field"><label for="em">Email</label><input id="em" name="email" type="email" autocomplete="username" required></div>
      <div class="field"><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required></div>
      <button class="primary" style="width:100%;justify-content:center">Sign in</button>
    </form>
    <div class="row" style="margin-top:10px">
      <button class="sm" data-sso="google" style="flex:1;justify-content:center">School Google account</button>
      <button class="sm" data-sso="microsoft" style="flex:1;justify-content:center">School Microsoft account</button>
    </div>
  </div></div>
  ${demo.length ? html`<div class="card" style="margin-top:14px"><div class="hd"><h3>Demo accounts</h3><span class="r faint" style="font-size:12px">password123</span></div><div class="bd">
    <p class="muted" style="font-size:12.5px">Sign in as any role to try the app. Quick picks:</p>
    <div class="row" style="margin-bottom:10px">
      ${[['head_coach', 'Head coach'], ['coach', 'Coach'], ['trainer', 'Trainer'], ['staff', 'Staff'], ['player', 'Player'], ['parent', 'Parent']].map(([r, l]) => (groups[r] ? html`<button class="sm" data-demo="${(r === 'player' ? groups[r].find((u) => u.name) : groups[r][0]).id}" data-role="${r}">${l}</button>` : ''))}
    </div>
    <input type="search" placeholder="Find a person" id="q" style="margin-bottom:6px">
    <div class="demo-list" id="dl">${demo.map((u) => html`<button data-demo="${u.id}" data-n="${u.name.toLowerCase()}">${u.name}<span>${u.title || ROLE[u.role]}</span></button>`)}</div>
  </div></div>` : ''}`);
  // Prefer the stable demo player/parent accounts for the quick picks.
  const app = $('#app');
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/api/auth/login', formData(e.target));
      if (r.twofa) return verify();
      await signedIn();
    } catch (err) { errToast(err); }
  };
  on(app, 'click', '[data-sso]', async (e, b) => { try { await api.post('/api/auth/sso', { provider: b.dataset.sso }); } catch (err) { toast(err.message, 'warn'); } });
  on(app, 'click', '[data-demo]', async (e, b) => {
    let id = Number(b.dataset.demo);
    if (b.dataset.role === 'player' || b.dataset.role === 'parent') {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${b.dataset.role}@ridgeview.example`, password: 'password123' }) });
      if (r.ok) return signedIn();
    }
    try { await api.post('/api/auth/demo', { user_id: id }); await signedIn(); } catch (err) { errToast(err); }
  });
  const q = $('#q');
  if (q) q.oninput = () => { const v = q.value.toLowerCase(); app.querySelectorAll('#dl [data-n]').forEach((b) => { b.style.display = b.dataset.n.includes(v) ? '' : 'none'; }); };
}

export function verify() {
  frame(html`<div class="card"><div class="bd">
    <h1 style="margin-bottom:6px">Two-step verification</h1>
    <p class="muted">We emailed a 6-digit code to you. Coaches and admins confirm each new sign-in.</p>
    <form id="f"><div class="field"><label for="code">Code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></div>
    <button class="primary" style="width:100%;justify-content:center">Verify</button></form>
    <p class="help" style="margin-top:10px">Demo: the code is in Settings › Email outbox, or ask your head coach.</p>
    <button class="ghost sm" id="back">Use a different account</button>
  </div></div>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try { await api.post('/api/auth/verify', formData(e.target)); await signedIn(); } catch (err) { errToast(err); }
  };
  $('#back').onclick = async () => { await api.post('/api/auth/logout').catch(() => {}); login(); };
}

export async function invite(code) {
  let info;
  try { info = await api.get(`/api/invite/${encodeURIComponent(code)}`); } catch (e) {
    return frame(html`<div class="card"><div class="bd"><h1>Invite not found</h1><p class="muted">${e.message}</p><a href="/" onclick="location.href='/';return false">Go to sign in</a></div></div>`);
  }
  frame(html`<div class="card"><div class="bd">
    <h1 style="margin-bottom:6px">Join ${info.program.name}</h1>
    <p class="muted">You were invited as ${ROLE[info.role] || info.role}. Set a password to finish.</p>
    <form id="f">
      <div class="field"><label>Name</label><input name="name" value="${info.name}" required></div>
      <div class="field"><label>Email</label><input value="${info.email || ''}" disabled></div>
      <div class="field"><label>Password</label><input name="password" type="password" minlength="8" autocomplete="new-password" required><div class="help">At least 8 characters.</div></div>
      <button class="primary" style="width:100%;justify-content:center">Create account</button>
    </form></div></div>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post(`/api/invite/${encodeURIComponent(code)}/accept`, formData(e.target));
      history.replaceState({}, '', '/');
      if (r.twofa) return verify();
      await signedIn();
    } catch (err) { errToast(err); }
  };
}
