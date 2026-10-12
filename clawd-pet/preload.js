const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pet', {
  getBounds: () => ipcRenderer.invoke('get-bounds'),
  setPos: (x, y) => ipcRenderer.send('set-pos', x, y),
  menu: () => ipcRenderer.send('menu'),
  onCommand: (cb) => ipcRenderer.on('command', (_e, c) => cb(c)),
});
