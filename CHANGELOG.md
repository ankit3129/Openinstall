# Changelog

## 0.8.0

### Fixed
- A failed per-user install no longer turns into an elevated install because the word "scope" appeared in WinGet's output. The machine-wide retry now happens only for the `NO_APPLICABLE_INSTALLER` exit code, and the result row says when it happened.
- After a timeout or cancel, OpenInstall now waits for the whole installer process tree to exit before the next item starts (previously the next install could start while the old one still held the installer lock).
- Release builds can no longer be cancelled by a later push: each release tag has its own workflow concurrency group.
- Closing the window between two queued items no longer abandons the rest of the queue without a prompt (the queue now runs in the main process).
- The "installs running" close prompt can no longer stay disabled if restarting for an update fails.
- Apps whose catalog ID pins a major version (Python 3.13, Ruby 3.4, GIMP 3, Visual Studio 2022) are detected when any version of that family is installed, and **Update** upgrades the version that is really installed.
- The **Open source** license filter no longer includes "core", "client", "base" and "components" apps; they have their own **Partly open source** group.

### Added
- **Cancel** and **Retry failed** buttons for the install/update queue.
- **Update available** badges (one `winget upgrade` call) and an **Update all** button in the Installed apps view.
- Whole app cards are clickable; visible keyboard focus styles.
- `npm run fetch:logos` downloads logos into `src/logos/` so real icons need no runtime network requests; bundled logos are used automatically.
- Tests for the WinGet process runner (timeout, cancel, output cap, missing executable), version-family detection and upgrade parsing, using a fake winget script.
- The window now uses `src/icon.png`.

### Performance
- Every WinGet call uses `--source winget` (skips the Microsoft Store source).
- The queue no longer finishes with a full `winget export` rescan; installed/updated state is updated locally.
- CI: fast checks on every push, the Windows installer only for releases and manual runs; npm cache enabled; `npm ci` instead of `npx npm@10`.

### Security
- The release workflow attaches files with the preinstalled GitHub CLI instead of a third-party action that ran with write access.
- Optional code signing through the `CSC_LINK` / `CSC_KEY_PASSWORD` repository secrets, with README steps for `publisherName` and tag protection.
- Permission checks are denied as well as permission requests.

## 0.7.0

### Fixed
- Install queue: the "Installing 2 of 5: ..." text was immediately overwritten and the in-progress row looked like a failure. Rows now have real states (pending, installed, opened, skipped, failed).
- Failures now show a readable reason (WinGet exit codes are translated) plus the tail of WinGet's output, instead of "WinGet exited with code 2316632161" or progress-bar noise.
- "Already installed", "scope not supported" and "no upgrade available" are detected from WinGet's numeric exit codes (still falling back to English text), so they work on non-English Windows.
- "Restart required" results are reported as success instead of failure.
- Website entries are counted as "download page opened", not as successful installs.
- GitHub-hosted apps no longer all show the same GitHub logo, and logo requests no longer fail against the Content-Security-Policy.
- The catalog loader is shared by the app and the validator, so a new `catalog-partN.json` can no longer pass validation yet silently not load. Load problems are shown in the UI.
- Updating apps: the previously unused update IPC now has an **Update** button in the Installed apps view, and no longer passes `--scope user` (which made machine-wide apps fail to update).
- Only one OpenInstall instance can run; closing the window during an installation asks first; running WinGet process trees are stopped on quit/timeout.
- README promised `winget export` detection and `/` `Ctrl+K` `Esc` shortcuts; both now exist.

### Performance
- Installed-app detection uses one `winget export` call (was ~200 `winget list` calls on every launch and after every install). The old scan remains as a fallback. Overlapping refreshes share one scan, and detection pauses while an install runs.
- Search is debounced and uses a precomputed lowercase index (it also matches package IDs). Selecting an app toggles in place instead of rebuilding all cards. Cards use `content-visibility`.
- WinGet output is decoded as UTF-8 and capped in memory.

### Privacy and security
- No internet requests for icons by default; real logos are an opt-in checkbox.
- `external:open` only opens links that belong to catalog sources or this repository's releases.
- CSP adds `base-uri 'none'`, `object-src 'none'`, `form-action 'none'`; permission requests are denied.

### Catalog
- Removed entries that are not installable on Windows via WinGet: Lutris, MangoHud, ShareDrop (browser service), Tox (not a single app), Inkscape Portable (duplicate), Barrier (unmaintained).
- `thunderbird-daily` renamed to `mozilla-thunderbird-beta` (it was the Beta package). Mumble package ID corrected to `Mumble.Mumble.Client`. Free Download Manager relabelled "Proprietary freeware".
- Validator now also checks icons, `sourceUrl`, and duplicate profile entries. New `npm run verify:winget` and a weekly workflow check every package ID against WinGet.

### Build
- Electron 38 (end of life) -> 44.4.5.
- Workflow: read-only permissions by default, separate write-access publish job, `npm ci` when a lockfile exists, unit tests in `npm run check`.
- `scripts/` is no longer bundled into the installed app.
