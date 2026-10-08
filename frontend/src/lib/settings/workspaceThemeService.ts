import type { WorkspaceSettings } from "./companySettingsService";

const STORAGE_KEY = "lamsuite_workspace_settings";

let inMemoryStore: Record<string, string> = {};

let systemThemeMediaQuery: MediaQueryList | null = null;
let systemThemeListener: ((e: MediaQueryListEvent) => void) | null = null;

function safeGetItem(key: string): string | null {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
      return localStorage.getItem(key);
    }
  } catch {
    // fallback
  }
  return inMemoryStore[key] || null;
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.setItem === "function") {
      localStorage.setItem(key, value);
    }
  } catch {
    // fallback
  }
  inMemoryStore[key] = value;
}

export function clearWorkspaceMemoryCache(): void {
  inMemoryStore = {};
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.removeItem === "function") {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // fallback
  }
}

/**
 * Apply the theme (light, dark, or system) to document.documentElement
 */
export function applyWorkspaceTheme(theme: "light" | "dark" | "system"): void {
  if (typeof document === "undefined" || !document.documentElement) return;
  const root = document.documentElement;

  // Remove existing system listener if any
  if (systemThemeMediaQuery && systemThemeListener) {
    systemThemeMediaQuery.removeEventListener("change", systemThemeListener);
    systemThemeListener = null;
  }

  if (theme === "dark") {
    root.classList.add("dark");
    root.style.colorScheme = "dark";
  } else if (theme === "light") {
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  } else {
    // System Theme
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      systemThemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const applySystem = (isDark: boolean) => {
        if (isDark) {
          root.classList.add("dark");
          root.style.colorScheme = "dark";
        } else {
          root.classList.remove("dark");
          root.style.colorScheme = "light";
        }
      };

      applySystem(systemThemeMediaQuery.matches);

      systemThemeListener = (e: MediaQueryListEvent) => {
        applySystem(e.matches);
      };
      systemThemeMediaQuery.addEventListener("change", systemThemeListener);
    } else {
      root.classList.remove("dark");
      root.style.colorScheme = "light";
    }
  }
}

/**
 * Apply grid density (compact vs comfortable)
 */
export function applyWorkspaceDensity(density: "compact" | "comfortable"): void {
  if (typeof document === "undefined" || !document.documentElement) return;
  document.documentElement.setAttribute("data-density", density || "comfortable");
}

/**
 * Apply font size (sm: 12px, base: 14px, lg: 16px)
 */
export function applyWorkspaceFontSize(fontSize: "sm" | "base" | "lg"): void {
  if (typeof document === "undefined" || !document.documentElement) return;
  document.documentElement.setAttribute("data-font-size", fontSize || "base");
}

/**
 * Apply full workspace settings live and cache
 */
export function applyWorkspaceSettings(settings: Partial<WorkspaceSettings>): void {
  if (settings.theme) {
    applyWorkspaceTheme(settings.theme);
  }
  if (settings.density) {
    applyWorkspaceDensity(settings.density);
  }
  if (settings.fontSize) {
    applyWorkspaceFontSize(settings.fontSize);
  }

  // Cache settings
  const existing = getCachedWorkspaceSettings();
  const merged = { ...existing, ...settings };
  safeSetItem(STORAGE_KEY, JSON.stringify(merged));

  // Broadcast event for active components
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("lamsuite-workspace-changed", { detail: settings }));
  }
}

/**
 * Read cached workspace settings
 */
export function getCachedWorkspaceSettings(): WorkspaceSettings {
  try {
    const raw = safeGetItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore
  }

  return {
    theme: "system",
    density: "comfortable",
    fontSize: "base",
    notificationsEnabled: true,
    autoUpdateCheck: true,
    wifiStrengthSimulator: 100,
    defaultLandingPage: "dashboard",
  };
}

/**
 * Initialize workspace settings on app boot
 */
export function initWorkspaceSettings(initial?: Partial<WorkspaceSettings>): void {
  const cached = getCachedWorkspaceSettings();
  const active = { ...cached, ...initial };
  applyWorkspaceSettings(active);
}
