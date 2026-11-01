# LamSuite Billing — Store Owner's Guide: Multi-Store Workspace

Welcome to **LamSuite Billing v2.0** with **Tally-Style Multi-Store Workspace**. 

This feature allows you to register and maintain multiple stores and branch counters on the same workstation terminal without resetting or re-pairing your device each time. You can switch between your pharmacy, clinic, or wholesale branch in under one second.

---

## 1. Store Selection Gateway (Company List)

When opening LamSuite Billing (or whenever you sign out to the Store Gateway):
- You will see a list of all registered stores on this machine.
- Each store card clearly shows:
  - **Store Name & Custom Alias** (e.g. *Main Road Pharmacy*, *North Clinic Express*)
  - **Color Identification Tag** (e.g. Emerald, Sky Blue, Purple, Amber, Crimson, Indigo)
  - **Counter Name** (e.g. *Counter 01*, *Prescription Dispatch*)
  - **Sync & Connectivity Status** (*Live Synced*, *Pending Count*, or *Offline Active*)
  - **Last Opened Timestamp**
- **Automatic Startup Option**: Enable *"Open last accessed store automatically on application launch"* if you typically work out of one primary store and want to jump straight to cashier login.

---

## 2. Instant Store Switching (< 1 Second)

While working anywhere inside LamSuite Billing (POS, Bills, Purchases, Reports):

### How to Switch:
1. **Keyboard Shortcut**: Press **`Alt + S`** (or **`Alt + F3`**).
2. **Command Palette**: Press **`Ctrl + K`**, type `"Switch Store"`, or select your store directly from the list.
3. **Top Bar Click**: Click the **Store Pill** with the colored badge in the top navigation bar.

### Unsaved Bill Protection:
If you have items currently loaded in your POS billing cart:
- The system will pause and warn you: *"You currently have unsaved items in your billing cart."*
- You can either **Hold the bill** (`F8`), or proceed with **Discard & Switch**.
- Held bills are preserved independently within each store's isolated database.

---

## 3. Visual Identity & Safety Guards

To prevent accidentally billing items under the wrong store branch:
1. **Window Top Accent Strip**: A colored bar matching your store's color spans the entire top edge of the window.
2. **Top Header Store Pill**: Shows your store alias and color dot at all times.
3. **POS Checkout Modal**: When you press **`F12`** to settle an invoice, the settlement dialog displays the active store name and color badge.
4. **Separate Staff Accounts**: Operators and cashiers sign in with their individual PIN/password scoped to that specific store.

---

## 4. Managing Registered Stores

From the **Select Store Gateway**:
- **Add Store / Branch**: Click **"+ Add Store / Branch"** to enroll another branch using your Owner credentials or Store Activation Key. (The app prevents registering the same store and counter name twice).
- **Edit Alias & Color**: Click the **Pencil icon** on any store card to customize the display nickname or color badge.
- **Disconnect Store**: Click the **LogOut icon** on any store card:
  - Prompts you to export an optional encrypted safety backup first.
  - Choose whether to delete local transactions or retain them on disk.
  - Requires entering `DISCONNECT` as confirmation.

---

## 5. Offline Data & Synchronization

- **Physical Isolation**: Each store's data is stored in its own SQLite database (`stores/{store_id}/store.sqlite`). No transaction, customer record, held bill, or report ever leaks across stores.
- **Low Memory Footprint**: Only the active store's database is loaded in memory at any time, allowing smooth operation on older Windows 7/8/10 desktop hardware.
- **Independent Sync**: The active store syncs automatically with the cloud, using its own store token.

---

## 6. Legacy Workstation Terminals (Windows 7 SP1 & Windows 8.1)

If your billing counter or dispensary operates on a legacy Windows 7 SP1 or Windows 8.1 PC:

1. **Installer**: Use the dedicated **Windows Legacy Installer**: `LamSuite-Billing-windows-legacy-x64-setup.exe` (bundled with WebView2 Fixed Version Runtime 109). Do not use the standard Windows 10/11 installer.
2. **Mandatory Operating System Prerequisites**:
   - **Service Pack 1 (SP1)**: Windows 7 must be running SP1 (Build 7601).
   - **KB4474419**: SHA-2 code signing update.
   - **KB4490628**: Servicing Stack Update (SSU).
   - **KB2999226 / KB3118401**: Universal C Runtime (UCRT).
3. **Enabling TLS 1.2 for Cloud Sync & Activation**:
   - Windows 7 has TLS 1.2 disabled by default. If the app displays a network or SSL handshake error, click **Download .reg Fix** inside the app (or run `enable-tls12-windows7.reg`) to set `DefaultSecureProtocols = 0x00000a00` in `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Internet Settings\WinHttp`.
4. **Root Certificate Installation (Let's Encrypt CA)**:
   - Modern HTTPS connections use ISRG Root X1. If certificate validation fails, download `isrgrootx1.der` and import it into **Trusted Root Certification Authorities** via `certmgr.msc` or `certutil -addstore -f "ROOT" isrgrootx1.der`.
5. **Hardware Printing on Legacy Terminals**:
   - **Thermal Receipt Printers (USB / Serial / LAN)**: Supported via direct RAW ESC/POS spooling with paper cut (`GS V 66 0`).
   - **Dot-Matrix Continuous Feed (TVS / Epson LX-300 / 310)**: Supported via ESC/P2 draft spooling without graphic overhead.
6. **Isolated Update Stream**:
   - Legacy installations query `latest-legacy-win7.json` and will never automatically apply modern Windows 10/11 updates.
