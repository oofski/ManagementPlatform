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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  // Links to other sites (film, Google, docs) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (baseUrl && url.startsWith(baseUrl)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:') || (baseUrl && url.startsWith(baseUrl))) return;
    if (/accounts\.google\.com|oauth2|googleapis/.test(url)) return; // Google sign-in happens in the window
    e.preventDefault();
    shell.openExternal(url);
  });
  win.on('closed', () => { win = null; });
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
      { label: 'Check for updates', click: () => checkUpdates(true) },
      { label: `Version ${app.getVersion()}`, enabled: false },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- auto-update (GitHub Releases) ----------
function checkUpdates(manual = false) {
  if (!autoUpdater || !app.isPackaged) {
    if (manual) dialog.showMessageBox(win, { message: 'Updates are only available in the installed app.' });
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.checkForUpdates().then((r) => {
    if (manual && (!r || !r.updateInfo || r.updateInfo.version === app.getVersion())) dialog.showMessageBox(win, { message: `You have the latest version (${app.getVersion()}).` });
  }).catch((err) => { if (manual) dialog.showMessageBox(win, { type: 'warning', message: 'Could not check for updates', detail: err.message }); });
}
if (autoUpdater) {
  autoUpdater.on('update-available', (info) => { if (win) win.setTitle(`Program Manager — downloading update ${info.version}…`); });
  autoUpdater.on('update-downloaded', async (info) => {
    if (win) win.setTitle('Program Manager');
    const r = await dialog.showMessageBox(win, { type: 'info', title: 'Update ready', message: `Version ${info.version} is ready to install.`, detail: 'Restart now to update, or it will install the next time you close the app.', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1 });
    if (r.response === 0) { quitting = true; stopLocal(); autoUpdater.quitAndInstall(); }
  });
  autoUpdater.on('error', () => { if (win) win.setTitle('Program Manager'); });
}

// ---------- setup screen IPC ----------
ipcMain.handle('setup:test', async (e, url) => {
  if (!e.senderFrame.url.startsWith('file:')) return { ok: false, error: 'Not allowed' };
  try {
    const u = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`);
    const r = await net.fetch(`${u.origin}/api/health`);
    const ok = r.ok && (await r.json()).ok;
    return { ok, url: u.origin, error: ok ? null : `That address answered, but it is not a Program Manager server (HTTP ${r.status}).` };
  } catch (err) { return { ok: false, error: `Could not reach that address: ${err.message}` }; }
});
ipcMain.handle('setup:save', async (e, cfg) => {
  if (!e.senderFrame.url.startsWith('file:')) return false;
  if (cfg.mode === 'remote') writeConfig({ mode: 'remote', url: cfg.url });
  else writeConfig({ mode: 'local', demo: !!cfg.demo, admin: cfg.demo ? undefined : cfg.admin });
  await openApp();
  return true;
});

app.whenReady().then(async () => {
  buildMenu();
  createWindow();
  await openApp();
  setTimeout(() => checkUpdates(false), 4000);
  setInterval(() => checkUpdates(false), 6 * 60 * 60 * 1000);
});
app.on('before-quit', () => { quitting = true; if (server) server.kill(); });
app.on('window-all-closed', () => app.quit());
