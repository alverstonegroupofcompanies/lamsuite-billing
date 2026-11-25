/**
 * Application environment and configuration constants.
 * Centralizes all environment variables and fallback values.
 */
import { isTauri } from "../lib/ipc/ipcBridge";

declare global {
  interface Window {
    __ENV__?: {
      VITE_API_BASE_URL?: string;
      VITE_WS_URL?: string;
      VITE_PANEL_PORTAL_URL?: string;
      VITE_ADMIN_PORTAL_URL?: string;
      VITE_LEGACY_API_URL?: string;
      VITE_DEFAULT_LAN_PORT?: string | number;
    };
  }
}

function resolveApiBaseUrl(): string {
  // 0. Runtime stored URL from user configuration
  if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
    try {
      const custom = localStorage.getItem("lamsuite_custom_api_url");
      if (custom?.trim()) return custom.trim().replace(/\/+$/, "");
    } catch {}
  }

  // 1. Runtime environment injected via Docker entrypoint / env.js
  if (typeof window !== "undefined" && window.__ENV__?.VITE_API_BASE_URL) {
    const raw = window.__ENV__.VITE_API_BASE_URL.trim();
    if (raw) return raw.replace(/\/+$/, "");
  }

  // 2. Build-time Vite environment variable
  const buildTimeEnv = import.meta.env.VITE_API_BASE_URL?.trim();

  // 3. Web browser auto-detection (when accessed via public domain)
  if (typeof window !== "undefined" && window.location) {
    const { protocol, hostname } = window.location;
    const isLocal =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".localhost") ||
      hostname.includes("tauri");

    if (!isLocal) {
      // If build-time env is set to an actual remote URL, prefer it
      if (
        buildTimeEnv &&
        !buildTimeEnv.includes("127.0.0.1") &&
        !buildTimeEnv.includes("localhost")
      ) {
        return buildTimeEnv.replace(/\/+$/, "");
      }

      // Auto-infer: web.<domain> or app.<domain> -> https://api.<domain>
      if (hostname.startsWith("web.")) {
        return `${protocol}//api.${hostname.slice(4)}`.replace(/\/+$/, "");
      }
      if (hostname.startsWith("app.")) {
        return `${protocol}//api.${hostname.slice(4)}`.replace(/\/+$/, "");
      }

      const parts = hostname.split(".");
      if (parts.length >= 2) {
        const rootDomain = parts.slice(1).join(".");
        return `${protocol}//api.${rootDomain}`.replace(/\/+$/, "");
      }

      return `${protocol}//${hostname}`.replace(/\/+$/, "");
    }
  }

  if (buildTimeEnv) {
    return buildTimeEnv.replace(/\/+$/, "");
  }

  // In production builds, default to production domain if no env specified
  if (import.meta.env.PROD) {
    return "https://api.lamstonehealthcare.com";
  }

  return "http://127.0.0.1:8000";
}

export let API_BASE_URL: string = resolveApiBaseUrl();

export function setApiBaseUrl(url: string): void {
  const cleaned = url.trim().replace(/\/+$/, "");
  API_BASE_URL = cleaned;
  if (typeof localStorage !== "undefined" && typeof localStorage.setItem === "function") {
    try {
      localStorage.setItem("lamsuite_custom_api_url", cleaned);
    } catch {}
  }
}

export function getCandidateApiUrls(): string[] {
  const current = getResolvedApiBaseUrl();
  const isCurrentLocal =
    current.includes("127.0.0.1") || current.includes("localhost");

  if (isCurrentLocal) {
    // If already targeting a local server, only use the current URL
    return [current];
  }

  // If targeting a remote cloud server, offer local backend as a fallback candidate
  return [current, "http://127.0.0.1:8000"];
}

function resolvePanelPortalUrl(): string {
  if (typeof window !== "undefined") {
    const raw =
      window.__ENV__?.VITE_PANEL_PORTAL_URL ||
      window.__ENV__?.VITE_ADMIN_PORTAL_URL;
    if (raw?.trim()) return raw.trim().replace(/\/+$/, "");
  }

  const buildTimeEnv =
    import.meta.env.VITE_PANEL_PORTAL_URL ||
    import.meta.env.VITE_ADMIN_PORTAL_URL;

  if (typeof window !== "undefined" && window.location) {
    const { protocol, hostname } = window.location;
    const isLocal =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".localhost") ||
      hostname.includes("tauri");

    if (!isLocal) {
      if (
        buildTimeEnv &&
        !buildTimeEnv.includes("example.com") &&
        !buildTimeEnv.includes("localhost") &&
        !buildTimeEnv.includes("127.0.0.1")
      ) {
        return buildTimeEnv.replace(/\/+$/, "");
      }

      if (hostname.startsWith("web.")) {
        return `${protocol}//app.${hostname.slice(4)}`.replace(/\/+$/, "");
      }

      if (hostname.startsWith("app.")) {
        return `${protocol}//app.${hostname.slice(4)}`.replace(/\/+$/, "");
      }

      const parts = hostname.split(".");
      if (parts.length >= 2) {
        const rootDomain = parts.slice(1).join(".");
        return `${protocol}//app.${rootDomain}`.replace(/\/+$/, "");
      }
    }
  }

  if (buildTimeEnv && !buildTimeEnv.includes("example.com")) {
    return buildTimeEnv.replace(/\/+$/, "");
  }

  return "https://app.example.com";
}

export const PANEL_PORTAL_URL: string = resolvePanelPortalUrl();
export const ADMIN_PORTAL_URL = PANEL_PORTAL_URL;

/**
 * The legacy v1 panel is a separate install from this portal. It is the only host
 * that serves /api/sync/pull — the portal answers that path with index.html, and
 * sends no CORS headers doing it, so a migration aimed at PANEL_PORTAL_URL fails
 * as a bare network error rather than as a 404. Never derive this from the portal.
 */
function resolveLegacyApiUrl(): string {
  const raw =
    (typeof window !== "undefined" && window.__ENV__?.VITE_LEGACY_API_URL) ||
    import.meta.env.VITE_LEGACY_API_URL;

  if (raw?.trim()) return raw.trim().replace(/\/+$/, "");

  return "https://admin.lamstonehealthcare.com";
}

export const LEGACY_API_URL: string = resolveLegacyApiUrl();

export const DEFAULT_LAN_PORT: number =
  Number(
    (typeof window !== "undefined" && window.__ENV__?.VITE_DEFAULT_LAN_PORT) ||
      import.meta.env.VITE_DEFAULT_LAN_PORT
  ) || 8000;

export function getResolvedApiBaseUrl(): string {
  if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
    const custom = localStorage.getItem("lamsuite_custom_api_url");
    if (custom?.trim()) {
      return custom.trim().replace(/\/+$/, "");
    }
    const hubIp = localStorage.getItem("lamsuite_hub_ip");
    const hubPort = localStorage.getItem("lamsuite_hub_port") || "8000";
    if (
      hubIp &&
      hubIp !== "127.0.0.1" &&
      hubIp !== "localhost" &&
      !hubIp.includes("tauri.localhost")
    ) {
      // In an HTTPS web browser, direct LAN IPs will fail mixed-content / PNA checks
      if (typeof window !== "undefined" && window.location.protocol === "https:" && !isTauri()) {
        return API_BASE_URL;
      }
      return `http://${hubIp.trim()}:${hubPort}`;
    }
  }
  return API_BASE_URL;
}
