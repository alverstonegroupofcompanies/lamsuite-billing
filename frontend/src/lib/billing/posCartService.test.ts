import { describe, it, expect, beforeEach } from "vitest";
import { posCartService } from "./posCartService";
import { productsStore } from "../masters/productsStore";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { onlineTransactionService } from "../sync/onlineTransactionService";

describe("POS Cart Service & Checkout Pipeline (POS-001, POS-002, POS-007, STK-001, SYNC-001)", () => {
  beforeEach(async () => {
    (onlineTransactionService as any).connectionState = "offline";
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    posCartService.clearCart();

    // Seed test product and batches
    await productsStore.upsertProduct({
      id: "prod_paracetamol",
      name: "Paracetamol 500mg",
      barcode: "8901111",
      hsn_sac_code: "3004",
      mrp: 30,
      sel_rate: 25,
      gst_percent: 12,
      units_per_pack: 10,
      is_active: true,
    });

    await productsStore.upsertBatch({
      id: "batch_p1",
      product_id: "prod_paracetamol",
      batch_no: "B-2026-P1",
      expiry_date: "2027-06-30",
      stock_qty: 100,
    });
  });

  it("scans barcode and adds to cart with FEFO batch in sub-30ms", async () => {
    const start = performance.now();
    const res = await posCartService.scanBarcodeAndAddToCart("8901111");
    const duration = performance.now() - start;

    expect(res.success).toBe(true);
    expect(duration).toBeLessThan(30); // Sub-30ms latency requirement

    const lines = posCartService.getLines();
    expect(lines.length).toBe(1);
    expect(lines[0].product.name).toBe("Paracetamol 500mg");
    expect(lines[0].selectedBatch.batch_no).toBe("B-2026-P1");
  });

  it("handles loose quantity selling with fractional pricing", async () => {
    const product = (await productsStore.getProductById("prod_paracetamol"))!;
    const batch = (await productsStore.getEarliestExpiringBatch("prod_paracetamol"))!;

    // Add 4 loose tablets (price: 25 / 10 * 4 = ₹10.00 gross)
    posCartService.addProductToCart(product, batch, 0, 4);

    const totals = posCartService.getTotals();
    expect(totals.grand_total).toBe(10);
    expect(totals.round_off).toBe(0);
  });

  it("attaches clinical metadata (Doctor & Patient)", () => {
    posCartService.setPrescriptionMeta({
      doctor_name: "Dr. A. Sharma",
      doctor_reg_no: "MCI-99882",
      patient_name: "Rohan V.",
      patient_age: 32,
      patient_gender: "Male",
    });

    const meta = posCartService.getPrescriptionMeta();
    expect(meta.doctor_name).toBe("Dr. A. Sharma");
    expect(meta.doctor_reg_no).toBe("MCI-99882");
    expect(meta.patient_name).toBe("Rohan V.");
  });

  it("finalizes bill: writes invoice, line items, stock transaction, and sync queue atomically", async () => {
    await posCartService.scanBarcodeAndAddToCart("8901111");
    posCartService.setCustomer("cust_1", "Suresh Kumar", "32AABCU9603R1ZM");

    const result = await posCartService.finalizeInvoice("INV-2026-9001", "Cash");
    expect(result.success).toBe(true);

    // Verify invoice saved in SQLite
    const invoice = await sqliteStorage.findById("invoices", result.invoiceId);
    expect(invoice).not.toBeNull();
    expect(invoice?.invoice_number).toBe("INV-2026-9001");
    expect(invoice?.customer_name).toBe("Suresh Kumar");

    // Verify line item saved
    const items = await sqliteStorage.findAll("invoice_items");
    expect(items.length).toBe(1);
    expect(items[0].product_name).toBe("Paracetamol 500mg");

    // Verify stock transaction posted (deducted 10 units for 1 pack)
    const stockTx = await sqliteStorage.findAll("stock_transactions");
    expect(stockTx.length).toBe(1);
    expect(stockTx[0].qty_delta).toBe(-10);
    expect(stockTx[0].event_type).toBe("SALE");

    // Verify enqueued into sync queue
    const queue = await sqliteStorage.findAll("sync_queue");
    expect(queue.length).toBe(1);
    expect(queue[0].entity_type).toBe("invoice");
    expect(queue[0].entity_id).toBe(result.invoiceId);

    // Verify cart was cleared
    expect(posCartService.getLines().length).toBe(0);
  });

  it("supports snapshot finalization and delayed clearing for robust print workflows", async () => {
    await posCartService.scanBarcodeAndAddToCart("8901111");
    expect(posCartService.getLines().length).toBe(1);

    // 1. Take snapshot of cart
    const snapshot = [...posCartService.getLines()];
    const totals = posCartService.getTotals();

    // 2. Finalize with autoClear: false
    const res = await posCartService.finalizeInvoice("INV-2026-SNAPSHOT", "UPI", {
      autoClear: false,
      linesSnapshot: snapshot,
      totalsSnapshot: totals,
    });

    expect(res.success).toBe(true);

    // Verify cart lines are preserved while print completes
    expect(posCartService.getLines().length).toBe(1);

    // Verify invoice saved correctly with UPI payment mode
    const invoice = await sqliteStorage.findById("invoices", res.invoiceId);
    expect(invoice?.payment_mode).toBe("UPI");
    expect(invoice?.invoice_number).toBe("INV-2026-SNAPSHOT");

    // 3. Clear cart after print completes
    posCartService.clearCart();
    expect(posCartService.getLines().length).toBe(0);

    // 4. Truly empty cart throws error
    await expect(posCartService.finalizeInvoice("INV-FAIL", "Cash")).rejects.toThrow("Cannot finalize empty cart");
  });

  it("links customer with phone number, GSTIN, and place of supply on finalized invoice", async () => {
    await posCartService.scanBarcodeAndAddToCart("8901111");
    posCartService.setCustomer("cust_99", "Rahul Verma", "32AAAAA0000A1Z5", "32-Kerala", "9876543210");

    const result = await posCartService.finalizeInvoice("INV-CUST-PHONE", "Card");
    expect(result.success).toBe(true);

    const invoice = await sqliteStorage.findById<Record<string, unknown>>("invoices", result.invoiceId);
    expect(invoice?.customer_id).toBe("cust_99");
    expect(invoice?.customer_name).toBe("Rahul Verma");
    expect(invoice?.customer_phone).toBe("9876543210");
    expect(invoice?.customer_gstin).toBe("32AAAAA0000A1Z5");
    expect(invoice?.place_of_supply).toBe("32-Kerala");
  });

  it("supports adding out-of-stock batches and ad-hoc batches with negative stock warnings", async () => {
    const product = (await productsStore.getProductById("prod_paracetamol"))!;
    
    // Create an out-of-stock batch
    const oosBatch = {
      id: "batch_oos",
      product_id: "prod_paracetamol",
      batch_no: "B-OOS-01",
      expiry_date: "2027-12-31",
      stock_qty: 0,
      mrp: 30,
      selling_rate: 25,
    };
    await productsStore.upsertBatch(oosBatch);

    posCartService.addProductToCart(product, oosBatch, 2, 0);

    const lines = posCartService.getLines();
    expect(lines.length).toBe(1);
    expect(lines[0].isNegativeStock).toBe(true);
    expect(lines[0].availableStockSnapshot).toBe(0);
    expect(lines[0].shortageQty).toBe(2);

    // Finalize invoice and verify batch stock becomes -20 base units (2 packs of 10)
    const res = await posCartService.finalizeInvoice("INV-NEG-001", "Cash");
    expect(res.success).toBe(true);

    const updatedBatch = await sqliteStorage.findById<any>("product_batches", "batch_oos");
    expect(updatedBatch?.stock_qty).toBe(-20); // 0 - 20 = -20, NOT clamped to 0

    const stockTxs = await sqliteStorage.findAll<any>("stock_transactions");
    const saleTx = stockTxs.find((t) => t.batch_id === "batch_oos");
    expect(saleTx).toBeDefined();
    expect(saleTx?.qty_delta).toBe(-20);
  });

  it("splits requested quantity across FEFO batches and assigns shortfall to last batch", async () => {
    const product = (await productsStore.getProductById("prod_paracetamol"))!;
    
    // Batch 1 has 1 pack (10 units), Batch 2 has 2 packs (20 units)
    await productsStore.upsertBatch({
      id: "batch_fefo_1",
      product_id: "prod_paracetamol",
      batch_no: "FEFO-1",
      expiry_date: "2026-11-01",
      stock_qty: 1, // 1 pack
    });
    await productsStore.upsertBatch({
      id: "batch_fefo_2",
      product_id: "prod_paracetamol",
      batch_no: "FEFO-2",
      expiry_date: "2026-12-01",
      stock_qty: 2, // 2 packs
    });

    const batches = await productsStore.getBatchesForProduct("prod_paracetamol");
    // Request 5 packs total (1 from FEFO-1, 2 from FEFO-2, remaining 2 packs shortfall on FEFO-2)
    posCartService.addBatchesWithFefoSplit(product, batches, 5);

    const lines = posCartService.getLines();
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const totalQty = lines.reduce((sum, l) => sum + l.qty, 0);
    expect(totalQty).toBe(5);
  });

  it("applies item discount, bill discount, and custom manual round-off to cart totals and finalized invoices", async () => {
    const product = (await productsStore.getProductById("prod_paracetamol"))!;
    const batch = (await productsStore.getEarliestExpiringBatch("prod_paracetamol"))!;

    // 1. Add 2 packs @ ₹25 = ₹50.00 gross (inclusive 12% GST)
    posCartService.addProductToCart(product, batch, 2, 0);
    const lineId = posCartService.getLines()[0].id;

    // 2. Apply line discount: ₹5.00
    posCartService.updateLineDiscount(lineId, 0, 5);
    let totals = posCartService.getTotals();
    expect(totals.line_discount_total).toBe(5);

    // 3. Apply bill discount: 10%
    posCartService.setBillDiscount("percent", 10);
    totals = posCartService.getTotals();
    expect(totals.bill_discount_amount).toBeGreaterThan(0);

    // 4. Apply custom manual round-off: +0.50
    posCartService.setManualRoundOff(0.5);
    totals = posCartService.getTotals();
    expect(totals.round_off).toBe(0.5);

    // 5. Finalize invoice and verify persisted totals
    const res = await posCartService.finalizeInvoice("INV-DISC-RO", "Cash");
    expect(res.success).toBe(true);

    const invoice = await sqliteStorage.findById<any>("invoices", res.invoiceId);
    expect(invoice?.round_off).toBe(0.5);
    expect(invoice?.grand_total).toBe(totals.grand_total);
    expect(invoice?.discount_total).toBe(totals.line_discount_total + totals.bill_discount_amount);
  });
});
