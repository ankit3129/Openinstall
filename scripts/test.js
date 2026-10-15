// Dependency-free unit tests: `npm test`
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const w = require("../src/winget-utils");
const { loadCatalog, listCatalogParts } = require("../src/catalog-loader");

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; } catch (error) { console.error("FAIL: " + name + "\n  " + error.message); process.exitCode = 1; } };

test("normalizeCode makes signed and unsigned codes equal", () => {
  assert.equal(w.normalizeCode(-1978335135), 0x8A150061);
  assert.equal(w.normalizeCode(0x8A150061), 0x8A150061);
  assert.equal(w.normalizeCode(null), null);
});
test("install: success, already installed (by code and by text), reboot, known error, unknown error", () => {
  assert.deepEqual(w.interpretInstall({ ok: true, code: 0 }), { ok: true, message: "Installed successfully." });
  assert.equal(w.interpretInstall({ ok: false, code: -1978335135, output: "" }).ok, true);
  assert.equal(w.interpretInstall({ ok: false, code: 1, output: "Found an existing package already installed." }).ok, true);
  const reboot = w.interpretInstall({ ok: false, code: 0x8A150109, output: "" });
  assert.equal(reboot.ok, true); assert.equal(reboot.rebootRequired, true);
  const known = w.interpretInstall({ ok: false, code: 0x8A150107, output: "", error: "WinGet exited with code 2316632327" });
  assert.equal(known.ok, false); assert.match(known.message, /network/i);
  const unknown = w.interpretInstall({ ok: false, code: 0x12345678, output: "", error: "WinGet exited with code 305419896" });
  assert.equal(unknown.ok, false); assert.match(unknown.message, /exited with code/);
  assert.match(w.interpretInstall({ ok: false, code: null, output: "", error: "Timed out waiting for WinGet." }).message, /Timed out/);
});
test("upgrade: up to date counts as success; missing package is a failure", () => {
  assert.equal(w.interpretUpgrade({ ok: false, code: 0x8A15002B, output: "" }).ok, true);
  assert.equal(w.interpretUpgrade({ ok: false, code: 1, output: "No newer package versions are available" }).ok, true);
  assert.equal(w.interpretUpgrade({ ok: false, code: 0x8A150014, output: "" }).ok, false);
});
test("scope fallback triggers on the documented code and on English text only when the install failed", () => {
  assert.equal(w.isScopeFallback({ ok: false, code: 0x8A150010, output: "" }), true);
  assert.equal(w.isScopeFallback({ ok: false, code: 1, output: "No applicable installer found" }), true);
  assert.equal(w.isScopeFallback({ ok: false, code: 0x8A150107, output: "network down" }), false);
  assert.equal(w.isScopeFallback({ ok: true, code: 0, output: "scope" }), false);
});
test("tailOutput strips spinner and progress noise and keeps the end", () => {
  const raw = "-\r\n\\\r\n|\r\n██████▒▒▒▒  45%\r\n  12 MB / 48 MB\r\nFound Foo [Bar.Foo] Version 1.0\r\nInstaller failed with exit code: 1603\r\n";
  assert.equal(w.tailOutput(raw), "Found Foo [Bar.Foo] Version 1.0 Installer failed with exit code: 1603");
  assert.ok(w.tailOutput("x".repeat(1000), 50).length <= 51);
  assert.equal(w.tailOutput(""), "");
});
test("capAppend never exceeds its cap and keeps the newest text", () => {
  let b = ""; for (let i = 0; i < 100; i++) b = w.capAppend(b, "0123456789", 100);
  assert.equal(b.length, 100); assert.equal(w.capAppend("abc", "def", 4), "cdef");
});
test("parseExportJson reads package ids case-insensitively and rejects junk", () => {
  const json = JSON.stringify({ Sources: [{ Packages: [{ PackageIdentifier: "Mozilla.Firefox" }, { PackageIdentifier: "VideoLAN.VLC" }] }, { Packages: [{ PackageIdentifier: "Git.Git" }] }] });
  const ids = w.parseExportJson("\uFEFF" + json);
  assert.ok(ids.has("mozilla.firefox") && ids.has("git.git") && ids.size === 3);
  assert.equal(w.parseExportJson("not json"), null);
  assert.equal(w.parseExportJson("{}"), null);
  assert.equal(w.parseExportJson(JSON.stringify({ Sources: [] })).size, 0);
});
test("catalog loader discovers parts in numeric order (part10 after part9) and reports bad files without throwing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oi-catalog-"));
  fs.writeFileSync(path.join(dir, "catalog-part10.json"), "[{\"id\":\"c\"}]");
  fs.writeFileSync(path.join(dir, "catalog-part2.json"), "[{\"id\":\"b\"}]");
  fs.writeFileSync(path.join(dir, "catalog-part1.json"), "[{\"id\":\"a\"}]");
  fs.writeFileSync(path.join(dir, "catalog-part3.json"), "{ broken");
  fs.writeFileSync(path.join(dir, "catalog-partX.json"), "[]");
  assert.deepEqual(listCatalogParts(dir), ["catalog-part1.json", "catalog-part2.json", "catalog-part3.json", "catalog-part10.json"]);
  const r = loadCatalog(dir);
  assert.deepEqual(r.entries.map((e) => e.item.id), ["a", "b", "c"]);
  assert.equal(r.errors.length, 1); assert.match(r.errors[0], /catalog-part3\.json/);
  assert.equal(loadCatalog(path.join(dir, "missing")).errors.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
test("the real catalog loads with no errors", () => {
  const r = loadCatalog(path.join(__dirname, "..", "src"));
  assert.deepEqual(r.errors, []); assert.ok(r.entries.length > 100);
});

console.log(passed + " tests passed" + (process.exitCode ? ", with failures" : "") + ".");
