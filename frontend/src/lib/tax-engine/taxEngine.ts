/**
 * LamSuite Billing — Authoritative Statutory Tax (GST) Engine
 * 
 * Rules:
 * - Integer paise arithmetic to eliminate floating-point drift.
 * - Strict order of operations: line gross -> line discount -> proportional bill discount allocation -> taxable value -> tax.
 * - CGST + SGST for intra-state, IGST for inter-state, separate Central Cess.
 * - Section 170 whole-rupee round-off.
 * - Guarantees sum of lines == document totals to the exact paisa.
 */

export type CompanyTaxMode = "inclusive" | "exclusive";

export type RateBasis = "sel_rate" | "mrp" | "ptr" | "pts" | "ptss" | "loose_rate" | "cost_price";

export interface TaxEngineLineInput {
  line_id?: string;
  product_id?: string;
  product_name?: string;
  hsn_code?: string;
  qty: number;
  loose_qty?: number;
  free_qty?: number;
  units_per_pack?: number;
  unit_price: number;
  mrp?: number;
  rate_basis?: RateBasis;
  discount_percent?: number;
  discount_amount?: number;
  gst_percent: number;
  cess_percent?: number;
  is_tax_inclusive?: boolean;
}

export interface TaxEngineDocumentInput {
  store_state: string;
  customer_gstin?: string | null;
  place_of_supply?: string | null;
  default_tax_mode?: CompanyTaxMode;
  is_composition?: boolean;
  lines: TaxEngineLineInput[];
  bill_discount?: { type: "percent" | "amount"; value: number };
  auto_round_off?: boolean;
  manual_round_off?: number | null;
  rounding_mode?: "per_line" | "per_invoice";
}

export interface TaxEngineCalculatedLine {
  line_id?: string;
  product_id?: string;
  product_name?: string;
  hsn_code?: string;
  qty: number;
  loose_qty: number;
  free_qty: number;
  units_per_pack: number;
  billed_units: number;
  free_units: number;
  total_units: number;
  unit_price: number;
  rate_basis: RateBasis;
  is_tax_inclusive: boolean;
  gross_amount: number;
  line_discount: number;
  allocated_bill_discount: number;
  taxable_amount: number;
  gst_rate: number;
  cgst_rate: number;
  cgst_amount: number;
  sgst_rate: number;
  sgst_amount: number;
  igst_rate: number;
  igst_amount: number;
  cess_rate: number;
  cess_amount: number;
  total_tax: number;
  total_amount: number;
  effective_unit_cost?: number;
}

export interface TaxHsnSummaryItem {
  hsn_code: string;
  gst_rate: number;
  taxable_value: number;
  cgst_rate: number;
  cgst_amount: number;
  sgst_rate: number;
  sgst_amount: number;
  igst_rate: number;
  igst_amount: number;
  cess_rate: number;
  cess_amount: number;
  total_tax: number;
  total_amount: number;
}

export interface TaxEngineDocumentTotals {
  gross_subtotal: number;
  line_discount_total: number;
  bill_discount_total: number;
  taxable_subtotal: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  cess_total: number;
  total_tax: number;
  net_before_round: number;
  round_off: number;
  grand_total: number;
  is_inter_state: boolean;
  store_state: string;
  place_of_supply: string;
  lines: TaxEngineCalculatedLine[];
  hsn_summary: TaxHsnSummaryItem[];
}

export function toPaise(amount: number): number {
  return Math.round((Number(amount) || 0) * 100);
}

export function fromPaise(paise: number): number {
  return Math.round(paise) / 100;
}

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function cleanStateCode(val?: string | null, fallback = "32"): string {
  if (!val) return fallback;
  const str = String(val).trim();
  const match = str.match(/^\d{2}/);
  return match ? match[0] : fallback;
}

export function isGstInclusive(
  rateBasis?: RateBasis,
  defaultTaxMode: CompanyTaxMode = "inclusive",
  explicitInclusive?: boolean
): boolean {
  if (explicitInclusive !== undefined && explicitInclusive !== null) {
    return explicitInclusive;
  }
  if (rateBasis === "mrp") return true;
  if (rateBasis === "ptr" || rateBasis === "pts" || rateBasis === "ptss") return false;
  return defaultTaxMode === "inclusive";
}

/**
 * Calculates a full document (all lines, discounts, taxes, round-off, and HSN summary)
 * in pure integer paise.
 */
export function calculateDocumentTaxes(input: TaxEngineDocumentInput): TaxEngineDocumentTotals {
  const storeState = cleanStateCode(input.store_state, "32");
  let posState = storeState;

  if (input.customer_gstin && input.customer_gstin.trim().length >= 2) {
    posState = cleanStateCode(input.customer_gstin.trim(), storeState);
  } else if (input.place_of_supply && input.place_of_supply.trim().length >= 2) {
    posState = cleanStateCode(input.place_of_supply.trim(), storeState);
  }

  const isInterState = storeState !== posState;
  const defaultTaxMode = input.default_tax_mode || "inclusive";
  const isComposition = Boolean(input.is_composition);

  // 1. Calculate Gross and Line Discounts per line
  interface PreLine {
    lineInput: TaxEngineLineInput;
    packs: number;
    loose: number;
    free: number;
    upp: number;
    billedUnits: number;
    freeUnits: number;
    totalUnits: number;
    unitPricePaise: number;
    rateBasis: RateBasis;
    isInclusive: boolean;
    grossPaise: number;
    lineDiscPaise: number;
    lineNetBasePaise: number;
  }

  const preLines: PreLine[] = [];
  let sumNetBasePaise = 0;
  let grossSubtotalPaise = 0;
  let lineDiscountTotalPaise = 0;

  for (const line of input.lines) {
    const packs = Math.max(0, Number((line as any).qty ?? (line as any).pack_qty) || 0);
    const loose = Math.max(0, Number(line.loose_qty) || 0);
    const free = Math.max(0, Number((line as any).free_qty ?? (line as any).free_pack_qty) || 0);
    const upp = Math.max(1, Math.round(Number(line.units_per_pack) || 1));
    const billedUnits = packs * upp + loose;
    const freeUnits = free * upp;
    const totalUnits = billedUnits + freeUnits;

    const unitPricePaise = toPaise(line.unit_price);
    const rateBasis: RateBasis = line.rate_basis || "sel_rate";
    const inclusive = isGstInclusive(rateBasis, defaultTaxMode, line.is_tax_inclusive);

    let grossPaise = 0;
    if (rateBasis === "loose_rate") {
      grossPaise = Math.round(billedUnits * (unitPricePaise / 100) * 100);
    } else {
      const packGrossPaise = Math.round(packs * unitPricePaise);
      const looseGrossPaise = loose > 0 ? Math.round((loose * unitPricePaise) / upp) : 0;
      grossPaise = packGrossPaise + looseGrossPaise;
    }

    let lineDiscPaise = 0;
    if (grossPaise > 0) {
      const pctDiscPaise = Number(line.discount_percent) > 0
        ? Math.round((grossPaise * Number(line.discount_percent)) / 100)
        : 0;
      const flatDiscPaise = Number(line.discount_amount) > 0
        ? toPaise(Number(line.discount_amount))
        : 0;
      lineDiscPaise = Math.min(grossPaise, pctDiscPaise + flatDiscPaise);
    }

    const lineNetBasePaise = Math.max(0, grossPaise - lineDiscPaise);
    sumNetBasePaise += lineNetBasePaise;
    grossSubtotalPaise += grossPaise;
    lineDiscountTotalPaise += lineDiscPaise;

    preLines.push({
      lineInput: line,
      packs,
      loose,
      free,
      upp,
      billedUnits,
      freeUnits,
      totalUnits,
      unitPricePaise,
      rateBasis,
      isInclusive: inclusive,
      grossPaise,
      lineDiscPaise,
      lineNetBasePaise,
    });
  }

  // 2. Allocate Bill-Level Discount Proportionally
  let totalBillDiscPaise = 0;
  if (input.bill_discount && input.bill_discount.value > 0 && sumNetBasePaise > 0) {
    if (input.bill_discount.type === "percent") {
      totalBillDiscPaise = Math.round((sumNetBasePaise * Math.min(100, Math.max(0, input.bill_discount.value))) / 100);
    } else {
      totalBillDiscPaise = Math.min(sumNetBasePaise, toPaise(input.bill_discount.value));
    }
  }

  // Proportional allocation of bill discount across lines
  const allocatedBillDiscList: number[] = new Array(preLines.length).fill(0);
  let distributedBillDiscPaise = 0;
  let maxNetBaseIdx = 0;
  let maxNetBaseVal = -1;

  if (totalBillDiscPaise > 0 && sumNetBasePaise > 0) {
    for (let i = 0; i < preLines.length; i++) {
      const lineNet = preLines[i].lineNetBasePaise;
      if (lineNet > maxNetBaseVal) {
        maxNetBaseVal = lineNet;
        maxNetBaseIdx = i;
      }
      const alloc = Math.round((totalBillDiscPaise * lineNet) / sumNetBasePaise);
      allocatedBillDiscList[i] = alloc;
      distributedBillDiscPaise += alloc;
    }

    // Allocate any rounding difference to the largest base line item
    const remainder = totalBillDiscPaise - distributedBillDiscPaise;
    if (remainder !== 0 && maxNetBaseIdx >= 0) {
      allocatedBillDiscList[maxNetBaseIdx] += remainder;
    }
  }

  // 3. Calculate Taxable Amount, Taxes, and Line Totals
  const calculatedLines: TaxEngineCalculatedLine[] = [];
  let taxableSubtotalPaise = 0;
  let cgstTotalPaise = 0;
  let sgstTotalPaise = 0;
  let igstTotalPaise = 0;
  let cessTotalPaise = 0;

  const hsnMap = new Map<string, {
    hsn: string;
    rate: number;
    cessRate: number;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    cessPaise: number;
  }>();

  for (let i = 0; i < preLines.length; i++) {
    const pl = preLines[i];
    const allocDiscPaise = allocatedBillDiscList[i];
    const discountedBasePaise = Math.max(0, pl.lineNetBasePaise - allocDiscPaise);

    const gstPercent = isComposition ? 0 : Math.max(0, Number(pl.lineInput.gst_percent ?? (pl.lineInput as any).gst_rate) || 0);
    const cessPercent = isComposition ? 0 : Math.max(0, Number(pl.lineInput.cess_percent ?? (pl.lineInput as any).cess_rate) || 0);
    const combinedRate = gstPercent + cessPercent;

    let taxablePaise = 0;
    let gstPaise = 0;
    let cessPaise = 0;

    if (pl.isInclusive) {
      if (combinedRate > 0) {
        taxablePaise = Math.round(discountedBasePaise / (1 + combinedRate / 100));
        const totalTaxPaise = Math.max(0, discountedBasePaise - taxablePaise);
        if (cessPercent > 0) {
          cessPaise = Math.round((taxablePaise * cessPercent) / 100);
          gstPaise = Math.max(0, totalTaxPaise - cessPaise);
        } else {
          cessPaise = 0;
          gstPaise = totalTaxPaise;
        }
      } else {
        taxablePaise = discountedBasePaise;
        gstPaise = 0;
        cessPaise = 0;
      }
    } else {
      taxablePaise = discountedBasePaise;
      gstPaise = gstPercent > 0 ? Math.round((taxablePaise * gstPercent) / 100) : 0;
      cessPaise = cessPercent > 0 ? Math.round((taxablePaise * cessPercent) / 100) : 0;
    }

    let cgstRate = 0;
    let cgstPaise = 0;
    let sgstRate = 0;
    let sgstPaise = 0;
    let igstRate = 0;
    let igstPaise = 0;

    if (isInterState) {
      igstRate = gstPercent;
      igstPaise = gstPaise;
    } else {
      cgstRate = gstPercent / 2;
      sgstRate = gstPercent / 2;
      cgstPaise = Math.round((taxablePaise * cgstRate) / 100);
      sgstPaise = Math.round((taxablePaise * sgstRate) / 100);
    }

    const totalTaxPaise = cgstPaise + sgstPaise + igstPaise + cessPaise;
    const lineTotalPaise = taxablePaise + totalTaxPaise;

    taxableSubtotalPaise += taxablePaise;
    cgstTotalPaise += cgstPaise;
    sgstTotalPaise += sgstPaise;
    igstTotalPaise += igstPaise;
    cessTotalPaise += cessPaise;

    // Track HSN Summary
    const hsn = (pl.lineInput.hsn_code || "30049099").trim();
    const hsnKey = `${hsn}_${gstPercent}_${cessPercent}`;
    if (!hsnMap.has(hsnKey)) {
      hsnMap.set(hsnKey, {
        hsn,
        rate: gstPercent,
        cessRate: cessPercent,
        taxablePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        cessPaise: 0,
      });
    }
    const hsnRec = hsnMap.get(hsnKey)!;
    hsnRec.taxablePaise += taxablePaise;
    hsnRec.cgstPaise += cgstPaise;
    hsnRec.sgstPaise += sgstPaise;
    hsnRec.igstPaise += igstPaise;
    hsnRec.cessPaise += cessPaise;

    calculatedLines.push({
      line_id: pl.lineInput.line_id,
      product_id: pl.lineInput.product_id,
      product_name: pl.lineInput.product_name,
      hsn_code: pl.lineInput.hsn_code,
      qty: pl.packs,
      loose_qty: pl.loose,
      free_qty: pl.free,
      units_per_pack: pl.upp,
      billed_units: pl.billedUnits,
      free_units: pl.freeUnits,
      total_units: pl.totalUnits,
      unit_price: fromPaise(pl.unitPricePaise),
      rate_basis: pl.rateBasis,
      is_tax_inclusive: pl.isInclusive,
      gross_amount: fromPaise(pl.grossPaise),
      line_discount: fromPaise(pl.lineDiscPaise),
      allocated_bill_discount: fromPaise(allocDiscPaise),
      taxable_amount: fromPaise(taxablePaise),
      gst_rate: gstPercent,
      cgst_rate: cgstRate,
      cgst_amount: fromPaise(cgstPaise),
      sgst_rate: sgstRate,
      sgst_amount: fromPaise(sgstPaise),
      igst_rate: igstRate,
      igst_amount: fromPaise(igstPaise),
      cess_rate: cessPercent,
      cess_amount: fromPaise(cessPaise),
      total_tax: fromPaise(totalTaxPaise),
      total_amount: fromPaise(lineTotalPaise),
      effective_unit_cost: pl.totalUnits > 0 ? fromPaise(Math.round(taxablePaise / pl.totalUnits)) : 0,
    });
  }

  // 4. Document Level Rounding (Section 170)
  const totalTaxAllPaise = cgstTotalPaise + sgstTotalPaise + igstTotalPaise + cessTotalPaise;
  const netBeforeRoundPaise = taxableSubtotalPaise + totalTaxAllPaise;

  let roundOffPaise = 0;
  let grandTotalPaise = netBeforeRoundPaise;

  if (input.manual_round_off !== undefined && input.manual_round_off !== null) {
    roundOffPaise = toPaise(input.manual_round_off);
    grandTotalPaise = Math.max(0, netBeforeRoundPaise + roundOffPaise);
  } else if (input.auto_round_off !== false) {
    const roundedRupeePaise = Math.round(netBeforeRoundPaise / 100) * 100;
    roundOffPaise = roundedRupeePaise - netBeforeRoundPaise;
    grandTotalPaise = roundedRupeePaise;
  }

  // 5. Build HSN Summary
  const hsnSummary: TaxHsnSummaryItem[] = Array.from(hsnMap.values()).map((h) => {
    const totTaxP = h.cgstPaise + h.sgstPaise + h.igstPaise + h.cessPaise;
    return {
      hsn_code: h.hsn,
      gst_rate: h.rate,
      taxable_value: fromPaise(h.taxablePaise),
      cgst_rate: isInterState ? 0 : h.rate / 2,
      cgst_amount: fromPaise(h.cgstPaise),
      sgst_rate: isInterState ? 0 : h.rate / 2,
      sgst_amount: fromPaise(h.sgstPaise),
      igst_rate: isInterState ? h.rate : 0,
      igst_amount: fromPaise(h.igstPaise),
      cess_rate: h.cessRate,
      cess_amount: fromPaise(h.cessPaise),
      total_tax: fromPaise(totTaxP),
      total_amount: fromPaise(h.taxablePaise + totTaxP),
    };
  });

  return {
    gross_subtotal: fromPaise(grossSubtotalPaise),
    line_discount_total: fromPaise(lineDiscountTotalPaise),
    bill_discount_total: fromPaise(totalBillDiscPaise),
    taxable_subtotal: fromPaise(taxableSubtotalPaise),
    cgst_total: fromPaise(cgstTotalPaise),
    sgst_total: fromPaise(sgstTotalPaise),
    igst_total: fromPaise(igstTotalPaise),
    cess_total: fromPaise(cessTotalPaise),
    total_tax: fromPaise(totalTaxAllPaise),
    net_before_round: fromPaise(netBeforeRoundPaise),
    round_off: fromPaise(roundOffPaise),
    grand_total: fromPaise(grandTotalPaise),
    is_inter_state: isInterState,
    store_state: storeState,
    place_of_supply: posState,
    lines: calculatedLines,
    hsn_summary: hsnSummary,
  };
}
