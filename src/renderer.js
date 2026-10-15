const $ = (selector) => document.querySelector(selector);
const state = { catalog: [], selected: new Set(), installed: new Set(), view: "discover", busy: false };
const profiles = [
  { name: "Everyday essentials", description: "The basics for a new Windows PC.", ids: ["mozilla-firefox","vlc-media-player","7-zip","libreoffice","everything","sharex"] },
  { name: "Creator studio", description: "Make, record, edit, and publish.", ids: ["blender","gimp","krita","inkscape","obs-studio","audacity","kdenlive"] },
  { name: "Developer workstation", description: "A practical starting toolkit for coding.", ids: ["visual-studio-code","git","python-3","node.js-lts","github-desktop","dbeaver-community"] },
  { name: "Gaming essentials", description: "Game libraries and useful companion tools.", ids: ["steam","prism-launcher","playnite","obs-studio","7-zip"] },
  { name: "Privacy & safety", description: "Tools for passwords, encryption, and sync.", ids: ["keepassxc","veracrypt","syncthing","wireguard","mozilla-firefox"] },
  { name: "Open-source toolkit", description: "A selection of community-built apps.", ids: ["blender","gimp","krita","vlc-media-player","7-zip","libreoffice","qbittorrent"] }
];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const iconFor = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const hueFor = (text) => { let h = 0; for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const logoUrlsFor = (app) => {
  const urls = [];
  if (app.logo && /^https:\/\//.test(app.logo)) urls.push(app.logo);
  try {
    const site = new URL(app.source);
    const domain = site.hostname.replace(/^www\./, "");
    const gh = site.hostname === "github.com" ? site.pathname.split("/").filter(Boolean)[0] : null;
    if (gh) urls.push("https://github.com/" + encodeURIComponent(gh) + ".png?size=128");
    urls.push("https://www.google.com/s2/favicons?domain=" + encodeURIComponent(domain) + "&sz=128");
    urls.push("https://icons.duckduckgo.com/ip3/" + encodeURIComponent(domain) + ".ico");
    urls.push("https://icon.horse/icon/" + encodeURIComponent(domain));
  } catch {}
  return urls;
};
const appIconMarkup = (app) => {
  const urls = logoUrlsFor(app);
  const letters = iconFor(app.name);
  const hue = hueFor(app.id || app.name);
  const image = urls.length ? '<img src="' + escapeHtml(urls[0]) + '" data-fallbacks="' + escapeHtml(JSON.stringify(urls.slice(1))) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : "";
  return '<div class="app-icon" data-hue="' + hue + '" role="img" aria-label="' + escapeHtml(app.name) + ' logo">' + image + '<span>' + escapeHtml(letters) + '</span></div>';
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
  return state.catalog.filter((app) => {
    const matchesText = [app.name, app.description, app.category, app.license].some((value) => String(value || "").toLowerCase().includes(query));
    return matchesText && (category === "all" || app.category === category) && (license === "all" || licenseGroup(app.license) === license);
  });
}
function renderApps() {
  if (state.view === "installed") return renderInstalledView();
  if (state.view === "profiles") { $("#app-grid").classList.add("hidden"); $("#empty-state").classList.add("hidden"); $("#selected-count").textContent = state.selected.size; $("#selection-button").disabled = state.selected.size === 0 || state.busy; return; }
  const apps = filteredApps();
  $("#result-count").textContent = apps.length + " apps in view · " + state.catalog.length + " in catalog";
  $("#app-grid").innerHTML = apps.map((app) => {
    const selected = state.selected.has(app.id); const installed = state.installed.has(app.id);
    return '<article class="app-card ' + (selected ? "selected" : "") + '">' +
      '<div class="app-card-top">' + appIconMarkup(app) + '<button class="select-app ' + (selected ? "checked" : "") + '" data-select="' + escapeHtml(app.id) + '" aria-label="Select ' + escapeHtml(app.name) + '">' + (selected ? "✓" : "+") + '</button></div>' +
      '<div class="app-title-row"><h3>' + escapeHtml(app.name) + '</h3>' + (installed ? '<span class="installed-badge">Installed</span>' : "") + '</div>' +
      '<p class="app-description">' + escapeHtml(app.description) + '</p><div class="app-meta"><span>' + escapeHtml(app.category) + '</span><span class="license-tag">' + escapeHtml(app.license) + '</span></div></article>';
  }).join("");
  wireLogoFallbacks($("#app-grid"));
  $("#empty-state").classList.toggle("hidden", apps.length !== 0); $("#app-grid").classList.toggle("hidden", apps.length === 0);
  $("#selected-count").textContent = state.selected.size; $("#selection-button").disabled = state.selected.size === 0 || state.busy;
}
function renderInstalledView() {
  const query = $("#search-input").value.trim().toLowerCase();
  const apps = state.catalog.filter((app) => state.installed.has(app.id) && (!query || app.name.toLowerCase().includes(query)));
  $("#result-count").textContent = apps.length + " detected installed apps";
  $("#app-grid").innerHTML = apps.map((app) => '<article class="app-card"><div class="app-card-top">' + appIconMarkup(app) + '</div><div class="app-title-row"><h3>' + escapeHtml(app.name) + '</h3><span class="installed-badge">Installed</span></div><p class="app-description">' + escapeHtml(app.description) + '</p></article>').join("");
  wireLogoFallbacks($("#app-grid")); $("#empty-state").classList.toggle("hidden", apps.length > 0); $("#app-grid").classList.toggle("hidden", apps.length === 0);
  $("#selected-count").textContent = state.selected.size; $("#selection-button").disabled = state.selected.size === 0 || state.busy;
}
function renderProfiles() {
  $("#profiles-panel").innerHTML = profiles.map((profile, index) => '<button class="profile-card" data-profile="' + index + '"><span class="profile-spark">✦</span><strong>' + escapeHtml(profile.name) + '</strong><span>' + escapeHtml(profile.description) + '</span><small>' + profile.ids.length + ' suggested apps · Select profile</small></button>').join("");
}
function renderQueue(results = []) {
  $("#queue-panel").classList.remove("hidden");
  $("#queue-summary").textContent = results.length ? results.filter((r) => r.ok).length + " succeeded · " + results.filter((r) => !r.ok).length + " need attention" : "Installation activity";
  $("#queue-list").innerHTML = results.map((r) => '<div class="queue-item"><span class="queue-status ' + (r.ok ? "success" : "failure") + '">' + (r.ok ? "✓" : "!") + '</span><div class="queue-info"><strong>' + escapeHtml(r.name) + '</strong><small>' + escapeHtml(r.ok ? (r.opened ? "Opened the official download page — finish installing there" : "Completed successfully") : (r.error || r.output || "Installation failed").slice(0, 240)) + '</small></div></div>').join("");
}
async function refreshInstalled() {
  $("#refresh-btn").classList.add("spinning");
  try { state.installed = new Set(await window.openInstall.getInstalled()); renderApps(); }
  catch { $("#winget-status").textContent = "Could not check installed apps"; }
  finally { $("#refresh-btn").classList.remove("spinning"); }
}
async function installSelected() {
  if (state.busy || state.selected.size === 0) return;
  state.busy = true; renderApps();
  const chosen = state.catalog.filter((app) => state.selected.has(app.id)); const results = [];
  $("#queue-panel").classList.remove("hidden"); $("#queue-list").innerHTML = "";
  for (let i = 0; i < chosen.length; i++) {
    const app = chosen[i]; $("#queue-summary").textContent = "Installing " + (i + 1) + " of " + chosen.length + ": " + app.name;
    renderQueue([...results, { name: app.name, ok: false, error: "In progress…" }]);
    let result;
    try { result = await window.openInstall.installApp(app.id, $("#user-scope").checked); } catch (error) { result = { ok: false, error: error.message }; }
    if (result.ok && app.installType === "website") result.opened = true;
    results.push({ name: app.name, ...result }); renderQueue(results);
    if (result.ok) state.selected.delete(app.id);
  }
  state.busy = false; renderApps(); await refreshInstalled();
  $("#queue-summary").textContent = results.filter((r) => r.ok).length + " of " + results.length + " installations succeeded.";
}
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
  const selectButton = event.target.closest("[data-select]"); const profileButton = event.target.closest("[data-profile]"); const navButton = event.target.closest("[data-view]");
  if (selectButton) { const id = selectButton.dataset.select; state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id); renderApps(); }
  if (profileButton) {
    const profile = profiles[Number(profileButton.dataset.profile)]; const known = new Set(state.catalog.map((app) => app.id));
    profile.ids.forEach((id) => { if (known.has(id)) state.selected.add(id); }); setView("discover"); renderApps();
  }
  if (navButton) setView(navButton.dataset.view);
});
$("#search-input").addEventListener("input", renderApps); $("#category-filter").addEventListener("change", renderApps); $("#license-filter").addEventListener("change", renderApps);
$("#selection-button").addEventListener("click", installSelected); $("#refresh-btn").addEventListener("click", refreshInstalled);
$("#clear-queue").addEventListener("click", () => { $("#queue-panel").classList.add("hidden"); $("#queue-list").innerHTML = ""; });
(async function init() {
  state.catalog = await window.openInstall.getCatalog(); renderCategories(); renderProfiles(); renderApps();
  const status = await window.openInstall.checkWinget(); $("#winget-status").textContent = status.available ? "WinGet " + status.version : status.message;
  if (!status.available) $("#winget-status").parentElement.classList.add("warning");
  await refreshInstalled();
})();
