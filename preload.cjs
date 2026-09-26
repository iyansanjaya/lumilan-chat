const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('lumilan', {
  state: () => ipcRenderer.invoke('lumilan:state'),
  rename: name => ipcRenderer.invoke('lumilan:rename', name),
  setProfile: profile => ipcRenderer.invoke('lumilan:set-profile', profile),
  checkUpdates: () => ipcRenderer.invoke('lumilan:check-updates'),
  testNotification: () => ipcRenderer.invoke('lumilan:test-notification'),
  message: (text, to) => ipcRenderer.invoke('lumilan:message', text, to),
  file: (file, to) => ipcRenderer.invoke('lumilan:file', webUtils.getPathForFile(file), to),
  cancelFile: () => ipcRenderer.invoke('lumilan:cancel-file'),
  onFileProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('lumilan:file-progress', listener);
    return () => ipcRenderer.removeListener('lumilan:file-progress', listener);
  },
  saveFile: id => ipcRenderer.invoke('lumilan:save-file', id),
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
