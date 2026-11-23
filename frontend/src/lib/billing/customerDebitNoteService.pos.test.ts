import { describe, it, expect, beforeEach } from "vitest";
import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore } from "../masters/productsStore";
import { partiesStore } from "../masters/partiesStore";
import { companySettingsService } from "../settings/companySettingsService";
import { documentPlaceOfSupply } from "../gst/stateCodes";
import { customerDebitNoteService } from "./customerDebitNoteService";

/**
 * TAX-03 on the remaining sales paths: a document that does not name its place of
 * supply takes the buyer's GSTIN state, else the store's own state — never Kerala
 * because the code was written in Kerala.
 */

describe("documentPlaceOfSupply", () => {
  it("keeps a place of supply the document already states", () => {
    expect(documentPlaceOfSupply("27", "29AAAAA0000A1Z5", "29")).toBe("27-Maharashtra");
  });

  it("falls back to the buyer's GSTIN state", () => {
    expect(documentPlaceOfSupply(undefined, "33AAAAA0000A1Z5", "29")).toBe("33-Tamil Nadu");
  });

  it("falls back to the store's state for an unregistered buyer", () => {
    expect(documentPlaceOfSupply("", "", "29")).toBe("29-Karnataka");
  });
});

describe("Customer debit notes at a Karnataka store (TAX-03)", () => {
  beforeEach(async () => {
    await sqliteStorage.initDatabase();
    for (const t of ["customer_debit_notes", "credit_notes", "invoices", "invoice_items", "products", "product_batches", "customers"]) {
      await sqliteStorage.clearTable(t);
    }
    await companySettingsService.saveLocalSettings({ state_code: "29" } as any);
    await productsStore.upsertProduct({
      id: "prod_ka",
      name: "QA Ruby Lipstick",
      mrp: 472,
      sel_rate: 400,
      gst_percent: 18,
      units_per_pack: 1,
      is_active: true,
    } as any);
  });

  it("names the store's state when the customer has no GSTIN", async () => {
    await partiesStore.upsertCustomer({
      id: "cust_walkin_ka",
      name: "QA Beauty Client",
      phone: "9876500000",
      outstanding_balance: 0,
      credit_limit: 0,
      is_active: true,
    } as any);

    const res = await customerDebitNoteService.createDebitNote({
      debit_note_number: "DN-KA-001",
      debit_note_date: "2026-11-20",
      customer_id: "cust_walkin_ka",
      customer_dn_amount: 472,
      lines: [{ product_id: "prod_ka", product_name: "QA Ruby Lipstick", customer_qty: 1, customer_unit_price: 400, customer_gst_percent: 18 }],
    });

    const dn = (await sqliteStorage.findAll<any>("customer_debit_notes")).find((d) => d.debit_note_number === "DN-KA-001");
    expect(res.success).toBe(true);
    expect(dn?.place_of_supply).toBe("29-Karnataka");
  });

  it("names the customer's GSTIN state for a registered buyer", async () => {
    await partiesStore.upsertCustomer({
      id: "cust_tn",
      name: "QA Chennai Retail",
      gstin: "33AAACQ1234F1Z1",
      phone: "9876500001",
      outstanding_balance: 0,
      credit_limit: 0,
      is_active: true,
    } as any);

    await customerDebitNoteService.createDebitNote({
      debit_note_number: "DN-KA-002",
      debit_note_date: "2026-11-20",
      customer_id: "cust_tn",
      customer_dn_amount: 472,
      lines: [{ product_id: "prod_ka", product_name: "QA Ruby Lipstick", customer_qty: 1, customer_unit_price: 400, customer_gst_percent: 18 }],
    });

    const dn = (await sqliteStorage.findAll<any>("customer_debit_notes")).find((d) => d.debit_note_number === "DN-KA-002");
    expect(dn?.place_of_supply).toBe("33-Tamil Nadu");
  });
});
