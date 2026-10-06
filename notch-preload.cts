// Keep lexical state private without a CommonJS wrapper in the sandboxed preload.
{
  type Bridge = import('./shared/ipc.js').LumiBridge;
  const { contextBridge, ipcRenderer } : typeof import('electron') = require('electron');
  const bridge: Bridge = {
    state: () => ipcRenderer.invoke('lumi:state'),
    action: value => ipcRenderer.invoke('lumi:action', value),
    pointer: inside => ipcRenderer.send('lumi:pointer', inside),
    onState: callback => {
      const listener = (_event: import('electron').IpcRendererEvent, state: Awaited<ReturnType<Bridge['state']>>) => callback(state);
      ipcRenderer.on('lumi:state', listener);
      return () => ipcRenderer.removeListener('lumi:state', listener);
    },
  };
  contextBridge.exposeInMainWorld('lumi', Object.freeze(bridge));
}
