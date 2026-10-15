# OpenInstall

**An open-source-first software installer for Windows.**

OpenInstall is a desktop app for discovering a curated catalog of 215 Windows applications: 203 WinGet packages and 12 official-website entries, including the ArtCraft suite. Select supported packages to install through WinGet; website entries open the publisher's download page. License labels distinguish open-source software, freeware, and proprietary apps.

> **Status: early development.** This project has not undergone an independent security audit. Catalog IDs and installation behavior can change; review each app and any Windows UAC prompt before proceeding.

## Features

- Search a curated catalog across creative tools, development, utilities, documents, networking, gaming, media, and everyday apps.
- Filter by category and license type.
- Select multiple WinGet applications and install them in a sequential queue.
- Open official download pages for the 12 catalog entries without a WinGet package, including ArtCraft tools.
- Use six starter profiles: Everyday Essentials, Creator Studio, Developer Workstation, Gaming Essentials, Privacy & Safety, and Open-Source Toolkit.
- Detect applications recognized by WinGet (one fast `winget export` scan, with a per-package fallback).
- Keyboard shortcuts: press `/` or `Ctrl+K` to search, `Esc` to clear.
- Prefer per-user installation scope to reduce unnecessary elevation prompts where the package supports it.
- Build a per-user Windows setup executable with Electron Builder.
- Build the Windows installer automatically with GitHub Actions.
- Update itself automatically from GitHub Releases, with an in-app banner.

## Download

Visit [GitHub Releases](https://github.com/ankit3129/Openinstall/releases) for packaged Windows installers when available. You can also download the repository as a ZIP using **Code → Download ZIP**.

## Build from source (Windows)

**Requirements:** Windows 10/11, Node.js LTS with npm, WinGet/App Installer, and an internet connection.

1. Clone this repository or download its ZIP.
2. Open a terminal in the project folder.
3. Install dependencies with npm 10:
   ```powershell
   npx --yes npm@10 install
   ```
4. Check JavaScript syntax and validate the catalog:
   ```powershell
   npx --yes npm@10 run check
   ```
5. Launch in development:
   ```powershell
   npx --yes npm@10 start
   ```
6. Build the Windows installer:
   ```powershell
   npx --yes npm@10 run dist:win
   ```

The setup executable is written to `release/`. Initial dependency downloads can take several minutes. A normal user should receive the packaged installer and should not need Node.js or npm.

You can also double-click `Build-OpenInstall-Installer.bat` for a guided build.

## GitHub Actions

The workflow at `.github/workflows/build-windows.yml` builds on pushes to `main`, on published GitHub Releases, or when manually started from the Actions tab. It checks JavaScript syntax and catalog consistency, builds the Windows NSIS installer, and uploads the executable as an artifact. For a published release, it attaches the installer, blockmap, and `latest.yml` metadata.

## Automatic updates

Installed copies of OpenInstall update themselves from GitHub Releases. The app checks shortly after launch and every 4 hours, downloads a newer version quietly in the background, and shows an in-app banner with progress. When the download finishes, **Restart and update** installs it and relaunches; if the user ignores the banner, the update installs when they close the app. **Check for updates** in the sidebar checks on demand.

### Publishing an update

1. Bump `"version"` in `package.json` (currently `0.6.1`) and commit it to `main`.
2. On GitHub, create a **new release** with a matching tag, such as `v0.6.1`, and click **Publish release** (not draft, not pre-release).
3. The workflow verifies the tag matches `package.json`, builds the installer, and attaches `OpenInstall-<version>-Setup.exe`, its blockmap, and `latest.yml`.
4. Installed apps pick it up at their next check.

The repository must be public for the updater to access GitHub Releases without an embedded token. Pre-releases and drafts are ignored by the updater. Without a code-signing certificate, Windows SmartScreen may warn on the first manual download.

To preview the banner without releasing anything, run `$env:OPENINSTALL_SIMULATE_UPDATE=1; npm start` in PowerShell.

## Installation and security

OpenInstall asks WinGet to install the package IDs stored in `src/catalog-part1.json` to `catalog-part4.json`. It does not download arbitrary commands from the renderer or disable Windows security protections.

- The **Prefer per-user installs** option adds WinGet's `--scope user`. It can reduce administrator prompts, but packages that do not support user scope may fail.
- Turning that option off allows WinGet to use its default behavior, which may request administrator approval.
- Some installers genuinely require elevation. Never approve a prompt unless you recognize the publisher and understand the requested action.
- Installed-app detection is based on WinGet and may not detect apps installed by other methods.
- Silent installation behavior varies by package and publisher.
- The current catalog is a starter set and package identifiers should be revalidated before each release.

## Catalog and licenses

Catalog data lives in `src/catalog-part1.json` to `catalog-part4.json`. Each entry contains a display name, category, description, WinGet package ID (except website entries), and a license classification. **Not every app is open source.** Application names, trademarks, binaries, and their licenses belong to their respective publishers. Listing an app is not an endorsement or guarantee of safety.

Before contributing an entry, verify the official publisher, exact package ID, license, supported Windows architecture, installation scope, and silent-install behavior. Do not add arbitrary shell commands or unverified download URLs.

## Contributing

Issues and pull requests are welcome. For catalog changes, include official source links and the reasoning for the package ID and license classification. Please describe any installation limitations and test results.

## Roadmap

- Expand and automatically validate catalog entries.
- Improve installation progress and failure recovery.
- Add screenshots, tests, signed releases, and contributor guidance.

## License

OpenInstall source code is released under the [MIT License](LICENSE). Third-party applications remain under their own licenses.
