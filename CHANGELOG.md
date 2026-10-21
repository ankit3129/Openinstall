# Changelog

## 0.9.0

### Removed
- Updating installed apps from OpenInstall (the Update button, Update all, and Update available badges). It could not update some apps reliably (for example Docker Desktop). Use `winget upgrade` or the app itself to update them. Updating OpenInstall itself is unchanged.

### Changed
- **New black interface.** Neutral black surfaces, one cobalt accent used only for things you can act on (selection, install, progress), Segoe UI Variable type, and a search-first layout. The large banner was removed to give the catalog more room.
- **Better categories.** Categories now live in the sidebar with icons and counts (replacing the dropdown). *All apps* is grouped by category with a short description for each, and the larger categories (Development, Utilities, Creative, Media, Documents, Everyday, Security) have subcategory chips such as *Databases*, *PDF tools* or *Passwords*. The license filter is now a segmented control.

### Added
- **Live download progress.** The installation queue is now a floating panel with an overall progress bar, a bar per app, and real download sizes taken from WinGet's output (downloading, verifying, installing, done). It stays visible while you scroll and can be collapsed.
- **Install button highlight.** The moment you select an app, the *Install* button lights up and a floating bar shows what is selected, with a one-click *Install* and *Clear*.
- **App details.** Every app has an *About* button that opens a panel with a full description, license, install method, and links to the official website and, where one exists, the GitHub repository. Search also looks inside these descriptions.
- Catalog fields: `about` (required, at least 40 characters), `group` (optional subcategory) and `github` (optional repository link). `npm run check` validates them.
- Setup profiles show the icons of the apps they contain.

### Notes
- Progress percentages come from parsing WinGet's text output. Downloads show real sizes; the installer step itself reports no numbers, so it shows an animated bar.

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
- The window only requests bundled logos that actually exist (the main process checks `src/logos/` once at startup), instead of failing about 209 image loads on every render when no logos are bundled.
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
