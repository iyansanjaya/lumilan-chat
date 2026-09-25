import Search from '/reicon/icons/Search.js';
import Hashtag from '/reicon/icons/Hashtag.js';
import ArrowLeft from '/reicon/icons/ArrowLeft.js';
import Paperclip from '/reicon/icons/Paperclip.js';
import Send from '/reicon/icons/Send.js';
import FileDownload from '/reicon/icons/FileDownload.js';
import Message from '/reicon/icons/Message.js';
import Moon from '/reicon/icons/Moon.js';
import Sun from '/reicon/icons/Sun.js';
import Bell from '/reicon/icons/Bell.js';
import Settings from '/reicon/icons/Settings.js';
import X from '/reicon/icons/X.js';

const icons = { Search, Hashtag, ArrowLeft, Paperclip, Send, FileDownload, Message, Moon, Sun, Bell, Settings, X };
const reicon = (name, size = 18) => icons[name]({ size, attrs: { 'aria-hidden': 'true', focusable: 'false' } });
const setIcon = (host, name, size) => host.replaceChildren(reicon(name, size));
for (const host of document.querySelectorAll('[data-icon]')) setIcon(host, host.dataset.icon);

const $ = selector => document.querySelector(selector);
const state = { me: null, users: [], messages: [], unread: {}, thread: null, filter: 'all', names: new Map() };
const dateFormat = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDateFormat = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });
const timeFormat = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
let toastTimer;
let pendingThread;
let pendingAvatar = '';
const statusLabels = { active: 'Aktif', busy: 'Sibuk', away: 'Pergi', dnd: 'Jangan ganggu' };

function badge(count) {
  const element = document.createElement('span');
  element.className = 'unread-badge';
  element.textContent = count > 99 ? '99+' : String(count);
  return element;
}

function renderUnread() {
  const room = $('#room-unread');
  room.hidden = !state.unread.room;
  room.textContent = state.unread.room > 99 ? '99+' : String(state.unread.room || '');
  const total = Object.values(state.unread).reduce((sum, count) => sum + count, 0);
  const top = $('#top-unread');
  top.hidden = !total;
  top.textContent = total > 99 ? '99+' : String(total || '');
  document.title = total ? `Lumilan Chat (${total})` : 'Lumilan Chat';
  if ($('#inbox-dialog').open) renderInbox();
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '?';
}

function avatarContent(name, source) {
  if (!source) return document.createTextNode(initials(name));
  const image = document.createElement('img');
  image.src = source;
  image.alt = '';
  return image;
}

function avatar(name, extra = '', source = '') {
  const element = document.createElement('span');
  const color = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
  element.className = `avatar color-${color} ${extra}`;
  element.append(avatarContent(name, source));
  return element;
}

function userName(id) {
  const peer = state.users.find(user => user.id === id);
  if (peer) return state.users.filter(user => user.name === peer.name).length > 1 ? `${peer.name} · ${id.slice(-6)}` : peer.name;
  return state.names.get(id) || 'Teman';
}

function rememberNames() {
  for (const user of state.users) state.names.set(user.id, user.name);
  for (const message of state.messages) state.names.set(message.from, message.fromName);
}

function conversationMessages() {
  return state.messages.filter(message => state.thread === null
    ? !message.to
    : (message.from === state.me.id && message.to === state.thread) || (message.from === state.thread && message.to === state.me.id));
}

function renderPeople() {
  const list = $('#people-list');
  list.replaceChildren();
  const query = $('#people-search').value.trim().toLocaleLowerCase('id-ID');
  const latest = new Map();
  for (const message of state.messages) if (message.to) {
    const id = message.from === state.me.id ? message.to : message.from;
    latest.set(id, message);
  }
  $('#room-button').hidden = state.filter === 'private' || (query && !'ruang umum'.includes(query));
  $('#people-caption').hidden = state.filter === 'room';
  list.hidden = state.filter === 'room';
  const people = state.users.filter(user => user.name.toLocaleLowerCase('id-ID').includes(query))
    .sort((a, b) => a.name.localeCompare(b.name, 'id-ID'));
  $('#people-count').textContent = `${state.users.filter(user => user.online).length} aktif`;
  if (state.filter === 'room') return;
  if (!people.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-people';
    empty.textContent = query ? 'Tidak ada perangkat yang cocok.' : 'Belum ada perangkat aktif di LAN ini. Pastikan Lumilan Chat terbuka di jaringan yang sama.';
    list.append(empty);
    return;
  }
  for (const person of people) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `person${state.thread === person.id ? ' active' : ''}`;
    button.append(avatar(person.name, '', person.avatar));
    const copy = document.createElement('span');
    copy.className = 'person-copy';
    const name = document.createElement('strong');
    name.textContent = person.name;
    const status = document.createElement('small');
    const recent = latest.get(person.id);
    status.className = `presence presence-${person.status || 'active'}`;
    status.textContent = person.about ? `${statusLabels[person.status] || 'Aktif'} - ${person.about}` : statusLabels[person.status] || 'Aktif';
    status.title = statusLabels[person.status] || 'Aktif';
    copy.append(name, status);
    button.append(copy);
    if (recent) {
      const time = document.createElement('span');
      time.className = 'person-time';
      time.textContent = new Date(recent.at).toDateString() === new Date().toDateString() ? timeFormat.format(recent.at) : shortDateFormat.format(recent.at);
      button.append(time);
    }
    if (state.unread[person.id]) button.append(badge(state.unread[person.id]));
    button.addEventListener('click', () => selectThread(person.id));
    list.append(button);
  }
}

function renderHeader() {
  const name = state.thread === null ? 'Ruang umum' : userName(state.thread);
  $('#thread-title').textContent = name;
  $('#thread-subtitle').textContent = state.thread === null ? 'Perangkat aktif di LAN' : 'Pesan pribadi';
  const person = state.users.find(user => user.id === state.thread);
  $('#header-avatar').replaceChildren(state.thread === null ? reicon('Hashtag', 22) : avatarContent(name, person?.avatar));
  $('#header-avatar').classList.toggle('person-avatar', state.thread !== null);
  $('#message-input').placeholder = state.thread === null ? 'Tulis pesan untuk semua orang...' : `Tulis pesan untuk ${name}...`;
  $('#room-button').classList.toggle('active', state.thread === null);
}

function renderDetails() {
  const name = state.thread === null ? 'Ruang umum' : userName(state.thread);
  const messages = conversationMessages();
  const people = state.thread === null ? state.users.filter(user => user.online) : state.users.filter(user => user.id === state.thread && user.online);
  const files = messages.filter(message => message.kind === 'file');
  $('#detail-title').textContent = name;
  $('#detail-subtitle').textContent = state.thread === null ? 'Perangkat aktif di LAN' : 'Percakapan pribadi';
  $('#detail-avatar').replaceChildren(state.thread === null ? reicon('Hashtag', 24) : avatarContent(name, people[0]?.avatar));
  $('#detail-avatar').classList.toggle('person-avatar', state.thread !== null);
  $('#member-stat').textContent = people.length;
  $('#message-stat').textContent = messages.length;
  $('#file-count').textContent = files.length;
  const fileList = $('#recent-files');
  fileList.replaceChildren();
  if (!files.length) {
    const empty = document.createElement('p');
    empty.className = 'detail-empty';
    empty.textContent = 'Belum ada file yang dibagikan.';
    fileList.append(empty);
  }
  for (const file of files.slice(-3).reverse()) {
    const link = document.createElement('a');
    link.className = 'detail-row';
    link.href = '#';
    link.addEventListener('click', event => { event.preventDefault(); window.lumilan.saveFile(file.id).catch(error => toast(error.message)); });
    const icon = document.createElement('span');
    icon.className = 'detail-file-icon';
    icon.append(reicon('FileDownload', 16));
    const copy = document.createElement('span');
    copy.className = 'detail-row-copy';
    const title = document.createElement('strong');
    title.textContent = file.name;
    const meta = document.createElement('small');
    meta.textContent = formatSize(file.size);
    copy.append(title, meta);
    link.append(icon, copy);
    fileList.append(link);
  }
  const members = $('#active-members');
  members.replaceChildren();
  if (!people.length) {
    const empty = document.createElement('p');
    empty.className = 'detail-empty';
    empty.textContent = 'Belum ada orang yang aktif.';
    members.append(empty);
  }
  for (const person of people.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = 'detail-row';
    const copy = document.createElement('span');
    copy.className = 'detail-row-copy';
    const title = document.createElement('strong');
    title.textContent = person.id === state.me.id ? `${person.name} (Anda)` : person.name;
    const status = document.createElement('small');
    status.textContent = person.about ? `${statusLabels[person.status] || 'Aktif'} - ${person.about}` : statusLabels[person.status] || 'Aktif';
    copy.append(title, status);
    row.append(avatar(person.name, '', person.avatar), copy);
    members.append(row);
  }
}

function renderMessages(scroll = true) {
  const list = $('#messages');
  list.replaceChildren();
  const messages = conversationMessages();
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-thread';
    const icon = document.createElement('div');
    icon.className = 'empty-icon';
    icon.append(reicon(state.thread === null ? 'Hashtag' : 'Message', 28));
    const title = document.createElement('h2');
    title.textContent = state.thread === null && !state.users.length ? 'Menunggu perangkat' : 'Mulai percakapan';
    const description = document.createElement('p');
    description.textContent = state.thread === null ? (state.users.length ? 'Belum ada pesan di ruang ini. Jadilah yang pertama menyapa!' : 'Perangkat lain akan muncul otomatis saat Lumilan Chat terbuka di jaringan yang sama.') : `Kirim pesan pertama kepada ${userName(state.thread)}.`;
    empty.append(icon, title, description);
    list.append(empty);
    return;
  }
  let lastDate = '';
  for (const message of messages) {
    const date = dateFormat.format(message.at);
    if (date !== lastDate) {
      const divider = document.createElement('div');
      divider.className = 'date-divider';
      divider.textContent = date;
      list.append(divider);
      lastDate = date;
    }
    const own = message.from === state.me.id;
    const row = document.createElement('article');
    row.className = `message${own ? ' own' : ''}`;
    row.append(avatar(message.fromName, '', message.from === state.me.id ? state.me.avatar : state.users.find(user => user.id === message.from)?.avatar));
    const content = document.createElement('div');
    content.className = 'message-content';
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const name = document.createElement('strong');
    name.textContent = own ? 'Anda' : message.fromName;
    const time = document.createElement('time');
    time.dateTime = new Date(message.at).toISOString();
    time.textContent = timeFormat.format(message.at);
    meta.append(name, time);
    content.append(meta);
    if (message.kind === 'file') {
      const link = document.createElement('a');
      link.className = 'bubble file-bubble';
      link.href = '#';
      link.addEventListener('click', event => { event.preventDefault(); window.lumilan.saveFile(message.id).catch(error => toast(error.message)); });
      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.append(reicon('FileDownload', 18));
      const copy = document.createElement('span');
      copy.className = 'file-copy';
      const fileName = document.createElement('strong');
      fileName.textContent = message.name;
      const size = document.createElement('small');
      size.textContent = formatSize(message.size) + ' · Unduh file';
      copy.append(fileName, size);
      link.append(icon, copy);
      content.append(link);
    } else {
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = message.text;
      content.append(bubble);
    }
    row.append(content);
    list.append(row);
  }
  if (scroll) list.scrollTop = list.scrollHeight;
}

function formatSize(bytes) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function render() {
  rememberNames();
  renderUnread();
  $('#my-name').textContent = state.me.name;
  $('#my-avatar').replaceChildren(avatarContent(state.me.name, state.me.avatar));
  $('#my-name').title = statusLabels[state.me.status] || 'Aktif';
  $('#my-avatar').dataset.status = state.me.status || 'active';
  renderPeople();
  renderHeader();
  renderMessages();
  renderDetails();
}

function selectThread(id) {
  state.thread = id;
  window.lumilan.currentThread(id).catch(error => toast(error.message));
  document.body.classList.remove('show-list');
  renderPeople();
  renderHeader();
  renderMessages();
  renderDetails();
  $('#message-input').focus();
}

function applySnapshot(data) {
  state.me = data.me;
  state.users = data.peers;
  state.messages = data.messages;
  state.unread = data.unread || {};
  if (state.thread && !state.users.some(peer => peer.id === state.thread)) {
    state.thread = null;
    window.lumilan.currentThread(null).catch(error => toast(error.message));
  }
  if (!state.me.name) {
    $('#app').hidden = true;
    $('#join-screen').hidden = false;
    return;
  }
  $('#join-screen').hidden = true;
  $('#app').hidden = false;
  $('#connection-text').textContent = state.users.some(user => user.online) ? 'Terenkripsi' : 'Siap terhubung';
  render();
  if (pendingThread !== undefined) {
    const target = pendingThread;
    pendingThread = undefined;
    selectThread(target);
  }
}

window.lumilan.onState(applySnapshot);
window.lumilan.onOpenThread(thread => {
  if (!state.me?.name) pendingThread = thread;
  else selectThread(thread && !state.users.some(peer => peer.id === thread) ? null : thread);
});
window.lumilan.state().then(applySnapshot).catch(error => toast(error.message));
window.lumilan.currentThread(null).catch(error => toast(error.message));

$('#join-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#join-form button[type="submit"]');
  button.disabled = true;
  try { applySnapshot(await window.lumilan.rename($('#join-name').value)); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});

$('#message-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('#message-input');
  const text = input.value.trim();
  if (!text) return;
  $('#send-button').disabled = true;
  try {
    const result = await window.lumilan.message(text, state.thread);
    input.value = '';
    input.style.height = '';
    input.focus();
    if (result.failed) toast(`${result.failed} perangkat tidak menerima pesan.`);
    else if (state.thread === null && result.delivered === 0) toast('Pesan tersimpan di perangkat ini. Belum ada perangkat lain yang aktif.');
  } catch (error) { toast(error.message); }
  finally { $('#send-button').disabled = false; }
});

$('#message-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $('#message-form').requestSubmit();
  }
});
$('#message-input').addEventListener('input', event => {
  event.target.style.height = 'auto';
  event.target.style.height = Math.min(event.target.scrollHeight, 130) + 'px';
});

async function upload(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) return toast('File maksimal 20 MB.');
  toast(`Mengirim ${file.name}...`);
  try {
    const result = await window.lumilan.file(file.name, await file.arrayBuffer(), state.thread);
    toast(result.failed ? `${result.failed} perangkat tidak menerima file.` : result.delivered ? 'File berhasil dikirim.' : 'File tersimpan di perangkat ini. Belum ada perangkat lain yang aktif.');
  } catch (error) { toast(error.message); }
}
$('#file-input').addEventListener('change', event => { upload(event.target.files[0]); event.target.value = ''; });
$('#attach-button').addEventListener('click', () => $('#file-input').click());
$('#message-form').addEventListener('dragover', event => event.preventDefault());
$('#message-form').addEventListener('drop', event => { event.preventDefault(); upload(event.dataTransfer.files[0]); });

$('#room-button').addEventListener('click', () => selectThread(null));
$('#back-button').addEventListener('click', () => document.body.classList.add('show-list'));
$('#people-search').addEventListener('input', renderPeople);
for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  for (const item of document.querySelectorAll('[data-filter]')) {
    item.classList.toggle('active', item === button);
    item.setAttribute('aria-pressed', String(item === button));
  }
  renderPeople();
});
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !$('#app').hidden) {
    event.preventDefault();
    document.body.classList.add('show-list');
    $('#people-search').focus();
  }
});
$('#theme-button').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('lumilan-theme', theme);
  setIcon($('#theme-button [data-icon]'), theme === 'dark' ? 'Sun' : 'Moon');
  $('#theme-label').textContent = theme === 'dark' ? 'Aktifkan tema terang' : 'Aktifkan tema gelap';
  $('#theme-button').setAttribute('aria-label', theme === 'dark' ? 'Aktifkan tema terang' : 'Aktifkan tema gelap');
});
document.documentElement.dataset.theme = localStorage.getItem('lumilan-theme') || 'light';
setIcon($('#theme-button [data-icon]'), document.documentElement.dataset.theme === 'dark' ? 'Sun' : 'Moon');
$('#theme-label').textContent = document.documentElement.dataset.theme === 'dark' ? 'Aktifkan tema terang' : 'Aktifkan tema gelap';
$('#theme-button').setAttribute('aria-label', document.documentElement.dataset.theme === 'dark' ? 'Aktifkan tema terang' : 'Aktifkan tema gelap');

function renderInbox() {
  const list = $('#inbox-list');
  list.replaceChildren();
  const unread = Object.entries(state.unread).filter(([, count]) => count > 0);
  $('#inbox-empty').hidden = unread.length > 0;
  for (const [key, count] of unread) {
    const thread = key === 'room' ? null : key;
    const messages = state.messages.filter(message => message.from !== state.me.id &&
      (thread === null ? message.to === null : message.from === thread && message.to === state.me.id));
    const recent = messages.at(-1);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inbox-item';
    const title = document.createElement('strong');
    title.textContent = thread === null ? 'Ruang umum' : userName(thread);
    const summary = document.createElement('small');
    summary.textContent = recent ? recent.kind === 'file' ? `File: ${recent.name}` : recent.text : `${count} pesan belum dibaca`;
    button.append(title, badge(count), summary);
    button.addEventListener('click', () => {
      $('#inbox-dialog').close();
      selectThread(thread);
    });
    list.append(button);
  }
}

$('#notifications-button').addEventListener('click', () => {
  renderInbox();
  $('#inbox-dialog').showModal();
});
$('#inbox-close').addEventListener('click', () => $('#inbox-dialog').close());

async function readAvatar(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Gunakan foto PNG, JPG, atau WebP maksimal 5 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width > 4096 || bitmap.height > 4096) throw new Error('Resolusi foto maksimal 4096 × 4096 piksel.');
    for (const size of [128, 96, 80]) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const side = Math.min(bitmap.width, bitmap.height);
      canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
      const image = canvas.toDataURL('image/webp', size === 128 ? .8 : .65);
      if (image.length <= 32_768) return image;
    }
    throw new Error('Foto terlalu rumit untuk profil. Pilih foto lain.');
  } finally { bitmap.close(); }
}

$('#avatar-input').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    pendingAvatar = await readAvatar(file);
    $('#profile-avatar').replaceChildren(avatarContent($('#profile-name').value || state.me.name, pendingAvatar));
  } catch (error) { toast(error.message); }
  event.target.value = '';
});
$('#remove-avatar-button').addEventListener('click', () => {
  pendingAvatar = '';
  $('#profile-avatar').replaceChildren(avatarContent($('#profile-name').value || state.me.name, ''));
});

async function openSettings() {
  try {
    const settings = await window.lumilan.notificationSettings();
    $('#profile-name').value = state.me.name;
    $('#profile-status').value = state.me.status || 'active';
    $('#profile-about').value = state.me.about || '';
    pendingAvatar = state.me.avatar || '';
    $('#profile-avatar').replaceChildren(avatarContent(state.me.name, pendingAvatar));
    $('#notify-enabled').checked = settings.enabled;
    $('#notify-preview').checked = settings.preview;
    $('#notify-silent').checked = settings.silent;
    $('#notify-background').checked = settings.background && settings.tray;
    $('#notify-background').disabled = !settings.tray;
    $('#app-version').textContent = 'v' + settings.version;
    $('#notification-status').textContent = settings.error
      ? `Notifikasi sistem gagal: ${settings.error}`
      : settings.supported
        ? 'Notifikasi sistem aktif bila diizinkan oleh perangkat. Status Jangan ganggu menonaktifkannya.'
        : 'Notifikasi desktop tidak tersedia pada sistem ini. Pesan belum dibaca tetap muncul pada ikon lonceng.';
    $('#settings-dialog').showModal();
  } catch (error) { toast(error.message); }
}
$('#settings-button').addEventListener('click', openSettings);
$('#mobile-settings-button').addEventListener('click', openSettings);
$('#settings-close').addEventListener('click', () => $('#settings-dialog').close());
$('#profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    applySnapshot(await window.lumilan.setProfile({
      name: $('#profile-name').value,
      status: $('#profile-status').value,
      about: $('#profile-about').value,
      avatar: pendingAvatar,
    }));
    toast('Profil disimpan.');
  } catch (error) { toast(error.message); }
});
$('#notifications-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await window.lumilan.setNotificationSettings({
      enabled: $('#notify-enabled').checked,
      preview: $('#notify-preview').checked,
      silent: $('#notify-silent').checked,
      background: $('#notify-background').checked,
    });
    toast('Pengaturan notifikasi disimpan.');
  } catch (error) { toast(error.message); }
});
$('#test-notification-button').addEventListener('click', async () => {
  try {
    const result = await window.lumilan.testNotification();
    toast(result.shown ? 'Notifikasi uji dikirim ke sistem.' : result.error);
    if (result.error) $('#notification-status').textContent = result.error;
  } catch (error) { toast(error.message); }
});
$('#check-updates-button').addEventListener('click', async () => {
  const button = $('#check-updates-button');
  button.disabled = true;
  try { await window.lumilan.checkUpdates(); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
$('#quit-button').addEventListener('click', () => window.lumilan.quit());
