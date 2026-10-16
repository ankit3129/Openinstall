"use strict";
// Runs WinGet as a child process. Nothing here needs Electron, so it is unit tested in scripts/test.js
// (the tests point `command` at a small fake script instead of the real winget.exe).
const { spawn } = require("node:child_process");
const winget = require("./winget-utils");

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

// Stop a child and everything it started, and only resolve once it is really gone (or after `graceMs`).
// child.kill() on Windows only ends winget.exe and leaves the installer it launched running, so use taskkill /T there.
// Resolving early would let the next queued install start while the old installer still holds the installer lock.
function killTree(child, { platform = process.platform, graceMs = 5000 } = {}) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(cap); resolve(); };
    const cap = setTimeout(finish, graceMs);
    child.once("close", finish);
    try {
      if (platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => { try { child.kill(); } catch { /* already gone */ } });
      } else child.kill();
    } catch { finish(); }
  });
}

function createRunner({ command = "winget", prefixArgs = [], maxOutput = 64 * 1024 } = {}) {
  const active = new Map(); // child -> { cancelled }

  function run(args, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return new Promise((resolve) => {
      let child;
      try { child = spawn(command, [...prefixArgs, ...args], { windowsHide: true, shell: false }); }
      catch (error) { resolve({ ok: false, code: null, output: "", error: error.message }); return; }
      const state = { cancelled: false, timedOut: false };
      active.set(child, state);
      let stdout = "", stderr = "", settled = false;
      const combined = () => (stdout + "\n" + stderr).trim();
      const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); active.delete(child); resolve(result); };
      const interrupted = () => state.cancelled
        ? { ok: false, code: null, cancelled: true, output: combined(), error: "Cancelled." }
        : { ok: false, code: null, timedOut: true, output: combined(), error: "Timed out waiting for WinGet." };
      const timer = setTimeout(() => { state.timedOut = true; killTree(child).then(() => finish(interrupted())); }, timeoutMs);
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout = winget.capAppend(stdout, chunk, maxOutput); });
      child.stderr.on("data", (chunk) => { stderr = winget.capAppend(stderr, chunk, maxOutput); });
      child.on("error", (error) => finish({ ok: false, code: null, output: combined(), error: error.code === "ENOENT" ? "WinGet was not found." : error.message }));
      child.on("close", (code) => {
        if (state.cancelled || state.timedOut) { finish(interrupted()); return; }
        finish({ ok: code === 0, code, output: combined(), error: code === 0 ? null : "WinGet exited with code " + code });
      });
    });
  }

  // Cancel everything currently running; resolves when the processes are gone.
  function killAll() {
    const children = [...active.keys()];
    children.forEach((child) => { const state = active.get(child); if (state) state.cancelled = true; });
    return Promise.all(children.map((child) => killTree(child)));
  }

  return { run, killAll, get activeCount() { return active.size; } };
}

module.exports = { createRunner, killTree, DEFAULT_TIMEOUT_MS };
