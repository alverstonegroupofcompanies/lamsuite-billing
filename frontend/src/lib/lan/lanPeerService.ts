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
  invoices?: any[];
  invoice_items?: any[];
}

export interface HttpFetcher {
  (url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
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
    invoicesCount: number;
  }> {
    let productsCount = 0;
    let batchesCount = 0;
    let partiesCount = 0;

    for (const prod of snapshot.products || []) {
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
      productsCount += 1;
    }

    for (const batch of snapshot.batches || []) {
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
      batchesCount += 1;
    }

    for (const party of snapshot.parties || []) {
      const normalizedParty: PartyMaster = {
        ...party,
        id: String(party.id),
        is_active: party.is_active !== undefined ? Boolean(party.is_active) : true,
        credit_limit: party.credit_limit !== undefined ? Number(party.credit_limit) : undefined,
        outstanding_balance: party.outstanding_balance !== undefined ? Number(party.outstanding_balance) : undefined,
      };
      await partiesStore.upsertParty(normalizedParty);
      partiesCount += 1;
    }

    // Ingest past invoices and items for multi-counter visibility
    let invoicesCount = 0;
    for (const inv of snapshot.invoices || []) {
      try {
        const invId = String(inv.id);
        const record = {
          id: invId,
          module_key: inv.module_key || "invoice",
          invoice_number: inv.invoice_number,
          invoice_date: String(inv.invoice_date).slice(0, 10),
          customer_id: inv.customer_id ? String(inv.customer_id) : undefined,
          customer_name: inv.customer_name || "Walk-In Customer",
          customer_phone: inv.customer_phone || "",
          customer_gstin: inv.customer_gstin || "",
          place_of_supply: inv.place_of_supply || "",
          subtotal: Number(inv.subtotal || 0),
          discount_total: Number(inv.discount_total || 0),
          tax_total: Number(inv.tax_total || 0),
          round_off: Number(inv.round_off || 0),
          grand_total: Number(inv.grand_total || 0),
          paid_amount: Number(inv.paid_amount || 0),
          payment_mode: inv.payment_mode || "Cash",
          status: inv.status || "issued",
          cancel_reason: inv.cancel_reason || undefined,
          user_counter: inv.counter_code || "C01",
          sync_state: "synced",
          created_at: inv.created_at ? new Date(inv.created_at).getTime() : Date.now(),
          updated_at: inv.updated_at ? new Date(inv.updated_at).getTime() : Date.now(),
        };
        await sqliteStorage.insertRecord("invoices", invId, record);
        invoicesCount += 1;
      } catch (_) {}
    }

    for (const item of snapshot.invoice_items || []) {
      try {
        const itemId = String(item.id);
        const itemRecord = {
          id: itemId,
          invoice_id: String(item.invoice_id),
          product_id: String(item.product_id),
          product_name: item.product_name,
          batch_no: item.batch_no || "",
          expiry_date: item.expiry_date ? String(item.expiry_date).slice(0, 10) : "",
          qty: Number(item.qty || 1),
          unit_price: Number(item.unit_price || 0),
          discount_percent: Number(item.discount_percent || 0),
          discount_amount: Number(item.discount_amount || 0),
          gst_percent: Number(item.gst_percent || 0),
          tax_amount: Number(item.tax_amount || 0),
          total_amount: Number(item.total_amount || 0),
        };
        await sqliteStorage.insertRecord("invoice_items", itemId, itemRecord);
      } catch (_) {}
    }

    return {
      success: true,
      productsCount,
      batchesCount,
      partiesCount,
      invoicesCount,
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
    customFetch?: HttpFetcher,
    deviceToken?: string
  ): Promise<{ success: boolean; appliedCount: number }> {
    const cleanHost = mainHost.trim().replace(/^http:\/\//, "").replace(/\/.*$/, "").replace(/:.*$/, "");
    const url = `http://${cleanHost}:${port}/lan/v1/pull`;
    const fetchImpl: HttpFetcher =
      customFetch || (typeof fetch !== "undefined" ? (fetch as unknown as HttpFetcher) : undefined as unknown as HttpFetcher);

    if (!fetchImpl) {
      throw new Error("No HTTP fetch implementation available for LAN sync");
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (deviceToken) {
      headers["X-Device-Token"] = deviceToken;
    }

    const res = await fetchImpl(url, { headers } as any);
    if (!res.ok) {
      throw new Error(`LAN master pull failed with status ${res.status}`);
    }

    const snapshot = (await res.json()) as LanMasterSnapshot;
    const ingestRes = await this.ingestMasterSnapshot(snapshot);

    return {
      success: true,
      appliedCount: ingestRes.productsCount + ingestRes.batchesCount + ingestRes.partiesCount + (ingestRes as any).invoicesCount,
    };
  }
}

export const lanPeerService = new LanPeerService();
