// Bridges between the web page and the Windows app. contextIsolation stays on: the page only gets these
// functions, and main.js answers them only for the app's own server origin or its local setup page.
const { contextBridge, ipcRenderer } = require('electron');

// First-run setup screen (desktop/setup.html).
contextBridge.exposeInMainWorld('desktopSetup', {
  test: (url) => ipcRenderer.invoke('setup:test', url),
  save: (cfg) => ipcRenderer.invoke('setup:save', cfg),
});

// The web app detects the Windows app with window.desktopApp.isDesktop.
const arg = (name) => (process.argv.find((a) => a.startsWith(`--pm-${name}=`)) || '').split('=').slice(1).join('=');
contextBridge.exposeInMainWorld('desktopApp', {
  isDesktop: true,
  version: arg('version'),
  platform: process.platform,
  // Google and Clever sign-in run in the system browser (Google blocks sign-in inside app windows).
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', String(url)),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  ackWhatsNew: () => ipcRenderer.invoke('update:ack'),
  onUpdateStatus: (cb) => {
    const h = (_e, s) => { try { cb(s); } catch { /* page handler failed */ } };
    ipcRenderer.on('update:status', h);
    return () => ipcRenderer.removeListener('update:status', h);
  },
});
