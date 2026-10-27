// DrumDuino — Electron main process
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

// Known USB vendor IDs for Arduino boards and common USB-serial chips.
const ARDUINO_VENDORS = new Set([
  '2341', // Arduino SA
  '2a03', // Arduino.org
  '1a86', // CH340 (clone Uno/Nano)
  '0403', // FTDI
  '10c4', // Silicon Labs CP210x
  '1b4f', // SparkFun (Pro Micro)
  '239a'  // Adafruit
]);

let mainWindow = null;
let pendingPortCallback = null;

function hex(n) {
  return (Number(n) || 0).toString(16).padStart(4, '0');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0F1012',
    title: 'DrumDuino',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false // keep audio/input responsive when window is in background
    }
  });

  const ses = mainWindow.webContents.session;

  // Allow Web Serial + Web MIDI for our own page.
  ses.setPermissionCheckHandler((_wc, permission) => {
    return ['serial', 'midi', 'midiSysex'].includes(permission);
  });
  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['serial', 'midi', 'midiSysex'].includes(permission));
  });
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial');

  // navigator.serial.requestPort() → let the renderer show our own picker.
  ses.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault();
    if (pendingPortCallback) pendingPortCallback('');
    pendingPortCallback = callback;
    const ports = portList.map((p) => ({
      portId: p.portId,
      name: p.displayName || p.portName || 'Serial port',
      portName: p.portName || '',
      vendorId: p.vendorId ? hex(parseInt(p.vendorId, 10)) : '',
      likelyArduino: p.vendorId ? ARDUINO_VENDORS.has(hex(parseInt(p.vendorId, 10))) : false
    }));
    mainWindow.webContents.send('serial:ports', ports);
  });

  ipcMain.removeHandler('serial:choose');
  ipcMain.handle('serial:choose', (_e, portId) => {
    if (pendingPortCallback) {
      pendingPortCallback(portId || '');
      pendingPortCallback = null;
    }
    return true;
  });

  // External links open in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
