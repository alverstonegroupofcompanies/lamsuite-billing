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

      const convRes = await posSalesReturnService.convertQuotationToInvoice(qRes.quotationId);
      expect(convRes.success).toBe(true);
      expect(convRes.quotation.status).toBe("converted");
      expect(convRes.quotation.grand_total).toBe(1180); // 1000 + 180 tax
    });
  });
});
