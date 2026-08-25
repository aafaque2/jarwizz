const { contextBridge, ipcRenderer } = require('electron');

const summonListeners = new Map();

contextBridge.exposeInMainWorld('jarwizz', {
  setHit: (hit) => ipcRenderer.send('orb:set-hit', hit),
  drag: (centerX, centerY) => ipcRenderer.send('orb:drag', { centerX, centerY }),
  dockEnd: () => ipcRenderer.send('orb:dock-end'),
  toggleDashboard: () => ipcRenderer.send('dashboard:toggle'),
  hideDashboard: () => ipcRenderer.send('dashboard:hide'),
  onSummonToggle: (cb) => {
    const wrapped = () => cb();
    summonListeners.set(cb, wrapped);
    ipcRenderer.on('orb:summon-toggle', wrapped);
  },
  offSummonToggle: (cb) => {
    const wrapped = summonListeners.get(cb);
    if (wrapped) {
      ipcRenderer.removeListener('orb:summon-toggle', wrapped);
      summonListeners.delete(cb);
    }
  },
});
