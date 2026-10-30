const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('drumduino', {
  isElectron: true,
  platform: process.platform,
  onSerialPorts(cb) {
    const listener = (_e, ports) => cb(ports);
    ipcRenderer.on('serial:ports', listener);
    return () => ipcRenderer.removeListener('serial:ports', listener);
  },
  chooseSerialPort(portId) {
    return ipcRenderer.invoke('serial:choose', portId);
  },
  listMyScores() {
    return ipcRenderer.invoke('scores:list');
  },
  openScoresFolder() {
    return ipcRenderer.invoke('scores:openFolder');
  },
  setRecMode(mode) {
    return ipcRenderer.invoke('window:recMode', mode || false);
  }
});
