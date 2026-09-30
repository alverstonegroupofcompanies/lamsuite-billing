import { productsStore, type ProductItem, type ProductBatch } from "../masters/productsStore";
import { partiesStore, type PartyMaster } from "../masters/partiesStore";
import { sqliteStorage } from "../db/sqliteStorage";

export interface MasterDeltaResponse {
  watermark: number;
  products: ProductItem[];
  batches: ProductBatch[];
  parties: PartyMaster[];
}

export interface CloudDeltaApiClient {
  fetchMasterDeltas(sinceWatermark: number): Promise<MasterDeltaResponse>;
}

export class CloudDeltaSyncService {
  private lastWatermark = 0;

  getWatermark(): number {
    return this.lastWatermark;
  }

  setWatermark(watermark: number): void {
    this.lastWatermark = watermark;
  }

  async pullMasterDelta(apiClient: CloudDeltaApiClient): Promise<{
    success: boolean;
    appliedProducts: number;
    appliedBatches: number;
    appliedParties: number;
    newWatermark: number;
  }> {
    const delta = await apiClient.fetchMasterDeltas(this.lastWatermark);

    let appliedProducts = 0;
    let appliedBatches = 0;
    let appliedParties = 0;

    // 1. Ingest Products
    if (Array.isArray(delta.products)) {
      for (const prod of delta.products) {
        await productsStore.upsertProduct(prod);
        appliedProducts += 1;
      }
    }

    // 2. Ingest Batches
    if (Array.isArray(delta.batches)) {
      for (const batch of delta.batches) {
        await productsStore.upsertBatch(batch);
        appliedBatches += 1;
      }
    }

    // 3. Ingest Parties
    if (Array.isArray(delta.parties)) {
      for (const party of delta.parties) {
        await partiesStore.upsertParty(party);
        appliedParties += 1;
      }
    }

    // 4. Update watermark
    this.lastWatermark = delta.watermark;

    return {
      success: true,
      appliedProducts,
      appliedBatches,
      appliedParties,
      newWatermark: this.lastWatermark,
    };
  }
}

export const cloudDeltaSyncService = new CloudDeltaSyncService();
