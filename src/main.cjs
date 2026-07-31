const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { writeFile } = require("node:fs/promises");
const path = require("node:path");
const { analyzePage } = require("./openai.cjs");

const updateDialogs = {
  ko: {
    title: "업데이트 준비 완료",
    message: (version) => `Scan to EPUB ${version} 업데이트를 설치할까요?`,
    detail: "지금 재시작하거나, 나중에 앱을 종료할 때 자동으로 설치할 수 있습니다.",
    buttons: ["재시작하여 설치", "나중에"]
  },
  en: {
    title: "Update ready",
    message: (version) => `Install the Scan to EPUB ${version} update?`,
    detail: "Restart now, or let the app install it automatically when you quit later.",
    buttons: ["Restart and install", "Later"]
  },
  "zh-CN": {
    title: "更新已准备好",
    message: (version) => `安装 Scan to EPUB ${version} 更新吗？`,
    detail: "可立即重启，或稍后退出应用时自动安装。",
    buttons: ["重启并安装", "稍后"]
  },
  "zh-TW": {
    title: "更新已準備好",
    message: (version) => `要安裝 Scan to EPUB ${version} 更新嗎？`,
    detail: "可立即重新啟動，或稍後結束應用程式時自動安裝。",
    buttons: ["重新啟動並安裝", "稍後"]
  },
  ja: {
    title: "更新の準備が完了しました",
    message: (version) => `Scan to EPUB ${version} の更新をインストールしますか？`,
    detail: "今すぐ再起動するか、後でアプリを終了したときに自動でインストールできます。",
    buttons: ["再起動してインストール", "後で"]
  }
};
let uiLocale = "ko";

function normalizeLocale(locale = "") {
  const value = locale.toLowerCase();
  if (value.startsWith("zh-tw") || value.startsWith("zh-hk") || value.startsWith("zh-hant")) return "zh-TW";
  if (value.startsWith("zh")) return "zh-CN";
  if (value.startsWith("ja")) return "ja";
  if (value.startsWith("en")) return "en";
  return "ko";
}

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
    const text = updateDialogs[uiLocale];
    const { response } = await dialog.showMessageBox(window, {
      type: "info",
      title: text.title,
      message: text.message(info.version),
      detail: text.detail,
      buttons: text.buttons,
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
  uiLocale = normalizeLocale(app.getLocale());
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
  ipcMain.on("set-ui-language", (_event, locale) => {
    uiLocale = normalizeLocale(locale);
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
