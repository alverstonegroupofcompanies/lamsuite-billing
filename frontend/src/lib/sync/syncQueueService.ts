import { sqliteStorage } from "../db/sqliteStorage";

export interface SyncQueueItem {
  id: string;
  entity_type: "invoice" | "product" | "customer" | "stock_event" | "purchase" | "purchase_order" | "payment" | "purchase_return";
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
  pushInvoices(items: Record<string, unknown>[]): Promise<{ success: boolean; ingested_count: number }>;
  pushStockEvents(items: Record<string, unknown>[]): Promise<{ success: boolean; ingested_count: number }>;
}

export class SyncQueueService {
  private isProcessing = false;

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
    
    // Inject idempotency key into payload
    const enrichedPayload = {
      ...payload,
      idempotency_key: idempotencyKey,
      client_timestamp: Date.now(),
    };

    const item: SyncQueueItem = {
      id: queueId,
      entity_type: entityType,
      entity_id: entityId,
      action: action,
      payload_json: JSON.stringify(enrichedPayload),
      status: "pending",
      retry_count: 0,
      created_at: Date.now(),
    };

    await sqliteStorage.insertRecord("sync_queue", queueId, item as unknown as Record<string, unknown>);
    return queueId;
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

  async processQueue(apiClient: SyncApiClient): Promise<{ processed: number; failed: number }> {
    if (this.isProcessing) return { processed: 0, failed: 0 };
    this.isProcessing = true;

    let processed = 0;
    let failed = 0;

    try {
      const items = await this.getPendingItems();

      for (const item of items) {
        try {
          const payload = JSON.parse(item.payload_json);

          if (item.entity_type === "invoice") {
            const res = await apiClient.pushInvoices([payload]);
            if (!res.success) throw new Error("Sync API rejected invoice batch");
          } else if (item.entity_type === "stock_event") {
            const res = await apiClient.pushStockEvents([payload]);
            if (!res.success) throw new Error("Sync API rejected stock event batch");
          }

          // Mark synced
          item.status = "synced";
          await sqliteStorage.insertRecord("sync_queue", item.id, item as unknown as Record<string, unknown>);
          processed += 1;
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
    } finally {
      this.isProcessing = false;
    }

    return { processed, failed };
  }
}

export const syncQueueService = new SyncQueueService();
