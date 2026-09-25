import { app, BrowserWindow, dialog, ipcMain, Menu, net, Notification, protocol, Tray } from 'electron';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import electronUpdater from 'electron-updater';
import { LumilanPeer } from './peer.js';
import { startUpdates } from './updates.js';

const { autoUpdater } = electronUpdater;

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, 'public');
const iconDir = join(here, 'node_modules', 'reicon');
const mainUrl = 'lumilan://app/index.html';

protocol.registerSchemesAsPrivileged([{ scheme: 'lumilan', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.setName('Lumilan Chat');
// Keep the existing identity and chat history after the rename.
app.setPath('userData', join(app.getPath('appData'), 'Lumilan'));
if (process.platform === 'win32') app.setAppUserModelId('dev.lumilan.desktop');

const instanceLock = app.requestSingleInstanceLock();
if (!instanceLock) app.quit();
else app.on('second-instance', () => reveal());

let window;
let peer;
let tray;
let quitting = false;
let currentThread = null;
let settings;
let settingsPath;
let pendingThread;
let checkUpdates = () => Promise.resolve();
const activeNotifications = new Map();
const lastNotified = new Map();

function dismiss(thread) {
  const key = thread || 'room';
  activeNotifications.get(key)?.close();
  activeNotifications.delete(key);
}

function reveal(thread) {
  if (!window || window.isDestroyed()) return;
  if (thread !== undefined) pendingThread = thread;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (pendingThread !== undefined && !window.webContents.isLoading()) {
    window.webContents.send('lumilan:open-thread', pendingThread);
    pendingThread = undefined;
  }
}

function updateBadge() {
  const count = Object.values(peer.state.unread).reduce((sum, value) => sum + value, 0);
  if (process.platform !== 'win32') app.setBadgeCount(count);
  if (tray) tray.setToolTip(count ? `Lumilan Chat · ${count} belum dibaca` : 'Lumilan Chat');
  if (window && !window.isDestroyed()) window.setTitle(count ? `Lumilan Chat (${count})` : 'Lumilan Chat');
}

function notify(message) {
  const thread = message.to === null ? null : message.from;
  if (window?.isFocused() && !window.webContents.isLoading() && currentThread === thread) {
    peer.markRead(thread);
    return;
  }
  if (!settings.enabled || !Notification.isSupported()) return;
  const key = thread || 'room';
  const now = Date.now();
  if (now - (lastNotified.get(key) || 0) < 2000) return;
  lastNotified.set(key, now);
  const name = peer.trusted.get(message.from)?.name || 'Teman';
  const body = settings.preview
    ? message.kind === 'file' ? `${name}: ${message.name}` : `${name}: ${message.text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').slice(0, 120)}`
    : message.kind === 'file' ? 'File baru diterima' : 'Pesan baru diterima';
  try {
    dismiss(thread);
    const notification = new Notification({ id: `thread:${key}`, groupId: key, title: 'Lumilan Chat', body, silent: settings.silent });
    activeNotifications.set(key, notification);
    notification.on('click', () => reveal(thread));
    notification.on('close', () => { if (activeNotifications.get(key) === notification) activeNotifications.delete(key); });
    notification.on('failed', (_event, error) => { if (activeNotifications.get(key) === notification) activeNotifications.delete(key); console.warn('Notifikasi gagal:', error); });
    notification.show();
  } catch (error) { console.warn('Notifikasi gagal:', error); }
}

function assetPath(url) {
  const target = new URL(url);
  if (target.protocol !== 'lumilan:' || target.host !== 'app') return null;
  const path = decodeURIComponent(target.pathname);
  if (path.startsWith('/reicon/')) {
    const relative = path.slice('/reicon/'.length);
    if (relative !== 'createIcon.js' && !/^icons\/[A-Za-z]+\.js$/.test(relative)) return null;
    return join(iconDir, relative);
  }
  if (!/^\/(index\.html|app\.css|app\.js|fonts\/PublicSans\.ttf)$/.test(path)) return null;
  const file = resolve(publicDir, `.${path}`);
  return file.startsWith(publicDir + sep) ? file : null;
}

function checkSender(event) {
  if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || event.sender.getURL() !== mainUrl) throw new Error('Permintaan ditolak.');
}

function handler(name, action) {
  ipcMain.handle(`lumilan:${name}`, async (event, ...args) => {
    checkSender(event);
    return action(...args);
  });
}

if (instanceLock) app.whenReady().then(async () => {
  protocol.handle('lumilan', request => {
    const path = assetPath(request.url);
    return path && existsSync(path) ? net.fetch(pathToFileURL(path).toString()) : new Response('Not found', { status: 404 });
  });

  const dataDir = join(app.getPath('userData'), 'lumilan');
  mkdirSync(dataDir, { recursive: true });
  settingsPath = join(dataDir, 'notifications.json');
  try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); }
  catch { settings = {}; }
  if (!settings || typeof settings !== 'object') settings = {};
  settings = { enabled: settings.enabled !== false, preview: settings.preview === true, silent: settings.silent === true, background: settings.background !== false };
  peer = await new LumilanPeer({ dataDir }).start();
  peer.on('change', () => {
    updateBadge();
    if (window && !window.isDestroyed()) window.webContents.send('lumilan:state', peer.snapshot());
  });
  peer.on('incoming', notify);
  if (process.platform === 'win32' && Notification.handleActivation) Notification.handleActivation(() => reveal());
  try {
    tray = new Tray(join(here, 'build', process.platform === 'win32' ? 'icon.ico' : process.platform === 'darwin' ? 'trayTemplate.png' : 'icon.png'));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Buka Lumilan Chat', click: () => reveal() },
      { label: 'Periksa pembaruan', click: () => { reveal(); void checkUpdates(true); } },
      { type: 'separator' },
      { label: 'Keluar', click: () => app.quit() },
    ]));
    tray.on('click', () => reveal());
  } catch (error) { console.warn('Tray tidak tersedia:', error); }
  updateBadge();

  handler('state', () => peer.snapshot());
  handler('rename', name => peer.rename(name));
  handler('message', (text, to) => peer.sendMessage(text, to));
  handler('file', (name, bytes, to) => peer.sendFile(name, bytes, to));
  handler('save-file', async id => {
    const file = peer.file(id);
    const result = await dialog.showSaveDialog(window, { defaultPath: file.name, properties: ['createDirectory', 'showOverwriteConfirmation'] });
    if (!result.canceled && result.filePath) writeFileSync(result.filePath, file.bytes);
    return !result.canceled;
  });
  handler('current-thread', thread => {
    if (thread !== null && (typeof thread !== 'string' || !/^[a-zA-Z0-9]{30,100}$/.test(thread))) throw new Error('Percakapan tidak valid.');
    currentThread = thread;
    if (window?.isFocused()) { peer.markRead(thread); dismiss(thread); }
  });
  handler('notification-settings', () => ({ ...settings, supported: Notification.isSupported(), tray: Boolean(tray), version: app.getVersion() }));
  handler('set-notification-settings', value => {
    if (!value || typeof value !== 'object' || !['enabled', 'preview', 'silent', 'background'].every(key => typeof value[key] === 'boolean')) throw new Error('Pengaturan tidak valid.');
    const next = { enabled: value.enabled, preview: value.preview, silent: value.silent, background: value.background };
    const temporary = `${settingsPath}.tmp`;
    writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
    renameSync(temporary, settingsPath);
    settings = next;
    if (!settings.enabled) for (const key of activeNotifications.keys()) dismiss(key === 'room' ? null : key);
    return { ...settings, supported: Notification.isSupported(), tray: Boolean(tray) };
  });
  handler('quit', () => app.quit());

  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'Lumilan Chat',
    backgroundColor: '#f6f8fc',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  if (process.platform !== 'darwin') window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  updateBadge();
  window.webContents.on('will-navigate', (event, url) => { if (url !== mainUrl) event.preventDefault(); });
  window.webContents.on('did-finish-load', () => {
    if (pendingThread !== undefined) {
      window.webContents.send('lumilan:open-thread', pendingThread);
      pendingThread = undefined;
    }
  });
  window.on('focus', () => { peer.markRead(currentThread); dismiss(currentThread); });
  window.on('close', event => {
    if (!quitting && settings.background && tray) { event.preventDefault(); window.hide(); }
  });
  window.once('ready-to-show', () => window.show());
  await window.loadURL(mainUrl);
  checkUpdates = startUpdates({
    app, updater: autoUpdater, dialog,
    getWindow: () => { reveal(); return window; },
    beforeInstall: () => { quitting = true; },
  });
}).catch(error => {
  console.error(error);
  dialog.showErrorBox('Lumilan Chat gagal dimulai', error.message);
  app.quit();
});

app.on('before-quit', () => { quitting = true; peer?.stop().catch(() => {}); });
app.on('window-all-closed', () => app.quit());
app.on('activate', () => reveal());
