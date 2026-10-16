// Dependency-free unit tests: `npm test`
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const w = require("../src/winget-utils");
const { loadCatalog, listCatalogParts } = require("../src/catalog-loader");

const { createRunner, killTree } = require("../src/winget-runner");
const { spawn } = require("node:child_process");

let passed = 0;
const queued = [];
const test = (name, fn) => { queued.push({ name, fn }); }; // tests run one after another at the bottom (some are async)

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
test("scope fallback is decided by exit code only (words like 'scope' in the output must not trigger an elevated retry)", () => {
  assert.equal(w.isScopeFallback({ ok: false, code: 0x8A150010, output: "" }), true);
  assert.equal(w.isScopeFallback({ ok: false, code: -1978335216, output: "" }), true); // same code, signed
  assert.equal(w.isScopeFallback({ ok: false, code: 1, output: "No applicable installer found" }), false);
  assert.equal(w.isScopeFallback({ ok: false, code: 0x8A15010D, output: "installer scope scope scope" }), false);
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

test("progress tracker turns WinGet output into stages and a download percentage", () => {
  const t = w.createProgressTracker();
  assert.equal(t.push("Found Foo [Bar.Foo] Version 1.0\r\n").percent, 3);
  assert.equal(t.push("Downloading https://example.com/foo.exe\r\n").stage, "downloading");
  const half = t.push("  ██████████████▒▒▒▒▒▒▒▒▒▒▒▒▒▒  24.0 MB / 48.0 MB\r");
  assert.equal(half.stage, "downloading"); assert.equal(half.percent, 40); assert.equal(half.total, 48 * 1024 * 1024);
  assert.equal(t.push("  ██████████████▒▒▒▒▒▒▒▒▒▒▒▒▒▒  24.0 MB / 48.0 MB\r"), null); // nothing changed
  assert.equal(t.push("  ██████████████████████████████  48.0 MB / 48.0 MB\r").percent, 75);
  assert.equal(t.push("Successfully verified installer hash\r\n").stage, "verifying");
  assert.equal(t.push("Starting package install...\r\n").stage, "installing");
  const done = t.push("Successfully installed\r\n"); assert.equal(done.stage, "done"); assert.equal(done.percent, 100);
});
test("progress tracker copes with split chunks, KB units and never moves backwards", () => {
  const t = w.createProgressTracker();
  t.push("  ████▒▒▒▒  512 KB / 1");
  const s = t.push("024 KB\r"); assert.equal(s.percent, 40);
  const back = t.push("  ██▒▒▒▒▒▒  100 KB / 1024 KB\r"); assert.ok(!back || back.percent >= 40);
});
test("matchInstalled finds the exact pinned id and, via detectRegex, other versions of the same family", () => {
  const python = { packageId: "Python.Python.3.13", detectRegex: "^python\\.python\\.3\\.\\d+$" };
  assert.equal(w.matchInstalled(python, new Set(["python.python.3.13"])), "python.python.3.13");
  assert.equal(w.matchInstalled(python, new Set(["git.git", "python.python.3.14"])), "python.python.3.14");
  assert.equal(w.matchInstalled(python, new Set(["python.python.2.7"])), null);
  assert.equal(w.matchInstalled({ packageId: "Git.Git" }, new Set(["git.git.beta"])), null); // no detectRegex: exact match only
  assert.equal(w.matchInstalled({ packageId: "A.B", detectRegex: "(" }, new Set(["a.c"])), null); // a broken regex never throws
});
test("parseUpgradeOutput finds known ids as whole tokens in a localized table", () => {
  const out = "Name        Id                  Version  Verfuegbar\r\n-----\r\nGit         Git.Git             2.50.0   2.51.0\r\nPython 3    Python.Python.3.14  3.14.0   3.14.1\r\nVLC  VideoLAN.VLC.Nightly 1 2\r\n2 Aktualisierungen verfuegbar.";
  const found = w.parseUpgradeOutput(out, ["Git.Git", "python.python.3.14", "VideoLAN.VLC", "Mozilla.Firefox"]);
  assert.deepEqual([...found].sort(), ["git.git", "python.python.3.14"]);
  assert.equal(w.parseUpgradeOutput("", ["Git.Git"]).size, 0);
});
test("every WinGet call can be pinned to the community source", () => {
  assert.deepEqual([...w.SOURCE_ARGS], ["--source", "winget"]);
});

const FAKE = path.join(__dirname, "fake-winget.js");
const fake = (overrides) => createRunner({ command: process.execPath, prefixArgs: [FAKE], ...overrides });

test("runner: success, non-zero exit, missing executable", async () => {
  const r = fake();
  const ok = await r.run(["out", "hello"]);
  assert.equal(ok.ok, true); assert.match(ok.output, /hello/);
  const bad = await r.run(["fail", "7"]);
  assert.equal(bad.ok, false); assert.equal(bad.code, 7); assert.match(bad.output, /something failed/);
  const missing = await createRunner({ command: "definitely-not-winget-xyz" }).run(["--version"]);
  assert.equal(missing.ok, false); assert.match(missing.error, /not found/i);
});
test("runner: output is capped in memory", async () => {
  const r = fake({ maxOutput: 500 });
  const result = await r.run(["spam", "200000"]);
  assert.equal(result.ok, true); assert.ok(result.output.length <= 1002, "output was " + result.output.length);
});
test("runner: a timeout kills the process, waits for it to die, and reports a timeout", async () => {
  const r = fake();
  const started = Date.now();
  const result = await r.run(["hang"], 300);
  assert.equal(result.ok, false); assert.equal(result.timedOut, true); assert.match(result.error, /Timed out/);
  assert.ok(Date.now() - started < 4000, "kill took too long");
  assert.equal(r.activeCount, 0);
});
test("runner: killAll cancels a running process and marks it cancelled", async () => {
  const r = fake();
  const pending = r.run(["hang"], 60000);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(r.activeCount, 1);
  await r.killAll();
  const result = await pending;
  assert.equal(result.cancelled, true); assert.equal(result.ok, false); assert.equal(r.activeCount, 0);
});
test("killTree resolves only after the child has exited", async () => {
  const child = spawn(process.execPath, [FAKE, "hang"], { stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 200));
  await killTree(child);
  assert.ok(child.exitCode !== null || child.signalCode !== null, "child still running after killTree resolved");
  await killTree(child); // killing an already-dead child is a no-op
});

(async () => {
  for (const { name, fn } of queued) {
    try { await fn(); passed++; } catch (error) { console.error("FAIL: " + name + "\n  " + error.message); process.exitCode = 1; }
  }
  console.log(passed + " tests passed" + (process.exitCode ? ", with failures" : "") + ".");
})();

test("upgrade parsing: truncated ids match only when unambiguous", () => {
  const w = require("../src/winget-utils");
  const ids = ["microsoft.visualstudiocode", "jetbrains.intellijidea.community", "jetbrains.intellijidea.ultimate", "git.git"];
  const out = "Visual Studio Code  Microsoft.VisualStudioC…  1.9  1.95  winget\nIntelliJ  JetBrains.IntelliJIDEA.…  1  2  winget\nGit  Git.Git  1  2  winget";
  assert.deepStrictEqual([...w.parseUpgradeOutput(out, ids)].sort(), ["git.git", "microsoft.visualstudiocode"]);
});
