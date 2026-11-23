import { API_BASE_URL } from "../../config/env";
import { APP_VERSION } from "../../config/version";
import { storeDeviceService } from "../auth/storeDeviceService";
import { storeRegistryService } from "../auth/storeRegistryService";
import { syncQueueService } from "../sync/syncQueueService";
import { counterLockingService } from "../auth/counterLockingService";
import { counterSessionService } from "../auth/counterSessionService";
import { handleDeviceAuthFailure, isDeviceAuthFailure } from "../auth/deviceAuthFailure";
import { publicIpService } from "../network/publicIpService";
import { deviceIpService, formatIpv4 } from "../network/deviceIpService";
import { getOrCreateClientDeviceUuid, detectDeviceFriendlyName } from "../auth/clientDeviceIdentifier";

/**
 * Local registry ids look like "store_main"; the server only knows numeric ids
 * and store codes. Passing a local key makes the backend reject the request as
 * an unknown store, so those keys are never sent.
 */
function isServerStoreKey(value?: string | null): value is string {
  if (!value) return false;
  const v = String(value).trim();
  return v !== "" && !/^store_/i.test(v);
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
  device_ipv4?: string | null;
  public_ip?: string | null;
  location: string | null;
  status: DeviceStatus;
  sign_in_time: string | null;
  login_time?: string | null;
  last_seen: string | null;
  last_active?: string | null;
  app_version: string | null;
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
  private cachedStoreId: string | null = null;
  private lastMetadata: DeviceSessionResponseMetadata = {};
  private lastError: string | null = null;
  private listeners: Array<(devices: LoggedInDevice[]) => void> = [];

  getMetadata(): DeviceSessionResponseMetadata {
    return this.lastMetadata;
  }

  /**
   * Error from the most recent roster fetch, if it failed. Null means the last
   * fetch succeeded; an empty roster is then a genuine "nobody is signed in".
   */
  getLastError(): string | null {
    return this.lastError;
  }

  clearCache(): void {
    this.cachedDevices = [];
    this.cachedStoreId = null;
    this.lastMetadata = {};
    this.notify();
  }

  /**
   * Fetch real-time list of logged-in devices from the centralized backend server.
   */
  async getLoggedInDevices(options?: DeviceFilterOptions): Promise<LoggedInDevice[]> {
    const activeStore = storeRegistryService.getActiveStore();
    const profile = await storeDeviceService.getDeviceProfile().catch(() => null);
    // The paired profile is the tenant authority. The registry id is only a
    // fallback and is skipped when it is a local "store_*" key the server
    // cannot resolve.
    const storeId = options?.store_id !== undefined
      ? options.store_id
      : (isServerStoreKey(profile?.store_id)
          ? profile!.store_id
          : (isServerStoreKey(activeStore?.id) ? activeStore!.id : null));

    const params = new URLSearchParams();
    if (storeId) params.set("store_id", String(storeId));
    if (options?.search) params.set("search", options.search);
    if (options?.status && options.status !== "all") params.set("status", options.status);
    const clientUuid = profile?.device_uuid || getOrCreateClientDeviceUuid();
    params.set("current_device_uuid", clientUuid);

    const url = `${API_BASE_URL}/api/device-sessions?${params.toString()}`;

    try {
      // B8b: the roster is read by the counter that owns this store, so the
      // device token is the only credential the request carries.
      const deviceHeaders = await storeDeviceService.getDeviceAuthHeaders();

      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...deviceHeaders,
        },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        throw new Error(body?.message || `HTTP ${res.status}: Failed to fetch logged-in devices`);
      }

      const data = await res.json();
      this.lastError = null;
      this.lastMetadata = {
        caller_public_ip: data.caller_public_ip || null,
        other_stores_active_count: data.other_stores_active_count || 0,
        other_active_stores: Array.isArray(data.other_active_stores) ? data.other_active_stores : [],
      };

      if (Array.isArray(data.devices)) {
        const localIpv4 = await deviceIpService.getLocalIpv4().catch(() => "127.0.0.1");
        this.cachedDevices = data.devices.map((d: any) => {
          const isThis = Boolean(d.is_this_device || (clientUuid && d.device_uuid === clientUuid));
          const cleanIpv4 = formatIpv4(
            d.device_ipv4 || d.ip_address || (isThis ? localIpv4 : null),
            isThis ? localIpv4 : (d.ip_address ? formatIpv4(d.ip_address, d.ip_address) : "127.0.0.1")
          );
          return {
            ...d,
            ip_address: d.ip_address ? formatIpv4(d.ip_address, d.ip_address) : (isThis ? localIpv4 : null),
            device_ipv4: cleanIpv4,
            public_ip: d.public_ip || (isThis && data.caller_public_ip ? data.caller_public_ip : null),
            is_this_device: isThis,
            status: (["Active", "Idle", "Offline", "Locked", "Revoked"].includes(d.status) ? d.status : "Offline") as DeviceStatus,
            sign_in_time: d.sign_in_time || d.login_time || null,
            last_seen: d.last_seen || d.last_active || null,
            unsynced_items_count: Number(d.unsynced_items_count) || 0,
          };
        });
        this.cachedStoreId = storeId ? String(storeId) : null;
        this.notify();
        return this.cachedDevices;
      }
      return [];
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : "Failed to reach the server";
      if (this.cachedDevices.length > 0 && this.cachedStoreId === (storeId ? String(storeId) : null)) {
        return this.filterLocally(this.cachedDevices, options);
      }

      // No fabricated "this device" row: presence is server-owned. With no
      // reachable server and no cache the roster is simply unknown.
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
      const storeId = params?.store_id
        || (isServerStoreKey(profile?.store_id) ? profile!.store_id : null)
        || (isServerStoreKey(activeStore?.id) ? activeStore!.id : null)
        || undefined;

      let unsynced = params?.unsynced_items_count;
      if (unsynced === undefined) {
        const pending = await syncQueueService.getPendingItems().catch(() => []);
        unsynced = pending.length;
      }

      const publicIp = await publicIpService.getPublicIp().catch(() => null);
      const localIpv4 = await deviceIpService.getLocalIpv4().catch(() => null);

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
          counter_name: profile?.counter_name || undefined,
          counter_id: profile?.counter_id || undefined,
          counter_code: profile?.counter_code || undefined,
          app_version: params?.app_version || APP_VERSION,
          unsynced_items_count: unsynced,
          status: params?.status || "Active",
          store_id: storeId,
          public_ip: publicIp || undefined,
          device_ipv4: localIpv4 || undefined,
          update_status: params?.update_status,
          update_error: params?.update_error,
          last_error: params?.last_error,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.action === "lock_and_reset" || body.status === "revoked") {
          await storeDeviceService.lockAndResetWorkstation(Boolean(body.wipe_on_revocation));
          return false;
        }
        if (body.force_logged_out || body.action === "sign_in_required" || body.error === "SESSION_NOT_ESTABLISHED") {
          // B8b: there is no operator session to end here. What the server just
          // stopped trusting is this counter, so the till locks and waits for the
          // counter PIN rather than going on working unauthorised.
          counterLockingService.lock();
          return false;
        }
        // SYNC-02: a refused device credential is a revocation, not a bad
        // connection. The authority that tells a suspended store from a retired
        // counter decides; a 5xx never reaches here.
        if (isDeviceAuthFailure(res.status, body)) {
          await handleDeviceAuthFailure();
        }
        return false;
      }

      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body && body.store_active !== undefined) {
          const isActive = Boolean(body.store_active);
          const currentStore = storeRegistryService.getActiveStore();
          if (currentStore && currentStore.is_active !== isActive) {
            await storeRegistryService.setStoreActiveStatus(currentStore.id, isActive);
            const { companySettingsService } = await import("../settings/companySettingsService");
            await companySettingsService.updateLocalFromRemote({ is_active: isActive });
          }
        }
        if (body && body.last_reset_at) {
          const currentStore = storeRegistryService.getActiveStore();
          const storeId = String(body.store_id || currentStore?.id || "");
          await storeRegistryService.applyRemoteResetOnce(
            storeId,
            body.last_reset_at,
            body.last_reset_options || undefined
          );
        }
        // PRF-004: the beat already carries the counter's watermark, so an owner
        // who just changed the surface is answered on the next beat instead of
        // waiting on the watch. The beat stays silent when the numbers agree.
        await counterSessionService.alignToVersion(body?.permission_profile_version);
        return true;
      }

      return false;
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
      const deviceHeaders = await storeDeviceService.getDeviceAuthHeaders();
      const res = await fetch(`${API_BASE_URL}/api/device-sessions/${id}/rename`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...deviceHeaders,
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
      const deviceHeaders = await storeDeviceService.getDeviceAuthHeaders();
      const res = await fetch(`${API_BASE_URL}/api/device-sessions/${id}/lock`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...deviceHeaders,
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
      const deviceHeaders = await storeDeviceService.getDeviceAuthHeaders();
      const res = await fetch(`${API_BASE_URL}/api/device-sessions/${id}/unlock`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...deviceHeaders,
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
      const deviceHeaders = await storeDeviceService.getDeviceAuthHeaders();
      const res = await fetch(`${API_BASE_URL}/api/device-sessions/${id}/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...deviceHeaders,
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
      const deviceHeaders = await storeDeviceService.getDeviceAuthHeaders();
      const res = await fetch(`${API_BASE_URL}/api/device-sessions/${id}/force-logout`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...deviceHeaders,
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

    // B8b: presence belongs to the claimed counter, not to a signed-in operator.
    // An unclaimed terminal still has no counter to report, and must not hammer
    // the heartbeat endpoint with SESSION_NOT_ESTABLISHED 409s.
    const beat = () => {
      storeDeviceService
        .getDeviceProfile()
        .then((profile) => {
          if (profile?.counter_id) this.sendHeartbeat().catch(() => {});
        })
        .catch(() => {});
    };

    // Immediate first ping
    beat();

    this.heartbeatInterval = setInterval(beat, intervalMs);

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
