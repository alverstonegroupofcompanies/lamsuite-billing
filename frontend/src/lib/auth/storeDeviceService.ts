import { invokeCommand } from "../ipc/ipcBridge";
import { APP_VERSION } from "../../config/version";
import { sqliteStorage } from "../db/sqliteStorage";
import { companySettingsService } from "../settings/companySettingsService";
import { staffCryptoService } from "./staffCryptoService";
import { validatePassword, validatePin } from "./credentialPolicy";
import { detectDeviceFriendlyName, getOrCreateClientDeviceUuid } from "./clientDeviceIdentifier";
import { productsStore } from "../masters/productsStore";
import { partiesStore } from "../masters/partiesStore";
import { counterSequenceService } from "./counterSequenceService";
import {
  GRACE_EXPIRED_MESSAGE,
  counterGraceService,
  type GraceArm,
} from "./counterGraceService";
import {
  API_BASE_URL,
  DEFAULT_LAN_PORT,
  getCandidateApiUrls,
  setApiBaseUrl,
} from "../../config/env";

export interface StoreDeviceProfile {
  device_id: string;
  device_uuid: string;
  device_name: string;
  store_id: string;
  store_name: string;
  store_code: string;
  counter_id: string;
  /** The id the store server knows this counter by — its number series key. */
  server_counter_id?: number;
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

/**
 * The key this till's number series are filed under.
 *
 * A claim writes the counter's server id as `server_counter_id`; older profiles
 * only carry the local `cntr_<n>` id. Reading `counter_id` with `Number()` made
 * the till key its series by NaN, so the POS and the heartbeat held two cursors.
 * Every reader goes through this one function now.
 */
export function counterSequenceKey(
  profile:
    | Pick<StoreDeviceProfile, "server_counter_id" | "counter_id" | "counter_code">
    | null
    | undefined,
  fallbackCode?: string | null
): number | string {
  const server = Number(profile?.server_counter_id);
  if (Number.isFinite(server) && server > 0) return server;

  const local = String(profile?.counter_id ?? "").trim();
  const fromLocalId = /^cntr_(\d+)$/i.exec(local)?.[1];
  if (fromLocalId && Number(fromLocalId) > 0) return Number(fromLocalId);
  if (/^\d+$/.test(local) && Number(local) > 0) return Number(local);
  if (local) return local;

  return String(profile?.counter_code || fallbackCode || "C01").toUpperCase();
}

/**
 * CNT-006 / CNT-013: a till is handed either a typed code or the QR the admin
 * panel prints. The QR carries store and counter ids, and only the code is
 * ever sent back — the server reads the tenancy off the code (IS2).
 */
/**
 * SYNC-02: where a retired counter's token waits while its offline bills are
 * sent. The name ends in "device_token" so the vault treats it as a credential
 * and never copies it to web storage.
 */
export const RETIRED_TOKEN_KEY = "retired_device_token";

export function extractClaimCode(input: string): string {
  const raw = String(input ?? "").trim();

  if (!raw) {
    throw new Error("Enter the counter activation code from the store owner.");
  }

  if (raw.startsWith("{")) {
    let payload: any = null;
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      payload = null;
    }
    if (payload?.kind === "lam_suite_counter_claim" && String(payload.code ?? "").trim()) {
      return String(payload.code).trim().toUpperCase();
    }
    throw new Error("That QR is not a LamSuite counter activation code.");
  }

  return raw.toUpperCase();
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

  async getDeviceToken(): Promise<string | null> {
    return await invokeCommand<string | null>("secure_store_get", { key: "device_token" }).catch(() => null);
  }

  /**
   * Headers that authenticate this workstation to device-scoped backend routes.
   * The legacy `device_token` key always tracks the active store, so the store
   * header is required to let the server reject a mismatched token.
   */
  async getDeviceAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};
    try {
      const profile = await this.getDeviceProfile();
      const token = await this.getDeviceToken();
      if (token) headers["X-Device-Token"] = token;
      if (profile?.device_uuid) headers["X-Device-UUID"] = profile.device_uuid;
      // A local registry key ("store_main") is not a server store; sending it
      // would be treated as a tenant-isolation violation.
      if (profile?.store_id && !/^store_/i.test(String(profile.store_id))) {
        headers["X-Store-Id"] = String(profile.store_id);
        headers["Store-Id"] = String(profile.store_id);
      }
    } catch (_) {
      // Unregistered or secure store unavailable: callers proceed without headers.
    }
    return headers;
  }

  async getDeviceProfile(): Promise<StoreDeviceProfile | null> {
    if (this.activeProfile) return this.activeProfile;

    const storedJson = await invokeCommand<string | null>("secure_store_get", {
      key: "store_device_profile",
    });

    if (storedJson) {
      try {
        this.activeProfile = JSON.parse(storedJson) as StoreDeviceProfile;
        await this.knownCounterSeries();
        await this.knownGraceWindow();
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
        server_counter_id: Number(c.server_counter_id ?? String(c.id).replace(/^cntr_/i, "")) || undefined,
        counter_name: c.counter_name,
        counter_code: c.counter_code || "C01",
        is_hub: Boolean(c.is_hub),
        license_plan: "Retail & Pharmacy Chain Pro",
        license_status: "active",
        license_expires_at: "2027-12-31",
        registered_at: c.created_at,
        is_active: c.status === "active",
      };
      await this.knownCounterSeries();
      await this.knownGraceWindow();
      return this.activeProfile;
    }

    return null;
  }

  /**
   * CNT-014: read the counter's own number series into the till, so the POS can
   * show a number before it can await the server. A till that holds none asks
   * the server what this counter is up to rather than starting at 1001 again.
   */
  private async knownCounterSeries(): Promise<void> {
    const profile = this.activeProfile;
    if (!profile) return;

    // A profile that names no counter has no series to read; asking the store
    // server would name a counter this till is not on.
    const key = counterSequenceKey(profile, profile.counter_code);
    if (typeof key !== "number") return;
    if (counterSequenceService.hasSeries(key)) return;

    await counterSequenceService.hydrate(key, profile.counter_code || "C01");
    if (counterSequenceService.hasSeries(key)) return;

    const token = await this.getDeviceToken();
    const storeId = String(profile.store_id || "");

    await counterSequenceService
      .pull({
        baseUrl: API_BASE_URL,
        token,
        storeId: /^\d+$/.test(storeId) ? storeId : undefined,
      })
      .catch(() => null);
  }

  /** CNT-011: the counter whose offline window this till is honouring. */
  private graceKey(): string | null {
    const profile = this.activeProfile;
    if (!profile) return null;

    const key = profile.server_counter_id ?? profile.counter_id ?? profile.device_id;
    return key === undefined || key === null || String(key) === "" ? null : String(key);
  }

  /**
   * CNT-011: a window the till was granted earlier keeps closing across
   * restarts, so boot reads the stored deadline back instead of letting the
   * machine pretend it has never been offline.
   */
  private async knownGraceWindow(): Promise<void> {
    const key = this.graceKey();
    if (!key) return;

    await counterGraceService.hydrate(key).catch(() => null);
  }

  /** CNT-011: a clean handshake renews the window; a refusal renews nothing. */
  private async renewGraceWindow(answer: GraceArm | null | undefined): Promise<void> {
    const key = this.graceKey();
    if (!key) return;

    counterGraceService.use(key);
    await counterGraceService.arm(key, answer).catch(() => null);
  }

  /**
   * CNT-006: the only registration path a counter computer runs. The code is
   * the whole credential — no owner login, no store key, no local naming of
   * the counter. Everything about the tenancy comes back from the server.
   */
  async claimCounter(
    input: string,
    onProgress?: (step: string, percent: number) => void
  ): Promise<StoreDeviceProfile> {
    const code = extractClaimCode(input);
    const deviceUuid = getOrCreateClientDeviceUuid();
    const deviceName = detectDeviceFriendlyName();

    onProgress?.("Checking the counter code with the store server...", 20);

    const candidateUrls = getCandidateApiUrls();
    let response: Response | null = null;
    let successfulUrl = candidateUrls[0];
    let unreachable = "";

    for (let i = 0; i < candidateUrls.length; i++) {
      const targetUrl = candidateUrls[i];
      try {
        if (candidateUrls.length > 1 && i > 0) {
          onProgress?.(`Trying the alternative server (${targetUrl})...`, 25);
        }

        const res = await fetch(`${targetUrl}/api/counters/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            code,
            device_uuid: deviceUuid,
            device_name: deviceName,
            app_version: APP_VERSION,
          }),
        });

        if (res.ok) {
          response = res;
          successfulUrl = targetUrl;
          break;
        }

        const refused = await res.json().catch(() => ({}));
        // CNT-005: every refusal is one sentence, so a wrong code teaches
        // nothing about which half of it was wrong.
        throw new Error(
          refused.message ||
            "That activation code is not valid here. Ask the store owner for a current counter code."
        );
      } catch (err: any) {
        if (err instanceof TypeError) {
          unreachable = "Cannot reach the store server. A counter code needs one online activation.";
          continue;
        }
        throw err;
      }
    }

    if (!response) {
      throw new Error(unreachable || "Cannot reach the store server. A counter code needs one online activation.");
    }

    if (successfulUrl !== API_BASE_URL) {
      setApiBaseUrl(successfulUrl);
    }

    const data = await response.json();
    if (!data.success || !data.device_token || !data.counter || !data.store) {
      throw new Error("The server answered without a counter identity. Ask the owner to re-issue the code.");
    }

    const counter = data.counter;
    const store = data.store;
    const counterId = `cntr_${counter.id}`;

    const storeProfile: StoreDeviceProfile = {
      device_id: counterId,
      device_uuid: deviceUuid,
      device_name: deviceName,
      store_id: String(store.id),
      store_name: store.name,
      store_code: store.code,
      counter_id: counterId,
      server_counter_id: Number(counter.id),
      counter_name: counter.counter_name,
      counter_code: counter.counter_code,
      location_name: counter.location_name || undefined,
      is_remote: Boolean(counter.is_remote),
      is_hub: false,
      is_digital_only: Boolean(counter.is_digital_only),
      printer_profile: counter.printer_profile || undefined,
      receipt_customization: counter.receipt_customization || undefined,
      license_plan: data.license_plan || "Retail & Pharmacy Chain Pro",
      license_status: "active",
      license_expires_at: data.license_expires_at || "2027-12-31",
      registered_at: Date.now(),
      is_active: true,
    };

    onProgress?.("Sealing the workstation token in the OS credential store...", 55);

    // CNT-008: the store record decides which local database and which
    // credential mirror this machine works, so it lands before any counter
    // data does. A claim that cannot be recorded is refused here, plainly,
    // rather than half-written into whichever store was last open.
    const { storeRegistryService } = await import("./storeRegistryService");
    await storeRegistryService.registerStore(storeProfile, {
      deviceToken: data.device_token,
      refreshToken: "",
    });

    this.activeProfile = storeProfile;

    onProgress?.("Writing the counter configuration...", 75);
    await sqliteStorage.insertRecord("store_counters", counterId, {
      id: counterId,
      server_counter_id: counter.id,
      store_id: storeProfile.store_id,
      store_name: storeProfile.store_name,
      store_code: storeProfile.store_code,
      counter_name: storeProfile.counter_name,
      counter_code: storeProfile.counter_code,
      device_uuid: deviceUuid,
      registered_via: "counter_code",
      is_hub: 0,
      ip_address: "127.0.0.1",
      port: DEFAULT_LAN_PORT,
      app_version: APP_VERSION,
      status: "active",
      pending_queue_count: 0,
      last_sync_at: Date.now(),
      created_at: Date.now(),
    });

    // CNT-014: the counter's number series comes with the claim, so the till
    // bills from the same series the server is holding.
    if (data.sequences?.items?.length) {
      try {
        await counterSequenceService.primeFromManifest(data.sequences);
      } catch (e) {
        console.warn("Counter series notice:", e);
      }
    } else {
      // A claim answered without the series still leaves the till on the
      // counter's count, not on a series it invented.
      await this.knownCounterSeries();
    }

    // CNT-011: the claim is the first watermark. The window the owner set for
    // this counter runs from here, so an offline till is not left to guess.
    await this.renewGraceWindow(data);

    // PRF-001: the document this till works inside arrives with the claim, so
    // the very first screen it draws is already the owner's surface. Read
    // lazily: the session service takes its headers from this module.
    const { counterSessionService } = await import("./counterSessionService");
    await counterSessionService.applyContext(data).catch((e) => console.warn("Counter profile notice:", e));

    onProgress?.(`Counter "${storeProfile.counter_name}" is live.`, 100);
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

      const body = await res.json().catch(() => ({}));

      // A server-side outage or proxy error is not a revocation. Never eject a
      // working operator (and drop an open cart) because the cloud is unhealthy.
      if (!res.ok) {
        if (res.status >= 500) {
          return { valid: true, locked: false };
        }

        const genuinelyRevoked =
          body?.status === "revoked" ||
          body?.status === "unrecognized" ||
          (body?.action === "lock_and_reset" && body?.status !== "store_inactive");

        if (genuinelyRevoked) {
          await this.lockAndResetWorkstation(body.wipe_on_revocation || false);
          return { valid: false, locked: true, reason: body.message || "Device unrecognized or revoked by server." };
        }

        // Pending approval, disabled store, transient auth/edge errors: report
        // the problem but keep the registered store selected.
        return {
          valid: false,
          locked: false,
          reason: body?.message || `Device validation unavailable (HTTP ${res.status}).`,
        };
      }

      if (body.valid === false) {
        if (body.action === "lock_and_reset" && body.status !== "store_inactive") {
          await this.lockAndResetWorkstation(body.wipe_on_revocation || false);
          return { valid: false, locked: true, reason: body.message || "Workstation revoked by server." };
        }
        return { valid: false, locked: false, reason: body.message };
      }

      // CNT-011: a clean handshake is a renewal — the window starts again from
      // the moment the server agreed to.
      await this.renewGraceWindow(body);

      return { valid: true };
    } catch (networkErr) {
      // Offline fallback: a counter still inside the window the store server
      // granted keeps working locally. Once that window closes the till stops,
      // and stops on its own clock — a spent grace is not a revocation, so the
      // claim it needs to reconnect with is left intact.
      const state = counterGraceService.state(this.graceKey() ?? counterGraceService.activeCounterKey());
      if (state.reason === "grace_expired") {
        return { valid: false, locked: true, reason: GRACE_EXPIRED_MESSAGE };
      }

      return { valid: true, locked: false };
    }
  }

  /** The credential of the counter this till was retired from, kept only while bills wait. */
  async getRetiredDeviceToken(): Promise<string | null> {
    return await invokeCommand<string | null>("secure_store_get", { key: RETIRED_TOKEN_KEY }).catch(() => null);
  }

  async clearRetiredDeviceToken(): Promise<void> {
    await invokeCommand("secure_store_delete", { key: RETIRED_TOKEN_KEY }).catch(() => {});
  }

  private async retireCredentialForUnsentBills(): Promise<void> {
    try {
      const token = await this.getDeviceToken();
      if (!token) return;
      // Read lazily: the sync queue already imports this module.
      const { syncQueueService } = await import("../sync/syncQueueService");
      if ((await syncQueueService.getUnsentCount()) === 0) return;
      await invokeCommand("secure_store_set", { key: RETIRED_TOKEN_KEY, value: token });
    } catch (_) {
      // Nothing to keep, or the vault is unavailable: the bills stay queued
      // for the next claim either way.
    }
  }

  async lockAndResetWorkstation(wipeLocalData = false): Promise<void> {
    this.activeProfile = null;
    this.isAccessRevoked = true;
    this.revocationReason = "Device token revoked by server";
    counterSequenceService.clearActiveCounter();
    await counterGraceService.clear();
    // IS9: a counter that is no longer this machine's takes its cached unlock
    // credential and its owner's idle minutes with it. Read lazily so the
    // counterLocking <-> storeDevice module graph stays acyclic.
    const { counterLockingService } = await import("./counterLockingService");
    await counterLockingService.clear();
    // IS9: the permission document goes with the counter it was read for.
    const { counterSessionService } = await import("./counterSessionService");
    await counterSessionService.clear();

    // SYNC-02 / CR Q1: bills this till saved before the owner retired it are
    // still the store's. The old token stops working everywhere except the one
    // door the server keeps for them, so it is set aside rather than lost.
    await this.retireCredentialForUnsentBills();

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
          // SYNC-02: "revoked", not just inactive. The store itself is still
          // licensed, and its licence check must not reopen a counter this
          // machine no longer holds; only a fresh claim does.
          await storeRegistryService.updateStoreMeta(activeStore.id, {
            is_active: false,
            sync_status: "revoked",
            disabled_reason: "This counter was re-issued or revoked by the store owner.",
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
    const passwordError = validatePassword(admin.password);
    if (passwordError) throw new Error(passwordError);
    const pinError = validatePin(admin.pin);
    if (pinError) throw new Error(pinError);

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
    counterSequenceService.clearActiveCounter();
    await counterGraceService.clear();
    // The counter's idle minutes and its cached unlock credential are wiped with
    // the rest of the store. Forgetting the counter first makes the purge cover
    // both cache tables, not only the row of the counter being wiped.
    const { counterLockingService } = await import("./counterLockingService");
    counterLockingService.unload();
    await counterLockingService.clear();
    // IS9: a reset leaves no counter's permission document behind in this store.
    const { counterSessionService } = await import("./counterSessionService");
    counterSessionService.unload();
    await counterSessionService.clear();
    await sqliteStorage.clearTable("counter_sessions");
    await sqliteStorage.clearTable("document_locks");
    await sqliteStorage.clearTable("distributed_held_bills");
    await sqliteStorage.clearTable("cash_shifts");

    this.activeProfile = null;
    this.isAccessRevoked = false;
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
}

export const storeDeviceService = new StoreDeviceService();
