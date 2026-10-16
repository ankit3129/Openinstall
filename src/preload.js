const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openInstall", Object.freeze({
  getCatalog: () => ipcRenderer.invoke("catalog:list"),
  getProfiles: () => ipcRenderer.invoke("catalog:profiles"),
  getCatalogWarnings: () => ipcRenderer.invoke("catalog:warnings"),
  checkWinget: () => ipcRenderer.invoke("system:winget"),
  getInstalled: () => ipcRenderer.invoke("apps:installed"),
  getUpgradable: () => ipcRenderer.invoke("apps:upgradable"),
  runQueue: (request) => ipcRenderer.invoke("queue:run", request),
  cancelQueue: () => ipcRenderer.invoke("queue:cancel"),
  onQueueProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on("queue:progress", handler);
    return () => ipcRenderer.removeListener("queue:progress", handler);
  },
  openExternal: (url) => ipcRenderer.invoke("external:open", url),
  getUpdateState: () => ipcRenderer.invoke("update:state"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("update:status", handler);
    return () => ipcRenderer.removeListener("update:status", handler);
  }
}));
