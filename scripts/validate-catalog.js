const path = require("node:path");
const { loadCatalog, loadProfiles } = require("../src/catalog-loader");

const src = path.join(__dirname, "..", "src");
const LICENSES = new Set(["Open source", "Open source core", "Open source client", "Open source base", "Open source components", "Open source edition", "Freeware", "Freeware; source available", "Proprietary freeware", "Free for some use; terms apply", "Free for eligible use", "Paid", "Unverified"]);

const { files, entries, errors } = loadCatalog(src);
const ids = new Map(), pkgs = new Map();
for (const { file, index, item } of entries) {
  const where = file + "[" + index + "] " + ((item && item.id) || "?");
  if (!item || typeof item !== "object") { errors.push(where + ": entry is not an object"); continue; }
  for (const key of ["id", "name", "category", "description", "license", "source", "installType", "icon"]) if (!item[key] || typeof item[key] !== "string") errors.push(where + ": missing " + key);
  if (item.id && !/^[a-z0-9][a-z0-9._-]*$/i.test(item.id)) errors.push(where + ": id may only contain letters, digits, dot, dash and underscore (it is used as a logo file name)");
  if (item.id) { if (ids.has(item.id)) errors.push(where + ": duplicate id (also " + ids.get(item.id) + ")"); ids.set(item.id, file); }
  if (item.license && !LICENSES.has(item.license)) errors.push(where + ": unknown license label " + item.license);
  if (item.source && !/^https:\/\//.test(item.source)) errors.push(where + ": source must be https");
  if (typeof item.about !== "string" || item.about.trim().length < 40) errors.push(where + ": missing a description in `about` (at least 40 characters; it is shown in the details panel)");
  if (item.group !== undefined && (typeof item.group !== "string" || !item.group.trim())) errors.push(where + ": group must be a non-empty string");
  if (item.github !== undefined && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(item.github)) errors.push(where + ": github must look like https://github.com/owner/repo");
  if (item.sourceUrl && !/^https:\/\//.test(item.sourceUrl)) errors.push(where + ": sourceUrl must be https");
  if (item.installType === "winget") {
    if (!item.packageId || typeof item.packageId !== "string") errors.push(where + ": winget entry has no packageId");
    else if (!/^[A-Za-z0-9][\w+.-]*\.[\w+.-]+$/.test(item.packageId)) errors.push(where + ": invalid packageId " + item.packageId);
    else { const k = item.packageId.toLowerCase(); if (pkgs.has(k)) errors.push(where + ": duplicate packageId (also " + pkgs.get(k) + ")"); pkgs.set(k, item.id); }
    if (item.detectRegex !== undefined) {
      try { if (!new RegExp(item.detectRegex).test(String(item.packageId).toLowerCase())) errors.push(where + ": detectRegex does not match its own packageId"); }
      catch (error) { errors.push(where + ": detectRegex is not a valid regular expression (" + error.message + ")"); }
    }
  } else if (item.installType === "website") { if (item.packageId) errors.push(where + ": website entry should not have packageId"); if (item.detectRegex) errors.push(where + ": website entry should not have detectRegex"); }
  else errors.push(where + ": invalid installType");
}

const { profiles, error: profileError } = loadProfiles(src);
if (profileError) errors.push(profileError);
const profileNames = new Set();
profiles.forEach((p) => {
  if (!p.name || !Array.isArray(p.ids)) { errors.push("profile needs name and ids[]"); return; }
  if (profileNames.has(p.name)) errors.push("duplicate profile name " + p.name); profileNames.add(p.name);
  const seen = new Set();
  p.ids.forEach((id) => { if (!ids.has(id)) errors.push("profile " + p.name + " references unknown app id " + id); if (seen.has(id)) errors.push("profile " + p.name + " lists " + id + " twice"); seen.add(id); });
});

if (errors.length) { console.error("Catalog validation failed:\n - " + errors.join("\n - ")); process.exit(1); }
console.log("Catalog OK: " + entries.length + " apps from " + files.length + " files, " + profiles.length + " profiles.");
