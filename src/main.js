const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

let mainWindow;
const catalogParts = ["catalog-part1.json", "catalog-part2.json", "catalog-part3.json", "catalog-part4.json"];
const rawCatalog = catalogParts.flatMap((file) => {
  const catalogPath = path.join(__dirname, file);
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("Expected an array");
    return parsed;
  } catch (error) {
    console.error("Failed to load catalog part:", catalogPath, error);
    return [];
  }
});
const catalog = rawCatalog.map((item) => ({ ...item, sourceUrl: item.sourceUrl || (item.installType === "website" ? item.source : null) }));
const byId = new Map(catalog.map((item) => [item.id, item]));

// ---------- Auto updates ----------
const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
const packageInfo = require("../package.json");
const publishConfig = ((packageInfo.build && packageInfo.build.publish) || [])[0] || {};
const releasePageFor = (version) => publishConfig.owner && publishConfig.repo && version
  ? "https://github.com/" + publishConfig.owner + "/" + publishConfig.repo + "/releases/tag/v" + version : null;
let updateState = { state: "idle", version: null, percent: 0, message: "" };
let manualCheck = false;
function publicUpdateState() { return { ...updateState, currentVersion: app.getVersion(), packaged: app.isPackaged, releaseUrl: releasePageFor(updateState.version) }; }
function setUpdateState(patch) { updateState = { ...updateState, ...patch }; if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("update:status", publicUpdateState()); }
function simulateUpdate() {
  const version = "99.0.0"; setUpdateState({ state: "downloading", version, percent: 0 }); let percent = 0;
  const timer = setInterval(() => { percent += 10; if (percent >= 100) { clearInterval(timer); setUpdateState({ state: "ready", version, percent: 100 }); } else setUpdateState({ percent }); }, 400);
}
function configureAutoUpdates() {
  if (!app.isPackaged) { if (process.env.OPENINSTALL_SIMULATE_UPDATE) setTimeout(simulateUpdate, 2500); return; }
  autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true; autoUpdater.allowPrerelease = false;
  autoUpdater.on("checking-for-update", () => { if (manualCheck) setUpdateState({ state: "checking", message: "" }); });
  autoUpdater.on("update-available", (info) => setUpdateState({ state: "downloading", version: info.version, percent: 0, message: "" }));
  autoUpdater.on("download-progress", (progress) => setUpdateState({ state: "downloading", percent: Math.round(progress.percent || 0) }));
  autoUpdater.on("update-downloaded", (info) => setUpdateState({ state: "ready", version: info.version, percent: 100, message: "" }));
  autoUpdater.on("update-not-available", () => { if (manualCheck) setUpdateState({ state: "uptodate", message: "" }); manualCheck = false; });
  autoUpdater.on("error", (error) => handleUpdateError(error));
  setTimeout(() => checkForUpdates(false), 5000); setInterval(() => checkForUpdates(false), UPDATE_INTERVAL_MS).unref();
}
function handleUpdateError(error) {
  console.error("OpenInstall update problem:", error && error.message);
  if (manualCheck) setUpdateState({ state: "error", message: "Could not check for updates. Check your internet connection and try again." });
  else if (updateState.state === "downloading" || updateState.state === "checking") setUpdateState({ state: "idle", percent: 0 });
  manualCheck = false;
}
async function checkForUpdates(manual) {
  if (!app.isPackaged) { if (manual) setUpdateState({ state: "uptodate", message: "" }); return publicUpdateState(); }
  if (updateState.state === "downloading" || updateState.state === "ready") return publicUpdateState();
  manualCheck = manual;
  if (updateState.state === "error" || updateState.state === "uptodate") setUpdateState({ state: "idle", message: "" });
  try { await autoUpdater.checkForUpdates(); } catch (error) { if (updateState.state !== "error") handleUpdateError(error); }
  return publicUpdateState();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320, height: 860, minWidth: 980, minHeight: 680, backgroundColor: "#0b1020", title: "OpenInstall",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}
function runWinget(args, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve) => {
    const child = spawn("winget", args, { windowsHide: true, shell: false });
    let stdout = "", stderr = "", settled = false;
    const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => { child.kill(); finish({ ok: false, code: null, output: (stdout + "\n" + stderr).trim(), error: "Timed out waiting for WinGet." }); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => finish({ ok: false, code: null, output: (stdout + "\n" + stderr).trim(), error: error.message }));
    child.on("close", (code) => finish({ ok: code === 0, code, output: (stdout + "\n" + stderr).trim(), error: code === 0 ? null : "WinGet exited with code " + code }));
  });
}
ipcMain.handle("catalog:list", () => { console.info("Returning catalog entries:", catalog.length); return catalog; });
ipcMain.handle("update:state", () => publicUpdateState());
ipcMain.handle("update:check", () => checkForUpdates(true));
ipcMain.handle("update:install", () => { if (updateState.state !== "ready") return { ok: false }; if (!app.isPackaged) return { ok: true, simulated: true }; setImmediate(() => autoUpdater.quitAndInstall(true, true)); return { ok: true }; });
ipcMain.handle("system:winget", async () => { const result = await runWinget(["--version"], 15000); return { available: result.ok, version: result.output.trim(), message: result.ok ? "WinGet is ready" : "WinGet was not found. Update App Installer from Microsoft Store." }; });
ipcMain.handle("apps:installed", async () => {
  const queue = catalog.filter((item) => item.packageId && item.installType !== "website"); const found = []; let next = 0;
  const worker = async () => { while (next < queue.length) { const item = queue[next++]; const result = await runWinget(["list", "--id", item.packageId, "--exact", "--disable-interactivity", "--accept-source-agreements"], 30000); if (result.ok && result.output.toLowerCase().includes(item.packageId.toLowerCase())) found.push(item.id); } };
  await Promise.all(Array.from({ length: 4 }, worker)); return found;
});
ipcMain.handle("apps:install", async (_event, id, preferUserScope = true) => {
  const item = byId.get(id);
  if (!item) return { ok: false, error: "This application is not in the trusted catalog." };
  if (item.installType === "website" && item.sourceUrl) {
    if (!/^https:\/\//.test(item.sourceUrl)) return { ok: false, appName: item.name, error: "Refusing to open a non-HTTPS link." };
    await shell.openExternal(item.sourceUrl); return { ok: true, appName: item.name, output: "Opened the official download page. Complete the installation there." };
  }
  if (!item.packageId) return { ok: false, appName: item.name, error: "No supported installation method is configured." };
  const base = ["install", "--id", item.packageId, "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"];
  let result = await runWinget(preferUserScope ? [...base, "--scope", "user"] : base);
  if (!result.ok && preferUserScope && /no applicable installer|scope/i.test(result.output)) result = await runWinget(base);
  if (!result.ok && /already installed|0x8a150061/i.test(result.output)) result = { ...result, ok: true, error: null, output: "Already installed." };
  return { ...result, appName: item.name };
});
ipcMain.handle("apps:update", async (_event, id, preferUserScope = true) => {
  const item = byId.get(id);
  if (!item) return { ok: false, error: "This application is not in the trusted catalog." };
  if (!item.packageId || item.installType === "website") return { ok: false, appName: item.name, error: "This application must be updated from its official website." };
  const args = ["upgrade", "--id", item.packageId, "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"];
  if (preferUserScope) args.push("--scope", "user");
  const result = await runWinget(args);
  if (!result.ok && /no available upgrade|no newer package|0x8a15002b/i.test(result.output)) return { ok: true, appName: item.name, output: "Already up to date." };
  return { ...result, appName: item.name };
});
ipcMain.handle("external:open", async (_event, url) => { try { const parsed = new URL(url); if (parsed.protocol !== "https:") return { ok: false }; await shell.openExternal(parsed.toString()); return { ok: true }; } catch { return { ok: false }; } });
app.whenReady().then(() => { createWindow(); configureAutoUpdates(); app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
