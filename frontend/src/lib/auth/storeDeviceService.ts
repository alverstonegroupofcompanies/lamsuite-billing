import { invokeCommand } from "../ipc/ipcBridge";
import { sqliteStorage } from "../db/sqliteStorage";
import { companySettingsService } from "../settings/companySettingsService";
import { staffCryptoService } from "./staffCryptoService";
import { INITIAL_BRANCH_STORES, type BranchStore } from "../masters/storeService";
import { productsStore } from "../masters/productsStore";
import { partiesStore } from "../masters/partiesStore";
import { API_BASE_URL, DEFAULT_LAN_PORT } from "../../config/env";

export interface StoreDeviceProfile {
  device_id: string;
  device_uuid: string;
  device_name: string;
  store_id: string;
  store_name: string;
  store_code: string;
  counter_id: string;
  counter_name: string;
  counter_code: string;
  location_name?: string;
  is_remote?: boolean;
  is_hub: boolean;
  is_digital_only?: boolean;
  role_profile?: {
    allow_cancel?: boolean;
    allow_price_change?: boolean;
    allow_stock_adj?: boolean;
    require_manager_pin?: boolean;
  };
  manager_pin?: string;
  printer_profile?: Record<string, unknown>;
  receipt_customization?: Record<string, unknown>;
  license_plan: string;
  license_status: "active" | "trial" | "expired" | "grace_period" | "revoked";
  license_expires_at: string;
  registered_at: number;
  is_active: boolean;
  disabled_reason?: string;
  admin_staff_present?: boolean;
  device_token?: string;
}

export interface FirstAdminInput {
  name: string;
  username: string;
  password: string;
  pin: string;
}

export class StoreDeviceService {
  private activeProfile: StoreDeviceProfile | null = null;
  private isAccessRevoked = false;
  private revocationReason = "";

  clearProfileCache(): void {
    this.activeProfile = null;
  }

  setProfile(profile: StoreDeviceProfile | null): void {
    this.activeProfile = profile;
  }

  async isDeviceRegistered(): Promise<boolean> {
    const profile = await this.getDeviceProfile();
    return Boolean(profile && profile.device_id && profile.store_id);
  }

  async getDeviceProfile(): Promise<StoreDeviceProfile | null> {
    if (this.activeProfile) return this.activeProfile;

    const storedJson = await invokeCommand<string | null>("secure_store_get", {
      key: "store_device_profile",
    });

    if (storedJson) {
      try {
        this.activeProfile = JSON.parse(storedJson) as StoreDeviceProfile;
        return this.activeProfile;
      } catch (e) {
        console.warn("Failed to parse device profile from secure store:", e);
      }
    }

    // Check sqlite table as secondary offline cache
    const counters = await sqliteStorage.findAll<any>("store_counters");
    if (counters && counters.length > 0) {
      const c = counters[0];
      this.activeProfile = {
        device_id: c.id,
        device_uuid: c.device_uuid,
        device_name: c.counter_name,
        store_id: c.store_id || "store_main",
        store_name: c.store_name || "LamStone Pharmacy & Retail",
        store_code: c.store_code || "STORE-01",
        counter_id: c.id,
        counter_name: c.counter_name,
        counter_code: c.counter_code || "C01",
        is_hub: Boolean(c.is_hub),
        license_plan: "Retail & Pharmacy Chain Pro",
        license_status: "active",
        license_expires_at: "2027-12-31",
        registered_at: c.created_at,
        is_active: c.status === "active",
      };
      return this.activeProfile;
    }

    return null;
  }

  async fetchBranchesForOwner(
    _email?: string,
    _password?: string
  ): Promise<BranchStore[]> {
    try {
      const res = await fetch(`${API_BASE_URL}/api/branches`, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const body = await res.json();
        if (body.data && Array.isArray(body.data) && body.data.length > 0) {
          return body.data.map((b: any) => ({
            id: String(b.id),
            name: b.name,
            code: b.code,
            city: b.city || "Palakkad",
            state_code: b.state_code || "32",
            gstin: b.gstin || "",
            is_main: Boolean(b.is_main),
            is_active: Boolean(b.is_active),
          }));
        }
      }
    } catch {
      // offline / unreachable
    }
    return [];
  }

  async registerWithActivationKey(
    activationKey: string,
    counterName: string,
    isHub = false,
    onProgress?: (step: string, percent: number) => void
  ): Promise<StoreDeviceProfile> {
    if (!activationKey || activationKey.trim().length < 6) {
      throw new Error("Invalid Store Activation Key. Must be at least 6 characters.");
    }

    onProgress?.("Validating activation key against cloud backend...", 20);
    const deviceUuid = `dev_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const counterCode = counterName.replace(/[^0-9]/g, "")
      ? `C${counterName.replace(/[^0-9]/g, "").padStart(2, "0")}`
      : "C01";
    const counterId = `cntr_${Date.now()}_${counterCode.toLowerCase()}`;

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/api/devices/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          activation_key: activationKey.trim(),
          device_uuid: deviceUuid,
          device_name: counterName,
          is_hub: isHub,
        }),
      });
    } catch (networkErr: any) {
      console.error("[Activation] Network error during device registration:", networkErr, "Target URL:", `${API_BASE_URL}/api/devices/register`);
      // NO OFFLINE ACTIVATION: If backend cannot be reached, abort immediately!
      throw new Error("Cannot reach server. Online verification is required to activate this workstation.");
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const message = errBody.message || `Activation rejected by server (HTTP ${response.status})`;
      throw new Error(message);
    }

    const data = await response.json();
    if (!data.success || !data.store_id || !data.device_token) {
      throw new Error("Invalid server activation response: missing authorization credentials.");
    }

    const storeProfile: StoreDeviceProfile = {
      device_id: data.device_id || counterId,
      device_uuid: deviceUuid,
      device_name: counterName,
      store_id: String(data.store_id),
      store_name: data.store_name || "Store",
      store_code: data.store_code || "STORE",
      counter_id: data.counter_id || counterId,
      counter_name: counterName,
      counter_code: data.counter_code || counterCode,
      is_hub: isHub,
      license_plan: data.license_plan || "Enterprise Retail & Pharmacy Chain",
      license_status: data.license_status || "active",
      license_expires_at: data.license_expires_at || "2027-12-31",
      registered_at: Date.now(),
      is_active: data.status === "active",
      admin_staff_present: Boolean(data.admin_staff_present),
    };

    const deviceToken = data.device_token;
    const refreshToken = data.refresh_token || `ref_${Date.now()}`;

    onProgress?.("Storing workstation device token & credentials securely...", 50);
    await invokeCommand("secure_store_set", { key: "device_token", value: deviceToken });
    await invokeCommand("secure_store_set", { key: "refresh_token", value: refreshToken });
    await invokeCommand("secure_store_set", {
      key: "store_device_profile",
      value: JSON.stringify(storeProfile),
    });

    onProgress?.("Writing counter configuration...", 75);
    await sqliteStorage.insertRecord("store_counters", counterId, {
      id: counterId,
      store_id: storeProfile.store_id,
      counter_name: counterName,
      counter_code: counterCode,
      device_uuid: deviceUuid,
      is_hub: isHub ? 1 : 0,
      ip_address: "127.0.0.1",
      port: 8089,
      app_version: "2.0.0",
      status: storeProfile.is_active ? "active" : "pending_approval",
      pending_queue_count: 0,
      last_sync_at: Date.now(),
      created_at: Date.now(),
    });

    this.activeProfile = storeProfile;

    // Register in multi-store registry
    try {
      const { storeRegistryService } = await import("./storeRegistryService");
      await storeRegistryService.registerStore(storeProfile, { deviceToken, refreshToken });
    } catch (e) {
      console.warn("Registry registration notice:", e);
    }

    onProgress?.("Store activation and device registration complete!", 100);
    return storeProfile;
  }

  async registerWithOwnerCredentials(
    email: string,
    password: string,
    selectedStoreId: string,
    counterName: string,
    isHub = false,
    totpCode?: string,
    onProgress?: (step: string, percent: number) => void
  ): Promise<StoreDeviceProfile> {
    if (!email || !password) {
      throw new Error("Email and password are required");
    }

    onProgress?.("Authenticating store owner account with cloud backend...", 20);
    const deviceUuid = `dev_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/api/devices/register-owner`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          store_id: selectedStoreId,
          device_uuid: deviceUuid,
          device_name: counterName,
          totp_code: totpCode,
          is_hub: isHub,
        }),
      });
    } catch (networkErr: any) {
      console.error("[Activation] Network error during owner registration:", networkErr, "Target URL:", `${API_BASE_URL}/api/devices/register-owner`);
      const detail = networkErr?.message ? ` (${networkErr.message})` : "";
      throw new Error(`Cannot reach server at ${API_BASE_URL}${detail}. Online verification is required for Owner activation.`);
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `Owner registration rejected (${response.status})`);
    }

    const data = await response.json();
    if (data.requires_2fa) {
      const err: any = new Error(data.message || "2FA TOTP code required");
      err.requires_2fa = true;
      throw err;
    }

    if (!data.success || !data.device_token) {
      throw new Error("Invalid server response during owner enrollment");
    }

    const counterId = data.counter_id || `cntr_${Date.now()}`;
    const storeProfile: StoreDeviceProfile = {
      device_id: data.device_id || counterId,
      device_uuid: deviceUuid,
      device_name: counterName,
      store_id: String(data.store_id),
      store_name: data.store_name,
      store_code: data.store_code,
      counter_id: counterId,
      counter_name: counterName,
      counter_code: data.counter_code || "C01",
      is_hub: isHub,
      license_plan: data.license_plan || "Enterprise Retail & Pharmacy Chain",
      license_status: data.license_status || "active",
      license_expires_at: data.license_expires_at || "2027-12-31",
      registered_at: Date.now(),
      is_active: data.status === "active",
      admin_staff_present: Boolean(data.admin_staff_present),
    };

    const deviceToken = data.device_token;
    const refreshToken = data.refresh_token || `ref_${Date.now()}`;

    await invokeCommand("secure_store_set", { key: "device_token", value: deviceToken });
    await invokeCommand("secure_store_set", { key: "refresh_token", value: refreshToken });
    await invokeCommand("secure_store_set", {
      key: "store_device_profile",
      value: JSON.stringify(storeProfile),
    });

    await sqliteStorage.insertRecord("store_counters", counterId, {
      id: counterId,
      store_id: storeProfile.store_id,
      counter_name: counterName,
      counter_code: storeProfile.counter_code,
      device_uuid: deviceUuid,
      is_hub: isHub ? 1 : 0,
      ip_address: "127.0.0.1",
      port: 8089,
      app_version: "2.0.0",
      status: "active",
      pending_queue_count: 0,
      last_sync_at: Date.now(),
      created_at: Date.now(),
    });

    this.activeProfile = storeProfile;

    try {
      const { storeRegistryService } = await import("./storeRegistryService");
      await storeRegistryService.registerStore(storeProfile, { deviceToken, refreshToken });
    } catch (e) {
      console.warn("Registry registration notice:", e);
    }

    onProgress?.("Owner enrollment completed!", 100);
    return storeProfile;
  }

  async validateDeviceSession(): Promise<{ valid: boolean; locked?: boolean; reason?: string }> {
    const profile = await this.getDeviceProfile();
    if (!profile) return { valid: false, locked: false };

    const token = await invokeCommand<string | null>("secure_store_get", {
      key: "device_token",
    });

    if (!token) {
      return { valid: false, locked: true, reason: "No device token in secure vault" };
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/devices/validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Device-Token": token,
          "X-Device-UUID": profile.device_uuid,
        },
        body: JSON.stringify({
          device_token: token,
          device_uuid: profile.device_uuid,
          store_id: profile.store_id,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.action === "lock_and_reset" || res.status === 401 || res.status === 403) {
          await this.lockAndResetWorkstation(body.wipe_on_revocation || false);
          return { valid: false, locked: true, reason: body.message || "Device unrecognized or revoked by server." };
        }
      }

      const body = await res.json().catch(() => ({}));
      if (body.valid === false) {
        if (body.action === "lock_and_reset") {
          await this.lockAndResetWorkstation(body.wipe_on_revocation || false);
          return { valid: false, locked: true, reason: body.message || "Workstation revoked by server." };
        }
        return { valid: false, locked: true, reason: body.message };
      }

      return { valid: true };
    } catch (networkErr) {
      // Offline fallback: already verified device can continue locally
      return { valid: true };
    }
  }

  async lockAndResetWorkstation(wipeLocalData = false): Promise<void> {
    this.activeProfile = null;
    this.isAccessRevoked = true;
    this.revocationReason = "Device token revoked by server";

    await invokeCommand("secure_store_delete", { key: "device_token" });
    await invokeCommand("secure_store_delete", { key: "refresh_token" });
    await invokeCommand("secure_store_delete", { key: "store_device_profile" });

    try {
      const { storeRegistryService } = await import("./storeRegistryService");
      const activeStore = storeRegistryService.getActiveStore();
      if (activeStore) {
        if (wipeLocalData) {
          await storeRegistryService.disconnectStore(activeStore.id, true);
        } else {
          await storeRegistryService.updateStoreMeta(activeStore.id, {
            is_active: false,
          });
        }
      }
    } catch (e) {
      console.warn("Registry cleanup notice:", e);
    }
  }

  async setupFirstAdmin(admin: FirstAdminInput): Promise<void> {
    if (!admin.username || !admin.password || !admin.pin) {
      throw new Error("Admin username, password and PIN are required");
    }

    const passwordHash = await staffCryptoService.hashSecret(admin.password);
    const pinHash = await staffCryptoService.hashPin(admin.pin);

    const adminId = `usr_admin_${Date.now()}`;
    await sqliteStorage.insertRecord("staff_users", adminId, {
      id: adminId,
      store_id: this.activeProfile?.store_id || "store_main",
      username: admin.username.toLowerCase().trim(),
      full_name: admin.name || "Store Administrator",
      role: "admin",
      password_hash: passwordHash,
      pin_hash: pinHash,
      is_active: 1,
      must_change_password: 0,
      biometric_registered: 0,
      failed_attempts: 0,
      locked_until: null,
      permissions_json: JSON.stringify(["*"]),
      enabled_menus_json: JSON.stringify([
        "pos", "bills", "purchases", "stock", "stock_transfers", "reports", "masters", "settings"
      ]),
      updated_at: Date.now(),
    });

    try {
      const { syncQueueService, defaultBackendApiClient } = await import("../sync/syncQueueService");
      await syncQueueService.enqueue("staff_user", adminId, "create", {
        id: adminId,
        store_id: this.activeProfile?.store_id || "store_main",
        username: admin.username.toLowerCase().trim(),
        full_name: admin.name || "Store Administrator",
        role: "admin",
        biometric_registered: 0,
      });
      syncQueueService.processQueue(defaultBackendApiClient).catch(() => {});
    } catch (_) {}
  }

  async checkLicenseStatus(): Promise<{
    valid: boolean;
    plan: string;
    expiresAt: string;
    status: string;
    warning?: string;
  }> {
    const profile = await this.getDeviceProfile();
    if (!profile) {
      return { valid: false, plan: "Unknown", expiresAt: "", status: "unregistered" };
    }

    if (this.isAccessRevoked || profile.is_active === false) {
      return {
        valid: false,
        plan: profile.license_plan,
        expiresAt: profile.license_expires_at,
        status: "disabled",
        warning: this.revocationReason || "Store access has been disabled by Central Admin.",
      };
    }

    return {
      valid: true,
      plan: profile.license_plan,
      expiresAt: profile.license_expires_at,
      status: profile.license_status,
    };
  }

  async lockStoreAccess(reason: string): Promise<void> {
    this.isAccessRevoked = true;
    this.revocationReason = reason;
    if (this.activeProfile) {
      this.activeProfile.is_active = false;
      this.activeProfile.disabled_reason = reason;
      await invokeCommand("secure_store_set", {
        key: "store_device_profile",
        value: JSON.stringify(this.activeProfile),
      });
    }
  }

  async remoteStoreReset(reason: string): Promise<void> {
    // Record security audit event
    await sqliteStorage.insertRecord("security_audit_logs", `audit_reset_${Date.now()}`, {
      id: `audit_reset_${Date.now()}`,
      event_type: "REMOTE_STORE_RESET",
      user_id: "system",
      user_name: "Cloud Admin",
      counter_id: this.activeProfile?.counter_id || "unknown",
      details: `Remote store reset triggered: ${reason}`,
      ip_address: "127.0.0.1",
      created_at: Date.now(),
    });

    // Clear secure device tokens and profile
    await invokeCommand("secure_store_delete", { key: "device_token" });
    await invokeCommand("secure_store_delete", { key: "refresh_token" });
    await invokeCommand("secure_store_delete", { key: "store_device_profile" });

    // Clear operational tables
    await sqliteStorage.clearTable("store_counters");
    await sqliteStorage.clearTable("counter_sequences");
    await sqliteStorage.clearTable("counter_sessions");
    await sqliteStorage.clearTable("document_locks");
    await sqliteStorage.clearTable("distributed_held_bills");
    await sqliteStorage.clearTable("cash_shifts");

    this.activeProfile = null;
    this.isAccessRevoked = false;
  }

  async enrollRemoteCounter(
    baseUrl: string,
    counterName: string,
    counterCode: string,
    storeId: string | number = 1,
    locationName = "Owner Residence",
    isDigitalOnly = false,
    existingDeviceUuid?: string
  ): Promise<{
    success: boolean;
    status: string;
    counter?: any;
    pairing_code?: string;
    device_token?: string;
    device_uuid: string;
    message: string;
  }> {
    const deviceUuid = existingDeviceUuid || `dev_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

    try {
      const res = await fetch(`${baseUrl}/api/counters/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          store_id: storeId,
          device_uuid: deviceUuid,
          counter_name: counterName,
          counter_code: counterCode,
          location_name: locationName,
          is_remote: true,
          is_digital_only: isDigitalOnly,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        const counter = data.counter;
        return {
          success: true,
          status: counter.status,
          counter,
          pairing_code: data.pairing_code || counter.pairing_code,
          device_token: data.device_token,
          device_uuid: deviceUuid,
          message: data.message,
        };
      }
      return {
        success: false,
        status: "error",
        device_uuid: deviceUuid,
        message: data.error || data.message || "Enrollment failed",
      };
    } catch (err: any) {
      return {
        success: false,
        status: "error",
        device_uuid: deviceUuid,
        message: err?.message || "Failed to reach enrollment endpoint",
      };
    }
  }

  async pollEnrollmentStatus(
    baseUrl: string,
    deviceUuid: string
  ): Promise<{
    success: boolean;
    status: "active" | "pending_approval" | "revoked" | "not_found";
    device_token?: string;
    pairing_code?: string;
    counter?: any;
    store_name?: string;
    store_code?: string;
    store_id?: string;
    counter_name?: string;
    counter_code?: string;
  }> {
    try {
      const res = await fetch(`${baseUrl}/api/counters/enrollment-status/${deviceUuid}`, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        return {
          success: true,
          status: data.status,
          device_token: data.device_token,
          pairing_code: data.pairing_code,
          counter: data,
          store_name: data.store_name,
          store_code: data.store_code,
          store_id: String(data.store_id),
          counter_name: data.counter_name,
          counter_code: data.counter_code,
        };
      }
      return { success: false, status: "not_found" };
    } catch {
      return { success: false, status: "not_found" };
    }
  }

  async finalizeDeviceActivation(
    baseUrl: string,
    profileData: {
      store_id: string;
      store_name: string;
      store_code: string;
      counter_id: string;
      counter_name: string;
      counter_code: string;
      device_uuid: string;
      device_token: string;
      is_hub?: boolean;
    },
    onProgress?: (step: string, percent: number) => void
  ): Promise<StoreDeviceProfile> {
    onProgress?.("Storing device authorization token in OS secure vault...", 20);
    await invokeCommand("secure_store_set", { key: "device_token", value: profileData.device_token });
    await invokeCommand("secure_store_set", {
      key: `store:${profileData.store_id}:device_token`,
      value: profileData.device_token,
    });

    onProgress?.("Configuring local store partition...", 40);
    const profile: StoreDeviceProfile = {
      device_id: profileData.counter_id,
      device_uuid: profileData.device_uuid,
      device_name: profileData.counter_name,
      store_id: profileData.store_id,
      store_name: profileData.store_name,
      store_code: profileData.store_code,
      counter_id: profileData.counter_id,
      counter_name: profileData.counter_name,
      counter_code: profileData.counter_code,
      is_hub: Boolean(profileData.is_hub),
      license_plan: "Enterprise Retail & Pharmacy Chain Pro",
      license_status: "active",
      license_expires_at: "2027-12-31",
      registered_at: Date.now(),
      is_active: true,
    };

    await invokeCommand("secure_store_set", {
      key: "store_device_profile",
      value: JSON.stringify(profile),
    });
    await invokeCommand("secure_store_set", {
      key: `store:${profileData.store_id}:profile`,
      value: JSON.stringify(profile),
    });

    onProgress?.("Synchronizing offline staff credentials and salted hashes...", 70);
    try {
      const cacheRes = await fetch(`${baseUrl}/api/staff/offline-cache?store_id=${profileData.store_id}`, {
        headers: { "X-Device-Token": profileData.device_token, Accept: "application/json" },
      });
      if (cacheRes.ok) {
        const cacheData = await cacheRes.json();
        if (Array.isArray(cacheData.staff)) {
          for (const s of cacheData.staff) {
            await sqliteStorage.insertRecord("staff_users", s.id, {
              id: s.id,
              store_id: profileData.store_id,
              username: s.username,
              full_name: s.full_name,
              role: s.role,
              password_hash: s.password_hash,
              pin_hash: s.pin_hash,
              is_active: 1,
              must_change_password: s.must_change_password ? 1 : 0,
              biometric_registered: s.biometric_registered ? 1 : 0,
              failed_attempts: 0,
              locked_until: s.locked_until,
              permissions_json: JSON.stringify(s.permissions || ["*"]),
              enabled_menus_json: JSON.stringify(s.enabled_menus || ["pos", "bills"]),
              updated_at: Date.now(),
            });
          }
        }
      }
    } catch (e) {
      console.warn("Offline staff cache sync notice:", e);
    }

    onProgress?.("Registering store in multi-store registry...", 90);
    this.activeProfile = profile;
    try {
      const { storeRegistryService } = await import("./storeRegistryService");
      await storeRegistryService.registerStore(profile, {
        deviceToken: profileData.device_token,
        refreshToken: `ref_${Date.now()}`,
      });
    } catch (e) {
      console.warn("Registry registration notice:", e);
    }

    onProgress?.("Workstation ready!", 100);
    return profile;
  }

  async checkLiveStatus(baseUrl: string, counterId: string): Promise<{ isCounterActive: boolean; isStoreActive: boolean; status: string }> {
    try {
      const res = await fetch(`${baseUrl}/api/counters/${counterId}/watch`);
      if (res.ok) {
        const data = await res.json();
        const isCounterActive = data.is_counter_active !== false;
        const isStoreActive = data.is_store_active !== false;
        if (!isCounterActive || !isStoreActive) {
          this.isAccessRevoked = true;
          this.revocationReason = !isStoreActive ? "Store disabled by cloud administrator." : "Terminal counter access revoked.";
        }
        return { isCounterActive, isStoreActive, status: data.counter_status || "active" };
      }
    } catch {
      // offline
    }
    return { isCounterActive: true, isStoreActive: true, status: "unknown" };
  }

  canPerformAction(action: "cancel_bill" | "change_price" | "adjust_stock"): boolean {
    if (!this.activeProfile || !this.activeProfile.role_profile) return true;
    const rp = this.activeProfile.role_profile;

    if (action === "cancel_bill" && rp.allow_cancel === false) return false;
    if (action === "change_price" && rp.allow_price_change === false) return false;
    if (action === "adjust_stock" && rp.allow_stock_adj === false) return false;

    return true;
  }

  verifyManagerPin(inputPin: string): boolean {
    if (!this.activeProfile?.manager_pin) return true; // No PIN configured
    return this.activeProfile.manager_pin === inputPin;
  }
}

export const storeDeviceService = new StoreDeviceService();
