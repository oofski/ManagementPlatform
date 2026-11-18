// Integrations › Connection (your Google account and its services) and Integrations › Setup (head coach:
// the Google and Clever OAuth clients, with the exact addresses to paste into Google Cloud and Clever).
import { api } from '../api.js';
import { html, set, $, on, toast, errToast, formData, checked, field, ago, confirmDialog, initials } from '../ui.js';
import { icon } from '../icons.js';
import { googleButton, isDesktop, desktopHandoff } from '../sso.js';

const FEATURE_TAB = { gmail: 'gmail', calendar: 'calendar', sheets: 'sheets', docs: 'docs' };

// Starts Google consent for these services. In the Windows app the consent happens in the system browser.
export async function connectGoogle(features, ctx) {
  if (isDesktop()) {
    const r = await desktopHandoff(() => api.post('/api/google/connect', { features, desktop: true }), { title: 'Connect Google in your browser', what: 'connect your Google account' });
    if (r) { toast('Google is connected'); ctx.navigate('/settings/integrations?tab=connection&google=connected', { replace: true }); }
    return;
  }
  const r = await api.post('/api/google/connect', { features });
  location.href = r.url;
}

// ---------- Connection ----------
export function connection(box, st, ctx) {
  const c = st.connection;
  box.classList.add('stack');
  if (!st.configured) {
    set(box, html`<div class="card"><div class="hd"><h2>Google is not set up yet</h2></div><div class="bd">
      ${st.is_admin ? html`<p>Add your program's Google client once, then every staff member can connect their own account here.</p>
        <a class="btn primary" href="/settings/integrations?tab=setup">Set up Google</a>`
        : html`<p class="muted">Ask your head coach to set up Google under Integrations › Setup. Then you can connect your account here.</p>`}
    </div></div>`);
    return;
  }
  const label = (k) => st.features.find((f) => f.key === k)?.label || k;
  const avatar = c ? (c.picture ? html`<span class="av lg"><img src="${c.picture}" alt="" referrerpolicy="no-referrer"></span>` : html`<span class="av lg">${initials(c.name || c.email || 'G')}</span>`) : '';
  const serviceState = (k) => {
    if (!c) return null;
    if (c.features.includes(k)) return 'on';
    if (c.granted.includes(k)) return 'off';
    return 'none';
  };
  const rows = st.features.map((f) => {
    const s = serviceState(f.key);
    return html`<li>
      <div class="grow"><div class="t">${f.label} ${s === 'on' ? html`<span class="badge ok">On</span>` : s === 'off' ? html`<span class="badge">Off</span>` : c ? html`<span class="badge">Not allowed yet</span>` : ''}</div>
        <div class="s">${f.help}</div></div>
      ${c ? html`${s === 'on' ? html`<a class="btn sm" href="/settings/integrations?tab=${FEATURE_TAB[f.key]}">Open</a>` : ''}
        <label class="switch" title="${s === 'on' ? `Turn off ${f.label}` : `Turn on ${f.label}`}"><input type="checkbox" data-feature="${f.key}" ${checked(s === 'on')} aria-label="${f.label}"><span></span></label>`
        : html`<label class="switch"><input type="checkbox" name="features" data-multi value="${f.key}" ${checked(['gmail', 'calendar'].includes(f.key))} aria-label="${f.label}"><span></span></label>`}
    </li>`;
  });
  set(box, html`<div class="card"><div class="hd"><h2>Google account</h2>${c ? html`<span class="badge ok">Connected</span>` : html`<span class="badge">Not connected</span>`}</div><div class="bd">
    ${c ? html`<div class="g-account">${avatar}<div class="grow" style="min-width:0"><b>${c.name || c.email || 'Google account'}</b><div class="muted">${c.name && c.email ? c.email : ''}</div><div class="help">Connected ${ago(c.connected_at)}</div></div>
        <button id="disconnect" class="danger">Disconnect</button></div>
      ${c.missing.length ? html`<div class="notice warn g-fix"><span>Google did not allow ${c.missing.map(label).join(', ')}. Allow it to use ${c.missing.length > 1 ? 'them' : 'it'}.</span>${googleButton('Allow on Google', 'id="reconnect-missing"')}</div>` : ''}
      ${c.last_error ? html`<div class="notice bad g-fix"><span>${c.last_error}</span>${googleButton('Reconnect with Google', 'id="reconnect"')}</div>` : ''}`
    : html`<p>Connect your own Google account. Choose the services the app may use. Google asks you to allow only those, and you can add more later.</p>`}
  </div></div>
  <div class="card"><div class="hd"><h2>Services</h2></div><div class="bd" style="padding:0">
    <form id="cf" onsubmit="return false"><ul class="list">${rows}</ul></form>
  </div>${c ? '' : html`<div class="ft">${googleButton('Continue with Google', 'id="connect"')}</div>`}</div>
  <p class="help">Nothing is shared with other staff. Gmail is used to read emails with your chosen label, add an "Imported" label, and send program email only if the head coach picks your account and you agree. You can also remove access at myaccount.google.com/permissions.</p>`);

  const connectBtn = $('#connect', box);
  if (connectBtn) connectBtn.onclick = async () => {
    const f = formData($('#cf', box)).features || [];
    if (!f.length) return toast('Turn on at least one service', 'bad');
    connectBtn.disabled = true;
    try { await connectGoogle(f, ctx); } catch (e) { errToast(e); } finally { connectBtn.disabled = false; }
  };
  const again = async (btn) => {
    btn.disabled = true;
    try { await connectGoogle([...new Set([...c.granted, ...c.missing])], ctx); } catch (e) { errToast(e); } finally { btn.disabled = false; }
  };
  for (const id of ['#reconnect', '#reconnect-missing']) { const b = $(id, box); if (b) b.onclick = () => again(b); }
  // Per-service switches: off stops using it; on uses it again, or asks Google for just that service.
  if (c) on(box, 'change', '[data-feature]', async (e, input) => {
    const feature = input.dataset.feature;
    input.disabled = true;
    try {
      const r = await api.put('/api/google/features', { feature, enabled: input.checked });
      if (r.needs_consent) { await connectGoogle([...new Set([...c.granted, feature])], ctx); input.checked = false; return; }
      toast(`${label(feature)} ${input.checked ? 'turned on' : 'turned off'}`);
      ctx.reload();
    } catch (err) { errToast(err); input.checked = !input.checked; } finally { input.disabled = false; }
  });
  const dis = $('#disconnect', box);
  if (dis) dis.onclick = async () => {
    if (!(await confirmDialog('Disconnect Google? The app stops reading your email and calendars, and Google revokes its access. Drafts already queued stay here.', { ok: 'Disconnect', danger: true }))) return;
    try { await api.post('/api/google/disconnect'); toast('Google disconnected'); ctx.navigate('/settings/integrations?tab=connection', { replace: true }); } catch (e) { errToast(e); }
  };
}

// ---------- Setup (head coach) ----------
const copyBtn = (value) => html`<button type="button" class="sm" data-copy="${value}" title="Copy">${icon('clipboard', 14)}<span>Copy</span></button>`;
const copyRow = (label, value) => html`<div class="copy-row"><div class="grow" style="min-width:0"><div class="help">${label}</div><code>${value || 'Unknown: set APP_URL'}</code></div>${value ? copyBtn(value) : ''}</div>`;
const sourceBadge = (p) => (p.source === 'app' ? html`<span class="badge ok">Saved in the app</span>` : p.source === 'env' ? html`<span class="badge blue">From the server environment</span>` : html`<span class="badge">Not set up</span>`);

export async function setup(box, ctx) {
  const s = await api.get('/api/google/setup');
  const g = s.google; const cl = s.clever;
  box.classList.add('stack');
  const ext = (href, text) => html`<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  set(box, html`
  ${!s.token_key_set ? html`<div class="notice warn">TOKEN_KEY is not set on the server. Secrets and tokens are encrypted with a key file next to the database instead. Set TOKEN_KEY for production so a lost file does not force everyone to reconnect.</div>` : ''}
  <div class="card"><div class="hd"><h2>Google</h2>${sourceBadge(g)}</div><div class="bd">
    <p class="muted">Do this once for the whole program. It takes about ten minutes in Google Cloud.</p>
    <ol class="steps">
      <li><b>Create a project.</b> In ${ext('https://console.cloud.google.com/projectcreate', 'Google Cloud')}, create a project (for example “${ctx.me.program.name}”).</li>
      <li><b>Turn on the APIs.</b> Enable ${ext('https://console.cloud.google.com/apis/library/gmail.googleapis.com', 'Gmail')}, ${ext('https://console.cloud.google.com/apis/library/calendar-json.googleapis.com', 'Calendar')}, ${ext('https://console.cloud.google.com/apis/library/sheets.googleapis.com', 'Sheets')}, ${ext('https://console.cloud.google.com/apis/library/docs.googleapis.com', 'Docs')} and ${ext('https://console.cloud.google.com/apis/library/drive.googleapis.com', 'Drive')}.</li>
      <li><b>Set up the consent screen.</b> Open ${ext('https://console.cloud.google.com/auth/branding', 'Google Auth Platform › Branding')}. Choose <b>Internal</b> if all staff use your school's Google Workspace; otherwise External, and add your staff as test users under Audience.</li>
      <li><b>Create the OAuth client.</b> Open ${ext('https://console.cloud.google.com/auth/clients/create', 'Clients › Create client')}, choose <b>Web application</b>, and paste these:
        ${copyRow('Authorized JavaScript origin', s.app_url)}
        ${copyRow('Authorized redirect URI (connecting Gmail, Calendar, Sheets, Docs)', s.redirect_uris.connect)}
        ${copyRow('Authorized redirect URI (Sign in with Google)', s.redirect_uris.signin)}
      </li>
      <li><b>Paste the Client ID and Client secret</b> that Google shows you:</li>
    </ol>
    ${!s.app_url_from_env ? html`<div class="help">These addresses use the address you opened the app with. If staff reach the app at a different address, set APP_URL on the server.</div>` : ''}
    <form id="gform" onsubmit="return false"><div class="fields">
      ${field('Client ID', html`<input name="client_id" value="${g.client_id || ''}" placeholder="1234567890-abc.apps.googleusercontent.com" autocomplete="off" spellcheck="false">`)}
      ${field('Client secret', html`<input name="client_secret" type="password" autocomplete="new-password" placeholder="${g.secret_set ? 'Saved. Enter a new secret to replace it' : 'GOCSPX-…'}">`, g.secret_set ? 'The saved secret is encrypted and never shown again.' : '')}
    </div></form>
    <div class="row"><button class="primary" id="g-save">Save</button><button id="g-check" ${g.configured ? '' : 'disabled'}>Check with Google</button>
      ${g.source === 'app' ? html`<button class="ghost danger" id="g-remove">Remove</button>` : ''}</div>
    <div id="g-out"></div>
    ${g.source === 'env' && !g.client_id ? html`<div class="help">The server environment already provides a Google client (GOOGLE_CLIENT_ID). Values saved here take its place.</div>` : ''}
  </div></div>

  <div class="card"><div class="hd"><h2>Sign in with Google</h2>${g.sso ? html`<span class="badge ok">On</span>` : html`<span class="badge">Off</span>`}</div><div class="bd">
    <p class="muted">Adds “Continue with Google” to the sign-in page. A person gets in only if their verified Google email matches an active account in this program. Nobody is created automatically. Staff still confirm new sign-ins with a code when two-step is on.</p>
    <form id="ssoform" onsubmit="return false">
      <div class="field"><label class="check"><input type="checkbox" name="sso" ${checked(g.sso)} ${g.configured ? '' : 'disabled'}> Allow sign-in with Google</label></div>
      <div class="fields">${field('School domain (optional)', html`<input name="hd" value="${g.hd}" placeholder="ridgeviewschools.org" autocomplete="off">`, 'Only accounts from this Google Workspace for Education domain may sign in.')}</div>
    </form>
    <button id="sso-save" ${g.configured ? '' : 'disabled'}>Save sign-in settings</button>
  </div></div>

  <div class="card"><div class="hd"><h2>Clever</h2>${sourceBadge(cl)}</div><div class="bd">
    <p class="muted">For districts that use Clever: adds “Continue with Clever” to the sign-in page. People are matched by the email on their Clever account.</p>
    <ol class="steps">
      <li>In the ${ext('https://apps.clever.com/', 'Clever developer dashboard')}, open your app's settings.</li>
      <li>Add this redirect URI: ${copyRow('Redirect URI', s.redirect_uris.clever)}</li>
      <li>Paste the app's Client ID and Client secret:</li>
    </ol>
    <form id="cform" onsubmit="return false"><div class="fields">
      ${field('Client ID', html`<input name="client_id" value="${cl.client_id || ''}" autocomplete="off" spellcheck="false">`)}
      ${field('Client secret', html`<input name="client_secret" type="password" autocomplete="new-password" placeholder="${cl.secret_set ? 'Saved. Enter a new secret to replace it' : ''}">`)}
    </div>
    <div class="field"><label class="check"><input type="checkbox" name="sso" ${checked(cl.sso)}> Allow sign-in with Clever</label></div></form>
    <div class="row"><button class="primary" id="c-save">Save</button><button id="c-check" ${cl.configured ? '' : 'disabled'}>Check with Clever</button>
      ${cl.source === 'app' ? html`<button class="ghost danger" id="c-remove">Remove</button>` : ''}</div>
    <div id="c-out"></div>
  </div></div>
  <p class="help">${s.connected_staff} staff member${s.connected_staff === 1 ? ' has' : 's have'} connected Google. Full instructions: docs/google-setup.md.</p>`);

  on(box, 'click', '[data-copy]', async (e, b) => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied'); } catch { toast('Select the text and copy it', 'warn'); }
  });
  const save = async (provider, form, extra = {}) => {
    const f = formData($(form, box));
    const body = { client_id: f.client_id, ...extra };
    if (f.client_secret) body.client_secret = f.client_secret;
    if (f.sso !== undefined && provider === 'clever') body.sso = f.sso;
    await api.put(`/api/google/setup/${provider}`, body);
  };
  const wire = (id, fn) => { const b = $(id, box); if (b) b.onclick = async () => { b.disabled = true; try { await fn(); } catch (e) { errToast(e); } finally { b.disabled = false; } }; };
  wire('#g-save', async () => { await save('google', '#gform'); toast('Google client saved'); ctx.reload(); });
  wire('#c-save', async () => { await save('clever', '#cform'); toast('Clever client saved'); ctx.reload(); });
  const check = (provider, out) => async () => {
    set($(out, box), html`<div class="notice">Checking…</div>`);
    const r = await api.post(`/api/google/setup/${provider}/check`);
    set($(out, box), r.ok ? html`<div class="notice ok">${provider === 'google' ? 'Google' : 'Clever'} accepted the Client ID and Client secret.</div>` : html`<div class="notice bad">${r.error}</div>`);
  };
  wire('#g-check', check('google', '#g-out'));
  wire('#c-check', check('clever', '#c-out'));
  wire('#sso-save', async () => { const f = formData($('#ssoform', box)); await api.put('/api/google/setup/google', { sso: !!f.sso, hd: f.hd || '' }); toast('Sign-in settings saved'); ctx.reload(); });
  const remove = (provider) => async () => {
    if (!(await confirmDialog(`Remove the ${provider === 'google' ? 'Google' : 'Clever'} client saved in the app? Sign-in with it stops${provider === 'google' ? ' and connected staff may need to reconnect' : ''}.`, { ok: 'Remove', danger: true }))) return;
    await api.del(`/api/google/setup/${provider}`); toast('Removed'); ctx.reload();
  };
  wire('#g-remove', remove('google'));
  wire('#c-remove', remove('clever'));
}
