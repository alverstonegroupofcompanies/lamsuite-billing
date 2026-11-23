import { describe, it, expect, beforeEach } from "vitest";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { chargeHeadsStore } from "../masters/chargeHeadsStore";
import { companySettingsService } from "../settings/companySettingsService";
import { purchaseService, type PurchaseDocumentInput, type PurchaseLineItemInput } from "./purchaseService";
import { purchaseReturnService, type PurchaseReturnInput } from "./purchaseReturnService";
import { isFullyReversed, reversalChargesForReturn, reversibleAmount } from "./chargeReversal";

/**
 * CR-C Task 4.12 on the till — the offline mirror of `PurchaseChargeReversalService`. The debit
 * note an operator prints without a network has to carry the money the cloud will agree to, so
 * these tests run the same worked example as the backend suite and pin the same paisa: a share
 * per goods line, never a percentage of the note (PUR-003), re-derived from the returns the till
 * holds so nothing reverses twice (PUR-015), and the batch valued back towards the supplier's own
 * rate (PUR-011).
 */

const lineA: PurchaseLineItemInput = {
  product_id: "prod_crs_a",
  product_name: "CRS Product A",
  batch_no: "CRS-A",
  expiry_date: "2027-12-31",
  pack_qty: 100,
  units_per_pack: 1,
  purchase_rate: 100,
  gst_percent: 12,
};

const lineB: PurchaseLineItemInput = {
  product_id: "prod_crs_b",
  product_name: "CRS Product B",
  batch_no: "CRS-B",
  expiry_date: "2027-12-31",
  pack_qty: 100,
  units_per_pack: 1,
  purchase_rate: 50,
  gst_percent: 12,
};

const BILL_NUMBER = "PUR-CRS-001";
const INVOICE_NUMBER = "CRS-SUP-0001";

async function bill(charges: PurchaseDocumentInput["charges"] = []) {
  return (await purchaseService.recordInwardPurchaseBill({
    supplier_id: "sup_crs",
    supplier_name: "CRS Distributors",
    supplier_invoice_no: INVOICE_NUMBER,
    purchase_date: "2026-11-15",
    purchase_number: BILL_NUMBER,
    lines: [lineA, lineB],
    charges,
  })).purchaseId;
}

/** One line of goods going back, keyed the way the return screen keys it. */
function returned(product: PurchaseLineItemInput, qty: number) {
  return {
    product_id: product.product_id,
    product_name: product.product_name,
    batch_id: `batch_${product.product_id}_${product.batch_no}`,
    batch_no: product.batch_no,
    expiry_date: product.expiry_date,
    purchased_qty: product.pack_qty,
    return_qty: qty,
    purchase_rate: product.purchase_rate,
    gst_percent: product.gst_percent,
    reason: "excess" as const,
  };
}

async function noteFor(purchaseId: string, lines: ReturnType<typeof returned>[]) {
  const input: PurchaseReturnInput = {
    original_purchase_id: purchaseId,
    original_purchase_number: BILL_NUMBER,
    supplier_id: "sup_crs",
    supplier_name: "CRS Distributors",
    supplier_gstin: "32AAACA1234B1Z2",
    supplier_invoice_no: INVOICE_NUMBER,
    settlement_type: "credit_adjust",
    lines,
  };

  return purchaseReturnService.createPurchaseReturn(input);
}

async function chargesOf(purchaseId: string) {
  const rows = await sqliteStorage.findAll<any>("purchase_charges");
  return rows.filter((r) => r.purchase_id === purchaseId).sort((a, b) => a.seq - b.seq);
}

async function billCharge(purchaseId: string, headCode: string) {
  const rows = await chargesOf(purchaseId);
  return rows.find((r) => r.head_code === headCode);
}

async function batch(productId: string, batchNo: string) {
  return sqliteStorage.findById<any>("product_batches", `batch_${productId}_${batchNo}`);
}

async function expensesOf(purchaseId: string) {
  const rows = await sqliteStorage.findAll<any>("expenses");
  return rows.filter((e) => e.purchase_id === purchaseId);
}

async function policy(reverseOnReturn: "proportional" | "sunk") {
  await companySettingsService.saveLocalSettings({ purchase_charges: { reverse_on_return: reverseOnReturn } });
}

describe("Purchase charge reversal on the till (PUR-003, PUR-011, PUR-015, PUR-016, SYNC-007)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    await chargeHeadsStore.resetToDefaults();
    await companySettingsService.loadSettings();
    await policy("proportional");
  });

  it("reverses exactly the returned line's share onto the debit note", async () => {
    const purchaseId = await bill([{ external_id: "chg-FREIGHT-1500", head_code: "FREIGHT", amount: 1500, gst_percent: 18 }]);

    // Freight 1,500 over goods 10,000 : 5,000 puts 1,000 on A and 500 on B.
    const freight = await billCharge(purchaseId, "FREIGHT");
    expect(freight).toMatchObject({ allocated_amount: 1500, reversed_amount: 0 });
    const allocs = (await sqliteStorage.findAll<any>("purchase_charge_allocations"))
      .filter((a) => a.purchase_charge_id === freight.id)
      .sort((a, b) => Number(a.allocated_amount) - Number(b.allocated_amount));
    expect(allocs.map((a) => a.allocated_amount)).toEqual([500, 1000]);

    const { returnId, grandTotal } = await noteFor(purchaseId, [returned(lineA, 50)]);

    // Half of A goes back, so half of A's 1,000 goes back: −500 plus its −90 GST.
    const noteCharges = await chargesOf(returnId);
    expect(noteCharges).toHaveLength(1);
    expect(noteCharges[0]).toMatchObject({
      head_code: "FREIGHT",
      source: "return_reversal",
      external_id: "rev|chg-FREIGHT-1500",
      amount: -500,
      taxable_amount: -500,
      cgst_amount: -45,
      sgst_amount: -45,
      total_amount: -590,
    });

    // The note's own totals already carry the credit, so the printed debit note is the bill.
    // The goods subtotal stays the goods subtotal (PUR-004): the credit shows in the tax and in
    // what the supplier owes.
    const saved = await purchaseReturnService.getPurchaseReturnById(returnId);
    expect(saved).toMatchObject({ subtotal: 5000, tax_total: 510, grand_total: 5010 });
    expect(grandTotal).toBe(5010);

    // PUR-015: the bill reads what its returns have taken, and PUR-011 the batch follows.
    // Only A's stock gave goods back, so only A's landed cost drops — B still carries its 500.
    expect(await billCharge(purchaseId, "FREIGHT")).toMatchObject({ reversed_amount: 500 });
    expect(Number((await batch(lineA.product_id, lineA.batch_no)).landed_cost_rate)).toBeCloseTo(105, 4);
    expect(Number((await batch(lineB.product_id, lineB.batch_no)).landed_cost_rate)).toBeCloseTo(55, 4);
  });

  it("reverses every charge to the paisa when every line goes back", async () => {
    const purchaseId = await bill([
      { external_id: "chg-FREIGHT-1500", head_code: "FREIGHT", amount: 1500, gst_percent: 18 },
      { external_id: "chg-PACKING-100", head_code: "PACKING", amount: 100, gst_percent: 18 },
    ]);

    const { returnId } = await noteFor(purchaseId, [returned(lineA, 100), returned(lineB, 100)]);

    const noteCharges = await chargesOf(returnId);
    expect(noteCharges.map((c) => c.taxable_amount)).toEqual([-1500, -100]);

    const rows = await chargesOf(purchaseId);
    expect(rows.map((r) => r.reversed_amount)).toEqual([1500, 100]);
    rows.forEach((row) => expect(isFullyReversed(row)).toBe(true));
    expect(rows.reduce((s, r) => s + reversibleAmount(r), 0)).toBe(1600);

    // The landed cost is the supplier's rate again — the charges have all come off the stock.
    expect(Number((await batch(lineA.product_id, lineA.batch_no)).landed_cost_rate)).toBeCloseTo(100, 4);
    expect(Number((await batch(lineB.product_id, lineB.batch_no)).landed_cost_rate)).toBeCloseTo(50, 4);
  });

  it("makes two part returns reverse exactly what one full return of the line would", async () => {
    const purchaseId = await bill([{ external_id: "chg-FREIGHT-1000", head_code: "FREIGHT", amount: 1000, gst_percent: 18 }]);

    // A carries 666.67 of the 1,000, B the remainder paisa 333.33.
    const first = await noteFor(purchaseId, [returned(lineA, 33)]);
    expect((await chargesOf(first.returnId))[0].taxable_amount).toBe(-220);

    const second = await noteFor(purchaseId, [returned(lineA, 67)]);
    expect((await chargesOf(second.returnId))[0].taxable_amount).toBe(-446.67);

    const freight = await billCharge(purchaseId, "FREIGHT");
    expect(freight.reversed_amount).toBe(666.67);
    // B still holds its share, so the charge is not reversed yet — and never double-counted.
    expect(isFullyReversed(freight)).toBe(false);
  });

  it("cancelling a note takes its reversals out of the bill and back onto the stock", async () => {
    const purchaseId = await bill([{ external_id: "chg-FREIGHT-1500", head_code: "FREIGHT", amount: 1500, gst_percent: 18 }]);
    const { returnId } = await noteFor(purchaseId, [returned(lineA, 50)]);
    expect(await billCharge(purchaseId, "FREIGHT")).toMatchObject({ reversed_amount: 500 });

    await purchaseReturnService.cancelPurchaseReturn(returnId, "Keyed the wrong batch");

    expect(await chargesOf(returnId)).toHaveLength(0);
    expect(await billCharge(purchaseId, "FREIGHT")).toMatchObject({ reversed_amount: 0 });
    expect(Number((await batch(lineA.product_id, lineA.batch_no)).landed_cost_rate)).toBeCloseTo(110, 4);
    expect((await batch(lineA.product_id, lineA.batch_no)).stock_qty).toBe(100);
  });

  it("leaves every charge unreversed on a sunk store", async () => {
    const purchaseId = await bill([{ external_id: "chg-FREIGHT-1500", head_code: "FREIGHT", amount: 1500, gst_percent: 18 }]);
    await policy("sunk");

    const { returnId, grandTotal } = await noteFor(purchaseId, [returned(lineA, 50)]);

    expect(await chargesOf(returnId)).toHaveLength(0);
    expect(grandTotal).toBe(5600);
    expect(await billCharge(purchaseId, "FREIGHT")).toMatchObject({ reversed_amount: 0 });
    expect(Number((await batch(lineA.product_id, lineA.batch_no)).landed_cost_rate)).toBeCloseTo(110, 4);
  });

  it("never reverses a charge past what it put on the line", async () => {
    const purchaseId = await bill([{ external_id: "chg-FREIGHT-1500", head_code: "FREIGHT", amount: 1500, gst_percent: 18 }]);

    // The service blocks an over-quantity note, so the primitive is asked directly: 120 of a
    // 100-unit line may only take that line's 1,000, not 1,200.
    const over = await reversalChargesForReturn(
      purchaseId,
      [{ product_id: lineA.product_id, batch_no: lineA.batch_no, return_qty: 120 }],
      "pr_would_be_saved"
    );
    expect(over).toHaveLength(1);
    expect(over[0].amount).toBe(-1000);
  });

  it("credits an expensed charge back through the expense register", async () => {
    const purchaseId = await bill([
      {
        external_id: "chg-INSURANCE-200",
        head_code: "INSURANCE",
        amount: 200,
        gst_percent: 18,
        treatment: "expense",
        itc_eligibility: "blocked",
      },
      { external_id: "chg-FREIGHT-1000", head_code: "FREIGHT", amount: 1000, gst_percent: 18 },
    ]);

    // Booked as an expense it spreads no paisa onto the lines, so the basis is notional: the
    // 236 it cost the store splits 157.33 / 78.67 by line value.
    const insurance = await billCharge(purchaseId, "INSURANCE");
    expect(insurance.allocated_amount).toBe(0);
    expect(reversibleAmount(insurance)).toBe(236);

    const { returnId } = await noteFor(purchaseId, [returned(lineA, 100)]);

    const noteCharges = await chargesOf(returnId);
    expect(noteCharges.map((c) => c.head_code)).toEqual(["INSURANCE", "FREIGHT"]);
    // The engine prices a charge from its taxable amount, so 157.33 of credit is −133.33 of value.
    expect(noteCharges[0]).toMatchObject({ taxable_amount: -133.33, total_amount: -157.33 });
    expect(noteCharges[1].taxable_amount).toBe(-666.67);

    expect(await expensesOf(returnId)).toMatchObject([{ amount: -157.33 }]);
    expect(await billCharge(purchaseId, "INSURANCE")).toMatchObject({ reversed_amount: 157.33 });
    expect(await billCharge(purchaseId, "FREIGHT")).toMatchObject({ reversed_amount: 666.67 });
  });

  it("keeps an expensed charge's credit out of the batch's landed cost", async () => {
    // The bill of the credit above: the 236 of expensed insurance is notionally 157.33 of line A,
    // but it never reached the batch, so giving it back cannot move the batch's landed rate
    // (PUR-011, PUR-012). Only the freight that actually spread does.
    const purchaseId = await bill([
      {
        external_id: "chg-INSURANCE-200",
        head_code: "INSURANCE",
        amount: 200,
        gst_percent: 18,
        treatment: "expense",
        itc_eligibility: "blocked",
      },
      { external_id: "chg-FREIGHT-1000", head_code: "FREIGHT", amount: 1000, gst_percent: 18 },
    ]);
    await noteFor(purchaseId, [returned(lineA, 100)]);

    // 1,000 of freight spread 2:1 by value lands 666.67 on line A, and the note gives the whole of
    // that back — which leaves the batch at the supplier's own rate, not below it.
    expect(Number((await batch(lineA.product_id, lineA.batch_no)).landed_cost_rate)).toBeCloseTo(100, 4);

    // Line B kept the 333.33 it was charged and its notional insurance share never entered it.
    expect(Number((await batch(lineB.product_id, lineB.batch_no)).landed_cost_rate)).toBeCloseTo(53.3333, 4);
  });

  it("keeps a filed return reversing after the bill is edited", async () => {
    const purchaseId = await bill([{ external_id: "chg-FREIGHT-1500", head_code: "FREIGHT", amount: 1500, gst_percent: 18 }]);
    await noteFor(purchaseId, [returned(lineA, 50)]);

    // The edit re-keys every goods line, which is what silently stopped a note reversing before.
    await purchaseService.updatePurchaseBill(purchaseId, {
      supplier_id: "sup_crs",
      supplier_name: "CRS Distributors",
      supplier_invoice_no: INVOICE_NUMBER,
      purchase_date: "2026-11-15",
      purchase_number: BILL_NUMBER,
      lines: [lineA, lineB],
      charges: [{ external_id: "chg-FREIGHT-1500", head_code: "FREIGHT", amount: 3000, gst_percent: 18 }],
    });

    const freight = await billCharge(purchaseId, "FREIGHT");
    expect(freight).toMatchObject({ allocated_amount: 3000, reversed_amount: 1000 });
    // A now carries 2,000 and has given 1,000 back, so the batch sits at 100 + 1,000 / 100.
    expect(Number((await batch(lineA.product_id, lineA.batch_no)).landed_cost_rate)).toBeCloseTo(110, 4);
  });

  it("gives every charge back when the inward bill itself is cancelled", async () => {
    const purchaseId = await bill([
      { external_id: "chg-FREIGHT-1500", head_code: "FREIGHT", amount: 1500, gst_percent: 18 },
      {
        external_id: "chg-INSURANCE-200",
        head_code: "INSURANCE",
        amount: 200,
        gst_percent: 18,
        treatment: "expense",
        itc_eligibility: "blocked",
      },
    ]);

    await purchaseService.cancelPurchaseBill(purchaseId, "Supplier sent the wrong goods");

    const rows = await chargesOf(purchaseId);
    expect(rows.map((r) => r.reversed_amount)).toEqual([1500, 236]);
    rows.forEach((row) => expect(isFullyReversed(row)).toBe(true));
    // The register entry the charge booked is withdrawn with the bill, so the book balances.
    expect(await expensesOf(purchaseId)).toHaveLength(0);
    expect(Number((await batch(lineA.product_id, lineA.batch_no)).landed_cost_rate)).toBeCloseTo(100, 4);
    expect((await batch(lineA.product_id, lineA.batch_no)).stock_qty).toBe(0);
  });

  it("posts nothing when a note has no original bill", async () => {
    const purchaseId = await bill([{ external_id: "chg-FREIGHT-1500", head_code: "FREIGHT", amount: 1500, gst_percent: 18 }]);

    const orphan: PurchaseReturnInput = {
      original_purchase_number: "PUR-CRS-999",
      supplier_id: "sup_crs",
      supplier_name: "CRS Distributors",
      supplier_gstin: "32AAACA1234B1Z2",
      settlement_type: "credit_adjust",
      lines: [returned(lineA, 20)],
    };
    const { returnId, grandTotal } = await purchaseReturnService.createPurchaseReturn(orphan);

    expect(await chargesOf(returnId)).toHaveLength(0);
    expect(grandTotal).toBe(2240);
    expect(await billCharge(purchaseId, "FREIGHT")).toMatchObject({ reversed_amount: 0 });
  });
});
