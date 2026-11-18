// Windows app integration for the web UI.
// In the desktop app (window.desktopApp from desktop/preload.js): a small update pill
// ("Update 2.0.1 downloading 45%" -> "Restart to update") and a "What's new" note after an update.
// In a normal browser on a computer: a "Download for Windows" link in the sidebar footer.
import { html, set, modal } from './ui.js';
import { icon } from './icons.js';

export const DOWNLOAD_URL = 'https://github.com/oofski/ManagementPlatform/releases/latest/download/ProgramManager-Setup.exe';
const app = window.desktopApp && window.desktopApp.isDesktop ? window.desktopApp : null;

function updatePill() {
  let el = null; let last = null;
  const ensure = () => {
    if (!el) { el = document.createElement('div'); el.className = 'update-pill'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    return el;
  };
  const hide = () => { if (el) { el.remove(); el = null; } };
  const whatsNew = (s) => {
    const notes = String(s.notes || '').trim();
    modal({
      title: `What's new in ${s.version}`,
      body: html`${notes ? html`<div class="whats-new">${notes}</div>` : html`<p>Program Manager was updated to version ${s.version}.</p>`}
        <p class="help"><a href="https://github.com/oofski/ManagementPlatform/releases/tag/v${s.version}" target="_blank" rel="noopener">Full release notes</a></p>`,
      actions: [{ label: 'Close', primary: true }],
    });
    app.ackWhatsNew?.();
    hide();
  };
  const render = (s) => {
    last = s || last;
    if (!s || !['available', 'downloading', 'ready', 'updated'].includes(s.state)) return hide();
    const p = ensure();
    if (s.state === 'available' || s.state === 'downloading') {
      const pct = Math.max(0, Math.min(100, Math.round(s.percent || 0)));
      set(p, html`${icon('download', 14)}<span>Update ${s.version} downloading ${pct}%</span><span class="bar"><i style="width:${pct}%"></i></span>`);
    } else if (s.state === 'ready') {
      set(p, html`${icon('check', 14)}<span>Update ${s.version} is ready</span><button class="sm primary" data-restart>Restart to update</button>`);
      p.querySelector('[data-restart]').onclick = () => app.installUpdate();
    } else {
      set(p, html`<span>Updated to ${s.version}</span><button class="sm" data-new>What's new</button><button class="ghost sm icon" data-x aria-label="Dismiss">${icon('x', 13)}</button>`);
      p.querySelector('[data-new]').onclick = () => whatsNew(s);
      p.querySelector('[data-x]').onclick = () => { app.ackWhatsNew?.(); hide(); };
    }
  };
  app.onUpdateStatus(render);
  Promise.resolve(app.getUpdateStatus?.()).then((s) => { if (s) render(s); }).catch(() => {});
}

function downloadLink() {
  // Phones and tablets cannot run the Windows installer.
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))) return;
  const root = document.getElementById('app');
  if (!root) return;
  const add = () => {
    const me = root.querySelector('#side .me');
    if (!me || me.parentNode.querySelector('.dl-win')) return;
    const a = document.createElement('a');
    a.className = 'dl-win';
    a.href = DOWNLOAD_URL;
    a.setAttribute('download', '');
    a.title = 'Program Manager for Windows. It updates itself.';
    a.innerHTML = html`${icon('download', 14)}<span>Download for Windows</span>`.__html;
    me.parentNode.insertBefore(a, me);
  };
  new MutationObserver(add).observe(root, { childList: true });
  add();
}

if (app) {
  document.documentElement.classList.add('in-desktop');
  updatePill();
} else downloadLink();
