const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flexpos', {
  print: (html, opts) => ipcRenderer.invoke('flexpos:print', html, opts),
  printers: () => ipcRenderer.invoke('flexpos:printers'),
  desktop: true,
});
