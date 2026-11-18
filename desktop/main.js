// Program Manager for Windows.
// Connects to your program's hosted server (recommended: everyone shares one database),
// or runs the whole app on this computer. Updates itself from GitHub Releases.
const { app, BrowserWindow, Menu, dialog, shell, ipcMain, net } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* updater unavailable in dev */ }

const CONFIG = () => path.join(app.getPath('userData'), 'config.json');
const readConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG(), 'utf8')); } catch { return null; } };
const writeConfig = (c) => { fs.mkdirSync(path.dirname(CONFIG()), { recursive: true }); fs.writeFileSync(CONFIG(), JSON.stringify(c, null, 2)); };

let win = null;
let server = null; // child process for "this computer" mode
let baseUrl = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function resourcesDir() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
}

function freePort() {
  return new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

async function waitFor(url, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await net.fetch(url); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function startLocalServer(cfg) {
  const port = cfg.port || await freePort();
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    PORT: String(port),
    DB_FILE: path.join(dataDir, 'app.db'),
    APP_URL: `http://localhost:${port}`,
    DEMO_MODE: cfg.demo ? '1' : '0',
    NODE_NO_WARNINGS: '1',
  };
  if (cfg.admin) Object.assign(env, { PROGRAM_NAME: cfg.admin.program, ADMIN_NAME: cfg.admin.name, ADMIN_EMAIL: cfg.admin.email, ADMIN_PASSWORD: cfg.admin.password });
  const logFile = fs.openSync(path.join(dataDir, 'server.log'), 'a');
  server = spawn(process.execPath, [path.join(resourcesDir(), 'server', 'index.js')], { env, cwd: resourcesDir(), stdio: ['ignore', logFile, logFile], windowsHide: true });
  server.on('exit', (code) => {
    server = null;
    if (!quitting && win) dialog.showErrorBox('Program Manager', `The local server stopped (code ${code}). See ${path.join(dataDir, 'server.log')}.`);
  });
  const url = `http://localhost:${port}`;
  if (!(await waitFor(`${url}/api/health`))) throw new Error('The local server did not start. Check server.log in the app data folder.');
  if (cfg.admin) { delete cfg.admin; cfg.port = port; writeConfig(cfg); } // never keep the password on disk
  return url;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 640,
    title: 'Program Manager', backgroundColor: '#fbfbfa', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      additionalArguments: [`--pm-version=${app.getVersion()}`],
    },
  });
  win.once('ready-to-show', () => win.show());
  // Links to other sites (film, Google, docs) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url)) return { action: 'allow' };
    openOutside(url);
    return { action: 'deny' };
  });
  // Everything outside the app opens in the system browser, Google and Clever sign-in included: Google blocks
  // OAuth in embedded browsers, so the web app runs those flows through desktopApp.openExternal and a hand-off.
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:') || sameOrigin(url)) return;
    e.preventDefault();
    openOutside(url);
  });
  win.webContents.on('did-finish-load', () => sendStatus());
  win.on('closed', () => { win = null; });
}

function sameOrigin(url) {
  if (!baseUrl) return false;
  try { return new URL(url).origin === new URL(baseUrl).origin; } catch { return false; }
}
function openOutside(url) {
  try { if (['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) shell.openExternal(url); } catch { /* not a URL */ }
}
// Privileged IPC answers only the app's own pages: the configured server origin or the local setup screen.
function trusted(e) {
  const url = (e.senderFrame && e.senderFrame.url) || '';
  return url.startsWith('file:') || sameOrigin(url);
}

async function openApp() {
  const cfg = readConfig();
  if (!cfg) { baseUrl = null; return win.loadFile(path.join(__dirname, 'setup.html')); }
  try {
    baseUrl = cfg.mode === 'local' ? await startLocalServer(cfg) : cfg.url.replace(/\/+$/, '');
    await win.loadURL(baseUrl);
  } catch (err) {
    const r = await dialog.showMessageBox(win, { type: 'error', title: 'Program Manager', message: 'Could not open Program Manager', detail: `${err.message}\n\nServer: ${cfg.url || 'this computer'}`, buttons: ['Try again', 'Change server', 'Quit'], defaultId: 0 });
    if (r.response === 0) return openApp();
    if (r.response === 1) { stopLocal(); fs.rmSync(CONFIG(), { force: true }); return openApp(); }
    app.quit();
  }
}

function stopLocal() { if (server) { quitting = true; server.kill(); server = null; quitting = false; } }

function buildMenu() {
  const template = [
    { label: 'File', submenu: [
      { label: 'Change server…', click: async () => {
        const r = await dialog.showMessageBox(win, { type: 'question', message: 'Change which server this app uses?', detail: 'Your data stays where it is. You can switch back at any time.', buttons: ['Change', 'Cancel'], defaultId: 0, cancelId: 1 });
        if (r.response === 0) { stopLocal(); fs.rmSync(CONFIG(), { force: true }); openApp(); }
      } },
      { label: 'Open data folder', click: () => shell.openPath(app.getPath('userData')) },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
    { label: 'Help', submenu: [
      status.state === 'ready'
        ? { label: `Restart to update to ${status.version}`, click: () => installNow() }
        : { label: status.state === 'downloading' ? `Downloading update ${status.version} (${Math.round(status.percent || 0)}%)` : 'Check for updates', enabled: status.state !== 'downloading', click: () => checkUpdates(true) },
      { label: `Version ${app.getVersion()}`, enabled: false },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- auto-update (GitHub Releases) ----------
// Fully automatic: checks at launch and every 2 hours, downloads in the background (differential, using the
// .blockmap published next to the installer), shows progress in the taskbar and in the web UI, and installs
// silently when the app quits. "Restart to update" installs right away.
const UPDATE_EVERY_MS = 2 * 60 * 60 * 1000;
const STATE = () => path.join(app.getPath('userData'), 'update-state.json');
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE(), 'utf8')); } catch { return {}; } };
const writeState = (s) => { try { fs.mkdirSync(path.dirname(STATE()), { recursive: true }); fs.writeFileSync(STATE(), JSON.stringify(s, null, 2)); } catch { /* not fatal */ } };
let status = { state: 'idle', current: app.getVersion() };
let manualCheck = false;

function sendStatus() {
  if (!win || win.isDestroyed()) return;
  const url = win.webContents.getURL();
  if (!(url.startsWith('file:') || sameOrigin(url))) return;
  win.webContents.send('update:status', status);
}
let menuKey = '';
function setStatus(next) {
  status = { current: app.getVersion(), ...next };
  sendStatus();
  const key = `${status.state}:${status.version}:${Math.floor((status.percent || 0) / 10)}`;
  if (key !== menuKey) { menuKey = key; buildMenu(); }
}
// GitHub release notes arrive as HTML (or a list of versions); keep plain text for the "What's new" note.
function plainNotes(notes) {
  const text = Array.isArray(notes) ? notes.map((n) => `${n.version}\n${n.note || ''}`).join('\n\n') : String(notes || '');
  return text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d|div)>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
}
const newer = (a, b) => { const p = (v) => String(v).split(/[.-]/).map((x) => parseInt(x, 10) || 0); const x = p(a); const y = p(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

// After an update: show "Updated to 2.0.1 · What's new" until the person dismisses it.
function noteWhatsNew() {
  const s = readState();
  const cur = app.getVersion();
  if (s.lastVersion && s.lastVersion !== cur && newer(cur, s.lastVersion)) {
    s.whatsNew = { version: cur, from: s.lastVersion, notes: s.pending && s.pending.version === cur ? s.pending.notes : '' };
    delete s.pending;
  }
  s.lastVersion = cur;
  writeState(s);
  if (s.whatsNew && s.whatsNew.version === cur) status = { state: 'updated', current: cur, ...s.whatsNew };
}

function checkUpdates(manual = false) {
  if (!autoUpdater || !app.isPackaged) {
    if (manual) dialog.showMessageBox(win, { message: 'Updates are only available in the installed app.' });
    return Promise.resolve(status);
  }
  if (status.state === 'ready') {
    if (manual) dialog.showMessageBox(win, { message: `Version ${status.version} is ready. Choose Help › Restart to update, or it installs when you close the app.` });
    return Promise.resolve(status);
  }
  manualCheck = manual;
  return autoUpdater.checkForUpdates().then(() => status).catch((err) => {
    if (manual) dialog.showMessageBox(win, { type: 'warning', message: 'Could not check for updates', detail: err.message });
    return status;
  });
}
function installNow() {
  if (!autoUpdater || status.state !== 'ready') return false;
  quitting = true;
  stopLocal();
  setImmediate(() => autoUpdater.quitAndInstall(true, true)); // silent install, then reopen the app
  return true;
}
if (autoUpdater) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // silent install when the app is closed
  autoUpdater.disableDifferentialDownload = false; // only the changed blocks are downloaded (blockmap)
  autoUpdater.allowDowngrade = false;
  autoUpdater.on('update-available', (info) => setStatus({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => {
    if (win && !win.isDestroyed()) win.setProgressBar(Math.max(0, Math.min(1, (p.percent || 0) / 100)));
    setStatus({ state: 'downloading', version: status.version, percent: p.percent || 0, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond });
  });
  autoUpdater.on('update-downloaded', (info) => {
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
    const s = readState(); s.pending = { version: info.version, notes: plainNotes(info.releaseNotes) }; writeState(s);
    setStatus({ state: 'ready', version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    if (manualCheck) dialog.showMessageBox(win, { message: `You have the latest version (${app.getVersion()}).` });
    if (status.state !== 'updated') setStatus({ state: 'idle' });
    manualCheck = false;
  });
  autoUpdater.on('error', (err) => {
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
    if (manualCheck) dialog.showMessageBox(win, { type: 'warning', message: 'Could not update Program Manager', detail: err ? err.message : '' });
    manualCheck = false;
    if (status.state !== 'ready' && status.state !== 'updated') setStatus({ state: 'error', message: err ? err.message : 'Update failed' });
  });
}

ipcMain.handle('update:status', (e) => (trusted(e) ? status : null));
ipcMain.handle('update:check', (e) => (trusted(e) ? checkUpdates(true) : null));
ipcMain.handle('update:install', (e) => (trusted(e) ? installNow() : false));
ipcMain.handle('update:ack', (e) => {
  if (!trusted(e)) return false;
  const s = readState(); delete s.whatsNew; writeState(s);
  if (status.state === 'updated') setStatus({ state: 'idle' });
  return true;
});
ipcMain.handle('desktop:open-external', (e, url) => {
  if (!trusted(e)) return false;
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    shell.openExternal(u.toString());
    return true;
  } catch { return false; }
});

// ---------- setup screen IPC ----------
ipcMain.handle('setup:test', async (e, url) => {
  if (!e.senderFrame || !e.senderFrame.url.startsWith('file:')) return { ok: false, error: 'Not allowed' };
  try {
    const u = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`);
    const r = await net.fetch(`${u.origin}/api/health`);
    const ok = r.ok && (await r.json()).ok;
    return { ok, url: u.origin, error: ok ? null : `That address answered, but it is not a Program Manager server (HTTP ${r.status}).` };
  } catch (err) { return { ok: false, error: `Could not reach that address: ${err.message}` }; }
});
ipcMain.handle('setup:save', async (e, cfg) => {
  if (!e.senderFrame || !e.senderFrame.url.startsWith('file:')) return false;
  if (cfg.mode === 'remote') writeConfig({ mode: 'remote', url: cfg.url });
  else writeConfig({ mode: 'local', demo: !!cfg.demo, admin: cfg.demo ? undefined : cfg.admin });
  await openApp();
  return true;
});

app.whenReady().then(async () => {
  noteWhatsNew();
  buildMenu();
  createWindow();
  await openApp();
  // Check at launch and every 2 hours; downloads and installs happen on their own.
  setTimeout(() => checkUpdates(false), 4000);
  setInterval(() => checkUpdates(false), UPDATE_EVERY_MS);
});
app.on('before-quit', () => { quitting = true; if (server) server.kill(); });
app.on('window-all-closed', () => app.quit());
