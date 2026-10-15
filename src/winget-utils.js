"use strict";
// Pure helpers for talking to WinGet. Nothing here needs Electron, so it is unit tested in scripts/test.js.

// Documented WinGet return codes (https://learn.microsoft.com/windows/package-manager/winget/returncodes).
const CODES = Object.freeze({
  DOWNLOAD_FAILED: 0x8A150008,
  NO_APPLICABLE_INSTALLER: 0x8A150010,
  INSTALLER_HASH_MISMATCH: 0x8A150011,
  NO_PACKAGES_FOUND: 0x8A150014,
  ADMIN_REQUIRED: 0x8A150019,
  NO_APPLICABLE_UPDATE: 0x8A15002B,
  INSTALLER_SECURITY_CHECK_FAILED: 0x8A15002D,
  PACKAGE_ALREADY_INSTALLED: 0x8A150061,
  INSTALL_PACKAGE_IN_USE: 0x8A150101,
  INSTALL_IN_PROGRESS: 0x8A150102,
  INSTALL_FILE_IN_USE: 0x8A150103,
  INSTALL_MISSING_DEPENDENCY: 0x8A150104,
  INSTALL_DISK_FULL: 0x8A150105,
  INSTALL_NO_NETWORK: 0x8A150107,
  INSTALL_REBOOT_REQUIRED_TO_FINISH: 0x8A150109,
  INSTALL_REBOOT_REQUIRED_FOR_INSTALL: 0x8A15010A,
  INSTALL_REBOOT_INITIATED: 0x8A15010B,
  INSTALL_CANCELLED_BY_USER: 0x8A15010C,
  INSTALL_ALREADY_INSTALLED: 0x8A15010D,
  INSTALL_BLOCKED_BY_POLICY: 0x8A15010F,
  INSTALL_SYSTEM_NOT_SUPPORTED: 0x8A150113
});

const MESSAGES = new Map([
  [CODES.DOWNLOAD_FAILED, "The installer could not be downloaded. Check your internet connection and try again."],
  [CODES.NO_APPLICABLE_INSTALLER, "WinGet has no installer for this app that fits your system or install scope."],
  [CODES.INSTALLER_HASH_MISMATCH, "The downloaded installer failed its hash check, so it was not run."],
  [CODES.NO_PACKAGES_FOUND, "WinGet could not find this package in its sources."],
  [CODES.ADMIN_REQUIRED, "This install needs administrator rights. Untick \"Prefer per-user installs\" and approve the Windows prompt."],
  [CODES.INSTALLER_SECURITY_CHECK_FAILED, "The installer failed WinGet's security check, so it was not run."],
  [CODES.INSTALL_PACKAGE_IN_USE, "The app is running. Close it and try again."],
  [CODES.INSTALL_IN_PROGRESS, "Another installation is already in progress. Wait for it to finish and try again."],
  [CODES.INSTALL_FILE_IN_USE, "A file the installer needs is in use. Close the app and try again."],
  [CODES.INSTALL_MISSING_DEPENDENCY, "A required dependency is missing."],
  [CODES.INSTALL_DISK_FULL, "There is not enough free disk space."],
  [CODES.INSTALL_NO_NETWORK, "No network connection."],
  [CODES.INSTALL_CANCELLED_BY_USER, "The installation was cancelled."],
  [CODES.INSTALL_BLOCKED_BY_POLICY, "This install is blocked by a policy on this PC."],
  [CODES.INSTALL_SYSTEM_NOT_SUPPORTED, "This app does not support your version of Windows."]
]);

const ALREADY_INSTALLED = new Set([CODES.PACKAGE_ALREADY_INSTALLED, CODES.INSTALL_ALREADY_INSTALLED]);
const REBOOT = new Set([CODES.INSTALL_REBOOT_REQUIRED_TO_FINISH, CODES.INSTALL_REBOOT_REQUIRED_FOR_INSTALL, CODES.INSTALL_REBOOT_INITIATED]);

// Windows reports exit codes as unsigned on some paths and signed on others; compare them unsigned.
function normalizeCode(code) {
  return typeof code === "number" && Number.isFinite(code) ? code >>> 0 : null;
}
function hex(code) { return "0x" + code.toString(16).toUpperCase().padStart(8, "0"); }
function describeCode(code) {
  const c = normalizeCode(code);
  if (c === null) return null;
  return MESSAGES.get(c) || null;
}

// Keep the last `maxChars` meaningful characters of winget output and drop spinner / progress-bar noise.
function tailOutput(text, maxChars = 300) {
  const lines = String(text || "").split(/[\r\n]+/).map((l) => l.trim()).filter((line) => {
    if (!line) return false;
    if (/^[-\\|/\s]+$/.test(line)) return false;            // spinner frames
    if (/[█▒░▓]/.test(line)) return false;                  // progress bars
    if (/^\d+(\.\d+)?\s*(B|KB|MB|GB)\s*\/\s*\d/i.test(line)) return false; // "12 MB / 48 MB"
    return true;
  });
  const joined = lines.slice(-6).join(" ");
  return joined.length > maxChars ? "…" + joined.slice(-maxChars) : joined;
}

// Append to a string buffer but never let it grow past `max` characters (keeps the end).
function capAppend(buffer, chunk, max = 64 * 1024) {
  const next = buffer + chunk;
  return next.length > max ? next.slice(next.length - max) : next;
}

function isScopeFallback(result) {
  if (!result || result.ok) return false;
  const c = normalizeCode(result.code);
  if (c === CODES.NO_APPLICABLE_INSTALLER) return true;
  return /no applicable installer|scope/i.test(result.output || "");
}

// Turn a raw runWinget() result for `winget install` into a user-facing verdict.
function interpretInstall(result) {
  if (result.ok) return { ok: true, message: "Installed successfully." };
  const c = normalizeCode(result.code);
  if (ALREADY_INSTALLED.has(c) || /already installed/i.test(result.output || "")) return { ok: true, message: "Already installed." };
  if (REBOOT.has(c)) return { ok: true, rebootRequired: true, message: "Installed. Restart Windows to finish." };
  const message = describeCode(c) || result.error || (c !== null ? "WinGet failed (" + hex(c) + ")." : "Installation failed.");
  return { ok: false, message };
}

// Same for `winget upgrade`.
function interpretUpgrade(result) {
  if (result.ok) return { ok: true, message: "Updated successfully." };
  const c = normalizeCode(result.code);
  if (c === CODES.NO_APPLICABLE_UPDATE || /no available upgrade|no newer package/i.test(result.output || "")) return { ok: true, message: "Already up to date." };
  if (REBOOT.has(c)) return { ok: true, rebootRequired: true, message: "Updated. Restart Windows to finish." };
  if (c === CODES.NO_PACKAGES_FOUND) return { ok: false, message: "WinGet does not see this app as installed, so it cannot update it." };
  const message = describeCode(c) || result.error || (c !== null ? "WinGet failed (" + hex(c) + ")." : "Update failed.");
  return { ok: false, message };
}

// Parse the JSON written by `winget export`. Returns a Set of lowercase package ids, or null if unparseable.
function parseExportJson(text) {
  try {
    const data = JSON.parse(String(text).replace(/^\uFEFF/, ""));
    if (!data || !Array.isArray(data.Sources)) return null;
    const ids = new Set();
    for (const source of data.Sources) {
      for (const pkg of (source && source.Packages) || []) {
        if (pkg && typeof pkg.PackageIdentifier === "string") ids.add(pkg.PackageIdentifier.toLowerCase());
      }
    }
    return ids;
  } catch {
    return null;
  }
}

module.exports = { CODES, normalizeCode, describeCode, tailOutput, capAppend, isScopeFallback, interpretInstall, interpretUpgrade, parseExportJson };
