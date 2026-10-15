const { app, BrowserWindow, ipcMain, shell, dialog, session } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { loadCatalog, loadProfiles } = require("./catalog-loader");
const winget = require("./winget-utils");

let mainWindow;
let allowClose = false; // set true when the updater restarts the app, so the "installs running" prompt is skipped

// ---------- Single instance ----------
// A second copy would run parallel winget processes and parallel update downloads.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });

// ---------- Catalog ----------
// Which files make up the catalog is decided by catalog-loader.js (shared with the validator).
const loaded = loadCatalog(__dirname);
const loadedProfiles = loadProfiles(__dirname);
const catalogWarnings = [...loaded.errors, ...(loadedProfiles.error ? [loadedProfiles.error] : [])];
catalogWarnings.forEach((warning) => console.error("Catalog problem:", warning));
const catalog = loaded.entries.map(({ item }) => ({ ...item, sourceUrl: item.sourceUrl || (item.installType === "website" ? item.source : null) }));
const byId = new Map(catalog.map((item) => [item.id, item]));
const profiles = loadedProfiles.profiles;

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

// ---------- Window ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320, height: 860, minWidth: 980, minHeight: 680, backgroundColor: "#0b1020", title: "OpenInstall",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  // Closing the window mid-install would orphan the installer processes, so ask first.
  mainWindow.on("close", (event) => {
    if (allowClose || activeOps === 0) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning", buttons: ["Keep installing", "Quit anyway"], defaultId: 0, cancelId: 0, title: "Installations in progress",
      message: "OpenInstall is still installing or updating apps.",
      detail: "Quitting now stops the running WinGet processes and can leave an app half-installed."
    });
    if (choice === 0) event.preventDefault();
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

// ---------- WinGet runner ----------
const MAX_CAPTURED_OUTPUT = 64 * 1024;
const activeChildren = new Set();
let activeOps = 0;

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    // child.kill() on Windows only ends winget.exe, not the installer it launched, so kill the whole tree.
    if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => {});
    else child.kill();
  } catch {}
}

function runWinget(args, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn("winget", args, { windowsHide: true, shell: false }); }
    catch (error) { resolve({ ok: false, code: null, output: "", error: error.message }); return; }
    activeChildren.add(child);
    let stdout = "", stderr = "", settled = false;
    const combined = () => (stdout + "\n" + stderr).trim();
    const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); activeChildren.delete(child); resolve(result); };
    const timer = setTimeout(() => { killTree(child); finish({ ok: false, code: null, output: combined(), error: "Timed out waiting for WinGet." }); }, timeoutMs);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = winget.capAppend(stdout, chunk, MAX_CAPTURED_OUTPUT); });
    child.stderr.on("data", (chunk) => { stderr = winget.capAppend(stderr, chunk, MAX_CAPTURED_OUTPUT); });
    child.on("error", (error) => finish({ ok: false, code: null, output: combined(), error: error.code === "ENOENT" ? "WinGet was not found." : error.message }));
    child.on("close", (code) => finish({ ok: code === 0, code, output: combined(), error: code === 0 ? null : "WinGet exited with code " + code }));
  });
}

// Installs and updates run one at a time; two overlapping winget installs fight over the installer lock.
let opChain = Promise.resolve();
function runExclusive(task) {
  activeOps++;
  const run = opChain.then(task);
  opChain = run.catch(() => {});
  return run.finally(() => { activeOps--; });
}

let wingetOk = null;
async function checkWinget() {
  const result = await runWinget(["--version"], 15000);
  wingetOk = result.ok;
  return { available: result.ok, version: result.output.trim(), message: result.ok ? "WinGet is ready" : "WinGet was not found. Update App Installer from Microsoft Store." };
}
async function ensureWinget() { return wingetOk === true || (await checkWinget()).available; }

// ---------- Installed-app detection ----------
let installedCache = [];
let installedPromise = null;
const WINGET_COMMON = ["--accept-source-agreements", "--disable-interactivity"];

// Fast path: one `winget export` call lists every package winget recognises.
async function scanViaExport() {
  const file = path.join(app.getPath("temp"), "openinstall-export-" + process.pid + "-" + Date.now() + ".json");
  try {
    await runWinget(["export", "-o", file, ...WINGET_COMMON], 120000); // exit code can be non-zero even when the file is written
    let text;
    try { text = await fs.promises.readFile(file, "utf8"); } catch { return null; }
    const ids = winget.parseExportJson(text);
    if (!ids) return null;
    return catalog.filter((item) => item.installType !== "website" && item.packageId && ids.has(item.packageId.toLowerCase())).map((item) => item.id);
  } finally { fs.promises.unlink(file).catch(() => {}); }
}
// Slow fallback for old winget versions without a usable `export`: one `winget list` per catalog entry, 4 at a time.
async function scanPerPackage() {
  const queue = catalog.filter((item) => item.packageId && item.installType !== "website"); const found = []; let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const item = queue[next++];
      const result = await runWinget(["list", "--id", item.packageId, "--exact", ...WINGET_COMMON], 30000);
      if (result.ok && result.output.toLowerCase().includes(item.packageId.toLowerCase())) found.push(item.id);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return found;
}

// ---------- External links ----------
// Only open links that belong to the catalog or to this project's own release page.
const allowedPrefixes = new Set();
function addAllowed(urlString) {
  try {
    const url = new URL(urlString); if (url.protocol !== "https:") return;
    if (url.hostname === "github.com") { const [owner, repo] = url.pathname.split("/").filter(Boolean); if (owner && repo) allowedPrefixes.add("https://github.com/" + owner + "/" + repo + "/"); else if (owner) allowedPrefixes.add("https://github.com/" + owner + "/"); }
    else allowedPrefixes.add(url.origin + "/");
  } catch {}
}
catalog.forEach((item) => { addAllowed(item.source); addAllowed(item.sourceUrl); });
if (publishConfig.owner && publishConfig.repo) addAllowed("https://github.com/" + publishConfig.owner + "/" + publishConfig.repo + "/");
const isAllowedExternal = (url) => url.protocol === "https:" && [...allowedPrefixes].some((prefix) => url.href.startsWith(prefix));

// ---------- IPC ----------
ipcMain.handle("catalog:list", () => catalog);
ipcMain.handle("catalog:profiles", () => profiles);
ipcMain.handle("catalog:warnings", () => catalogWarnings);
ipcMain.handle("update:state", () => publicUpdateState());
ipcMain.handle("update:check", () => checkForUpdates(true));
ipcMain.handle("update:install", () => {
  if (updateState.state !== "ready") return { ok: false };
  if (!app.isPackaged) return { ok: true, simulated: true };
  allowClose = true; // the renderer already asked the user to confirm if installs are running
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return { ok: true };
});
ipcMain.handle("system:winget", () => checkWinget());
ipcMain.handle("apps:installed", async () => {
  if (activeOps > 0) return installedCache; // do not fight a running install for winget
  if (!(await ensureWinget())) { installedCache = []; return installedCache; }
  if (!installedPromise) {
    installedPromise = (async () => {
      let found = null;
      try { found = await scanViaExport(); } catch (error) { console.error("winget export scan failed:", error); }
      if (!found) found = await scanPerPackage();
      installedCache = found; return found;
    })().finally(() => { installedPromise = null; });
  }
  return installedPromise;
});
ipcMain.handle("apps:install", async (_event, id, preferUserScope = true) => {
  const item = byId.get(id);
  if (!item) return { ok: false, error: "This application is not in the trusted catalog." };
  if (item.installType === "website" && item.sourceUrl) {
    if (!/^https:\/\//.test(item.sourceUrl)) return { ok: false, appName: item.name, error: "Refusing to open a non-HTTPS link." };
    try { await shell.openExternal(item.sourceUrl); } catch (error) { return { ok: false, appName: item.name, error: "Could not open the browser: " + error.message }; }
    return { ok: true, appName: item.name, output: "Opened the official download page. Complete the installation there." };
  }
  if (!item.packageId) return { ok: false, appName: item.name, error: "No supported installation method is configured." };
  return runExclusive(async () => {
    if (installedPromise) await installedPromise.catch(() => {});
    if (!(await ensureWinget())) return { ok: false, appName: item.name, error: "WinGet was not found. Update App Installer from Microsoft Store." };
    const base = ["install", "--id", item.packageId, "--exact", "--silent", "--accept-package-agreements", ...WINGET_COMMON];
    const scoped = preferUserScope !== false;
    let result = await runWinget(scoped ? [...base, "--scope", "user"] : base);
    if (!result.ok && scoped && winget.isScopeFallback(result)) result = await runWinget(base);
    const verdict = winget.interpretInstall(result);
    return {
      ok: verdict.ok, appName: item.name, code: winget.normalizeCode(result.code), rebootRequired: Boolean(verdict.rebootRequired),
      output: verdict.ok ? verdict.message : "", error: verdict.ok ? null : verdict.message, details: verdict.ok ? "" : winget.tailOutput(result.output)
    };
  });
});
ipcMain.handle("apps:update", async (_event, id) => {
  const item = byId.get(id);
  if (!item) return { ok: false, error: "This application is not in the trusted catalog." };
  if (!item.packageId || item.installType === "website") return { ok: false, appName: item.name, error: "This application must be updated from its official website." };
  return runExclusive(async () => {
    if (installedPromise) await installedPromise.catch(() => {});
    if (!(await ensureWinget())) return { ok: false, appName: item.name, error: "WinGet was not found. Update App Installer from Microsoft Store." };
    // No --scope here: an app installed machine-wide would be filtered out and fail to update.
    const result = await runWinget(["upgrade", "--id", item.packageId, "--exact", "--silent", "--accept-package-agreements", ...WINGET_COMMON]);
    const verdict = winget.interpretUpgrade(result);
    return {
      ok: verdict.ok, appName: item.name, code: winget.normalizeCode(result.code), rebootRequired: Boolean(verdict.rebootRequired),
      output: verdict.ok ? verdict.message : "", error: verdict.ok ? null : verdict.message, details: verdict.ok ? "" : winget.tailOutput(result.output)
    };
  });
});
ipcMain.handle("external:open", async (_event, url) => {
  try {
    const parsed = new URL(url);
    if (!isAllowedExternal(parsed)) return { ok: false };
    await shell.openExternal(parsed.toString()); return { ok: true };
  } catch { return { ok: false }; }
});

// ---------- App lifecycle ----------
if (gotLock) {
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    createWindow(); configureAutoUpdates();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on("before-quit", () => { for (const child of activeChildren) killTree(child); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
