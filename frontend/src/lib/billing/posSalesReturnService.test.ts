import { describe, it, expect, beforeEach } from "vitest";
import { posSalesReturnService } from "./posSalesReturnService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch } from "../masters/productsStore";

describe("Sales Returns & Quotations (RET-001, RET-002)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
  });

  describe("RET-001: Sales Return & Restocking", () => {
    it("processes sales return, restocks batch in SQLite, logs stock transaction, and creates credit note", async () => {
      // Initial batch with 10 units
      const batchId = "batch_ret_test";
      await productsStore.upsertBatch({
        id: batchId,
        product_id: "prod_syrup",
        batch_no: "SYR-01",
        expiry_date: "2027-12-31",
        stock_qty: 10,
      });

      // Customer returns 2 bottles
      const res = await posSalesReturnService.processSalesReturn(
        "CN-2026-001",
        "INV-2026-0042",
        "cust_1",
        "John Doe",
        [
          {
            product_id: "prod_syrup",
            batch_id: batchId,
            qty: 2,
            return_rate: 100,
            gst_percent: 12,
          },
        ],
        "Cash"
      );

      expect(res.success).toBe(true);
      expect(res.refundAmount).toBe(224); // 200 taxable + 24 tax (12%)

      // Verify batch stock increased by 2 (restocked from 10 to 12)
      const batch = await sqliteStorage.findById<ProductBatch>("product_batches", batchId);
      expect(batch?.stock_qty).toBe(12);

      // Verify double-entry stock transaction
      const stockTxs = await sqliteStorage.findAll<{
        event_type: string;
        qty_delta: number;
        reference_id: string;
      }>("stock_transactions");
      expect(stockTxs.length).toBe(1);
      expect(stockTxs[0].event_type).toBe("SALES_RETURN");
      expect(stockTxs[0].qty_delta).toBe(2);
      expect(stockTxs[0].reference_id).toBe("CN-2026-001");
    });
  });

  describe("RET-002: Quotations & Conversion", () => {
    it("creates quotation and converts it to active invoice", async () => {
      const qRes = await posSalesReturnService.createQuotation("QUOT-2026-001", "Dr. Rajesh", [
        {
          product_id: "p1",
          product_name: "Thermometer",
          batch_id: "b1",
          qty: 5,
          unit_price: 200,
          gst_percent: 18,
        },
      ]);

      expect(qRes.success).toBe(true);

      const stored = await sqliteStorage.findById<{
        module_key: string;
        status: string;
        sync_state: string;
      }>("invoices", qRes.quotationId);
      expect(stored?.module_key).toBe("quotation");
      expect(stored?.status).toBe("issued");
      expect(stored?.sync_state).toBe("pending");

      const convRes = await posSalesReturnService.convertQuotationToInvoice(qRes.quotationId);
      expect(convRes.success).toBe(true);
      expect(convRes.quotation.status).toBe("converted");
      expect(convRes.quotation.grand_total).toBe(1180); // 1000 + 180 tax

      const storedAfter = await sqliteStorage.findById<{ status: string }>("invoices", qRes.quotationId);
      expect(storedAfter?.status).toBe("converted");
    });

    it("enqueues quotation sync and collapses conversion into a single pending update", async () => {
      const qRes = await posSalesReturnService.createQuotation(undefined, "Acme Traders", [
        {
          product_id: "p1",
          product_name: "Thermometer",
          batch_id: "b1",
          qty: 2,
          unit_price: 300,
          gst_percent: 18,
          discount_percent: 10,
        },
      ]);

      let queue = await sqliteStorage.findAll<{
        entity_type: string;
        action: string;
        payload_json: string;
      }>("sync_queue");
      const created = queue.find((q) => q.entity_type === "invoice");
      expect(created).toBeTruthy();
      expect(created?.action).toBe("create");
      const createPayload = JSON.parse(created!.payload_json);
      expect(createPayload.module_key).toBe("quotation");
      expect(createPayload.customer_name).toBe("Acme Traders");
      expect(Array.isArray(createPayload.items)).toBe(true);
      expect(createPayload.items.length).toBe(1);

      await posSalesReturnService.convertQuotationToInvoice(qRes.quotationId);

      queue = await sqliteStorage.findAll<{
        entity_type: string;
        action: string;
        payload_json: string;
      }>("sync_queue");
      const invoiceItems = queue.filter((q) => q.entity_type === "invoice");
      expect(invoiceItems.length).toBe(1);
      expect(invoiceItems[0].action).toBe("update");
      expect(JSON.parse(invoiceItems[0].payload_json).status).toBe("converted");
    });

    it("rejects an empty quotation", async () => {
      await expect(
        posSalesReturnService.createQuotation(undefined, "Nobody", [])
      ).rejects.toThrow(/without line items/i);
    });
  });
});
