import { describe, it, expect, beforeEach } from "vitest";
import { sqliteStorage } from "../db/sqliteStorage";
import { taxReconciliationService, validateGstinChecksum } from "./taxReconciliationService";

describe("TaxReconciliationService & Statutory GST Diagnostics", () => {
  it("correctly validates Indian GSTIN Luhn Mod-36 checksums", () => {
    // Valid standard GSTINs (with authentic Mod-36 checksums)
    expect(validateGstinChecksum("27AAPFU0939F1ZV").valid).toBe(true);
    expect(validateGstinChecksum("32AABCA1234F1ZI").valid).toBe(true);

    // Invalid length
    expect(validateGstinChecksum("32AABCA1234F1Z").valid).toBe(false);

    // Invalid checksum character (altered last digit)
    const tampered = "32AABCA1234F1Z9";
    const res = validateGstinChecksum(tampered);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("Checksum digit mismatch");
  });

  it("identifies total mismatches, invalid tax heads, and missing HSN", async () => {
    await sqliteStorage.clearTable("invoices");
    await sqliteStorage.clearTable("invoice_items");

    // Seed an invoice with multiple anomalies:
    // 1. Missing HSN on item
    // 2. Intra-state invoice charging IGST instead of CGST/SGST
    // 3. Line totals don't sum to grand_total
    await sqliteStorage.insertRecord("invoices", "inv_bad_01", {
      id: "inv_bad_01",
      module_key: "invoice",
      invoice_number: "INV-ERR-001",
      invoice_date: "2026-10-15",
      customer_name: "Walk-in",
      customer_gstin: "",
      place_of_supply: "32-Kerala",
      subtotal: 100,
      cgst_total: 0,
      sgst_total: 0,
      igst_total: 18, // ANOMALY: IGST on intra-state supply!
      tax_total: 18,
      round_off: 0,
      grand_total: 150, // ANOMALY: lines = 118, grand = 150!
      status: "issued",
      created_at: Date.now(),
    });

    await sqliteStorage.insertRecord("invoice_items", "item_bad_01", {
      id: "item_bad_01",
      invoice_id: "inv_bad_01",
      product_id: "prod_01",
      product_name: "Test Tablet",
      hsn_code: "", // ANOMALY: Missing HSN!
      qty: 1,
      unit_price: 100,
      gst_percent: 18,
      cgst_amount: 0,
      sgst_amount: 0,
      igst_amount: 18,
      total_amount: 118,
    });

    const report = await taxReconciliationService.runAudit("2026-10-01", "2026-10-31", "32");

    expect(report.total_invoices_audited).toBe(1);
    expect(report.clean_invoices_count).toBe(0);
    expect(report.anomalies_count).toBeGreaterThanOrEqual(3);

    const types = report.anomalies.map((a) => a.anomaly_type);
    expect(types).toContain("MISSING_HSN");
    expect(types).toContain("PLACE_OF_SUPPLY_MISMATCH");
    expect(types).toContain("TOTAL_MISMATCH");
  });

  it("reports zero anomalies on fully clean and reconciled transactions", async () => {
    await sqliteStorage.clearTable("invoices");
    await sqliteStorage.clearTable("invoice_items");

    // Seed a clean compliant B2B intra-state transaction
    await sqliteStorage.insertRecord("invoices", "inv_clean_01", {
      id: "inv_clean_01",
      module_key: "invoice",
      invoice_number: "INV-CLN-001",
      invoice_date: "2026-10-15",
      customer_name: "Apollo Pharmacy",
      customer_gstin: "32AABCA1234F1ZI",
      place_of_supply: "32-Kerala",
      subtotal: 100,
      taxable_subtotal: 100,
      cgst_total: 6,
      sgst_total: 6,
      igst_total: 0,
      tax_total: 12,
      round_off: 0,
      grand_total: 112,
      status: "issued",
      created_at: Date.now(),
    });

    await sqliteStorage.insertRecord("invoice_items", "item_clean_01", {
      id: "item_clean_01",
      invoice_id: "inv_clean_01",
      product_id: "prod_01",
      product_name: "Paracetamol 650",
      hsn_code: "30049099",
      qty: 1,
      unit_price: 100,
      gst_percent: 12,
      taxable_amount: 100,
      cgst_amount: 6,
      sgst_amount: 6,
      igst_amount: 0,
      total_amount: 112,
    });

    const report = await taxReconciliationService.runAudit("2026-10-01", "2026-10-31", "32");
    expect(report.total_invoices_audited).toBe(1);
    expect(report.clean_invoices_count).toBe(1);
    expect(report.anomalies_count).toBe(0);
    expect(report.anomalies).toHaveLength(0);
  });
});
