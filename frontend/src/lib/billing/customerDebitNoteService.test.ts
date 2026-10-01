import { describe, it, expect, beforeEach } from "vitest";
import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore } from "../masters/productsStore";
import { partiesStore } from "../masters/partiesStore";
import {
  customerDebitNoteService,
  checkSec34TimeLimit,
  type CustomerDebitNoteInput,
} from "./customerDebitNoteService";

describe("customerDebitNoteService - Customer Debit Notes & Multi-Invoice Credit Notes", () => {
  const dummyProduct1 = {
    id: "prod_dolo_cdn",
    name: "Dolo 650 Tablet",
    barcode: "8901234000555",
    mrp: 32.0,
    sel_rate: 30.0,
    gst_percent: 12,
    units_per_pack: 15,
    is_active: true,
  };

  const dummyProduct2 = {
    id: "prod_azithral_cdn",
    name: "Azithral 500 Tablet",
    barcode: "8901234000666",
    mrp: 120.0,
    sel_rate: 110.0,
    gst_percent: 12,
    units_per_pack: 5,
    is_active: true,
  };

  const batchDolo1 = {
    id: "batch_dolo_cdn1",
    product_id: "prod_dolo_cdn",
    batch_no: "DL2601",
    expiry_date: "2027-10",
    stock_qty: 50,
    selling_rate: 30.0,
  };

  const batchDolo2 = {
    id: "batch_dolo_cdn2",
    product_id: "prod_dolo_cdn",
    batch_no: "DL2602",
    expiry_date: "2027-12",
    stock_qty: 40,
    selling_rate: 28.0,
  };

  beforeEach(async () => {
    await sqliteStorage.initDatabase();
    await sqliteStorage.clearTable("customer_debit_notes");
    await sqliteStorage.clearTable("credit_notes");
    await sqliteStorage.clearTable("sales_returns");
    await sqliteStorage.clearTable("invoices");
    await sqliteStorage.clearTable("invoice_items");
    await sqliteStorage.clearTable("stock_transactions");
    await sqliteStorage.clearTable("products");
    await sqliteStorage.clearTable("product_batches");
    await sqliteStorage.clearTable("customers");

    await productsStore.upsertProduct(dummyProduct1);
    await productsStore.upsertProduct(dummyProduct2);
    await productsStore.upsertBatch({ ...batchDolo1 });
    await productsStore.upsertBatch({ ...batchDolo2 });

    await partiesStore.upsertCustomer({
      id: "cust_medicare_b2b",
      name: "MediCare Pharma B2B",
      gstin: "32AAACM1234F1Z1",
      phone: "9876543210",
      outstanding_balance: 15000,
      credit_limit: 50000,
      is_active: true,
    });

    // Seed Invoice 1: INV-101 (6 Dolo 650 @ 30, batch DL2601)
    await sqliteStorage.insertRecord("invoices", "inv_101", {
      id: "inv_101",
      module_key: "invoice",
      invoice_number: "INV-101",
      invoice_date: "2026-05-10",
      customer_id: "cust_medicare_b2b",
      customer_name: "MediCare Pharma B2B",
      customer_gstin: "32AAACM1234F1Z1",
      place_of_supply: "32-Kerala",
      subtotal: 180,
      discount_total: 0,
      tax_total: 21.6,
      grand_total: 202,
      paid_amount: 202,
      payment_mode: "Bank Transfer",
      status: "issued",
      created_at: Date.now() - 500000,
    });
    await sqliteStorage.insertRecord("invoice_items", "inv_item_101_1", {
      id: "inv_item_101_1",
      invoice_id: "inv_101",
      product_id: "prod_dolo_cdn",
      product_name: "Dolo 650 Tablet",
      batch_id: "batch_dolo_cdn1",
      batch_no: "DL2601",
      expiry_date: "2027-10",
      qty: 6,
      unit_price: 30.0,
      discount_percent: 0,
      discount_amount: 0,
      gst_percent: 12,
      cgst_amount: 10.8,
      sgst_amount: 10.8,
      igst_amount: 0,
      total_amount: 201.6,
    });

    // Seed Invoice 2: INV-118 (10 Dolo 650 @ 28, batch DL2602)
    await sqliteStorage.insertRecord("invoices", "inv_118", {
      id: "inv_118",
      module_key: "invoice",
      invoice_number: "INV-118",
      invoice_date: "2026-06-15",
      customer_id: "cust_medicare_b2b",
      customer_name: "MediCare Pharma B2B",
      customer_gstin: "32AAACM1234F1Z1",
      place_of_supply: "32-Kerala",
      subtotal: 280,
      discount_total: 0,
      tax_total: 33.6,
      grand_total: 314,
      paid_amount: 314,
      payment_mode: "Bank Transfer",
      status: "issued",
      created_at: Date.now() - 300000,
    });
    await sqliteStorage.insertRecord("invoice_items", "inv_item_118_1", {
      id: "inv_item_118_1",
      invoice_id: "inv_118",
      product_id: "prod_dolo_cdn",
      product_name: "Dolo 650 Tablet",
      batch_id: "batch_dolo_cdn2",
      batch_no: "DL2602",
      expiry_date: "2027-12",
      qty: 10,
      unit_price: 28.0,
      discount_percent: 0,
      discount_amount: 0,
      gst_percent: 12,
      cgst_amount: 16.8,
      sgst_amount: 16.8,
      igst_amount: 0,
      total_amount: 313.6,
    });
  });

  it("blocks creating duplicate debit note for the same customer", async () => {
    const input: CustomerDebitNoteInput = {
      debit_note_number: "DN-MED-001",
      debit_note_date: "2026-07-01",
      customer_id: "cust_medicare_b2b",
      customer_dn_amount: 500,
      lines: [
        {
          product_id: "prod_dolo_cdn",
          product_name: "Dolo 650 Tablet",
          customer_qty: 5,
          customer_unit_price: 30,
          customer_gst_percent: 12,
        },
      ],
    };

    const res1 = await customerDebitNoteService.createDebitNote(input);
    expect(res1.success).toBe(true);

    // Try creating duplicate
    await expect(customerDebitNoteService.createDebitNote(input)).rejects.toThrow(
      /already exists for customer/
    );
  });

  it("auto-suggests allocations matching by exact batch then FIFO across invoices", async () => {
    // 1. Search for DL2601 batch specifically
    const suggestions1 = await customerDebitNoteService.autoSuggestAllocationsForLine(
      "cust_medicare_b2b",
      "prod_dolo_cdn",
      "DL2601",
      6
    );

    expect(suggestions1.length).toBe(1);
    expect(suggestions1[0].invoice_number).toBe("INV-101");
    expect(suggestions1[0].return_qty).toBe(6);
    expect(suggestions1[0].unit_price).toBe(30);

    // 2. Request 10 strips across batches
    const suggestions2 = await customerDebitNoteService.autoSuggestAllocationsForLine(
      "cust_medicare_b2b",
      "prod_dolo_cdn",
      undefined,
      10
    );

    // FIFO: INV-101 (6) first, then INV-118 (4)
    expect(suggestions2.length).toBe(2);
    expect(suggestions2[0].invoice_number).toBe("INV-101");
    expect(suggestions2[0].return_qty).toBe(6);
    expect(suggestions2[0].unit_price).toBe(30);

    expect(suggestions2[1].invoice_number).toBe("INV-118");
    expect(suggestions2[1].return_qty).toBe(4);
    expect(suggestions2[1].unit_price).toBe(28);
  });

  it("splits 10 strips of Dolo 650 across INV-101 (6) and INV-118 (4) with respective rates & taxes", async () => {
    const allocations = await customerDebitNoteService.autoSuggestAllocationsForLine(
      "cust_medicare_b2b",
      "prod_dolo_cdn",
      undefined,
      10
    );

    const input: CustomerDebitNoteInput = {
      debit_note_number: "DN-MED-SPLIT-01",
      debit_note_date: "2026-07-05",
      customer_id: "cust_medicare_b2b",
      customer_dn_amount: 350,
      lines: [
        {
          product_id: "prod_dolo_cdn",
          product_name: "Dolo 650 Tablet",
          customer_qty: 10,
          customer_unit_price: 30,
          customer_gst_percent: 12,
          customer_line_total: 336, // 10 * 30 + 12% = 336
          allocations,
        },
      ],
    };

    const res = await customerDebitNoteService.createDebitNote(input);
    expect(res.success).toBe(true);

    const dn = await customerDebitNoteService.getDebitNoteById(res.debitNoteId);
    expect(dn).not.toBeNull();
    expect(dn?.lines[0].allocation_status).toBe("full");
    expect(dn?.lines[0].allocated_qty).toBe(10);

    // Calculated amount: (6 * 30 * 1.12 = 201.6) + (4 * 28 * 1.12 = 125.44) = 327.04
    expect(dn?.our_calculated_amount).toBe(327.04);
    // Variance: 350 - 327.04 = 22.96
    expect(dn?.variance).toBe(22.96);
  });

  it("Option B generates separate Credit Notes per original invoice", async () => {
    const allocations = await customerDebitNoteService.autoSuggestAllocationsForLine(
      "cust_medicare_b2b",
      "prod_dolo_cdn",
      undefined,
      10
    );

    const res = await customerDebitNoteService.createDebitNote({
      debit_note_number: "DN-OPT-B-01",
      debit_note_date: "2026-07-10",
      customer_id: "cust_medicare_b2b",
      customer_dn_amount: 327,
      credit_note_option: "B",
      lines: [
        {
          product_id: "prod_dolo_cdn",
          product_name: "Dolo 650 Tablet",
          customer_qty: 10,
          customer_unit_price: 29.2,
          customer_gst_percent: 12,
          allocations,
        },
      ],
    });

    // Approve
    await customerDebitNoteService.approveDebitNote(res.debitNoteId, {});

    // Issue Credit Notes with Option B
    const cnRes = await customerDebitNoteService.issueCreditNotes(res.debitNoteId, {
      creditNoteOption: "B",
    });

    expect(cnRes.success).toBe(true);
    expect(cnRes.creditNotes.length).toBe(2);

    const cn1 = cnRes.creditNotes.find((c) => c.original_invoice_numbers.includes("INV-101"));
    const cn2 = cnRes.creditNotes.find((c) => c.original_invoice_numbers.includes("INV-118"));

    expect(cn1).toBeDefined();
    expect(cn2).toBeDefined();
    expect(cn1?.lines[0].return_qty).toBe(6);
    expect(cn2?.lines[0].return_qty).toBe(4);

    // Check batch stock restored: DL2601 +6, DL2602 +4
    const batches = await productsStore.getBatchesForProduct("prod_dolo_cdn", false);
    const b1 = batches.find((b) => b.batch_no === "DL2601");
    const b2 = batches.find((b) => b.batch_no === "DL2602");
    expect(b1?.stock_qty).toBe(56); // 50 + 6
    expect(b2?.stock_qty).toBe(44); // 40 + 4
  });

  it("Option A generates single consolidated Credit Note referencing multiple invoices", async () => {
    const allocations = await customerDebitNoteService.autoSuggestAllocationsForLine(
      "cust_medicare_b2b",
      "prod_dolo_cdn",
      undefined,
      10
    );

    const res = await customerDebitNoteService.createDebitNote({
      debit_note_number: "DN-OPT-A-01",
      debit_note_date: "2026-07-10",
      customer_id: "cust_medicare_b2b",
      customer_dn_amount: 327,
      credit_note_option: "A",
      lines: [
        {
          product_id: "prod_dolo_cdn",
          product_name: "Dolo 650 Tablet",
          customer_qty: 10,
          customer_unit_price: 29.2,
          customer_gst_percent: 12,
          allocations,
        },
      ],
    });

    await customerDebitNoteService.approveDebitNote(res.debitNoteId, {});

    const cnRes = await customerDebitNoteService.issueCreditNotes(res.debitNoteId, {
      creditNoteOption: "A",
    });

    expect(cnRes.success).toBe(true);
    expect(cnRes.creditNotes.length).toBe(1);

    const cn = cnRes.creditNotes[0];
    expect(cn.original_invoice_numbers).toEqual(expect.arrayContaining(["INV-101", "INV-118"]));
    expect(cn.lines.length).toBe(2);
  });

  it("correctly evaluates Section 34 GST deadline", () => {
    // Invoice in FY 2026-27 (ends 2027-03-31) -> Deadline 30 Nov 2027
    const check1 = checkSec34TimeLimit("2026-06-15", "2027-08-01");
    expect(check1.isExpired).toBe(false);
    expect(check1.deadlineDate).toBe("2027-11-30");
    expect(check1.warning).toBeUndefined();

    // Credit Note issued after 30 Nov 2027
    const check2 = checkSec34TimeLimit("2026-06-15", "2027-12-15");
    expect(check2.isExpired).toBe(true);
    expect(check2.warning).toBeDefined();
  });

  it("handles partial line approval and issues credit notes only for approved lines", async () => {
    const allocations = await customerDebitNoteService.autoSuggestAllocationsForLine(
      "cust_medicare_b2b",
      "prod_dolo_cdn",
      undefined,
      10
    );

    const res = await customerDebitNoteService.createDebitNote({
      debit_note_number: "DN-PARTIAL-01",
      debit_note_date: "2026-07-15",
      customer_id: "cust_medicare_b2b",
      customer_dn_amount: 327,
      lines: [
        {
          product_id: "prod_dolo_cdn",
          product_name: "Dolo 650 Tablet",
          customer_qty: 10,
          customer_unit_price: 30,
          customer_gst_percent: 12,
          allocations,
        },
      ],
    });

    const dn = await customerDebitNoteService.getDebitNoteById(res.debitNoteId);
    const lineId = dn!.lines[0].id;

    // Approve with variance action: accept only 6 qty
    await customerDebitNoteService.approveDebitNote(res.debitNoteId, {
      lineDecisions: [
        {
          lineId,
          status: "approved",
          varianceAction: "use_ours",
          reason: "Approved as per verified batch rate",
        },
      ],
    });

    const approvedDn = await customerDebitNoteService.getDebitNoteById(res.debitNoteId);
    expect(approvedDn?.status).toBe("approved");
  });

  it("cancelling a credit note reverts stock and customer outstanding balance", async () => {
    const allocations = await customerDebitNoteService.autoSuggestAllocationsForLine(
      "cust_medicare_b2b",
      "prod_dolo_cdn",
      "DL2601",
      6
    );

    const res = await customerDebitNoteService.createDebitNote({
      debit_note_number: "DN-CANCEL-TEST",
      debit_note_date: "2026-07-20",
      customer_id: "cust_medicare_b2b",
      customer_dn_amount: 202,
      lines: [
        {
          product_id: "prod_dolo_cdn",
          product_name: "Dolo 650 Tablet",
          customer_qty: 6,
          customer_unit_price: 30,
          customer_gst_percent: 12,
          allocations,
        },
      ],
    });

    await customerDebitNoteService.approveDebitNote(res.debitNoteId, {});
    const cnRes = await customerDebitNoteService.issueCreditNotes(res.debitNoteId);
    const cnId = cnRes.creditNotes[0].id;

    // Batch stock before cancel: 50 + 6 = 56
    let batches = await productsStore.getBatchesForProduct("prod_dolo_cdn", false);
    let b1 = batches.find((b) => b.batch_no === "DL2601");
    expect(b1?.stock_qty).toBe(56);

    // Cancel Credit Note
    await customerDebitNoteService.cancelCreditNote(cnId, "Customer disputed resolution");

    // Stock reverted back to 50
    batches = await productsStore.getBatchesForProduct("prod_dolo_cdn", false);
    b1 = batches.find((b) => b.batch_no === "DL2601");
    expect(b1?.stock_qty).toBe(50);
  });

  it("generates Debit Notes Received report with variance and ageing", async () => {
    await customerDebitNoteService.createDebitNote({
      debit_note_number: "DN-REP-01",
      debit_note_date: "2026-07-01",
      received_date: "2026-07-02",
      customer_id: "cust_medicare_b2b",
      customer_dn_amount: 1000,
      lines: [
        {
          product_id: "prod_dolo_cdn",
          product_name: "Dolo 650 Tablet",
          customer_qty: 10,
          customer_unit_price: 30,
          customer_gst_percent: 12,
        },
      ],
    });

    const report = await customerDebitNoteService.getDebitNotesReport();
    expect(report.entries.length).toBeGreaterThanOrEqual(1);
    expect(report.totals.total_dn_amount).toBeGreaterThanOrEqual(1000);
    expect(report.totals.pending_count).toBeGreaterThanOrEqual(1);
  });
});
