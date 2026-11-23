import { describe, it, expect, beforeEach } from "vitest";
import { getMockDatabase, sqliteStorage } from "../lib/db/sqliteStorage";
import { chargeHeadsStore } from "../lib/masters/chargeHeadsStore";
import {
  purchaseService,
  type PurchaseDocumentInput,
  type PurchaseLineItemInput,
} from "../lib/purchases/purchaseService";
import type { PurchaseChargeInput } from "../lib/purchases/chargePosting";
import { reportRegistry } from "./registry";
import { reportRunner } from "./engine/ReportRunner";
import { purchaseRegisterColumns } from "./purchase/purchase-register";
import type { PurchaseChargeSummary } from "../lib/reports/purchaseChargeRegister";
import type { Gstr2ItcRow } from "./gst/gstr-2-itc";
import type { Gstr3bRow } from "./gst/gstr-3b-summary";
import type { GstSlabRow } from "./gst/gst-slab-report";

/**
 * Task 4.13 (REP-007/008/009) on the till: one bill, every register that reads it.
 *
 * The bill is posted by production code so its header, charge rows, allocations and expense twin
 * are the real thing, then each register is run over it. A rupee must appear once and in the right
 * place: goods taxable apart from charges in the purchase register, the spread apart from the
 * billed cost in the item view, the expensed charge once in the expense register, the landed rate
 * in margin, the invoice line whole in GSTR-2, each charge in the GSTR-3B section its own flags
 * decide and on its own rate slab, and the same inward total in all three.
 *
 * The bill: goods 10,000 @12 = 1,200, then FREIGHT 200 @18 on the bill, PACKING 100 @18 on the bill
 * blocked under 17(5) and expensed, LOADING 50 @18 on the bill under reverse charge, and INSURANCE
 * 300 @12 settled outside it.
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

const doc = (charges: PurchaseChargeInput[]): PurchaseDocumentInput => ({
  supplier_id: "sup_cdc",
  supplier_name: "CDC Pharma",
  supplier_invoice_no: "INV-CHG-1",
  purchase_date: "2026-11-15",
  lines: [line()],
  charges,
});

const FREIGHT: PurchaseChargeInput = {
  external_id: "chg-freight",
  head_code: "FREIGHT",
  amount: 200,
  gst_percent: 18,
};
const PACKING: PurchaseChargeInput = {
  external_id: "chg-packing",
  head_code: "PACKING",
  amount: 100,
  gst_percent: 18,
  treatment: "expense",
  itc_eligibility: "ineligible",
};
const LOADING: PurchaseChargeInput = {
  external_id: "chg-loading",
  head_code: "LOADING",
  amount: 50,
  gst_percent: 18,
  is_rcm: true,
};
const INSURANCE: PurchaseChargeInput = {
  external_id: "chg-insurance",
  head_code: "INSURANCE",
  amount: 300,
  gst_percent: 12,
  paid_separately: true,
  paid_to_label: "Insurer settled by bank transfer",
};

const ALL_CHARGES = [FREIGHT, PACKING, LOADING, INSURANCE];

const PERIOD = { startDate: "2026-11-01", endDate: "2026-11-30" };

const run = async (id: string) => {
  const module = reportRegistry.get(id)!;
  expect(module, `report ${id} must be registered`).toBeDefined();
  return reportRunner.executeReport(module, { filters: { ...PERIOD } });
};

const section = (rows: Gstr3bRow[], key: string) => {
  const row = rows.find((r) => r.section_key === key)!;
  expect(row, `3B section ${key}`).toBeDefined();
  return row;
};

const slab = (rows: GstSlabRow[], rate: number) => {
  const row = rows.find((r) => r.tax_rate === rate)!;
  expect(row, `gst slab ${rate}%`).toBeDefined();
  return row;
};

describe("Supplier bill charges across the till registers (REP-007/008/009)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    await chargeHeadsStore.resetToDefaults();
  });

  it("splits goods from charges in the purchase register", async () => {
    await purchaseService.recordInwardPurchaseBill(doc(ALL_CHARGES));

    const result = await run("purchase-register");
    expect(result.rows).toHaveLength(1);

    // Goods 10,000 @12 = 1,200. Charges billed on the invoice: 200+36, 100+18, 50+9.
    expect(result.summary.subtotal).toBe(10000);
    expect(result.summary.charge_taxable).toBe(350);
    expect(result.summary.charge_tax).toBe(63);
    expect(result.summary.charge_total).toBe(413);
    expect(result.summary.tax_total).toBe(1263);
    expect(result.summary.charge_add_to_cost).toBe(295); // FREIGHT 236 + LOADING 59, gross of their tax
    expect(result.summary.charge_expensed).toBe(118);
    expect(result.summary.charge_separately_paid).toBe(336);

    const bill = result.rows[0] as any;
    // PUR-002: payable is goods plus their tax plus the charges billed on top, to the paisa.
    expect(
      bill.subtotal + (bill.tax_total - result.summary.charge_tax) + result.summary.charge_total
    ).toBe(bill.grand_total);
    // PUR-011: add-to-cost charges are carried inside the landed value, not beside it.
    expect(result.summary.landed_value).toBe(10550);
    // the head column is what an operator reads, so it must name every charge on the bill.
    const headsColumn = purchaseRegisterColumns.find((col) => col.id === "charge_heads")!;
    expect(headsColumn.accessor(bill as any)).toContain("FREIGHT");
    expect((bill.charge_summary as PurchaseChargeSummary).by_head).toHaveLength(4);
  });

  it("keeps billed cost, charge allocation and landed cost apart in the item view", async () => {
    await purchaseService.recordInwardPurchaseBill(doc(ALL_CHARGES));

    const result = await run("item-wise-purchase");
    const row = result.rows[0] as any;

    // REP-007: three separate numbers, never one merged figure.
    expect(row.total_cost).toBe(11200); // 10,000 goods + 1,200 goods tax
    expect(row.charge_allocation).toBe(550); // the spread of the three add-to-cost heads
    expect(row.landed_cost).toBe(11750);
    expect(result.summary.landed_cost).toBe(11750);

    // PUR-011: the supplier's own rate is still what the bill said.
    const items = (await sqliteStorage.findAll<any>("purchase_items")).filter(
      (i) => i.product_id === "prod_amox"
    );
    expect(items[0].purchase_rate).toBe(100);
    expect(items[0].landed_unit_cost).toBe(105.5);
  });

  it("costs margin at the landed rate a charge moved, and at no other", async () => {
    await purchaseService.recordInwardPurchaseBill(doc(ALL_CHARGES));
    await sqliteStorage.insertRecord("invoices", "inv_margin", {
      id: "inv_margin",
      module_key: "invoice",
      invoice_number: "INV-MARGIN",
      invoice_date: "2026-11-20",
      customer_name: "Walk-in Customer",
      subtotal: 2000,
      tax_total: 240,
      round_off: 0,
      grand_total: 2240,
      paid_amount: 2240,
      payment_mode: "Cash",
      status: "issued",
      created_at: 1700000000000,
    });
    await sqliteStorage.insertRecord("invoice_items", "inv_margin_item", {
      id: "inv_margin_item",
      invoice_id: "inv_margin",
      product_id: "prod_amox",
      product_name: "Amoxicillin 500mg",
      batch_id: "batch_prod_amox_AMX-101",
      batch_no: "AMX-101",
      hsn_code: "30049099",
      qty: 10,
      unit_price: 200,
      gst_percent: 12,
      cgst_amount: 60,
      sgst_amount: 60,
      igst_amount: 0,
      taxable_amount: 2000,
      total_amount: 2240,
    });

    const result = await run("gross-profit-report");
    const row = result.rows.find((r: any) => r.product_id === "prod_amox") as any;
    expect(row, "the sold product must appear in the margin report").toBeDefined();

    // 10 units at the 105.50 landed rate, not at the 100.00 the supplier billed.
    expect(row.cost_of_goods_sold).toBe(1055);
    expect(row.taxable_revenue).toBe(2000);
    expect(row.gross_profit).toBe(945);

    // A store that never used charges sees exactly the margin it saw before CR-C.
    await sqliteStorage.clearTable("purchase_charges");
    await sqliteStorage.clearTable("purchase_charge_allocations");
    await sqliteStorage.updateRecord("product_batches", "batch_prod_amox_AMX-101", {
      landed_cost_rate: null,
    });

    const booked = await run("gross-profit-report");
    expect((booked.rows[0] as any).cost_of_goods_sold).toBe(1000);
  });

  it("posts an expensed charge once, and only once, to the expense register", async () => {
    await purchaseService.recordInwardPurchaseBill(doc([FREIGHT, PACKING]));

    const result = await run("expense-register");
    const chargeRows = result.rows.filter((r: any) => r.purchase_charge_id);
    expect(chargeRows).toHaveLength(1);

    const row = chargeRows[0] as any;
    expect(row.head).toBe("Packing");
    // PUR-012: the expense is the ex-tax cost plus the input tax that may not be claimed.
    expect(row.taxable_amount).toBe(100);
    expect(row.tax_amount).toBe(18);
    expect(row.creditable_tax).toBe(0);
    expect(row.non_creditable_tax).toBe(18);
    expect(row.amount).toBe(118);
    expect(row.in_payable).toBe(true); // the column renders it as Yes/No
    expect(result.summary.amount).toBe(118);

    // The register's own reconciliation block is what the release gate reads.
    const { expenseRegister } = await import("../lib/reports/expenseRegister");
    const [bills, charges, expenses] = await Promise.all([
      sqliteStorage.findAll<any>("purchase_documents"),
      sqliteStorage.findAll<any>("purchase_charges"),
      sqliteStorage.findAll<any>("expenses"),
    ]);
    const book = expenseRegister(bills, charges, expenses);
    expect(book.reconciliation.balanced).toBe(true);
    expect(book.totals.rows).toBe(1);
    expect(book.totals.postings).toBe(118);
    expect(book.totals.taxable).toBe(100);
    expect(book.totals.non_creditable_tax).toBe(18);

    // PUR-012 twin: the posting carries the charge's own GST so a reviewer can trace it back.
    const twin = expenses.find((e: any) => e.purchase_charge_id);
    expect(twin).toBeDefined();
    expect(twin.amount).toBe(118);
    expect(twin.gst_percent).toBe(18);
  });

  it("keeps the invoice line whole in GSTR-2 and splits the charge tax by eligibility", async () => {
    await purchaseService.recordInwardPurchaseBill(doc(ALL_CHARGES));

    const result = await run("gstr-2-itc");
    const row = result.rows[0] as Gstr2ItcRow;

    // REP-009: a charge billed on the invoice is part of the invoice, so its taxable value joins
    // the line and its tax is already inside the header's tax columns.
    expect(row.taxable_value).toBe(10350);
    expect(row.total_tax).toBe(1263);
    expect(row.cgst_amount + row.sgst_amount + row.igst_amount).toBe(row.total_tax);
    expect(row.total_invoice_value).toBe(11613);

    expect(row.charge_taxable).toBe(350);
    expect(row.charge_tax).toBe(63);
    expect(row.charge_claimable_tax).toBe(36); // FREIGHT only
    expect(row.charge_refused_tax).toBe(18); // PACKING, blocked under 17(5)
    expect(row.charge_rcm_tax).toBe(9); // LOADING, self-paid
    // Claimable, refused and reverse-charge partition the charge tax exactly.
    expect(row.charge_claimable_tax + row.charge_refused_tax + row.charge_rcm_tax).toBe(row.charge_tax);

    // PUR-013: settled on someone else's invoice, so it is reported beside the line, not inside it.
    expect(row.separately_paid_taxable).toBe(300);
    expect(row.separately_paid_tax).toBe(36);
  });

  it("places each charge in the GSTR-3B section its own flags decide", async () => {
    await purchaseService.recordInwardPurchaseBill(doc(ALL_CHARGES));

    const result = await run("gstr-3b-summary");
    const eligible = section(result.rows as Gstr3bRow[], "4(A)(5)");
    const blocked = section(result.rows as Gstr3bRow[], "4(D)");
    const reverse = section(result.rows as Gstr3bRow[], "3.1(d)");

    // Ordinary credit keeps the goods and every creditable charge: the freight on the bill plus the
    // insurance settled outside it, whose tax never reached the header at all.
    expect(eligible.taxable_value).toBe(10500);
    expect(eligible.total_tax).toBe(1272);
    expect(eligible.cgst_amount).toBe(636);
    expect(eligible.sgst_amount).toBe(636);

    expect(blocked.taxable_value).toBe(100);
    expect(blocked.total_tax).toBe(18);
    expect(reverse.taxable_value).toBe(50);
    expect(reverse.total_tax).toBe(9);

    // Four-way tie-out to the paisa: the three sections together are the whole inward tax, and the
    // whole inward taxable is the GSTR-2 invoice line plus what was settled on another invoice.
    const inward = await run("gstr-2-itc");
    const itcLine = inward.rows[0] as Gstr2ItcRow;
    expect(eligible.taxable_value + blocked.taxable_value + reverse.taxable_value).toBe(
      itcLine.taxable_value + itcLine.separately_paid_taxable
    );
    expect(eligible.total_tax + blocked.total_tax + reverse.total_tax).toBe(
      itcLine.total_tax + itcLine.separately_paid_tax
    );
  });

  it("puts every charge on its own GST slab beside the goods it was billed with", async () => {
    await purchaseService.recordInwardPurchaseBill(doc(ALL_CHARGES));

    const result = await run("gst-slab-report");
    const rows = result.rows as GstSlabRow[];

    // The 18% slab exists only because of the charges — no goods on this bill are rated 18.
    expect(slab(rows, 18).inward_taxable).toBe(350);
    expect(slab(rows, 18).total_input_tax).toBe(63);

    // The goods and the insurance settled on the insurer's own invoice share the 12% slab.
    expect(slab(rows, 12).inward_taxable).toBe(10300);
    expect(slab(rows, 12).total_input_tax).toBe(1236);

    // REP-007: the rate table is the same inward rupee GSTR-2 reports, counted once.
    const foot = (pick: (row: GstSlabRow) => number) =>
      Math.round(rows.reduce((total, row) => total + pick(row), 0) * 100) / 100;
    const inward = await run("gstr-2-itc");
    const itcLine = inward.rows[0] as Gstr2ItcRow;

    expect(foot((row) => row.inward_taxable)).toBe(
      itcLine.taxable_value + itcLine.separately_paid_taxable
    );
    expect(foot((row) => row.total_input_tax)).toBe(
      itcLine.total_tax + itcLine.separately_paid_tax
    );
  });
});
