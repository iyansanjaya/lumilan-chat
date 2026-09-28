const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('lumilan', {
  state: () => ipcRenderer.invoke('lumilan:state'),
  rename: name => ipcRenderer.invoke('lumilan:rename', name),
  setProfile: profile => ipcRenderer.invoke('lumilan:set-profile', profile),
  checkUpdates: () => ipcRenderer.invoke('lumilan:check-updates'),
  testNotification: () => ipcRenderer.invoke('lumilan:test-notification'),
  message: (text, to, replyTo) => ipcRenderer.invoke('lumilan:message', text, to, replyTo),
  roomMessage: (text, id, replyTo) => ipcRenderer.invoke('lumilan:room-message', text, id, replyTo),
  note: (text, replyTo) => ipcRenderer.invoke('lumilan:note', text, replyTo),
  react: (thread, id, emoji) => ipcRenderer.invoke('lumilan:react', thread, id, emoji),
  typing: (thread, active) => ipcRenderer.invoke('lumilan:typing', thread, active),
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
  file: (file, to) => ipcRenderer.invoke('lumilan:file', webUtils.getPathForFile(file), to),
  cancelFile: () => ipcRenderer.invoke('lumilan:cancel-file'),
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
