const { contextBridge, ipcRenderer } = require('electron');
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('grenaDesktop', {
    saveServerUrl: (url) => ipcRenderer.invoke('save-server-url', url)
  });
}
