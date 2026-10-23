/**
 * Application environment and configuration constants.
 * Centralizes all environment variables and fallback values.
 */

export const API_BASE_URL: string = (
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

export const ADMIN_PORTAL_URL: string = (
  import.meta.env.VITE_ADMIN_PORTAL_URL || "https://admin.lamstonehealthcare.com"
).replace(/\/+$/, "");

export const DEFAULT_LAN_PORT: number =
  Number(import.meta.env.VITE_DEFAULT_LAN_PORT) || 8000;

export function getResolvedApiBaseUrl(): string {
  if (typeof localStorage !== "undefined") {
    const hubIp = localStorage.getItem("lamsuite_hub_ip");
    const hubPort = localStorage.getItem("lamsuite_hub_port") || "8000";
    if (hubIp && hubIp !== "127.0.0.1" && hubIp !== "localhost" && !hubIp.includes("tauri.localhost")) {
      return `http://${hubIp.trim()}:${hubPort}`;
    }
  }
  return API_BASE_URL;
}
