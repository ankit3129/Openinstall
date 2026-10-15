const fs = require("node:fs");
const path = require("node:path");
const src = path.join(__dirname, "..", "src");
const errors = [];
const LICENSES = new Set(["Open source", "Open source core", "Open source client", "Open source base", "Open source components", "Open source edition", "Freeware", "Freeware; source available", "Proprietary freeware", "Free for some use; terms apply", "Free for eligible use", "Paid", "Unverified"]);
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(path.join(src, file), "utf8")); } catch (e) { errors.push(file + ": cannot be read or parsed (" + e.message + ")"); return null; } };
const parts = fs.readdirSync(src).filter((f) => /^catalog-part\d+\.json$/.test(f)).sort();
if (!parts.length) errors.push("No catalog-part*.json files found");
const items = [];
for (const file of parts) { const data = readJson(file); if (!data) continue; if (!Array.isArray(data)) { errors.push(file + ": expected an array"); continue; } data.forEach((item, i) => items.push({ file, i, item })); }
const ids = new Map(), pkgs = new Map();
for (const { file, i, item } of items) {
 const where = file + "[" + i + "] " + (item.id || "?");
 for (const key of ["id","name","category","description","license","source","installType"]) if (!item[key] || typeof item[key] !== "string") errors.push(where + ": missing " + key);
 if (item.id) { if (ids.has(item.id)) errors.push(where + ": duplicate id (also " + ids.get(item.id) + ")"); ids.set(item.id,file); }
 if (item.license && !LICENSES.has(item.license)) errors.push(where + ": unknown license label " + item.license);
 if (item.source && !/^https:\/\//.test(item.source)) errors.push(where + ": source must be https");
 if (item.installType === "winget") { if (!item.packageId || typeof item.packageId !== "string") errors.push(where + ": winget entry has no packageId"); else if (!/^[A-Za-z0-9][\w+.-]*\.[\w+.-]+$/.test(item.packageId)) errors.push(where + ": invalid packageId " + item.packageId); else { const k=item.packageId.toLowerCase(); if(pkgs.has(k)) errors.push(where + ": duplicate packageId (also "+pkgs.get(k)+")"); pkgs.set(k,item.id); } }
 else if (item.installType === "website") { if (item.packageId) errors.push(where + ": website entry should not have packageId"); } else errors.push(where + ": invalid installType");
}
const profiles = readJson("profiles.json");
if (profiles) { if (!Array.isArray(profiles)) errors.push("profiles.json: expected an array"); else profiles.forEach((p) => { if (!p.name || !Array.isArray(p.ids)) errors.push("profile needs name and ids[]"); else p.ids.forEach((id) => { if (!ids.has(id)) errors.push("profile "+p.name+" references unknown app id "+id); }); }); }
if (errors.length) { console.error("Catalog validation failed:\n - "+errors.join("\n - ")); process.exit(1); }
console.log("Catalog OK: "+items.length+" apps, "+(profiles||[]).length+" profiles.");
