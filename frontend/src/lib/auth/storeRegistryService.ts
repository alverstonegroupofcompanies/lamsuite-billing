import { invokeCommand } from "../ipc/ipcBridge";
import { sqliteStorage } from "../db/sqliteStorage";
import { companySettingsService } from "../settings/companySettingsService";
import { posCartService } from "../billing/posCartService";
import { printerManagerService } from "../printing/printerManagerService";
import { staffAuthService } from "./staffAuthService";
import { storeDeviceService, type StoreDeviceProfile } from "./storeDeviceService";
import { deviceSessionService } from "../devices/deviceSessionService";

export interface RegisteredStoreRecord {
  id: string; // e.g. "store_main", "store_north"
  name: string; // e.g. "LamStone Pharmacy & Clinic (Main Store)"
  alias: string; // e.g. "Main Branch"
  code: string; // e.g. "MAIN"
  color: string; // e.g. "#059669"
  color_badge: string; // e.g. "emerald", "blue", "purple", "amber", "rose", "indigo"
  db_path: string; // relative to stores directory, e.g. "stores/store_main/store.sqlite"
  counter_id: string;
  counter_name: string;
  counter_code: string;
  store_type?: string;
  gst_type?: string;
  is_hub: boolean;
  registered_at: number;
  last_opened_at: number;
  last_sync_at: number | null;
  pending_sync_count: number;
  sync_status: "synced" | "pending" | "offline" | "revoked" | "disabled";
  is_active: boolean;
  license_status: "active" | "trial" | "expired" | "grace_period" | "revoked";
  disabled_reason?: string;
}

export interface StoreRegistryData {
  stores: RegisteredStoreRecord[];
  active_store_id: string | null;
  auto_open_last: boolean;
}

const REGISTRY_STORAGE_KEY = "lamsuite_stores_registry";

export const STORE_PRESET_COLORS = [
  { label: "Emerald (Primary)", hex: "#059669", badge: "emerald", border: "border-emerald-500", bg: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
  { label: "Sky Blue", hex: "#0284c7", badge: "blue", border: "border-sky-500", bg: "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300" },
  { label: "Royal Purple", hex: "#7c3aed", badge: "purple", border: "border-purple-500", bg: "bg-purple-50 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300" },
  { label: "Amber Gold", hex: "#d97706", badge: "amber", border: "border-amber-500", bg: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  { label: "Crimson Rose", hex: "#e11d48", badge: "rose", border: "border-rose-500", bg: "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300" },
  { label: "Indigo Slate", hex: "#4f46e5", badge: "indigo", border: "border-indigo-500", bg: "bg-indigo-50 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300" },
];

export class StoreRegistryService {
  private registry: StoreRegistryData = {
    stores: [],
    active_store_id: null,
    auto_open_last: true,
  };
  private isLoaded = false;
  private listeners: Set<(registry: StoreRegistryData) => void> = new Set();

  onRegistryChange(fn: (registry: StoreRegistryData) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener({ ...this.registry, stores: [...this.registry.stores] });
    }
  }

  async loadRegistry(): Promise<StoreRegistryData> {
    try {
      const res = await invokeCommand<StoreRegistryData>("store_registry_get").catch(() => null);
      if (res && Array.isArray(res.stores) && res.stores.length > 0) {
        this.registry = {
          stores: res.stores,
          active_store_id: res.active_store_id || null,
          auto_open_last: res.auto_open_last ?? true,
        };
        if (this.registry.active_store_id && typeof window !== "undefined" && window.localStorage) {
          try {
            window.localStorage.setItem("lamsuite_active_store_id", String(this.registry.active_store_id));
          } catch {}
        }
        this.isLoaded = true;
        return this.registry;
      }
    } catch {
      // ignore
    }

    // Check localStorage fallback for browser / mock mode
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const raw = window.localStorage.getItem(REGISTRY_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.stores)) {
            this.registry = parsed;
            this.isLoaded = true;
            return this.registry;
          }
        }
      } catch {
        // ignore
      }
    }

    // Auto-migrate legacy single-store setup if exists
    await this.migrateLegacySingleStore();
    this.isLoaded = true;
    return this.registry;
  }

  private async migrateLegacySingleStore(): Promise<void> {
    // If we already have registered stores, never overwrite with legacy migration
    if (this.registry.stores && this.registry.stores.length > 0) {
      return;
    }

    const legacyProfileJson = await invokeCommand<string | null>("secure_store_get", {
      key: "store_device_profile",
    }).catch(() => null);

    if (legacyProfileJson) {
      try {
        const legacy: StoreDeviceProfile = JSON.parse(legacyProfileJson);
        const storeId = legacy.store_id || "store_main";

        // Migrate tokens to per-store keying
        const deviceToken = await invokeCommand<string | null>("secure_store_get", {
          key: "device_token",
        }).catch(() => null);
        const refreshToken = await invokeCommand<string | null>("secure_store_get", {
          key: "refresh_token",
        }).catch(() => null);

        if (deviceToken) {
          await invokeCommand("secure_store_set", {
            key: `store:${storeId}:device_token`,
            value: deviceToken,
          }).catch(() => {});
        }
        if (refreshToken) {
          await invokeCommand("secure_store_set", {
            key: `store:${storeId}:refresh_token`,
            value: refreshToken,
          }).catch(() => {});
        }
        await invokeCommand("secure_store_set", {
          key: `store:${storeId}:profile`,
          value: legacyProfileJson,
        }).catch(() => {});

        const initialRecord: RegisteredStoreRecord = {
          id: storeId,
          name: legacy.store_name || "LamStone Pharmacy & Clinic (Main Store)",
          alias: "Main Store",
          code: legacy.store_code || "MAIN",
          color: "#059669",
          color_badge: "emerald",
          db_path: `stores/${storeId}/store.sqlite`,
          counter_id: legacy.counter_id,
          counter_name: legacy.counter_name || "Counter 01",
          counter_code: legacy.counter_code || "C01",
          is_hub: Boolean(legacy.is_hub),
          registered_at: legacy.registered_at || Date.now(),
          last_opened_at: Date.now(),
          last_sync_at: Date.now(),
          pending_sync_count: 0,
          sync_status: "synced",
          is_active: legacy.is_active !== false,
          license_status: legacy.license_status || "active",
        };

        this.registry.stores = [initialRecord];
        this.registry.active_store_id = storeId;
        this.registry.auto_open_last = true;
        await this.saveRegistry();
      } catch (err) {
        console.warn("Legacy single store migration error:", err);
      }
    }
  }

  async saveRegistry(): Promise<void> {
    try {
      await invokeCommand("store_registry_save", { registry: this.registry }).catch(() => {});
    } catch {
      // ignore
    }

    if (typeof window !== "undefined" && window.localStorage) {
      try {
        window.localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(this.registry));
      } catch {
        // ignore
      }
    }
    this.notify();
  }

  getRegistry(): StoreRegistryData {
    return this.registry;
  }

  getStores(): RegisteredStoreRecord[] {
    return this.registry.stores;
  }

  getActiveStore(): RegisteredStoreRecord | null {
    let activeId = this.registry.active_store_id;
    if (!activeId && typeof window !== "undefined" && window.localStorage) {
      try {
        activeId = window.localStorage.getItem("lamsuite_active_store_id");
      } catch {}
    }
    if (!activeId) return null;
    return this.registry.stores.find((s) => String(s.id) === String(activeId)) || null;
  }

  getActiveStoreColor() {
    const active = this.getActiveStore();
    if (!active) return STORE_PRESET_COLORS[0];
    return STORE_PRESET_COLORS.find((c) => c.badge === active.color_badge || c.hex === active.color) || STORE_PRESET_COLORS[0];
  }

  async setAutoOpenLast(enable: boolean): Promise<void> {
    this.registry.auto_open_last = enable;
    await this.saveRegistry();
  }

  /**
   * Registers a newly paired store and stores its credentials.
   * CNT-008: the store owns the slot on this machine, so a store holds one
   * counter. Re-claiming that counter refreshes its credential in place; a
   * different counter claimed into the same store is refused, not stacked.
   */
  async registerStore(
    profile: StoreDeviceProfile,
    tokens: { deviceToken: string; refreshToken: string },
    options?: { alias?: string; color_badge?: string }
  ): Promise<RegisteredStoreRecord> {
    const existing = this.registry.stores.find((s) => String(s.id) === String(profile.store_id));
    if (existing) {
      const sameCounter =
        String(existing.counter_id) === String(profile.counter_id) ||
        (existing.counter_name || "").trim().toLowerCase() === (profile.counter_name || "").trim().toLowerCase();
      if (!sameCounter) {
        throw new Error(
          `This workstation already works "${existing.counter_name}" in "${existing.name}". Release that counter before claiming another one here.`
        );
      }
    }

    const colorPreset = options?.color_badge
      ? STORE_PRESET_COLORS.find((c) => c.badge === options.color_badge) || STORE_PRESET_COLORS[0]
      : STORE_PRESET_COLORS[this.registry.stores.length % STORE_PRESET_COLORS.length];

    const identity: Partial<RegisteredStoreRecord> = {
      id: profile.store_id,
      name: profile.store_name,
      code: profile.store_code,
      counter_id: profile.counter_id,
      counter_name: profile.counter_name,
      counter_code: profile.counter_code,
      is_hub: profile.is_hub,
      is_active: profile.is_active !== false,
      license_status: profile.license_status || "active",
      last_sync_at: Date.now(),
      pending_sync_count: 0,
      sync_status: "synced",
    };

    let record: RegisteredStoreRecord;
    if (existing) {
      Object.assign(existing, identity);
      record = existing;
    } else {
      record = {
        ...identity,
        alias: options?.alias || profile.store_name.split("(")[0].trim(),
        color: colorPreset.hex,
        color_badge: colorPreset.badge,
        db_path: `stores/${profile.store_id}/store.sqlite`,
        registered_at: profile.registered_at || Date.now(),
        last_opened_at: Date.now(),
      } as RegisteredStoreRecord;
      this.registry.stores.push(record);
    }

    // Save per-store tokens and profile securely
    await invokeCommand("secure_store_set", {
      key: `store:${profile.store_id}:device_token`,
      value: tokens.deviceToken,
    }).catch(() => {});
    await invokeCommand("secure_store_set", {
      key: `store:${profile.store_id}:refresh_token`,
      value: tokens.refreshToken,
    }).catch(() => {});
    await invokeCommand("secure_store_set", {
      key: `store:${profile.store_id}:profile`,
      value: JSON.stringify(profile),
    }).catch(() => {});

    this.registry.active_store_id = profile.store_id;
    await this.saveRegistry();

    // Switch DB connection to target store so initial data writes go to the right store database
    await sqliteStorage.switchStore(profile.store_id, record.db_path).catch(() => {});

    // The claim lands in this store's own database and becomes the credential
    // the till works, never a copy left behind in whichever store was open.
    await this.applyActiveIdentity(profile.store_id, record);

    return record;
  }

  /**
   * CNT-008: the flat `device_token`/`store_device_profile` keys are only ever
   * a mirror of the store the till is standing in. Switching to a store puts
   * that store's own credential there, and a store that goes away hands the
   * mirror to the next one — so no store can bill on another's counter.
   */
  private async applyActiveIdentity(storeId: string | null, record?: RegisteredStoreRecord): Promise<void> {
    if (!storeId) {
      await invokeCommand("secure_store_delete", { key: "device_token" }).catch(() => {});
      await invokeCommand("secure_store_delete", { key: "store_device_profile" }).catch(() => {});
      storeDeviceService.clearProfileCache();
      return;
    }

    const id = String(storeId);

    const token = await invokeCommand<string | null>("secure_store_get", {
      key: `store:${id}:device_token`,
    }).catch(() => null);

    if (token) {
      await invokeCommand("secure_store_set", { key: "device_token", value: token }).catch(() => {});
    } else {
      // Never leave the previous store's token active for the new store.
      await invokeCommand("secure_store_delete", { key: "device_token" }).catch(() => {});
    }

    let profileJson = await invokeCommand<string | null>("secure_store_get", {
      key: `store:${id}:profile`,
    }).catch(() => null);

    if (!profileJson && record) {
      profileJson = JSON.stringify(this.profileFromRecord(record));
      await invokeCommand("secure_store_set", {
        key: `store:${id}:profile`,
        value: profileJson,
      }).catch(() => {});
    }

    if (profileJson) {
      await invokeCommand("secure_store_set", {
        key: "store_device_profile",
        value: profileJson,
      }).catch(() => {});
      try {
        storeDeviceService.setProfile(JSON.parse(profileJson));
      } catch {
        storeDeviceService.clearProfileCache();
      }
    } else {
      await invokeCommand("secure_store_delete", { key: "store_device_profile" }).catch(() => {});
      storeDeviceService.clearProfileCache();
    }
  }

  private profileFromRecord(target: RegisteredStoreRecord): StoreDeviceProfile {
    return {
      device_id: target.counter_id,
      device_uuid: `dev_${target.id}_${Date.now()}`,
      device_name: target.counter_name,
      store_id: target.id,
      store_name: target.name,
      store_code: target.code,
      counter_id: target.counter_id,
      counter_name: target.counter_name,
      counter_code: target.counter_code,
      is_hub: target.is_hub,
      license_plan: "Retail & Pharmacy Chain Pro",
      license_status: target.license_status || "active",
      license_expires_at: "2027-12-31",
      registered_at: target.registered_at,
      is_active: target.is_active,
    };
  }

  async updateStoreMeta(
    storeId: string,
    updates: Partial<Pick<RegisteredStoreRecord, "alias" | "name" | "color" | "color_badge" | "is_active" | "sync_status" | "pending_sync_count" | "disabled_reason">>
  ): Promise<RegisteredStoreRecord> {
    const store = this.registry.stores.find((s) => s.id === storeId);
    if (!store) throw new Error(`Store ${storeId} not found in registry`);

    Object.assign(store, updates);
    if (updates.color_badge) {
      const preset = STORE_PRESET_COLORS.find((c) => c.badge === updates.color_badge);
      if (preset) store.color = preset.hex;
    }
    await this.saveRegistry();
    return store;
  }

  async reorderStores(reorderedIds: string[]): Promise<void> {
    const map = new Map(this.registry.stores.map((s) => [s.id, s]));
    const nextList: RegisteredStoreRecord[] = [];
    for (const id of reorderedIds) {
      const item = map.get(id);
      if (item) {
        nextList.push(item);
        map.delete(id);
      }
    }
    // Append any not explicitly listed
    for (const remaining of map.values()) {
      nextList.push(remaining);
    }
    this.registry.stores = nextList;
    await this.saveRegistry();
  }

  async setStoreActiveStatus(storeId: string, isActive: boolean, reason?: string): Promise<void> {
    const store = this.registry.stores.find((s) => String(s.id) === String(storeId));
    // SYNC-02: the store's licence says nothing about a counter this machine
    // was retired from. A revoked record changes only through a fresh claim.
    if (store?.sync_status === "revoked") return;
    if (store) {
      store.is_active = isActive;
      store.sync_status = isActive ? "synced" : "disabled";
      if (reason) store.disabled_reason = reason;
      await this.saveRegistry();
    }
  }

  /**
   * Destructively wipes local data for a reset store according to the reset
   * options chosen in the admin panel. Product catalog is kept unless
   * reset_products is set; party masters are deleted with reset_customers.
   */
  /**
   * Applies a remote store reset exactly once. Callers may identify the reset
   * either by its timestamp, its sync-event id, or both. Markers are written
   * even if the wipe throws part-way so a failing call cannot re-wipe on every
   * poll/reconnect.
   */
  async applyRemoteResetOnce(
    storeId: string,
    resetAt?: string | null,
    options?: {
      reset_stock?: boolean;
      reset_products?: boolean;
      reset_invoices?: boolean;
      reset_purchases?: boolean;
      reset_customers?: boolean;
      reset_expenses?: boolean;
      reset_held_bills?: boolean;
    },
    eventId?: number | string | null
  ): Promise<boolean> {
    if (!storeId) return false;
    const ls = typeof window !== "undefined" ? window.localStorage : null;
    const tsKey = `lamsuite_last_applied_reset_${storeId}`;
    const eventKey = `lamsuite_last_applied_reset_event_${storeId}`;
    const numericEventId = Number(eventId || 0);

    try {
      if (resetAt && ls && ls.getItem(tsKey) === resetAt) {
        return false;
      }
      if (numericEventId && ls && numericEventId <= Number(ls.getItem(eventKey) || 0)) {
        return false;
      }
    } catch {
      // localStorage unavailable: fall through and apply
    }

    try {
      await this.wipeStoreTransactionalData(storeId, options);
    } finally {
      try {
        if (ls) {
          if (resetAt) ls.setItem(tsKey, resetAt);
          if (numericEventId) ls.setItem(eventKey, String(numericEventId));
        }
      } catch {}
    }
    return true;
  }

  async wipeStoreTransactionalData(
    storeId: string,
    options?: {
      reset_stock?: boolean;
      reset_products?: boolean;
      reset_invoices?: boolean;
      reset_purchases?: boolean;
      reset_customers?: boolean;
      reset_expenses?: boolean;
      reset_held_bills?: boolean;
    }
  ): Promise<void> {
    const currentActiveId = this.registry.active_store_id;
    const isCurrentActive = String(currentActiveId) === String(storeId);

    const store = this.registry.stores.find((s) => String(s.id) === String(storeId));
    if (!store) {
      // Store is not registered on this workstation: never wipe whichever
      // store database happens to be active.
      return;
    }
    if (!isCurrentActive) {
      await sqliteStorage.switchStore(store.id, store.db_path).catch(() => {});
    }

    const resetInvoices = options?.reset_invoices !== false;
    const resetStock = options?.reset_stock !== false;
    const resetProducts = options?.reset_products === true;
    const resetPurchases = options?.reset_purchases !== false;
    const resetCustomers = options?.reset_customers !== false;
    const resetExpenses = options?.reset_expenses !== false;
    const resetHeldBills = options?.reset_held_bills !== false;

    const tablesToClear: string[] = [];

    if (resetInvoices) {
      tablesToClear.push("invoices", "invoice_items", "invoice_payments", "sales_returns", "sync_queue");
    }
    if (resetPurchases) {
      tablesToClear.push("purchase_documents", "purchases", "purchase_items", "purchase_returns", "supplier_payments");
    }
    if (resetStock) {
      tablesToClear.push("stock_transactions", "stock_adjustments", "counter_stock_deltas");
    }
    if (resetProducts) {
      tablesToClear.push("products", "product_batches");
      if (typeof window !== "undefined" && window.localStorage) {
        try {
          window.localStorage.setItem(`catalog_wiped_${storeId}`, "true");
        } catch {}
      }
    }
    if (resetCustomers) {
      tablesToClear.push(
        "customers",
        "suppliers",
        "doctors",
        "patients",
        "customer_payments",
        "supplier_payments",
        "party_ledger_entries"
      );
    }
    if (resetExpenses) {
      tablesToClear.push("expenses");
    }
    if (resetHeldBills) {
      tablesToClear.push("distributed_held_bills");
    }

    for (const table of tablesToClear) {
      await sqliteStorage.clearTable(table).catch(() => {});
    }

    // When resetting stock without wiping products, reset batch stock_qty and product current_stock to 0 (clearing oversold negative stock)
    if (resetStock && !resetProducts) {
      try {
        const batches = await sqliteStorage.findAll<any>("product_batches").catch(() => []);
        if (batches && batches.length > 0) {
          const resetBatches = batches.map((b) => ({
            id: String(b.id),
            record: {
              ...b,
              stock_qty: 0,
              updated_at: Date.now(),
            },
          }));
          await sqliteStorage.insertBatch("product_batches", resetBatches).catch(() => {});
        }
      } catch (e) {
        console.warn("Failed to reset batch stock:", e);
      }

      try {
        const prods = await sqliteStorage.findAll<any>("products").catch(() => []);
        if (prods && prods.length > 0) {
          const resetProds = prods.map((p) => ({
            id: String(p.id),
            record: {
              ...p,
              current_stock: 0,
              updated_at: Date.now(),
            },
          }));
          await sqliteStorage.insertBatch("products", resetProds).catch(() => {});
        }
      } catch (e) {
        console.warn("Failed to reset product current_stock:", e);
      }
    }

    // Also clear localStorage keys if mock/web
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k) {
            for (const table of tablesToClear) {
              if (
                k === `lamsuite_tbl_${table}` ||
                k === `lamsuite_tbl_${storeId}_${table}` ||
                k.startsWith(`lamsuite_tbl_${storeId}_${table}`)
              ) {
                keysToRemove.push(k);
              }
            }
          }
        }
        for (const k of keysToRemove) {
          window.localStorage.removeItem(k);
        }
      } catch {}
    }

    if (isCurrentActive && resetInvoices) {
      posCartService.clearCart();
      await companySettingsService
        .saveLocalSettings(
          {
            next_invoice_number: 1001,
            sequences: {
              ...companySettingsService.getSettings()?.sequences,
              nextInvoiceNumber: 1001,
            },
          })
        .catch(() => {});
    } else if (currentActiveId) {
      const activeStore = this.registry.stores.find((s) => String(s.id) === String(currentActiveId));
      if (activeStore) {
        await sqliteStorage.switchStore(activeStore.id, activeStore.db_path).catch(() => {});
      }
    }

    this.notify();
  }

  /**
   * Disconnects a store from this workstation terminal.
   * Optionally deletes or retains local database.
   */
  async disconnectStore(storeId: string, deleteData = false): Promise<void> {
    const store = this.registry.stores.find((s) => s.id === storeId);
    if (!store) throw new Error(`Store ${storeId} not found in registry`);

    // Remove per-store credentials from secure vault
    await invokeCommand("secure_store_delete", { key: `store:${storeId}:device_token` }).catch(() => {});
    await invokeCommand("secure_store_delete", { key: `store:${storeId}:refresh_token` }).catch(() => {});
    await invokeCommand("secure_store_delete", { key: `store:${storeId}:profile` }).catch(() => {});

    if (deleteData) {
      // In mock/localStorage, clear tables
      if (typeof window !== "undefined" && window.localStorage) {
        try {
          const keysToRemove: string[] = [];
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k && k.startsWith(`lamsuite_tbl_${storeId}_`)) {
              keysToRemove.push(k);
            }
          }
          for (const k of keysToRemove) {
            window.localStorage.removeItem(k);
          }
        } catch {
          // ignore
        }
      }
    }

    this.registry.stores = this.registry.stores.filter((s) => String(s.id) !== String(storeId));
    const wasActive = String(this.registry.active_store_id) === String(storeId);
    if (wasActive) {
      this.registry.active_store_id = this.registry.stores.length > 0 ? this.registry.stores[0].id : null;

      // CNT-008: releasing the store the till works leaves it standing in the
      // next store's database and on the next store's credential — never on
      // the counters of the store it just let go of.
      const next = this.getActiveStore();
      if (next) {
        await sqliteStorage.switchStore(next.id, next.db_path).catch(() => {});
        await this.applyActiveIdentity(next.id, next);
      } else {
        await this.applyActiveIdentity(null);
      }
    }
    await this.saveRegistry();
  }

  /**
   * Switches the active workstation store to targetStoreId.
   * High performance, clean closing and loading in under 1 second.
   */
  async switchActiveStore(targetStoreId: string | number, force = false): Promise<RegisteredStoreRecord> {
    const idStr = String(targetStoreId);
    let target = this.registry.stores.find((s) => String(s.id) === idStr);

    if (!target) {
      // Reload registry in case state was updated by another process/window
      await this.loadRegistry();
      target = this.registry.stores.find((s) => String(s.id) === idStr);
    }

    if (!target) {
      throw new Error(`Target store ${targetStoreId} not found in registered stores list (available: ${this.registry.stores.map((s) => s.id).join(", ")})`);
    }

    if (String(this.registry.active_store_id) === idStr && !force) {
      return target;
    }

    // Check unsaved cart items
    if (!force && posCartService.hasUnsavedItems()) {
      throw new Error("UNSAVED_CART_ITEMS");
    }

    // 1. Flush/Close current store DB & switch connection
    await sqliteStorage.switchStore(idStr, target.db_path);

    // Units are store-scoped: the newly active store always has its default set.
    // Dynamic import keeps the units <-> sync-queue module graph acyclic.
    import("../masters/unitsStore")
      .then(({ unitsStore }) => unitsStore.seedDefaultsIfEmpty())
      .catch(() => {});

    // 2. Load and set the target store's device profile & tokens in memory
    await this.applyActiveIdentity(idStr, target);

    // 3. Clear transient singletons & active cart
    posCartService.resetCart();
    printerManagerService.clearCache();
    staffAuthService.logout();

    // IS9: each store keeps the document of the counter claimed for it, so the
    // surface follows the store. Dynamic import keeps the module graph acyclic.
    import("./counterSessionService")
      .then(({ counterSessionService }) =>
        counterSessionService.hydrate().then(() => counterSessionService.refresh())
      )
      .catch(() => {});

    // 4. Update last opened timestamp
    target.last_opened_at = Date.now();
    this.registry.active_store_id = idStr;
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        window.localStorage.setItem("lamsuite_active_store_id", idStr);
      } catch {}
    }
    await this.saveRegistry();

    // 5. Reload company settings for the new store from database or local fallback
    try {
      await companySettingsService.fetchRemoteSettings(idStr);
    } catch (_) {
      await companySettingsService.loadSettings();
    }

    // 6. Broadcast device presence heartbeat under new active store.
    // B8b: presence belongs to the counter claimed for this store, not to an
    // operator — nobody signs in at the till any more.
    const claimedCounter = (await storeDeviceService.getDeviceProfile().catch(() => null))?.counter_id;
    if (claimedCounter) {
      deviceSessionService.sendHeartbeat({ store_id: idStr }).catch(() => {});
    }

    return target;
  }
}

export const storeRegistryService = new StoreRegistryService();
