const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openInstall", Object.freeze({
  getCatalog: () => ipcRenderer.invoke("catalog:list"),
  checkWinget: () => ipcRenderer.invoke("system:winget"),
  getInstalled: () => ipcRenderer.invoke("apps:installed"),
  installApp: (id, preferUserScope) => ipcRenderer.invoke("apps:install", id, preferUserScope),
  updateApp: (id, preferUserScope) => ipcRenderer.invoke("apps:update", id, preferUserScope),
  openExternal: (url) => ipcRenderer.invoke("external:open", url)
}));
