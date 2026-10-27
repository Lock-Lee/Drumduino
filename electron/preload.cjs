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
  }
});
