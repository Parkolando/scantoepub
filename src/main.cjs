const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { writeFile } = require("node:fs/promises");
const path = require("node:path");
const { analyzePage } = require("./openai.cjs");

function setupUpdates(window) {
  if (!app.isPackaged) return;
  const send = (state, details = {}) => {
    if (!window.isDestroyed()) window.webContents.send("update-status", { state, ...details });
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => send("checking"));
  autoUpdater.on("update-available", (info) => send("available", { version: info.version }));
  autoUpdater.on("update-not-available", () => send("current"));
  autoUpdater.on("download-progress", ({ percent }) => send("downloading", { percent: Math.round(percent) }));
  autoUpdater.on("error", (error) => send("error", { message: error.message }));
  autoUpdater.on("update-downloaded", async (info) => {
    send("downloaded", { version: info.version });
    const { response } = await dialog.showMessageBox(window, {
      type: "info",
      title: "업데이트 준비 완료",
      message: `Scan to EPUB ${info.version} 업데이트를 설치할까요?`,
      detail: "지금 재시작하거나, 나중에 앱을 종료할 때 자동으로 설치할 수 있습니다.",
      buttons: ["재시작하여 설치", "나중에"],
      defaultId: 0,
      cancelId: 1
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  window.webContents.once("did-finish-load", () => {
    setTimeout(() => autoUpdater.checkForUpdates().catch((error) => send("error", { message: error.message })), 1200);
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f4f1ea",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.loadFile(path.join(__dirname, "index.html"));
  setupUpdates(window);
}

app.whenReady().then(() => {
  ipcMain.handle("analyze-page", (_event, request) => analyzePage(request));
  ipcMain.handle("save-epub", async (_event, { bytes, defaultName }) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: "EPUB 3", extensions: ["epub"] }]
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, Buffer.from(bytes));
    return result.filePath;
  });
  ipcMain.handle("show-file", (_event, filePath) => shell.showItemInFolder(filePath));

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
