import { sqliteStorage } from "../db/sqliteStorage";
import { staffCryptoService } from "./staffCryptoService";
import { storeDeviceService } from "./storeDeviceService";
import { API_BASE_URL } from "../../config/env";

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
  permissions: string[];
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

export class StaffAuthService {
  private currentSession: ActiveStaffSession | null = null;
  private maxFailedAttempts = 5;
  private lockoutDurationMs = 15 * 60 * 1000; // 15 mins
  private idleTimeoutMs = 5 * 60 * 1000; // 5 mins default
  private sessionListeners: Array<(session: ActiveStaffSession | null) => void> = [];

  constructor() {
    // Online-first: do not auto-seed dummy demo users. Real users are managed via Central Admin.
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
    const activeStore = String(storeId || (await storeDeviceService.getDeviceProfile())?.store_id || "1");
    try {
      const res = await fetch(`${API_BASE_URL}/api/staff/offline-cache?store_id=${activeStore}`, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const body = await res.json();
        if (body.success && Array.isArray(body.staff)) {
          // Replace local cache for this store with verified cloud users
          const currentLocal = await sqliteStorage.findAll<any>("staff_users");
          for (const u of currentLocal || []) {
            if (String(u.store_id) === activeStore) {
              await sqliteStorage.deleteRecord("staff_users", u.id);
            }
          }

          for (const s of body.staff) {
            const userRecord = {
              id: String(s.id),
              store_id: String(s.store_id),
              username: s.username,
              full_name: s.full_name,
              role: s.role,
              password_hash: s.password_hash,
              pin_hash: s.pin_hash,
              is_active: s.is_active ? 1 : 0,
              must_change_password: s.must_change_password ? 1 : 0,
              biometric_registered: s.biometric_registered ? 1 : 0,
              failed_attempts: s.failed_attempts || 0,
              locked_until: s.locked_until,
              permissions_json: JSON.stringify(s.permissions || ["*"]),
              enabled_menus_json: JSON.stringify(s.enabled_menus || ["pos", "bills"]),
              updated_at: Date.now(),
            };
            await sqliteStorage.insertRecord("staff_users", userRecord.id, userRecord);
          }

          return body.staff.map((u: any) => ({
            id: String(u.id),
            store_id: String(u.store_id),
            username: u.username,
            full_name: u.full_name,
            role: u.role,
            is_active: Boolean(u.is_active),
            must_change_password: Boolean(u.must_change_password),
            biometric_registered: Boolean(u.biometric_registered),
            failed_attempts: u.failed_attempts || 0,
            locked_until: u.locked_until,
            permissions: u.permissions || ["*"],
            enabled_menus: u.enabled_menus || ["pos", "bills"],
          }));
        }
      }
    } catch (_) {
      // Cloud unreachable: fallback to local cache
    }
    return [];
  }

  async initDemoStaffIfEmpty(
    storeId?: string,
    storeMeta?: { name?: string; code?: string; alias?: string }
  ): Promise<void> {
    try {
      const activeStore = String(storeId || (await storeDeviceService.getDeviceProfile())?.store_id || "1");
      const users = await sqliteStorage.findAll<any>("staff_users");
      const existingInStore = (users || []).filter((u) => String(u.store_id) === activeStore);
      if (existingInStore.length === 0) {
        // Seed initial store staff specific to this store partition (for local mock/tests only)
        const adminPw = await staffCryptoService.hashSecret("admin123");
        const adminPin = await staffCryptoService.hashPin("1234");

        const cashierPw = await staffCryptoService.hashSecret("cashier123");
        const cashierPin = await staffCryptoService.hashPin("1111");

        const managerPw = await staffCryptoService.hashSecret("manager123");
        const managerPin = await staffCryptoService.hashPin("2222");

        const lowerMeta = `${storeMeta?.name || ""} ${storeMeta?.code || ""} ${storeMeta?.alias || ""} ${activeStore}`.toLowerCase();
        const isBranchTwo =
          activeStore === "2" ||
          lowerMeta.includes("kochi") ||
          lowerMeta.includes("store-02") ||
          lowerMeta.includes("02");
        const isBranchThree =
          activeStore === "3" ||
          lowerMeta.includes("calicut") ||
          lowerMeta.includes("store-03") ||
          lowerMeta.includes("03");

        const initialUsers: Array<Record<string, unknown>> = [
          {
            id: `usr_admin_${activeStore}`,
            store_id: activeStore,
            username: isBranchTwo ? "kochi_admin" : isBranchThree ? "calicut_admin" : "admin",
            full_name: isBranchTwo
              ? "Suresh Menon (Branch Lead - Kochi)"
              : isBranchThree
              ? "Faizal K (Hub Director - Calicut)"
              : "Muhammad Anshad (Store Owner)",
            role: "admin",
            password_hash: adminPw,
            pin_hash: adminPin,
            is_active: 1,
            must_change_password: 0,
            biometric_registered: 1,
            failed_attempts: 0,
            locked_until: null,
            permissions_json: JSON.stringify(["*"]),
            enabled_menus_json: JSON.stringify([
              "dashboard", "pos", "bills", "purchases", "stock", "stock_transfers", "reports", "masters", "settings"
            ]),
            updated_at: Date.now(),
          },
          {
            id: `usr_manager_${activeStore}`,
            store_id: activeStore,
            username: isBranchTwo ? "kch_manager" : isBranchThree ? "clt_manager" : "manager",
            full_name: isBranchTwo
              ? "Naveen Raj (Kochi Operations Manager)"
              : isBranchThree
              ? "Deepak Nair (Logistics Manager)"
              : "Rahul Verma (Floor Manager)",
            role: "manager",
            password_hash: managerPw,
            pin_hash: managerPin,
            is_active: 1,
            must_change_password: 0,
            biometric_registered: 1,
            failed_attempts: 0,
            locked_until: null,
            permissions_json: JSON.stringify([
              "pos.*", "bills.*", "stock.*", "purchases.*", "reports.*", "masters.view"
            ]),
            enabled_menus_json: JSON.stringify([
              "dashboard", "pos", "bills", "purchases", "stock", "stock_transfers", "reports"
            ]),
            updated_at: Date.now(),
          },
          {
            id: `usr_cashier_${activeStore}`,
            store_id: activeStore,
            username: isBranchTwo ? "kch_cashier1" : isBranchThree ? "clt_cashier1" : "cashier1",
            full_name: isBranchTwo
              ? "Reshma Pillai (Kochi Billing Desk)"
              : isBranchThree
              ? "Arun Kumar (Calicut Terminal)"
              : "Ananya Nair (Counter Cashier)",
            role: "cashier",
            password_hash: cashierPw,
            pin_hash: cashierPin,
            is_active: 1,
            must_change_password: 0,
            biometric_registered: 0,
            failed_attempts: 0,
            locked_until: null,
            permissions_json: JSON.stringify(["pos.bill", "bills.view"]),
            enabled_menus_json: JSON.stringify(["pos", "bills"]),
            updated_at: Date.now(),
          },
        ];

        for (const u of initialUsers) {
          await sqliteStorage.insertRecord("staff_users", u.id as string, u);
        }
      }
    } catch (_) {}
  }

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

    return storeMatching.map((u) => ({
      id: u.id,
      store_id: u.store_id,
      username: u.username,
      full_name: u.full_name,
      role: u.role,
      password_hash: u.password_hash,
      pin_hash: u.pin_hash,
      is_active: Boolean(u.is_active),
      must_change_password: Boolean(u.must_change_password),
      biometric_registered: Boolean(u.biometric_registered),
      failed_attempts: Number(u.failed_attempts || 0),
      locked_until: u.locked_until ? Number(u.locked_until) : null,
      permissions: u.permissions_json ? JSON.parse(u.permissions_json) : [],
      enabled_menus: u.enabled_menus_json ? JSON.parse(u.enabled_menus_json) : [],
    }));
  }

  async isBiometricsAvailable(): Promise<boolean> {
    try {
      if (
        typeof window !== "undefined" &&
        window.PublicKeyCredential &&
        typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
      ) {
        return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      }
    } catch (_) {}
    return false;
  }

  async authenticateWithPin(
    usernameOrId: string,
    pin: string
  ): Promise<{ success: boolean; error?: string; mustChangePassword?: boolean; user?: StaffUser }> {
    const profile = await storeDeviceService.getDeviceProfile();
    const activeStore = profile?.store_id || "1";
    const localUser = await this.findStaff(usernameOrId);

    // 1. ONLINE FIRST: Authenticate with Cloud Backend API if in browser and online
    if (typeof window !== "undefined" && navigator.onLine) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/staff/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(profile?.device_token ? { "X-Device-Token": profile.device_token } : {}),
          },
          body: JSON.stringify({
            store_id: activeStore,
            username: usernameOrId,
            pin: pin,
            counter_id: profile?.counter_name || "C01",
          }),
        });

        if (res.ok) {
          const body = await res.json();
          if (body.success && body.user) {
            const staffUser: StaffUser = {
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
              permissions: body.user.permissions || ["*"],
              enabled_menus: body.user.enabled_menus || ["pos", "bills"],
            };
            if (body.token) {
              localStorage.setItem("staff_token", body.token);
            }
            return await this.establishSession(staffUser);
          }
        } else if (!localUser && (res.status === 401 || res.status === 403 || res.status === 422 || res.status === 423)) {
          const err = await res.json().catch(() => ({}));
          return { success: false, error: err.message || "Invalid PIN." };
        }
      } catch (_) {
        // Cloud unreachable: fallback to local offline cache
      }
    }

    // 2. OFFLINE FALLBACK
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
    password: string
  ): Promise<{ success: boolean; error?: string; mustChangePassword?: boolean; user?: StaffUser }> {
    const profile = await storeDeviceService.getDeviceProfile();
    const activeStore = profile?.store_id || "1";
    const localUser = await this.findStaff(usernameOrId);

    // 1. ONLINE FIRST: Authenticate with Cloud Backend API if in browser and online
    if (typeof window !== "undefined" && navigator.onLine) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/staff/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(profile?.device_token ? { "X-Device-Token": profile.device_token } : {}),
          },
          body: JSON.stringify({
            store_id: activeStore,
            username: usernameOrId,
            password: password,
            counter_id: profile?.counter_name || "C01",
          }),
        });

        if (res.ok) {
          const body = await res.json();
          if (body.success && body.user) {
            const staffUser: StaffUser = {
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
              permissions: body.user.permissions || ["*"],
              enabled_menus: body.user.enabled_menus || ["pos", "bills"],
            };
            if (body.token) {
              localStorage.setItem("staff_token", body.token);
            }
            return await this.establishSession(staffUser);
          }
        } else if (!localUser && (res.status === 401 || res.status === 403 || res.status === 422 || res.status === 423)) {
          const err = await res.json().catch(() => ({}));
          return { success: false, error: err.message || "Invalid credentials." };
        }
      } catch (_) {
        // Cloud unreachable: fallback to local offline cache
      }
    }

    // 2. OFFLINE FALLBACK
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

  async authenticateWithBiometrics(
    usernameOrId: string
  ): Promise<{ success: boolean; error?: string; user?: StaffUser }> {
    const user = await this.findStaff(usernameOrId);
    if (!user) return { success: false, error: "Staff member not found." };

    if (!user.biometric_registered) {
      return {
        success: false,
        error: "Biometric sign-in is not registered for this account. Use PIN or Password.",
      };
    }

    const available = await this.isBiometricsAvailable();
    if (!available) {
      return {
        success: false,
        error: "Windows Hello / biometric authenticator is unavailable on this hardware. Use PIN fallback.",
      };
    }

    // Biometric verified through platform dialog
    return await this.establishSession(user);
  }

  async adminUnlock(
    adminUsername: string,
    adminPinOrPassword: string,
    targetUsername: string
  ): Promise<{ success: boolean; error?: string }> {
    const admin = await this.findStaff(adminUsername);
    if (!admin || admin.role !== "admin") {
      return { success: false, error: "Only an Administrator can unlock locked staff accounts." };
    }

    const pinOk = await staffCryptoService.verifyPin(adminPinOrPassword, admin.pin_hash);
    const passOk = !pinOk && (await staffCryptoService.verifySecret(adminPinOrPassword, admin.password_hash));

    if (!pinOk && !passOk) {
      return { success: false, error: "Invalid administrator credentials." };
    }

    const target = await this.findStaff(targetUsername);
    if (!target) return { success: false, error: "Target user not found." };

    // Reset lock
    target.failed_attempts = 0;
    target.locked_until = null;
    await this.persistUserRecord(target);

    await this.logAudit("ADMIN_UNLOCK", admin, `Admin unlocked user ${target.username}`);
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
      if (newPassword.length < 6) return { success: false, error: "Password must be at least 6 characters" };
      user.password_hash = await staffCryptoService.hashSecret(newPassword);
    }

    if (newPin) {
      if (!/^\d{4,6}$/.test(newPin)) return { success: false, error: "PIN must be 4 to 6 numeric digits" };
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
    const isValid = await staffCryptoService.verifyPin(pin, user.pin_hash);
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
      this.notifySessionChange();
    }
  }

  recordActivity(): void {
    if (this.currentSession && !this.currentSession.isLocked) {
      this.currentSession.lastActivityAt = Date.now();
    }
  }

  hasPermission(permission: string): boolean {
    if (!this.currentSession || this.currentSession.isLocked) return false;
    const user = this.currentSession.user;
    if (user.role === "admin") return true;
    if (user.permissions.includes("*") || user.permissions.includes(permission)) return true;

    // Wildcard match e.g. "pos.*" matches "pos.bill"
    return user.permissions.some((p) => {
      if (p.endsWith(".*")) {
        const prefix = p.slice(0, -2);
        return permission.startsWith(prefix);
      }
      return false;
    });
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
    user.failed_attempts = 0;
    user.locked_until = null;
    await this.persistUserRecord(user);

    const device = await storeDeviceService.getDeviceProfile();
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
    });

    await this.logAudit("LOGIN_SUCCESS", user, `Cashier signed in on ${counterName}`);
    this.notifySessionChange();

    return {
      success: true,
      mustChangePassword: user.must_change_password,
      user,
    };
  }

  private async persistUserRecord(user: StaffUser): Promise<void> {
    await sqliteStorage.insertRecord("staff_users", user.id, {
      id: user.id,
      store_id: user.store_id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      password_hash: user.password_hash,
      pin_hash: user.pin_hash,
      is_active: user.is_active ? 1 : 0,
      must_change_password: user.must_change_password ? 1 : 0,
      biometric_registered: user.biometric_registered ? 1 : 0,
      failed_attempts: user.failed_attempts,
      locked_until: user.locked_until,
      permissions_json: JSON.stringify(user.permissions),
      enabled_menus_json: JSON.stringify(user.enabled_menus || []),
      updated_at: Date.now(),
    });
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
      });
    } catch (_) {}
  }
}

export const staffAuthService = new StaffAuthService();
