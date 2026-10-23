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
