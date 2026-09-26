import { app, BrowserWindow, dialog, ipcMain, Menu, net, Notification, protocol, shell, Tray } from 'electron';
import { dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import electronUpdater from 'electron-updater';
import { LumilanPeer } from './peer.js';
import { locales, translate } from './public/i18n.js';
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
let activeUpload;
const activeNotifications = new Map();
let notificationError = '';
let refreshingNetwork = false;
const tr = (source, values) => translate(settings?.language || 'id', source, values);

function startupPath() {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart', 'lumilan-chat.desktop');
}

function startupExecutable() {
  return process.platform === 'linux' ? process.env.APPIMAGE : process.execPath;
}

function desktopExec(path) {
  if (/[\r\n]/.test(path)) throw new Error('Lokasi aplikasi tidak valid untuk autostart.');
  return '"' + path.replace(/[\\"`$]/g, '\\$&').replace(/%/g, '%%') + '"';
}

function startupStatus() {
  const supported = app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin' ||
    process.platform === 'linux' && Boolean(startupExecutable()));
  if (!supported) return { supported: false, enabled: false };
  try {
    if (process.platform !== 'linux') {
      const login = app.getLoginItemSettings();
      return { supported: true, enabled: login.openAtLogin && login.enabled !== false };
    }
    const path = startupPath();
    const contents = existsSync(path) ? readFileSync(path, 'utf8') : '';
    return { supported: true, enabled: contents.includes('X-Lumilan-Chat=true') &&
      contents.includes(`Exec=${desktopExec(startupExecutable())}`) };
  } catch (error) {
    console.warn('Status autostart tidak dapat dibaca:', error);
    return { supported: false, enabled: false };
  }
}

function setStartup(value) {
  if (typeof value !== 'boolean' || !startupStatus().supported) throw new Error('Autostart tidak tersedia untuk paket aplikasi ini.');
  if (process.platform !== 'linux') {
    app.setLoginItemSettings({ openAtLogin: value });
  } else {
    const path = startupPath();
    if (value) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, `[Desktop Entry]\nType=Application\nName=Lumilan Chat\nExec=${desktopExec(startupExecutable())}\nTerminal=false\nX-Lumilan-Chat=true\n`, { mode: 0o600 });
    } else if (existsSync(path) && readFileSync(path, 'utf8').includes('X-Lumilan-Chat=true')) {
      unlinkSync(path);
    }
  }
  const result = startupStatus();
  if (result.enabled !== value) throw new Error('Pengaturan autostart tidak berhasil diterapkan.');
  return result;
}

function updateTrayMenu() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: tr('Buka Lumilan Chat'), click: () => reveal() },
    { label: tr('Periksa pembaruan'), click: () => { reveal(); void checkUpdates(true); } },
    { type: 'separator' },
    { label: tr('Keluar'), click: () => app.quit() },
  ]));
}

function dismiss(thread) {
  for (const [id, entry] of activeNotifications) if (entry.thread === thread) {
    entry.notification.close();
    activeNotifications.delete(id);
  }
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
  const count = Object.values(peer.snapshot().unread).reduce((sum, value) => sum + value, 0);
  if (process.platform !== 'win32') app.setBadgeCount(count);
  if (tray) tray.setToolTip(count ? tr('Lumilan Chat · {count} belum dibaca', { count }) : 'Lumilan Chat');
  if (window && !window.isDestroyed()) window.setTitle(count ? `Lumilan Chat (${count})` : 'Lumilan Chat');
}

function notify(message) {
  const thread = message.to === null ? null : message.from;
  if (window?.isFocused() && !window.webContents.isLoading() && currentThread === thread) {
    peer.markRead(thread);
    return;
  }
  if (!settings.enabled || peer.state.status === 'dnd') return;
  if (!Notification.isSupported()) {
    notificationError = 'Sistem operasi tidak menyediakan layanan notifikasi desktop.';
    return;
  }
  const key = thread || 'room';
  const name = peer.trusted.get(message.from)?.name || tr('Teman');
  const title = !settings.preview ? 'Lumilan Chat' : message.to === null ? tr('Ruang umum - Lumilan Chat') : name;
  const content = message.kind === 'file' ? tr('File: {name}', { name: message.name })
    : message.text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').slice(0, 120);
  const body = settings.preview ? message.to === null ? tr('{name}: {content}', { name, content }) : content
    : message.kind === 'file' ? tr('File baru diterima') : tr('Pesan baru diterima');
  try {
    const notification = new Notification({
      id: message.id, groupId: key, title,
      body, silent: settings.silent, urgency: 'normal',
      ...(process.platform === 'darwin' && !settings.silent ? { sound: 'default' } : {}),
    });
    activeNotifications.set(message.id, { thread, notification });
    if (activeNotifications.size > 100) activeNotifications.delete(activeNotifications.keys().next().value);
    notification.on('show', () => { notificationError = ''; });
    notification.on('click', () => { dismiss(thread); reveal(thread); });
    notification.on('close', () => activeNotifications.delete(message.id));
    notification.on('failed', (_event, error) => {
      activeNotifications.delete(message.id);
      notificationError = String(error || 'Notifikasi ditolak oleh sistem.');
      console.warn('Notifikasi gagal:', notificationError);
    });
    notification.show();
  } catch (error) {
    notificationError = String(error.message || error);
    console.warn('Notifikasi gagal:', error);
  }
}

async function testNotification() {
  if (!Notification.isSupported()) return { shown: false, error: 'Notifikasi desktop tidak tersedia pada sistem ini.' };
  if (peer.state.status === 'dnd') return { shown: false, error: 'Status Jangan ganggu sedang aktif.' };
  return new Promise(resolve => {
    const notification = new Notification({
      title: 'Lumilan Chat', body: tr('Ini notifikasi uji. Suara mengikuti pengaturan perangkat.'),
      silent: settings.silent, urgency: 'normal',
      ...(process.platform === 'darwin' && !settings.silent ? { sound: 'default' } : {}),
    });
    const timer = setTimeout(() => {
      notificationError = 'Sistem tidak mengonfirmasi notifikasi. Periksa izin notifikasi aplikasi.';
      resolve({ shown: false, error: notificationError });
    }, 5000);
    notification.once('show', () => {
      clearTimeout(timer);
      notificationError = '';
      resolve({ shown: true });
    });
    notification.once('failed', (_event, error) => {
      clearTimeout(timer);
      notificationError = String(error || 'Notifikasi ditolak sistem.');
      resolve({ shown: false, error: notificationError });
    });
    notification.on('click', () => reveal());
    try { notification.show(); }
    catch (error) {
      clearTimeout(timer);
      notificationError = String(error.message || error);
      resolve({ shown: false, error: notificationError });
    }
  });
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
  if (!/^\/(index\.html|app\.css|app\.js|i18n\.js|fonts\/PublicSans\.ttf)$/.test(path)) return null;
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
  settings = { enabled: settings.enabled !== false, preview: settings.preview === true, silent: settings.silent === true, background: settings.background !== false, language: locales[settings.language] ? settings.language : 'id' };
  peer = await new LumilanPeer({ dataDir, acceptFile: async ({ fromName, name, size }) => {
    if (!window || window.isDestroyed()) return false;
    if (!window.isVisible()) window.show();
    const { response } = await dialog.showMessageBox(window, {
      type: 'question', title: tr('File masuk'),
      message: tr('Terima file {name} ({size} MB) dari {sender}?', { name, size: (size / 1024 / 1024).toFixed(1), sender: fromName }),
      detail: tr('File akan disimpan di data Lumilan Chat pada perangkat ini.'),
      buttons: [tr('Tolak'), tr('Terima file')], defaultId: 0, cancelId: 0, noLink: true,
    });
    return response === 1;
  } }).start();
  peer.on('change', () => {
    if (!peer.node) return;
    updateBadge();
    if (window && !window.isDestroyed()) window.webContents.send('lumilan:state', peer.snapshot());
  });
  peer.on('incoming', notify);
  setInterval(() => peer.maintainConnections(), 15_000).unref();
  setInterval(() => {
    if (quitting || refreshingNetwork) return;
    refreshingNetwork = true;
    peer.refreshNetwork().catch(error => console.warn('Perubahan jaringan gagal diproses:', error))
      .finally(() => { refreshingNetwork = false; });
  }, 5000).unref();
  if (process.platform === 'win32' && Notification.handleActivation) Notification.handleActivation(() => reveal());
  try {
    tray = new Tray(join(here, 'build', process.platform === 'win32' ? 'icon.ico' : process.platform === 'darwin' ? 'trayTemplate.png' : 'icon.png'));
    updateTrayMenu();
    tray.on('click', () => reveal());
  } catch (error) { console.warn('Tray tidak tersedia:', error); }
  updateBadge();

  handler('state', () => peer.snapshot());
  handler('rename', name => peer.rename(name));
  handler('set-profile', value => peer.setProfile(value));
  handler('check-updates', () => checkUpdates(true));
  handler('test-notification', testNotification);
  handler('message', (text, to) => peer.sendMessage(text, to));
  handler('file', async (path, to) => {
    if (activeUpload) throw new Error('Pengiriman file lain masih berlangsung.');
    const controller = new AbortController();
    activeUpload = controller;
    try {
      return await peer.sendFilePath(path, to, { signal: controller.signal, onProgress: (sent, total) => {
        if (window && !window.isDestroyed()) window.webContents.send('lumilan:file-progress', { sent, total });
      } });
    } finally { activeUpload = undefined; }
  });
  handler('cancel-file', () => { activeUpload?.abort(new Error('Pengiriman dibatalkan.')); return true; });
  handler('list-files', (thread, offset) => peer.listFiles(thread, offset));
  handler('list-messages', (thread, before) => peer.listMessages(thread, before));
  handler('save-file', async id => {
    const file = peer.filePath(id);
    const result = await dialog.showSaveDialog(window, { defaultPath: file.name, properties: ['createDirectory', 'showOverwriteConfirmation'] });
    if (!result.canceled && result.filePath) await copyFile(file.path, result.filePath);
    return !result.canceled;
  });
  handler('current-thread', thread => {
    if (thread !== null && (typeof thread !== 'string' || !/^[a-zA-Z0-9]{30,100}$/.test(thread))) throw new Error('Percakapan tidak valid.');
    currentThread = thread;
    if (window?.isFocused()) { peer.markRead(thread); dismiss(thread); }
  });
  handler('notification-settings', () => ({ ...settings, supported: Notification.isSupported(), error: notificationError, tray: Boolean(tray), version: app.getVersion(), platform: process.platform }));
  handler('startup-settings', startupStatus);
  handler('set-language', value => {
    if (!locales[value]) throw new Error('Bahasa tidak didukung.');
    settings.language = value;
    const temporary = `${settingsPath}.tmp`;
    writeFileSync(temporary, JSON.stringify(settings), { mode: 0o600 });
    renameSync(temporary, settingsPath);
    updateTrayMenu();
    updateBadge();
    return value;
  });
  handler('set-startup', setStartup);
  handler('set-notification-settings', value => {
    if (!value || typeof value !== 'object' || !['enabled', 'preview', 'silent', 'background'].every(key => typeof value[key] === 'boolean')) throw new Error('Pengaturan tidak valid.');
    const next = { enabled: value.enabled, preview: value.preview, silent: value.silent, background: value.background, language: settings.language };
    const temporary = `${settingsPath}.tmp`;
    writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
    renameSync(temporary, settingsPath);
    settings = next;
    if (!settings.enabled) for (const { thread } of activeNotifications.values()) dismiss(thread);
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
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'https://iyansanjaya.com/') {
      setImmediate(() => {
        void shell.openExternal(url).catch(error => console.warn('Gagal membuka situs pengembang:', error));
      });
    }
    return { action: 'deny' };
  });
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
  checkUpdates = startUpdates({
    app, updater: autoUpdater, dialog,
    getWindow: () => { reveal(); return window; },
    beforeInstall: () => { quitting = true; },
    translate: tr,
    openRelease: url => shell.openExternal(url),
  });
  await window.loadURL(mainUrl);
}).catch(error => {
  console.error(error);
  dialog.showErrorBox('Lumilan Chat gagal dimulai', error.message);
  app.quit();
});

app.on('before-quit', () => { quitting = true; peer?.stop().catch(() => {}); });
app.on('window-all-closed', () => app.quit());
app.on('activate', () => reveal());
