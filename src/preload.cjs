const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  analyzePage: (request) => ipcRenderer.invoke("analyze-page", request),
  saveEpub: (payload) => ipcRenderer.invoke("save-epub", payload),
  showFile: (filePath) => ipcRenderer.invoke("show-file", filePath),
  setUiLanguage: (locale) => ipcRenderer.send("set-ui-language", locale),
  onUpdateStatus: (callback) => ipcRenderer.on("update-status", (_event, status) => callback(status))
});
