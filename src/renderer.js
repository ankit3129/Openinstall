const $ = (selector) => document.querySelector(selector);
const state = { catalog: [], selected: new Set(), installed: new Set(), upgradable: null, upgradeChecked: false, view: "discover", busy: false, category: "all", group: "all", license: "all", detailId: null };
let failedIds = [];
let profiles = [];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const iconFor = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const hueFor = (text) => { let h = 0; for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");

// ---------- Logos ----------
// Privacy: by default nothing is fetched from the internet. App tiles use the emoji / initials from the catalog.
// Real logos are opt-in because each one is a request to Google / DuckDuckGo / GitHub that reveals which apps you browse.
const LOGO_KEY = "openinstall.webLogos";
let webLogos = false;
try { webLogos = localStorage.getItem(LOGO_KEY) === "1"; } catch {}
// Bundled logos (src/logos/<id>.png, created by `npm run fetch:logos`) are always tried first: they are local files, so they cost no privacy.
// A missing file just falls through to the next URL, and finally to the emoji / initials.
const logoUrlsFor = (app) => {
  const urls = app.hasLogo ? ["logos/" + encodeURIComponent(app.id) + ".png"] : [];
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

// ---------- Categories ----------
// Order, icons and one-line blurbs for the sidebar and the grouped Discover view. A category that is not listed here
// (for example one added to the catalog later) still works: it is sorted after these and gets a plain icon.
const svg = (inner) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + inner + "</svg>";
const CAT_ICONS = {
  all: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
  Everyday: svg('<path d="M4 11l8-6.5 8 6.5v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M10 20v-5.5h4V20"/>'),
  Browsers: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.3 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.3-3.8-8.5S9.4 5.9 12 3.5z"/>'),
  Communication: svg('<path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-7l-4.5 3.5V16.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z"/>'),
  Media: svg('<circle cx="12" cy="12" r="8.5"/><path d="M10 8.8l5.2 3.2-5.2 3.2z"/>'),
  Creative: svg('<path d="M4 20l3.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11z"/><path d="M14 7l3 3"/>'),
  Documents: svg('<path d="M7 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M14 3.5V8h4.5M8.5 12.5h7M8.5 16h5"/>'),
  Development: svg('<path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5.5l-3 13"/>'),
  Utilities: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  Security: svg('<path d="M12 3.5l7 2.8v5.4c0 4.2-2.9 7.2-7 8.8-4.1-1.6-7-4.6-7-8.8V6.3z"/><path d="M9 12l2.2 2.2L15.2 10"/>'),
  Networking: svg('<circle cx="12" cy="5.5" r="2.2"/><circle cx="5.5" cy="18" r="2.2"/><circle cx="18.5" cy="18" r="2.2"/><path d="M11 7.5L6.6 16M13 7.5l4.4 8.5M8 18h8"/>'),
  Virtualization: svg('<path d="M12 3.5l8 4.2v8.6l-8 4.2-8-4.2V7.7z"/><path d="M4 7.7l8 4.3 8-4.3M12 12v8.5"/>'),
  Gaming: svg('<rect x="3" y="8" width="18" height="9.5" rx="4.5"/><path d="M8 10.5v4.5M5.8 12.8h4.4"/><circle cx="15.5" cy="12" r=".9"/><circle cx="18" cy="13.8" r=".9"/>'),
  _default: svg('<circle cx="12" cy="12" r="8.5"/>')
};
const CAT_BLURB = {
  Everyday: "Cloud storage, remote access, downloads and daily helpers.",
  Browsers: "Browse the web, from mainstream to privacy-first.",
  Communication: "Chat, calls, meetings and email.",
  Media: "Play, record, edit and convert audio and video.",
  Creative: "Design, photo, 3D, music and game-making tools.",
  Documents: "Office suites, PDF tools, notes and research.",
  Development: "Editors, languages, databases and developer tooling.",
  Utilities: "Files, disks, hardware info and system helpers.",
  Security: "Passwords, encryption, VPNs and malware cleanup.",
  Networking: "Scan, connect and troubleshoot networks.",
  Virtualization: "Virtual machines, emulators and containers.",
  Gaming: "Launchers, libraries and game streaming."
};
const CAT_ORDER = Object.keys(CAT_BLURB);
const catIcon = (name) => CAT_ICONS[name] || CAT_ICONS._default;
function orderedCategories() {
  const present = [...new Set(state.catalog.map((app) => app.category))];
  const rank = (name) => { const i = CAT_ORDER.indexOf(name); return i === -1 ? 999 : i; };
  return present.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
function renderCategoryNav() {
  const counts = {}; state.catalog.forEach((app) => { counts[app.category] = (counts[app.category] || 0) + 1; });
  const item = (key, label, count) => '<button class="cat-item' + (state.view === "discover" && state.category === key ? " active" : "") + '" data-cat="' + escapeHtml(key) + '"><span class="cat-ico">' + catIcon(key) + '</span><span class="cat-name">' + escapeHtml(label) + '</span><span class="cat-count">' + count + "</span></button>";
  $("#category-nav").innerHTML = item("all", "All apps", state.catalog.length) + orderedCategories().map((c) => item(c, c, counts[c])).join("");
}
function selectCategory(category) {
  state.category = category; state.group = "all";
  setView("discover"); window.scrollTo({ top: 0 });
}
// Subcategory chips, shown when one category is open and its apps carry a `group`.
function renderGroupChips(appsInCategory) {
  const box = $("#group-chips");
  const counts = new Map(); appsInCategory.forEach((app) => { if (app.group) counts.set(app.group, (counts.get(app.group) || 0) + 1); });
  if (state.view !== "discover" || state.category === "all" || counts.size < 2) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.classList.remove("hidden");
  const chip = (key, label, n) => '<button class="chip' + (state.group === key ? " active" : "") + '" data-group="' + escapeHtml(key) + '">' + escapeHtml(label) + "<small>" + n + "</small></button>";
  box.innerHTML = chip("all", "All", appsInCategory.length) + [...counts].map(([g, n]) => chip(g, g, n)).join("");
}

// ---------- Catalog views ----------
const licenseGroup = (label) => {
  const l = String(label || "").toLowerCase();
  // "core", "client", "base" and "components" mean part of the product is closed, so they must not pass an open-source-only filter.
  if (/^open source (core|client|base|components)\b/.test(l)) return "Partly open source";
  if (l.startsWith("open source")) return "Open source";
  if (l.startsWith("freeware") || l.startsWith("proprietary freeware") || l.startsWith("free ")) return "Freeware";
  return "Proprietary";
};
const licenseClass = (label) => ({ "Open source": "lic-open", "Partly open source": "lic-partly", "Freeware": "lic-free" }[licenseGroup(label)] || "");
function filteredApps() {
  const query = $("#search-input").value.trim().toLowerCase();
  return state.catalog.filter((app) => (!query || app._hay.includes(query)) && (state.category === "all" || app.category === state.category) && (state.group === "all" || app.group === state.group) && (state.license === "all" || licenseGroup(app.license) === state.license));
}
function updateSelectionUI() {
  const n = state.selected.size; const ready = n > 0 && !state.busy;
  $("#selected-count").textContent = n;
  const button = $("#selection-button");
  button.disabled = n === 0 || state.busy;
  button.classList.toggle("ready", ready); if (!ready) button.classList.remove("bump");
  button.querySelector(".install-label").textContent = state.busy ? "Installing…" : n > 1 ? "Install " + n + " apps" : "Install selected";
  // The floating dock is the loudest cue: it slides up the moment the first app is selected.
  const dock = $("#dock"); const show = ready;
  dock.classList.toggle("hidden", !show); document.body.classList.toggle("has-dock", show);
  if (show) {
    const names = state.catalog.filter((app) => state.selected.has(app.id)).map((app) => app.name);
    $("#dock-count").textContent = plural(n, "app") + " selected";
    $("#dock-names").textContent = names.slice(0, 3).join(", ") + (names.length > 3 ? " and " + (names.length - 3) + " more" : "");
  }
}
function bumpInstallButtons() {
  document.querySelectorAll(".install-button").forEach((button) => { button.classList.remove("bump"); void button.offsetWidth; button.classList.add("bump"); });
}
const INFO_ICON = svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2M12 7.8v.1"/>');
function appCardMarkup(app) {
  const selected = state.selected.has(app.id); const installed = state.installed.has(app.id);
  return '<article class="app-card ' + (selected ? "selected" : "") + '" data-app="' + escapeHtml(app.id) + '">' +
    '<div class="app-card-top">' + appIconMarkup(app) + '<div class="card-actions"><button class="info-btn" data-info="' + escapeHtml(app.id) + '" aria-label="About ' + escapeHtml(app.name) + '" title="About this app">' + INFO_ICON + '</button>' +
    '<button class="select-app ' + (selected ? "checked" : "") + '" data-select="' + escapeHtml(app.id) + '" aria-pressed="' + selected + '" aria-label="Select ' + escapeHtml(app.name) + '">' + (selected ? "✓" : "+") + '</button></div></div>' +
    '<div class="app-title-row"><h3>' + escapeHtml(app.name) + '</h3>' + (installed ? '<span class="installed-badge">Installed</span>' : "") + '</div>' +
    '<p class="app-description">' + escapeHtml(app.description) + '</p><div class="app-meta"><span class="cat-tag">' + escapeHtml(app.group || app.category) + '</span><span class="license-tag ' + licenseClass(app.license) + '">' + escapeHtml(app.license) + '</span></div></article>';
}
function renderApps() {
  renderCategoryNav();
  if (state.view === "installed") { renderGroupChips([]); return renderInstalledView(); }
  if (state.view === "profiles") { renderGroupChips([]); $("#app-grid").classList.add("hidden"); $("#empty-state").classList.add("hidden"); updateSelectionUI(); return; }
  const query = $("#search-input").value.trim();
  // Group chips are built from the category ignoring the subcategory choice, so every chip stays visible.
  const inCategory = state.catalog.filter((app) => state.category === "all" || app.category === state.category);
  renderGroupChips(inCategory);
  if (state.group !== "all" && !inCategory.some((app) => app.group === state.group)) state.group = "all";
  const apps = filteredApps();
  const filtered = Boolean(query) || state.category !== "all" || state.group !== "all" || state.license !== "all";
  $("#result-count").textContent = filtered ? apps.length + " of " + plural(state.catalog.length, "app") : plural(state.catalog.length, "app") + " in the catalog";
  $("#section-title").textContent = query ? "Results for “" + query + "”" : state.category === "all" ? "Browse by category" : state.category;
  $("#page-sub").textContent = state.category !== "all" && CAT_BLURB[state.category] ? CAT_BLURB[state.category] : "Pick what you need and OpenInstall sets it up.";
  const grouped = state.category === "all" && !query;
  if (grouped) {
    $("#app-grid").innerHTML = orderedCategories().map((category) => {
      const list = apps.filter((app) => app.category === category); if (!list.length) return "";
      return '<section class="cat-section"><div class="cat-section-head"><div class="cat-section-ico">' + catIcon(category) + '</div><div><h4>' + escapeHtml(category) + '</h4><p>' + escapeHtml(CAT_BLURB[category] || "") + '</p></div>' +
        '<button class="text-button" data-cat="' + escapeHtml(category) + '">See all ' + inCategory.filter((app) => app.category === category).length + '</button></div><div class="app-grid">' + list.map(appCardMarkup).join("") + "</div></section>";
    }).join("");
  } else {
    $("#app-grid").innerHTML = '<div class="app-grid">' + apps.map(appCardMarkup).join("") + "</div>";
  }
  wireLogoFallbacks($("#app-grid"));
  $("#empty-state").classList.toggle("hidden", apps.length !== 0); $("#app-grid").classList.toggle("hidden", apps.length === 0);
  updateSelectionUI();
}
function renderInstalledView() {
  const query = $("#search-input").value.trim().toLowerCase();
  const apps = state.catalog.filter((app) => state.installed.has(app.id) && (!query || app._hay.includes(query)));
  const upgradable = state.upgradable;
  $("#result-count").textContent = plural(apps.length, "installed app") + " detected" + (upgradable ? ", " + upgradable.size + " with updates" : "");
  $("#app-grid").innerHTML = '<div class="app-grid">' + apps.map((app) => {
    const hasUpdate = upgradable ? upgradable.has(app.id) : false;
    // Only offer Update when WinGet itself reported a newer version; otherwise the button would do nothing.
    const action = (app.installType === "website" || !hasUpdate) ? "" : '<button class="update-app" data-update="' + escapeHtml(app.id) + '"' + (state.busy ? " disabled" : "") + '>' + "Update" + '</button>';
    return '<article class="app-card"><div class="app-card-top">' + appIconMarkup(app) + '<div class="card-actions"><button class="info-btn" data-info="' + escapeHtml(app.id) + '" aria-label="About ' + escapeHtml(app.name) + '" title="About this app">' + INFO_ICON + '</button>' + action + '</div></div><div class="app-title-row"><h3>' + escapeHtml(app.name) + '</h3>' +
      (hasUpdate ? '<span class="update-badge">Update available</span>' : '<span class="installed-badge">Installed</span>') + '</div><p class="app-description">' + escapeHtml(app.description) + '</p><div class="app-meta"><span class="cat-tag">' + escapeHtml(app.category) + '</span></div></article>';
  }).join("") + "</div>";
  wireLogoFallbacks($("#app-grid")); $("#empty-state").classList.toggle("hidden", apps.length > 0); $("#app-grid").classList.toggle("hidden", apps.length === 0);
  updateUpdateAll(); updateSelectionUI();
}
// "Update all" updates only the apps WinGet reported as having a newer version (nothing if the check could not run).
function updateAllIds() {
  if (!state.upgradable) return [];
  return state.catalog.filter((app) => state.installed.has(app.id) && app.installType !== "website" && state.upgradable.has(app.id)).map((app) => app.id);
}
function updateUpdateAll() {
  const button = $("#update-all"); const show = state.view === "installed";
  button.classList.toggle("hidden", !show); if (!show) return;
  const ids = updateAllIds();
  button.disabled = state.busy || ids.length === 0;
  button.textContent = !state.upgradable ? (state.upgradeChecked ? "Update check unavailable" : "Checking for updates…") : ids.length === 0 ? "All up to date ✓" : "Update all (" + ids.length + ")";
}
function renderProfiles() {
  $("#profiles-panel").innerHTML = profiles.map((profile, index) => {
    const apps = profile.ids.map((id) => state.catalog.find((app) => app.id === id)).filter(Boolean);
    return '<button class="profile-card" data-profile="' + index + '"><strong>' + escapeHtml(profile.name) + '</strong><span>' + escapeHtml(profile.description) + '</span><div class="profile-apps">' + apps.slice(0, 6).map(appIconMarkup).join("") + '</div><small>Select ' + apps.length + ' apps</small></button>';
  }).join("");
  wireLogoFallbacks($("#profiles-panel"));
}

// ---------- Details dialog ----------
const EXTERNAL_ICON = svg('<path d="M14 4.5h5.5V10M19.5 4.5L11 13M17.5 14v4a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5h4"/>');
const GITHUB_ICON = svg('<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>');
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
// The official links of an app: its website (the catalog `source`) and, when it has one, its GitHub repository.
function linksFor(app) {
  const links = []; let sourceIsGithub = false;
  try { sourceIsGithub = new URL(app.source).hostname === "github.com"; } catch {}
  if (app.source && !sourceIsGithub) links.push({ label: "Official website", url: app.source, icon: EXTERNAL_ICON });
  if (app.github) links.push({ label: "GitHub", url: app.github, icon: GITHUB_ICON });
  else if (sourceIsGithub) links.push({ label: "GitHub", url: app.source, icon: GITHUB_ICON });
  return links;
}
let lastFocus = null;
function renderModal() {
  const app = state.catalog.find((a) => a.id === state.detailId); if (!app) return closeDetails();
  const selected = state.selected.has(app.id); const installed = state.installed.has(app.id);
  const install = app.installType === "website" ? 'Opens the official download page' : 'WinGet <code>' + escapeHtml(app.packageId) + '</code>';
  const links = linksFor(app).map((l) => '<button class="link-btn" data-open="' + escapeHtml(l.url) + '">' + l.icon + escapeHtml(l.label) + ' <small>' + escapeHtml(hostOf(l.url)) + '</small></button>').join("");
  $("#modal-card").innerHTML = '<button class="modal-close" data-close aria-label="Close">×</button>' +
    '<div class="modal-head">' + appIconMarkup(app) + '<div><h2 id="modal-title">' + escapeHtml(app.name) + '</h2><div class="tags"><span class="cat-tag">' + escapeHtml(app.category) + (app.group ? " / " + escapeHtml(app.group) : "") + '</span><span class="license-tag ' + licenseClass(app.license) + '">' + escapeHtml(app.license) + '</span>' + (installed ? '<span class="installed-badge">Installed</span>' : "") + '</div></div></div>' +
    '<p class="modal-about">' + escapeHtml(app.about || app.description) + '</p>' +
    '<dl class="facts"><div><dt>Category</dt><dd>' + escapeHtml(app.category) + '</dd></div><div><dt>License</dt><dd>' + escapeHtml(app.license) + '</dd></div><div class="wide"><dt>Installs through</dt><dd>' + install + '</dd></div></dl>' +
    (links ? '<div class="modal-links">' + links + '</div>' : "") +
    '<div class="modal-foot"><button class="text-button" data-close>Close</button>' + (installed && state.view !== "discover" ? "" : '<button class="primary-button' + (selected ? " on" : "") + '" data-modal-select="' + escapeHtml(app.id) + '">' + (selected ? "✓ In your install list" : installed ? "Select anyway" : "Add to install list") + '</button>') + '</div>';
  wireLogoFallbacks($("#modal-card"));
}
function openDetails(id) {
  state.detailId = id; lastFocus = document.activeElement;
  renderModal(); $("#modal").classList.remove("hidden");
  const close = $("#modal-card .modal-close"); if (close) close.focus();
}
function closeDetails() {
  state.detailId = null; $("#modal").classList.add("hidden"); $("#modal-card").innerHTML = "";
  if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch {} } lastFocus = null;
}

// ---------- Queue ----------
const STATUS_ICON = { success: "✓", opened: "↗", skipped: "–", pending: "…", failure: "!" };
const formatBytes = (n) => n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(1) + " GB" : n >= 1024 ** 2 ? (n / 1024 ** 2).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
function stageText(row) {
  switch (row.stage) {
    case "downloading": return row.bytesTotal ? "Downloading, " + formatBytes(row.downloaded) + " of " + formatBytes(row.bytesTotal) : "Downloading…";
    case "verifying": return "Verifying the download…";
    case "installing": return "Installing…";
    case "done": return "Finishing up…";
    default: return row.message && row.message !== "In progress…" ? row.message : "Getting ready…";
  }
}
const isIndeterminate = (row) => row.stage === "installing" || row.stage === "verifying";
function rowMarkup(r, i) {
  const pending = r.status === "pending";
  return '<div class="queue-item" data-q="' + i + '"><span class="queue-status ' + r.status + '">' + STATUS_ICON[r.status] + '</span><div class="queue-info"><div class="q-top"><strong>' + escapeHtml(r.name) + '</strong>' + (pending ? '<span class="q-pct" data-qpct>' + (r.percent || 0) + '%</span>' : "") + '</div>' +
    (pending ? '<div class="bar' + (isIndeterminate(r) ? " indeterminate" : "") + '" data-qbar><i data-qfill></i></div><small data-qmsg>' + escapeHtml(stageText(r)) + '</small>' : '<small>' + escapeHtml(r.message || "") + '</small>') +
    (r.details ? '<small class="queue-details">' + escapeHtml(r.details) + '</small>' : "") + '</div></div>';
}
// Overall progress = finished items + the fraction of the item that is running, out of all items.
function paintOverall() {
  const total = queueTotal || 1; let done = 0, current = 0;
  queueRows.forEach((r) => { if (!r) return; if (r.status === "pending") current = (r.percent || 0) / 100; else done++; });
  const value = queueFinished ? 100 : Math.min(99, Math.round(((done + current) / total) * 100));
  $("#overall-fill").style.width = value + "%"; $("#overall-pct").textContent = value + "%";
  $("#overall-bar").setAttribute("aria-valuenow", String(value)); $("#overall-bar").classList.toggle("done", queueFinished);
}
function paintRows() {
  document.querySelectorAll("#queue-list [data-q]").forEach((el) => {
    const r = queueRows[Number(el.dataset.q)]; const fill = el.querySelector("[data-qfill]"); if (fill && r) fill.style.width = (r.percent || 0) + "%";
  });
  paintOverall();
}
function renderQueue(rows, summary, title) {
  $("#queue-panel").classList.remove("hidden");
  if (summary !== undefined) $("#queue-summary").textContent = summary;
  if (title !== undefined) $("#queue-title").textContent = title;
  $("#queue-list").innerHTML = rows.map((r) => rowMarkup(r, queueRows.indexOf(r))).join("");
  paintRows();
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
let queueRows = []; let queueAction = "install"; let queueTotal = 0; let queueFinished = false;
window.openInstall.onQueueProgress((event) => {
  const verb = queueAction === "update" ? "Updating " : "Installing ";
  queueTotal = event.total || queueTotal;
  if (event.phase === "progress") {
    const row = queueRows[event.index];
    if (!row || row.status !== "pending") return;
    Object.assign(row, { stage: event.stage, percent: event.percent, downloaded: event.downloaded, bytesTotal: event.bytesTotal });
    const el = document.querySelector('#queue-list [data-q="' + event.index + '"]');
    if (!el) return renderQueue(queueRows.filter(Boolean));
    const pct = el.querySelector("[data-qpct]"); if (pct) pct.textContent = row.percent + "%";
    const msg = el.querySelector("[data-qmsg]"); if (msg) msg.textContent = stageText(row);
    const bar = el.querySelector("[data-qbar]"); if (bar) bar.classList.toggle("indeterminate", isIndeterminate(row));
    return paintRows();
  }
  queueRows[event.index] = { id: event.id, name: event.name, status: event.status, message: event.message, details: event.details, stage: "starting", percent: 0 };
  renderQueue(queueRows.filter(Boolean), event.phase === "start" ? verb + (event.index + 1) + " of " + event.total + ": " + event.name : undefined, event.phase === "start" ? verb + "apps" : undefined);
});
function setQueueRunning(running) {
  $("#cancel-queue").classList.toggle("hidden", !running); $("#cancel-queue").disabled = false; $("#cancel-queue").textContent = "Cancel";
  $("#clear-queue").classList.toggle("hidden", running);
  if (running) $("#retry-failed").classList.add("hidden");
  document.querySelectorAll(".update-app").forEach((button) => { button.disabled = running; });
}
async function runQueue(action, ids, label) {
  if (state.busy || ids.length === 0) return;
  state.busy = true; queueAction = action; queueRows = []; failedIds = []; queueTotal = ids.length; queueFinished = false;
  $("#queue-panel").classList.remove("collapsed"); $("#tray-toggle").setAttribute("aria-expanded", "true");
  updateSelectionUI(); updateUpdateAll(); setQueueRunning(true);
  renderQueue([], (action === "update" ? "Updating " : "Installing ") + (label || ids.length + " apps") + "…", action === "update" ? "Updating apps" : "Installing apps");
  let outcome;
  try { outcome = await window.openInstall.runQueue({ action, ids, preferUserScope: $("#user-scope").checked }); }
  catch (error) { outcome = { ok: false, error: error.message }; }
  setQueueRunning(false); queueFinished = true;
  if (!outcome || !outcome.ok) {
    queueRows = [{ name: "OpenInstall", status: "failure", message: (outcome && outcome.error) || "The queue could not run." }];
    renderQueue(queueRows, "Could not run the queue", "Something went wrong");
  } else {
    const counts = { installed: 0, updated: 0, current: 0, opened: 0, already: 0, cancelled: 0, failed: 0, reboot: 0 };
    queueRows = outcome.results.map((r) => {
      if (r.status === "success") { if (r.upToDate) counts.current++; else if (action === "update") counts.updated++; else counts.installed++; if (r.rebootRequired) counts.reboot++; }
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
    if (counts.current) parts.push(counts.current + " already up to date");
    if (counts.opened) parts.push(counts.opened + " download " + (counts.opened === 1 ? "page" : "pages") + " opened");
    if (counts.already) parts.push(counts.already + " already installed");
    if (counts.cancelled) parts.push(counts.cancelled + " cancelled");
    if (counts.failed) parts.push(counts.failed + " need attention");
    if (counts.reboot) parts.push("restart Windows to finish");
    renderQueue(queueRows, parts.join(", ") || "Nothing to do", counts.failed ? "Finished with problems" : counts.cancelled ? "Cancelled" : "All done");
  }
  $("#retry-failed").classList.toggle("hidden", failedIds.length === 0);
  state.busy = false; renderApps(); updateUpdateAll();
}
function installSelected() {
  const ids = state.catalog.filter((app) => state.selected.has(app.id)).map((app) => app.id);
  return runQueue("install", ids, plural(ids.length, "app"));
}
function updateInstalledApp(app) { return runQueue("update", [app.id], app.name); }

// ---------- Navigation and events ----------
const VIEW_TEXT = {
  discover: ["Discover software", "Pick what you need and OpenInstall sets it up."],
  profiles: ["Setup profiles", "One-click starting points for a new PC."],
  installed: ["Installed apps", "Catalog apps found on this PC through WinGet."]
};
function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $("#profiles-panel").classList.toggle("hidden", view !== "profiles");
  $("#search-input").parentElement.classList.toggle("hidden", view === "profiles");
  $("#license-filter").classList.toggle("hidden", view !== "discover"); $("#catalog-heading").classList.toggle("hidden", view === "profiles");
  $("#page-title").textContent = VIEW_TEXT[view][0]; $("#page-sub").textContent = VIEW_TEXT[view][1];
  $("#section-title").textContent = view === "profiles" ? "Choose a starting point" : view === "installed" ? "Detected through WinGet" : "Browse by category";
  renderApps(); updateUpdateAll();
  if (view === "installed" && !state.upgradeChecked && !state.busy) refreshUpgradable();
}
// Toggle in place instead of re-rendering the whole grid.
function setSelected(id, on) {
  on ? state.selected.add(id) : state.selected.delete(id);
  document.querySelectorAll('.app-card[data-app="' + CSS.escape(id) + '"]').forEach((card) => {
    const button = card.querySelector("[data-select]"); if (!button) return;
    button.classList.toggle("checked", on); button.textContent = on ? "✓" : "+"; button.setAttribute("aria-pressed", String(on));
    card.classList.toggle("selected", on);
  });
  updateSelectionUI(); if (on) bumpInstallButtons();
  if (state.detailId === id) renderModal();
}
document.addEventListener("click", async (event) => {
  const t = event.target;
  const infoButton = t.closest("[data-info]"); if (infoButton) { openDetails(infoButton.dataset.info); return; }
  const openLink = t.closest("[data-open]"); if (openLink) { window.openInstall.openExternal(openLink.dataset.open); return; }
  if (t.closest("[data-close]")) { closeDetails(); return; }
  const modalSelect = t.closest("[data-modal-select]"); if (modalSelect) { const id = modalSelect.dataset.modalSelect; setSelected(id, !state.selected.has(id)); const again = $("[data-modal-select]"); if (again) again.focus(); return; }
  const categoryButton = t.closest("[data-cat]"); if (categoryButton) { selectCategory(categoryButton.dataset.cat); return; }
  const groupButton = t.closest("[data-group]"); if (groupButton) { state.group = groupButton.dataset.group; renderApps(); return; }
  const licenseButton = t.closest("[data-license]");
  if (licenseButton) { state.license = licenseButton.dataset.license; document.querySelectorAll("#license-filter .seg").forEach((b) => b.classList.toggle("active", b === licenseButton)); renderApps(); return; }
  const profileButton = t.closest("[data-profile]"); const navButton = t.closest("[data-view]"); const updateButton = t.closest("[data-update]");
  // The whole card is a click target (not only the small + button); the + button keeps working for keyboard users.
  const card = t.closest(".app-card[data-app]");
  if (card && state.view === "discover") { const id = card.dataset.app; setSelected(id, !state.selected.has(id)); }
  if (profileButton) {
    const profile = profiles[Number(profileButton.dataset.profile)]; const known = new Set(state.catalog.map((app) => app.id));
    profile.ids.forEach((id) => { if (known.has(id)) state.selected.add(id); }); state.category = "all"; state.group = "all"; setView("discover"); bumpInstallButtons();
  }
  if (updateButton) { const app = state.catalog.find((a) => a.id === updateButton.dataset.update); if (app) updateInstalledApp(app); }
  if (navButton) { if (navButton.dataset.view === "discover") { state.category = "all"; state.group = "all"; } setView(navButton.dataset.view); }
});
let searchTimer;
$("#search-input").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderApps, 120); });
$("#selection-button").addEventListener("click", installSelected); $("#dock-install").addEventListener("click", installSelected); $("#refresh-btn").addEventListener("click", refreshInstalled);
$("#dock-clear").addEventListener("click", () => { const ids = [...state.selected]; state.selected.clear(); ids.forEach((id) => setSelected(id, false)); updateSelectionUI(); });
$("#update-all").addEventListener("click", () => { const ids = updateAllIds(); runQueue("update", ids, plural(ids.length, "app")); });
$("#cancel-queue").addEventListener("click", async () => { const button = $("#cancel-queue"); button.disabled = true; button.textContent = "Cancelling…"; try { await window.openInstall.cancelQueue(); } catch {} });
$("#retry-failed").addEventListener("click", () => { const ids = [...failedIds]; runQueue(queueAction, ids, ids.length + " failed " + (ids.length === 1 ? "app" : "apps")); });
$("#clear-queue").addEventListener("click", () => { $("#queue-panel").classList.add("hidden"); $("#queue-list").innerHTML = ""; failedIds = []; $("#retry-failed").classList.add("hidden"); });
$("#tray-toggle").addEventListener("click", () => { const collapsed = $("#queue-panel").classList.toggle("collapsed"); $("#tray-toggle").setAttribute("aria-expanded", String(!collapsed)); });
$("#web-logos").checked = webLogos;
$("#web-logos").addEventListener("change", (event) => {
  webLogos = event.target.checked;
  try { localStorage.setItem(LOGO_KEY, webLogos ? "1" : "0"); } catch {}
  renderApps();
});
// Keyboard shortcuts: "/" or Ctrl+K focuses search, Esc closes the details dialog or clears the search.
function focusSearch() { if (state.view === "profiles") setView("discover"); const input = $("#search-input"); input.focus(); input.select(); }
document.addEventListener("keydown", (event) => {
  const input = $("#search-input"); const active = document.activeElement;
  const typing = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");
  if (event.key === "Escape" && state.detailId) { closeDetails(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); focusSearch(); }
  else if (event.key === "/" && !typing && !state.detailId) { event.preventDefault(); focusSearch(); }
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
    state.catalog.forEach((app) => { app._hay = [app.name, app.description, app.about, app.category, app.group, app.license, app.packageId].filter(Boolean).join("\n").toLowerCase(); });
    renderProfiles(); renderApps();
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
