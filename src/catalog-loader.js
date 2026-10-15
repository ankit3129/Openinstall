"use strict";
// Single source of truth for which files make up the catalog.
// Used by src/main.js and scripts/validate-catalog.js, so adding catalog-part5.json "just works" in both.
const fs = require("node:fs");
const path = require("node:path");

const PART_PATTERN = /^catalog-part(\d+)\.json$/;

function listCatalogParts(dir) {
  return fs.readdirSync(dir)
    .map((file) => ({ file, match: PART_PATTERN.exec(file) }))
    .filter((entry) => entry.match)
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]))
    .map((entry) => entry.file);
}

// Returns { files, entries: [{ file, index, item }], errors: [string] }. Never throws for bad content.
function loadCatalog(dir) {
  const result = { files: [], entries: [], errors: [] };
  try { result.files = listCatalogParts(dir); } catch (error) { result.errors.push("Cannot read catalog folder: " + error.message); return result; }
  if (!result.files.length) result.errors.push("No catalog-part*.json files found");
  for (const file of result.files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      if (!Array.isArray(parsed)) throw new Error("expected an array");
      parsed.forEach((item, index) => result.entries.push({ file, index, item }));
    } catch (error) {
      result.errors.push(file + ": cannot be read or parsed (" + error.message + ")");
    }
  }
  return result;
}

function loadProfiles(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, "profiles.json"), "utf8"));
    if (!Array.isArray(parsed)) throw new Error("expected an array");
    return { profiles: parsed, error: null };
  } catch (error) {
    return { profiles: [], error: "profiles.json: cannot be read or parsed (" + error.message + ")" };
  }
}

module.exports = { listCatalogParts, loadCatalog, loadProfiles };
