const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DEV_URL = process.env.ELECTRON_RENDERER_URL;

let orbWindow = null;
let dashboardWindow = null;
let gatewayWindow = null;

const configPath = () => path.join(app.getPath('userData'), 'orb-config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  try {
    fs.writeFileSync(configPath(), JSON.stringify(next));
  } catch {}
}

function pageUrl(hash) {
  if (DEV_URL) return `${DEV_URL}/#${hash}`;
  return `file://${path.join(__dirname, '../dist/index.html')}#${hash}`;
}

function workArea() {
  return screen.getPrimaryDisplay().workArea;
}

function clampToWorkArea(x, y, w, h) {
  const wa = workArea();
  return [
    Math.min(Math.max(wa.x, x), wa.x + wa.width - w),
    Math.min(Math.max(wa.y, y), wa.y + wa.height - h),
  ];
}

function createOrbWindow() {
  const wa = workArea();
  orbWindow = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  orbWindow.setAlwaysOnTop(true, 'screen-saver');
  orbWindow.setIgnoreMouseEvents(true, { forward: true });
  orbWindow.once('ready-to-show', () => orbWindow.showInactive());
  orbWindow.loadURL(pageUrl('orb'));
}

function createDashboardWindow() {
  const wa = workArea();
  dashboardWindow = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0a0d0b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  dashboardWindow.loadURL(pageUrl('dashboard'));
  dashboardWindow.once('ready-to-show', () => dashboardWindow.show());
}

function createGatewayWindow() {
  gatewayWindow = new BrowserWindow({
    fullscreenable: true,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0d0b',
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  gatewayWindow.loadURL(pageUrl('gateway'));
}

function toggleDashboard() {
  if (!dashboardWindow) return;
  if (dashboardWindow.isVisible()) {
    dashboardWindow.hide();
  } else {
    dashboardWindow.show();
    dashboardWindow.focus();
  }
}

// Drag: renderer sends absolute center coordinates while dragging.
ipcMain.on('orb:drag', (_e, { centerX, centerY }) => {
  if (!orbWindow) return;
  const [w, h] = orbWindow.getSize();
  const [x, y] = clampToWorkArea(centerX - w / 2, centerY - h / 2, w, h);
  orbWindow.setPosition(x, y);
});

ipcMain.on('orb:dock-end', () => {
  if (!orbWindow) return;
  const [w, h] = orbWindow.getSize();
  const [x, y] = orbWindow.getPosition();
  saveConfig({ dockCenterX: x + w / 2, dockCenterY: y + h / 2 });
});

ipcMain.on('orb:set-hit', (_e, hit) => {
  if (!orbWindow) return;
  if (hit) {
    orbWindow.setIgnoreMouseEvents(false);
  } else {
    orbWindow.setIgnoreMouseEvents(true, { forward: true });
  }
});

ipcMain.on('dashboard:toggle', () => toggleDashboard());
ipcMain.on('dashboard:hide', () => dashboardWindow?.hide());

app.whenReady().then(() => {
  createOrbWindow();
  createDashboardWindow();
  createGatewayWindow();

  globalShortcut.register('Control+Shift+J', () => {
    orbWindow?.webContents.send('orb:summon-toggle');
  });
  globalShortcut.register('Control+Shift+D', () => toggleDashboard());
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
