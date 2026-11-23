import { describe, it, expect, beforeEach } from "vitest";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { chargeHeadsStore } from "../masters/chargeHeadsStore";
import { purchaseChargeSummary } from "../reports/purchaseChargeRegister";
import { companySettingsService } from "../settings/companySettingsService";
import {
  calculateDocumentTaxes,
  type TaxEngineChargeInput,
  type TaxEngineDocumentInput,
  type TaxEngineLineInput,
} from "../tax-engine/taxEngine";
import { purchaseReturnService, type PurchaseReturnInput } from "./purchaseReturnService";
import { purchaseService, type PurchaseDocumentInput, type PurchaseLineItemInput } from "./purchaseService";

/**
 * CR-C-11 on the till — the store decides whether a separately-paid charge is money the supplier
 * is owed.
 *
 * The offline bill is the authority for its own payable, so the same two rupees the server moves
 * have to move here: goods 1,000 at 12%, freight 200 at 12% and insurance 50 at 5%, both handed to
 * someone other than the supplier. With the switch off the supplier's bill is 1,120.00 and the 276.50
 * sits in its own block; with it on the bill is 1,396.50. Landed cost, the expense posting and the
 * input tax never move — who was paid is a different fact from what is owed (PUR-013, PUR-016).
 */

const ENGINE_LINE: TaxEngineLineInput = {
  line_id: "L1",
  product_name: "Dolo 650 Tablets",
  hsn_code: "30049090",
  qty: 10,
  loose_qty: 0,
  units_per_pack: 1,
  unit_price: 100,
  rate_basis: "ptr",
  discount_percent: 0,
  discount_amount: 0,
  gst_percent: 12,
  cess_percent: 0,
};

const PAID_APART: TaxEngineChargeInput[] = [
  {
    charge_id: "C1",
    head_code: "FREIGHT",
    head_name: "Freight",
    amount: 200,
    gst_percent: 12,
    treatment: "add_to_cost",
    spread_method: "value",
    itc_eligibility: "eligible",
    paid_separately: true,
    paid_to_label: "Kerala Transports",
  },
  {
    charge_id: "C2",
    head_code: "INSURANCE",
    head_name: "Insurance",
    amount: 50,
    gst_percent: 5,
    treatment: "expense",
    spread_method: "value",
    itc_eligibility: "eligible",
    paid_separately: true,
    paid_to_label: "United Insurance",
  },
];

const engineDoc = (overrides: Partial<TaxEngineDocumentInput> = {}): TaxEngineDocumentInput => ({
  store_state: "32",
  place_of_supply: "32",
  default_tax_mode: "exclusive",
  lines: [{ ...ENGINE_LINE }],
  bill_discount: { type: "amount", value: 0 },
  charges: PAID_APART.map((charge) => ({ ...charge })),
  auto_round_off: false,
  ...overrides,
});

describe("CR-C-11 payable policy in the shared engine (PUR-009, PUR-013, PUR-016)", () => {
  it("keeps a separately-paid charge out of the payable when the store says nothing", () => {
    const result = calculateDocumentTaxes(engineDoc());

    expect(result.grand_total).toBeCloseTo(1120, 2);
    expect(result.total_tax).toBeCloseTo(120, 2);
    expect(result.charge_total).toBe(0);
    expect(result.separate_charge_total).toBeCloseTo(276.5, 2);
    expect(result.charges.map((charge) => charge.in_payable)).toEqual([false, false]);
  });

  it("bills the same money into the payable when the switch is on", () => {
    const result = calculateDocumentTaxes(engineDoc({ separately_paid_in_payable: true }));

    // The whole 276.50 crosses over: nothing is left on the other side of the split.
    expect(result.grand_total).toBeCloseTo(1396.5, 2);
    expect(result.total_tax).toBeCloseTo(146.5, 2);
    expect(result.cgst_total).toBeCloseTo(73.25, 2);
    expect(result.charge_total).toBeCloseTo(276.5, 2);
    expect(result.separate_charge_total).toBe(0);
    expect(result.charges.map((charge) => charge.in_payable)).toEqual([true, true]);
  });

  it("moves only the payable — landed cost, the expense posting and input tax stay", () => {
    const off = calculateDocumentTaxes(engineDoc());
    const on = calculateDocumentTaxes(engineDoc({ separately_paid_in_payable: true }));

    for (const key of [
      "landed_cost_addition",
      "expense_charge_total",
      "creditable_input_tax_total",
      "non_creditable_tax_total",
      "taxable_subtotal",
    ] as const) {
      expect(on[key], key).toBe(off[key]);
    }

    expect(on.landed_cost_addition).toBeCloseTo(200, 2);
    expect(on.expense_charge_total).toBeCloseTo(50, 2);
    expect(on.creditable_input_tax_total).toBeCloseTo(146.5, 2);
    expect(on.lines[0].charge_allocation).toBeCloseTo(200, 2);
    expect(on.lines[0].landed_unit_cost).toBeCloseTo(120, 2);
    // The identity the plan asserts still foots, whichever side the money is on.
    expect(on.reconciliation_identity_delta).toBe(0);
    expect(off.reconciliation_identity_delta).toBe(0);
  });

  it("treats an explicit false and anything that is not true as the default", () => {
    // A settings payload that spells the switch as "1"/"true" is the settings layer's job; by the
    // time a document is priced, the policy is a real flag.
    for (const value of [false, undefined, null, 0, ""]) {
      const result = calculateDocumentTaxes(
        engineDoc({ separately_paid_in_payable: value as unknown as boolean })
      );
      expect(result.charge_total, String(value)).toBe(0);
      expect(result.grand_total, String(value)).toBeCloseTo(1120, 2);
    }
  });

  it("leaves a document with no charge lines alone", () => {
    const plain = engineDoc({ charges: [] });

    expect(calculateDocumentTaxes(plain).grand_total).toBeCloseTo(1120, 2);
    expect(calculateDocumentTaxes({ ...plain, separately_paid_in_payable: true }).grand_total).toBeCloseTo(1120, 2);
  });

  it("lets a charge line state its own membership, which is how a return inherits its bill", () => {
    // A reversal carries the answer the original bill was posted under, so a policy that changed
    // since cannot make a debit note credit money the bill never billed (PUR-016).
    const inherited = calculateDocumentTaxes(
      engineDoc({ charges: [{ ...PAID_APART[0], in_payable: true }] })
    );
    expect(inherited.charge_total).toBeCloseTo(224, 2);
    expect(inherited.grand_total).toBeCloseTo(1344, 2);

    const excluded = calculateDocumentTaxes(
      engineDoc({
        separately_paid_in_payable: true,
        charges: [{ ...PAID_APART[0], paid_separately: false, in_payable: false }],
      })
    );
    expect(excluded.charge_total).toBe(0);
    expect(excluded.separate_charge_total).toBeCloseTo(224, 2);
  });
});

// ------------------------------------------------------------------ posting and the sync payload

const goodsLine: PurchaseLineItemInput = {
  product_id: "prod_pps",
  product_name: "Paracetamol 650mg",
  batch_no: "PPS-1",
  expiry_date: "2027-12-31",
  pack_qty: 100,
  units_per_pack: 1,
  purchase_rate: 100,
  gst_percent: 12,
};

const apartFreight = (key: string) => [
  {
    external_id: `chg-pps-${key}-freight`,
    head_code: "FREIGHT",
    amount: 200,
    gst_percent: 18,
    paid_separately: true,
    paid_to_label: "Ganga Courier",
  },
];

/**
 * Each bill owns its own numbers. A note finds the bill it returns by number as well as by id,
 * so two fixtures sharing a purchase number would read each other's returns and reverse twice.
 */
async function postCharges(key: string, overrides: Partial<PurchaseDocumentInput> = {}) {
  const { purchaseId } = await purchaseService.recordInwardPurchaseBill({
    supplier_id: "sup_pps",
    supplier_name: "PPS Distributors",
    supplier_invoice_no: `PPS-${key}`,
    purchase_date: "2026-11-15",
    purchase_number: `PUR-PPS-${key}`,
    lines: [goodsLine],
    charges: apartFreight(key),
    ...overrides,
  });

  return purchaseId;
}

async function chargeRows(purchaseId: string) {
  const rows = await sqliteStorage.findAll<any>("purchase_charges");
  return rows.filter((r) => r.purchase_id === purchaseId).sort((a, b) => a.seq - b.seq);
}

async function queuedPayload(purchaseId: string) {
  const queue = await sqliteStorage.findAll<any>("sync_queue");
  const item = queue.filter((q) => q.entity_type === "purchase" && q.entity_id === purchaseId).pop();
  return item ? JSON.parse(item.payload_json) : null;
}

async function payablePolicy(inPayable: boolean) {
  await companySettingsService.saveLocalSettings({
    purchase_charges: { reverse_on_return: "proportional", separately_paid_in_payable: inPayable },
  });
}

describe("CR-C-11 posting on the till (PUR-011, PUR-013, PUR-016, SYNC-007)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    await chargeHeadsStore.resetToDefaults();
    await companySettingsService.loadSettings();
    // Settings live in localStorage across files, so each test starts from the documented default.
    await payablePolicy(false);
  });

  it("stores the payable answer on the charge row and prices the bill with it", async () => {
    const off = await postCharges("OFF");
    expect(await chargeRows(off)).toMatchObject([{ paid_separately: 1, in_payable: 0 }]);
    expect((await sqliteStorage.findById<any>("purchase_documents", off)).grand_total).toBe(11200);

    await payablePolicy(true);

    const on = await postCharges("ON");
    expect(await chargeRows(on)).toMatchObject([{ paid_separately: 1, in_payable: 1 }]);

    const header = await sqliteStorage.findById<any>("purchase_documents", on);
    expect(header.grand_total).toBe(11436);
    expect(header.tax_total).toBe(1236);
    expect(header.cgst_total).toBe(618);

    // Only the payable moved: the freight still sits on the goods at the supplier's own rate.
    const item = (await sqliteStorage.findAll<any>("purchase_items")).find((i) => i.purchase_id === on);
    expect(item.charge_allocation).toBe(200);
    expect(item.landed_unit_cost).toBe(102);
    expect(item.purchase_rate).toBe(100);
  });

  it("sends who was paid, never what the store's policy says", async () => {
    await payablePolicy(true);
    const purchaseId = await postCharges("PAYLOAD");

    const payload = await queuedPayload(purchaseId);
    expect(payload.charges[0]).toMatchObject({ paid_separately: 1, paid_to_label: "Ganga Courier" });
    // The server derives the membership from its own read of the setting, so a till that has not
    // synced cannot push a payable answer of its own (SYNC-007).
    expect(Object.keys(payload.charges[0])).not.toContain("in_payable");
  });

  it("totals a posted bill the same way the register does under either policy", async () => {
    const off = await postCharges("REG-OFF");
    await payablePolicy(true);
    const on = await postCharges("REG-ON");

    for (const [purchaseId, chargeTotal] of [
      [off, 0],
      [on, 236],
    ] as const) {
      const header = await sqliteStorage.findById<any>("purchase_documents", purchaseId);
      const summary = purchaseChargeSummary(
        {
          id: purchaseId,
          subtotal: header.subtotal,
          tax_total: header.tax_total,
          grand_total: header.grand_total,
          round_off: header.round_off,
        },
        await chargeRows(purchaseId)
      );

      expect(summary.charge_total).toBe(chargeTotal);
      expect(summary.separately_paid.total).toBe(chargeTotal ? 0 : 236);
      // PUR-001 with the CR-C-11 split: the payable is the goods money plus what is inside it.
      expect(summary.goods_taxable + summary.goods_tax + summary.charge_total).toBe(header.grand_total);
    }
  });
});

// ------------------------------------------------------------------ returns follow the bill

describe("CR-C-11 returns on the till (PUR-013, PUR-015, PUR-016)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    await chargeHeadsStore.resetToDefaults();
    await companySettingsService.loadSettings();
    await payablePolicy(false);
  });

  async function halfReturn(billId: string, key: string) {
    const input: PurchaseReturnInput = {
      original_purchase_id: billId,
      original_purchase_number: `PUR-PPS-${key}`,
      supplier_id: "sup_pps",
      supplier_name: "PPS Distributors",
      supplier_gstin: "32AAACA1234B1Z2",
      supplier_invoice_no: `PPS-${key}`,
      settlement_type: "credit_adjust",
      lines: [
        {
          product_id: goodsLine.product_id,
          product_name: goodsLine.product_name,
          batch_id: `batch_${goodsLine.product_id}_PPS-1`,
          batch_no: goodsLine.batch_no,
          expiry_date: goodsLine.expiry_date,
          purchased_qty: goodsLine.pack_qty,
          return_qty: 50,
          purchase_rate: goodsLine.purchase_rate,
          gst_percent: goodsLine.gst_percent,
          reason: "excess",
        },
      ],
    };

    return (await purchaseReturnService.createPurchaseReturn(input)).returnId;
  }

  it("routes the note's freight share the way the bill it returns was billed", async () => {
    await payablePolicy(true);
    const inside = await postCharges("ON-BILL");
    expect(await chargeRows(inside)).toMatchObject([{ in_payable: 1 }]);

    await payablePolicy(false);
    const outside = await postCharges("OFF-BILL");
    expect(await chargeRows(outside)).toMatchObject([{ in_payable: 0 }]);

    // Half the goods gives back half of what the 200 spread, whichever side it was billed on.
    const insideNote = await halfReturn(inside, "ON-BILL");
    const outsideNote = await halfReturn(outside, "OFF-BILL");

    expect(await chargeRows(insideNote)).toMatchObject([{ taxable_amount: -100, in_payable: 1 }]);
    expect(await chargeRows(outsideNote)).toMatchObject([{ taxable_amount: -100, in_payable: 0 }]);
    expect((await chargeRows(inside))[0].reversed_amount).toBe(100);
    expect((await chargeRows(outside))[0].reversed_amount).toBe(100);
  });

  it("follows the bill, not the policy that happened to be on when the note was keyed", async () => {
    const billId = await postCharges("FLIP-BILL");
    expect(await chargeRows(billId)).toMatchObject([{ in_payable: 0 }]);

    await payablePolicy(true);
    const noteId = await halfReturn(billId, "FLIP-BILL");

    // The bill stays 11,200.00 and the note reduces nothing from it — the two still net to zero.
    expect(await chargeRows(noteId)).toMatchObject([{ taxable_amount: -100, in_payable: 0 }]);
    expect((await chargeRows(billId))[0].in_payable).toBe(0);
  });
});
