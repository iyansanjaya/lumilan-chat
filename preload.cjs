const { contextBridge, ipcRenderer, webUtils } = require('electron');

function clipboardBytes(file) {
  // Use isolated-world Blob accessors, not attributes/methods supplied by the renderer.
  const type = Object.getOwnPropertyDescriptor(Blob.prototype, 'type').get.call(file);
  const size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get.call(file);
  if (!/^image\/(png|jpeg|webp|gif)$/.test(type) || !size || size > 20 * 1024 * 1024)
    throw new Error('Gambar clipboard harus berukuran 1 B–20 MB.');
  return Blob.prototype.arrayBuffer.call(file);
}

contextBridge.exposeInMainWorld('lumilan', {
  state: () => ipcRenderer.invoke('lumilan:state'),
  windowVisible: () => ipcRenderer.invoke('lumilan:window-visible'),
  onWindowVisible: callback => {
    const listener = (_event, visible) => { if (typeof visible === 'boolean') callback(visible); };
    ipcRenderer.on('lumilan:window-visible', listener);
    return () => ipcRenderer.removeListener('lumilan:window-visible', listener);
  },
  reminders: () => ipcRenderer.invoke('lumilan:reminders'),
  onReminder: callback => {
    const listener=(_event,value)=>callback(value);
    ipcRenderer.on('lumilan:reminder',listener);
    return ()=>ipcRenderer.removeListener('lumilan:reminder',listener);
  },
  reminderSource: id => ipcRenderer.invoke('lumilan:reminder-source',id),
  createReminder: value => ipcRenderer.invoke('lumilan:create-reminder', value),
  changeReminder: (id, action, value) => ipcRenderer.invoke('lumilan:change-reminder', id, action, value),
  rename: name => ipcRenderer.invoke('lumilan:rename', name),
  setProfile: profile => ipcRenderer.invoke('lumilan:set-profile', profile),
  setContactLabel: (id, label) => ipcRenderer.invoke('lumilan:set-contact-label', id, label),
  checkUpdates: () => ipcRenderer.invoke('lumilan:check-updates'),
  testNotification: () => ipcRenderer.invoke('lumilan:test-notification'),
  message: (text, to, replyTo) => ipcRenderer.invoke('lumilan:message', text, to, replyTo),
  roomMessage: (text, id, replyTo, mentions) => ipcRenderer.invoke('lumilan:room-message', text, id, replyTo, mentions),
  note: (text, replyTo) => ipcRenderer.invoke('lumilan:note', text, replyTo),
  react: (thread, id, emoji) => ipcRenderer.invoke('lumilan:react', thread, id, emoji),
  typing: (thread, active) => ipcRenderer.invoke('lumilan:typing', thread, active),
  callState: () => ipcRenderer.invoke('lumilan:call-state'),
  reportCall: state => ipcRenderer.invoke('lumilan:report-call', state),
  onNotchAcceptCall: callback => {
    const listener = (_event, id) => callback(id);
    ipcRenderer.on('lumilan:notch-accept-call', listener);
    return () => ipcRenderer.removeListener('lumilan:notch-accept-call', listener);
  },
  call: packet => ipcRenderer.invoke('lumilan:call', packet),
  callMicrophone: () => ipcRenderer.invoke('lumilan:call-microphone'),
  onCall: callback => {
    const listener = (_event, signal) => callback(signal);
    ipcRenderer.on('lumilan:call', listener);
    return () => ipcRenderer.removeListener('lumilan:call', listener);
  },
  announcement: (text, replyTo) => ipcRenderer.invoke('lumilan:announcement', text, replyTo),
  createAnnouncementRoom: () => ipcRenderer.invoke('lumilan:create-announcement-room'),
  deleteAnnouncementRoom: () => ipcRenderer.invoke('lumilan:delete-announcement-room'),
  createRoom: (name, members) => ipcRenderer.invoke('lumilan:create-room', name, members),
  updateRoom: (id, members) => ipcRenderer.invoke('lumilan:update-room', id, members),
  acceptRoom: id => ipcRenderer.invoke('lumilan:accept-room', id),
  declineRoom: id => ipcRenderer.invoke('lumilan:decline-room', id),
  leaveRoom: id => ipcRenderer.invoke('lumilan:leave-room', id),
  deleteRoom: id => ipcRenderer.invoke('lumilan:delete-room', id),
  archiveThread: id => ipcRenderer.invoke('lumilan:archive-thread', id),
  restoreThread: id => ipcRenderer.invoke('lumilan:restore-thread', id),
  deleteArchivedHistory: id => ipcRenderer.invoke('lumilan:delete-archived-history', id),
  deleteMessages: (thread, ids) => ipcRenderer.invoke('lumilan:delete-messages', thread, ids),
  connectAddress: value => ipcRenderer.invoke('lumilan:connect-address', value),
  setAnnouncements: enabled => ipcRenderer.invoke('lumilan:set-announcements', enabled),
  muteAnnouncementsFrom: (id, muted) => ipcRenderer.invoke('lumilan:mute-announcements-from', id, muted),
  setThreadMuted: (thread, muted) => ipcRenderer.invoke('lumilan:set-thread-muted', thread, muted),
  file: async (file, to) => {
    const path = webUtils.getPathForFile(file);
    if (path) return ipcRenderer.invoke('lumilan:file', path, to);
    return ipcRenderer.invoke('lumilan:file', '', to, await clipboardBytes(file));
  },
  clipboardImage: async file => {
    return ipcRenderer.invoke('lumilan:clipboard-image', await clipboardBytes(file));
  },
  cancelFile: () => ipcRenderer.invoke('lumilan:cancel-file'),
  fileOffers: () => ipcRenderer.invoke('lumilan:file-offers'),
  decideFile: (id, accepted) => ipcRenderer.invoke('lumilan:decide-file', id, accepted),
  onFileOffer: callback => {
    const listener = (_event, offer) => callback(offer);
    ipcRenderer.on('lumilan:file-offer', listener);
    return () => ipcRenderer.removeListener('lumilan:file-offer', listener);
  },
  onFileTransfer: callback => {
    const listener = (_event, transfer) => callback(transfer);
    ipcRenderer.on('lumilan:file-transfer', listener);
    return () => ipcRenderer.removeListener('lumilan:file-transfer', listener);
  },
  onFileProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('lumilan:file-progress', listener);
    return () => ipcRenderer.removeListener('lumilan:file-progress', listener);
  },
  onTyping: callback => {
    const listener = (_event, entries) => callback(entries);
    ipcRenderer.on('lumilan:typing', listener);
    return () => ipcRenderer.removeListener('lumilan:typing', listener);
  },
  saveFile: id => ipcRenderer.invoke('lumilan:save-file', id),
  previewImage: id => ipcRenderer.invoke('lumilan:preview-image', id),
  listFiles: (thread, offset) => ipcRenderer.invoke('lumilan:list-files', thread, offset),
  listMessages: (thread, before) => ipcRenderer.invoke('lumilan:list-messages', thread, before),
  currentThread: thread => ipcRenderer.invoke('lumilan:current-thread', thread),
  notificationSettings: () => ipcRenderer.invoke('lumilan:notification-settings'),
  startupSettings: () => ipcRenderer.invoke('lumilan:startup-settings'),
  setStartup: enabled => ipcRenderer.invoke('lumilan:set-startup', enabled),
  setLanguage: language => ipcRenderer.invoke('lumilan:set-language', language),
  setNotificationSettings: value => ipcRenderer.invoke('lumilan:set-notification-settings', value),
  quit: () => ipcRenderer.invoke('lumilan:quit'),
  onOpenThread: callback => {
    const listener = (_event, thread) => callback(thread);
    ipcRenderer.on('lumilan:open-thread', listener);
    return () => ipcRenderer.removeListener('lumilan:open-thread', listener);
  },
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('lumilan:state', listener);
    return () => ipcRenderer.removeListener('lumilan:state', listener);
  },
});
