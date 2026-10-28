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
      VITE_DEFAULT_LAN_PORT?: string | number;
    };
  }
}

function resolveApiBaseUrl(): string {
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

      // Auto-infer: app.<domain> -> https://api.<domain>
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

  return "http://127.0.0.1:8001";
}

export const API_BASE_URL: string = resolveApiBaseUrl();

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

      if (hostname.startsWith("app.")) {
        return `${protocol}//panel.${hostname.slice(4)}`.replace(/\/+$/, "");
      }

      const parts = hostname.split(".");
      if (parts.length >= 2) {
        const rootDomain = parts.slice(1).join(".");
        return `${protocol}//panel.${rootDomain}`.replace(/\/+$/, "");
      }
    }
  }

  if (buildTimeEnv && !buildTimeEnv.includes("example.com")) {
    return buildTimeEnv.replace(/\/+$/, "");
  }

  return "https://panel.example.com";
}

export const PANEL_PORTAL_URL: string = resolvePanelPortalUrl();
export const ADMIN_PORTAL_URL = PANEL_PORTAL_URL;

export const DEFAULT_LAN_PORT: number =
  Number(
    (typeof window !== "undefined" && window.__ENV__?.VITE_DEFAULT_LAN_PORT) ||
      import.meta.env.VITE_DEFAULT_LAN_PORT
  ) || 8000;

export function getResolvedApiBaseUrl(): string {
  if (typeof localStorage !== "undefined") {
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
