import { sqliteStorage } from "../db/sqliteStorage";
import { getResolvedApiBaseUrl } from "../../config/env";
import { storeRegistryService } from "../auth/storeRegistryService";
import { companySettingsService } from "../settings/companySettingsService";
import { counterSequenceService } from "../auth/counterSequenceService";
import { counterSessionService } from "../auth/counterSessionService";
import {
  DeviceAuthError,
  deviceAuthErrorFrom,
  handleDeviceAuthFailure,
  isDeviceAuthFailure,
} from "../auth/deviceAuthFailure";
import type { ServerRenumbering } from "../billing/documentIdentity";

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
    | "staff_user"
    | "unit"
    | "charge_head"
    | "discount_schema"
    | "lookup"
    | "settings"
    | "setting";
  entity_id: string;
  action: "create" | "update" | "delete";
  payload_json: string;
  status: "pending" | "in_progress" | "failed" | "synced";
  retry_count: number;
  last_error?: string;
  created_at: number;
  next_retry_at?: number;
  /** SYNC-02: the retired-workstation door refused it; it waits for a fresh claim instead. */
  stranded_refused?: boolean;
}

export interface OrphanRepairReport {
  /** Local documents still pending whose only queue row was marked sent. */
  found: string[];
  requeued: number;
}

export interface SyncPushResponse {
  success: boolean;
  /** CNT-014: numbers the counter gave documents this till had to invent. */
  renumbered?: ServerRenumbering[];
}

export interface BatchPushResults {
  total: number;
  processed: number;
  failed: number;
  /** Ids the server actually filed; a rejected id is absent. */
  processed_ids?: Array<string | number>;
  errors?: Array<{ id?: string | number; entity_type?: string; error?: string }>;
}

export interface SyncApiClient {
  pushInvoices?(items: Record<string, unknown>[]): Promise<SyncPushResponse & { ingested_count: number }>;
  pushStockEvents?(items: Record<string, unknown>[]): Promise<SyncPushResponse & { ingested_count: number }>;
  pushBatch?(items: Array<{ id: string; entity_type: string; action: string; payload: Record<string, unknown> }>): Promise<
    SyncPushResponse & { results: BatchPushResults }
  >;
}

export interface SyncQueueStatus {
  /** Items due to go now. */
  pendingCount: number;
  /** Everything not yet taken by the server, including a retry in progress. */
  unsentCount: number;
  isProcessing: boolean;
  lastSyncedAt?: number;
  /** Bills the counter renumbered during the last flush (CNT-014). */
  renumbered: ServerRenumbering[];
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

  /**
   * Push endpoints are device-authenticated. Only attach the stored device
   * token when it belongs to the store we are pushing as.
   */
  private async buildPushHeaders(activeStoreId: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    // A local registry key ("store_main") is not a server store. Omit it and
    // let the device token decide the tenant.
    const hasServerStore = activeStoreId !== "" && !/^store_/i.test(activeStoreId);
    if (hasServerStore) {
      headers["X-Store-Id"] = activeStoreId;
      headers["Store-Id"] = activeStoreId;
    }

    try {
      const { storeDeviceService } = await import("../auth/storeDeviceService");
      const deviceHeaders = await storeDeviceService.getDeviceAuthHeaders();
      // Attach the token when it belongs to the store we push as, or when no
      // server-resolvable store id is known.
      if (!hasServerStore || deviceHeaders["X-Store-Id"] === activeStoreId) {
        if (deviceHeaders["X-Device-Token"]) headers["X-Device-Token"] = deviceHeaders["X-Device-Token"];
        if (deviceHeaders["X-Device-UUID"]) headers["X-Device-UUID"] = deviceHeaders["X-Device-UUID"];
      }
    } catch (_) {
      // Token unavailable (unpaired/legacy install): the server will reject the
      // push rather than accept anonymous tenant writes.
    }

    return headers;
  }

  /**
   * A refused device credential is not a network fault: the body says so, and
   * the queue must stop retrying rather than bury a revoked till in backoff.
   */
  private async throwIfRejected(res: Response, label: string): Promise<void> {
    if (res.ok) return;
    const body = await res.json().catch(() => null);
    if (isDeviceAuthFailure(res.status, body)) {
      throw deviceAuthErrorFrom(res.status, body);
    }
    throw new Error(`${label} HTTP ${res.status}: ${res.statusText}`);
  }

  async pushBatch(items: Array<{ id: string; entity_type: string; action: string; payload: Record<string, unknown> }>): Promise<
    SyncPushResponse & { results: BatchPushResults }
  > {
    const activeStoreId = String(storeRegistryService.getActiveStore()?.id || "1");
    const url = `${this.getEffectiveBaseUrl()}/api/sync/push/batch`;
    const res = await fetch(url, {
      method: "POST",
      headers: await this.buildPushHeaders(activeStoreId),
      body: JSON.stringify({ items, store_id: activeStoreId }),
    });

    await this.throwIfRejected(res, "Backend Sync API");

    return await res.json();
  }

  async pushInvoices(
    items: Record<string, unknown>[]
  ): Promise<SyncPushResponse & { ingested_count: number; errors?: unknown[] }> {
    const activeStoreId = String(storeRegistryService.getActiveStore()?.id || "1");
    const url = `${this.getEffectiveBaseUrl()}/api/sync/push/invoices`;
    const res = await fetch(url, {
      method: "POST",
      headers: await this.buildPushHeaders(activeStoreId),
      body: JSON.stringify({ invoices: items, store_id: activeStoreId }),
    });

    await this.throwIfRejected(res, "Backend Invoices API");

    return await res.json();
  }

  async pushStockEvents(
    items: Record<string, unknown>[]
  ): Promise<SyncPushResponse & { ingested_count: number }> {
    const activeStoreId = String(storeRegistryService.getActiveStore()?.id || "1");
    const url = `${this.getEffectiveBaseUrl()}/api/sync/push/stock-events`;
    const res = await fetch(url, {
      method: "POST",
      headers: await this.buildPushHeaders(activeStoreId),
      body: JSON.stringify({ events: items, store_id: activeStoreId }),
    });

    await this.throwIfRejected(res, "Backend Stock API");

    return await res.json();
  }
}

export const defaultBackendApiClient = new BackendHttpApiClient();

export class SyncQueueService {
  private isProcessing = false;
  private autoSyncInterval: ReturnType<typeof setInterval> | null = null;
  private syncListeners: Set<(status: SyncQueueStatus) => void> = new Set();
  private lastSyncedAt?: number;
  /** Set when the device credential was refused; only a fresh claim clears it. */
  private authPaused = false;
  private lastRenumberings: ServerRenumbering[] = [];
  /** Bills saved inside the same millisecond still keep the order they were saved. */
  private enqueueSequence = 0;

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

  /** Local table a queued entity type was written into, for documents that carry a sync_state. */
  private static readonly documentTables: Partial<Record<SyncQueueItem["entity_type"], string>> = {
    invoice: "invoices",
    purchase: "purchase_documents",
    product: "products",
  };

  /**
   * The server took this document, so the local copy is no longer a pending edit. Only a row that
   * still carries the figures that were pushed is flipped, so an edit made while the push was in
   * flight keeps its pending flag and goes out on the next flush.
   */
  private async markSourceDocumentsSynced(
    items: SyncQueueItem[],
    renumberings: ServerRenumbering[] = []
  ): Promise<void> {
    for (const item of items) {
      const table = SyncQueueService.documentTables[item.entity_type];
      if (!table || !item.entity_id) continue;

      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(item.payload_json);
      } catch (_) {}

      const row = await sqliteStorage.findById<Record<string, unknown>>(table, String(item.entity_id));
      if (!row || row.sync_state === "synced") continue;
      if (
        payload.updated_at !== undefined &&
        String(row.updated_at ?? "") !== String(payload.updated_at)
      ) {
        continue;
      }

      const externalId = payload.external_id ?? payload.idempotency_key ?? payload.id ?? item.entity_id;
      const renumbered = renumberings.find(
        (entry) =>
          (entry.external_id && String(entry.external_id) === String(externalId)) ||
          (entry.from && String(entry.from) === String(row.invoice_number ?? ""))
      );

      const next: Record<string, unknown> = { ...row, sync_state: "synced" };
      if (renumbered) {
        next.invoice_number = renumbered.to;
        // The till's own preview must not offer the number the server just took.
        const step =
          renumbered.doc_type === "invoice"
            ? companySettingsService.syncNextInvoiceSequence(renumbered.to)
            : counterSequenceService.stepOverForActiveCounter(renumbered.to);
        await step.catch(() => {});
      }

      await sqliteStorage.insertRecord(table, String(item.entity_id), next);
    }
  }

  async enqueue(
    entityType: SyncQueueItem["entity_type"],
    entityId: string,
    action: SyncQueueItem["action"],
    payload: Record<string, unknown> | object
  ): Promise<string> {
    const queueId = `sync_${Date.now()}_${String(++this.enqueueSequence).padStart(6, "0")}`;
    const idempotencyKey = this.generateIdempotencyKey(entityType, entityId);

    // If an item with same idempotency key is already pending, update its payload
    const existingItems = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
    const existing = existingItems.find(
      (it) => (it.status === "pending" || it.status === "failed") && it.entity_type === entityType && it.entity_id === entityId
    );

    // Q1 (b): the queued row carries the watermark of the permission document it
    // was written inside. The server compares it with the one in force when the
    // row lands, which is what lets it tell "this bill broke a rule" apart from
    // "the owner wrote a new rule after this bill was made".
    const profileVersion = counterSessionService.state().version;

    // Inject idempotency key into payload
    const enrichedPayload = {
      ...payload,
      idempotency_key: idempotencyKey,
      client_timestamp: Date.now(),
      ...(profileVersion > 0 ? { permission_profile_version: profileVersion } : {}),
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

  /**
   * Due items in the order they were saved. The store hands rows back in
   * whatever order it likes, and a flush that follows that order is how the
   * first offline bill ended up landing after the bills saved behind it.
   */
  async getPendingItems(): Promise<SyncQueueItem[]> {
    const all = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
    const now = Date.now();
    return all
      .filter((item) => {
        if (item.status === "pending") return true;
        if (item.status === "failed") {
          return !item.next_retry_at || item.next_retry_at <= now;
        }
        return false;
      })
      .sort((a, b) => {
        const byTime = (a.created_at || 0) - (b.created_at || 0);
        return byTime !== 0 ? byTime : String(a.id).localeCompare(String(b.id));
      });
  }

  /** Everything the server has not taken yet, including a retry still waiting. */
  async getUnsentCount(): Promise<number> {
    const all = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
    return all.filter((item) => item.status !== "synced").length;
  }

  /** The last flush's renumberings, so the till can show what the counter changed. */
  getLastRenumberings(): ServerRenumbering[] {
    return [...this.lastRenumberings];
  }

  /** Called once a counter code is claimed again; the preserved queue resumes. */
  resumeAfterClaim(): void {
    this.authPaused = false;
    // A fresh claim sends the waiting bills the ordinary way; the old
    // credential has nothing left to do.
    void import("../auth/storeDeviceService")
      .then(({ storeDeviceService }) => storeDeviceService.clearRetiredDeviceToken())
      .catch(() => {});
    this.notifyListeners();
  }

  private static byCreation(a: SyncQueueItem, b: SyncQueueItem): number {
    const byTime = (a.created_at || 0) - (b.created_at || 0);
    return byTime !== 0 ? byTime : String(a.id).localeCompare(String(b.id));
  }

  /**
   * SYNC-02 / CR Q1: while this till is retired, the bills it saved before then
   * go to the one server door that still takes its old credential. The server
   * keeps what predates the retirement and flags it for the owner; a bill it
   * refuses stays here with the reason, for the next claim. A closed door (the
   * credential is unknown or the window has passed) drops the credential and
   * keeps every bill; a network fault just waits for the next tick.
   */
  async flushStranded(): Promise<{ sent: number; refused: number }> {
    const { storeDeviceService } = await import("../auth/storeDeviceService");
    const token = await storeDeviceService.getRetiredDeviceToken();
    if (!token) return { sent: 0, refused: 0 };

    const all = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
    const sendable = all
      .filter((item) => item.status !== "synced" && !item.stranded_refused)
      .sort(SyncQueueService.byCreation);

    if (sendable.length === 0) {
      await storeDeviceService.clearRetiredDeviceToken();
      return { sent: 0, refused: 0 };
    }

    const items = sendable.map((it) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(it.payload_json);
      } catch (_) {}
      return { id: it.id, entity_type: it.entity_type, action: it.action, payload };
    });

    let res: Response;
    try {
      res = await fetch(`${getResolvedApiBaseUrl()}/api/sync/push/stranded`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Device-Token": token,
        },
        body: JSON.stringify({ items }),
      });
    } catch (_) {
      return { sent: 0, refused: 0 };
    }

    if (res.status === 401 || res.status === 403) {
      await storeDeviceService.clearRetiredDeviceToken();
      return { sent: 0, refused: 0 };
    }
    if (!res.ok) return { sent: 0, refused: 0 };

    const body = (await res.json().catch(() => null)) as
      | (SyncPushResponse & { results?: BatchPushResults })
      | null;
    const results = body?.results;
    if (!results) return { sent: 0, refused: 0 };

    const rejected = new Map<string, string>();
    for (const entry of results.errors ?? []) {
      if (entry?.id !== undefined && entry?.id !== null) {
        rejected.set(String(entry.id), entry.error || "Refused by the store server.");
      }
    }
    const taken = new Set((results.processed_ids ?? []).map((id) => String(id)));

    const accepted: SyncQueueItem[] = [];
    let refused = 0;
    for (const item of sendable) {
      const rejection = rejected.get(item.id);
      // Same reading as the batch push: an explicit list wins, else anything not refused was taken.
      const wasTaken = taken.size > 0 ? taken.has(item.id) : !rejection;
      if (wasTaken && !rejection) {
        item.status = "synced";
        item.last_error = undefined;
        accepted.push(item);
      } else if (rejection) {
        item.status = "failed";
        item.last_error = rejection;
        item.stranded_refused = true;
        item.next_retry_at = undefined;
        refused++;
      } else {
        continue;
      }
      await sqliteStorage.insertRecord("sync_queue", item.id, item as unknown as Record<string, unknown>);
    }

    if (accepted.length > 0) {
      this.lastSyncedAt = Date.now();
      await this.markSourceDocumentsSynced(accepted, body?.renumbered ?? []);
    }
    this.recordRenumberings(body?.renumbered);

    const stillSendable = (await sqliteStorage.findAll<SyncQueueItem>("sync_queue")).some(
      (item) => item.status !== "synced" && !item.stranded_refused
    );
    if (!stillSendable) await storeDeviceService.clearRetiredDeviceToken();

    return { sent: accepted.length, refused };
  }

  /**
   * SYNC-01 repair for tills that ran a build which marked a whole batch sent
   * when the server refused part of it. Such a document is still pending
   * locally, but its only queue row says "synced", so nothing would ever send
   * it again. A dry run lists them; a real run queues each one again with the
   * payload and save time it had, so it keeps its place in the order. The
   * server files documents by their external id, so a bill it did take is not
   * filed twice.
   */
  async requeueOrphanedDocuments(options: { dryRun: boolean }): Promise<OrphanRepairReport> {
    const queue = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
    const key = (type: string, id: string) => `${type}:${id}`;

    const unsent = new Set(queue.filter((q) => q.status !== "synced").map((q) => key(q.entity_type, q.entity_id)));
    const lastSent = new Map<string, SyncQueueItem>();
    for (const row of queue) {
      if (row.status !== "synced") continue;
      const k = key(row.entity_type, row.entity_id);
      const seen = lastSent.get(k);
      if (!seen || (row.created_at || 0) >= (seen.created_at || 0)) lastSent.set(k, row);
    }

    const found: SyncQueueItem[] = [];
    const documentTypes: Array<SyncQueueItem["entity_type"]> = ["invoice", "purchase"];
    for (const type of documentTypes) {
      const table = SyncQueueService.documentTables[type];
      if (!table) continue;
      const rows = await sqliteStorage.findAll<Record<string, unknown>>(table).catch(() => []);
      for (const row of rows) {
        if (row.sync_state !== "pending" || row.id === undefined) continue;
        const k = key(type, String(row.id));
        const sent = lastSent.get(k);
        if (sent && !unsent.has(k)) found.push(sent);
      }
    }

    if (options.dryRun || found.length === 0) {
      return { found: found.map((item) => item.entity_id), requeued: 0 };
    }

    for (const sent of found) {
      const id = `sync_requeue_${sent.created_at || Date.now()}_${sent.entity_id}`;
      const item: SyncQueueItem = {
        id,
        entity_type: sent.entity_type,
        entity_id: sent.entity_id,
        action: sent.action,
        payload_json: sent.payload_json,
        status: "pending",
        retry_count: 0,
        created_at: sent.created_at || Date.now(),
      };
      await sqliteStorage.insertRecord("sync_queue", id, item as unknown as Record<string, unknown>);
    }
    await this.notifyListeners();

    return { found: found.map((item) => item.entity_id), requeued: found.length };
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

  subscribe(listener: (status: SyncQueueStatus) => void): () => void {
    this.syncListeners.add(listener);
    this.notifyListeners();
    return () => {
      this.syncListeners.delete(listener);
    };
  }

  private async notifyListeners(): Promise<void> {
    try {
      const pending = await this.getPendingItems();
      const unsent = await this.getUnsentCount();
      const status: SyncQueueStatus = {
        pendingCount: pending.length,
        unsentCount: unsent,
        isProcessing: this.isProcessing,
        lastSyncedAt: this.lastSyncedAt,
        renumbered: this.getLastRenumberings(),
      };
      this.syncListeners.forEach((listener) => {
        try {
          listener(status);
        } catch (_) {}
      });
    } catch (_) {}
  }

  private recordRenumberings(entries: ServerRenumbering[] | undefined): void {
    if (!entries?.length) return;
    this.lastRenumberings = [...entries, ...this.lastRenumberings].slice(0, 20);
  }

  /**
   * A refused credential stops the whole queue: retrying every bill against a
   * token the store has already taken away is how the till looked alive while
   * its offline bill never landed. Only a fresh claim resumes it.
   */
  private async pauseForDeviceAuth(): Promise<void> {
    this.authPaused = true;
    await handleDeviceAuthFailure().catch(() => ({ locked: false }));
    // The lock above set the old credential aside if bills were waiting.
    await this.flushStranded().catch(() => ({ sent: 0, refused: 0 }));
  }

  /**
   * A transport failure moves the whole unsent queue to one retry time, so the
   * bills that were already waiting do not jump ahead of the bill that failed.
   */
  private async rescheduleWholeQueue(message: string): Promise<number> {
    const unsent = (await sqliteStorage.findAll<SyncQueueItem>("sync_queue")).filter(
      (item) => item.status !== "synced"
    );
    const retryCount = Math.max(0, ...unsent.map((item) => item.retry_count || 0)) + 1;
    const retryAt = Date.now() + this.calculateBackoffMs(retryCount);

    for (const item of unsent) {
      item.status = "failed";
      item.retry_count = retryCount;
      item.last_error = message;
      item.next_retry_at = retryAt;
      await sqliteStorage.insertRecord("sync_queue", item.id, item as unknown as Record<string, unknown>);
    }

    return unsent.length;
  }

  async processQueue(apiClient: SyncApiClient = defaultBackendApiClient): Promise<{ processed: number; failed: number }> {
    if (this.isProcessing) return { processed: 0, failed: 0 };
    if (this.authPaused) {
      // Retired: only the retired-workstation door is tried until a fresh claim.
      this.isProcessing = true;
      try {
        await this.flushStranded().catch(() => ({ sent: 0, refused: 0 }));
      } finally {
        this.isProcessing = false;
        await this.notifyListeners();
      }
      return { processed: 0, failed: 0 };
    }
    this.isProcessing = true;
    this.notifyListeners();

    let processed = 0;
    let failed = 0;

    try {
      const items = await this.getPendingItems();
      if (items.length === 0) {
        return { processed: 0, failed: 0 };
      }

      // If client supports unified pushBatch, send all items in one batch, in creation order.
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
          const results = res.results;

          if (!results && !res.success) {
            throw new Error("Batch sync push failed on server");
          }

          const rejected = new Map<string, string>();
          for (const entry of results?.errors ?? []) {
            if (entry?.id !== undefined && entry?.id !== null) {
              rejected.set(String(entry.id), entry.error || "Server rejected item");
            }
          }
          const explicitIds = new Set((results?.processed_ids ?? []).map((id) => String(id)));
          const accepted: SyncQueueItem[] = [];

          for (const item of items) {
            const rejection = rejected.get(item.id);
            const taken = explicitIds.size > 0 ? explicitIds.has(item.id) : !rejection;

            if (taken && !rejection) {
              item.status = "synced";
              item.last_error = undefined;
              await sqliteStorage.insertRecord("sync_queue", item.id, item as unknown as Record<string, unknown>);
              accepted.push(item);
              processed++;
            } else {
              const retryCount = (item.retry_count || 0) + 1;
              item.status = "failed";
              item.retry_count = retryCount;
              item.last_error = rejection || "Server rejected item";
              item.next_retry_at = Date.now() + this.calculateBackoffMs(retryCount);
              await sqliteStorage.insertRecord("sync_queue", item.id, item as unknown as Record<string, unknown>);
              failed++;
            }
          }

          if (accepted.length > 0) {
            this.lastSyncedAt = Date.now();
            await this.markSourceDocumentsSynced(accepted, res.renumbered ?? []);
          }
          this.recordRenumberings(res.renumbered);
        } catch (batchErr) {
          if (batchErr instanceof DeviceAuthError) {
            await this.pauseForDeviceAuth();
            failed = items.length;
          } else {
            failed = await this.rescheduleWholeQueue(
              batchErr instanceof Error ? batchErr.message : String(batchErr)
            );
          }
        }
      } else {
        // Individual item processor (compatible with legacy tests and partial mock clients)
        for (const item of items) {
          try {
            const payload = JSON.parse(item.payload_json);

            let renumberings: ServerRenumbering[] = [];

            if (item.entity_type === "invoice") {
              if (apiClient.pushInvoices) {
                const res = await apiClient.pushInvoices([payload]);
                if (!res.success) throw new Error("Sync API rejected invoice batch");
                renumberings = res.renumbered ?? [];
              }
            } else if (item.entity_type === "stock_event" || item.entity_type === "stock_adjustment") {
              if (apiClient.pushStockEvents) {
                const res = await apiClient.pushStockEvents([payload]);
                if (!res.success) throw new Error("Sync API rejected stock event batch");
                renumberings = res.renumbered ?? [];
              }
            }

            // Mark synced
            item.status = "synced";
            await sqliteStorage.insertRecord("sync_queue", item.id, item as unknown as Record<string, unknown>);
            await this.markSourceDocumentsSynced([item], renumberings);
            this.recordRenumberings(renumberings);
            processed += 1;
            this.lastSyncedAt = Date.now();
          } catch (error) {
            if (error instanceof DeviceAuthError) {
              await this.pauseForDeviceAuth();
              failed += 1;
              break;
            }

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
      await this.notifyListeners();
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
          if (!res.results || res.results.failed === 0) {
            await this.markSourceDocumentsSynced([item], res.renumbered ?? []);
          }
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
          await this.markSourceDocumentsSynced([item], res.renumbered ?? []);
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
      if (err instanceof DeviceAuthError) {
        item.status = "pending";
        item.last_error = err.message;
        await sqliteStorage.insertRecord("sync_queue", item.id, item as unknown as Record<string, unknown>);
        await this.pauseForDeviceAuth();
        this.notifyListeners();
        return { success: false, error: item.last_error };
      }

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
