// Checks every winget packageId in the catalog against the real WinGet sources.
// Needs winget on PATH (Windows). Run:  npm run verify:winget
// Exit code 1 = at least one id could not be found, so the catalog has a broken entry.
const path = require("node:path");
const { spawn } = require("node:child_process");
const { loadCatalog } = require("../src/catalog-loader");

const { entries } = loadCatalog(path.join(__dirname, "..", "src"));
const items = entries.map((e) => e.item).filter((i) => i.installType === "winget" && i.packageId);
const NO_PACKAGES_FOUND = 0x8A150014;

function show(id) {
  return new Promise((resolve) => {
    let child; let output = "";
    try { child = spawn("winget", ["show", "--id", id, "--exact", "--accept-source-agreements", "--disable-interactivity"], { windowsHide: true }); }
    catch (error) { resolve({ status: "error", detail: error.message }); return; }
    const timer = setTimeout(() => { child.kill(); resolve({ status: "error", detail: "timed out" }); }, 60000);
    child.stdout.on("data", (d) => { output += d; if (output.length > 8192) output = output.slice(-8192); });
    child.stderr.on("data", (d) => { output += d; if (output.length > 8192) output = output.slice(-8192); });
    child.on("error", (error) => { clearTimeout(timer); resolve({ status: "error", detail: error.message }); });
    child.on("close", (code) => { clearTimeout(timer); const c = code >>> 0; resolve(code === 0 ? { status: "ok" } : c === NO_PACKAGES_FOUND ? { status: "missing" } : { status: "error", detail: "exit " + code + " " + output.trim().slice(-120) }); });
  });
}

(async () => {
  let next = 0; const missing = [], problems = [];
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]; const r = await show(item.packageId);
      if (r.status === "missing") missing.push(item.id + " (" + item.packageId + ")");
      else if (r.status === "error") problems.push(item.id + " (" + item.packageId + "): " + r.detail);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log("Checked " + items.length + " winget packages.");
  if (problems.length) console.warn("Could not check (not counted as failures):\n - " + problems.join("\n - "));
  if (missing.length) { console.error("Not found in WinGet:\n - " + missing.join("\n - ")); process.exit(1); }
  console.log("All checked package ids exist.");
})();
