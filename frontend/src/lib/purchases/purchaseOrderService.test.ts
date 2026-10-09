import { describe, it, expect, beforeEach } from "vitest";
import { purchaseOrderService } from "./purchaseOrderService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";

describe("Purchase Order Service", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
  });

  it("creates a purchase order with sequence and computes line totals", async () => {
    const res = await purchaseOrderService.createPO({
      module_key: "po",
      supplier_id: "sup_1",
      supplier_name: "Apex Healthcare",
      po_date: "2026-10-01",
      items: [
        {
          product_id: "p1",
          product_name: "Amoxicillin",
          ordered_qty: 10,
          purchase_rate: 100,
          gst_percent: 12,
        },
      ],
    });

    expect(res.success).toBe(true);
    expect(res.poNumber).toMatch(/^PO-/);

    const po = await purchaseOrderService.getOrderById(res.poId);
    expect(po).not.toBeNull();
    expect(po?.items.length).toBe(1);
    expect(po?.total_amount).toBe(1120); // 1000 + 12% = 1120
    expect(po?.status).toBe("pending");
  });

  it("updates received quantity and marks PO as partially_received and completed", async () => {
    const res = await purchaseOrderService.createPO({
      supplier_id: "sup_1",
      supplier_name: "Apex Healthcare",
      po_date: "2026-10-01",
      items: [
        {
          product_id: "p1",
          product_name: "Amoxicillin",
          ordered_qty: 10,
          purchase_rate: 100,
          gst_percent: 12,
        },
      ],
    });

    // Receive 4 items
    await purchaseOrderService.updateReceivedQty(res.poId, { p1: 4 });
    let po = await purchaseOrderService.getOrderById(res.poId);
    expect(po?.status).toBe("partially_received");
    expect(po?.items[0].received_qty).toBe(4);

    // Receive remaining 6 items
    await purchaseOrderService.updateReceivedQty(res.poId, { p1: 6 });
    po = await purchaseOrderService.getOrderById(res.poId);
    expect(po?.status).toBe("completed");
    expect(po?.items[0].received_qty).toBe(10);
  });
});
