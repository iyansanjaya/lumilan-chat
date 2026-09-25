const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumilan', {
  state: () => ipcRenderer.invoke('lumilan:state'),
  rename: name => ipcRenderer.invoke('lumilan:rename', name),
  setProfile: profile => ipcRenderer.invoke('lumilan:set-profile', profile),
  checkUpdates: () => ipcRenderer.invoke('lumilan:check-updates'),
  testNotification: () => ipcRenderer.invoke('lumilan:test-notification'),
  message: (text, to) => ipcRenderer.invoke('lumilan:message', text, to),
  file: (name, bytes, to) => ipcRenderer.invoke('lumilan:file', name, bytes, to),
  saveFile: id => ipcRenderer.invoke('lumilan:save-file', id),
  currentThread: thread => ipcRenderer.invoke('lumilan:current-thread', thread),
  notificationSettings: () => ipcRenderer.invoke('lumilan:notification-settings'),
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
