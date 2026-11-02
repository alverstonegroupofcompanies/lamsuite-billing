import {
  calculateDocumentTaxes,
  type TaxEngineDocumentInput,
  type TaxEngineCalculatedLine,
  type RateBasis,
  cleanStateCode,
} from "../tax-engine/taxEngine";

export type CompanyTaxMode = "inclusive" | "exclusive";

export interface BillingLineInput {
  qty: number;
  loose_qty?: number;
  units_per_pack?: number;
  unit_price: number; // Price per pack / unit (or per loose unit if rate_basis is loose_rate)
  mrp?: number;
  ptr?: number;
  pts?: number;
  ptss?: number;
  discount_percent?: number;
  discount_amount?: number;
  discount_type?: "percent" | "amount";
  gst_percent: number;
  cess_percent?: number;
  rate_basis?: RateBasis;
  is_tax_inclusive?: boolean;
}

export interface CalculatedLine {
  gross_amount: number;
  discount_amount: number;
  allocated_bill_discount?: number;
  net_amount: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount?: number;
  total_tax: number;
  total_amount: number;
}

export interface InvoiceTotals {
  gross_subtotal?: number;
  taxable_subtotal: number;
  line_discount_total: number;
  bill_discount_amount: number;
  total_tax: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  cess_total?: number;
  net_before_round: number;
  round_off: number;
  grand_total: number;
  lines?: TaxEngineCalculatedLine[];
  is_composition?: boolean;
  gst_type?: string;
  document_title?: "Tax Invoice" | "Bill of Supply";
}

export interface BillingTaxOptions {
  companyTaxMode?: CompanyTaxMode;
  isInterState?: boolean;
  storeState?: string;
  gstType?: "regular" | "composition" | "no_tax" | "unregistered";
  isComposition?: boolean;
  customerGstin?: string | null;
  placeOfSupply?: string | null;
}

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Check if the rate basis or specific price enforces inclusive or exclusive GST */
export function isLineGstInclusive(line: BillingLineInput, defaultTaxMode: CompanyTaxMode): boolean {
  if (line.is_tax_inclusive !== undefined && line.is_tax_inclusive !== null) {
    return line.is_tax_inclusive;
  }
  // MRP is statutory GST-inclusive
  if (line.rate_basis === "mrp") return true;

  // Wholesale/trade rates PTR, PTS, PTSS are strictly GST-exclusive
  if (line.rate_basis === "ptr" || line.rate_basis === "pts" || line.rate_basis === "ptss") {
    return false;
  }

  // Selling rate and loose rate follow company sales tax preference
  return defaultTaxMode === "inclusive";
}

/** Compute pack and loose tablet price with protection against rounding drift */
export function calculateLineGross(line: BillingLineInput): number {
  const packs = Math.max(0, Number(line.qty) || 0);
  const loose = Math.max(0, Number(line.loose_qty) || 0);
  const unitsPerPack = Math.max(1, Math.round(Number(line.units_per_pack) || 1));
  const price = Math.max(0, Number(line.unit_price) || 0);

  if (line.rate_basis === "loose_rate") {
    const totalUnits = packs * unitsPerPack + loose;
    return round2(totalUnits * price);
  }

  const packGross = Math.round(packs * price * 100);
  const looseGross = loose > 0 ? Math.round((loose * price * 100) / unitsPerPack) : 0;

  return round2((packGross + looseGross) / 100);
}

/** Compute line discount amount from percent or absolute amount */
export function calculateLineDiscount(gross: number, line: BillingLineInput): number {
  if (gross <= 0) return 0;

  if (line.discount_type === "amount" || (Number(line.discount_amount) > 0 && !(Number(line.discount_percent) > 0))) {
    return round2(Math.min(gross, Math.max(0, Number(line.discount_amount) || 0)));
  }

  const pct = Math.max(0, Number(line.discount_percent) || 0);
  return round2(Math.min(gross, (gross * pct) / 100));
}

/** Split net amount into taxable and tax based on Indian GST rules */
export function splitNetByGstMode(
  net: number,
  combinedRate: number,
  inclusive: boolean
): { taxable: number; tax: number; total: number } {
  const amount = Math.max(0, Number.isFinite(net) ? net : 0);
  const rate = Math.max(0, Number.isFinite(combinedRate) ? combinedRate : 0);

  if (inclusive) {
    const taxable = rate > 0 ? Math.round((amount / (1 + rate / 100)) * 100) / 100 : amount;
    const tax = Math.max(0, Math.round((amount - taxable) * 100) / 100);
    return {
      taxable,
      tax,
      total: round2(amount),
    };
  }

  const tax = rate > 0 ? Math.round(((amount * rate) / 100) * 100) / 100 : 0;
  return {
    taxable: round2(amount),
    tax,
    total: round2(amount + tax),
  };
}

/** Indian statutory auto round-off to nearest rupee */
export function computeAutoRoundOff(amountBeforeRound: number): { roundOff: number; grandTotal: number } {
  const base = Math.max(0, Number.isFinite(amountBeforeRound) ? amountBeforeRound : 0);
  const nearestRupee = Math.round(base);
  const roundOff = round2(nearestRupee - base);
  return {
    roundOff,
    grandTotal: nearestRupee,
  };
}

export function calculateLineTotals(
  line: BillingLineInput,
  taxModeOrOptions: CompanyTaxMode | BillingTaxOptions = "inclusive",
  isInterState = false,
  storeState = "32",
  gstType?: "regular" | "composition" | "no_tax" | "unregistered"
): CalculatedLine {
  const opts: BillingTaxOptions = typeof taxModeOrOptions === "object"
    ? taxModeOrOptions
    : {
        companyTaxMode: taxModeOrOptions,
        isInterState,
        storeState,
        gstType,
      };

  const stState = opts.storeState || "32";
  const posState = opts.placeOfSupply || (opts.isInterState ? "XX" : stState);

  const doc = calculateDocumentTaxes({
    store_state: stState,
    place_of_supply: posState,
    customer_gstin: opts.customerGstin,
    default_tax_mode: opts.companyTaxMode || "inclusive",
    is_composition: opts.isComposition,
    gst_type: opts.gstType,
    lines: [{
      qty: line.qty,
      loose_qty: line.loose_qty,
      units_per_pack: line.units_per_pack,
      unit_price: line.unit_price,
      mrp: line.mrp,
      rate_basis: line.rate_basis,
      discount_percent: line.discount_percent,
      discount_amount: line.discount_amount,
      gst_percent: line.gst_percent,
      cess_percent: line.cess_percent,
      is_tax_inclusive: line.is_tax_inclusive,
    }],
    auto_round_off: false,
  });

  const cLine = doc.lines[0];
  return {
    gross_amount: cLine.gross_amount,
    discount_amount: cLine.line_discount,
    allocated_bill_discount: cLine.allocated_bill_discount,
    net_amount: round2(cLine.gross_amount - cLine.line_discount),
    taxable_amount: cLine.taxable_amount,
    cgst_amount: cLine.cgst_amount,
    sgst_amount: cLine.sgst_amount,
    igst_amount: cLine.igst_amount,
    cess_amount: cLine.cess_amount,
    total_tax: cLine.total_tax,
    total_amount: cLine.total_amount,
  };
}

export function calculateInvoiceTotals(
  lines: BillingLineInput[],
  billDiscount: { type: "percent" | "amount"; value: number } = { type: "amount", value: 0 },
  taxModeOrOptions: CompanyTaxMode | BillingTaxOptions = "inclusive",
  isInterState = false,
  autoRoundOff = true,
  manualRoundOff?: number | null,
  storeState = "32",
  gstType?: "regular" | "composition" | "no_tax" | "unregistered"
): InvoiceTotals {
  const opts: BillingTaxOptions = typeof taxModeOrOptions === "object"
    ? taxModeOrOptions
    : {
        companyTaxMode: taxModeOrOptions,
        isInterState,
        storeState,
        gstType,
      };

  const stState = opts.storeState || "32";
  const posState = opts.placeOfSupply || (opts.isInterState ? "XX" : stState);

  const doc = calculateDocumentTaxes({
    store_state: stState,
    place_of_supply: posState,
    customer_gstin: opts.customerGstin,
    default_tax_mode: opts.companyTaxMode || "inclusive",
    is_composition: opts.isComposition,
    gst_type: opts.gstType,
    lines: lines.map((l) => ({
      qty: l.qty,
      loose_qty: l.loose_qty,
      units_per_pack: l.units_per_pack,
      unit_price: l.unit_price,
      mrp: l.mrp,
      rate_basis: l.rate_basis,
      discount_percent: l.discount_percent,
      discount_amount: l.discount_amount,
      gst_percent: l.gst_percent,
      cess_percent: l.cess_percent,
      is_tax_inclusive: l.is_tax_inclusive,
    })),
    bill_discount: billDiscount,
    auto_round_off: autoRoundOff,
    manual_round_off: manualRoundOff,
  });

  return {
    gross_subtotal: doc.gross_subtotal,
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
    lines: doc.lines,
    is_composition: doc.is_composition,
    gst_type: doc.gst_type,
    document_title: doc.document_title,
  };
}
