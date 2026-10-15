const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openInstall", Object.freeze({
  getCatalog: () => ipcRenderer.invoke("catalog:list"),
  getProfiles: () => ipcRenderer.invoke("catalog:profiles"),
  checkWinget: () => ipcRenderer.invoke("system:winget"),
  getInstalled: () => ipcRenderer.invoke("apps:installed"),
  installApp: (id, preferUserScope) => ipcRenderer.invoke("apps:install", id, preferUserScope),
  updateApp: (id, preferUserScope) => ipcRenderer.invoke("apps:update", id, preferUserScope),
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
