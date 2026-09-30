import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductItem, type ProductBatch } from "../masters/productsStore";
import { partiesStore, type PartyMaster } from "../masters/partiesStore";
import { getIpcBridge } from "../ipc/ipcBridge";

export type StationRole = "main_station" | "counter_client";

export interface LanPeerInfo {
  station_id: string;
  station_name: string;
  ip_address: string;
  port: number;
  is_main: boolean;
  version: string;
}

export interface LanMasterSnapshot {
  snapshot_id: string;
  source_station_id: string;
  timestamp: number;
  products: ProductItem[];
  batches: ProductBatch[];
  parties: PartyMaster[];
}

export interface HttpFetcher {
  (url: string): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
}

export class LanPeerService {
  private role: StationRole = "counter_client";
  private stationId = `stn_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
  private stationName = "Counter Station";
  private lanPort = 8089;
  private knownPeers: LanPeerInfo[] = [];

  configureStation(role: StationRole, stationName: string, port = 8089) {
    this.role = role;
    this.stationName = stationName;
    this.lanPort = port;
  }

  getStationConfig() {
    return {
      role: this.role,
      stationId: this.stationId,
      stationName: this.stationName,
      port: this.lanPort,
    };
  }

  async exportMasterSnapshot(): Promise<LanMasterSnapshot> {
    const products = await sqliteStorage.findAll<ProductItem>("products");
    const batches = await sqliteStorage.findAll<ProductBatch>("product_batches");
    const parties = await partiesStore.getAllParties();

    return {
      snapshot_id: `snap_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      source_station_id: this.stationId,
      timestamp: Date.now(),
      products,
      batches,
      parties,
    };
  }

  async ingestMasterSnapshot(snapshot: LanMasterSnapshot): Promise<{
    success: boolean;
    productsCount: number;
    batchesCount: number;
    partiesCount: number;
  }> {
    let productsCount = 0;
    let batchesCount = 0;
    let partiesCount = 0;

    for (const prod of snapshot.products || []) {
      await productsStore.upsertProduct(prod);
      productsCount += 1;
    }

    for (const batch of snapshot.batches || []) {
      await productsStore.upsertBatch(batch);
      batchesCount += 1;
    }

    for (const party of snapshot.parties || []) {
      await partiesStore.upsertParty(party);
      partiesCount += 1;
    }

    return {
      success: true,
      productsCount,
      batchesCount,
      partiesCount,
    };
  }

  async discoverMainStation(mockMainPeer?: LanPeerInfo): Promise<LanPeerInfo | null> {
    const bridge = getIpcBridge();

    if (bridge.runtime === "tauri" || bridge.runtime === "electron") {
      try {
        const discovered = await bridge.invoke<LanPeerInfo | null>("lan:discover_main", {
          port: this.lanPort,
        });
        if (discovered) return discovered;
      } catch (err) {
        console.warn("Native LAN discovery failed, checking fallback:", err);
      }
    }

    // In mock/test runtime or if provided
    if (mockMainPeer) {
      return mockMainPeer;
    }

    return null;
  }

  async pullMasterSnapshotFromMain(
    mainHost: string,
    port = this.lanPort,
    customFetch?: HttpFetcher
  ): Promise<{ success: boolean; appliedCount: number }> {
    const url = `http://${mainHost}:${port}/lan/v1/pull`;
    const fetchImpl: HttpFetcher =
      customFetch || (typeof fetch !== "undefined" ? (fetch as unknown as HttpFetcher) : undefined as unknown as HttpFetcher);

    if (!fetchImpl) {
      throw new Error("No HTTP fetch implementation available for LAN sync");
    }

    const res = await fetchImpl(url);
    if (!res.ok) {
      throw new Error(`LAN master pull failed with status ${res.status}`);
    }

    const snapshot = (await res.json()) as LanMasterSnapshot;
    const ingestRes = await this.ingestMasterSnapshot(snapshot);

    return {
      success: true,
      appliedCount: ingestRes.productsCount + ingestRes.batchesCount + ingestRes.partiesCount,
    };
  }
}

export const lanPeerService = new LanPeerService();
