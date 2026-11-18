const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('kontext', {
  request: (method, path, body) => ipcRenderer.invoke('kontext:request', method, path, body),
  openExternal: (url) => ipcRenderer.invoke('kontext:external', url),
  saveFile: (name, bytes) => ipcRenderer.invoke('kontext:save', name, bytes),
  showResource: (resource) => ipcRenderer.invoke('kontext:resource', resource),
});
