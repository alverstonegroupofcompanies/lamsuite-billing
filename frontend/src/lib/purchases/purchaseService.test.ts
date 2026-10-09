import { describe, it, expect, beforeEach } from "vitest";
import { purchaseService, type PurchaseLineItemInput } from "./purchaseService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch } from "../masters/productsStore";
import { supplierLedgerService } from "./supplierLedgerService";

describe("Purchase Service & Inward Stock Receipts (PUR-001, PUR-002, PUR-003, STK-001)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
  });

  describe("Pack, Loose, Free Goods & Taxable Calculations", () => {
    it("computes taxable value on billed quantity only, while crediting full stock", () => {
      // 10 billed strips + 2 free strips @ ₹100/strip. 10 tablets per strip.
      const line: PurchaseLineItemInput = {
        product_id: "prod_amox",
        product_name: "Amoxicillin 500mg",
        batch_no: "AMX-101",
        expiry_date: "2027-12-31",
        pack_qty: 10,
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
      expect(calc.igst_amount).toBe(0);
      expect(calc.total_amount).toBe(1120);

      // Total stock received = (10 + 2) * 10 = 120 base units
      expect(calc.total_stock_units).toBe(120);

      // Effective unit cost = 1000 / 120 = ₹8.33 / tablet
      expect(calc.effective_unit_cost).toBe(8.33);
    });

    it("calculates pack + loose units and applies trade discount and scheme discount", () => {
      // 2 packs (10 units/pack) + 5 loose units @ ₹100/pack -> Gross = 2.5 * 100 = ₹250
      // 10% trade discount = ₹25, flat discount = ₹5 -> Discount = ₹30 -> Taxable = ₹220
      const line: PurchaseLineItemInput = {
        product_id: "prod_syrup",
        product_name: "Cough Syrup",
        batch_no: "CS-01",
        expiry_date: "2027-08-31",
        pack_qty: 2,
        loose_qty: 5,
        units_per_pack: 10,
        purchase_rate: 100,
        discount_percent: 10,
        discount_amount: 5,
        gst_percent: 18,
      };

      const calc = purchaseService.calculateLineTotals(line);
      expect(calc.billed_units).toBe(25);
      expect(calc.gross_amount).toBe(250);
      expect(calc.discount_amount).toBe(30);
      expect(calc.taxable_amount).toBe(220);
      expect(calc.total_tax).toBe(39.6);
      expect(calc.total_amount).toBe(259.6);
    });

    it("handles interstate IGST mode when isInterstate flag is true", () => {
      const line: PurchaseLineItemInput = {
        product_id: "prod_inter",
        product_name: "Interstate Device",
        batch_no: "INT-1",
        expiry_date: "2028-01-01",
        pack_qty: 1,
        units_per_pack: 1,
        purchase_rate: 500,
        gst_percent: 18,
      };

      const calc = purchaseService.calculateLineTotals(line, true);
      expect(calc.cgst_amount).toBe(0);
      expect(calc.sgst_amount).toBe(0);
      expect(calc.igst_amount).toBe(90);
      expect(calc.total_tax).toBe(90);
      expect(calc.total_amount).toBe(590);
    });

    it("computes margin percentage against selling rate", () => {
      const line: PurchaseLineItemInput = {
        product_id: "prod_margin",
        product_name: "Margin Item",
        batch_no: "M-01",
        expiry_date: "2027-12-31",
        pack_qty: 1,
        units_per_pack: 1,
        purchase_rate: 80, // landing cost 80
        selling_rate: 100, // selling rate 100
        gst_percent: 0,
      };

      const calc = purchaseService.calculateLineTotals(line);
      // margin = ((100 - 80) / 100) * 100 = 20%
      expect(calc.margin_percent).toBe(20);
    });
  });

  describe("Duplicate Invoice Detection", () => {
    it("detects when the same supplier invoice number is recorded", async () => {
      await purchaseService.recordInwardPurchaseBill({
        purchase_number: "PB-2026-001",
        supplier_id: "sup_1",
        supplier_name: "Distributor A",
        supplier_invoice_no: "INV-9901",
        purchase_date: "2026-10-01",
        lines: [
          {
            product_id: "p1",
            product_name: "Paracetamol",
            batch_no: "B1",
            expiry_date: "2027-10-31",
            pack_qty: 1,
            purchase_rate: 50,
            gst_percent: 5,
          },
        ],
      });

      const dup = await purchaseService.checkDuplicateInvoice("sup_1", "inv-9901");
      expect(dup).not.toBeNull();
      expect(dup?.purchase_number).toBe("PB-2026-001");

      const notDup = await purchaseService.checkDuplicateInvoice("sup_2", "inv-9901");
      expect(notDup).toBeNull();
    });
  });

  describe("Atomic Inward Posting & Ledger Credit", () => {
    it("records inward purchase bill, updates batch stock, posts to supplier ledger and sync queue", async () => {
      const res = await purchaseService.recordInwardPurchaseBill({
        purchase_number: "PB-2026-002",
        supplier_id: "sup_apex",
        supplier_name: "Apex Healthcare",
        supplier_invoice_no: "SUP-INV-9902",
        purchase_date: "2026-10-02",
        lines: [
          {
            product_id: "prod_paracetamol",
            product_name: "Paracetamol 500mg",
            batch_no: "PB-02",
            expiry_date: "2027-10-31",
            pack_qty: 5,
            units_per_pack: 10,
            purchase_rate: 20,
            gst_percent: 5,
            mrp: 30,
            selling_rate: 28,
          },
        ],
      });

      expect(res.success).toBe(true);

      // 1. Verify batch stock was credited (5 packs * 10 units = 50 units)
      const batches = await productsStore.getBatchesForProduct("prod_paracetamol", false);
      expect(batches.length).toBe(1);
      expect(batches[0].batch_no).toBe("PB-02");
      expect(batches[0].stock_qty).toBe(50);
      expect(batches[0].purchase_rate).toBe(20);

      // 2. Verify master product updated
      const prod = await productsStore.getProductById("prod_paracetamol");
      expect(prod?.current_stock).toBe(50);
      expect(prod?.ptr).toBe(20);

      // 3. Verify stock transaction was posted
      const stockTx = await sqliteStorage.findAll<any>("stock_transactions");
      expect(stockTx.length).toBe(1);
      expect(stockTx[0].event_type).toBe("PURCHASE_RECEIPT");
      expect(stockTx[0].qty_delta).toBe(50);

      // 4. Verify supplier ledger entry was credited
      const stmt = await supplierLedgerService.getSupplierStatement("sup_apex");
      expect(stmt.summary.totalPurchases).toBe(105); // 100 taxable + 5% tax = 105
      expect(stmt.summary.closingBalance).toBe(105);
    });

    it("cancels purchase bill, reverts stock and posts debit ledger adjustment", async () => {
      const res = await purchaseService.recordInwardPurchaseBill({
        purchase_number: "PB-2026-003",
        supplier_id: "sup_cancel",
        supplier_name: "Cancel Supplier",
        supplier_invoice_no: "CAN-001",
        purchase_date: "2026-10-02",
        lines: [
          {
            product_id: "p_cancel",
            product_name: "Cancel Item",
            batch_no: "CAN-B1",
            expiry_date: "2027-10-31",
            pack_qty: 10,
            units_per_pack: 1,
            purchase_rate: 10,
            gst_percent: 0,
          },
        ],
      });

      const cancelRes = await purchaseService.cancelPurchaseBill(res.purchaseId, "Wrong shipment received");
      expect(cancelRes.success).toBe(true);

      // Verify batch stock reverted to 0
      const batches = await productsStore.getBatchesForProduct("p_cancel", false);
      expect(batches[0].stock_qty).toBe(0);

      // Verify supplier ledger adjusted
      const stmt = await supplierLedgerService.getSupplierStatement("sup_cancel");
      expect(stmt.summary.closingBalance).toBe(0);
    });
  });
});
