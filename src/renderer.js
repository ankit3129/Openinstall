const $ = (selector) => document.querySelector(selector);
const state = { catalog: [], selected: new Set(), installed: new Set(), view: "discover", busy: false };
const profiles = [
  { name: "Everyday essentials", description: "The basics for a new Windows PC.", ids: ["Firefox","VLC","7-Zip","LibreOffice","Everything","ShareX"] },
  { name: "Creator studio", description: "Make, record, edit, and publish.", ids: ["Blender","GIMP","Krita","Inkscape","OBS Studio","Audacity","Kdenlive"] },
  { name: "Developer workstation", description: "A practical starting toolkit for coding.", ids: ["Visual Studio Code","Git","Python 3.12","Node.js LTS","GitHub Desktop","DBeaver Community"] },
  { name: "Gaming essentials", description: "Game libraries and useful companion tools.", ids: ["Steam","Prism Launcher","Playnite","OBS Studio","7-Zip"] },
  { name: "Privacy & safety", description: "Tools for passwords, encryption, and sync.", ids: ["KeePassXC","VeraCrypt","Syncthing","WireGuard","Firefox"] },
  { name: "Open-source toolkit", description: "A selection of community-built apps.", ids: ["Blender","GIMP","Krita","VLC","7-Zip","LibreOffice","qBittorrent"] }
];
const iconFor = (name) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const logoUrlsFor = (app) => {
  try {
    const site = new URL(app.source);
    const domain = site.hostname.replace(/^www\\./, "");
    return [
      "https://icons.duckduckgo.com/ip3/" + encodeURIComponent(domain) + ".ico",
      "https://www.google.com/s2/favicons?domain_url=" + encodeURIComponent(site.origin) + "&sz=128",
      "https://icon.horse/icon/" + encodeURIComponent(domain)
    ];
  } catch { return []; }
};
const appIconMarkup = (app) => {
  const urls = logoUrlsFor(app);
  const fallback = app.icon || iconFor(app.name);
  const image = urls.length ? '<img src="' + escapeHtml(urls[0]) + '" data-fallbacks="' + escapeHtml(JSON.stringify(urls.slice(1))) + '" alt="' + escapeHtml(app.name) + ' logo" loading="lazy" referrerpolicy="no-referrer" onerror="const a=JSON.parse(this.dataset.fallbacks||\'[]\');if(a.length){this.dataset.fallbacks=JSON.stringify(a.slice(1));this.src=a[0]}else{this.remove()}">' : "";
  return '<div class="app-icon" aria-label="' + escapeHtml(app.name) + ' logo">' + image + '<span>' + escapeHtml(fallback) + '</span></div>';
};
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

function renderCategories() {
  const select = $("#category-filter");
  const current = select.value;
  const categories = [...new Set(state.catalog.map((app) => app.category))].sort();
  select.innerHTML = '<option value="all">All categories</option>' + categories.map((category) => '<option value="' + escapeHtml(category) + '">' + escapeHtml(category) + '</option>').join("");
  if (categories.includes(current)) select.value = current;
}
function filteredApps() {
  const query = $("#search-input").value.trim().toLowerCase();
  const category = $("#category-filter").value;
  const license = $("#license-filter").value;
  return state.catalog.filter((app) => {
    const matchesText = [app.name, app.description, app.category, app.license].some((value) => value.toLowerCase().includes(query));
    return matchesText && (category === "all" || app.category === category) && (license === "all" || app.license === license);
  });
}
function renderApps() {
  const apps = filteredApps();
  $("#result-count").textContent = apps.length + " apps in view · " + state.catalog.length + " in catalog";
  $("#app-grid").innerHTML = apps.map((app) => {
    const selected = state.selected.has(app.id);
    const installed = state.installed.has(app.id);
    return '<article class="app-card ' + (selected ? "selected" : "") + '">' +
      '<div class="app-card-top">' + appIconMarkup(app) + '<button class="select-app ' + (selected ? "checked" : "") + '" data-select="' + escapeHtml(app.id) + '" aria-label="Select ' + escapeHtml(app.name) + '">' + (selected ? "✓" : "+") + '</button></div>' +
      '<div class="app-title-row"><h3>' + escapeHtml(app.name) + '</h3>' + (installed ? '<span class="installed-badge">Installed</span>' : "") + '</div>' +
      '<p class="app-description">' + escapeHtml(app.description) + '</p><div class="app-meta"><span>' + escapeHtml(app.category) + '</span><span class="license-tag">' + escapeHtml(app.license) + '</span></div></article>';
  }).join("");
  $("#empty-state").classList.toggle("hidden", apps.length !== 0);
  $("#app-grid").classList.toggle("hidden", apps.length === 0);
  $("#selected-count").textContent = state.selected.size;
  $("#selection-button").disabled = state.selected.size === 0 || state.busy;
}
function renderProfiles() {
  $("#profiles-panel").innerHTML = profiles.map((profile, index) =>
    '<button class="profile-card" data-profile="' + index + '"><span class="profile-spark">✦</span><strong>' + escapeHtml(profile.name) + '</strong><span>' + escapeHtml(profile.description) + '</span><small>' + profile.ids.length + ' suggested apps · Select profile</small></button>'
  ).join("");
}
function renderQueue(results = []) {
  const panel = $("#queue-panel");
  panel.classList.remove("hidden");
  $("#queue-summary").textContent = results.length ? results.filter((r) => r.ok).length + " succeeded · " + results.filter((r) => !r.ok).length + " need attention" : "Installation activity";
  $("#queue-list").innerHTML = results.map((r) => '<div class="queue-item"><span class="queue-status ' + (r.ok ? "success" : "failure") + '">' + (r.ok ? "✓" : "!") + '</span><div class="queue-info"><strong>' + escapeHtml(r.name) + '</strong><small>' + escapeHtml(r.ok ? "Completed successfully" : (r.error || r.output || "Installation failed").slice(0, 240)) + '</small></div></div>').join("");
}
async function refreshInstalled() {
  $("#refresh-btn").classList.add("spinning");
  try {
    state.installed = new Set(await window.openInstall.getInstalled());
    renderApps();
  } catch (error) {
    $("#winget-status").textContent = "Could not check installed apps";
  } finally {
    $("#refresh-btn").classList.remove("spinning");
  }
}
async function installSelected() {
  if (state.busy || state.selected.size === 0) return;
  state.busy = true;
  renderApps();
  const chosen = state.catalog.filter((app) => state.selected.has(app.id));
  const results = [];
  $("#queue-panel").classList.remove("hidden");
  $("#queue-list").innerHTML = "";
  for (let i = 0; i < chosen.length; i++) {
    const app = chosen[i];
    $("#queue-summary").textContent = "Installing " + (i + 1) + " of " + chosen.length + ": " + app.name;
    renderQueue([...results, { name: app.name, ok: false, error: "In progress…" }]);
    const result = await window.openInstall.installApp(app.id, $("#user-scope").checked);
    results.push({ name: app.name, ...result });
    renderQueue(results);
    if (result.ok) state.selected.delete(app.id);
  }
  state.busy = false;
  renderApps();
  await refreshInstalled();
  $("#queue-summary").textContent = results.filter((r) => r.ok).length + " of " + results.length + " installations succeeded.";
}
function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $("#profiles-panel").classList.toggle("hidden", view !== "profiles");
  $("#search-input").parentElement.classList.toggle("hidden", view === "profiles");
  $("#category-filter").classList.toggle("hidden", view === "profiles");
  $("#license-filter").classList.toggle("hidden", view === "profiles");
  $("#page-title").textContent = view === "profiles" ? "Setup profiles" : view === "installed" ? "Installed apps" : "Discover software";
  $("#section-title").textContent = view === "profiles" ? "Choose a starting point" : view === "installed" ? "Detected through WinGet" : "Explore the catalog";
  renderApps();
  if (view === "installed") {
    $("#search-input").value = "";
    $("#app-grid").innerHTML = "";
    const installedApps = state.catalog.filter((app) => state.installed.has(app.id));
    $("#result-count").textContent = installedApps.length + " detected installed apps";
    $("#app-grid").innerHTML = installedApps.map((app) => '<article class="app-card">' + appIconMarkup(app) + '<h3>' + escapeHtml(app.name) + '</h3><p class="app-description">' + escapeHtml(app.description) + '</p><span class="installed-badge">Installed</span></article>').join("");
    $("#empty-state").classList.toggle("hidden", installedApps.length > 0);
  }
}
document.addEventListener("click", async (event) => {
  const selectButton = event.target.closest("[data-select]");
  const profileButton = event.target.closest("[data-profile]");
  const navButton = event.target.closest("[data-view]");
  if (selectButton) {
    const id = selectButton.dataset.select;
    state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    renderApps();
  }
  if (profileButton) {
    const profile = profiles[Number(profileButton.dataset.profile)];
    const byName = new Map(state.catalog.map((app) => [app.name, app]));
    profile.ids.forEach((name) => { const app = byName.get(name); if (app) state.selected.add(app.id); });
    setView("discover");
    renderApps();
  }
  if (navButton) setView(navButton.dataset.view);
});
$("#search-input").addEventListener("input", renderApps);
$("#category-filter").addEventListener("change", renderApps);
$("#license-filter").addEventListener("change", renderApps);
$("#selection-button").addEventListener("click", installSelected);
$("#refresh-btn").addEventListener("click", refreshInstalled);
$("#clear-queue").addEventListener("click", () => { $("#queue-panel").classList.add("hidden"); $("#queue-list").innerHTML = ""; });
(async function init() {
  state.catalog = await window.openInstall.getCatalog();
  renderCategories();
  renderProfiles();
  renderApps();
  const status = await window.openInstall.checkWinget();
  $("#winget-status").textContent = status.available ? "WinGet " + status.version : status.message;
  if (!status.available) $("#winget-status").parentElement.classList.add("warning");
  await refreshInstalled();
})();
