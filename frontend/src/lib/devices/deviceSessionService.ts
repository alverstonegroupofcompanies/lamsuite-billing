import { API_BASE_URL } from "../../config/env";
import { storeDeviceService } from "../auth/storeDeviceService";
import { storeRegistryService } from "../auth/storeRegistryService";
import { syncQueueService } from "../sync/syncQueueService";
import { staffAuthService } from "../auth/staffAuthService";
import { publicIpService } from "../network/publicIpService";
import { getOrCreateClientDeviceUuid, detectDeviceFriendlyName } from "../auth/clientDeviceIdentifier";

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
  store_id?: string | null;
  store_name?: string | null;
  store_code?: string | null;
  device_uuid?: string;
  device_name: string | null;
  counter_name: string | null;
  counter_code?: string | null;
  user_name: string | null;
  user_role: string | null;
  ip_address: string | null;
  public_ip?: string | null;
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
  store_id?: string;
}

export interface DeviceSessionResponseMetadata {
  caller_public_ip?: string | null;
  other_stores_active_count?: number;
  other_active_stores?: Array<{
    store_id: string;
    store_name?: string | null;
    store_code?: string | null;
    device_name?: string | null;
    counter_name?: string | null;
  }>;
}

export class DeviceSessionService {
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private cachedDevices: LoggedInDevice[] = [];
  private lastMetadata: DeviceSessionResponseMetadata = {};
  private listeners: Array<(devices: LoggedInDevice[]) => void> = [];

  getMetadata(): DeviceSessionResponseMetadata {
    return this.lastMetadata;
  }

  /**
   * Fetch real-time list of logged-in devices from the centralized backend server.
   */
  async getLoggedInDevices(options?: DeviceFilterOptions): Promise<LoggedInDevice[]> {
    const activeStore = storeRegistryService.getActiveStore();
    const profile = await storeDeviceService.getDeviceProfile().catch(() => null);
    const storeId = options?.store_id !== undefined ? options.store_id : (activeStore?.id || profile?.store_id || "1");

    const params = new URLSearchParams();
    if (storeId) params.set("store_id", String(storeId));
    if (options?.search) params.set("search", options.search);
    if (options?.status && options.status !== "all") params.set("status", options.status);
    const clientUuid = profile?.device_uuid || getOrCreateClientDeviceUuid();
    params.set("current_device_uuid", clientUuid);

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
          "X-Device-Uuid": clientUuid,
          ...(token ? { "X-Device-Token": token, Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to fetch logged-in devices`);
      }

      const data = await res.json();
      this.lastMetadata = {
        caller_public_ip: data.caller_public_ip || null,
        other_stores_active_count: data.other_stores_active_count || 0,
        other_active_stores: Array.isArray(data.other_active_stores) ? data.other_active_stores : [],
      };

      if (Array.isArray(data.devices)) {
        this.cachedDevices = data.devices.map((d: any) => ({
          ...d,
          public_ip: d.public_ip || (d.is_this_device && data.caller_public_ip ? data.caller_public_ip : null),
          is_this_device: Boolean(d.is_this_device || (clientUuid && d.device_uuid === clientUuid)),
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

      const publicIp = await publicIpService.getPublicIp().catch(() => null);

      if (profile) {
        const fallback: LoggedInDevice = {
          id: profile.device_id || "local_dev_1",
          device_uuid: profile.device_uuid,
          device_name: profile.device_name || "This Workstation",
          counter_name: profile.counter_name || "Counter 1",
          counter_code: profile.counter_code || "C01",
          store_id: profile.store_id || "1",
          store_name: profile.store_name || "Main Store",
          store_code: profile.store_code || "STORE-01",
          user_name: staffAuthService.getCurrentSession()?.user.full_name || "Cashier",
          user_role: staffAuthService.getCurrentSession()?.user.role || "Admin",
          ip_address: "127.0.0.1",
          public_ip: publicIp,
          location: profile.location_name || null,
          login_time: new Date(profile.registered_at || Date.now()).toISOString(),
          sign_in_time: new Date(profile.registered_at || Date.now()).toISOString(),
          last_active: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          app_version: "2.0.29",
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
    store_id?: string | number;
    update_status?: string;
    update_error?: string;
    last_error?: string;
  }): Promise<boolean> {
    try {
      const profile = await storeDeviceService.getDeviceProfile().catch(() => null);
      const activeStore = storeRegistryService.getActiveStore();
      const deviceUuid = profile?.device_uuid || getOrCreateClientDeviceUuid();
      const storeId = params?.store_id || activeStore?.id || profile?.store_id || "1";

      let unsynced = params?.unsynced_items_count;
      if (unsynced === undefined) {
        const pending = await syncQueueService.getPendingItems().catch(() => []);
        unsynced = pending.length;
      }

      const staff = staffAuthService.getCurrentSession();
      const userRole = staff?.user.role === "admin" ? "Store Admin" : (staff?.user.role || "Cashier");
      const publicIp = await publicIpService.getPublicIp().catch(() => null);

      const res = await fetch(`${API_BASE_URL}/api/device-sessions/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Device-Uuid": deviceUuid,
          ...(profile?.device_token ? { "X-Device-Token": profile.device_token } : {}),
        },
        body: JSON.stringify({
          device_uuid: deviceUuid,
          device_name: profile?.device_name || detectDeviceFriendlyName(),
          counter_name: profile?.counter_name || "Counter 01",
          app_version: params?.app_version || "2.0.29",
          unsynced_items_count: unsynced,
          status: params?.status || "Active",
          user_role: userRole,
          store_id: storeId,
          public_ip: publicIp || undefined,
          update_status: params?.update_status,
          update_error: params?.update_error,
          last_error: params?.last_error,
        }),
      });

      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Report update failure details to the admin panel device status.
   */
  async reportUpdateFailure(failingUrl: string, statusCode: number | string = 404, rawError?: string): Promise<boolean> {
    const errorText = `Download failed (${statusCode}): ${failingUrl}`;
    console.error(`[DeviceSession] Reporting updater failure: ${errorText}`);
    return this.sendHeartbeat({
      update_status: "Update Download Failed",
      update_error: errorText,
      last_error: rawError || errorText,
    });
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
