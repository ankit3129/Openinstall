# OpenInstall

**A Windows software setup assistant built around an open-source-first catalog.**

OpenInstall aims to make setting up a fresh Windows PC easier: browse a curated catalog, select multiple apps, and install them from one place. It combines open-source tools with useful freeware and proprietary apps, clearly labeling their licensing status.

> **Project status:** Early development (v0.4.0 / Release 3). This project is not yet a mature or security-audited installer. Review the code and package details before use, especially before approving Windows elevation prompts.

## What it aims to do

- **Curated software catalog** across creative tools, development, utilities, documents, networking, gaming, and everyday apps.
- **Bulk install queue** with progress, logs, cancellation, and per-app failure reporting.
- **Setup profiles** for Everyday Essentials, Creator Studio, Developer Workstation, Gaming Essentials, Privacy & Safety, and Open-Source Toolkit.
- **WinGet-based installed-app detection** for catalog entries with matching package IDs.
- **Saved setup recipes**: export a selection to JSON and import it on another PC.
- **Selected-app updates** using WinGet.
- **Prefer current-user installs** to reduce unnecessary administrator prompts when a package supports per-user installation.
- **Windows installer build** using Electron Builder and GitHub Actions.

## Important security notes

OpenInstall launches package-manager commands for software selected by the user. Treat it as software that can make meaningful changes to your PC.

- Review the publisher and package identity before installing.
- Only approve a Windows UAC prompt when you understand which installer requested it.
- OpenInstall does **not** disable or bypass Windows security prompts.
- The current-user install preference uses WinGet's `--scope user` where supported. Some packages do not support user scope and may fail; unchecking that preference allows WinGet to choose its default scope and may require administrator approval.
- Package availability, identifiers, publisher behavior, and installer options can change. Catalog entries should be verified regularly.
- Website-only catalog entries open their official download pages and require you to complete the installation manually.
- Installed-app detection is based on WinGet and may not detect software installed through other channels.
- This project has not undergone an independent security audit. Use at your own discretion.

## Get OpenInstall

### Download a Windows build

Check the [Releases page](https://github.com/ankit3129/Openinstall/releases) for published installers. Until a release asset is available, you can build from source using the instructions below.

### Build from source (Windows)

Requirements:
- Windows 10 or Windows 11
- [Node.js LTS](https://nodejs.org/) with npm
- An internet connection to download npm dependencies

1. Clone or download this repository.
2. Open a terminal in the repository folder.
3. Install dependencies:
   ```powershell
   npm install
   ```
4. Run syntax checks:
   ```powershell
   npm run check
   ```
5. Launch the app in development:
   ```powershell
   npm start
   ```
6. Build a Windows setup executable:
   ```powershell
   npm run dist:win
   ```

The setup executable should appear in the `release/` directory. First-time dependency installation can take several minutes. Normal users should receive a packaged installer rather than being asked to install Node.js.

You can also run `Build-OpenInstall-Installer.bat` on Windows to follow the guided build steps.

## GitHub Actions

The workflow in `.github/workflows/build-windows.yml` runs on Windows when manually triggered and when a version tag such as `v0.4.0` is pushed. It installs dependencies, checks JavaScript syntax, builds the NSIS installer, and uploads the resulting `.exe` as a workflow artifact. For version tags, it also attaches the installer to the GitHub Release.

## Catalog and licensing

The catalog is maintained in `src/software.json`. OpenInstall is open-source-first, but **not every listed application is open source**. Application names, trademarks, binaries, and logos belong to their respective owners, and each app remains under its own license. Catalog presence is not an endorsement or guarantee of safety.

Before adding a new entry, verify:
1. Official project or publisher source.
2. Exact WinGet package ID or official download URL.
3. License classification (open source, freeware, or proprietary).
4. Supported Windows architectures and installation scope.
5. Whether silent installation is supported and whether elevation is expected.

## Contributing

Contributions are welcome. Please open an issue before large changes, especially for new catalog sources or installer behavior.

When submitting a catalog entry, include its official source, package identifier, license classification, and any known installation limitations. Do not add arbitrary shell commands or unverified download URLs.

## Roadmap

- Improve first-run and installation reliability.
- Expand and validate the catalog.
- Improve profiles, app detection, progress reporting, and recovery.
- Publish reproducible, signed Windows releases when practical.
- Add contributor documentation and automated catalog validation.

## License

The OpenInstall source code is intended to be licensed under the MIT License; see [LICENSE](LICENSE). Third-party applications remain under their own licenses.
