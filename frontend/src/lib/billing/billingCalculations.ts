export type CompanyTaxMode = "inclusive" | "exclusive";

export interface BillingLineInput {
  qty: number;
  loose_qty?: number;
  units_per_pack?: number;
  unit_price: number; // Price per pack / unit
  mrp?: number;
  ptr?: number;
  pts?: number;
  ptss?: number;
  discount_percent?: number;
  discount_amount?: number;
  discount_type?: "percent" | "amount";
  gst_percent: number;
  cess_percent?: number;
  rate_basis?: "sel_rate" | "mrp" | "ptr" | "pts" | "ptss";
}

export interface CalculatedLine {
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_tax: number;
  total_amount: number;
}

export interface InvoiceTotals {
  taxable_subtotal: number;
  line_discount_total: number;
  bill_discount_amount: number;
  total_tax: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  net_before_round: number;
  round_off: number;
  grand_total: number;
}

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Check if the rate basis or specific price enforces inclusive or exclusive GST */
export function isLineGstInclusive(line: BillingLineInput, defaultTaxMode: CompanyTaxMode): boolean {
  // MRP is statutory GST-inclusive
  if (line.rate_basis === "mrp") return true;

  // Wholesale/trade rates PTR, PTS, PTSS are strictly GST-exclusive
  if (line.rate_basis === "ptr" || line.rate_basis === "pts" || line.rate_basis === "ptss") {
    return false;
  }

  // Selling rate follows company sales tax preference
  return defaultTaxMode === "inclusive";
}

/** Compute loose tablet / cut strip fraction price */
export function calculateLineGross(line: BillingLineInput): number {
  const packs = Math.max(0, Number(line.qty) || 0);
  const loose = Math.max(0, Number(line.loose_qty) || 0);
  const unitsPerPack = Math.max(1, Number(line.units_per_pack) || 1);
  const price = Math.max(0, Number(line.unit_price) || 0);

  const packGross = packs * price;
  const looseGross = loose > 0 ? (loose / unitsPerPack) * price : 0;

  return round2(packGross + looseGross);
}

/** Compute line discount amount from percent or absolute amount */
export function calculateLineDiscount(gross: number, line: BillingLineInput): number {
  if (gross <= 0) return 0;

  if (line.discount_type === "amount" || (Number(line.discount_amount) > 0 && !(Number(line.discount_percent) > 0))) {
    return round2(Math.min(gross, Math.max(0, Number(line.discount_amount) || 0)));
  }

  const pct = Math.max(0, Number(line.discount_percent) || 0);
  return round2(Math.min(gross, gross * (pct / 100)));
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
    const taxable = rate > 0 ? amount / (1 + rate / 100) : amount;
    const tax = Math.max(0, amount - taxable);
    return {
      taxable: round2(taxable),
      tax: round2(tax),
      total: round2(amount),
    };
  }

  const tax = rate > 0 ? amount * (rate / 100) : 0;
  return {
    taxable: round2(amount),
    tax: round2(tax),
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
  companyTaxMode: CompanyTaxMode = "inclusive",
  isInterState = false
): CalculatedLine {
  const gross = calculateLineGross(line);
  const discount = calculateLineDiscount(gross, line);
  const net = Math.max(0, gross - discount);

  const gstPercent = Math.max(0, Number(line.gst_percent) || 0);
  const cessPercent = Math.max(0, Number(line.cess_percent) || 0);
  const combinedRate = gstPercent + cessPercent;

  const inclusive = isLineGstInclusive(line, companyTaxMode);
  const split = splitNetByGstMode(net, combinedRate, inclusive);

  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  if (isInterState) {
    igst = split.tax;
  } else {
    cgst = round2(split.tax / 2);
    sgst = round2(split.tax - cgst);
  }

  return {
    gross_amount: gross,
    discount_amount: discount,
    net_amount: net,
    taxable_amount: split.taxable,
    cgst_amount: cgst,
    sgst_amount: sgst,
    igst_amount: igst,
    total_tax: split.tax,
    total_amount: split.total,
  };
}

export function calculateInvoiceTotals(
  lines: BillingLineInput[],
  billDiscount: { type: "percent" | "amount"; value: number } = { type: "amount", value: 0 },
  companyTaxMode: CompanyTaxMode = "inclusive",
  isInterState = false,
  autoRoundOff = true
): InvoiceTotals {
  let taxableSubtotal = 0;
  let lineDiscountTotal = 0;
  let totalTax = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;

  for (const line of lines) {
    const calc = calculateLineTotals(line, companyTaxMode, isInterState);
    taxableSubtotal += calc.taxable_amount;
    lineDiscountTotal += calc.discount_amount;
    totalTax += calc.total_tax;
    cgstTotal += calc.cgst_amount;
    sgstTotal += calc.sgst_amount;
    igstTotal += calc.igst_amount;
  }

  // Bill-level overall discount applied across taxable subtotal
  let billDiscountAmount = 0;
  if (billDiscount.type === "percent") {
    billDiscountAmount = round2(taxableSubtotal * (Math.min(100, Math.max(0, billDiscount.value)) / 100));
  } else {
    billDiscountAmount = round2(Math.min(taxableSubtotal, Math.max(0, billDiscount.value)));
  }

  // Adjust tax proportionally if bill discount was applied
  if (billDiscountAmount > 0 && taxableSubtotal > 0) {
    const taxScaleRatio = Math.max(0, (taxableSubtotal - billDiscountAmount) / taxableSubtotal);
    totalTax = round2(totalTax * taxScaleRatio);
    cgstTotal = round2(cgstTotal * taxScaleRatio);
    sgstTotal = round2(sgstTotal * taxScaleRatio);
    igstTotal = round2(igstTotal * taxScaleRatio);
  }

  const netSubtotal = Math.max(0, taxableSubtotal - billDiscountAmount);
  const netBeforeRound = round2(netSubtotal + totalTax);

  let roundOff = 0;
  let grandTotal = netBeforeRound;

  if (autoRoundOff) {
    const ro = computeAutoRoundOff(netBeforeRound);
    roundOff = ro.roundOff;
    grandTotal = ro.grandTotal;
  }

  return {
    taxable_subtotal: round2(taxableSubtotal),
    line_discount_total: round2(lineDiscountTotal),
    bill_discount_amount: billDiscountAmount,
    total_tax: totalTax,
    cgst_total: cgstTotal,
    sgst_total: sgstTotal,
    igst_total: igstTotal,
    net_before_round: netBeforeRound,
    round_off: roundOff,
    grand_total: grandTotal,
  };
}
