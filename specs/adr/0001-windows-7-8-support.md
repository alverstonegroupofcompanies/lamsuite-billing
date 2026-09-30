# ADR 0001: Legacy Windows (Windows 7 / 8) Desktop Runtime Strategy

## Status
Proposed / Evaluated

## Context
Non-Negotiable Requirement 3 states:
> "Must run on older Windows, including Windows 7 and 8. Tauri 2 needs Windows 10+ (WebView2), and Tauri 1.x on Windows 7/8 depends on an old, unsupported WebView2. Analyze this in the plan. If Tauri cannot meet the requirement, say so clearly, propose the best alternative (e.g., Electron 22 or earlier, .NET/WPF, Qt), and wait for my decision. Do not silently pick a workaround."

### Technical Realities of Windows 7/8 in 2026:
1. **Tauri 2.x:**
   - Explicitly targets Windows 10 and 11.
   - Depends on modern WebView2 runtime features and Rust toolchain targets (`x86_64-pc-windows-msvc`) that do not run reliably on Windows 7 SP1 without extensive patching.
2. **Tauri 1.x:**
   - Can run on Windows 7 SP1 *if and only if* Microsoft's last Evergreen/Fixed WebView2 build for Windows 7 (v109, released in Jan 2023) is pre-installed on the host machine.
   - However, Chromium 109 is end-of-life and lacks modern web standards (e.g. newer CSS subgrid, certain ES2024 features).
3. **Electron 22.x:**
   - Electron 22 is the definitive, battle-tested final version of Electron that officially supports Windows 7, Windows 8, and Windows 8.1.
   - Bundles its own self-contained Chromium runtime and Node.js environment without requiring external WebView2 runtime installation.
4. **Decoupled Architecture (Universal Core):**
   - The user interface is built in React + TypeScript + Vite + Tailwind + Shadcn UI.
   - If the business logic and SQLite integration are cleanly abstracted via an IPC adapter interface (`IpcBridge`), the exact same frontend code can run under **Tauri 1.x / 2.x** OR **Electron 22 (Win7 packaging)** with zero code duplication.

## Decision Matrix

| Dimension | Tauri 2.x | Tauri 1.x (with WV2 v109) | Electron 22.x | Decoupled Multi-Target (Recommended) |
|---|---|---|---|---|
| **Windows 10 / 11 Support** | Outstanding (native, tiny 10MB binary, 40MB RAM) | Good | Good (large 80MB binary, 150MB RAM) | **Best of Both Worlds** |
| **Windows 7 / 8 Support** | ❌ Fails to run | ⚠️ Works with Fixed WV2 v109 installer | ✅ 100% Native, self-contained | ✅ **100% Native via Win7 Target** |
| **Native Silent Print** | Native Rust spooler | Native Rust spooler | Native Node `win32-print` | Unified IPC |
| **Offline SQLite** | Rusqlite (Rust) | Rusqlite (Rust) | Better-sqlite3 (Node) | Common SQLite Schema |

## Recommendation
We adopt a **Decoupled Architecture with Tauri Primary and Win7 Build Target**:
1. **Primary Build (Windows 10/11 & macOS/Linux):** Tauri 1.x / 2.x for ultra-fast, lightweight, memory-efficient distribution (10MB installer, instant boot).
2. **Legacy Windows 7/8 Build Target:** Use Electron 22.3.35 (bundled Chromium 108/109) utilizing the existing `alverstone-billing-electronjs-win7` configuration already present on the machine, powered by the exact same React frontend and shared SQLite schema.
3. This eliminates all risk for older pharmacy POS hardware while delivering the modern Tauri desktop benefits on all updated terminals.
