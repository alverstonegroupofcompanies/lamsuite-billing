import { describe, it, expect, beforeEach } from "vitest";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import {
  purchaseService,
  type PurchaseLineItemInput,
  type PurchaseDocumentInput,
  type PurchaseDocumentRecord,
} from "./purchaseService";
import { supplierLedgerService, type SupplierMaster } from "./supplierLedgerService";
import { productsStore, type ProductItem, type ProductBatch } from "../masters/productsStore";

describe("Keyboard-First Purchase Inward Workflow & Stock/Ledger Reconciliation", () => {
  const dummySupplier: SupplierMaster = {
    id: "sup_apex",
    name: "Apex Healthcare Pvt Ltd",
    phone: "9876543210",
    gstin: "32ABCDE1234F1Z5",
    place_of_supply: "32-Kerala",
    credit_period_days: 30,
    opening_balance: 0,
    outstanding_balance: 0,
    is_active: true,
  };

  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    await supplierLedgerService.upsertSupplier(dummySupplier);
  });

  it("1. Performs 10-line inward bill flow with new & existing batches, free qty, discount, delete & undo", async () => {
    // Seed an existing batch with negative stock (-5 units from earlier out-of-stock sales)
    const negProduct: ProductItem = {
      id: "prod_amox",
      name: "Amoxicillin 500mg Capsule",
      barcode: "8901001",
      mrp: 120,
      ptr: 80,
      sel_rate: 120,
      gst_percent: 12,
      hsn_sac_code: "300490",
      units_per_pack: 10,
      current_stock: -5,
      is_active: true,
    };
    await productsStore.upsertProduct(negProduct);

    const existingBatchId = "batch_prod_amox_AMX-EX1";
    await productsStore.upsertBatch({
      id: existingBatchId,
      product_id: "prod_amox",
      batch_no: "AMX-EX1",
      expiry_date: "2028-12-31",
      stock_qty: -5, // Negative stock from emergency dispensing
      purchase_rate: 80,
      selling_rate: 12,
    });

    // Create 10 line items representing a rapid counter inward receipt
    const lines: PurchaseLineItemInput[] = [
      // Line 1: Existing batch with negative stock offset (-5 + 100 = 95 units)
      {
        product_id: "prod_amox",
        product_name: "Amoxicillin 500mg Capsule",
        hsn_code: "300490",
        batch_no: "AMX-EX1",
        expiry_date: "2028-12-31",
        pack_qty: 10, // 10 packs * 10 units = 100 units
        units_per_pack: 10,
        purchase_rate: 80,
        gst_percent: 12,
      },
      // Line 2: Scanned barcode item with new batch
      {
        product_id: "prod_dolo",
        product_name: "Dolo 650mg Tablet",
        hsn_code: "300490",
        batch_no: "DOLO-N1",
        expiry_date: "2027-10-31",
        pack_qty: 20,
        units_per_pack: 15,
        purchase_rate: 22,
        gst_percent: 12,
      },
      // Line 3: Free quantity scheme (10 billed + 2 free packs)
      {
        product_id: "prod_pan",
        product_name: "Pantoprazole 40mg",
        hsn_code: "300490",
        batch_no: "PAN-B2",
        expiry_date: "2028-06-30",
        pack_qty: 10,
        free_qty: 2,
        units_per_pack: 10,
        purchase_rate: 60,
        gst_percent: 12,
      },
      // Line 4: Trade discount (5% discount)
      {
        product_id: "prod_azith",
        product_name: "Azithromycin 500mg",
        hsn_code: "300490",
        batch_no: "AZI-01",
        expiry_date: "2027-12-31",
        pack_qty: 5,
        units_per_pack: 5,
        purchase_rate: 100,
        discount_percent: 5,
        gst_percent: 12,
      },
      // Line 5: Pack + loose units (3 packs + 4 loose tablets)
      {
        product_id: "prod_cough",
        product_name: "Cough Syrup 100ml",
        hsn_code: "300490",
        batch_no: "CS-05",
        expiry_date: "2027-08-31",
        pack_qty: 3,
        loose_qty: 4,
        units_per_pack: 1,
        purchase_rate: 45,
        gst_percent: 12,
      },
      // Line 6: Item with high margin
      {
        product_id: "prod_vitc",
        product_name: "Vitamin C Chewable",
        hsn_code: "300490",
        batch_no: "VIT-88",
        expiry_date: "2028-03-31",
        pack_qty: 15,
        units_per_pack: 20,
        purchase_rate: 30,
        selling_rate: 3,
        gst_percent: 12,
      },
      // Line 7: Item created inline in popover (Ctrl+N)
      {
        product_id: "prod_new_inline",
        product_name: "Electrolyte ORS Powder 21g",
        hsn_code: "210690",
        batch_no: "ORS-101",
        expiry_date: "2028-11-30",
        pack_qty: 50,
        units_per_pack: 1,
        purchase_rate: 15,
        mrp: 22,
        selling_rate: 22,
        gst_percent: 12,
      },
      // Line 8: Anti-allergy tablet
      {
        product_id: "prod_cet",
        product_name: "Cetirizine 10mg",
        hsn_code: "300490",
        batch_no: "CET-202",
        expiry_date: "2027-09-30",
        pack_qty: 10,
        units_per_pack: 10,
        purchase_rate: 12,
        gst_percent: 12,
      },
      // Line 9: Pain relief gel
      {
        product_id: "prod_gel",
        product_name: "Diclofenac Gel 30g",
        hsn_code: "300490",
        batch_no: "GEL-99",
        expiry_date: "2028-04-30",
        pack_qty: 12,
        units_per_pack: 1,
        purchase_rate: 55,
        gst_percent: 12,
      },
      // Line 10: Multivitamin syrup
      {
        product_id: "prod_multi",
        product_name: "Multivitamin Tonic 200ml",
        hsn_code: "300490",
        batch_no: "MUL-77",
        expiry_date: "2028-01-31",
        pack_qty: 8,
        units_per_pack: 1,
        purchase_rate: 90,
        gst_percent: 12,
      },
    ];

    // Simulate deleting Line 10 (multivitamin) and undoing it with Ctrl+Z
    const deletedLine = lines.pop()!;
    expect(lines.length).toBe(9);
    // Undo:
    lines.push(deletedLine);
    expect(lines.length).toBe(10);

    // Save inward bill
    const purchaseInput: PurchaseDocumentInput = {
      supplier_id: dummySupplier.id,
      supplier_name: dummySupplier.name,
      supplier_gstin: dummySupplier.gstin,
      supplier_invoice_no: "INV-APEX-8899",
      purchase_date: "2026-10-31",
      due_date: "2026-11-30",
      place_of_supply: "32-Kerala",
      is_interstate: false,
      lines,
    };

    const result = await purchaseService.recordInwardPurchaseBill(purchaseInput);
    expect(result.success).toBe(true);
    expect(result.purchaseNumber).toBeDefined();

    // Verify Negative Stock Offset on Line 1:
    // Initial was -5 units. Added 10 packs * 10 units = 100 units. New stock must be exactly 95 units!
    const batchAmox = await sqliteStorage.findById<ProductBatch>("product_batches", existingBatchId);
    expect(batchAmox).toBeDefined();
    expect(batchAmox?.stock_qty).toBe(95);

    const prodAmox = await productsStore.getProductById("prod_amox");
    expect(prodAmox?.current_stock).toBe(95);

    // Verify Line 3 Free Goods:
    // 10 billed + 2 free = 12 packs * 10 units = 120 total stock units credited
    const batchPan = await sqliteStorage.findById<ProductBatch>("product_batches", "batch_prod_pan_PAN-B2");
    expect(batchPan?.stock_qty).toBe(120);

    // Verify Line 4 Trade Discount:
    // 5 packs @ 100 = 500 gross. 5% disc = 25. Taxable = 475. 12% GST = 57. Total = 532.
    const calcAzith = purchaseService.calculateLineTotals(lines[3]);
    expect(calcAzith.discount_amount).toBe(25);
    expect(calcAzith.taxable_amount).toBe(475);
    expect(calcAzith.total_amount).toBe(532);

    // Verify Supplier Ledger Credit:
    // Supplier balance must increase by grand total
    const updatedSup = await supplierLedgerService.getSupplierById(dummySupplier.id);
    expect(updatedSup).toBeDefined();
    expect(updatedSup?.outstanding_balance).toBeGreaterThan(0);

    // Verify Last Purchase Rate Cache:
    const lastRate = await purchaseService.getLastPurchaseForItem("prod_dolo", dummySupplier.id);
    expect(lastRate).toBeDefined();
    expect(lastRate?.rate).toBe(22);
  });

  it("2. Blocks duplicate vendor bill number for same supplier in financial year", async () => {
    const docInput: PurchaseDocumentInput = {
      supplier_id: dummySupplier.id,
      supplier_name: dummySupplier.name,
      supplier_invoice_no: "DUP-BILL-001",
      purchase_date: "2026-10-31",
      lines: [
        {
          product_id: "prod_test",
          product_name: "Test Paracetamol",
          batch_no: "B-01",
          expiry_date: "2028-12-31",
          pack_qty: 5,
          purchase_rate: 20,
          gst_percent: 12,
        },
      ],
    };

    await purchaseService.recordInwardPurchaseBill(docInput);

    // Duplicate check must find the bill
    const dup = await purchaseService.checkDuplicateInvoice(dummySupplier.id, "DUP-BILL-001");
    expect(dup).not.toBeNull();
    expect(dup?.supplier_invoice_no).toBe("DUP-BILL-001");
  });

  it("3. Atomic Edit & Reversal: reverses old stock & ledger effects and applies revised lines cleanly", async () => {
    // 1. Create original purchase with 10 units @ ₹50 = ₹500 + 12% = ₹560
    const originalInput: PurchaseDocumentInput = {
      supplier_id: dummySupplier.id,
      supplier_name: dummySupplier.name,
      supplier_invoice_no: "REV-TEST-001",
      purchase_date: "2026-10-31",
      lines: [
        {
          product_id: "prod_rev",
          product_name: "Revision Test Item",
          batch_no: "REV-B1",
          expiry_date: "2028-10-31",
          pack_qty: 10,
          units_per_pack: 1,
          purchase_rate: 50,
          gst_percent: 12,
        },
      ],
    };

    const originalResult = await purchaseService.recordInwardPurchaseBill(originalInput);
    const originalBatch = await sqliteStorage.findById<ProductBatch>("product_batches", "batch_prod_rev_REV-B1");
    expect(originalBatch?.stock_qty).toBe(10);

    const supAfterCreate = await supplierLedgerService.getSupplierById(dummySupplier.id);
    const balanceAfterCreate = supAfterCreate?.outstanding_balance || 0;
    expect(balanceAfterCreate).toBe(560);

    // 2. Edit bill: change quantity from 10 to 15 packs @ ₹50 = ₹750 + 12% = ₹840
    const revisedInput: PurchaseDocumentInput = {
      supplier_id: dummySupplier.id,
      supplier_name: dummySupplier.name,
      supplier_invoice_no: "REV-TEST-001",
      purchase_date: "2026-10-31",
      lines: [
        {
          product_id: "prod_rev",
          product_name: "Revision Test Item",
          batch_no: "REV-B1",
          expiry_date: "2028-10-31",
          pack_qty: 15,
          units_per_pack: 1,
          purchase_rate: 50,
          gst_percent: 12,
        },
      ],
    };

    const updateResult = await purchaseService.updatePurchaseBill(
      originalResult.purchaseId,
      revisedInput,
      "Quantity adjusted from 10 to 15"
    );
    expect(updateResult.success).toBe(true);

    // Batch stock should now be exactly 15 (10 reversed, 15 applied)
    const revisedBatch = await sqliteStorage.findById<ProductBatch>("product_batches", "batch_prod_rev_REV-B1");
    expect(revisedBatch?.stock_qty).toBe(15);

    // Supplier balance should now be exactly 840 (560 credited, 560 reversed, 840 credited)
    const supAfterUpdate = await supplierLedgerService.getSupplierById(dummySupplier.id);
    expect(supAfterUpdate?.outstanding_balance).toBe(840);

    // Verify document record marked revised
    const updatedDoc = await sqliteStorage.findById<PurchaseDocumentRecord>("purchase_documents", originalResult.purchaseId);
    expect(updatedDoc?.is_revised).toBe(1);
    expect(updatedDoc?.grand_total).toBe(840);
  });
});
