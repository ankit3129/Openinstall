const $ = (selector) => document.querySelector(selector);
const state = { catalog: [], selected: new Set(), installed: new Set(), upgradable: null, upgradeChecked: false, view: "discover", busy: false };
let failedIds = [];
let profiles = [];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const iconFor = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const hueFor = (text) => { let h = 0; for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

// ---------- Logos ----------
// Privacy: by default nothing is fetched from the internet. App tiles use the emoji / initials from the catalog.
// Real logos are opt-in because each one is a request to Google / DuckDuckGo / GitHub that reveals which apps you browse.
const LOGO_KEY = "openinstall.webLogos";
let webLogos = false;
try { webLogos = localStorage.getItem(LOGO_KEY) === "1"; } catch {}
// Bundled logos (src/logos/<id>.png, created by `npm run fetch:logos`) are always tried first: they are local files, so they cost no privacy.
// A missing file just falls through to the next URL, and finally to the emoji / initials.
const logoUrlsFor = (app) => {
  const urls = ["logos/" + encodeURIComponent(app.id) + ".png"];
  if (!webLogos) return urls;
  try {
    const site = new URL(app.source);
    if (site.hostname === "github.com") {
      // A favicon lookup for github.com would just return the GitHub logo for every GitHub-hosted app, so only use the owner's avatar.
      const owner = site.pathname.split("/").filter(Boolean)[0];
      if (owner) urls.push("https://github.com/" + encodeURIComponent(owner) + ".png?size=128");
      return urls;
    }
    const domain = site.hostname.replace(/^www\./, "");
    urls.push("https://www.google.com/s2/favicons?domain=" + encodeURIComponent(domain) + "&sz=128");
    urls.push("https://icons.duckduckgo.com/ip3/" + encodeURIComponent(domain) + ".ico");
    urls.push("https://icon.horse/icon/" + encodeURIComponent(domain));
  } catch {}
  return urls;
};
const appIconMarkup = (app) => {
  const urls = logoUrlsFor(app);
  const glyph = app.icon || iconFor(app.name);
  const hue = hueFor(app.id || app.name);
  const image = urls.length ? '<img src="' + escapeHtml(urls[0]) + '" data-fallbacks="' + escapeHtml(JSON.stringify(urls.slice(1))) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : "";
  return '<div class="app-icon" data-hue="' + hue + '" role="img" aria-label="' + escapeHtml(app.name) + ' logo">' + image + '<span class="' + (app.icon ? "emoji" : "") + '">' + escapeHtml(glyph) + '</span></div>';
};
function wireLogoFallbacks(root) {
  root.querySelectorAll(".app-icon").forEach((icon) => icon.style.setProperty("--hue", icon.dataset.hue || "250"));
  root.querySelectorAll(".app-icon img").forEach((image) => {
    const next = () => {
      const fallbacks = JSON.parse(image.dataset.fallbacks || "[]");
      if (fallbacks.length) { image.dataset.fallbacks = JSON.stringify(fallbacks.slice(1)); image.src = fallbacks[0]; }
      else image.remove();
    };
    image.addEventListener("error", next);
    image.addEventListener("load", () => { const remaining = JSON.parse(image.dataset.fallbacks || "[]"); if (image.naturalWidth < 20 && remaining.length) next(); });
  });
}

// ---------- Catalog views ----------
function renderCategories() {
  const select = $("#category-filter"); const current = select.value;
  const categories = [...new Set(state.catalog.map((app) => app.category))].sort();
  select.innerHTML = '<option value="all">All categories</option>' + categories.map((category) => '<option value="' + escapeHtml(category) + '">' + escapeHtml(category) + '</option>').join("");
  if (categories.includes(current)) select.value = current;
}
const licenseGroup = (label) => {
  const l = String(label || "").toLowerCase();
  // "core", "client", "base" and "components" mean part of the product is closed, so they must not pass an open-source-only filter.
  if (/^open source (core|client|base|components)\b/.test(l)) return "Partly open source";
  if (l.startsWith("open source")) return "Open source";
  if (l.startsWith("freeware") || l.startsWith("proprietary freeware") || l.startsWith("free ")) return "Freeware";
  return "Proprietary";
};
function filteredApps() {
  const query = $("#search-input").value.trim().toLowerCase(); const category = $("#category-filter").value; const license = $("#license-filter").value;
  return state.catalog.filter((app) => (!query || app._hay.includes(query)) && (category === "all" || app.category === category) && (license === "all" || licenseGroup(app.license) === license));
}
function updateSelectionUI() {
  $("#selected-count").textContent = state.selected.size;
  $("#selection-button").disabled = state.selected.size === 0 || state.busy;
}
function renderApps() {
  if (state.view === "installed") return renderInstalledView();
  if (state.view === "profiles") { $("#app-grid").classList.add("hidden"); $("#empty-state").classList.add("hidden"); updateSelectionUI(); return; }
  const apps = filteredApps();
  $("#result-count").textContent = apps.length + " apps in view · " + state.catalog.length + " in catalog";
  $("#app-grid").innerHTML = apps.map((app) => {
    const selected = state.selected.has(app.id); const installed = state.installed.has(app.id);
    return '<article class="app-card ' + (selected ? "selected" : "") + '" data-app="' + escapeHtml(app.id) + '">' +
      '<div class="app-card-top">' + appIconMarkup(app) + '<button class="select-app ' + (selected ? "checked" : "") + '" data-select="' + escapeHtml(app.id) + '" aria-pressed="' + selected + '" aria-label="Select ' + escapeHtml(app.name) + '">' + (selected ? "✓" : "+") + '</button></div>' +
      '<div class="app-title-row"><h3>' + escapeHtml(app.name) + '</h3>' + (installed ? '<span class="installed-badge">Installed</span>' : "") + '</div>' +
      '<p class="app-description">' + escapeHtml(app.description) + '</p><div class="app-meta"><span>' + escapeHtml(app.category) + '</span><span class="license-tag">' + escapeHtml(app.license) + '</span></div></article>';
  }).join("");
  wireLogoFallbacks($("#app-grid"));
  $("#empty-state").classList.toggle("hidden", apps.length !== 0); $("#app-grid").classList.toggle("hidden", apps.length === 0);
  updateSelectionUI();
}
function renderInstalledView() {
  const query = $("#search-input").value.trim().toLowerCase();
  const apps = state.catalog.filter((app) => state.installed.has(app.id) && (!query || app._hay.includes(query)));
  const upgradable = state.upgradable;
  $("#result-count").textContent = apps.length + " detected installed apps" + (upgradable ? " · " + upgradable.size + " with updates" : "");
  $("#app-grid").innerHTML = apps.map((app) => {
    const hasUpdate = upgradable ? upgradable.has(app.id) : false;
    const action = app.installType === "website" ? "" : '<button class="update-app" data-update="' + escapeHtml(app.id) + '"' + (state.busy ? " disabled" : "") + '>' + "Update" + '</button>';
    return '<article class="app-card"><div class="app-card-top">' + appIconMarkup(app) + action + '</div><div class="app-title-row"><h3>' + escapeHtml(app.name) + '</h3>' +
      (hasUpdate ? '<span class="update-badge">Update available</span>' : '<span class="installed-badge">Installed</span>') + '</div><p class="app-description">' + escapeHtml(app.description) + '</p></article>';
  }).join("");
  wireLogoFallbacks($("#app-grid")); $("#empty-state").classList.toggle("hidden", apps.length > 0); $("#app-grid").classList.toggle("hidden", apps.length === 0);
  updateUpdateAll(); updateSelectionUI();
}
// "Update all" updates the apps known to have a newer version; if the check could not run, it tries every installed app.
function updateAllIds() {
  const updatable = (app) => state.installed.has(app.id) && app.installType !== "website";
  return state.catalog.filter((app) => updatable(app) && (!state.upgradable || state.upgradable.has(app.id))).map((app) => app.id);
}
function updateUpdateAll() {
  const button = $("#update-all"); const show = state.view === "installed";
  button.classList.toggle("hidden", !show); if (!show) return;
  const ids = updateAllIds();
  button.disabled = state.busy || ids.length === 0;
  button.textContent = state.upgradable && ids.length === 0 ? "All up to date ✓" : "Update all" + (state.upgradable ? " (" + ids.length + ")" : "");
}
function renderProfiles() {
  $("#profiles-panel").innerHTML = profiles.map((profile, index) => '<button class="profile-card" data-profile="' + index + '"><span class="profile-spark">✦</span><strong>' + escapeHtml(profile.name) + '</strong><span>' + escapeHtml(profile.description) + '</span><small>' + profile.ids.length + ' suggested apps · Select profile</small></button>').join("");
}

// ---------- Queue ----------
const STATUS_ICON = { success: "✓", opened: "↗", skipped: "–", pending: "…", failure: "!" };
function renderQueue(rows, summary) {
  $("#queue-panel").classList.remove("hidden");
  if (summary !== undefined) $("#queue-summary").textContent = summary;
  $("#queue-list").innerHTML = rows.map((r) => '<div class="queue-item"><span class="queue-status ' + r.status + '">' + STATUS_ICON[r.status] + '</span><div class="queue-info"><strong>' + escapeHtml(r.name) + '</strong><small>' + escapeHtml(r.message || "") + '</small>' +
    (r.details ? '<small class="queue-details">' + escapeHtml(r.details) + '</small>' : "") + '</div></div>').join("");
}
let refreshPromise = null;
function refreshInstalled() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    $("#refresh-btn").classList.add("spinning");
    try { state.installed = new Set(await window.openInstall.getInstalled()); state.upgradable = null; state.upgradeChecked = false; renderApps(); }
    catch { $("#winget-status").textContent = "Could not check installed apps"; }
    finally { $("#refresh-btn").classList.remove("spinning"); }
    if (state.view === "installed") await refreshUpgradable();
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}
// One `winget upgrade` call tells us which installed apps have updates (null = could not tell).
let upgradablePromise = null;
function refreshUpgradable() {
  if (upgradablePromise) return upgradablePromise;
  upgradablePromise = (async () => {
    state.upgradeChecked = true;
    try { const list = await window.openInstall.getUpgradable(); state.upgradable = Array.isArray(list) ? new Set(list) : null; }
    catch { state.upgradable = null; }
    if (state.view === "installed") renderApps();
  })().finally(() => { upgradablePromise = null; });
  return upgradablePromise;
}

// The queue itself runs in the main process (so it survives UI re-renders, can be cancelled, and is covered by the close prompt).
// The window only shows progress events and the final result.
let queueRows = []; let queueAction = "install";
window.openInstall.onQueueProgress((event) => {
  queueRows[event.index] = { id: event.id, name: event.name, status: event.status, message: event.message, details: event.details };
  const verb = queueAction === "update" ? "Updating " : "Installing ";
  renderQueue(queueRows.filter(Boolean), event.phase === "start" ? verb + (event.index + 1) + " of " + event.total + ": " + event.name : undefined);
});
function setQueueRunning(running) {
  $("#cancel-queue").classList.toggle("hidden", !running); $("#cancel-queue").disabled = false; $("#cancel-queue").textContent = "Cancel";
  if (running) $("#retry-failed").classList.add("hidden");
  document.querySelectorAll(".update-app").forEach((button) => { button.disabled = running; });
}
async function runQueue(action, ids, label) {
  if (state.busy || ids.length === 0) return;
  state.busy = true; queueAction = action; queueRows = []; failedIds = []; updateSelectionUI(); updateUpdateAll(); setQueueRunning(true);
  renderQueue([], (action === "update" ? "Updating " : "Installing ") + (label || ids.length + " apps") + "…");
  let outcome;
  try { outcome = await window.openInstall.runQueue({ action, ids, preferUserScope: $("#user-scope").checked }); }
  catch (error) { outcome = { ok: false, error: error.message }; }
  setQueueRunning(false);
  if (!outcome || !outcome.ok) {
    renderQueue([{ name: "OpenInstall", status: "failure", message: (outcome && outcome.error) || "The queue could not run." }], "Could not run the queue");
  } else {
    const counts = { installed: 0, updated: 0, opened: 0, already: 0, cancelled: 0, failed: 0, reboot: 0 };
    const rows = outcome.results.map((r) => {
      if (r.status === "success") { if (action === "update") counts.updated++; else counts.installed++; if (r.rebootRequired) counts.reboot++; }
      else if (r.status === "opened") counts.opened++;
      else if (r.status === "skipped") { if (r.reason === "cancelled") counts.cancelled++; else counts.already++; }
      else { counts.failed++; failedIds.push(r.id); }
      // Keep local state in step with what just happened instead of rescanning with a slow `winget export`.
      if (r.status === "success" && action === "install") state.installed.add(r.id);
      if (r.status === "success" && action === "update" && state.upgradable) state.upgradable.delete(r.id);
      if (r.status !== "failure" && !(r.status === "skipped" && r.reason === "cancelled")) state.selected.delete(r.id);
      return { name: r.name, status: r.status, message: r.message, details: r.details };
    });
    const parts = [];
    if (counts.installed) parts.push(counts.installed + " installed");
    if (counts.updated) parts.push(counts.updated + " updated");
    if (counts.opened) parts.push(counts.opened + " download " + (counts.opened === 1 ? "page" : "pages") + " opened");
    if (counts.already) parts.push(counts.already + " already installed");
    if (counts.cancelled) parts.push(counts.cancelled + " cancelled");
    if (counts.failed) parts.push(counts.failed + " need attention");
    if (counts.reboot) parts.push("restart Windows to finish");
    renderQueue(rows, parts.join(" · ") || "Nothing to do");
  }
  $("#retry-failed").classList.toggle("hidden", failedIds.length === 0);
  state.busy = false; renderApps(); updateUpdateAll();
}
function installSelected() {
  const ids = state.catalog.filter((app) => state.selected.has(app.id)).map((app) => app.id);
  return runQueue("install", ids, ids.length + (ids.length === 1 ? " app" : " apps"));
}
function updateInstalledApp(app) { return runQueue("update", [app.id], app.name); }

// ---------- Navigation and events ----------
function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $("#profiles-panel").classList.toggle("hidden", view !== "profiles");
  $("#search-input").parentElement.classList.toggle("hidden", view === "profiles");
  $("#category-filter").classList.toggle("hidden", view !== "discover"); $("#license-filter").classList.toggle("hidden", view !== "discover");
  $("#page-title").textContent = view === "profiles" ? "Setup profiles" : view === "installed" ? "Installed apps" : "Discover software";
  $("#section-title").textContent = view === "profiles" ? "Choose a starting point" : view === "installed" ? "Detected through WinGet" : "Explore the catalog";
  renderApps(); updateUpdateAll();
  if (view === "installed" && !state.upgradeChecked && !state.busy) refreshUpgradable();
}
// Toggle in place instead of re-rendering the whole grid.
function toggleSelection(card) {
  const button = card.querySelector("[data-select]"); if (!button) return;
  const id = button.dataset.select; const on = !state.selected.has(id);
  on ? state.selected.add(id) : state.selected.delete(id);
  button.classList.toggle("checked", on); button.textContent = on ? "✓" : "+"; button.setAttribute("aria-pressed", String(on));
  card.classList.toggle("selected", on);
  updateSelectionUI();
}
document.addEventListener("click", async (event) => {
  const selectButton = event.target.closest("[data-select]"); const profileButton = event.target.closest("[data-profile]");
  const navButton = event.target.closest("[data-view]"); const updateButton = event.target.closest("[data-update]");
  // The whole card is a click target (not only the small + button); the + button keeps working for keyboard users.
  const card = event.target.closest(".app-card[data-app]");
  if (card && state.view === "discover") toggleSelection(card);
  if (profileButton) {
    const profile = profiles[Number(profileButton.dataset.profile)]; const known = new Set(state.catalog.map((app) => app.id));
    profile.ids.forEach((id) => { if (known.has(id)) state.selected.add(id); }); setView("discover");
  }
  if (updateButton) { const app = state.catalog.find((a) => a.id === updateButton.dataset.update); if (app) updateInstalledApp(app); }
  if (navButton) setView(navButton.dataset.view);
});
let searchTimer;
$("#search-input").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderApps, 120); });
$("#category-filter").addEventListener("change", renderApps); $("#license-filter").addEventListener("change", renderApps);
$("#selection-button").addEventListener("click", installSelected); $("#refresh-btn").addEventListener("click", refreshInstalled);
$("#update-all").addEventListener("click", () => { const ids = updateAllIds(); runQueue("update", ids, ids.length + (ids.length === 1 ? " app" : " apps")); });
$("#cancel-queue").addEventListener("click", async () => { const button = $("#cancel-queue"); button.disabled = true; button.textContent = "Cancelling…"; try { await window.openInstall.cancelQueue(); } catch {} });
$("#retry-failed").addEventListener("click", () => { const ids = [...failedIds]; runQueue(queueAction, ids, ids.length + " failed " + (ids.length === 1 ? "app" : "apps")); });
$("#clear-queue").addEventListener("click", () => { $("#queue-panel").classList.add("hidden"); $("#queue-list").innerHTML = ""; failedIds = []; $("#retry-failed").classList.add("hidden"); });
$("#web-logos").checked = webLogos;
$("#web-logos").addEventListener("change", (event) => {
  webLogos = event.target.checked;
  try { localStorage.setItem(LOGO_KEY, webLogos ? "1" : "0"); } catch {}
  renderApps();
});
// Keyboard shortcuts: "/" or Ctrl+K focuses search, Esc clears it.
function focusSearch() { if (state.view === "profiles") setView("discover"); const input = $("#search-input"); input.focus(); input.select(); }
document.addEventListener("keydown", (event) => {
  const input = $("#search-input"); const active = document.activeElement;
  const typing = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); focusSearch(); }
  else if (event.key === "/" && !typing) { event.preventDefault(); focusSearch(); }
  else if (event.key === "Escape" && (active === input || input.value)) { input.value = ""; input.blur(); renderApps(); }
});

// ---------- Update banner ----------
let dismissedUpdate = null;
let checkLabelTimer;
function renderUpdate(status) {
  if (!status) return;
  const banner = $("#update-banner");
  const show = (el, on) => el.classList.toggle("hidden", !on);
  $("#app-version").textContent = status.currentVersion ? "v" + status.currentVersion : "";
  const button = $("#check-updates");
  clearTimeout(checkLabelTimer);
  button.disabled = status.state === "checking" || status.state === "downloading";
  button.textContent = status.state === "checking" ? "Checking…" : status.state === "uptodate" ? "Up to date ✓" : "Check for updates";
  if (status.state === "uptodate") checkLabelTimer = setTimeout(() => { button.textContent = "Check for updates"; }, 4000);
  const downloading = status.state === "downloading", ready = status.state === "ready", failed = status.state === "error";
  const hidden = ready && dismissedUpdate === status.version;
  const visible = (downloading || ready || failed) && !hidden;
  show(banner, visible); banner.classList.toggle("error", failed);
  if (!visible) return;
  $("#update-title").textContent = failed ? "Update check failed" : ready ? "OpenInstall " + status.version + " is ready" : "Downloading OpenInstall " + (status.version || "update") + "…";
  $("#update-detail").textContent = failed ? status.message : ready ? "Restart to finish updating. It also installs automatically when you close the app." : (status.percent || 0) + "% — you can keep using OpenInstall";
  show($("#update-progress"), downloading); $("#update-progress").value = status.percent || 0;
  show($("#update-restart"), ready); show($("#update-dismiss"), ready || failed);
  show($("#update-notes"), (ready || downloading) && Boolean(status.releaseUrl));
  banner.dataset.releaseUrl = status.releaseUrl || ""; banner.dataset.version = status.version || "";
}
$("#check-updates").addEventListener("click", async () => { dismissedUpdate = null; renderUpdate(await window.openInstall.checkForUpdates()); });
$("#update-dismiss").addEventListener("click", () => { dismissedUpdate = $("#update-banner").dataset.version || null; $("#update-banner").classList.add("hidden"); });
$("#update-notes").addEventListener("click", () => { const url = $("#update-banner").dataset.releaseUrl; if (url) window.openInstall.openExternal(url); });
$("#update-restart").addEventListener("click", async () => {
  if (state.busy && !confirm("Installations are still running. Restarting now may interrupt them. Restart and update anyway?")) return;
  await window.openInstall.installUpdate();
});
window.openInstall.onUpdateStatus(renderUpdate);
window.openInstall.getUpdateState().then(renderUpdate).catch(() => {});

(async function init() {
  try {
    state.catalog = await window.openInstall.getCatalog(); profiles = await window.openInstall.getProfiles();
    // Pre-compute the lowercase search text once instead of on every keystroke.
    state.catalog.forEach((app) => { app._hay = [app.name, app.description, app.category, app.license, app.packageId].filter(Boolean).join("\n").toLowerCase(); });
    renderCategories(); renderProfiles(); renderApps();
    const warnings = await window.openInstall.getCatalogWarnings();
    if (warnings.length) { const box = $("#catalog-warning"); box.textContent = "Some catalog data could not be loaded: " + warnings.join("; "); box.classList.remove("hidden"); }
  } catch (error) {
    $("#result-count").textContent = "Could not load the catalog: " + error.message;
    return;
  }
  try {
    const status = await window.openInstall.checkWinget(); $("#winget-status").textContent = status.available ? "WinGet " + status.version : status.message;
    if (!status.available) $("#winget-status").parentElement.classList.add("warning");
  } catch { $("#winget-status").textContent = "Could not check WinGet"; }
  await refreshInstalled();
})();
