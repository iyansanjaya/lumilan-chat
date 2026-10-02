const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lumi', Object.freeze({
  state: () => ipcRenderer.invoke('lumi:state'),
  action: value => ipcRenderer.invoke('lumi:action', value),
  pointer: inside => ipcRenderer.send('lumi:pointer', inside),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('lumi:state', listener);
    return () => ipcRenderer.removeListener('lumi:state', listener);
  },
}));
