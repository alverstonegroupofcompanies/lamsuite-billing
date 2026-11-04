import { isTauri } from "../ipc/ipcBridge";

/**
 * Validates whether a string is a standard IPv4 address.
 */
export function isIpv4(ip?: string | null): boolean {
  if (!ip) return false;
  const trimmed = ip.trim();
  const parts = trimmed.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const num = Number(p);
    return !isNaN(num) && num >= 0 && num <= 255 && String(num) === p;
  });
}

/**
 * Normalizes an IP string into clean IPv4.
 * Handles IPv4-mapped IPv6 (::ffff:192.168.1.1), loopback (::1 -> 127.0.0.1), and port stripping.
 */
export function formatIpv4(ip?: string | null, fallback = "127.0.0.1"): string {
  if (!ip) return fallback;
  let clean = ip.trim();

  // Strip port if formatted as 192.168.1.1:8080
  if (clean.includes(":") && !clean.includes("::")) {
    const splitPort = clean.split(":");
    if (splitPort.length === 2 && isIpv4(splitPort[0])) {
      clean = splitPort[0];
    }
  }

  // IPv6 loopback
  if (clean === "::1" || clean === "0:0:0:0:0:0:0:1") {
    return "127.0.0.1";
  }

  // IPv4-mapped IPv6 e.g. ::ffff:192.168.0.10
  if (clean.toLowerCase().startsWith("::ffff:")) {
    clean = clean.slice(7);
  }

  return isIpv4(clean) ? clean : fallback;
}

export class DeviceIpService {
  private cachedIpv4: string | null = null;
  private lastFetchedAt = 0;
  private isDetecting = false;
  private readonly CACHE_TTL_MS = 30 * 1000; // 30 seconds

  /**
   * Determine the current workstation's local network IPv4 address.
   */
  async getLocalIpv4(forceRefresh = false): Promise<string> {
    const now = Date.now();
    if (!forceRefresh && this.cachedIpv4 && now - this.lastFetchedAt < this.CACHE_TTL_MS) {
      return this.cachedIpv4;
    }

    if (this.isDetecting && this.cachedIpv4) {
      return this.cachedIpv4;
    }

    this.isDetecting = true;
    try {
      // 1. Try Tauri native socket resolution
      if (isTauri()) {
        try {
          const { invoke } = await import("@tauri-apps/api/tauri");
          const nativeIp = await invoke<string>("get_device_ipv4");
          if (nativeIp && isIpv4(nativeIp)) {
            this.cachedIpv4 = nativeIp.trim();
            this.lastFetchedAt = now;
            return this.cachedIpv4;
          }
        } catch (_) {}
      }

      // 2. Try WebRTC local ICE probe
      if (typeof window !== "undefined" && typeof RTCPeerConnection !== "undefined") {
        try {
          const pc = new RTCPeerConnection({ iceServers: [] });
          pc.createDataChannel("ipv4_probe");
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          const candidateIp = await new Promise<string | null>((resolve) => {
            const timeout = setTimeout(() => {
              pc.close();
              resolve(null);
            }, 1200);

            pc.onicecandidate = (e) => {
              if (!e || !e.candidate || !e.candidate.candidate) return;
              const cand = e.candidate.candidate;
              const match = cand.match(
                /\b(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})\b/
              );
              if (match) {
                clearTimeout(timeout);
                pc.close();
                resolve(match[1]);
              }
            };
          });

          if (candidateIp && isIpv4(candidateIp)) {
            this.cachedIpv4 = candidateIp;
            this.lastFetchedAt = now;
            return this.cachedIpv4;
          }
        } catch (_) {}
      }

      // 3. Check browser hostname if accessed directly via LAN IPv4
      if (typeof window !== "undefined" && window.location?.hostname) {
        const host = window.location.hostname;
        if (isIpv4(host) && host !== "0.0.0.0") {
          this.cachedIpv4 = host;
          this.lastFetchedAt = now;
          return this.cachedIpv4;
        }
      }

      // 4. Default fallback: loopback
      this.cachedIpv4 = "127.0.0.1";
      this.lastFetchedAt = now;
      return this.cachedIpv4;
    } finally {
      this.isDetecting = false;
    }
  }

  getCachedLocalIpv4(): string | null {
    return this.cachedIpv4;
  }
}

export const deviceIpService = new DeviceIpService();
