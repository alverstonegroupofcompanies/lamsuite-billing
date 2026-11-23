/**
 * LamSuite Billing — Authoritative Statutory Tax (GST) Engine
 * 
 * Rules:
 * - Integer paise arithmetic to eliminate floating-point drift.
 * - Strict order of operations: line gross -> line discount -> proportional bill discount allocation -> taxable
 *   value -> tax -> supplier bill charges (per-charge tax + add-to-cost spread) -> round-off.
 * - CGST + SGST for intra-state, IGST for inter-state, separate Central Cess.
 * - Section 170 whole-rupee round-off.
 * - Guarantees sum of lines == document totals to the exact paisa.
 */

export type CompanyTaxMode = "inclusive" | "exclusive";

export type GstType = "regular" | "composition" | "no_tax" | "unregistered";

export type RateBasis = "sel_rate" | "mrp" | "ptr" | "pts" | "ptss" | "loose_rate" | "cost_price";

export type ChargeTreatment = "add_to_cost" | "expense";

export type ChargeSpreadMethod = "value" | "quantity" | "weight";

export type ChargeItcEligibility = "eligible" | "blocked" | "ineligible" | "partial";

export type SpreadBasis = "value" | "quantity" | "weight" | "none";

export type ChargeSpreadFallback = "missing_weight";

export interface TaxEngineLineInput {
  line_id?: string;
  product_id?: string;
  product_name?: string;
  hsn_code?: string;
  qty: number;
  loose_qty?: number;
  free_qty?: number;
  /** Free loose units (in addition to free packs in free_qty). */
  free_loose_qty?: number;
  units_per_pack?: number;
  unit_price: number;
  mrp?: number;
  rate_basis?: RateBasis;
  discount_percent?: number;
  discount_amount?: number;
  gst_percent: number;
  cess_percent?: number;
  /** Total chargeable weight entered for this line at purchase (CR-C D1). */
  gross_weight_kg?: number | string | null;
  is_tax_inclusive?: boolean;
}

export interface TaxEngineChargeInput {
  charge_id?: string;
  head_code?: string;
  head_name?: string;
  sac_code?: string;
  note?: string | null;
  amount: number;
  gst_percent: number;
  gst_rate?: number;
  cess_percent?: number;
  cess_rate?: number;
  treatment?: ChargeTreatment;
  spread_method?: ChargeSpreadMethod;
  itc_eligibility?: ChargeItcEligibility;
  is_rcm?: boolean;
  paid_separately?: boolean;
  /**
   * CR-C-11: the payable membership a posted charge was billed under. Only a reversal supplies
   * it — it inherits the original line's stored answer — so a policy flip cannot make a debit
   * note credit money the bill it returns never billed. Client payloads never reach this field.
   */
  in_payable?: boolean;
  paid_to_label?: string | null;
}

export interface TaxEngineChargeAllocation {
  line_id?: string;
  product_id?: string;
  product_name?: string;
  allocated_amount: number;
  is_remainder_paisa: boolean;
}

export interface TaxEngineCalculatedCharge {
  charge_id?: string;
  head_code?: string;
  head_name?: string;
  sac_code?: string | null;
  note?: string | null;
  amount: number;
  treatment: ChargeTreatment;
  spread_method: ChargeSpreadMethod;
  spread_basis_used: SpreadBasis;
  spread_fallback_reason: ChargeSpreadFallback | null;
  lines_without_weight: string[];
  gst_rate: number;
  cgst_rate: number;
  sgst_rate: number;
  igst_rate: number;
  cess_rate: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount: number;
  total_tax: number;
  total_amount: number;
  itc_eligibility: ChargeItcEligibility;
  creditable_tax: number;
  non_creditable_tax: number;
  is_rcm: boolean;
  paid_separately: boolean;
  paid_to_label: string | null;
  in_payable: boolean;
  expense_posting: number;
  allocations: TaxEngineChargeAllocation[];
}

export interface TaxEngineDocumentInput {
  store_state: string;
  customer_gstin?: string | null;
  place_of_supply?: string | null;
  default_tax_mode?: CompanyTaxMode;
  is_composition?: boolean;
  gst_type?: GstType;
  lines: TaxEngineLineInput[];
  bill_discount?: { type: "percent" | "amount"; value: number };
  charges?: TaxEngineChargeInput[];
  /**
   * CR-C-11 / PUR-016: this store bills a separately-paid charge into what the supplier is owed.
   * Off by default, so a charge paid to someone other than the supplier stays out of the payable.
   */
  separately_paid_in_payable?: boolean;
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
  free_loose_qty?: number;
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
  charge_allocation?: number;
  landed_amount?: number;
  landed_unit_cost?: number;
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
  charge_taxable_total: number;
  charge_tax_total: number;
  charge_total: number;
  separate_charge_taxable_total: number;
  separate_charge_tax_total: number;
  separate_charge_total: number;
  landed_cost_addition: number;
  expense_charge_total: number;
  creditable_input_tax_total: number;
  non_creditable_tax_total: number;
  reconciliation_identity_delta: number;
  is_inter_state: boolean;
  store_state: string;
  place_of_supply: string;
  is_composition: boolean;
  gst_type: GstType;
  document_title: "Tax Invoice" | "Bill of Supply";
  lines: TaxEngineCalculatedLine[];
  charges: TaxEngineCalculatedCharge[];
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
 * Rounds half away from zero. Math.round() sends .5 toward +infinity, so both engine
 * tiers must route signed rounding through this rule to stay paisa-identical.
 */
export function roundSigned(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** The CGST half of a signed GST amount; the caller takes the residue as SGST. */
export function halfUpSigned(paise: number): number {
  return paise < 0 ? -Math.round(-paise / 2) : Math.round(paise / 2);
}

/**
 * Largest-remainder paisa split: exact quotients first, then each leftover paisa to the
 * line with the largest fractional part, ties broken by grid order.
 */
export function allocateByBasis(
  amountAbsPaise: number,
  basis: number[]
): { allocations: number[]; recipients: boolean[] } {
  const count = basis.length;
  const allocations: number[] = new Array(count).fill(0);
  const recipients: boolean[] = new Array(count).fill(false);

  if (count === 0 || amountAbsPaise === 0) {
    return { allocations, recipients };
  }

  const totalBasis = basis.reduce((s, b) => s + b, 0);
  if (totalBasis <= 0) {
    // A degenerate basis (every line worth 0) still has to place the whole amount,
    // otherwise Sum(allocations) != charge value and the identity breaks.
    allocations[0] = amountAbsPaise;
    recipients[0] = true;
    return { allocations, recipients };
  }

  const fractions: number[] = [];
  let distributed = 0;
  for (let i = 0; i < count; i++) {
    const exact = (amountAbsPaise * Number(basis[i])) / totalBasis;
    const quotient = Math.floor(exact);
    allocations[i] = quotient;
    fractions[i] = exact - quotient;
    distributed += quotient;
  }

  let remainder = amountAbsPaise - distributed;
  const order = allocations.map((_, i) => i);
  order.sort((a, b) => (fractions[a] === fractions[b] ? a - b : fractions[b] - fractions[a]));

  for (const index of order) {
    if (remainder <= 0) break;
    allocations[index] += 1;
    recipients[index] = true;
    remainder -= 1;
  }

  return { allocations, recipients };
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
  const gstType: GstType = input.gst_type || (input.is_composition ? "composition" : "regular");
  const isComposition = Boolean(input.is_composition) || gstType === "composition" || gstType === "no_tax" || gstType === "unregistered";
  const documentTitle: "Tax Invoice" | "Bill of Supply" = isComposition ? "Bill of Supply" : "Tax Invoice";

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
    const freeLoose = Math.max(0, Number((line as any).free_loose_qty) || 0);
    const upp = Math.max(1, Math.round(Number(line.units_per_pack) || 1));
    const billedUnits = packs * upp + loose;
    const freeUnits = free * upp + freeLoose;
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

    // A line's discount is described by a percent, an amount, or — the defect this
    // guards — both. A till that sends a percent plus the amount it produced is
    // naming one discount twice, so it must come off once; a purchase line carries
    // a trade percent *and* a separate scheme amount, and dropping either would
    // bill the line above what the supplier charged. The paisa tell them apart: an
    // echo of the percent equals it, a second discount does not.
    let lineDiscPaise = 0;
    if (grossPaise > 0) {
      const pct = Math.min(100, Math.max(0, Number(line.discount_percent) || 0));
      const flat = Math.max(0, Number(line.discount_amount) || 0);
      const pctPaise = pct > 0 ? Math.min(grossPaise, Math.round((grossPaise * pct) / 100)) : 0;
      const flatPaise = flat > 0 ? Math.min(grossPaise, toPaise(flat)) : 0;
      lineDiscPaise =
        pctPaise > 0 && flatPaise > 0 && Math.abs(pctPaise - flatPaise) <= 1
          ? pctPaise
          : Math.min(grossPaise, pctPaise + flatPaise);
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
  const lineTaxablePaiseList: number[] = [];
  const lineTotalUnitsList: number[] = [];
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
      // Split the GST amount of the line; rounding each half off the taxable base can drop a
      // paisa, and on inclusive lines that breaks taxable + tax === discountedBasePaise.
      cgstPaise = Math.round(gstPaise / 2);
      sgstPaise = gstPaise - cgstPaise;
    }

    const totalTaxPaise = cgstPaise + sgstPaise + igstPaise + cessPaise;
    const lineTotalPaise = taxablePaise + totalTaxPaise;

    taxableSubtotalPaise += taxablePaise;
    lineTaxablePaiseList.push(taxablePaise);
    lineTotalUnitsList.push(pl.totalUnits);
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
      free_loose_qty: pl.lineInput.free_loose_qty || 0,
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

  // 4. Purchase charges (CR-C): each charge is taxed by this same engine, then an
  //    add-to-cost charge is spread across this bill's item lines in whole paisa.
  const goodsTotalTaxPaise = cgstTotalPaise + sgstTotalPaise + igstTotalPaise + cessTotalPaise;
  const chargeCount = preLines.length;
  const lineChargeAllocPaise: number[] = new Array(chargeCount).fill(0);
  const calculatedCharges: TaxEngineCalculatedCharge[] = [];
  const chargeSacMap = new Map<string, {
    hsn: string;
    rate: number;
    cessRate: number;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    cessPaise: number;
  }>();

  let chargeTaxablePayablePaise = 0;
  let chargeTaxPayablePaise = 0;
  let chargeTotalPayablePaise = 0;
  let separateChargeTaxablePaise = 0;
  let separateChargeTaxPaise = 0;
  let separateChargeTotalPaise = 0;
  let landedCostAdditionPaise = 0;
  let expenseChargeTotalPaise = 0;
  let chargeCreditableTaxPaise = 0;
  let chargeNonCreditableTaxPaise = 0;

  // A separately-paid charge is normally outside what the supplier is owed. A store may instead
  // bill it into the payable — its supplier's printed bill includes it — and then it joins the
  // goods money exactly like any other charge (CR-C-11).
  const separatelyPaidInPayable = Boolean(input.separately_paid_in_payable);

  for (const charge of input.charges || []) {
    const taxablePaise = toPaise(charge.amount);
    const sign = taxablePaise < 0 ? -1 : 1;
    const gstPercent = isComposition ? 0 : Math.max(0, Number(charge.gst_percent ?? charge.gst_rate) || 0);
    const cessPercent = isComposition ? 0 : Math.max(0, Number(charge.cess_percent ?? charge.cess_rate) || 0);

    const gstPaise = gstPercent > 0 ? sign * roundSigned((Math.abs(taxablePaise) * gstPercent) / 100) : 0;
    const cessPaise = cessPercent > 0 ? sign * roundSigned((Math.abs(taxablePaise) * cessPercent) / 100) : 0;

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
      cgstPaise = halfUpSigned(gstPaise);
      sgstPaise = gstPaise - cgstPaise;
    }

    const totalTaxPaise = cgstPaise + sgstPaise + igstPaise + cessPaise;
    const totalAmountPaise = taxablePaise + totalTaxPaise;

    const treatment: ChargeTreatment = charge.treatment === "expense" ? "expense" : "add_to_cost";
    const paidSeparately = Boolean(charge.paid_separately);
    // A reversal line carries the answer the bill it gives back was posted under, so it keeps that
    // membership instead of today's policy — a policy flip must not make a debit note credit money
    // the original bill never billed (PUR-016).
    const inPayable =
      charge.in_payable === undefined
        ? !paidSeparately || separatelyPaidInPayable
        : Boolean(charge.in_payable);
    const isCreditable = (charge.itc_eligibility || "eligible") === "eligible";
    const creditableTaxPaise = isCreditable ? totalTaxPaise : 0;
    const nonCreditableTaxPaise = isCreditable ? 0 : totalTaxPaise;
    // An expensed charge posts ex-GST, plus the tax that can never be claimed back,
    // so a blocked head cannot make value vanish from the books.
    const expensePostingPaise = treatment === "expense" ? taxablePaise + nonCreditableTaxPaise : 0;

    const spreadMethod: ChargeSpreadMethod = charge.spread_method || "value";
    let spreadBasisUsed: SpreadBasis = "none";
    let spreadFallbackReason: ChargeSpreadFallback | null = null;
    const linesWithoutWeight: string[] = [];
    const allocations: TaxEngineChargeAllocation[] = [];

    if (treatment === "add_to_cost" && chargeCount > 0) {
      // Non-creditable tax cannot be claimed back, so it is capitalised with the charge.
      const spreadAmountPaise = taxablePaise + nonCreditableTaxPaise;
      let basis: number[] = [];
      if (spreadMethod === "weight") {
        let hasWeightForAll = true;
        for (let i = 0; i < chargeCount; i++) {
          const weight = preLines[i].lineInput.gross_weight_kg;
          if (weight === undefined || weight === null || weight === "" || Number(weight) <= 0) {
            hasWeightForAll = false;
            linesWithoutWeight.push(preLines[i].lineInput.line_id || `L${i + 1}`);
          }
          basis.push(Math.max(0, Number(weight) || 0));
        }
        if (hasWeightForAll) {
          spreadBasisUsed = "weight";
        } else {
          // A mixed basis is forbidden: the whole charge falls back to value.
          spreadBasisUsed = "value";
          spreadFallbackReason = "missing_weight";
          basis = lineTaxablePaiseList;
        }
      } else if (spreadMethod === "quantity") {
        spreadBasisUsed = "quantity";
        basis = lineTotalUnitsList;
      } else {
        spreadBasisUsed = "value";
        basis = lineTaxablePaiseList;
      }

      const split = allocateByBasis(Math.abs(spreadAmountPaise), basis);
      for (let i = 0; i < chargeCount; i++) {
        const allocPaise = sign * split.allocations[i];
        lineChargeAllocPaise[i] += allocPaise;
        landedCostAdditionPaise += allocPaise;
        allocations.push({
          line_id: preLines[i].lineInput.line_id,
          product_id: preLines[i].lineInput.product_id,
          product_name: preLines[i].lineInput.product_name,
          allocated_amount: fromPaise(allocPaise),
          is_remainder_paisa: split.recipients[i],
        });
      }
    }

    if (inPayable) {
      chargeTaxablePayablePaise += taxablePaise;
      chargeTaxPayablePaise += totalTaxPaise;
      chargeTotalPayablePaise += totalAmountPaise;
      cgstTotalPaise += cgstPaise;
      sgstTotalPaise += sgstPaise;
      igstTotalPaise += igstPaise;
      cessTotalPaise += cessPaise;

      const sac = (charge.sac_code || "996799").trim();
      // Prefixed key so a charge can never merge into a goods row of the same code.
      const sacKey = `SAC_${sac}_${gstPercent}_${cessPercent}`;
      if (!chargeSacMap.has(sacKey)) {
        chargeSacMap.set(sacKey, {
          hsn: sac,
          rate: gstPercent,
          cessRate: cessPercent,
          taxablePaise: 0,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 0,
          cessPaise: 0,
        });
      }
      const sacRec = chargeSacMap.get(sacKey)!;
      sacRec.taxablePaise += taxablePaise;
      sacRec.cgstPaise += cgstPaise;
      sacRec.sgstPaise += sgstPaise;
      sacRec.igstPaise += igstPaise;
      sacRec.cessPaise += cessPaise;
    } else {
      separateChargeTaxablePaise += taxablePaise;
      separateChargeTaxPaise += totalTaxPaise;
      separateChargeTotalPaise += totalAmountPaise;
    }

    expenseChargeTotalPaise += expensePostingPaise;
    chargeCreditableTaxPaise += creditableTaxPaise;
    chargeNonCreditableTaxPaise += nonCreditableTaxPaise;

    calculatedCharges.push({
      charge_id: charge.charge_id,
      head_code: charge.head_code,
      head_name: charge.head_name,
      sac_code: charge.sac_code ?? null,
      note: charge.note ?? null,
      amount: fromPaise(taxablePaise),
      treatment,
      spread_method: spreadMethod,
      spread_basis_used: spreadBasisUsed,
      spread_fallback_reason: spreadFallbackReason,
      lines_without_weight: linesWithoutWeight,
      gst_rate: gstPercent,
      cgst_rate: cgstRate,
      sgst_rate: sgstRate,
      igst_rate: igstRate,
      cess_rate: cessPercent,
      taxable_amount: fromPaise(taxablePaise),
      cgst_amount: fromPaise(cgstPaise),
      sgst_amount: fromPaise(sgstPaise),
      igst_amount: fromPaise(igstPaise),
      cess_amount: fromPaise(cessPaise),
      total_tax: fromPaise(totalTaxPaise),
      total_amount: fromPaise(totalAmountPaise),
      itc_eligibility: charge.itc_eligibility || "eligible",
      creditable_tax: fromPaise(creditableTaxPaise),
      non_creditable_tax: fromPaise(nonCreditableTaxPaise),
      is_rcm: Boolean(charge.is_rcm),
      paid_separately: paidSeparately,
      paid_to_label: charge.paid_to_label ?? null,
      in_payable: inPayable,
      expense_posting: fromPaise(expensePostingPaise),
      allocations,
    });
  }

  for (let i = 0; i < calculatedLines.length; i++) {
    const allocPaise = lineChargeAllocPaise[i] || 0;
    const landedPaise = lineTaxablePaiseList[i] + allocPaise;
    const units = Number(calculatedLines[i].total_units) || 0;
    // PUR-002: free goods absorb their share of the charge, so the effective unit
    // cost and the landed unit cost are the same number.
    const perUnit = units > 0 ? fromPaise(roundSigned(landedPaise / units)) : 0;
    calculatedLines[i].charge_allocation = fromPaise(allocPaise);
    calculatedLines[i].landed_amount = fromPaise(landedPaise);
    calculatedLines[i].landed_unit_cost = perUnit;
    calculatedLines[i].effective_unit_cost = perUnit;
  }

  // 5. Document Level Rounding (Section 170)
  const totalTaxAllPaise = cgstTotalPaise + sgstTotalPaise + igstTotalPaise + cessTotalPaise;
  const netBeforeRoundPaise = taxableSubtotalPaise + chargeTaxablePayablePaise + totalTaxAllPaise;

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

  // 6. Build HSN/SAC Summary
  const hsnSummary: TaxHsnSummaryItem[] = Array.from([...hsnMap.values(), ...chargeSacMap.values()]).map((h) => {
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
    charge_taxable_total: fromPaise(chargeTaxablePayablePaise),
    charge_tax_total: fromPaise(chargeTaxPayablePaise),
    charge_total: fromPaise(chargeTotalPayablePaise),
    separate_charge_taxable_total: fromPaise(separateChargeTaxablePaise),
    separate_charge_tax_total: fromPaise(separateChargeTaxPaise),
    separate_charge_total: fromPaise(separateChargeTotalPaise),
    landed_cost_addition: fromPaise(landedCostAdditionPaise),
    expense_charge_total: fromPaise(expenseChargeTotalPaise),
    creditable_input_tax_total: fromPaise(goodsTotalTaxPaise + chargeCreditableTaxPaise),
    non_creditable_tax_total: fromPaise(chargeNonCreditableTaxPaise),
    reconciliation_identity_delta: fromPaise(
      taxableSubtotalPaise +
      landedCostAdditionPaise +
      expenseChargeTotalPaise +
      goodsTotalTaxPaise +
      chargeCreditableTaxPaise -
      netBeforeRoundPaise -
      separateChargeTotalPaise
    ),
    net_before_round: fromPaise(netBeforeRoundPaise),
    round_off: fromPaise(roundOffPaise),
    grand_total: fromPaise(grandTotalPaise),
    is_inter_state: isInterState,
    store_state: storeState,
    place_of_supply: posState,
    is_composition: isComposition,
    gst_type: gstType,
    document_title: documentTitle,
    lines: calculatedLines,
    charges: calculatedCharges,
    hsn_summary: hsnSummary,
  };
}
