import { sqliteStorage } from "../db/sqliteStorage";
import { syncQueueService } from "../sync/syncQueueService";
import { companySettingsService } from "../settings/companySettingsService";
import { getIndianFinancialYear } from "../billing/salesReturnService";
import { round2 } from "../billing/billingCalculations";

export interface POLineItemInput {
  product_id: string;
  product_name: string;
  hsn_code?: string;
  ordered_qty: number;
  received_qty?: number;
  purchase_rate: number;
  gst_percent: number;
  total_amount?: number;
}

export interface PurchaseOrderRecord {
  id: string;
  po_number: string;
  module_key: "po" | "pr";
  supplier_id: string;
  supplier_name: string;
  po_date: string;
  expected_delivery_date?: string;
  items: POLineItemInput[];
  total_amount: number;
  status: "draft" | "pending" | "partially_received" | "completed" | "cancelled";
  notes?: string;
  created_at: number;
  updated_at: number;
}

export class PurchaseOrderService {
  async generateNextPONumber(moduleKey: "po" | "pr" = "po"): Promise<string> {
    const prefix = moduleKey === "po" ? "PO" : "PR";
    const fy = getIndianFinancialYear();
    const all = await sqliteStorage.findAll<PurchaseOrderRecord>("purchase_orders");
    const matching = all.filter((p) => p.po_number?.startsWith(`${prefix}-${fy}-`));

    let maxNum = 0;
    for (const item of matching) {
      const parts = item.po_number.split("-");
      const last = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(last) && last > maxNum) maxNum = last;
    }

    const nextSeq = String(maxNum + 1).padStart(4, "0");
    return `${prefix}-${fy}-${nextSeq}`;
  }

  async createPO(input: {
    module_key?: "po" | "pr";
    supplier_id: string;
    supplier_name: string;
    po_date: string;
    expected_delivery_date?: string;
    items: POLineItemInput[];
    notes?: string;
  }): Promise<{ success: boolean; poId: string; poNumber: string }> {
    if (input.items.length === 0) throw new Error("PO must have at least one line item");

    const now = Date.now();
    const poId = `po_${now}_${Math.random().toString(16).slice(2, 6)}`;
    const moduleKey = input.module_key || "po";
    const poNumber = await this.generateNextPONumber(moduleKey);

    let totalAmount = 0;
    const computedItems: POLineItemInput[] = input.items.map((it) => {
      const taxable = it.ordered_qty * it.purchase_rate;
      const tax = round2((taxable * it.gst_percent) / 100);
      const lineTotal = round2(taxable + tax);
      totalAmount += lineTotal;
      return {
        ...it,
        received_qty: 0,
        total_amount: lineTotal,
      };
    });

    const poRecord: PurchaseOrderRecord = {
      id: poId,
      po_number: poNumber,
      module_key: moduleKey,
      supplier_id: input.supplier_id,
      supplier_name: input.supplier_name,
      po_date: input.po_date,
      expected_delivery_date: input.expected_delivery_date,
      items: computedItems,
      total_amount: round2(totalAmount),
      status: moduleKey === "pr" ? "draft" : "pending",
      notes: input.notes,
      created_at: now,
      updated_at: now,
    };

    await sqliteStorage.insertRecord("purchase_orders", poId, {
      id: poId,
      po_number: poNumber,
      supplier_id: input.supplier_id,
      supplier_name: input.supplier_name,
      po_date: input.po_date,
      expected_delivery_date: input.expected_delivery_date,
      total_amount: round2(totalAmount),
      status: poRecord.status,
      notes: input.notes,
      created_at: now,
      updated_at: now,
    });

    for (const it of computedItems) {
      const itemId = `poi_${now}_${Math.random().toString(16).slice(2, 6)}`;
      await sqliteStorage.insertRecord("purchase_order_items", itemId, {
        id: itemId,
        po_id: poId,
        product_id: it.product_id,
        product_name: it.product_name,
        hsn_code: it.hsn_code || "",
        ordered_qty: it.ordered_qty,
        received_qty: 0,
        purchase_rate: it.purchase_rate,
        gst_percent: it.gst_percent,
        total_amount: it.total_amount || 0,
      });
    }

    await syncQueueService.enqueue("purchase_order", poId, "create", poRecord);
    return { success: true, poId, poNumber };
  }

  async getAllOrders(): Promise<PurchaseOrderRecord[]> {
    const orders = await sqliteStorage.findAll<any>("purchase_orders");
    const allItems = await sqliteStorage.findAll<any>("purchase_order_items");

    return orders
      .map((po) => {
        const items = allItems.filter((i) => i.po_id === po.id);
        return {
          id: po.id,
          po_number: po.po_number,
          module_key: (po.po_number?.startsWith("PR") ? "pr" : "po") as "po" | "pr",
          supplier_id: po.supplier_id,
          supplier_name: po.supplier_name,
          po_date: po.po_date,
          expected_delivery_date: po.expected_delivery_date,
          items,
          total_amount: po.total_amount || 0,
          status: po.status || "pending",
          notes: po.notes,
          created_at: po.created_at || Date.now(),
          updated_at: po.updated_at || Date.now(),
        };
      })
      .sort((a, b) => b.created_at - a.created_at);
  }

  async getOrderById(id: string): Promise<PurchaseOrderRecord | null> {
    const po = await sqliteStorage.findById<any>("purchase_orders", id);
    if (!po) return null;

    const allItems = await sqliteStorage.findAll<any>("purchase_order_items");
    const items = allItems.filter((i) => i.po_id === po.id);

    return {
      id: po.id,
      po_number: po.po_number,
      module_key: (po.po_number?.startsWith("PR") ? "pr" : "po") as "po" | "pr",
      supplier_id: po.supplier_id,
      supplier_name: po.supplier_name,
      po_date: po.po_date,
      expected_delivery_date: po.expected_delivery_date,
      items,
      total_amount: po.total_amount || 0,
      status: po.status || "pending",
      notes: po.notes,
      created_at: po.created_at || Date.now(),
      updated_at: po.updated_at || Date.now(),
    };
  }

  async updateOrderStatus(id: string, status: PurchaseOrderRecord["status"]): Promise<void> {
    const po = await sqliteStorage.findById<any>("purchase_orders", id);
    if (!po) throw new Error("Purchase Order not found");
    po.status = status;
    po.updated_at = Date.now();
    await sqliteStorage.insertRecord("purchase_orders", id, po);
  }

  async updateReceivedQty(poId: string, receivedMap: Record<string, number>): Promise<void> {
    const po = await this.getOrderById(poId);
    if (!po) return;

    const allItems = await sqliteStorage.findAll<any>("purchase_order_items");
    const poItems = allItems.filter((i) => i.po_id === poId);

    let allCompleted = true;
    let anyReceived = false;

    for (const it of poItems) {
      const newlyReceived = receivedMap[it.product_id] || 0;
      const updatedTotal = round2((it.received_qty || 0) + newlyReceived);
      it.received_qty = updatedTotal;
      await sqliteStorage.insertRecord("purchase_order_items", it.id, it);

      if (updatedTotal > 0) anyReceived = true;
      if (updatedTotal < it.ordered_qty) allCompleted = false;
    }

    const newStatus = allCompleted ? "completed" : anyReceived ? "partially_received" : po.status;
    await this.updateOrderStatus(poId, newStatus);
  }
}

export const purchaseOrderService = new PurchaseOrderService();
