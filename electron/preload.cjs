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
  },
  // iPhone / iPad pads over Wi-Fi
  remoteStart() {
    return ipcRenderer.invoke('remote:start');
  },
  remoteStop() {
    return ipcRenderer.invoke('remote:stop');
  },
  remoteState(state) {
    ipcRenderer.send('remote:state', state);
  },
  remoteFlash(pad, v) {
    ipcRenderer.send('remote:flash', pad, v);
  },
  remoteCues(list) {
    ipcRenderer.send('remote:cues', list);
  },
  onRemote(cb) {
    const l = (_e, msg) => cb(msg);
    ipcRenderer.on('remote:msg', l);
    return () => ipcRenderer.removeListener('remote:msg', l);
  },
  onRemoteClients(cb) {
    const l = (_e, n) => cb(n);
    ipcRenderer.on('remote:clients', l);
    return () => ipcRenderer.removeListener('remote:clients', l);
  }
});
