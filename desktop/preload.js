// Exposes only what the first-run setup screen needs.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopSetup', {
  test: (url) => ipcRenderer.invoke('setup:test', url),
  save: (cfg) => ipcRenderer.invoke('setup:save', cfg),
});
