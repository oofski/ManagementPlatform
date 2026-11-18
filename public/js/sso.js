// "Continue with Google" / "Continue with Clever" buttons, and the desktop hand-off: inside the Windows app,
// Google and Clever sign-in open in the system browser (Google blocks embedded browsers) and the app polls the
// server until the browser finishes.
import { api } from './api.js';
import { html, raw, modal } from './ui.js';

export const isDesktop = () => !!(window.desktopApp && window.desktopApp.isDesktop);

// Google's standard "G" mark (Sign in with Google branding guidelines).
const G_LOGO = '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="none" d="M0 0h48v48H0z"/></svg>';

export const googleButton = (label = 'Continue with Google', attrs = '') => html`<button type="button" class="gsi-btn" ${raw(attrs)}><span class="gsi-logo">${raw(G_LOGO)}</span><span class="gsi-text">${label}</span></button>`;
export const cleverButton = (label = 'Continue with Clever', attrs = '') => html`<button type="button" class="gsi-btn" ${raw(attrs)}><span class="gsi-logo clever-mark" aria-hidden="true">C</span><span class="gsi-text">${label}</span></button>`;

// Runs a desktop hand-off. start() returns { url, handoff, code } from the server. Resolves with the final
// hand-off result ({ status: 'done', ... }) or rejects with a readable error; null when the person cancels.
export function desktopHandoff(start, { title = 'Continue in your browser', what = 'sign in' } = {}) {
  return new Promise((resolve, reject) => {
    let stopped = false; let timer = null;
    const stop = () => { stopped = true; clearTimeout(timer); };
    start().then((r) => {
      const m = modal({
        title,
        body: html`<p>Your browser opened so you can ${what} there. When it says you can return, come back here and this window closes by itself.</p>
          <p class="muted">Check that the browser shows the same code:</p>
          <p><span class="handoff-code">${r.code}</span></p>
          <p class="help">Browser did not open? <a href="#" data-reopen>Open it again</a>.</p>`,
        actions: [{ label: 'Cancel', onClick: () => { stop(); resolve(null); } }],
      });
      m.root.closest('.modal-bg').querySelector('[data-x]').addEventListener('click', () => { stop(); resolve(null); });
      m.root.querySelector('[data-reopen]').onclick = (e) => { e.preventDefault(); window.desktopApp.openExternal(r.url); };
      window.desktopApp.openExternal(r.url);
      const started = Date.now();
      const poll = async () => {
        if (stopped) return;
        try {
          const h = await api.post('/api/auth/handoff', { handoff: r.handoff });
          if (h.status === 'done') { stop(); m.close(); return resolve(h); }
          if (h.status === 'error' || h.status === 'expired') { stop(); m.close(); return reject(new Error(h.message || 'The sign-in link expired. Try again.')); }
        } catch { /* offline for a moment: keep waiting */ }
        if (Date.now() - started > 15 * 60_000) { stop(); m.close(); return reject(new Error('The sign-in took too long. Try again.')); }
        timer = setTimeout(poll, 1500);
      };
      timer = setTimeout(poll, 1500);
    }).catch(reject);
  });
}
