import { describe, it, expect, beforeEach } from "vitest";
import { purchaseService, type PurchaseDocumentInput, type PurchaseLineItemInput } from "./purchaseService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { productsStore } from "../masters/productsStore";
import { chargeHeadsStore } from "../masters/chargeHeadsStore";

/**
 * CR-C on the till. The offline screen is the authority for its own bill, so these tests pin
 * the worked example to the paisa, prove the charge lines ride the sync payload the server
 * re-prices (SYNC-007), and prove the landed cost lands on the batch while the supplier's rate
 * stays visible (PUR-011).
 */

const line = (overrides: Partial<PurchaseLineItemInput> = {}): PurchaseLineItemInput => ({
  product_id: "prod_amox",
  product_name: "Amoxicillin 500mg",
  batch_no: "AMX-101",
  expiry_date: "2027-12-31",
  pack_qty: 100,
  units_per_pack: 1,
  purchase_rate: 100,
  gst_percent: 12,
  ...overrides,
});

const doc = (overrides: Partial<PurchaseDocumentInput> = {}): PurchaseDocumentInput => ({
  supplier_id: "sup_cdc",
  supplier_name: "CDC Pharma",
  supplier_invoice_no: "INV-1",
  purchase_date: "2026-11-15",
  lines: [line()],
  ...overrides,
});

async function charges(purchaseId: string) {
  const rows = await sqliteStorage.findAll<any>("purchase_charges");
  return rows.filter((r) => r.purchase_id === purchaseId).sort((a, b) => a.seq - b.seq);
}

async function allocations(chargeId: string) {
  const rows = await sqliteStorage.findAll<any>("purchase_charge_allocations");
  return rows.filter((r) => r.purchase_charge_id === chargeId);
}

async function queuedPurchasePayload(purchaseId: string) {
  const queue = await sqliteStorage.findAll<any>("sync_queue");
  const item = queue.filter((q) => q.entity_type === "purchase" && q.entity_id === purchaseId).pop();
  return item ? JSON.parse(item.payload_json) : null;
}

describe("Purchase bill charges on the till (PUR-010..PUR-017, SYNC-007)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    await chargeHeadsStore.resetToDefaults();
  });

  it("posts the worked example to the paisa and lands the cost on the batch", async () => {
    const { purchaseId } = await purchaseService.recordInwardPurchaseBill(
      doc({
        charges: [
          { external_id: "chg-FREIGHT-200", head_code: "FREIGHT", amount: 200, gst_percent: 18 },
          { external_id: "chg-PACKING-100", head_code: "PACKING", amount: 100, gst_percent: 18 },
        ],
      })
    );

    const header = await sqliteStorage.findById<any>("purchase_documents", purchaseId);
    // Goods 10,000 + 1,200 GST, charges 200 + 18 + 18 and 100 + 9 + 9.
    expect(header.grand_total).toBe(11554);
    expect(header.round_off).toBe(0);
    expect(header.tax_total).toBe(1254);
    expect(header.cgst_total).toBe(627);
    expect(header.sgst_total).toBe(627);

    const rows = await charges(purchaseId);
    expect(rows.map((r) => r.head_code)).toEqual(["FREIGHT", "PACKING"]);
    expect(rows[0].taxable_amount).toBe(200);
    expect(rows[0].cgst_amount).toBe(18);
    expect(rows[0].sgst_amount).toBe(18);
    expect(rows[0].total_amount).toBe(236);
    expect(rows[0].allocated_amount).toBe(200);
    expect(rows[1].allocated_amount).toBe(100);
    expect(rows[0].sac_code).toBe("996731"); // the head's own SAC, not a hard-coded one

    const items = (await sqliteStorage.findAll<any>("purchase_items")).filter((i) => i.purchase_id === purchaseId);
    expect(items[0].charge_allocation).toBe(300);
    expect(items[0].landed_unit_cost).toBe(103);
    // PUR-011: the supplier's rate is never rewritten by an allocation.
    expect(items[0].purchase_rate).toBe(100);

    const batch = await sqliteStorage.findById<any>("product_batches", `batch_${line().product_id}_AMX-101`);
    expect(batch.purchase_rate).toBe(100);
    expect(batch.landed_cost_rate).toBe(103);

    // PUR-002: the charge share is recorded per line, so a register can split goods from charges.
    const allocs = await allocations(rows[0].id);
    expect(allocs).toHaveLength(1);
    expect(allocs[0].allocated_amount).toBe(200);
    expect(allocs[0].purchase_item_id).toBe(items[0].id);
  });

  it("carries the charge lines inside the sync payload the server re-prices", async () => {
    const { purchaseId } = await purchaseService.recordInwardPurchaseBill(
      doc({
        charges: [{ external_id: "chg-FREIGHT-200", head_code: "FREIGHT", amount: 200, gst_percent: 18 }],
      })
    );

    const payload = await queuedPurchasePayload(purchaseId);
    expect(payload.charges).toHaveLength(1);
    expect(payload.charges[0]).toMatchObject({
      external_id: "chg-FREIGHT-200",
      head_code: "FREIGHT",
      amount: 200,
      gst_percent: 18,
      treatment: "add_to_cost",
      spread_method: "value",
      itc_eligibility: "eligible",
    });
  });

  it("books an expense-treated charge in the register without touching landed cost", async () => {
    const { purchaseId } = await purchaseService.recordInwardPurchaseBill(
      doc({
        charges: [
          { external_id: "chg-FREIGHT-200", head_code: "FREIGHT", amount: 200, gst_percent: 18 },
          { external_id: "chg-OTHER-100", head_code: "OTHER", amount: 100, gst_percent: 18, treatment: "expense" },
          {
            external_id: "chg-INS-BLOCKED",
            head_code: "INSURANCE",
            amount: 200,
            gst_percent: 18,
            treatment: "expense",
            itc_eligibility: "blocked",
          },
        ],
      })
    );

    const rows = await charges(purchaseId);
    expect(rows.map((r) => r.head_code)).toEqual(["FREIGHT", "OTHER", "INSURANCE"]);
    expect(rows[0].allocated_amount).toBe(200);
    expect(rows[1].allocated_amount).toBe(0);
    expect(rows[2].allocated_amount).toBe(0);

    const expenses = (await sqliteStorage.findAll<any>("expenses")).filter((e) => e.purchase_id === purchaseId);
    expect(expenses).toHaveLength(2);
    const byHead: Record<string, any> = Object.fromEntries(expenses.map((e) => [e.expense_head, e]));
    // Ex-tax when the input tax can be claimed back; the tax that can never be claimed is
    // capitalised into the expense so value cannot vanish from the books.
    expect(byHead["Other"].amount).toBe(100);
    expect(byHead["Insurance"].amount).toBe(236);
    expect(byHead["Insurance"].itc_eligibility).toBe("blocked");
    expect(byHead["Insurance"].cgst_amount).toBe(18);
    expect(byHead["Insurance"].purchase_charge_id).toBe(rows[2].id);

    expect(rows[1].expense_id).toBeTruthy();
    expect(rows[2].expense_id).toBeTruthy();

    const items = (await sqliteStorage.findAll<any>("purchase_items")).filter((i) => i.purchase_id === purchaseId);
    expect(items[0].charge_allocation).toBe(200);
    expect(items[0].landed_unit_cost).toBe(102);
  });

  it("keeps a separately-paid charge out of the payable while landing its cost", async () => {
    const { purchaseId } = await purchaseService.recordInwardPurchaseBill(
      doc({
        charges: [
          {
            external_id: "chg-COURIER",
            head_code: "FREIGHT",
            amount: 200,
            gst_percent: 18,
            paid_separately: true,
            paid_to_label: "Ganga Courier",
          },
        ],
      })
    );

    const header = await sqliteStorage.findById<any>("purchase_documents", purchaseId);
    // Goods 10,000 + GST 1,200; the courier has already been paid, so the supplier is not owed it.
    expect(header.grand_total).toBe(11200);
    expect(header.tax_total).toBe(1200);

    const rows = await charges(purchaseId);
    expect(rows[0].paid_separately).toBe(1);
    expect(rows[0].paid_to_label).toBe("Ganga Courier");
    expect(rows[0].total_amount).toBe(236);
    expect(rows[0].allocated_amount).toBe(200);

    // PUR-010 says the spread is the same either way, so the batch cost carries it.
    const items = (await sqliteStorage.findAll<any>("purchase_items")).filter((i) => i.purchase_id === purchaseId);
    expect(items[0].charge_allocation).toBe(200);
    expect(items[0].landed_unit_cost).toBe(102);

    const payload = await queuedPurchasePayload(purchaseId);
    expect(payload.charges[0]).toMatchObject({ external_id: "chg-COURIER", paid_separately: 1, paid_to_label: "Ganga Courier" });
  });

  it("presents legacy freight as one Freight charge instead of adding it after the engine", async () => {
    const { purchaseId } = await purchaseService.recordInwardPurchaseBill(
      doc({ lines: [line({ pack_qty: 1, discount_percent: 10 })], freight_charges: 4 })
    );

    const rows = await charges(purchaseId);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("legacy_freight");
    expect(rows[0].gst_percent).toBe(0);
    expect(rows[0].allocated_amount).toBe(4);

    const header = await sqliteStorage.findById<any>("purchase_documents", purchaseId);
    // 90 taxable + 10.80 GST + 4 freight = 104.80 → the engine rounds the bill to 105; the
    // till no longer adds freight after the totals and no longer rounds by hand.
    expect(header.grand_total).toBe(105);
    expect(header.round_off).toBe(0.2);
    expect(header.freight_charges).toBe(4);
  });

  it("spreads by the weight entered on the line", async () => {
    const { purchaseId } = await purchaseService.recordInwardPurchaseBill(
      doc({
        lines: [
          line({ product_id: "prod_a", product_name: "A", batch_no: "BA", gross_weight_kg: 300, pack_qty: 1, units_per_pack: 1 }),
          line({ product_id: "prod_b", product_name: "B", batch_no: "BB", gross_weight_kg: 100, pack_qty: 1, units_per_pack: 1 }),
        ],
        charges: [
          { external_id: "chg-LOADING-400", head_code: "LOADING", amount: 400, gst_percent: 0, spread_method: "weight" },
        ],
      })
    );

    const rows = await charges(purchaseId);
    expect(rows[0].spread_basis_used).toBe("weight");
    const allocs = await allocations(rows[0].id);
    expect(allocs.map((a) => a.allocated_amount).sort((a, b) => b - a)).toEqual([300, 100]);
  });

  it("refuses a head this store does not have before anything is written", async () => {
    const product = await productsStore.getProductById("prod_amox");
    await expect(
      purchaseService.recordInwardPurchaseBill(
        doc({ charges: [{ head_code: "SOME_OTHER_STORE_HEAD", amount: 100, gst_percent: 18 }] })
      )
    ).rejects.toThrow(/rule R12/);

    expect(await sqliteStorage.findAll("purchase_documents")).toHaveLength(0);
    expect(await sqliteStorage.findAll("purchase_charges")).toHaveLength(0);
    const after = await productsStore.getProductById("prod_amox");
    expect(after?.current_stock ?? 0).toBe(product?.current_stock ?? 0);
  });

  it("re-posts on an edit without leaving orphan money", async () => {
    const { purchaseId } = await purchaseService.recordInwardPurchaseBill(
      doc({
        charges: [
          { external_id: "chg-FREIGHT-200", head_code: "FREIGHT", amount: 200, gst_percent: 18 },
          { external_id: "chg-OTHER-100", head_code: "OTHER", amount: 100, gst_percent: 18, treatment: "expense" },
        ],
      })
    );
    expect(await charges(purchaseId)).toHaveLength(2);
    expect(await sqliteStorage.findAll("expenses")).toHaveLength(1);

    await purchaseService.updatePurchaseBill(
      purchaseId,
      doc({ charges: [{ external_id: "chg-INSURANCE-50", head_code: "INSURANCE", amount: 50, gst_percent: 18 }] }),
      "charge corrected"
    );

    const rows = await charges(purchaseId);
    expect(rows).toHaveLength(1);
    expect(rows[0].head_code).toBe("INSURANCE");
    // The expensed charge and its register row both went with it.
    expect(await sqliteStorage.findAll("expenses")).toHaveLength(0);

    const header = await sqliteStorage.findById<any>("purchase_documents", purchaseId);
    expect(header.grand_total).toBe(11200 + 50 + 4.5 + 4.5);

    const items = (await sqliteStorage.findAll<any>("purchase_items")).filter((i) => i.purchase_id === purchaseId);
    expect(items[0].charge_allocation).toBe(50);
  });

  it("keeps a credit charge inside the payable and the landed cost", async () => {
    const { purchaseId } = await purchaseService.recordInwardPurchaseBill(
      doc({
        charges: [
          { external_id: "chg-OTHER--100", head_code: "OTHER", amount: -100, gst_percent: 18, treatment: "add_to_cost" },
        ],
      })
    );

    const rows = await charges(purchaseId);
    expect(rows[0].taxable_amount).toBe(-100);
    expect(rows[0].total_amount).toBe(-118);
    expect(rows[0].allocated_amount).toBe(-100);

    const items = (await sqliteStorage.findAll<any>("purchase_items")).filter((i) => i.purchase_id === purchaseId);
    expect(items[0].charge_allocation).toBe(-100);
    expect(items[0].landed_unit_cost).toBe(99);

    const header = await sqliteStorage.findById<any>("purchase_documents", purchaseId);
    expect(header.grand_total).toBe(11200 - 118);
  });

  it("refuses a bill whose charges would take the payable below zero", async () => {
    await expect(
      purchaseService.recordInwardPurchaseBill(
        doc({ charges: [{ external_id: "chg-OTHER-big", head_code: "OTHER", amount: -20000, gst_percent: 18 }] })
      )
    ).rejects.toThrow(/below zero/);
  });

  it("leaves an untouched bill priced exactly as it was before charges existed", async () => {
    const totals = purchaseService.calculateDocumentTotals([line()], false, { freight_charges: 50 });
    expect(totals.grandTotal).toBe(11250);
    expect(totals.taxTotal).toBe(1200);
    expect(totals.roundOff).toBe(0);
  });
});
