const $ = (selector) => document.querySelector(selector);
const state = { catalog: [], selected: new Set(), installed: new Set(), view: "discover", busy: false };
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
const logoUrlsFor = (app) => {
  const urls = [];
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
  const urls = webLogos ? logoUrlsFor(app) : [];
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
    return '<article class="app-card ' + (selected ? "selected" : "") + '">' +
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
  $("#result-count").textContent = apps.length + " detected installed apps";
  $("#app-grid").innerHTML = apps.map((app) => '<article class="app-card"><div class="app-card-top">' + appIconMarkup(app) +
    (app.installType === "website" ? "" : '<button class="update-app" data-update="' + escapeHtml(app.id) + '">Update</button>') +
    '</div><div class="app-title-row"><h3>' + escapeHtml(app.name) + '</h3><span class="installed-badge">Installed</span></div><p class="app-description">' + escapeHtml(app.description) + '</p></article>').join("");
  wireLogoFallbacks($("#app-grid")); $("#empty-state").classList.toggle("hidden", apps.length > 0); $("#app-grid").classList.toggle("hidden", apps.length === 0);
  updateSelectionUI();
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
    try { state.installed = new Set(await window.openInstall.getInstalled()); renderApps(); }
    catch { $("#winget-status").textContent = "Could not check installed apps"; }
    finally { $("#refresh-btn").classList.remove("spinning"); }
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}
async function installSelected() {
  if (state.busy || state.selected.size === 0) return;
  state.busy = true; updateSelectionUI();
  const chosen = state.catalog.filter((app) => state.selected.has(app.id));
  const rows = []; const counts = { installed: 0, opened: 0, skipped: 0, failed: 0, reboot: 0 };
  const preferUserScope = $("#user-scope").checked;
  for (let i = 0; i < chosen.length; i++) {
    const app = chosen[i]; const summary = "Installing " + (i + 1) + " of " + chosen.length + ": " + app.name;
    if (app.installType !== "website" && state.installed.has(app.id)) {
      rows.push({ name: app.name, status: "skipped", message: "Already installed — skipped" }); counts.skipped++; state.selected.delete(app.id); renderQueue(rows, summary); continue;
    }
    renderQueue([...rows, { name: app.name, status: "pending", message: "In progress…" }], summary);
    let result;
    try { result = await window.openInstall.installApp(app.id, preferUserScope); } catch (error) { result = { ok: false, error: error.message }; }
    if (result.ok) {
      state.selected.delete(app.id);
      if (app.installType === "website") { counts.opened++; rows.push({ name: app.name, status: "opened", message: "Opened the official download page — finish installing there" }); }
      else { counts.installed++; if (result.rebootRequired) counts.reboot++; rows.push({ name: app.name, status: "success", message: result.output || "Installed successfully" }); }
    } else {
      counts.failed++; rows.push({ name: app.name, status: "failure", message: result.error || "Installation failed", details: result.details });
    }
    renderQueue(rows, summary);
  }
  const parts = [];
  if (counts.installed) parts.push(counts.installed + " installed");
  if (counts.opened) parts.push(counts.opened + " download " + (counts.opened === 1 ? "page" : "pages") + " opened");
  if (counts.skipped) parts.push(counts.skipped + " already installed");
  if (counts.failed) parts.push(counts.failed + " need attention");
  if (counts.reboot) parts.push("restart Windows to finish");
  renderQueue(rows, parts.join(" · ") || "Nothing to do");
  state.busy = false; renderApps();
  await refreshInstalled();
}
async function updateInstalledApp(app, button) {
  if (state.busy) return;
  state.busy = true; updateSelectionUI(); button.disabled = true; const label = button.textContent; button.textContent = "Updating…";
  renderQueue([{ name: app.name, status: "pending", message: "Checking for a newer version…" }], "Updating " + app.name);
  let result;
  try { result = await window.openInstall.updateApp(app.id); } catch (error) { result = { ok: false, error: error.message }; }
  if (result.ok) renderQueue([{ name: app.name, status: "success", message: result.output || "Updated successfully" }], app.name + ": " + (result.output || "done"));
  else renderQueue([{ name: app.name, status: "failure", message: result.error || "Update failed", details: result.details }], app.name + " needs attention");
  state.busy = false; updateSelectionUI(); button.disabled = false; button.textContent = label;
}

// ---------- Navigation and events ----------
function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $("#profiles-panel").classList.toggle("hidden", view !== "profiles");
  $("#search-input").parentElement.classList.toggle("hidden", view === "profiles");
  $("#category-filter").classList.toggle("hidden", view !== "discover"); $("#license-filter").classList.toggle("hidden", view !== "discover");
  $("#page-title").textContent = view === "profiles" ? "Setup profiles" : view === "installed" ? "Installed apps" : "Discover software";
  $("#section-title").textContent = view === "profiles" ? "Choose a starting point" : view === "installed" ? "Detected through WinGet" : "Explore the catalog";
  renderApps();
}
document.addEventListener("click", async (event) => {
  const selectButton = event.target.closest("[data-select]"); const profileButton = event.target.closest("[data-profile]");
  const navButton = event.target.closest("[data-view]"); const updateButton = event.target.closest("[data-update]");
  if (selectButton) {
    // Toggle in place instead of re-rendering the whole grid.
    const id = selectButton.dataset.select; const on = !state.selected.has(id);
    on ? state.selected.add(id) : state.selected.delete(id);
    selectButton.classList.toggle("checked", on); selectButton.textContent = on ? "✓" : "+"; selectButton.setAttribute("aria-pressed", String(on));
    const card = selectButton.closest(".app-card"); if (card) card.classList.toggle("selected", on);
    updateSelectionUI();
  }
  if (profileButton) {
    const profile = profiles[Number(profileButton.dataset.profile)]; const known = new Set(state.catalog.map((app) => app.id));
    profile.ids.forEach((id) => { if (known.has(id)) state.selected.add(id); }); setView("discover");
  }
  if (updateButton) { const app = state.catalog.find((a) => a.id === updateButton.dataset.update); if (app) updateInstalledApp(app, updateButton); }
  if (navButton) setView(navButton.dataset.view);
});
let searchTimer;
$("#search-input").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderApps, 120); });
$("#category-filter").addEventListener("change", renderApps); $("#license-filter").addEventListener("change", renderApps);
$("#selection-button").addEventListener("click", installSelected); $("#refresh-btn").addEventListener("click", refreshInstalled);
$("#clear-queue").addEventListener("click", () => { $("#queue-panel").classList.add("hidden"); $("#queue-list").innerHTML = ""; });
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
