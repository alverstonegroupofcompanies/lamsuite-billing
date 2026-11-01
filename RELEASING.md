# LamSuite Billing Desktop — Release & Auto-Updater Guide

This document outlines the complete build, signing, verification, and deployment lifecycle for the LamSuite Billing multi-platform desktop application.

---

## 1. Architecture Overview

The release pipeline builds, signs, and distributes auto-updating desktop packages across all supported client platforms from a single git version tag (`v*.*.*`).

```
                +---------------------------------------+
                |          Git Tag: vX.Y.Z              |
                +---------------------------------------+
                                   |
                +---------------------------------------+
                | validate-and-gate (Security & Version)|
                +---------------------------------------+
                                   |
                +---------------------------------------+
                |   create-release (Draft Release ID)   |
                +---------------------------------------+
                 /           |             |           \
+----------------+   +-------+-------+   +-+-----------+   +-------------------+
| Windows x64    |   | macOS ARM64   |   | macOS Intel |   | Linux x64 (Ubuntu)|
| NSIS & MSI     |   | Apple Silicon |   | x86_64 DMG  |   | AppImage, deb, rpm|
| + Minisign sig |   | + Tarball sig |   | + Tarball sig|  | + Tarball sig     |
+----------------+   +---------------+   +-------------+   +-------------------+
        \                    |             |                    /
         \                   |             |                   /
          +------------------+-------------+------------------+
                             |
             +-------------------------------+
             | Windows 7/8.1 Legacy Job      |
             | (Rust 1.75.0 + WebView2 109)  |
             +-------------------------------+
                             |
             +-------------------------------+
             | publish-release               |
             | Reconcile & Upload latest.json|
             | Undraft GitHub Release        |
             +-------------------------------+
                             |
             +-------------------------------+
             | verify-release Gate           |
             | Inspects all assets & URLs    |
             +-------------------------------+
                             |
             +-------------------------------+
             | deploy-updater                |
             | Sync to updates.DOMAIN via SSH|
             +-------------------------------+
```

---

## 2. GitHub Secrets Configuration

Set the following secrets under **Repository Settings -> Secrets and variables -> Actions**:

### A. Tauri Auto-Updater Signing (Required)
The pipeline supports both Tauri 1 and Tauri 2 secret naming conventions:

| Secret Name | Compatible Alias | Description |
| :--- | :--- | :--- |
| `TAURI_PRIVATE_KEY` | `TAURI_SIGNING_PRIVATE_KEY` | Minisign private key content (including untrusted comments). |
| `TAURI_KEY_PASSWORD` | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Passphrase used when generating the Minisign key. |

### B. Updates Server SSH Deployment (Required for Private Repos)
Because GitHub Releases on private repositories require authentication headers that client updaters cannot supply anonymously, update artifacts and manifests are synchronized to `https://updates.lamstonehealthcare.com/`:

| Secret Name | Description |
| :--- | :--- |
| `SSH_HOST` | Server IPv4 or hostname (`api.lamstonehealthcare.com`). |
| `SSH_USER` | Restricted deployment user (`deploy`). |
| `SSH_PRIVATE_KEY` | OpenSSH private key (ED25519 or RSA) with write access to `/opt/lamsuite/updates/`. |
| `SSH_PASSPHRASE` | *(Optional)* Passphrase if the SSH key is encrypted. |

### C. Apple Code Signing & Notarization (Optional)
If omitted, macOS builds succeed unsigned. Unsigned builds require users to right-click and choose *Open* or execute `xattr -d com.apple.quarantine /Applications/LamSuite\ Billing.app` on first run.

| Secret Name | Description |
| :--- | :--- |
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12` certificate. |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` certificate. |
| `APPLE_SIGNING_IDENTITY` | Signing identity string (e.g. `Developer ID Application: Alverstone (...)`). |
| `APPLE_ID` | Apple Developer account email address. |
| `APPLE_PASSWORD` | App-specific password generated via appleid.apple.com. |
| `APPLE_TEAM_ID` | 10-character Apple Developer Team ID. |

---

## 3. Signing Key Management & Rotation

### Generate a New Keypair
From the `frontend` directory:
```bash
npm run tauri signer generate -- -w ~/.tauri/lamsuite_release.key
```
You will be prompted for a password. This command outputs:
1. **Public Key**: Displayed on stdout and saved as `~/.tauri/lamsuite_release.key.pub`.
2. **Private Key**: Saved encrypted at `~/.tauri/lamsuite_release.key`.

### Key Rotation Steps
1. Copy the public key string into `frontend/src-tauri/tauri.conf.json` under `tauri.updater.pubkey`.
2. Update `frontend/src-tauri/tauri.legacy.conf.json` with the same public key.
3. Update GitHub repository secret `TAURI_PRIVATE_KEY` with the entire content of `~/.tauri/lamsuite_release.key`.
4. Update GitHub repository secret `TAURI_KEY_PASSWORD` with the new password.
5. Commit and tag a release.

---

## 4. Cutting a Release Step-by-Step

### Step 1: Synchronize Version Numbers
Ensure `package.json`, `Cargo.toml`, and `tauri.conf.json` reflect the exact same SemVer version:
```bash
# Example bumping to 2.0.12
node scripts/check-release-versions.cjs 2.0.12
```
If versions disagree, update:
- `frontend/package.json`: `"version": "2.0.12"`
- `frontend/src-tauri/Cargo.toml`: `version = "2.0.12"`
- `frontend/src-tauri/tauri.conf.json`: `"package": { "version": "2.0.12" }`
- `frontend/src-tauri/tauri.legacy.conf.json`: `"package": { "version": "2.0.12" }`

### Step 2: Run Local Quality & Security Gates
```bash
cd frontend
npm ci
npm run check:security
npm test
```

### Step 3: Tag and Push
```bash
git add frontend/package.json frontend/src-tauri/Cargo.toml frontend/src-tauri/tauri.conf.json frontend/src-tauri/tauri.legacy.conf.json
git commit -m "chore(release): bump desktop version to 2.0.12"
git tag -a v2.0.12 -m "Release v2.0.12"
git push origin main
git push origin v2.0.12
```

---

## 5. Pipeline Stages & Verification Gate

The release workflow `.github/workflows/release.yml` executes in seven stages:

1. **`validate-and-gate`**: Enforces version integrity across all 3 configuration files, checks for demo code leaks via `npm run check:security`, and gathers Git changelog notes.
2. **`create-release`**: Initializes a draft GitHub release with the compiled changelog.
3. **`build-and-release`**: Runs parallel builders across:
   - `windows-latest` -> NSIS single-file installer (`.exe`), WiX installer (`.msi`), and `.nsis.zip.sig`.
   - `macos-latest` (Apple Silicon) -> DMG, `.app.tar.gz`, and `.app.tar.gz.sig`.
   - `macos-latest` (Intel) -> DMG, `.app.tar.gz`, and `.app.tar.gz.sig`.
   - `ubuntu-22.04` (Linux) -> `.AppImage`, `.deb`, `.rpm`, `.AppImage.tar.gz`, and `.sig`.
4. **`build-windows-legacy`**: Compiles an isolated Windows 7/8.1 64-bit binary pinned to **Rust 1.77.2** with `win7_compat_shim.c` (neutralizing Windows 8+ `PackageIdFromFullName` imports), bundles **WebView2 Fixed Version Runtime 109**, verifies zero banned entry points via `verify-win7-binary-imports.cjs`, and packages `LamSuite-Billing-windows-legacy-x64-setup.exe`.
5. **`publish-release`**: Consolidates all platform signatures into `latest.json` and legacy channel `latest-legacy-win7.json`, and changes release status from Draft to Published.
6. **`verify-release`**: **The release quality gate.** It:
   - Confirms all required assets (modern installer, legacy installer, updater signatures, manifests) are attached to the release.
   - Inspects `latest.json` and `latest-legacy-win7.json` to verify entries exist for `windows-x86_64`, `darwin-aarch64`, `darwin-x86_64`, and `linux-x86_64`.
   - Sends HTTP requests to ensure every update URL resolves (200 OK) and signatures are valid.
   - Fails the workflow immediately if any artifact or entry is missing.
7. **`deploy-updater`**: Syncs update archives, `latest.json`, and `latest-legacy-win7.json` to the updates hosting server (`/opt/lamsuite/updates/`) via SSH key authentication.

---

## 6. How to Test Auto-Update from Version $N$ to $N+1$

### Windows 10 / 11 Testing
1. Install version $N$ on a test machine using the `.exe` installer.
2. Launch LamSuite Billing and verify the version in the bottom status bar displays $N$.
3. Publish version $N+1$ to the release endpoint.
4. Either wait for the scheduled background check (triggered every 30 minutes in `autoUpdateService.ts`) or trigger it manually from Settings -> Check for Updates.
5. Verify:
   - A download progress dialog or notification appears.
   - Upon completion, the application restarts automatically.
   - Version displayed after restart is $N+1$.
   - SQLite offline database and activation credentials remain intact.

### macOS Testing (Apple Silicon & Intel)
1. Mount the `.dmg` of version $N$ and drag `LamSuite Billing.app` into `/Applications`.
2. Launch the application.
3. Trigger the update check; verify `AutoUpdateService` downloads the update archive (`.app.tar.gz`).
4. Minisign validates the payload against the embedded public key.
5. Application relaunches seamlessly into version $N+1$.

### Linux Testing (AppImage)
1. Make version $N$ executable: `chmod +x LamSuite-Billing.AppImage`.
2. Run `./LamSuite-Billing.AppImage`.
3. Check for update: verify the new AppImage is downloaded and replaces the running binary on restart.

### Windows 7 / 8.1 Legacy VM Test Procedure
> [!IMPORTANT]
> Microsoft ceased all security updates for Windows 7 (Jan 2020) and Windows 8.1 (Jan 2023). WebView2 runtime 109 is the final supported build and contains known unpatched Chromium CVEs. Windows 7 must have Service Pack 1 and essential updates installed prior to running the legacy installer.

#### VM Environment Setup:
1. **Clean Virtual Machine**: Windows 7 SP1 x64 (Build 7601) or Windows 8.1 x64.
2. **Mandatory Updates**:
   - **KB4474419**: SHA-2 code signing support (mandatory for driver and installer validation).
   - **KB4490628**: Servicing Stack Update (SSU).
   - **KB2999226 / KB3118401**: Universal C Runtime (UCRT).
3. **TLS 1.2 Protocol Activation**:
   - Run the provided registry script (`enable-tls12-windows7.reg`) to set `DefaultSecureProtocols = 0x00000a00` in `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Internet Settings\WinHttp`.
4. **Root Certificate Installation**:
   - Import `isrgrootx1.der` (ISRG Root X1 / Let's Encrypt CA) into the Local Machine **Trusted Root Certification Authorities** store using `certmgr.msc` or `certutil -addstore -f "ROOT" isrgrootx1.der`.
5. **Install & Verify**:
   - Run `LamSuite-Billing-windows-legacy-x64-setup.exe`.
   - Confirm installer unpacks and launches with **zero** `PackageIdFromFullName` or `KERNEL32.dll` missing-entry-point dialogs.
   - Confirm bundled WebView2 Fixed Version 109 initializes the POS interface.
   - Log in with staff PIN, sync master catalogue from `https://api.lamstonehealthcare.com`, and execute test bills.
   - Verify local thermal receipt spooling (`RAW` ESC/POS) and dot-matrix continuous feed spooling (`ESC/P2`).
   - Trigger manual update check: verify `latest-legacy-win7.json` is queried and the app auto-updates strictly on the legacy channel without offering Windows 10/11 binaries.
