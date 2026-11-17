import { sqliteStorage } from "../db/sqliteStorage";
import { staffCryptoService } from "./staffCryptoService";
import { storeDeviceService } from "./storeDeviceService";
import { deviceSessionService } from "../devices/deviceSessionService";
import { API_BASE_URL } from "../../config/env";
import { getOrCreateClientDeviceUuid, detectDeviceFriendlyName } from "./clientDeviceIdentifier";
import { publicIpService } from "../network/publicIpService";
import { validatePassword, validatePin } from "./credentialPolicy";
import { decryptStaffSecret, encryptStaffSecret } from "./offlineStaffVault";
import {
  canAccessMenu as canAccessMenuForSubject,
  hasModulePermission,
  type PermissionSet,
} from "./accessControl";

export interface StaffUser {
  id: string;
  store_id: string;
  username: string;
  full_name: string;
  role: "admin" | "manager" | "pharmacist" | "cashier";
  password_hash: string;
  pin_hash: string;
  is_active: boolean;
  must_change_password: boolean;
  biometric_registered: boolean;
  failed_attempts: number;
  locked_until: number | null;
  permissions: PermissionSet;
  enabled_menus?: string[];
}

export interface ActiveStaffSession {
  sessionId: string;
  counterId: string;
  counterName: string;
  counterCode: string;
  user: StaffUser;
  authenticatedAt: number;
  isLocked: boolean;
  lastActivityAt: number;
}

export interface StaffSessionConflict {
  activeSession?: {
    id: string;
    device_uuid?: string | null;
    device_name?: string | null;
    counter_id?: string | null;
    counter_name?: string | null;
    last_active_at?: string | null;
  };
  canForceOut: boolean;
}

export interface StaffAuthResult {
  success: boolean;
  error?: string;
  mustChangePassword?: boolean;
  user?: StaffUser;
  conflict?: StaffSessionConflict;
}

export interface StaffAuthOptions {
  forceOut?: boolean;
}

const isNumericId = (val: string) => /^\d+$/.test(val);

const OFFLINE_SYNC_STORAGE_KEY = "lamsuite_staff_offline_sync_at";
const DEFAULT_OFFLINE_GRACE_HOURS = 72;

export class StaffAuthService {
  private currentSession: ActiveStaffSession | null = null;
  private maxFailedAttempts = 5;
  private lockoutDurationMs = 15 * 60 * 1000; // 15 mins
  private idleTimeoutMs = 5 * 60 * 1000; // 5 mins default
  private offlineGraceHours = DEFAULT_OFFLINE_GRACE_HOURS;
  private sessionListeners: Array<(session: ActiveStaffSession | null) => void> = [];

  constructor() {
    try {
      if (typeof localStorage !== "undefined") {
        const saved = localStorage.getItem("active_staff_session");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.sessionId && parsed.user) {
            // Legacy sessions were stored with a ["*"] wildcard for every role.
            // Drop it for non-admins so role baselines apply after this upgrade.
            const legacyWildcard =
              Array.isArray(parsed.user.permissions) &&
              parsed.user.permissions.length === 1 &&
              parsed.user.permissions[0] === "*" &&
              parsed.user.role !== "super_admin";
            if (legacyWildcard) {
              parsed.user.permissions = null;
              localStorage.setItem("active_staff_session", JSON.stringify(parsed));
            }
            this.currentSession = parsed;
          }
        }
      }
    } catch (_) {}
  }

  async cleanupSyntheticDemoUsers(): Promise<void> {
    if (typeof process !== "undefined" && process.env.NODE_ENV === "test") {
      return;
    }
    try {
      const all = await sqliteStorage.findAll<any>("staff_users");
      for (const u of all || []) {
        if (
          u.full_name?.includes("Rahul Verma") ||
          u.full_name?.includes("Ananya Nair") ||
          u.full_name?.includes("Naveen Raj") ||
          u.full_name?.includes("Reshma Pillai") ||
          u.full_name?.includes("Deepak Nair") ||
          u.full_name?.includes("Arun Kumar")
        ) {
          await sqliteStorage.deleteRecord("staff_users", u.id);
        }
      }
    } catch (_) {}
  }

  async syncStaffFromBackend(storeId?: string): Promise<StaffUser[]> {
    if (typeof process !== "undefined" && process.env.NODE_ENV === "test") {
      return [];
    }
    const activeStore = String(storeId || (await storeDeviceService.getDeviceProfile())?.store_id || "1");
    try {
      const deviceHeaders = await storeDeviceService.getDeviceAuthHeaders();
      const res = await fetch(`${API_BASE_URL}/api/staff/offline-cache?store_id=${activeStore}`, {
        headers: { Accept: "application/json", ...deviceHeaders },
      });
      if (res.ok) {
        const body = await res.json();
        if (body.success && Array.isArray(body.staff)) {
          const currentLocal = (await sqliteStorage.findAll<any>("staff_users")) || [];
          const localById = new Map<string, any>();
          const localByUsername = new Map<string, any>();
          for (const u of currentLocal) {
            localById.set(String(u.id), u);
            localByUsername.set(String(u.username).toLowerCase(), u);
          }

          const consumedLocalIds = new Set<string>();
          const incomingIds = new Set<string>();
          const incomingUsernames = new Set<string>();
          const syncedStaff: StaffUser[] = [];

          for (const s of body.staff) {
            const serverId = String(s.id);
            const username = String(s.username || "");
            const local = localById.get(serverId) || localByUsername.get(username.toLowerCase());
            if (local) consumedLocalIds.add(String(local.id));

            const cachedPassword = local?.password_hash ? await decryptStaffSecret(local.password_hash) : "";
            const cachedPin = local?.pin_hash ? await decryptStaffSecret(local.pin_hash) : "";

            const passwordHash = s.password_hash || cachedPassword;
            const pinHash = s.pin_hash || (s.has_pin === false ? "" : cachedPin);

            const userRecord = {
              id: serverId,
              store_id: String(s.store_id || activeStore),
              username,
              full_name: s.full_name,
              role: s.role,
              password_hash: await encryptStaffSecret(passwordHash),
              pin_hash: await encryptStaffSecret(pinHash),
              is_active: s.is_active ? 1 : 0,
              must_change_password: s.must_change_password ? 1 : 0,
              biometric_registered: s.biometric_registered ? 1 : 0,
              failed_attempts: s.failed_attempts || 0,
              locked_until: s.locked_until,
              permissions_json: s.permissions ? JSON.stringify(s.permissions) : null,
              enabled_menus_json: JSON.stringify(s.enabled_menus || ["pos", "bills"]),
              cache_synced_at: Date.now(),
              updated_at: Date.now(),
            };
            await sqliteStorage.insertRecord("staff_users", userRecord.id, userRecord);

            incomingIds.add(serverId);
            incomingUsernames.add(username.toLowerCase());
            syncedStaff.push({
              id: serverId,
              store_id: userRecord.store_id,
              username,
              full_name: s.full_name,
              role: s.role,
              password_hash: passwordHash,
              pin_hash: pinHash,
              is_active: Boolean(s.is_active),
              must_change_password: Boolean(s.must_change_password),
              biometric_registered: Boolean(s.biometric_registered),
              failed_attempts: s.failed_attempts || 0,
              locked_until: s.locked_until,
              permissions: s.permissions || null,
              enabled_menus: s.enabled_menus || ["pos", "bills"],
            });
          }

          // Users removed or revoked at the cloud are removed locally too.
          for (const u of currentLocal) {
            if (String(u.store_id) !== activeStore) continue;
            if (consumedLocalIds.has(String(u.id))) continue;
            if (incomingIds.has(String(u.id)) || incomingUsernames.has(String(u.username).toLowerCase())) continue;
            await sqliteStorage.deleteRecord("staff_users", u.id).catch(() => {});
          }

          this.setOfflineCacheSyncedAt(activeStore);
          this.flushOfflineAudit().catch(() => {});
          return syncedStaff;
        }
      }
    } catch (_) {
      // Cloud unreachable: fallback to local cache
    }
    return [];
  }

  setMaxFailedAttempts(maxFailedAttempts: number): void {
    if (Number.isFinite(maxFailedAttempts) && maxFailedAttempts > 0) {
      this.maxFailedAttempts = Math.trunc(maxFailedAttempts);
    }
  }

  setOfflineGraceHours(hours: number): void {
    if (Number.isFinite(hours) && hours >= 0) {
      this.offlineGraceHours = hours;
    }
  }

  getOfflineGraceHours(): number {
    return this.offlineGraceHours;
  }

  private setOfflineCacheSyncedAt(storeId: string): void {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(`${OFFLINE_SYNC_STORAGE_KEY}_${storeId}`, String(Date.now()));
    } catch {
      // Storage unavailable
    }
  }

  getOfflineCacheSyncedAt(storeId: string): number | null {
    try {
      if (typeof localStorage === "undefined") return null;
      const raw = localStorage.getItem(`${OFFLINE_SYNC_STORAGE_KEY}_${storeId}`);
      const parsed = raw ? Number(raw) : NaN;
      return Number.isFinite(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private offlineCacheExpired(storeId: string): boolean {
    if (this.offlineGraceHours <= 0) return false;
    const syncedAt = this.getOfflineCacheSyncedAt(storeId);
    if (!syncedAt) return false;
    return Date.now() - syncedAt > this.offlineGraceHours * 60 * 60 * 1000;
  }

  private static readonly OFFLINE_EXPIRED_MESSAGE =
    "Offline sign-in has expired. Connect this workstation to the internet to refresh staff credentials, then try again.";

  onSessionChange(listener: (session: ActiveStaffSession | null) => void): () => void {
    this.sessionListeners.push(listener);
    return () => {
      this.sessionListeners = this.sessionListeners.filter((l) => l !== listener);
    };
  }

  private notifySessionChange() {
    for (const listener of this.sessionListeners) {
      listener(this.currentSession ? { ...this.currentSession } : null);
    }
  }

  getCurrentSession(): ActiveStaffSession | null {
    return this.currentSession ? { ...this.currentSession } : null;
  }

  setIdleTimeoutMinutes(minutes: number) {
    this.idleTimeoutMs = Math.max(1, minutes) * 60 * 1000;
  }

  getIdleTimeoutMs(): number {
    return this.idleTimeoutMs;
  }

  async listActiveStaff(
    storeId?: string,
    storeMeta?: { name?: string; code?: string; alias?: string }
  ): Promise<StaffUser[]> {
    await this.cleanupSyntheticDemoUsers();
    const activeStore = String(storeId || (await storeDeviceService.getDeviceProfile())?.store_id || "1");

    // 1. ONLINE FIRST: Attempt to sync real staff users from backend
    try {
      const remoteStaff = await this.syncStaffFromBackend(activeStore);
      if (remoteStaff.length > 0) {
        return remoteStaff;
      }
    } catch (_) {}

    // 2. Fallback to local offline cache
    let raw = await sqliteStorage.findAll<any>("staff_users");
    let storeMatching = (raw || []).filter(
      (u) => Boolean(u.is_active) && (String(u.store_id) === activeStore || (activeStore === "1" && u.store_id === "store_main"))
    );

    return Promise.all(
      storeMatching.map(async (u) => ({
        id: u.id,
        store_id: u.store_id,
        username: u.username,
        full_name: u.full_name,
        role: u.role,
        password_hash: u.password_hash ? await decryptStaffSecret(u.password_hash) : "",
        pin_hash: u.pin_hash ? await decryptStaffSecret(u.pin_hash) : "",
        is_active: Boolean(u.is_active),
        must_change_password: Boolean(u.must_change_password),
        biometric_registered: Boolean(u.biometric_registered),
        failed_attempts: Number(u.failed_attempts || 0),
        locked_until: u.locked_until ? Number(u.locked_until) : null,
        permissions: this.parseCachedPermissions(u.permissions_json, u.role),
        enabled_menus: u.enabled_menus_json ? JSON.parse(u.enabled_menus_json) : [],
      }))
    );
  }

  /**
   * Older builds cached a ["*"] wildcard for every role. Drop it for non-admins
   * so the role baseline (and any new override) is what actually applies.
   */
  private parseCachedPermissions(raw: unknown, role: unknown): PermissionSet {
    let parsed: PermissionSet = null;
    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) : ((raw as PermissionSet) ?? null);
    } catch (_) {
      return null;
    }
    if (
      Array.isArray(parsed) &&
      parsed.length === 1 &&
      parsed[0] === "*" &&
      String(role || "") !== "super_admin"
    ) {
      return null;
    }
    return parsed;
  }

  async authenticateWithPin(
    usernameOrId: string,
    pin: string,
    options?: StaffAuthOptions
  ): Promise<StaffAuthResult> {
    const profile = await storeDeviceService.getDeviceProfile();
    const activeStore = profile?.store_id || "1";
    const localUser = await this.findStaff(usernameOrId);

    // 1. ONLINE FIRST: Authenticate with Cloud Backend API if in browser and online (skip in unit test runner)
    if (typeof window !== "undefined" && navigator.onLine && (typeof process === "undefined" || process.env.NODE_ENV !== "test")) {
      let onlineSuccessStaff: StaffUser | null = null;
      let onlineToken: string | null = null;

      try {
        const targetUserId = localUser?.id || (isNumericId(usernameOrId) ? usernameOrId : undefined);
        const targetUsername = localUser?.username || (!isNumericId(usernameOrId) ? usernameOrId : undefined);
        const resolvedCounterId = profile?.counter_id || profile?.counter_code || "C01";
        const clientUuid = profile?.device_uuid || getOrCreateClientDeviceUuid();
        const clientDevName = profile?.device_name || detectDeviceFriendlyName();
        const publicIp = await publicIpService.getPublicIp().catch(() => null);

        const res = await fetch(`${API_BASE_URL}/api/staff/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Device-UUID": clientUuid,
            ...(profile?.device_token ? { "X-Device-Token": profile.device_token } : {}),
          },
          body: JSON.stringify({
            store_id: activeStore,
            user_id: targetUserId,
            username: targetUsername,
            pin: pin,
            counter_id: resolvedCounterId,
            device_uuid: clientUuid,
            device_name: clientDevName,
            public_ip: publicIp || undefined,
            force_out: options?.forceOut === true,
          }),
        });

        if (res.ok) {
          const body = await res.json();
          if (body.success && body.user) {
            onlineSuccessStaff = {
              id: String(body.user.id),
              store_id: String(body.user.store_id || activeStore),
              username: body.user.username,
              full_name: body.user.name || body.user.username,
              role: body.user.role,
              password_hash: "",
              pin_hash: "",
              is_active: true,
              must_change_password: Boolean(body.user.must_change_password),
              biometric_registered: false,
              failed_attempts: 0,
              locked_until: null,
              permissions: body.user.permissions || null,
              enabled_menus: body.user.enabled_menus || ["pos", "bills"],
            };
            if (body.token) {
              onlineToken = body.token;
            }
            if (body.settings) {
              try {
                const { companySettingsService } = await import("../settings/companySettingsService");
                await companySettingsService.updateLocalFromRemote(body.settings);
              } catch (_) {}
            }
          }
        } else if (res.status === 409) {
          const err = await res.json().catch(() => ({}));
          return {
            success: false,
            error: err.message || "This account is already signed in on another workstation.",
            conflict: {
              activeSession: err.active_session,
              canForceOut: Boolean(err.can_force_out),
            },
          };
        } else if (res.status === 401 || res.status === 403 || res.status === 422 || res.status === 423) {
          const err = await res.json().catch(() => ({}));
          return { success: false, error: err.message || "Invalid PIN." };
        }
      } catch (_) {
        // Cloud unreachable: fallback to local offline cache
      }

      if (onlineSuccessStaff) {
        if (onlineToken) {
          try { localStorage.setItem("staff_token", onlineToken); } catch (_) {}
        }
        return await this.establishSession(onlineSuccessStaff);
      }
    }

    // 2. OFFLINE FALLBACK
    if (this.offlineCacheExpired(String(activeStore))) {
      return { success: false, error: StaffAuthService.OFFLINE_EXPIRED_MESSAGE };
    }

    const user = localUser || (await this.findStaff(usernameOrId));
    if (!user) return { success: false, error: "Staff member not found or inactive." };

    // Check lockout
    if (user.locked_until && Date.now() < user.locked_until) {
      const minsLeft = Math.ceil((user.locked_until - Date.now()) / 60000);
      return {
        success: false,
        error: `Account is temporarily locked due to failed attempts. Try again in ${minsLeft}m or request Admin Unlock.`,
      };
    }

    const isValid = await staffCryptoService.verifyPin(pin, user.pin_hash);
    if (!isValid) {
      return await this.recordFailedAttempt(user);
    }

    // Success
    return await this.establishSession(user);
  }

  async authenticateWithPassword(
    usernameOrId: string,
    password: string,
    options?: StaffAuthOptions
  ): Promise<StaffAuthResult> {
    const profile = await storeDeviceService.getDeviceProfile();
    const activeStore = profile?.store_id || "1";
    const localUser = await this.findStaff(usernameOrId);

    // 1. ONLINE FIRST: Authenticate with Cloud Backend API if in browser and online (skip in unit test runner)
    if (typeof window !== "undefined" && navigator.onLine && (typeof process === "undefined" || process.env.NODE_ENV !== "test")) {
      let onlineSuccessStaff: StaffUser | null = null;
      let onlineToken: string | null = null;

      try {
        const targetUserId = localUser?.id || (isNumericId(usernameOrId) ? usernameOrId : undefined);
        const targetUsername = localUser?.username || (!isNumericId(usernameOrId) ? usernameOrId : undefined);
        const resolvedCounterId = profile?.counter_id || profile?.counter_code || "C01";
        const clientUuid = profile?.device_uuid || getOrCreateClientDeviceUuid();
        const clientDevName = profile?.device_name || detectDeviceFriendlyName();
        const publicIp = await publicIpService.getPublicIp().catch(() => null);

        const res = await fetch(`${API_BASE_URL}/api/staff/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Device-UUID": clientUuid,
            ...(profile?.device_token ? { "X-Device-Token": profile.device_token } : {}),
          },
          body: JSON.stringify({
            store_id: activeStore,
            user_id: targetUserId,
            username: targetUsername,
            password: password,
            counter_id: resolvedCounterId,
            device_uuid: clientUuid,
            device_name: clientDevName,
            public_ip: publicIp || undefined,
            force_out: options?.forceOut === true,
          }),
        });

        if (res.ok) {
          const body = await res.json();
          if (body.success && body.user) {
            onlineSuccessStaff = {
              id: String(body.user.id),
              store_id: String(body.user.store_id || activeStore),
              username: body.user.username,
              full_name: body.user.name || body.user.username,
              role: body.user.role,
              password_hash: "",
              pin_hash: "",
              is_active: true,
              must_change_password: Boolean(body.user.must_change_password),
              biometric_registered: false,
              failed_attempts: 0,
              locked_until: null,
              permissions: body.user.permissions || null,
              enabled_menus: body.user.enabled_menus || ["pos", "bills"],
            };
            if (body.token) {
              onlineToken = body.token;
            }
            if (body.settings) {
              try {
                const { companySettingsService } = await import("../settings/companySettingsService");
                await companySettingsService.updateLocalFromRemote(body.settings);
              } catch (_) {}
            }
          }
        } else if (res.status === 409) {
          const err = await res.json().catch(() => ({}));
          return {
            success: false,
            error: err.message || "This account is already signed in on another workstation.",
            conflict: {
              activeSession: err.active_session,
              canForceOut: Boolean(err.can_force_out),
            },
          };
        } else if (res.status === 401 || res.status === 403 || res.status === 422 || res.status === 423) {
          const err = await res.json().catch(() => ({}));
          return { success: false, error: err.message || "Invalid credentials." };
        }
      } catch (_) {
        // Cloud unreachable: fallback to local offline cache
      }

      if (onlineSuccessStaff) {
        if (onlineToken) {
          try { localStorage.setItem("staff_token", onlineToken); } catch (_) {}
        }
        return await this.establishSession(onlineSuccessStaff);
      }
    }

    // 2. OFFLINE FALLBACK
    if (this.offlineCacheExpired(String(activeStore))) {
      return { success: false, error: StaffAuthService.OFFLINE_EXPIRED_MESSAGE };
    }

    const user = localUser || (await this.findStaff(usernameOrId));
    if (!user) return { success: false, error: "Staff member not found or inactive." };

    if (user.locked_until && Date.now() < user.locked_until) {
      const minsLeft = Math.ceil((user.locked_until - Date.now()) / 60000);
      return {
        success: false,
        error: `Account is temporarily locked due to failed attempts. Try again in ${minsLeft}m or request Admin Unlock.`,
      };
    }

    const isValid = await staffCryptoService.verifySecret(password, user.password_hash);
    if (!isValid) {
      return await this.recordFailedAttempt(user);
    }

    return await this.establishSession(user);
  }

  async adminUnlock(
    adminUsername: string,
    adminPinOrPassword: string,
    targetUsername: string
  ): Promise<{ success: boolean; error?: string }> {
    const target = await this.findStaff(targetUsername);

    // 1. ONLINE FIRST: Call backend cloud unlock API if connected
    if (typeof window !== "undefined" && navigator.onLine && (typeof process === "undefined" || process.env.NODE_ENV !== "test")) {
      try {
        const deviceHeaders = await storeDeviceService.getDeviceAuthHeaders();
        const res = await fetch(`${API_BASE_URL}/api/staff/admin-unlock`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...deviceHeaders,
          },
          body: JSON.stringify({
            admin_username: adminUsername.trim(),
            admin_password: adminPinOrPassword,
            user_id: target?.id || targetUsername.trim(),
          }),
        });

        if (res.ok) {
          if (target) {
            target.failed_attempts = 0;
            target.locked_until = null;
            await this.persistUserRecord(target).catch(() => {});
          }
          return { success: true };
        }

        const err = await res.json().catch(() => ({}));
        // Device is unpaired/revoked: the server cannot scope the request, so
        // fall back to the local administrator check instead of misreporting
        // the credentials as invalid.
        if (err?.error !== "DEVICE_AUTH_FAILED") {
          return { success: false, error: err.message || "Invalid administrator credentials or unlock denied." };
        }
      } catch (_) {
        // Fallback to offline unlock check
      }
    }

    // 2. OFFLINE FALLBACK
    const admin = await this.findStaff(adminUsername);
    const allowedRoles = ["admin", "super_admin", "store_owner", "manager"];
    if (!admin || !allowedRoles.includes(admin.role)) {
      return { success: false, error: "Only an Administrator, Store Owner, or Manager can unlock accounts." };
    }

    const pinOk = await staffCryptoService.verifyPin(adminPinOrPassword, admin.pin_hash);
    const passOk = !pinOk && (await staffCryptoService.verifySecret(adminPinOrPassword, admin.password_hash));

    if (!pinOk && !passOk) {
      return { success: false, error: "Invalid administrator credentials." };
    }

    if (!target) return { success: false, error: "Target user not found." };

    // Reset lock
    target.failed_attempts = 0;
    target.locked_until = null;
    await this.persistUserRecord(target).catch(() => {});

    await this.logAudit("ADMIN_UNLOCK", admin, `Admin unlocked user ${target.username}`).catch(() => {});
    return { success: true };
  }

  async changePasswordOrPin(
    userId: string,
    newPassword?: string,
    newPin?: string
  ): Promise<{ success: boolean; error?: string }> {
    const user = await this.findStaff(userId);
    if (!user) return { success: false, error: "User not found" };

    if (newPassword) {
      const passwordError = validatePassword(newPassword);
      if (passwordError) return { success: false, error: passwordError };
      user.password_hash = await staffCryptoService.hashSecret(newPassword);
    }

    if (newPin) {
      const pinError = validatePin(newPin);
      if (pinError) return { success: false, error: pinError };
      user.pin_hash = await staffCryptoService.hashPin(newPin);
    }

    user.must_change_password = false;
    await this.persistUserRecord(user);

    try {
      const { syncQueueService, defaultBackendApiClient } = await import("../sync/syncQueueService");
      await syncQueueService.enqueue("staff_user", user.id, "update", {
        id: user.id,
        store_id: user.store_id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        biometric_registered: user.biometric_registered,
      });
      syncQueueService.processQueue(defaultBackendApiClient).catch(() => {});
    } catch (_) {}

    if (this.currentSession && this.currentSession.user.id === user.id) {
      this.currentSession.user = { ...user };
      this.notifySessionChange();
    }

    await this.logAudit("PASSWORD_CHANGE", user, "Staff updated credentials");
    return { success: true };
  }

  async switchUser(
    newUserId: string,
    pin: string
  ): Promise<{ success: boolean; error?: string }> {
    const authRes = await this.authenticateWithPin(newUserId, pin);
    if (!authRes.success) return { success: false, error: authRes.error };

    // Note: Calling switchUser preserves the active cart and held bills!
    await this.logAudit("STAFF_SWITCH", authRes.user!, `Switched cashier to ${authRes.user?.username}`);
    return { success: true };
  }

  lockCurrentSession(): void {
    if (this.currentSession) {
      this.currentSession.isLocked = true;
      this.notifySessionChange();
      this.logAudit("SESSION_LOCKED", this.currentSession.user, "Terminal locked (manual or idle timeout)");
    }
  }

  async unlockCurrentSession(pin: string): Promise<{ success: boolean; error?: string }> {
    if (!this.currentSession) return { success: false, error: "No active session" };

    const user = this.currentSession.user;

    // 1. Online First: Verify PIN with Backend API (skip in unit test runner)
    if (typeof window !== "undefined" && navigator.onLine && (typeof process === "undefined" || process.env.NODE_ENV !== "test")) {
      try {
        const profile = await storeDeviceService.getDeviceProfile();
        const activeStore = profile?.store_id || "1";
        const resolvedCounterId = profile?.counter_id || profile?.counter_code || "C01";
        const clientUuid = profile?.device_uuid || getOrCreateClientDeviceUuid();
        const clientDevName = profile?.device_name || detectDeviceFriendlyName();
        const publicIp = await publicIpService.getPublicIp().catch(() => null);

        const res = await fetch(`${API_BASE_URL}/api/staff/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Device-UUID": clientUuid,
            ...(profile?.device_token ? { "X-Device-Token": profile.device_token } : {}),
          },
          body: JSON.stringify({
            store_id: activeStore,
            user_id: user.id,
            username: user.username,
            pin: pin,
            counter_id: resolvedCounterId,
            device_uuid: clientUuid,
            device_name: clientDevName,
            public_ip: publicIp || undefined,
          }),
        });

        if (res.ok) {
          this.currentSession.isLocked = false;
          this.currentSession.lastActivityAt = Date.now();
          this.notifySessionChange();
          this.logAudit("SESSION_UNLOCKED", user, "Terminal unlocked");
          return { success: true };
        } else if (res.status === 409) {
          const err = await res.json().catch(() => ({}));
          return { success: false, error: err.message || "This account is already signed in on another workstation." };
        } else if (res.status === 401 || res.status === 403 || res.status === 422 || res.status === 423) {
          const err = await res.json().catch(() => ({}));
          return { success: false, error: err.message || "Incorrect PIN" };
        }
      } catch (_) {
        // Fallback to offline verification
      }
    }

    // 2. Offline fallback
    const isValid = user.pin_hash ? await staffCryptoService.verifyPin(pin, user.pin_hash) : false;
    if (!isValid) {
      return { success: false, error: "Incorrect PIN" };
    }

    this.currentSession.isLocked = false;
    this.currentSession.lastActivityAt = Date.now();
    this.notifySessionChange();
    this.logAudit("SESSION_UNLOCKED", user, "Terminal unlocked");
    return { success: true };
  }

  logout(): void {
    if (this.currentSession) {
      this.logAudit("LOGOUT", this.currentSession.user, "Cashier logged out");
      this.currentSession = null;
      try {
        localStorage.removeItem("active_staff_session");
        localStorage.removeItem("staff_token");
      } catch (_) {}
      deviceSessionService.notifyLogout().catch(() => {});
      this.notifySessionChange();
    }
  }

  /**
   * End the local staff session because the server ended it (force logout or
   * revocation). Device registration and counter pairing stay intact.
   */
  handleDeviceSessionTerminated(reason: string): void {
    const user = this.currentSession?.user;
    this.currentSession = null;
    try {
      localStorage.removeItem("active_staff_session");
      localStorage.removeItem("staff_token");
    } catch (_) {}
    if (user) {
      this.logAudit("SESSION_FORCE_LOGGED_OUT", user, reason);
    }
    this.notifySessionChange();
  }

  recordActivity(): void {
    if (this.currentSession && !this.currentSession.isLocked) {
      this.currentSession.lastActivityAt = Date.now();
    }
  }

  hasPermission(module: string, action: string = "view"): boolean {
    if (!this.currentSession || this.currentSession.isLocked) return false;
    return hasModulePermission(this.currentSession.user, module, action);
  }

  canAccessMenu(menuId: string): boolean {
    if (!this.currentSession || this.currentSession.isLocked) return false;
    return canAccessMenuForSubject(this.currentSession.user, menuId);
  }

  /**
   * Read-only directory of staff cached for the active store. Credentials are
   * never returned.
   */
  async listStaffDirectory(storeId?: string): Promise<Array<{
    id: string;
    full_name: string;
    username: string;
    role: string;
    is_active: boolean;
    is_locked: boolean;
    locked_until: number | null;
    biometric_registered: boolean;
    permission_overrides: number;
  }>> {
    await this.cleanupSyntheticDemoUsers();
    const activeStore = String(storeId || (await storeDeviceService.getDeviceProfile())?.store_id || "1");
    const raw = await sqliteStorage.findAll<any>("staff_users");
    return (raw || [])
      .filter((u) => String(u.store_id) === activeStore || (activeStore === "1" && u.store_id === "store_main"))
      .map((u) => {
        let permissions: PermissionSet = null;
        try {
          permissions = u.permissions_json ? JSON.parse(u.permissions_json) : null;
        } catch (_) {
          permissions = null;
        }
        const lockedUntil = u.locked_until ? Number(u.locked_until) : null;
        return {
          id: String(u.id),
          full_name: String(u.full_name || u.username || "Staff"),
          username: String(u.username || ""),
          role: String(u.role || "cashier"),
          is_active: Boolean(u.is_active),
          is_locked: Boolean(lockedUntil && lockedUntil > Date.now()),
          locked_until: lockedUntil,
          biometric_registered: Boolean(u.biometric_registered),
          permission_overrides:
            permissions && !Array.isArray(permissions) && typeof permissions === "object"
              ? Object.keys(permissions).length
              : 0,
        };
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }

  private async findStaff(usernameOrId: string): Promise<StaffUser | null> {
    const all = await this.listActiveStaff();
    const clean = usernameOrId.toLowerCase().trim();
    return all.find((u) => u.id === usernameOrId || u.username.toLowerCase() === clean) || null;
  }

  private async recordFailedAttempt(user: StaffUser): Promise<{ success: boolean; error: string }> {
    user.failed_attempts += 1;
    let errorMsg = `Invalid PIN or Password.`;

    if (user.failed_attempts >= this.maxFailedAttempts) {
      user.locked_until = Date.now() + this.lockoutDurationMs;
      errorMsg = `Account locked for 15 minutes due to ${this.maxFailedAttempts} failed attempts. Contact Admin to unlock immediately.`;
      await this.logAudit("ACCOUNT_LOCKED", user, `Account locked: ${user.failed_attempts} failed attempts`);
    } else {
      const remaining = this.maxFailedAttempts - user.failed_attempts;
      errorMsg = `Invalid credentials. ${remaining} attempt(s) remaining before lockout.`;
      await this.logAudit("LOGIN_FAILED", user, `Failed login attempt ${user.failed_attempts}`);
    }

    await this.persistUserRecord(user);
    return { success: false, error: errorMsg };
  }

  private async establishSession(
    user: StaffUser
  ): Promise<{ success: boolean; mustChangePassword?: boolean; user: StaffUser }> {
    // Online sign-in never returns credential hashes; reuse the cached slow
    // hash so the session can still be unlocked and re-authenticated offline.
    if (!user.password_hash || !user.pin_hash) {
      const cached = await this.findCachedStaffRecord(user.id, user.username);
      if (cached) {
        if (!user.password_hash && cached.password_hash) {
          user.password_hash = await decryptStaffSecret(cached.password_hash);
        }
        if (!user.pin_hash && cached.pin_hash) {
          user.pin_hash = await decryptStaffSecret(cached.pin_hash);
        }
      }
    }

    user.failed_attempts = 0;
    user.locked_until = null;
    await this.persistUserRecord(user).catch(() => {});

    const device = await storeDeviceService.getDeviceProfile().catch(() => null);
    const counterId = device?.counter_id || "cntr_default_01";
    const counterName = device?.counter_name || "Counter 01";
    const counterCode = device?.counter_code || "C01";

    const sessionId = `sess_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    this.currentSession = {
      sessionId,
      counterId,
      counterName,
      counterCode,
      user,
      authenticatedAt: Date.now(),
      isLocked: false,
      lastActivityAt: Date.now(),
    };

    try {
      localStorage.setItem("active_staff_session", JSON.stringify(this.currentSession));
    } catch (_) {}

    // Record session in counter_sessions
    await sqliteStorage.insertRecord("counter_sessions", sessionId, {
      id: sessionId,
      counter_id: counterId,
      user_id: user.id,
      user_name: user.full_name,
      user_role: user.role,
      started_at: Date.now(),
      status: "active",
      opening_cash: 0,
    }).catch(() => {});

    await this.logAudit("LOGIN_SUCCESS", user, `Cashier signed in on ${counterName}`).catch(() => {});
    this.notifySessionChange();

    return {
      success: true,
      mustChangePassword: user.must_change_password,
      user,
    };
  }

  private async findCachedStaffRecord(userId: string, username: string): Promise<any | null> {
    const all = (await sqliteStorage.findAll<any>("staff_users").catch(() => [])) || [];
    return (
      all.find((u) => String(u.id) === String(userId)) ||
      all.find((u) => String(u.username).toLowerCase() === String(username).toLowerCase()) ||
      null
    );
  }

  private async persistUserRecord(user: StaffUser): Promise<void> {
    try {
      // Find if user already exists by username or id and delete to prevent UNIQUE constraint violation
      const all = await sqliteStorage.findAll<any>("staff_users").catch(() => []);
      let existing: any = null;
      for (const u of all || []) {
        if (u.username === user.username || String(u.id) === String(user.id)) {
          existing = existing || u;
          await sqliteStorage.deleteRecord("staff_users", u.id).catch(() => {});
        }
      }

      // Never replace a cached slow hash with an empty value (online login does
      // not return hashes, and that must not disable offline sign-in).
      const passwordHash = user.password_hash
        ? await encryptStaffSecret(user.password_hash)
        : existing?.password_hash || "";
      const pinHash = user.pin_hash ? await encryptStaffSecret(user.pin_hash) : existing?.pin_hash || "";

      await sqliteStorage.insertRecord("staff_users", user.id, {
        id: user.id,
        store_id: user.store_id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        password_hash: passwordHash,
        pin_hash: pinHash,
        is_active: user.is_active ? 1 : 0,
        must_change_password: user.must_change_password ? 1 : 0,
        biometric_registered: user.biometric_registered ? 1 : 0,
        failed_attempts: user.failed_attempts || 0,
        locked_until: user.locked_until,
        permissions_json: user.permissions ? JSON.stringify(user.permissions) : null,
        enabled_menus_json: JSON.stringify(user.enabled_menus || []),
        updated_at: Date.now(),
      });
    } catch (e) {
      console.warn("Could not persist staff user record:", e);
    }
  }

  private async logAudit(eventType: string, user: StaffUser | { id: string; full_name?: string; username?: string }, details: string): Promise<void> {
    try {
      const id = `sec_log_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
      await sqliteStorage.insertRecord("security_audit_logs", id, {
        id,
        event_type: eventType,
        user_id: user.id,
        user_name: user.full_name || user.username || "Unknown",
        counter_id: this.currentSession?.counterId || "Counter Station",
        details,
        ip_address: "127.0.0.1",
        created_at: Date.now(),
        synced: 0,
      });
    } catch (_) {}
  }

  /**
   * Push locally recorded offline security events to the cloud when the link
   * is available. Successfully uploaded rows are marked synced.
   */
  async flushOfflineAudit(): Promise<number> {
    if (typeof fetch !== "function") return 0;
    const logs = (await sqliteStorage.findAll<any>("security_audit_logs").catch(() => [])) || [];
    const pending = logs.filter((entry) => !entry.synced);
    if (pending.length === 0) return 0;

    const batch = pending.slice(0, 100);
    const profile = await storeDeviceService.getDeviceProfile().catch(() => null);
    const token = (() => {
      try {
        return typeof localStorage !== "undefined" ? localStorage.getItem("staff_token") : null;
      } catch {
        return null;
      }
    })();

    try {
      const deviceHeaders = await storeDeviceService.getDeviceAuthHeaders();
      const res = await fetch(`${API_BASE_URL}/api/sync/push/security-audit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...deviceHeaders,
        },
        body: JSON.stringify({
          store_id: profile?.store_id || "1",
          device_uuid: profile?.device_uuid || getOrCreateClientDeviceUuid(),
          events: batch.map((entry) => ({
            id: entry.id,
            event_type: entry.event_type,
            user_id: entry.user_id,
            user_name: entry.user_name,
            counter_id: entry.counter_id,
            details: entry.details,
            ip_address: entry.ip_address,
            created_at: entry.created_at,
          })),
        }),
      });

      if (!res.ok) return 0;

      for (const entry of batch) {
        await sqliteStorage.insertRecord("security_audit_logs", entry.id, {
          ...entry,
          synced: 1,
          synced_at: Date.now(),
        }).catch(() => {});
      }
      return batch.length;
    } catch {
      return 0;
    }
  }
}

export const staffAuthService = new StaffAuthService();
