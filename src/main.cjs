const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { writeFile } = require("node:fs/promises");
const path = require("node:path");
const { analyzePage } = require("./openai.cjs");

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
