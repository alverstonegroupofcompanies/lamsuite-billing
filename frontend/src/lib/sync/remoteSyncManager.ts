import { sqliteStorage } from "../db/sqliteStorage";
import { cloudDeltaSyncService } from "./cloudDeltaSyncService";
import { lanPeerService } from "../lan/lanPeerService";
import { syncQueueService, defaultBackendApiClient } from "./syncQueueService";
import { multiCounterStockService } from "../stock/multiCounterStockService";
import { storeDeviceService } from "../auth/storeDeviceService";
import { API_BASE_URL } from "../../config/env";

export type TransportMode = "lan_mesh" | "cloud_sse" | "cloud_poll" | "offline";

export interface RemoteSyncState {
  transportMode: TransportMode;
  isOnline: boolean;
  isRemote: boolean;
  counterCode: string;
  counterName: string;
  locationName: string;
  pendingCount: number;
  lastSyncedAt?: number;
  serverClockDeltaMs: number;
  isRevoked: boolean;
  revocationReason?: string;
}

export class RemoteSyncManager {
  private transportMode: TransportMode = "offline";
  private eventSource: any = null;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<(state: RemoteSyncState) => void> = new Set();
  private lastSyncedAt?: number;
  private serverClockDeltaMs = 0;
  private isRevoked = false;
  private revocationReason = "";

  constructor() {
    this.setupListeners();
  }

  private setupListeners(): void {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.evaluateTransport());
      window.addEventListener("offline", () => {
        this.transportMode = "offline";
        this.notify();
      });
    }
  }

  subscribe(listener: (state: RemoteSyncState) => void): () => void {
    this.listeners.add(listener);
    this.notify(listener);
    return () => this.listeners.delete(listener);
  }

  private async notify(specificListener?: (state: RemoteSyncState) => void): Promise<void> {
    const profile = await storeDeviceService.getDeviceProfile();
    const pendingItems = await syncQueueService.getPendingItems();

    const state: RemoteSyncState = {
      transportMode: this.transportMode,
      isOnline: this.transportMode !== "offline",
      isRemote: Boolean(profile?.counter_name?.toLowerCase().includes("home") || profile?.counter_name?.toLowerCase().includes("remote")),
      counterCode: profile?.counter_code || "C01",
      counterName: profile?.counter_name || "Main Counter",
      locationName: profile?.store_name || "Shop Floor",
      pendingCount: pendingItems.length,
      lastSyncedAt: this.lastSyncedAt,
      serverClockDeltaMs: this.serverClockDeltaMs,
      isRevoked: this.isRevoked,
      revocationReason: this.revocationReason,
    };

    if (specificListener) {
      specificListener(state);
    } else {
      this.listeners.forEach((l) => l(state));
    }
  }

  /**
   * Evaluate best transport: LAN mesh if reachable, Cloud SSE if remote/internet available, or fallback to polling.
   */
  async evaluateTransport(baseUrl = API_BASE_URL): Promise<TransportMode> {
    const profile = await storeDeviceService.getDeviceProfile();
    if (!profile) {
      this.transportMode = "offline";
      this.notify();
      return "offline";
    }

    // 1. Check if LAN peer/hub is discovered
    const lanConfig = lanPeerService.getStationConfig();
    const isMain = lanConfig.role === "main_station";

    if (!isMain) {
      const lanPeer = await lanPeerService.discoverMainStation();
      if (lanPeer) {
        this.transportMode = "lan_mesh";
        this.notify();
        return "lan_mesh";
      }
    }

    // 2. Try Cloud SSE connection
    try {
      this.connectCloudStream(baseUrl, profile.counter_code || "C01");
      return this.transportMode;
    } catch {
      this.startPollingFallback(baseUrl);
      return "cloud_poll";
    }
  }

  /**
   * Connect to backend Near-Real-Time Server-Sent Events stream.
   */
  connectCloudStream(baseUrl: string, counterCode: string): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    const sseUrl = `${baseUrl}/api/sync/stream?counter_code=${encodeURIComponent(counterCode)}`;

    if (typeof EventSource !== "undefined") {
      try {
        const es = new EventSource(sseUrl);
        this.eventSource = es;

        es.addEventListener("connected", (evt: any) => {
          try {
            const data = JSON.parse(evt.data);
            if (data.server_time) {
              this.serverClockDeltaMs = data.server_time - Date.now();
            }
            this.transportMode = "cloud_sse";
            this.lastSyncedAt = Date.now();
            this.notify();
          } catch (e) {
            console.warn("SSE connected parse error", e);
          }
        });

        es.addEventListener("sync_event", async (evt: any) => {
          try {
            const syncEvt = JSON.parse(evt.data);
            await this.handleIncomingRemoteDelta(syncEvt);
            this.lastSyncedAt = Date.now();
            this.notify();
          } catch (e) {
            console.warn("SSE sync_event handling error", e);
          }
        });

        es.addEventListener("ping", (evt: any) => {
          try {
            const data = JSON.parse(evt.data);
            if (data.timestamp) {
              this.serverClockDeltaMs = data.timestamp - Date.now();
            }
          } catch {}
        });

        es.onerror = () => {
          // SSE lost; degrade to polling fallback
          this.eventSource?.close();
          this.eventSource = null;
          this.startPollingFallback(baseUrl);
        };

        this.transportMode = "cloud_sse";
        this.notify();
      } catch (err) {
        this.startPollingFallback(baseUrl);
      }
    } else {
      this.startPollingFallback(baseUrl);
    }
  }

  /**
   * Ingest incoming remote delta (stock, bill, or master update) into local SQLite.
   */
  async handleIncomingRemoteDelta(syncEvt: any): Promise<void> {
    if (!syncEvt) return;

    if (syncEvt.entity_type === "stock_adjustment" || syncEvt.entity_type === "stock_event") {
      const payload = typeof syncEvt.client_data === "string" ? JSON.parse(syncEvt.client_data) : syncEvt.client_data;
      if (payload) {
        await multiCounterStockService.syncMergeCounterStockDeltas([
          {
            id: syncEvt.entity_id || `remote_delta_${Date.now()}`,
            product_id: payload.product_id,
            batch_id: payload.batch_id || payload.batch_no,
            counter_id: payload.counter_id || "remote",
            qty_delta: Number(payload.qty_delta || 0),
            reference_type: payload.reference_type || "remote_sale",
            reference_id: payload.reference_id || "",
            created_at: Date.now(),
          },
        ]);
      }
    } else if (syncEvt.entity_type === "product" || syncEvt.entity_type === "party") {
      // Pull fresh deltas
      await cloudDeltaSyncService.pullMasterDelta({
        fetchMasterDeltas: async (wm) => {
          const res = await fetch(`/api/sync/pull/deltas?since_watermark=${wm}`);
          return res.json();
        },
      });
    }
  }

  /**
   * Fallback polling mechanism every 10s if SSE is not available.
   */
  startPollingFallback(baseUrl: string): void {
    if (this.pollingTimer) return;

    this.transportMode = "cloud_poll";
    this.notify();

    this.pollingTimer = setInterval(async () => {
      try {
        await syncQueueService.processQueue(defaultBackendApiClient);
        this.lastSyncedAt = Date.now();
        this.notify();
      } catch (e: any) {
        if (e?.message?.includes("403") || e?.message?.includes("revoked")) {
          this.handleDeviceRevocation("Counter credentials revoked by administrator");
        }
      }
    }, 10000);
  }

  handleDeviceRevocation(reason: string): void {
    this.isRevoked = true;
    this.revocationReason = reason;
    this.transportMode = "offline";
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.notify();
  }

  async acquireInvoiceLock(
    baseUrl: string,
    invoiceId: string,
    counterId: string,
    counterCode: string
  ): Promise<{ success: boolean; message: string; locked?: boolean }> {
    try {
      const res = await fetch(`${baseUrl}/api/invoices/${invoiceId}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ counter_id: counterId, counter_code: counterCode }),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, message: err?.message || "Failed to reach cloud server for invoice lock check" };
    }
  }

  async releaseInvoiceLock(baseUrl: string, invoiceId: string): Promise<void> {
    try {
      await fetch(`${baseUrl}/api/invoices/${invoiceId}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
      });
    } catch {}
  }

  stopAll(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.transportMode = "offline";
  }
}

export const remoteSyncManager = new RemoteSyncManager();
