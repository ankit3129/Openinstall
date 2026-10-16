const { app, BrowserWindow, ipcMain, shell, dialog, session } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const fs = require("node:fs");
const { loadCatalog, loadProfiles } = require("./catalog-loader");
const winget = require("./winget-utils");
const { createRunner } = require("./winget-runner");

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
// Which bundled logos exist (src/logos/<id>.png) is checked once here, so the window never requests files that are not there.
const hasLogoFile = (id) => /^[a-z0-9][a-z0-9._-]*$/i.test(String(id)) && fs.existsSync(path.join(__dirname, "logos", id + ".png"));
const catalog = loaded.entries.map(({ item }) => ({ ...item, sourceUrl: item.sourceUrl || (item.installType === "website" ? item.source : null), hasLogo: hasLogoFile(item.id) }));
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
  autoUpdater.on("update-available", (info) => { manualCheck = false; setUpdateState({ state: "downloading", version: info.version, percent: 0, message: "" }); });
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
  manualCheck = manualCheck || manual; // a background check must not cancel the feedback of a manual one that is still running
  if (updateState.state === "error" || updateState.state === "uptodate") setUpdateState({ state: "idle", message: "" });
  try { await autoUpdater.checkForUpdates(); } catch (error) { if (updateState.state !== "error") handleUpdateError(error); }
  return publicUpdateState();
}

// ---------- Window ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320, height: 860, minWidth: 980, minHeight: 680, backgroundColor: "#060607", title: "OpenInstall", icon: path.join(__dirname, "icon.png"),
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
const runner = createRunner();
const runWinget = runner.run;
let activeOps = 0; // > 0 while a queue is running; used by the close prompt and to keep scans away from running installs

let wingetOk = null;
async function checkWinget() {
  const result = await runWinget(["--version"], 15000);
  wingetOk = result.ok;
  return { available: result.ok, version: result.output.trim(), message: result.ok ? "WinGet is ready" : "WinGet was not found. Update App Installer from Microsoft Store." };
}
async function ensureWinget() { return wingetOk === true || (await checkWinget()).available; }

// ---------- Installed-app detection ----------
// installedMap: catalog id -> lowercase package id that is really installed (may differ from the catalog's pinned id, see detectRegex).
let installedMap = new Map();
let installedPromise = null;
let upgradableCache = null; // array of catalog ids, or null when unknown
let upgradablePromise = null;
const WINGET_COMMON = ["--accept-source-agreements", "--disable-interactivity"];
const SRC = winget.SOURCE_ARGS;
const installedIds = () => [...installedMap.keys()];

// Fast path: one `winget export` call lists every package winget recognises.
async function scanViaExport() {
  const file = path.join(app.getPath("temp"), "openinstall-export-" + process.pid + "-" + Date.now() + ".json");
  try {
    await runWinget(["export", "-o", file, ...SRC, ...WINGET_COMMON], 120000); // exit code can be non-zero even when the file is written
    let text;
    try { text = await fs.promises.readFile(file, "utf8"); } catch { return null; }
    const ids = winget.parseExportJson(text);
    if (!ids) return null;
    const map = new Map();
    for (const item of catalog) {
      if (item.installType === "website") continue;
      const actual = winget.matchInstalled(item, ids);
      if (actual) map.set(item.id, actual);
    }
    return map;
  } finally { fs.promises.unlink(file).catch(() => {}); }
}
// Slow fallback for old winget versions without a usable `export`: one `winget list` per catalog entry, 4 at a time.
async function scanPerPackage() {
  const queue = catalog.filter((item) => item.packageId && item.installType !== "website"); const found = new Map(); let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const item = queue[next++];
      const result = await runWinget(["list", "--id", item.packageId, "--exact", ...SRC, ...WINGET_COMMON], 30000);
      if (result.ok && result.output.toLowerCase().includes(item.packageId.toLowerCase())) found.set(item.id, item.packageId.toLowerCase());
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return found;
}
// One shared scan; resolves with the catalog ids that are installed.
function scanInstalled() {
  if (!installedPromise) {
    installedPromise = (async () => {
      let found = null;
      try { found = await scanViaExport(); } catch (error) { console.error("winget export scan failed:", error); }
      if (!found) found = await scanPerPackage();
      installedMap = found; upgradableCache = null;
      return installedIds();
    })().finally(() => { installedPromise = null; });
  }
  return installedPromise;
}
// Which installed catalog apps have a newer version? One `winget upgrade` call instead of one per app.
function scanUpgradable() {
  if (!upgradablePromise) {
    upgradablePromise = (async () => {
      const result = await runWinget(["upgrade", ...SRC, ...WINGET_COMMON], 120000);
      const usable = result.output && (result.ok || winget.normalizeCode(result.code) === winget.CODES.NO_PACKAGES_FOUND);
      if (!usable) return null;
      const byPackage = new Map([...installedMap].map(([id, pkg]) => [pkg, id]));
      const hits = winget.parseUpgradeOutput(result.output, byPackage.keys());
      return [...hits].map((pkg) => byPackage.get(pkg)).filter(Boolean);
    })().then((list) => { upgradableCache = list; return list; }).finally(() => { upgradablePromise = null; });
  }
  return upgradablePromise;
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
catalog.forEach((item) => { addAllowed(item.source); addAllowed(item.sourceUrl); addAllowed(item.github); });
if (publishConfig.owner && publishConfig.repo) addAllowed("https://github.com/" + publishConfig.owner + "/" + publishConfig.repo + "/");
const isAllowedExternal = (url) => url.protocol === "https:" && [...allowedPrefixes].some((prefix) => url.href.startsWith(prefix));

// ---------- Install / update queue ----------
// The whole queue runs here, not in the window: it keeps going (and stays guarded by the close prompt) between items,
// can be cancelled, and the window only receives progress events.
let batch = null; // { cancelled: boolean } while a queue is running
function sendProgress(payload) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("queue:progress", payload); }
const WINGET_MISSING = "WinGet was not found. Update App Installer from Microsoft Store.";

function describe(result, verdict, extra) {
  const ok = verdict.ok;
  return {
    status: ok ? "success" : "failure",
    message: verdict.message + (extra || ""),
    details: ok ? "" : winget.tailOutput(result.output),
    rebootRequired: Boolean(verdict.rebootRequired),
    upToDate: Boolean(verdict.upToDate)
  };
}

// Each winget call gets its own tracker, so a retry (machine-wide fallback) starts again from 0%.
function trackerFor(report) {
  if (!report) return undefined;
  const tracker = winget.createProgressTracker();
  return (chunk) => { const update = tracker.push(chunk); if (update) report(update); };
}

async function installOne(item, preferUserScope, report) {
  if (item.installType === "website") {
    if (!item.sourceUrl || !/^https:\/\//.test(item.sourceUrl)) return { status: "failure", message: "Refusing to open a non-HTTPS link." };
    try { await shell.openExternal(item.sourceUrl); } catch (error) { return { status: "failure", message: "Could not open the browser: " + error.message }; }
    return { status: "opened", message: "Opened the official download page — finish installing there" };
  }
  if (!item.packageId) return { status: "failure", message: "No supported installation method is configured." };
  if (installedMap.has(item.id)) return { status: "skipped", reason: "already", message: "Already installed — skipped" };
  if (!(await ensureWinget())) return { status: "failure", message: WINGET_MISSING };
  const base = ["install", "--id", item.packageId, "--exact", ...SRC, "--silent", "--accept-package-agreements", ...WINGET_COMMON];
  const scoped = preferUserScope !== false;
  let result = await runWinget(scoped ? [...base, "--scope", "user"] : base, undefined, trackerFor(report));
  let retried = false;
  if (result.cancelled) return { status: "skipped", reason: "cancelled", message: "Cancelled" };
  if (!result.ok && scoped && winget.isScopeFallback(result)) {
    retried = true; result = await runWinget(base, undefined, trackerFor(report)); // no per-user installer exists: retry with WinGet's default scope (may ask for administrator approval)
    if (result.cancelled) return { status: "skipped", reason: "cancelled", message: "Cancelled" };
  }
  const verdict = winget.interpretInstall(result);
  const note = retried ? " (no per-user installer exists, so it was installed machine-wide)" : "";
  const out = describe(result, verdict, retried && verdict.ok ? note : "");
  if (retried && !verdict.ok) out.details = ("Retried without per-user scope. " + out.details).trim();
  if (verdict.ok) { installedMap.set(item.id, item.packageId.toLowerCase()); if (upgradableCache) upgradableCache = upgradableCache.filter((id) => id !== item.id); }
  return out;
}

async function updateOne(item, report) {
  if (!item.packageId || item.installType === "website") return { status: "failure", message: "This application must be updated from its official website." };
  if (!(await ensureWinget())) return { status: "failure", message: WINGET_MISSING };
  const target = installedMap.get(item.id) || item.packageId; // the version family that is really installed, not the catalog's pinned id
  // No --scope here: an app installed machine-wide would be filtered out and fail to update.
  const result = await runWinget(["upgrade", "--id", target, "--exact", ...SRC, "--silent", "--accept-package-agreements", ...WINGET_COMMON], undefined, trackerFor(report));
  if (result.cancelled) return { status: "skipped", reason: "cancelled", message: "Cancelled" };
  const verdict = winget.interpretUpgrade(result);
  if (verdict.ok && upgradableCache) upgradableCache = upgradableCache.filter((id) => id !== item.id);
  return describe(result, verdict);
}

async function runQueue(request) {
  if (batch) return { ok: false, error: "Another queue is already running." };
  const action = request && request.action === "update" ? "update" : "install";
  const requested = Array.isArray(request && request.ids) ? [...new Set(request.ids.filter((id) => typeof id === "string"))] : [];
  if (!requested.length) return { ok: false, error: "Nothing was selected." };
  const preferUserScope = !request || request.preferUserScope !== false;
  batch = { cancelled: false }; activeOps++;
  const results = [];
  try {
    if (installedPromise) await installedPromise.catch(() => {}); // let a running scan finish first so it cannot fight the first install
    for (let index = 0; index < requested.length; index++) {
      const id = requested[index]; const item = byId.get(id); const total = requested.length;
      if (!item) { const r = { id, name: id, status: "failure", message: "This application is not in the trusted catalog." }; results.push(r); sendProgress({ phase: "done", index, total, ...r }); continue; }
      if (batch.cancelled) { const r = { id, name: item.name, status: "skipped", reason: "cancelled", message: "Cancelled" }; results.push(r); sendProgress({ phase: "done", index, total, ...r }); continue; }
      sendProgress({ phase: "start", index, total, id, name: item.name, status: "pending", message: "In progress…" });
      let outcome; let lastSent = 0, lastStage = "";
      // Progress events are throttled (a progress bar redraws many times a second) but a change of stage always goes through.
      const report = (update) => {
        const now = Date.now();
        if (update.stage === lastStage && update.stage !== "done" && now - lastSent < 120) return;
        lastSent = now; lastStage = update.stage;
        sendProgress({ phase: "progress", index, total, id, name: item.name, stage: update.stage, percent: update.percent, downloaded: update.downloaded, bytesTotal: update.total });
      };
      try { outcome = action === "update" ? await updateOne(item, report) : await installOne(item, preferUserScope, report); }
      catch (error) { outcome = { status: "failure", message: error.message || "Unexpected error" }; }
      const r = { id, name: item.name, ...outcome }; results.push(r);
      sendProgress({ phase: "done", index, total, ...r });
    }
    return { ok: true, action, cancelled: batch.cancelled, results };
  } finally { batch = null; activeOps--; }
}

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
  setTimeout(() => { allowClose = false; }, 30000).unref(); // if the restart never happens, the close prompt must work again
  setImmediate(() => { try { autoUpdater.quitAndInstall(true, true); } catch (error) { allowClose = false; console.error("quitAndInstall failed:", error); } });
  return { ok: true };
});
ipcMain.handle("system:winget", () => checkWinget());
ipcMain.handle("apps:installed", async () => {
  if (activeOps > 0) return installedIds(); // do not fight a running install for winget
  if (!(await ensureWinget())) { installedMap = new Map(); upgradableCache = null; return []; }
  return scanInstalled();
});
ipcMain.handle("apps:upgradable", async () => {
  if (activeOps > 0) return upgradableCache;
  if (!(await ensureWinget())) return null;
  if (installedPromise) await installedPromise.catch(() => {});
  return scanUpgradable();
});
ipcMain.handle("queue:run", (_event, request) => runQueue(request));
ipcMain.handle("queue:cancel", async () => {
  if (!batch) return { ok: false };
  batch.cancelled = true; await runner.killAll();
  return { ok: true };
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
    session.defaultSession.setPermissionCheckHandler(() => false);
    createWindow(); configureAutoUpdates();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on("before-quit", () => { runner.killAll(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
