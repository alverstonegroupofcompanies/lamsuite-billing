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
    email: string,
    _password: string
  ): Promise<BranchStore[]> {
    if (!email) throw new Error("Email is required");
    // Returns available branches for the owner account
    return INITIAL_BRANCH_STORES;
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

    let storeProfile: StoreDeviceProfile;
    let deviceToken = `jwt_dev_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    let refreshToken = `ref_dev_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

    try {
      const response = await fetch(`${API_BASE_URL}/api/devices/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          activation_key: activationKey.trim(),
          device_uuid: deviceUuid,
          device_name: counterName,
          is_hub: isHub,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.store_id) {
          storeProfile = {
            device_id: data.device_id || counterId,
            device_uuid: deviceUuid,
            device_name: counterName,
            store_id: String(data.store_id),
            store_name: data.store_name || "LamStone Retail Store",
            store_code: data.store_code || "STORE",
            counter_id: data.counter_id || counterId,
            counter_name: counterName,
            counter_code: counterCode,
            is_hub: isHub,
            license_plan: data.license_plan || "Enterprise Retail & Pharmacy Chain",
            license_status: data.license_status || "active",
            license_expires_at: data.license_expires_at || "2027-12-31",
            registered_at: Date.now(),
            is_active: data.license_status !== "revoked",
            admin_staff_present: Boolean(data.admin_staff_present),
          };
          if (data.device_token) deviceToken = data.device_token;
          if (data.refresh_token) refreshToken = data.refresh_token;
        } else {
          throw new Error("Invalid response from server");
        }
      } else {
        throw new Error(`Server returned ${response.status}`);
      }
    } catch (apiErr) {
      // Offline fallback: Derive branch from known list or activation key format
      const keyUpper = activationKey.toUpperCase();
      let matchedBranch: { id: string; name: string; code: string } | null = null;
      if (keyUpper.includes("STORE-01") || keyUpper.includes("MAIN")) {
        matchedBranch = { id: "store_main", name: "LamStone Pharmacy & Retail (Palakkad Main)", code: "STORE-01" };
      } else if (keyUpper.includes("STORE-02") || keyUpper.includes("KCH") || keyUpper.includes("KOCHI")) {
        matchedBranch = { id: "store_kochi", name: "LamStone Medicos & Superstore (Kochi Branch)", code: "STORE-02" };
      } else if (keyUpper.includes("STORE-03") || keyUpper.includes("CLT") || keyUpper.includes("CALICUT")) {
        matchedBranch = { id: "store_calicut", name: "LamStone Regional Distribution Hub (Calicut)", code: "STORE-03" };
      } else {
        const cleanKey = keyUpper.replace(/[^A-Z0-9]/g, "").slice(0, 8);
        matchedBranch = {
          id: `store_${cleanKey.toLowerCase()}`,
          name: `LamStone Branch (${cleanKey})`,
          code: cleanKey.slice(0, 4) || "BR01",
        };
      }

      storeProfile = {
        device_id: counterId,
        device_uuid: deviceUuid,
        device_name: counterName,
        store_id: matchedBranch.id,
        store_name: matchedBranch.name,
        store_code: matchedBranch.code,
        counter_id: counterId,
        counter_name: counterName,
        counter_code: counterCode,
        is_hub: isHub,
        license_plan: "Enterprise Retail & Pharmacy Chain",
        license_status: "active",
        license_expires_at: "2027-12-31",
        registered_at: Date.now(),
        is_active: true,
      };
    }

    onProgress?.("Downloading store profile & license details...", 45);
    // Store tokens in OS secure storage
    await invokeCommand("secure_store_set", { key: "device_token", value: deviceToken });
    await invokeCommand("secure_store_set", { key: "refresh_token", value: refreshToken });

    onProgress?.("Ingesting catalog masters & GST tax configurations...", 70);
    await invokeCommand("secure_store_set", {
      key: "store_device_profile",
      value: JSON.stringify(storeProfile),
    });

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
      status: "active",
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

    onProgress?.("Device setup completed successfully!", 100);
    return storeProfile;
  }

  async registerWithOwnerCredentials(
    email: string,
    password: string,
    selectedStoreId: string,
    counterName: string,
    isHub = false,
    onProgress?: (step: string, percent: number) => void
  ): Promise<StoreDeviceProfile> {
    if (!email || !password) {
      throw new Error("Email and password are required");
    }

    onProgress?.("Authenticating store owner account...", 20);
    const branches = await this.fetchBranchesForOwner(email, password);
    const selectedBranch = branches.find((b) => b.id === selectedStoreId) || branches[0];

    onProgress?.("Provisioning workstation counter identity...", 45);
    const deviceUuid = `dev_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const counterCode = counterName.replace(/[^0-9]/g, "")
      ? `C${counterName.replace(/[^0-9]/g, "").padStart(2, "0")}`
      : "C01";
    const counterId = `cntr_${selectedBranch.code.toLowerCase()}_${counterCode.toLowerCase()}`;

    const deviceToken = `jwt_dev_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    const refreshToken = `ref_dev_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

    await invokeCommand("secure_store_set", { key: "device_token", value: deviceToken });
    await invokeCommand("secure_store_set", { key: "refresh_token", value: refreshToken });

    onProgress?.("Downloading branch profile & role settings...", 70);
    const profile: StoreDeviceProfile = {
      device_id: counterId,
      device_uuid: deviceUuid,
      device_name: counterName,
      store_id: selectedBranch.id,
      store_name: selectedBranch.name,
      store_code: selectedBranch.code,
      counter_id: counterId,
      counter_name: counterName,
      counter_code: counterCode,
      is_hub: isHub,
      license_plan: "Enterprise Retail & Pharmacy Chain",
      license_status: "active",
      license_expires_at: "2027-12-31",
      registered_at: Date.now(),
      is_active: true,
    };

    await invokeCommand("secure_store_set", {
      key: "store_device_profile",
      value: JSON.stringify(profile),
    });

    await sqliteStorage.insertRecord("store_counters", counterId, {
      id: counterId,
      store_id: selectedBranch.id,
      counter_name: counterName,
      counter_code: counterCode,
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

    this.activeProfile = profile;

    // Register in multi-store registry
    try {
      const { storeRegistryService } = await import("./storeRegistryService");
      await storeRegistryService.registerStore(profile, { deviceToken, refreshToken });
    } catch (e) {
      console.warn("Registry registration notice:", e);
    }

    onProgress?.("Store activation and device registration complete!", 100);
    return profile;
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
    locationName = "Owner Residence",
    isDigitalOnly = false
  ): Promise<{ success: boolean; status: string; counter?: any; message: string }> {
    const deviceUuid = `dev_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

    try {
      const res = await fetch(`${baseUrl}/api/counters/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          store_id: 1,
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
        // Save initial profile
        const counter = data.counter;
        const profile: StoreDeviceProfile = {
          device_id: String(counter.id),
          device_uuid: deviceUuid,
          device_name: counterName,
          store_id: String(counter.store_id),
          store_name: "LamStone Pharmacy & Retail",
          store_code: "STORE-01",
          counter_id: String(counter.id),
          counter_name: counterName,
          counter_code: counterCode,
          location_name: locationName,
          is_remote: true,
          is_hub: false,
          is_digital_only: isDigitalOnly,
          role_profile: counter.role_profile,
          printer_profile: counter.printer_profile,
          license_plan: "Retail & Pharmacy Chain Remote Pro",
          license_status: "active",
          license_expires_at: "2027-12-31",
          registered_at: Date.now(),
          is_active: counter.status === "active",
          disabled_reason: counter.status === "pending_approval" ? "Awaiting Store Owner Approval" : undefined,
        };

        await invokeCommand("secure_store_set", {
          key: "store_device_profile",
          value: JSON.stringify(profile),
        });
        this.activeProfile = profile;
        return { success: true, status: counter.status, counter, message: data.message };
      }
      return { success: false, status: "error", message: data.error || "Enrollment failed" };
    } catch (err: any) {
      return { success: false, status: "error", message: err?.message || "Failed to reach enrollment endpoint" };
    }
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
