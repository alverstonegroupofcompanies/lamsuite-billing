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

  const packGross = packs * price;
  const looseGross = loose > 0 ? (loose / upp) * price : 0;
  return round2(packGross + looseGross);
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
  return round2(Math.min(gross, gross * (pct / 100)));
}

export function calculateSingleLine(
  line: LineCalculationInput,
  storeStateCode: string = "32",
  customerGstinOrState?: string,
  taxMode: CompanyTaxMode = "inclusive"
): CalculatedLineResult {
  const qty = Math.max(0, Number(line.qty) || 0);
  const looseQty = Math.max(0, Number(line.loose_qty) || 0);
  const unitsPerPack = Math.max(1, Number(line.units_per_pack) || 1);
  const unitPrice = Math.max(0, Number(line.unit_price) || 0);
  const gstPercent = Math.max(0, Number(line.gst_percent) || 0);
  const cessPercent = Math.max(0, Number(line.cess_percent) || 0);

  const gross = calculateLineGross(qty, looseQty, unitsPerPack, unitPrice);
  const discount = calculateLineDiscount(gross, line.discount_percent, line.discount_amount);
  const net = Math.max(0, round2(gross - discount));

  // Determine intra-state vs inter-state
  let customerState = storeStateCode;
  if (customerGstinOrState) {
    const clean = customerGstinOrState.trim();
    if (clean.length === 15) {
      customerState = clean.substring(0, 2);
    } else if (clean.length === 2) {
      customerState = clean;
    }
  }
  const isInterState = customerState !== storeStateCode;

  // Inclusive vs exclusive tax calculation
  const isInclusive =
    line.rate_basis === "mrp"
      ? true
      : line.rate_basis === "ptr" || line.rate_basis === "pts"
      ? false
      : taxMode === "inclusive";

  let taxable: number;
  let tax: number;
  let total: number;

  if (isInclusive) {
    taxable = gstPercent > 0 ? round2(net / (1 + gstPercent / 100)) : net;
    tax = round2(net - taxable);
    total = net;
  } else {
    taxable = net;
    tax = round2((taxable * gstPercent) / 100);
    total = round2(taxable + tax);
  }

  let cgstRate = 0;
  let cgstAmount = 0;
  let sgstRate = 0;
  let sgstAmount = 0;
  let igstRate = 0;
  let igstAmount = 0;

  if (isInterState) {
    igstRate = gstPercent;
    igstAmount = tax;
  } else {
    cgstRate = gstPercent / 2;
    cgstAmount = round2(tax / 2);
    sgstRate = gstPercent / 2;
    sgstAmount = round2(tax - cgstAmount);
  }

  const cessAmount = cessPercent > 0 ? round2((taxable * cessPercent) / 100) : 0;
  total = round2(total + cessAmount);

  return {
    qty,
    loose_qty: looseQty,
    units_per_pack: unitsPerPack,
    unit_price: unitPrice,
    gross_amount: gross,
    discount_amount: discount,
    net_amount: net,
    taxable_amount: taxable,
    cgst_rate: cgstRate,
    cgst_amount: cgstAmount,
    sgst_rate: sgstRate,
    sgst_amount: sgstAmount,
    igst_rate: igstRate,
    igst_amount: igstAmount,
    cess_amount: cessAmount,
    total_tax: round2(tax + cessAmount),
    total_amount: total,
  };
}

export function calculateInvoiceTotals(
  calculatedLines: CalculatedLineResult[],
  billDiscountPercent: number = 0,
  billDiscountAmount: number = 0
): InvoiceTotalsResult {
  let subtotal = 0;
  let taxableSubtotal = 0;
  let lineDiscountTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;
  let cessTotal = 0;

  for (const line of calculatedLines) {
    subtotal = round2(subtotal + line.gross_amount);
    taxableSubtotal = round2(taxableSubtotal + line.taxable_amount);
    lineDiscountTotal = round2(lineDiscountTotal + line.discount_amount);
    cgstTotal = round2(cgstTotal + line.cgst_amount);
    sgstTotal = round2(sgstTotal + line.sgst_amount);
    igstTotal = round2(igstTotal + line.igst_amount);
    cessTotal = round2(cessTotal + line.cess_amount);
  }

  // Bill-level discount
  let computedBillDiscount = 0;
  if (billDiscountAmount > 0) {
    computedBillDiscount = round2(Math.min(subtotal - lineDiscountTotal, billDiscountAmount));
  } else if (billDiscountPercent > 0) {
    const netBeforeBillDiscount = Math.max(0, subtotal - lineDiscountTotal);
    computedBillDiscount = round2(netBeforeBillDiscount * (billDiscountPercent / 100));
  }

  const totalTax = round2(cgstTotal + sgstTotal + igstTotal + cessTotal);
  const netBeforeRound = Math.max(
    0,
    round2(subtotal - lineDiscountTotal - computedBillDiscount + totalTax)
  );

  const roundedGrandTotal = Math.round(netBeforeRound);
  const roundOff = round2(roundedGrandTotal - netBeforeRound);

  return {
    subtotal,
    taxable_subtotal: taxableSubtotal,
    line_discount_total: lineDiscountTotal,
    bill_discount_amount: computedBillDiscount,
    total_tax: totalTax,
    cgst_total: cgstTotal,
    sgst_total: sgstTotal,
    igst_total: igstTotal,
    cess_total: cessTotal,
    net_before_round: netBeforeRound,
    round_off: roundOff,
    grand_total: roundedGrandTotal,
  };
}
