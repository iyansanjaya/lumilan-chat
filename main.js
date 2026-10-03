import { app, BrowserWindow, dialog, ipcMain, Menu, net, Notification, powerMonitor, protocol, screen, session, shell, systemPreferences, Tray } from 'electron';
import { dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import electronUpdater from 'electron-updater';
import { LumilanPeer } from './peer.js';
import { previewImage } from './preview-image.js';
import { languageForRegion, languageSettings, locales, translate } from './public/i18n.js';
import { startUpdates } from './updates.js';
import { clearPendingDefaultStartup, enableDefaultStartup } from './startup-default.js';
import { LumiNotch } from './notch.js';
import { LinuxScreenLock } from './linux-screen-lock.js';

const { autoUpdater } = electronUpdater;

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, 'public');
const iconDir = join(here, 'node_modules', 'reicon');
const mainUrl = 'lumilan://app/index.html';

protocol.registerSchemesAsPrivileged([{ scheme: 'lumilan', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.setName('Lumilan Chat');
// Keep the existing identity and chat history after the rename.
const userDataOverride = app.commandLine.getSwitchValue('user-data-dir');
app.setPath('userData', userDataOverride ? resolve(userDataOverride) : join(app.getPath('appData'), 'Lumilan'));
if (process.platform === 'win32') app.setAppUserModelId('dev.lumilan.desktop');

const instanceLock = app.requestSingleInstanceLock();
if (!instanceLock) app.quit();
else app.on('second-instance', () => reveal());

let window;
let mainPresented = false;
let peer;
let tray;
let quitting = false;
let currentThread = null;
let settings;
let settingsPath;
let pendingThread;
let openingThread;
let checkUpdates = () => Promise.resolve();
let activeUpload;
const pendingFileOffers = new Map();
let deletingHistory = 0;
const previewRequests = new Set();
const activeNotifications = new Map();
let notificationError = '';
let callNotification;
let refreshingNetwork = false;
let notch;
let linuxScreenLock;
let positionSaveTimer;
const reminderBlocks = new Set();
const deferredReminders = new Map();
const deferredMessages = new Map();
const reminderNotifications = new Map();
const tr = (source, values) => translate(settings?.language || 'id', source, values);

function persistSettings() {
  const temporary = `${settingsPath}.tmp`;
  writeFileSync(temporary, JSON.stringify(settings), { mode: 0o600 });
  renameSync(temporary, settingsPath);
}

function decideFile(id, accepted) {
  if (typeof id !== 'string' || typeof accepted !== 'boolean' || !pendingFileOffers.has(id)) throw new Error('Permintaan file sudah tidak tersedia.');
  pendingFileOffers.get(id).decide(accepted);
  if (!accepted) notch?.remove(`file:${id}`);
  else notch?.transfer({ id, status: 'receiving' });
  if (window && !window.isDestroyed()) window.webContents.send('lumilan:file-transfer', { id, status: accepted ? 'receiving' : 'canceled', received: 0 });
  return true;
}

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
    { label: tr('Tampilkan Lumi'), enabled: Boolean(notch?.supported && settings?.notch && settings?.enabled), click: () => {
      if (!window || window.isDestroyed()) return;
      window.hide(); notch.pausedUntil = 0; notch.setMode('expanded');
    } },
    { label: tr('Periksa pembaruan'), click: () => { reveal(); void checkUpdates(true); } },
    { type: 'separator' },
    { label: tr('Keluar'), click: () => app.quit() },
  ]));
}

function dismiss(thread) {
  notch?.dismiss(thread);
  for (const [id, entry] of activeNotifications) if (entry.thread === thread) {
    entry.notification.close();
    activeNotifications.delete(id);
  }
}

function reveal(thread) {
  if (!window || window.isDestroyed()) return;
  if (thread !== undefined) { pendingThread = thread; openingThread = thread; }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (pendingThread !== undefined && !window.webContents.isLoading()) {
    window.webContents.send('lumilan:open-thread', pendingThread);
    pendingThread = undefined;
  }
}

function notifyReminder(event) {
  if (reminderBlocks.size) {
    for (const item of event.items) {
      if (deferredReminders.size >= 512 && !deferredReminders.has(item.id)) deferredReminders.delete(deferredReminders.keys().next().value);
      deferredReminders.set(item.id, event.type);
    }
    return;
  }
  if (!settings.enabled || peer.state.status === 'dnd') return;
  const items = event.items.filter(r => r.kind !== 'incoming' || !peer.state.mutedThreads.includes(r.from));
  if (!items.length) return;
  const title = event.type === 'request' ? tr('Permintaan pengingat') : tr(event.missed ? 'Pengingat terlewat' : 'Pengingat jatuh tempo');
  if(window&&!window.isDestroyed()) window.webContents.send('lumilan:reminder',{type:event.type,missed:Boolean(event.missed)});
  const body = items.length > 1 ? tr('{count} pengingat menunggu Anda.',{count:items.length}) : items[0].title;
  if (notch?.reminder({...event,items})) return;
  if (!Notification.isSupported()) return;
  try {
    const notification = new Notification({title:settings.preview ? title : 'Lumilan Chat',body:settings.preview ? body : tr('Buka Pengingat untuk melihat detail.'),silent:settings.silent});
    const key=event.type==='request'?items[0].id:'due';
    reminderNotifications.get(key)?.notification.close();
    reminderNotifications.set(key,{notification,ids:items.map(r=>r.id),status:event.type==='request'?'pending':'due'});
    notification.on('close',()=>{if(reminderNotifications.get(key)?.notification===notification) reminderNotifications.delete(key);});
    notification.on('click',()=>{notification.close();reveal('reminders');}); notification.show();
  } catch (error) { console.warn('Notifikasi pengingat gagal:',error); }
}

function readingWindow() {
  return !reminderBlocks.size && window && !window.isDestroyed() && window.isVisible() && !window.isMinimized() && window.isFocused();
}

function updateBadge() {
  const count = Object.values(peer.snapshot().unread).reduce((sum, value) => sum + value, 0);
  if (process.platform !== 'win32') app.setBadgeCount(count);
  if (tray) tray.setToolTip(count ? tr('Lumilan Chat · {count} belum dibaca', { count }) : 'Lumilan Chat');
  if (window && !window.isDestroyed()) window.setTitle(count ? `Lumilan Chat (${count})` : 'Lumilan Chat');
}

function notify(message) {
  const thread = message.roomId ? `room:${message.roomId}` : message.kind === 'announcement' ? 'announcements' : message.from;
  if (readingWindow() && openingThread === undefined && !window.webContents.isLoading() && currentThread === thread) {
    peer.markRead(thread);
    return;
  }
  if (peer.state.mutedThreads.includes(thread)) return;
  if (!settings.enabled || peer.state.status === 'dnd') return;
  if (reminderBlocks.size) {
    if (deferredMessages.size >= 64 && !deferredMessages.has(thread)) deferredMessages.delete(deferredMessages.keys().next().value);
    deferredMessages.set(thread, message.id);
    return;
  }
  const key = thread;
  const mentioned = Boolean(message.roomId && message.mentions?.some(item => item.id === peer.id));
  const name = peer.trusted.get(message.from)?.name || tr('Teman');
  const title = !settings.preview ? 'Lumilan Chat' : message.roomId ? peer.room(message.roomId)?.name || tr('Ruang') : message.kind === 'announcement' ? tr('Pengumuman') : name;
  const content = message.kind === 'file' ? tr('File: {name}', { name: message.name })
    : message.text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').slice(0, 120);
  const body = settings.preview ? mentioned ? tr('{name} menyebut Anda: {content}', { name, content }) : message.to === null ? tr('{name}: {content}', { name, content }) : content
    : mentioned ? tr('Anda disebut dalam Ruang') : message.kind === 'file' ? tr('File baru diterima') : tr('Pesan baru diterima');
  // Preserve private summaries only in the main process; the companion receives redacted copies.
  if (notch?.message(message, thread, message.roomId ? peer.room(message.roomId)?.name || tr('Ruang') : name,
      message.roomId ? `${name}: ${content}` : content)) return;
  if (!Notification.isSupported()) {
    notificationError = 'Sistem operasi tidak menyediakan layanan notifikasi desktop.';
    return;
  }
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
  if (reminderBlocks.size) return { shown: false, error: 'Notifikasi ditunda selama layar terkunci atau perangkat tidur.' };
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
  if (path === '/brand-icon.png') return join(here, 'build', 'icon.png');
  if (!/^\/(?:index\.html|notch\.html|app\.css|notch\.css|[a-z][a-z0-9-]*\.js|fonts\/PublicSans\.ttf)$/.test(path)) return null;
  const file = resolve(publicDir, `.${path}`);
  return file.startsWith(publicDir + sep) ? file : null;
}

function serveAsset(request, companion = false) {
  let path;
  try {
    const target = new URL(request.url);
    if (companion && !['/notch.html', '/notch.css', '/notch.js', '/i18n.js', '/fonts/PublicSans.ttf'].includes(target.pathname)) return new Response('Not found', { status: 404 });
    path = assetPath(request.url);
  } catch { return new Response('Not found', { status: 404 }); }
  if (!path || !existsSync(path)) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(path).toString()).then(response => {
    if (new URL(request.url).pathname !== '/notch.html') return response;
    const headers = new Headers(response.headers);
    headers.set('Permissions-Policy', 'microphone=(), camera=(), geolocation=(), display-capture=()');
    return new Response(response.body, { status: response.status, headers });
  });
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
  for (const [event, reason] of [['lock-screen', 'locked'], ['suspend', 'suspended']]) powerMonitor.on(event, () => {
    reminderBlocks.add(reason);
    for (const entry of reminderNotifications.values()) entry.notification.close();
    for (const entry of activeNotifications.values()) entry.notification.close();
    for (const entry of pendingFileOffers.values()) entry.notification?.close();
    callNotification?.close();
  });
  for (const [event, reason] of [['unlock-screen', 'locked'], ['resume', 'suspended']]) powerMonitor.on(event, () => {
    reminderBlocks.delete(reason);
    // Let Lumi process the same power event before choosing the presentation.
    setImmediate(() => {
      if (reminderBlocks.size || !peer || quitting) return;
      const deferred = new Map(deferredReminders); deferredReminders.clear();
      const messages = new Map(deferredMessages); deferredMessages.clear();
      for (const [thread, id] of messages) {
        const message = peer.state.messages.find(m => m.id === id);
        if (message && peer.state.unread[thread]) notify(message);
      }
      try { peer.reminders.tick(); } catch (error) { console.warn('Pengingat gagal disimpan:', error); }
      for (const type of ['request', 'due']) {
        const items = peer.state.reminders.filter(r => deferred.get(r.id) === type &&
          (type === 'due' ? r.status === 'due' : r.kind === 'incoming' && r.status === 'pending'));
        if (items.length) notifyReminder({ type, items, missed: type === 'due' });
      }
    });
  });
  protocol.handle('lumilan', request => serveAsset(request));
  const notchSession = session.fromPartition('lumi');
  notchSession.protocol.handle('lumilan', request => serveAsset(request, true));
  notchSession.setPermissionCheckHandler(() => false);
  notchSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  notchSession.setDevicePermissionHandler(() => false);
  session.defaultSession.setPermissionCheckHandler((contents, permission) =>
    contents === window?.webContents && contents.getURL() === mainUrl && (permission === 'media' || permission === 'clipboard-sanitized-write'));
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const appPage = contents === window?.webContents && contents.getURL() === mainUrl;
    callback(appPage && (permission === 'clipboard-sanitized-write' || permission === 'media' && details.requestingUrl === mainUrl &&
      details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio'));
  });

  const dataDir = join(app.getPath('userData'), 'lumilan');
  enableDefaultStartup(dataDir, app, startupStatus, setStartup);
  mkdirSync(dataDir, { recursive: true });
  settingsPath = join(dataDir, 'notifications.json');
  try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); }
  catch { settings = {}; }
  if (!settings || typeof settings !== 'object') settings = {};
  settings = { enabled: settings.enabled !== false, preview: settings.preview === true, silent: settings.silent === true, background: settings.background !== false,
    notch: settings.notch !== false, notchPosition: settings.notchPosition && Number.isSafeInteger(settings.notchPosition.display) && Number.isFinite(settings.notchPosition.fraction)
      ? { display: settings.notchPosition.display, fraction: Math.min(.95, Math.max(.05, settings.notchPosition.fraction)) } : undefined,
    ...languageSettings(settings, app.getLocaleCountryCode()) };
  peer = await new LumilanPeer({ dataDir,
    ...(app.commandLine.hasSwitch('lumilan-ui-smoke') ? { discovery: false, listen: '/ip4/127.0.0.1/tcp/0' } : {}),
    acceptFile: ({ id, from, fromName, name, size, roomId }) => {
    if (!window || window.isDestroyed()) return false;
    if (pendingFileOffers.has(id)) return false;
    const offer = { id, from, fromName, name, size, thread: roomId ? `room:${roomId}` : from };
    return new Promise(resolve => {
      const timer = setTimeout(() => { entry.decide(false); notch?.remove(`file:${id}`); if (window && !window.isDestroyed()) window.webContents.send('lumilan:file-transfer', { id, status: 'canceled' }); }, 290_000);
      timer.unref();
      const entry = { offer, notification: null, decide: accepted => { clearTimeout(timer); entry.notification?.close(); pendingFileOffers.delete(id); resolve(accepted); } };
      pendingFileOffers.set(id, entry);
      window.webContents.send('lumilan:file-offer', offer);
      const handled = notch?.file(offer);
      const quiet = reminderBlocks.size > 0 || peer?.state.status === 'dnd' || peer?.state.mutedThreads.includes(offer.thread);
      if (!handled && !quiet && settings.enabled && !Notification.isSupported() && !window.isVisible()) window.showInactive();
      if (!handled && !quiet && settings.enabled && Notification.isSupported()) {
        try {
          const notification = new Notification({ title: settings.preview ? tr('File masuk') : 'Lumilan Chat',
            body: settings.preview ? tr('Terima file {name} dari {sender}?', { name, sender: fromName }) : tr('File masuk menunggu persetujuan.'), silent: settings.silent });
          notification.on('click', () => reveal(offer.thread));
          notification.show();
          entry.notification = notification;
        } catch (error) { console.warn('Notifikasi file gagal:', error); }
      }
    });
  } }).start();
  peer.on('change', () => {
    if (!peer.node) return;
    updateBadge();
    notch?.prune();
    for(const [key,entry] of reminderNotifications) if(!settings.enabled||peer.state.status==='dnd'||!entry.ids.some(id=>peer.state.reminders?.some(r=>r.id===id&&r.status===entry.status&&(r.kind!=='incoming'||!peer.state.mutedThreads.includes(r.from))))) {entry.notification.close();reminderNotifications.delete(key);}
    if (window && !window.isDestroyed()) window.webContents.send('lumilan:state', peer.snapshot());
  });
  peer.on('incoming', notify);
  peer.on('reminder', notifyReminder);
  peer.on('call', signal => {
    notch?.call(signal);
    if (signal.type === 'end') { callNotification?.close(); callNotification = undefined; }
    if (signal.type === 'offer' && (!window || window.isDestroyed())) {
      peer.sendCall({ action: 'end', id: signal.id, peerId: signal.peerId, reason: 'declined' }).catch(() => {});
      return;
    }
    if (window && !window.isDestroyed()) window.webContents.send('lumilan:call', signal);
    if (signal.type !== 'offer') return;
    if (notch?.eligible() && notch.ready) return;
    const quiet = reminderBlocks.size > 0 || peer.state.status === 'dnd' || peer.state.mutedThreads.includes(signal.peerId);
    if (!quiet && settings.enabled && !Notification.isSupported() && !window.isVisible()) window.showInactive();
    if (!quiet && settings.enabled && Notification.isSupported()) {
      try {
        const notification = new Notification({ title: settings.preview ? tr('Panggilan suara masuk') : 'Lumilan Chat',
          body: settings.preview ? tr('{name} mengundang Anda ke panggilan suara.', { name: peer.trusted.get(signal.peerId)?.name || tr('Teman') }) : tr('Panggilan suara masuk menunggu jawaban.'),
          silent: settings.silent });
        notification.on('click', () => reveal(signal.peerId));
        notification.show();
        callNotification = notification;
      } catch (error) { console.warn('Notifikasi panggilan gagal:', error); }
    }
  });
  peer.on('file-transfer', transfer => {
    notch?.transfer(transfer);
    if (transfer.status === 'canceled') pendingFileOffers.get(transfer.id)?.decide(false);
    if (window && !window.isDestroyed()) window.webContents.send('lumilan:file-transfer', transfer);
  });
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
  handler('set-contact-label', (id, label) => peer.setContactLabel(id, label));
  handler('check-updates', () => checkUpdates(true));
  handler('test-notification', testNotification);
  handler('message', (text, to, replyTo) => peer.sendMessage(text, to, replyTo));
  handler('room-message', (text, id, replyTo, mentions) => peer.sendRoomMessage(text, id, replyTo, mentions));
  handler('note', (text, replyTo) => peer.saveNote(text, replyTo));
  handler('react', (thread, id, emoji) => peer.react(thread, id, emoji));
  handler('typing', (thread, active) => peer.sendTyping(thread, active));
  handler('call-state', () => peer.callState());
  handler('report-call', state => { notch?.callPhase(state); return true; });
  handler('call', packet => {
    if (packet?.action === 'answer') { callNotification?.close(); callNotification = undefined; }
    return peer.sendCall(packet);
  });
  handler('call-microphone', () => process.platform === 'darwin' ? systemPreferences.askForMediaAccess('microphone') : true);
  handler('announcement', (text, replyTo) => peer.sendAnnouncement(text, replyTo));
  handler('create-announcement-room', () => peer.createAnnouncementRoom());
  handler('delete-announcement-room', () => peer.deleteAnnouncementRoom());
  handler('create-room', (name, members) => peer.createRoom(name, members));
  handler('update-room', (id, members) => peer.updateRoom(id, members));
  handler('accept-room', id => peer.acceptRoom(id));
  handler('decline-room', id => peer.declineRoom(id));
  handler('leave-room', id => peer.leaveRoom(id));
  handler('delete-room', id => peer.deleteRoom(id));
  handler('archive-thread', id => peer.archiveThread(id));
  handler('restore-thread', id => peer.restoreThread(id));
  handler('delete-archived-history', async id => {
    deletingHistory++;
    try { await Promise.allSettled([...previewRequests]); return await peer.deleteArchivedHistory(id); }
    finally { deletingHistory--; }
  });
  handler('delete-messages', async (thread, ids) => {
    deletingHistory++;
    try { await Promise.allSettled([...previewRequests]); return await peer.deleteMessages(thread, ids); }
    finally { deletingHistory--; }
  });
  handler('connect-address', value => peer.connectAddress(value));
  handler('set-announcements', enabled => peer.setAnnouncements(enabled));
  handler('mute-announcements-from', (id, muted) => peer.muteAnnouncementsFrom(id, muted));
  handler('set-thread-muted', (thread, muted) => {
    peer.setThreadMuted(thread, muted);
    if (muted) dismiss(thread);
  });
  handler('file', async (path, to) => {
    if (activeUpload) throw new Error('Pengiriman file lain masih berlangsung.');
    const controller = new AbortController();
    activeUpload = controller;
    let lastProgressAt = 0;
    const reportProgress = (sent, total, status) => {
      const now = Date.now();
      if (sent !== total && now - lastProgressAt < 100) return;
      lastProgressAt = now;
      if (window && !window.isDestroyed()) window.webContents.send('lumilan:file-progress', { sent, total, status });
    };
    try {
      return await peer.sendFilePath(path, to, { signal: controller.signal, onStatus: status => {
        if (window && !window.isDestroyed()) window.webContents.send('lumilan:file-progress', { status });
      }, onProgress: (sent, total) => reportProgress(sent, total),
      onPreparationProgress: (sent, total) => reportProgress(sent, total, 'preparing') });
    } finally { activeUpload = undefined; }
  });
  handler('file-offers', () => [
    ...[...pendingFileOffers.values()].map(item => ({ ...item.offer, status: 'offered', received: 0 })),
    ...[...peer.incomingFiles.values()].map(item => ({ id: item.id, fromName: peer.trusted.get(item.from)?.name || tr('Teman'), name: item.name, size: item.size,
      thread: item.roomId ? `room:${item.roomId}` : item.from, status: 'receiving', received: item.received })),
  ]);
  handler('decide-file', decideFile);
  handler('reminders', () => peer.reminders.list());
  handler('reminder-source', id => peer.reminders.source(id));
  handler('create-reminder', value => peer.reminders.create(value));
  handler('change-reminder', (id, action, value) => peer.reminders.change(id, action, value));
  peer.on('typing', entries => {
    if (window && !window.isDestroyed()) window.webContents.send('lumilan:typing', entries);
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
  handler('preview-image', id => {
    if (deletingHistory) throw new Error('Pratinjau gambar tidak tersedia.');
    const request = previewImage(peer.filePath(id));
    previewRequests.add(request);
    void request.then(() => previewRequests.delete(request), () => previewRequests.delete(request));
    return request;
  });
  handler('current-thread', thread => {
    if (thread !== null && thread !== 'notes' && thread !== 'announcements' && !Object.hasOwn(peer.state.archivedThreads, thread) && !peer.online.has(thread) &&
        !(typeof thread === 'string' && thread.startsWith('room:') && peer.room(thread.slice(5)))) throw new Error('Percakapan tidak valid.');
    currentThread = thread;
    if (openingThread === thread || thread === null) openingThread = undefined;
    if (readingWindow() && thread !== null && openingThread === undefined) { peer.markRead(thread); dismiss(thread); }
  });
  handler('notification-settings', () => ({ ...settings, notchSupported: notch?.supported === true, supported: Notification.isSupported(),
    error: process.platform === 'linux' && !linuxScreenLock?.supported ? 'Deteksi layar terkunci tidak tersedia. Notifikasi ditunda; periksa gdbus dan layanan ScreenSaver desktop.' : notificationError,
    tray: Boolean(tray), version: app.getVersion(), platform: process.platform }));
  handler('startup-settings', startupStatus);
  handler('set-language', value => {
    if (value !== 'auto' && !Object.hasOwn(locales, value)) throw new Error('Bahasa tidak didukung.');
    const next = { ...settings, languageMode: value === 'auto' ? 'auto' : 'manual', language: value === 'auto' ? languageForRegion(app.getLocaleCountryCode()) : value };
    const temporary = `${settingsPath}.tmp`;
    writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
    renameSync(temporary, settingsPath);
    settings = next;
    for(const entry of reminderNotifications.values()) entry.notification.close();
    reminderNotifications.clear();
    updateTrayMenu();
    updateBadge();
    notch?.sync();
    return { language: settings.language, languageMode: settings.languageMode };
  });
  handler('set-startup', value => {
    if (typeof value !== 'boolean') throw new Error('Pengaturan tidak valid.');
    clearPendingDefaultStartup(dataDir);
    return setStartup(value);
  });
  handler('set-notification-settings', value => {
    if (!value || typeof value !== 'object' || !['enabled', 'preview', 'silent', 'background', 'notch'].every(key => typeof value[key] === 'boolean')) throw new Error('Pengaturan tidak valid.');
    const next = { ...settings, enabled: value.enabled, preview: value.preview, silent: value.silent, background: value.background, notch: value.notch };
    const temporary = `${settingsPath}.tmp`;
    writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
    renameSync(temporary, settingsPath);
    settings = next;
    if (!settings.enabled) for (const { thread } of activeNotifications.values()) dismiss(thread);
    notch?.sync(); updateTrayMenu();
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
      backgroundThrottling: false,
    },
  });
  notch = new LumiNotch({ BrowserWindow, ipcMain, screen, powerMonitor, notchSession, root: here,
    getSettings: () => settings, getPeer: () => peer, getMain: () => mainPresented ? window : undefined, reveal, decideFile,
    acceptCall: id => window.webContents.send('lumilan:notch-accept-call', id),
    savePosition: position => {
      settings.notchPosition = position;
      clearTimeout(positionSaveTimer);
      positionSaveTimer = setTimeout(() => { try { persistSettings(); } catch (error) { console.warn('Posisi Lumi tidak dapat disimpan:', error); } }, 400);
      positionSaveTimer.unref();
    }, onFailure: updateTrayMenu,
  });
  // Create the companion only when the main window first moves into the background.
  if (process.platform === 'linux') linuxScreenLock = new LinuxScreenLock(powerMonitor);
  for (const event of ['hide', 'show', 'minimize', 'restore', 'enter-full-screen', 'leave-full-screen']) window.on(event, () => notch.sync());
  if (process.platform !== 'darwin') window.removeMenu();
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (['https://iyansanjaya.com/', 'https://trakteer.id/iyansanjaya/tip', 'https://ko-fi.com/iyansanjaya', 'https://github.com/iyansanjaya/lumilan-chat/issues'].includes(url)) {
      setImmediate(() => {
        void shell.openExternal(url).catch(error => console.warn('Gagal membuka tautan eksternal:', error));
      });
    }
    return { action: 'deny' };
  });
  updateBadge();
  window.webContents.on('will-navigate', (event, url) => { if (url !== mainUrl) event.preventDefault(); });
  window.webContents.on('did-start-navigation', details => {
    if (details.isMainFrame && !details.isSameDocument && peer.activeCall) peer.sendCall({ action: 'end', id: peer.activeCall.id, peerId: peer.activeCall.peerId }).catch(() => {});
  });
  window.webContents.on('render-process-gone', () => {
    if (peer.activeCall) peer.sendCall({ action: 'end', id: peer.activeCall.id, peerId: peer.activeCall.peerId }).catch(() => {});
  });
  window.webContents.on('did-finish-load', () => {
    if (pendingThread !== undefined) {
      window.webContents.send('lumilan:open-thread', pendingThread);
      pendingThread = undefined;
    }
  });
  window.on('focus', () => { if (readingWindow() && currentThread !== null && openingThread === undefined) { peer.markRead(currentThread); dismiss(currentThread); } });
  window.on('close', event => {
    if (!quitting && settings.background && tray) { event.preventDefault(); window.hide(); }
  });
  const presentMain = () => {
    if (mainPresented) return;
    mainPresented = true;
    window.show();
  };
  window.once('ready-to-show', presentMain);
  // A hidden Wayland window can wait for its first frame until it is mapped.
  if (process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland')
    window.webContents.once('did-finish-load', presentMain);
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

app.on('before-quit', () => {
  quitting = true; clearTimeout(positionSaveTimer);
  if (settingsPath && settings) { try { persistSettings(); } catch (error) { console.warn('Pengaturan tidak dapat disimpan:', error); } }
  notch?.dispose();
  linuxScreenLock?.dispose();
  for (const entry of pendingFileOffers.values()) entry.decide(false); peer?.stop().catch(() => {});
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => reveal());
