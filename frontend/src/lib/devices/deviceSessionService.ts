import { API_BASE_URL } from "../../config/env";
import { storeDeviceService } from "../auth/storeDeviceService";
import { storeRegistryService } from "../auth/storeRegistryService";
import { syncQueueService } from "../sync/syncQueueService";
import { staffAuthService } from "../auth/staffAuthService";

function getStoredToken(): string | null {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
      return localStorage.getItem("staff_token");
    }
  } catch (_) {}
  return null;
}

export type DeviceStatus = "Active" | "Idle" | "Offline" | "Locked" | "Revoked";

export interface LoggedInDevice {
  id: string;
  session_id?: string;
  device_uuid?: string;
  device_name: string | null;
  counter_name: string | null;
  counter_code?: string | null;
  user_name: string | null;
  user_role: string | null;
  ip_address: string | null;
  location: string | null;
  status: DeviceStatus;
  sign_in_time: string | null;
  login_time?: string | null;
  last_seen: string | null;
  last_active?: string | null;
  app_version: string;
  unsynced_items_count: number;
  is_this_device: boolean;
  is_active: boolean;
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
    if (profile?.device_uuid) params.set("current_device_uuid", profile.device_uuid);

    const url = `${API_BASE_URL}/api/device-sessions?${params.toString()}`;

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
          ...(profile?.device_uuid ? { "X-Device-Uuid": profile.device_uuid } : {}),
          ...(token ? { "X-Device-Token": token, Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to fetch logged-in devices`);
      }

      const data = await res.json();
      if (Array.isArray(data.devices)) {
        this.cachedDevices = data.devices.map((d: any) => ({
          ...d,
          is_this_device: Boolean(d.is_this_device || (profile?.device_uuid && d.device_uuid === profile.device_uuid)),
          status: (["Active", "Idle", "Offline", "Locked", "Revoked"].includes(d.status) ? d.status : "Offline") as DeviceStatus,
          sign_in_time: d.sign_in_time || d.login_time || null,
          last_seen: d.last_seen || d.last_active || null,
          unsynced_items_count: Number(d.unsynced_items_count) || 0,
        }));
        this.notify();
        return this.cachedDevices;
      }
      return [];
    } catch (err) {
      if (this.cachedDevices.length > 0) {
        return this.filterLocally(this.cachedDevices, options);
      }

      if (profile) {
        const fallback: LoggedInDevice = {
          id: profile.device_id || "local_dev_1",
          device_uuid: profile.device_uuid,
          device_name: profile.device_name || "This Workstation",
          counter_name: profile.counter_name || "Counter 1",
          counter_code: profile.counter_code || "C01",
          user_name: staffAuthService.getCurrentSession()?.user.full_name || "Cashier",
          user_role: staffAuthService.getCurrentSession()?.user.role || "Admin",
          ip_address: "127.0.0.1",
          location: profile.location_name || null,
          login_time: new Date(profile.registered_at || Date.now()).toISOString(),
          sign_in_time: new Date(profile.registered_at || Date.now()).toISOString(),
          last_active: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          app_version: "2.0.19",
          unsynced_items_count: 0,
          is_this_device: true,
          status: "Active",
          is_active: true,
        };
        return [fallback];
      }

      return [];
    }
  }

  /**
   * Send heartbeat to server to maintain real-time status.
   */
  async sendHeartbeat(params?: {
    app_version?: string;
    unsynced_items_count?: number;
    status?: "Active" | "Idle" | "Locked";
  }): Promise<boolean> {
    try {
      const profile = await storeDeviceService.getDeviceProfile().catch(() => null);
      if (!profile || !profile.device_uuid) return false;

      let unsynced = params?.unsynced_items_count;
      if (unsynced === undefined) {
        const pending = await syncQueueService.getPendingItems().catch(() => []);
        unsynced = pending.length;
      }

      const staff = staffAuthService.getCurrentSession();
      const userRole = staff?.user.role === "admin" ? "Store Admin" : (staff?.user.role || "Cashier");

      const res = await fetch(`${API_BASE_URL}/api/device-sessions/heartbeat`, {
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
          app_version: params?.app_version || "2.0.19",
          unsynced_items_count: unsynced,
          status: params?.status || "Active",
          user_role: userRole,
          store_id: profile.store_id,
        }),
      });

      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Rename a counter or workstation.
   */
  async renameDevice(id: string, newNames: { counter_name?: string; device_name?: string }): Promise<boolean> {
    try {
      const token = getStoredToken();
      const res = await fetch(`${API_BASE_URL}/api/device-sessions/${id}/rename`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(newNames),
      });

      if (res.ok) {
        await this.getLoggedInDevices();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Lock a workstation session.
   */
  async lockDevice(id: string): Promise<boolean> {
    try {
      const token = getStoredToken();
      const res = await fetch(`${API_BASE_URL}/api/device-sessions/${id}/lock`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (res.ok) {
        await this.getLoggedInDevices();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Unlock a workstation session.
   */
  async unlockDevice(id: string): Promise<boolean> {
    try {
      const token = getStoredToken();
      const res = await fetch(`${API_BASE_URL}/api/device-sessions/${id}/unlock`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (res.ok) {
        await this.getLoggedInDevices();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Revoke a counter / device authorization permanently.
   */
  async revokeDevice(id: string, reason?: string): Promise<boolean> {
    try {
      const token = getStoredToken();
      const res = await fetch(`${API_BASE_URL}/api/device-sessions/${id}/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ reason: reason || "Revoked by admin" }),
      });

      if (res.ok) {
        await this.getLoggedInDevices();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Remotely expire / force log out a device session.
   */
  async forceLogout(id: string): Promise<boolean> {
    try {
      const token = getStoredToken();
      const res = await fetch(`${API_BASE_URL}/api/device-sessions/${id}/force-logout`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (res.ok) {
        await this.getLoggedInDevices();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Backwards compatible expireSession.
   */
  async expireDeviceSession(sessionId: string): Promise<boolean> {
    return this.forceLogout(sessionId);
  }

  /**
   * Notify server of device/cashier logout.
   */
  async notifyLogout(): Promise<boolean> {
    try {
      const profile = await storeDeviceService.getDeviceProfile().catch(() => null);
      if (!profile || !profile.device_uuid) return false;

      const res = await fetch(`${API_BASE_URL}/api/device-sessions/logout`, {
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
   * Start recurring heartbeat timer (every 30 seconds while application is active).
   */
  startHeartbeatTimer(intervalMs = 30000): () => void {
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
          d.user_name?.toLowerCase().includes(s) ||
          d.user_role?.toLowerCase().includes(s) ||
          d.ip_address?.toLowerCase().includes(s) ||
          d.location?.toLowerCase().includes(s)
      );
    }
    return result;
  }
}

export const deviceSessionService = new DeviceSessionService();
