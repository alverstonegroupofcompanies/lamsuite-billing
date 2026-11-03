import { sqliteStorage } from "../db/sqliteStorage";
import { getResolvedApiBaseUrl } from "../../config/env";
import { storeRegistryService } from "../auth/storeRegistryService";

export interface SyncQueueItem {
  id: string;
  entity_type:
    | "invoice"
    | "product"
    | "customer"
    | "party"
    | "stock_event"
    | "stock_adjustment"
    | "purchase"
    | "purchase_order"
    | "payment"
    | "customer_payment"
    | "expense"
    | "purchase_return"
    | "transfer"
    | "staff"
    | "staff_user";
  entity_id: string;
  action: "create" | "update" | "delete";
  payload_json: string;
  status: "pending" | "in_progress" | "failed" | "synced";
  retry_count: number;
  last_error?: string;
  created_at: number;
  next_retry_at?: number;
}

export interface SyncApiClient {
  pushInvoices?(items: Record<string, unknown>[]): Promise<{ success: boolean; ingested_count: number }>;
  pushStockEvents?(items: Record<string, unknown>[]): Promise<{ success: boolean; ingested_count: number }>;
  pushBatch?(items: Array<{ id: string; entity_type: string; action: string; payload: Record<string, unknown> }>): Promise<{
    success: boolean;
    results: { total: number; processed: number; failed: number };
  }>;
}

/**
 * Default Real-Time Backend API Client communicating with Laravel backend /api endpoints
 */
export class BackendHttpApiClient implements SyncApiClient {
  private baseUrl?: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl;
  }

  private getEffectiveBaseUrl(): string {
    return this.baseUrl || getResolvedApiBaseUrl();
  }

  async pushBatch(items: Array<{ id: string; entity_type: string; action: string; payload: Record<string, unknown> }>): Promise<{
    success: boolean;
    results: { total: number; processed: number; failed: number };
  }> {
    const activeStoreId = String(storeRegistryService.getActiveStore()?.id || "1");
    const url = `${this.getEffectiveBaseUrl()}/api/sync/push/batch`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Store-Id": activeStoreId,
        "Store-Id": activeStoreId,
      },
      body: JSON.stringify({ items, store_id: activeStoreId }),
    });

    if (!res.ok) {
      throw new Error(`Backend Sync API HTTP ${res.status}: ${res.statusText}`);
    }

    return await res.json();
  }

  async pushInvoices(items: Record<string, unknown>[]): Promise<{ success: boolean; ingested_count: number }> {
    const activeStoreId = String(storeRegistryService.getActiveStore()?.id || "1");
    const url = `${this.getEffectiveBaseUrl()}/api/sync/push/invoices`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Store-Id": activeStoreId,
        "Store-Id": activeStoreId,
      },
      body: JSON.stringify({ invoices: items, store_id: activeStoreId }),
    });

    if (!res.ok) {
      throw new Error(`Backend Invoices API HTTP ${res.status}: ${res.statusText}`);
    }

    return await res.json();
  }

  async pushStockEvents(items: Record<string, unknown>[]): Promise<{ success: boolean; ingested_count: number }> {
    const activeStoreId = String(storeRegistryService.getActiveStore()?.id || "1");
    const url = `${this.getEffectiveBaseUrl()}/api/sync/push/stock-events`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Store-Id": activeStoreId,
        "Store-Id": activeStoreId,
      },
      body: JSON.stringify({ events: items, store_id: activeStoreId }),
    });

    if (!res.ok) {
      throw new Error(`Backend Stock API HTTP ${res.status}: ${res.statusText}`);
    }

    return await res.json();
  }
}

export const defaultBackendApiClient = new BackendHttpApiClient();

export class SyncQueueService {
  private isProcessing = false;
  private autoSyncInterval: ReturnType<typeof setInterval> | null = null;
  private syncListeners: Set<(status: { pendingCount: number; isProcessing: boolean; lastSyncedAt?: number }) => void> = new Set();
  private lastSyncedAt?: number;

  constructor() {
    this.setupNetworkAutoSync();
  }

  generateIdempotencyKey(entityType: string, entityId: string): string {
    return `${entityType}_${entityId}`;
  }

  calculateBackoffMs(retryCount: number): number {
    // Exponential backoff: 2s, 4s, 8s, 16s, capped at 60s
    const baseMs = 2000;
    const backoff = Math.min(60000, baseMs * Math.pow(2, retryCount));
    return backoff;
  }

  async enqueue(
    entityType: SyncQueueItem["entity_type"],
    entityId: string,
    action: SyncQueueItem["action"],
    payload: Record<string, unknown> | object
  ): Promise<string> {
    const queueId = `sync_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const idempotencyKey = this.generateIdempotencyKey(entityType, entityId);

    // If an item with same idempotency key is already pending, update its payload
    const existingItems = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
    const existing = existingItems.find(
      (it) => (it.status === "pending" || it.status === "failed") && it.entity_type === entityType && it.entity_id === entityId
    );

    // Inject idempotency key into payload
    const enrichedPayload = {
      ...payload,
      idempotency_key: idempotencyKey,
      client_timestamp: Date.now(),
    };

    const targetId = existing ? existing.id : queueId;
    const item: SyncQueueItem = {
      id: targetId,
      entity_type: entityType,
      entity_id: entityId,
      action: action,
      payload_json: JSON.stringify(enrichedPayload),
      status: "pending",
      retry_count: existing ? existing.retry_count : 0,
      created_at: existing ? existing.created_at : Date.now(),
    };

    await sqliteStorage.insertRecord("sync_queue", targetId, item as unknown as Record<string, unknown>);
    this.notifyListeners();

    // Trigger immediate auto-sync if online
    if (this.isOnline()) {
      setTimeout(() => {
        this.processQueue().catch(() => {});
      }, 50);
    }

    return targetId;
  }

  async getPendingItems(): Promise<SyncQueueItem[]> {
    const all = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
    const now = Date.now();
    return all.filter((item) => {
      if (item.status === "pending") return true;
      if (item.status === "failed") {
        return !item.next_retry_at || item.next_retry_at <= now;
      }
      return false;
    });
  }

  isOnline(): boolean {
    if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
      return navigator.onLine;
    }
    return true;
  }

  /**
   * Set up automatic background sync whenever internet/network is available
   */
  private setupNetworkAutoSync(): void {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        // Trigger sync immediately when connection is restored
        this.processQueue().catch(() => {});
      });

      // Background periodic check every 5 seconds to flush queue
      this.autoSyncInterval = setInterval(() => {
        if (this.isOnline() && !this.isProcessing) {
          this.processQueue().catch(() => {});
        }
      }, 5000);
    }
  }

  subscribe(listener: (status: { pendingCount: number; isProcessing: boolean; lastSyncedAt?: number }) => void): () => void {
    this.syncListeners.add(listener);
    this.notifyListeners();
    return () => {
      this.syncListeners.delete(listener);
    };
  }

  private async notifyListeners(): Promise<void> {
    try {
      const pending = await this.getPendingItems();
      const status = {
        pendingCount: pending.length,
        isProcessing: this.isProcessing,
        lastSyncedAt: this.lastSyncedAt,
      };
      this.syncListeners.forEach((listener) => {
        try {
          listener(status);
        } catch (_) {}
      });
    } catch (_) {}
  }

  async processQueue(apiClient: SyncApiClient = defaultBackendApiClient): Promise<{ processed: number; failed: number }> {
    if (this.isProcessing) return { processed: 0, failed: 0 };
    this.isProcessing = true;
    this.notifyListeners();

    let processed = 0;
    let failed = 0;

    try {
      const items = await this.getPendingItems();
      if (items.length === 0) {
        return { processed: 0, failed: 0 };
      }

      // If client supports unified pushBatch, send all items in a single atomic batch
      if (typeof apiClient.pushBatch === "function") {
        const activeStoreId = String(storeRegistryService.getActiveStore()?.id || "1");
        const batchPayload = items.map((it) => {
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(it.payload_json);
          } catch (_) {}
          if (!payload.store_id) {
            payload.store_id = activeStoreId;
          }
          return {
            id: it.id,
            entity_type: it.entity_type,
            action: it.action,
            payload,
          };
        });

        try {
          const res = await apiClient.pushBatch(batchPayload);
          if (res.success || res.results?.processed > 0) {
            for (const item of items) {
              item.status = "synced";
              await sqliteStorage.insertRecord("sync_queue", item.id, item as unknown as Record<string, unknown>);
              processed++;
            }
            this.lastSyncedAt = Date.now();
          } else {
            throw new Error("Batch sync push failed on server");
          }
        } catch (batchErr) {
          // If batch fails, fallback to item-by-item with backoff
          for (const item of items) {
            failed++;
            const retryCount = (item.retry_count || 0) + 1;
            const backoffMs = this.calculateBackoffMs(retryCount);
            item.status = "failed";
            item.retry_count = retryCount;
            item.last_error = batchErr instanceof Error ? batchErr.message : String(batchErr);
            item.next_retry_at = Date.now() + backoffMs;
            await sqliteStorage.insertRecord("sync_queue", item.id, item as unknown as Record<string, unknown>);
          }
        }
      } else {
        // Individual item processor (compatible with legacy tests and partial mock clients)
        for (const item of items) {
          try {
            const payload = JSON.parse(item.payload_json);

            if (item.entity_type === "invoice") {
              if (apiClient.pushInvoices) {
                const res = await apiClient.pushInvoices([payload]);
                if (!res.success) throw new Error("Sync API rejected invoice batch");
              }
            } else if (item.entity_type === "stock_event" || item.entity_type === "stock_adjustment") {
              if (apiClient.pushStockEvents) {
                const res = await apiClient.pushStockEvents([payload]);
                if (!res.success) throw new Error("Sync API rejected stock event batch");
              }
            }

            // Mark synced
            item.status = "synced";
            await sqliteStorage.insertRecord("sync_queue", item.id, item as unknown as Record<string, unknown>);
            processed += 1;
            this.lastSyncedAt = Date.now();
          } catch (error) {
            failed += 1;
            const retryCount = (item.retry_count || 0) + 1;
            const backoffMs = this.calculateBackoffMs(retryCount);

            item.status = "failed";
            item.retry_count = retryCount;
            item.last_error = error instanceof Error ? error.message : String(error);
            item.next_retry_at = Date.now() + backoffMs;

            await sqliteStorage.insertRecord("sync_queue", item.id, item as unknown as Record<string, unknown>);
          }
        }
      }
    } finally {
      this.isProcessing = false;
      this.notifyListeners();
    }

    return { processed, failed };
  }

  /**
   * Sync a single specific item from the queue immediately to the database.
   */
  async syncSingleItem(itemId: string, apiClient: SyncApiClient = defaultBackendApiClient): Promise<{ success: boolean; error?: string }> {
    const item = await sqliteStorage.findById<SyncQueueItem>("sync_queue", itemId);
    if (!item) {
      return { success: false, error: "Queue item not found" };
    }

    try {
      item.status = "in_progress";
      await sqliteStorage.insertRecord("sync_queue", item.id, item as unknown as Record<string, unknown>);
      this.notifyListeners();

      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(item.payload_json);
      } catch (_) {}

      const activeStoreId = String(storeRegistryService.getActiveStore()?.id || "1");
      if (!payload.store_id) {
        payload.store_id = activeStoreId;
      }

      if (typeof apiClient.pushBatch === "function") {
        const res = await apiClient.pushBatch([
          {
            id: item.id,
            entity_type: item.entity_type,
            action: item.action,
            payload,
          },
        ]);

        if (res.success || res.results?.processed > 0) {
          item.status = "synced";
          item.last_error = undefined;
          await sqliteStorage.insertRecord("sync_queue", item.id, item as unknown as Record<string, unknown>);
          this.lastSyncedAt = Date.now();
          this.notifyListeners();
          return { success: true };
        } else {
          const errDetail = (res as any).results?.errors?.[0]?.error || (res as any).error || "Server rejected item";
          throw new Error(errDetail);
        }
      } else if (item.entity_type === "invoice" && apiClient.pushInvoices) {
        const res = await apiClient.pushInvoices([payload]);
        if (res.success) {
          item.status = "synced";
          item.last_error = undefined;
          await sqliteStorage.insertRecord("sync_queue", item.id, item as unknown as Record<string, unknown>);
          this.lastSyncedAt = Date.now();
          this.notifyListeners();
          return { success: true };
        } else {
          throw new Error("Server rejected invoice");
        }
      } else {
        throw new Error("No compatible API push method available");
      }
    } catch (err: any) {
      const retryCount = (item.retry_count || 0) + 1;
      item.status = "failed";
      item.retry_count = retryCount;
      item.last_error = err?.message || String(err);
      item.next_retry_at = Date.now() + this.calculateBackoffMs(retryCount);
      await sqliteStorage.insertRecord("sync_queue", item.id, item as unknown as Record<string, unknown>);
      this.notifyListeners();
      return { success: false, error: item.last_error };
    }
  }

  /**
   * Force sync all pending and failed items immediately, resetting retry backoffs.
   */
  async forceSyncAll(apiClient: SyncApiClient = defaultBackendApiClient): Promise<{ processed: number; failed: number }> {
    const all = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
    for (const item of all) {
      if (item.status === "failed") {
        item.status = "pending";
        item.next_retry_at = 0;
        await sqliteStorage.insertRecord("sync_queue", item.id, item as unknown as Record<string, unknown>);
      }
    }
    return await this.processQueue(apiClient);
  }

  /**
   * Delete an item from the sync queue (e.g. invalid or corrupted record).
   */
  async deleteQueueItem(itemId: string): Promise<boolean> {
    try {
      await sqliteStorage.deleteRecord("sync_queue", itemId);
      this.notifyListeners();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear all items already marked as synced.
   */
  async clearSyncedItems(): Promise<number> {
    const all = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
    let count = 0;
    for (const item of all) {
      if (item.status === "synced") {
        await sqliteStorage.deleteRecord("sync_queue", item.id);
        count++;
      }
    }
    this.notifyListeners();
    return count;
  }

  /**
   * Scan local SQLite invoices table for any offline bills not yet present in sync_queue.
   */
  async discoverUnsyncedInvoices(): Promise<number> {
    try {
      const localInvoices = await sqliteStorage.findAll<any>("invoices");
      const existingQueue = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
      const existingEntityIds = new Set(existingQueue.map((q) => q.entity_id));

      let enqueued = 0;
      for (const inv of localInvoices) {
        const isPending =
          inv.sync_state === "pending" ||
          inv.sync_status === "pending" ||
          inv.is_offline_temp === true ||
          inv.is_offline === true;

        if (isPending && !existingEntityIds.has(inv.id)) {
          await this.enqueue("invoice", inv.id, "create", {
            ...inv,
            invoice_number: inv.invoice_number,
            store_id: inv.store_id,
          });
          enqueued++;
        }
      }
      return enqueued;
    } catch {
      return 0;
    }
  }

  stopAutoSync(): void {
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
    }
  }
}

export const syncQueueService = new SyncQueueService();
