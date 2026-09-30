import { describe, it, expect, beforeEach } from "vitest";
import { posCartService } from "./posCartService";
import { productsStore } from "../masters/productsStore";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";

describe("POS Cart Service & Checkout Pipeline (POS-001, POS-002, POS-007, STK-001, SYNC-001)", () => {
  beforeEach(async () => {
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
    expect(totals.net_before_round).toBe(10);
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
});
