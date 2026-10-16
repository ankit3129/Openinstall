"use strict";
// Downloads a logo for every catalog app into src/logos/<id>.png so the app can show real icons with ZERO network requests
// at runtime (no Google / DuckDuckGo / GitHub lookups, nothing that reveals which apps a user browses).
//
//   npm run fetch:logos            fetch logos that are missing
//   npm run fetch:logos -- --force re-download everything
//
// Needs Node 18+ (global fetch) and internet access. Review the result before committing: logos are the property of their owners
// and are used here only to identify the software. Anything that fails or looks too small is skipped; the app falls back to an emoji.
const fs = require("node:fs");
const path = require("node:path");
const { loadCatalog } = require("../src/catalog-loader");

const OUT = path.join(__dirname, "..", "src", "logos");
const FORCE = process.argv.includes("--force");
const MIN_BYTES = 800;          // the default "globe" icons that favicon services return for unknown sites are smaller than this
const CONCURRENCY = 6;
const TIMEOUT_MS = 10000;

function candidates(app) {
  const urls = [];
  try {
    const site = new URL(app.source);
    if (site.hostname === "github.com") {
      const owner = site.pathname.split("/").filter(Boolean)[0];
      if (owner) urls.push("https://github.com/" + encodeURIComponent(owner) + ".png?size=128");
      return urls;
    }
    const domain = site.hostname.replace(/^www\./, "");
    urls.push("https://www.google.com/s2/favicons?domain=" + encodeURIComponent(domain) + "&sz=128");
    urls.push("https://icons.duckduckgo.com/ip3/" + encodeURIComponent(domain) + ".ico");
  } catch { /* bad source URL: the validator reports it */ }
  return urls;
}

async function download(url) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "OpenInstall-logo-fetch" } });
  if (!response.ok) throw new Error("HTTP " + response.status);
  const type = response.headers.get("content-type") || "";
  if (!/^image\//i.test(type)) throw new Error("not an image (" + type + ")");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < MIN_BYTES) throw new Error("too small (" + bytes.length + " bytes)");
  return bytes;
}

(async () => {
  const { entries } = loadCatalog(path.join(__dirname, "..", "src"));
  const apps = entries.map((e) => e.item).filter((item) => item && item.id);
  fs.mkdirSync(OUT, { recursive: true });
  let next = 0; const saved = [], skipped = [], failed = [];
  const worker = async () => {
    while (next < apps.length) {
      const app = apps[next++]; const file = path.join(OUT, app.id + ".png");
      if (!FORCE && fs.existsSync(file)) { skipped.push(app.id); continue; }
      let ok = false;
      for (const url of candidates(app)) {
        try { fs.writeFileSync(file, await download(url)); ok = true; break; } catch { /* try the next source */ }
      }
      (ok ? saved : failed).push(app.id);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log("Logos saved: " + saved.length + ", already present: " + skipped.length + ", no logo found: " + failed.length);
  if (failed.length) console.log("No logo for (the app shows its emoji instead): " + failed.join(", "));
})().catch((error) => { console.error(error); process.exit(1); });
