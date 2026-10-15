const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

let mainWindow;
const catalogPath = path.join(__dirname, "software.json");
const rawCatalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const catalog = rawCatalog.map((item) => ({
  ...item,
  packageId: item.packageId || (item.method === "winget" ? item.id : null),
  installType: item.installType || (item.method === "website" ? "website" : "winget"),
  sourceUrl: item.sourceUrl || (item.method === "website" ? item.source : null)
}));
const byId = new Map(catalog.map((item) => [item.id, item]));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#0b1020",
    title: "OpenInstall",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

function runWinget(args, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve) => {
    const child = spawn("winget", args, { windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, code: null, output: (stdout + "\n" + stderr).trim(), error: "Timed out waiting for WinGet." });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => finish({ ok: false, code: null, output: (stdout + "\n" + stderr).trim(), error: error.message }));
    child.on("close", (code) => finish({ ok: code === 0, code, output: (stdout + "\n" + stderr).trim(), error: code === 0 ? null : "WinGet exited with code " + code }));
  });
}

ipcMain.handle("catalog:list", () => catalog);

ipcMain.handle("system:winget", async () => {
  const result = await runWinget(["--version"], 15000);
  return { available: result.ok, version: result.output.trim(), message: result.ok ? "WinGet is ready" : "WinGet was not found. Update App Installer from Microsoft Store." };
});

ipcMain.handle("apps:installed", async () => {
  const results = await Promise.all(catalog.map(async (item) => {
    if (!item.packageId || item.installType === "website") return null;
    const result = await runWinget(["list", "--id", item.packageId, "--exact", "--disable-interactivity"], 20000);
    const text = result.output.toLowerCase();
    const found = result.ok && text.includes(item.packageId.toLowerCase());
    return found ? item.id : null;
  }));
  return results.filter(Boolean);
});

ipcMain.handle("apps:install", async (_event, id, preferUserScope = true) => {
  const item = byId.get(id);
  if (!item) return { ok: false, error: "This application is not in the trusted catalog." };
  if (item.installType === "website" && item.sourceUrl) {
    await shell.openExternal(item.sourceUrl);
    return { ok: true, appName: item.name, output: "Opened the official download page. Complete the installation there." };
  }
  if (!item.packageId) return { ok: false, appName: item.name, error: "No supported installation method is configured." };
  const args = ["install", "--id", item.packageId, "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"];
  if (preferUserScope) args.push("--scope", "user");
  const result = await runWinget(args);
  return { ...result, appName: item.name };
});

ipcMain.handle("apps:update", async (_event, id, preferUserScope = true) => {
  const item = byId.get(id);
  if (!item) return { ok: false, error: "This application is not in the trusted catalog." };
  if (!item.packageId || item.installType === "website") return { ok: false, appName: item.name, error: "This application must be updated from its official website." };
  const args = ["upgrade", "--id", item.packageId, "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"];
  if (preferUserScope) args.push("--scope", "user");
  const result = await runWinget(args);
  return { ...result, appName: item.name };
});

ipcMain.handle("external:open", async (_event, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return { ok: false };
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
