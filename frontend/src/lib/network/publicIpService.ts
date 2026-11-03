import { API_BASE_URL } from "../../config/env";

export class PublicIpService {
  private cachedIp: string | null = null;
  private isFetching = false;
  private lastFetchedAt = 0;
  private readonly CACHE_TTL_MS = 60 * 1000; // 1 minute

  /**
   * Determine the current device's public WAN IP address.
   * Tries central backend endpoint first, then falls back to public STUN/IP echo services.
   */
  async getPublicIp(forceRefresh = false): Promise<string | null> {
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") {
      return this.cachedIp;
    }

    const now = Date.now();
    if (!forceRefresh && this.cachedIp && now - this.lastFetchedAt < this.CACHE_TTL_MS) {
      return this.cachedIp;
    }

    if (this.isFetching) {
      return this.cachedIp;
    }

    this.isFetching = true;

    try {
      // 1. Try central backend /api/public-ip endpoint
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(`${API_BASE_URL}/api/public-ip`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        clearTimeout(timeout);

        if (res.ok) {
          const body = await res.json();
          if (body?.ip && !body.ip.startsWith("127.") && body.ip !== "::1") {
            this.cachedIp = String(body.ip).trim();
            this.lastFetchedAt = now;
            return this.cachedIp;
          }
        }
      } catch (_) {
        // Backend offline or unreachable
      }

      // 2. Fallback to public HTTPS IP echo service (ipify)
      if (typeof window !== "undefined" && navigator.onLine) {
        try {
          const ctrl = new AbortController();
          const timeout = setTimeout(() => ctrl.abort(), 3000);
          const res = await fetch("https://api.ipify.org?format=json", {
            signal: ctrl.signal,
          });
          clearTimeout(timeout);

          if (res.ok) {
            const data = await res.json();
            if (data?.ip) {
              this.cachedIp = String(data.ip).trim();
              this.lastFetchedAt = now;
              return this.cachedIp;
            }
          }
        } catch (_) {}
      }

      return this.cachedIp;
    } finally {
      this.isFetching = false;
    }
  }

  /**
   * Synchronously return last known cached IP.
   */
  getCachedIp(): string | null {
    return this.cachedIp;
  }
}

export const publicIpService = new PublicIpService();
