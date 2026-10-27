import {
  calculateDocumentTaxes,
  type TaxEngineDocumentInput,
  type TaxEngineCalculatedLine,
  cleanStateCode,
} from "./taxEngine.js";

export type CompanyTaxMode = "inclusive" | "exclusive";

export interface LineCalculationInput {
  qty: number;
  loose_qty?: number;
  units_per_pack?: number;
  unit_price: number;
  discount_percent?: number;
  discount_amount?: number;
  gst_percent: number;
  cess_percent?: number;
  rate_basis?: "sel_rate" | "mrp" | "ptr" | "pts";
}

export interface CalculatedLineResult {
  qty: number;
  loose_qty: number;
  units_per_pack: number;
  unit_price: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  taxable_amount: number;
  cgst_rate: number;
  cgst_amount: number;
  sgst_rate: number;
  sgst_amount: number;
  igst_rate: number;
  igst_amount: number;
  cess_amount: number;
  total_tax: number;
  total_amount: number;
}

export interface InvoiceTotalsResult {
  subtotal: number;
  taxable_subtotal: number;
  line_discount_total: number;
  bill_discount_amount: number;
  total_tax: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  cess_total: number;
  net_before_round: number;
  round_off: number;
  grand_total: number;
}

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function calculateLineGross(
  qty: number,
  looseQty: number = 0,
  unitsPerPack: number = 1,
  unitPrice: number = 0
): number {
  const packs = Math.max(0, Number(qty) || 0);
  const loose = Math.max(0, Number(looseQty) || 0);
  const upp = Math.max(1, Number(unitsPerPack) || 1);
  const price = Math.max(0, Number(unitPrice) || 0);

  const packGross = Math.round(packs * price * 100);
  const looseGross = loose > 0 ? Math.round((loose * price * 100) / upp) : 0;
  return round2((packGross + looseGross) / 100);
}

export function calculateLineDiscount(
  gross: number,
  discountPercent?: number,
  discountAmount?: number
): number {
  if (gross <= 0) return 0;
  if (Number(discountAmount) > 0 && !(Number(discountPercent) > 0)) {
    return round2(Math.min(gross, Math.max(0, Number(discountAmount) || 0)));
  }
  const pct = Math.max(0, Number(discountPercent) || 0);
  return round2(Math.min(gross, (gross * pct) / 100));
}

export function calculateSingleLine(
  line: LineCalculationInput,
  storeStateCode: string = "32",
  customerGstinOrState?: string,
  taxMode: CompanyTaxMode = "inclusive"
): CalculatedLineResult {
  const doc = calculateDocumentTaxes({
    store_state: storeStateCode,
    customer_gstin: customerGstinOrState,
    default_tax_mode: taxMode,
    lines: [
      {
        qty: line.qty,
        loose_qty: line.loose_qty,
        units_per_pack: line.units_per_pack,
        unit_price: line.unit_price,
        rate_basis: line.rate_basis,
        discount_percent: line.discount_percent,
        discount_amount: line.discount_amount,
        gst_percent: line.gst_percent,
        cess_percent: line.cess_percent,
      },
    ],
    auto_round_off: false,
  });

  const c = doc.lines[0];
  return {
    qty: c.qty,
    loose_qty: c.loose_qty,
    units_per_pack: c.units_per_pack,
    unit_price: c.unit_price,
    gross_amount: c.gross_amount,
    discount_amount: c.line_discount,
    net_amount: round2(c.gross_amount - c.line_discount),
    taxable_amount: c.taxable_amount,
    cgst_rate: c.cgst_rate,
    cgst_amount: c.cgst_amount,
    sgst_rate: c.sgst_rate,
    sgst_amount: c.sgst_amount,
    igst_rate: c.igst_rate,
    igst_amount: c.igst_amount,
    cess_amount: c.cess_amount,
    total_tax: c.total_tax,
    total_amount: c.total_amount,
  };
}

export function calculateInvoiceTotals(
  calculatedLines: CalculatedLineResult[],
  billDiscountPercent: number = 0,
  billDiscountAmount: number = 0
): InvoiceTotalsResult {
  const doc = calculateDocumentTaxes({
    store_state: "32",
    lines: calculatedLines.map((l) => ({
      qty: l.qty,
      loose_qty: l.loose_qty,
      units_per_pack: l.units_per_pack,
      unit_price: l.unit_price,
      discount_amount: l.discount_amount,
      gst_percent: (l.cgst_rate + l.sgst_rate + l.igst_rate),
      cess_percent: l.taxable_amount > 0 ? (l.cess_amount / l.taxable_amount) * 100 : 0,
    })),
    bill_discount: {
      type: billDiscountPercent > 0 ? "percent" : "amount",
      value: billDiscountPercent > 0 ? billDiscountPercent : billDiscountAmount,
    },
    auto_round_off: true,
  });

  return {
    subtotal: doc.gross_subtotal,
    taxable_subtotal: doc.taxable_subtotal,
    line_discount_total: doc.line_discount_total,
    bill_discount_amount: doc.bill_discount_total,
    total_tax: doc.total_tax,
    cgst_total: doc.cgst_total,
    sgst_total: doc.sgst_total,
    igst_total: doc.igst_total,
    cess_total: doc.cess_total,
    net_before_round: doc.net_before_round,
    round_off: doc.round_off,
    grand_total: doc.grand_total,
  };
}
