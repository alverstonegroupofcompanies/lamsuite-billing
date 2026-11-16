import { describe, it, expect, beforeEach } from "vitest";
import { companySettingsService } from "./companySettingsService";
import { posCartService } from "../billing/posCartService";
import { salesReturnService } from "../billing/salesReturnService";
import { purchaseService } from "../purchases/purchaseService";
import { posSalesReturnService } from "../billing/posSalesReturnService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { productsStore } from "../masters/productsStore";

describe("Document Sequences Following Settings (Invoices, Returns, Purchases, Quotations)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    posCartService.clearCart();

    // Configure sequences exactly matching user settings in screenshot
    await companySettingsService.updateSettings({
      sequences: {
        invoicePrefix: "INV",
        nextInvoiceNumber: 1001,
        returnPrefix: "SR",
        nextReturnNumber: 1,
        purchasePrefix: "PUR",
        nextPurchaseNumber: 201,
        quotationPrefix: "QUO",
        nextQuotationNumber: 101,
        adjustmentPrefix: "ADJ",
        nextAdjustmentNumber: 401,
        transferPrefix: "TRF",
        nextTransferNumber: 501,
      },
    });
  });

  it("Sales Invoices: follows sequence in settings and auto-increments", async () => {
    // 1. Initial preview matches settings
    expect(companySettingsService.previewNextInvoiceNumber()).toBe("INV-1001");

    // Add product to cart
    await productsStore.upsertProduct({
      id: "prod_01",
      name: "Paracetamol 500mg",
      mrp: 50,
      gst_percent: 5,
    });
    await productsStore.upsertBatch({
      id: "batch_01",
      product_id: "prod_01",
      batch_no: "B1",
      expiry_date: "2028-12-31",
      stock_qty: 100,
      mrp: 50,
      selling_rate: 50,
    });

    const prod = await productsStore.getProductById("prod_01");
    const batch = await sqliteStorage.findById<any>("product_batches", "batch_01");
    posCartService.addItem(prod!, batch!, 2);

    // Finalize first invoice
    const inv1 = companySettingsService.previewNextInvoiceNumber();
    const res1 = await posCartService.finalizeInvoice(inv1, "Cash");
    expect(res1.invoiceNumber).toBe("INV-1001");

    // Settings must now reflect 1002
    const settingsAfter1 = await companySettingsService.loadSettings();
    expect(settingsAfter1.sequences.nextInvoiceNumber).toBe(1002);
    expect(companySettingsService.previewNextInvoiceNumber()).toBe("INV-1002");

    // Finalize second invoice
    posCartService.addItem(prod!, batch!, 1);
    const inv2 = companySettingsService.previewNextInvoiceNumber();
    const res2 = await posCartService.finalizeInvoice(inv2, "Cash");
    expect(res2.invoiceNumber).toBe("INV-1002");

    const settingsAfter2 = await companySettingsService.loadSettings();
    expect(settingsAfter2.sequences.nextInvoiceNumber).toBe(1003);

    // When user changes prefix & sequence in settings
    await companySettingsService.updateSettings({
      sequences: {
        ...settingsAfter2.sequences,
        invoicePrefix: "TAX",
        nextInvoiceNumber: 5000,
      },
    });

    expect(companySettingsService.previewNextInvoiceNumber()).toBe("TAX-5000");
    posCartService.addItem(prod!, batch!, 1);
    const res3 = await posCartService.finalizeInvoice(companySettingsService.previewNextInvoiceNumber(), "Cash");
    expect(res3.invoiceNumber).toBe("TAX-5000");

    const settingsAfter3 = await companySettingsService.loadSettings();
    expect(settingsAfter3.sequences.nextInvoiceNumber).toBe(5001);
  }, 15000);

  it("Sales Returns / Credit Notes: follows sequence in settings and auto-increments", async () => {
    // 1. Initial preview
    const preview1 = await salesReturnService.previewNextReturnNumber();
    expect(preview1).toBe("SR-1");

    // Create return
    const ret1 = await salesReturnService.createSalesReturn({
      customer_id: "c1",
      customer_name: "Walk-in",
      refund_mode: "cash",
      refund_amount: 100,
      lines: [
        {
          product_id: "p1",
          product_name: "Item A",
          batch_no: "B1",
          expiry_date: "2027-10-10",
          return_qty: 1,
          unit_rate: 100,
          gst_percent: 0,
          taxable_amount: 100,
          cgst_amount: 0,
          sgst_amount: 0,
          igst_amount: 0,
          cess_amount: 0,
          total_refund_amount: 100,
          reason: "damaged",
          restock_condition: "damaged",
        },
      ],
    });
    expect(ret1.returnNumber).toBe("SR-1");

    // Settings must now reflect 2
    const settingsAfter1 = await companySettingsService.loadSettings();
    expect(settingsAfter1.sequences.nextReturnNumber).toBe(2);
    expect(await salesReturnService.previewNextReturnNumber()).toBe("SR-2");

    // Second return
    const ret2 = await salesReturnService.createSalesReturn({
      customer_id: "c1",
      customer_name: "Walk-in",
      refund_mode: "cash",
      refund_amount: 50,
      lines: [
        {
          product_id: "p1",
          product_name: "Item A",
          batch_no: "B1",
          expiry_date: "2027-10-10",
          return_qty: 1,
          unit_rate: 50,
          gst_percent: 0,
          taxable_amount: 50,
          cgst_amount: 0,
          sgst_amount: 0,
          igst_amount: 0,
          cess_amount: 0,
          total_refund_amount: 50,
          reason: "damaged",
          restock_condition: "damaged",
        },
      ],
    });
    expect(ret2.returnNumber).toBe("SR-2");

    const settingsAfter2 = await companySettingsService.loadSettings();
    expect(settingsAfter2.sequences.nextReturnNumber).toBe(3);
  });

  it("Purchase Inwards: follows sequence in settings and auto-increments", async () => {
    // 1. Initial preview
    const preview1 = await purchaseService.previewNextPurchaseNumber();
    expect(preview1).toBe("PUR-201");

    // 2. Create purchase without specifying number -> uses PUR-201
    const p1 = await purchaseService.recordInwardPurchaseBill({
      supplier_id: "sup_1",
      supplier_name: "Apex Pharma",
      supplier_invoice_no: "INV-991",
      purchase_date: "2026-11-10",
      lines: [
        {
          product_id: "p1",
          product_name: "Amoxicillin",
          batch_no: "AMX-01",
          expiry_date: "2028-10-10",
          pack_qty: 10,
          units_per_pack: 10,
          purchase_rate: 80,
          mrp: 120,
          gst_percent: 12,
        },
      ],
    });
    expect(p1.purchaseNumber).toBe("PUR-201");

    const settingsAfter1 = await companySettingsService.loadSettings();
    expect(settingsAfter1.sequences.nextPurchaseNumber).toBe(202);
    expect(await purchaseService.previewNextPurchaseNumber()).toBe("PUR-202");

    // 3. Second purchase
    const p2 = await purchaseService.recordInwardPurchaseBill({
      supplier_id: "sup_1",
      supplier_name: "Apex Pharma",
      supplier_invoice_no: "INV-992",
      purchase_date: "2026-11-10",
      lines: [
        {
          product_id: "p1",
          product_name: "Amoxicillin",
          batch_no: "AMX-02",
          expiry_date: "2028-10-10",
          pack_qty: 5,
          units_per_pack: 10,
          purchase_rate: 80,
          mrp: 120,
          gst_percent: 12,
        },
      ],
    });
    expect(p2.purchaseNumber).toBe("PUR-202");

    const settingsAfter2 = await companySettingsService.loadSettings();
    expect(settingsAfter2.sequences.nextPurchaseNumber).toBe(203);
  });

  it("Estimates & Quotations: follows sequence in settings and auto-increments", async () => {
    // 1. Initial preview
    const preview1 = companySettingsService.previewNextDocumentNumber("quotation");
    expect(preview1).toBe("QUO-101");

    // 2. Create quotation
    const q1 = await posSalesReturnService.createQuotation(undefined, "Prospective Client", [
      {
        product_id: "p1",
        product_name: "Wheelchair",
        batch_id: "b1",
        qty: 1,
        unit_price: 5000,
        gst_percent: 12,
      },
    ]);
    expect(q1.quotationNumber).toBe("QUO-101");

    const settingsAfter1 = await companySettingsService.loadSettings();
    expect(settingsAfter1.sequences.nextQuotationNumber).toBe(102);

    // 3. Second quotation
    const q2 = await posSalesReturnService.createQuotation(undefined, "Client 2", [
      {
        product_id: "p1",
        product_name: "Wheelchair",
        batch_id: "b1",
        qty: 1,
        unit_price: 5000,
        gst_percent: 12,
      },
    ]);
    expect(q2.quotationNumber).toBe("QUO-102");

    const settingsAfter2 = await companySettingsService.loadSettings();
    expect(settingsAfter2.sequences.nextQuotationNumber).toBe(103);
  });
});
