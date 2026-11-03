/**
 * Client Device Identifier Service.
 * Guarantees every browser tab, mobile browser, or workstation client
 * possesses a stable, unique device UUID so sessions never clobber each other.
 */

const STORAGE_KEY = "lamsuite_client_device_uuid";

export function getOrCreateClientDeviceUuid(): string {
  try {
    if (typeof localStorage !== "undefined") {
      let existing = localStorage.getItem(STORAGE_KEY);
      if (existing && existing.trim().length > 6) {
        return existing.trim();
      }
      const generated = `dev_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      localStorage.setItem(STORAGE_KEY, generated);
      return generated;
    }
  } catch (_) {}

  return `dev_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

export function detectDeviceFriendlyName(): string {
  if (typeof navigator === "undefined") return "Workstation";

  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "Apple Mobile Terminal";
  if (/Android/.test(ua)) return "Android POS Terminal";
  if (/Macintosh/.test(ua)) {
    if (/Chrome/.test(ua) && !/Electron/.test(ua)) return "Mac (Chrome)";
    if (/Safari/.test(ua) && !/Chrome/.test(ua)) return "Mac (Safari)";
    return "Mac Workstation";
  }
  if (/Windows/.test(ua)) return "Windows POS Terminal";
  if (/Linux/.test(ua)) return "Linux Workstation";

  return "Web POS Terminal";
}
