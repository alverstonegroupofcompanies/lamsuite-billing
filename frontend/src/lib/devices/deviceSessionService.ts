import { API_BASE_URL } from "../../config/env";
import { storeDeviceService } from "../auth/storeDeviceService";
import { storeRegistryService } from "../auth/storeRegistryService";

export interface LoggedInDevice {
  id: string;
  session_id?: string;
  device_uuid?: string;
  device_name: string | null;
  counter_name: string | null;
  counter_code: string | null;
  ip_address: string | null;
  location: string | null;
  login_time: string | null;
  last_active: string | null;
  status: "Online" | "Offline" | "Session Expired";
  is_active: boolean;
  user_name?: string | null;
}

export interface DeviceFilterOptions {
  search?: string;
  status?: string;
}

export class DeviceSessionService {
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private cachedDevices: LoggedInDevice[] = [];
  private listeners: Array<(devices: LoggedInDevice[]) => void> = [];

  /**
   * Fetch real-time list of logged-in devices from the centralized backend server.
   */
  async getLoggedInDevices(options?: DeviceFilterOptions): Promise<LoggedInDevice[]> {
    const activeStore = storeRegistryService.getActiveStore();
    const profile = await storeDeviceService.getDeviceProfile().catch(() => null);
    const storeId = activeStore?.id || profile?.store_id || "1";

    const params = new URLSearchParams();
    params.set("store_id", String(storeId));
    if (options?.search) params.set("search", options.search);
    if (options?.status && options.status !== "all") params.set("status", options.status);

    const url = `${API_BASE_URL}/api/devices/logged-in?${params.toString()}`;

    try {
      const token =
        profile?.device_token ||
        (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function"
          ? localStorage.getItem("staff_token")
          : null);
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(token ? { "X-Device-Token": token } : {}),
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to fetch logged-in devices`);
      }

      const data = await res.json();
      if (Array.isArray(data.devices)) {
        this.cachedDevices = data.devices;
        this.notify();
        return this.cachedDevices;
      }
      return [];
    } catch (err) {
      // If server unreachable, return local active terminal representation if available
      if (this.cachedDevices.length > 0) {
        return this.filterLocally(this.cachedDevices, options);
      }

      if (profile) {
        const fallback: LoggedInDevice = {
          id: profile.device_id || "local_dev_1",
          device_uuid: profile.device_uuid,
          device_name: profile.device_name || null,
          counter_name: profile.counter_name || null,
          counter_code: profile.counter_code || null,
          ip_address: null,
          location: profile.location_name || null,
          login_time: new Date(profile.registered_at || Date.now()).toISOString(),
          last_active: new Date().toISOString(),
          status: "Online",
          is_active: true,
        };
        return [fallback];
      }

      return [];
    }
  }

  /**
   * Send heartbeat to server to maintain Online status.
   */
  async sendHeartbeat(): Promise<boolean> {
    try {
      const profile = await storeDeviceService.getDeviceProfile().catch(() => null);
      if (!profile || !profile.device_uuid) return false;

      const res = await fetch(`${API_BASE_URL}/api/devices/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(profile.device_token ? { "X-Device-Token": profile.device_token } : {}),
        },
        body: JSON.stringify({
          device_uuid: profile.device_uuid,
          device_name: profile.device_name || undefined,
          counter_name: profile.counter_name || undefined,
          store_id: profile.store_id,
        }),
      });

      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Notify server of device/cashier logout.
   */
  async notifyLogout(): Promise<boolean> {
    try {
      const profile = await storeDeviceService.getDeviceProfile().catch(() => null);
      if (!profile || !profile.device_uuid) return false;

      const res = await fetch(`${API_BASE_URL}/api/devices/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          device_uuid: profile.device_uuid,
        }),
      });

      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Remotely expire / revoke a device session.
   */
  async expireDeviceSession(sessionId: string): Promise<boolean> {
    try {
      const profile = await storeDeviceService.getDeviceProfile().catch(() => null);
      const res = await fetch(`${API_BASE_URL}/api/devices/sessions/${sessionId}/expire`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(profile?.device_token ? { "X-Device-Token": profile.device_token } : {}),
        },
      });

      if (res.ok) {
        // Refresh local cache
        await this.getLoggedInDevices();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Start recurring heartbeat timer (every 45 seconds while application is active).
   */
  startHeartbeatTimer(intervalMs = 45000): () => void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Immediate first ping
    this.sendHeartbeat().catch(() => {});

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat().catch(() => {});
    }, intervalMs);

    return () => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
    };
  }

  subscribe(listener: (devices: LoggedInDevice[]) => void): () => void {
    this.listeners.push(listener);
    listener(this.cachedDevices);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.cachedDevices);
      } catch (_) {}
    }
  }

  private filterLocally(devices: LoggedInDevice[], options?: DeviceFilterOptions): LoggedInDevice[] {
    let result = devices;
    if (options?.status && options.status !== "all") {
      result = result.filter((d) => d.status.toLowerCase() === options.status?.toLowerCase());
    }
    if (options?.search) {
      const s = options.search.toLowerCase();
      result = result.filter(
        (d) =>
          d.device_name?.toLowerCase().includes(s) ||
          d.counter_name?.toLowerCase().includes(s) ||
          d.counter_code?.toLowerCase().includes(s) ||
          d.ip_address?.toLowerCase().includes(s) ||
          d.location?.toLowerCase().includes(s)
      );
    }
    return result;
  }
}

export const deviceSessionService = new DeviceSessionService();
