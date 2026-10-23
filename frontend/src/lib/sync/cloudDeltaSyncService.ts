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
        const normalizedProd: ProductItem = {
          ...prod,
          id: String(prod.id),
          mrp: Number(prod.mrp || 0),
          sel_rate: Number(prod.sel_rate || 0),
          ptr: prod.ptr !== undefined ? Number(prod.ptr) : undefined,
          pts: prod.pts !== undefined ? Number(prod.pts) : undefined,
          gst_percent: Number(prod.gst_percent || 0),
          current_stock: Number(prod.current_stock || 0),
          is_active: prod.is_active !== undefined ? Boolean(prod.is_active) : true,
        };
        await productsStore.upsertProduct(normalizedProd);
        appliedProducts += 1;
      }
    }

    // 2. Ingest Batches
    if (Array.isArray(delta.batches)) {
      for (const batch of delta.batches) {
        const normalizedBatch: ProductBatch = {
          ...batch,
          id: String(batch.id),
          product_id: String(batch.product_id),
          stock_qty: Number(batch.stock_qty || 0),
          mrp: batch.mrp !== undefined ? Number(batch.mrp) : undefined,
          purchase_rate: batch.purchase_rate !== undefined ? Number(batch.purchase_rate) : undefined,
          selling_rate: batch.selling_rate !== undefined ? Number(batch.selling_rate) : undefined,
        };
        await productsStore.upsertBatch(normalizedBatch);
        appliedBatches += 1;
      }
    }

    // 3. Ingest Parties
    if (Array.isArray(delta.parties)) {
      for (const party of delta.parties) {
        const normalizedParty: PartyMaster = {
          ...party,
          id: String(party.id),
          is_active: party.is_active !== undefined ? Boolean(party.is_active) : true,
          credit_limit: party.credit_limit !== undefined ? Number(party.credit_limit) : undefined,
          outstanding_balance: party.outstanding_balance !== undefined ? Number(party.outstanding_balance) : undefined,
        };
        await partiesStore.upsertParty(normalizedParty);
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
