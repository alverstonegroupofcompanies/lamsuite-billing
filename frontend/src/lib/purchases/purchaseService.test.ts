import { describe, it, expect, beforeEach } from "vitest";
import { purchaseService, type PurchaseLineItemInput } from "./purchaseService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch } from "../masters/productsStore";

describe("Purchase Service & Inward Stock Receipts (PUR-001, PUR-002, PUR-003, STK-001)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
  });

  describe("Free Goods & Taxable Value", () => {
    it("computes taxable value on billed quantity only, while crediting full stock", () => {
      // 10 billed strips + 2 free strips @ ₹100/strip. 10 tablets per strip.
      const line: PurchaseLineItemInput = {
        product_id: "prod_amox",
        product_name: "Amoxicillin 500mg",
        batch_no: "AMX-101",
        expiry_date: "2027-12-31",
        qty: 10,
        free_qty: 2,
        units_per_pack: 10,
        purchase_rate: 100, // ex-tax rate
        gst_percent: 12,
      };

      const calc = purchaseService.calculateLineTotals(line);

      // Taxable amount is strictly 10 * 100 = ₹1,000 (free strips are not billed)
      expect(calc.taxable_amount).toBe(1000);

      // 12% GST on ₹1,000 = ₹120 (CGST ₹60 + SGST ₹60)
      expect(calc.total_tax).toBe(120);
      expect(calc.cgst_amount).toBe(60);
      expect(calc.sgst_amount).toBe(60);
      expect(calc.total_amount).toBe(1120);

      // Total stock received = (10 + 2) * 10 = 120 base units
      expect(calc.total_stock_units).toBe(120);

      // Effective unit cost = 1000 / 120 = ₹8.33 / tablet
      expect(calc.effective_unit_cost).toBe(8.33);
    });
  });

  describe("Purchase Inward Bill & Batch Creation", () => {
    it("records inward purchase bill, updates batch stock, and logs stock transaction", async () => {
      const res = await purchaseService.recordInwardPurchaseBill({
        purchase_number: "PB-2026-001",
        supplier_id: "sup_apex",
        supplier_name: "Apex Healthcare",
        supplier_invoice_no: "SUP-INV-9901",
        purchase_date: "2026-09-30",
        lines: [
          {
            product_id: "prod_paracetamol",
            product_name: "Paracetamol 500mg",
            batch_no: "PB-01",
            expiry_date: "2027-10-31",
            qty: 5,
            units_per_pack: 10,
            purchase_rate: 20,
            gst_percent: 5,
          },
        ],
      });

      expect(res.success).toBe(true);

      // Verify batch stock was credited (5 packs * 10 units = 50 units)
      const batches = await productsStore.getBatchesForProduct("prod_paracetamol", false);
      expect(batches.length).toBe(1);
      expect(batches[0].batch_no).toBe("PB-01");
      expect(batches[0].stock_qty).toBe(50);

      // Verify stock transaction was posted
      const stockTx = await sqliteStorage.findAll("stock_transactions");
      expect(stockTx.length).toBe(1);
      expect(stockTx[0].event_type).toBe("PURCHASE_RECEIPT");
      expect(stockTx[0].qty_delta).toBe(50);
    });

    it("processes purchase return: decrements batch stock and posts debit transaction", async () => {
      const batchId = "batch_to_return";
      await productsStore.upsertBatch({
        id: batchId,
        product_id: "prod_1",
        batch_no: "RET-B1",
        expiry_date: "2027-01-01",
        stock_qty: 100,
      });

      // Return 30 units to supplier
      const returnRes = await purchaseService.recordPurchaseReturn(
        "PR-2026-001",
        "sup_1",
        "prod_1",
        batchId,
        30,
        25
      );

      expect(returnRes.success).toBe(true);

      // Verify batch stock reduced to 70
      const batch = await sqliteStorage.findById<ProductBatch>("product_batches", batchId);
      expect(batch?.stock_qty).toBe(70);

      // Verify purchase return stock event logged
      const stockTx = await sqliteStorage.findAll("stock_transactions");
      expect(stockTx[0].event_type).toBe("PURCHASE_RETURN");
      expect(stockTx[0].qty_delta).toBe(-30);
    });
  });
});
