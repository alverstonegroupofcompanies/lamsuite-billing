/**
 * What a return line gives back, in the money it was sold for.
 *
 * The till used to re-price a credit note at the selling rate, so five ₹6.00
 * tablets bought at MRP were refunded ₹33.60 — GST added on top of a price that
 * already included it — and the discount the line was sold with vanished. A
 * return is a reversal, so it credits a proportional share of the original line:
 * charged value, taxable value, tax components and discount. Shares are computed
 * cumulatively from the quantity returned so far and the return that closes the
 * line takes the remainder, so every paisa of the original is credited once no
 * matter how the returns were split.
 *
 * Mirrors App\Services\Sales\SalesReturnPricingService paisa for paisa.
 */

import { stateCodeOf } from "../gst/stateCodes";

export interface OriginalReturnLine {
  product_id?: string | number | null;
  batch_no?: string | number | null;
  qty?: number | string | null;
  loose_qty?: number | string | null;
  units_per_pack?: number | string | null;
  unit_price?: number | string | null;
  gst_percent?: number | string | null;
  discount_percent?: number | string | null;
  discount_amount?: number | string | null;
  taxable_amount?: number | string | null;
  cgst_amount?: number | string | null;
  sgst_amount?: number | string | null;
  igst_amount?: number | string | null;
  cess_amount?: number | string | null;
  tax_amount?: number | string | null;
  total_amount?: number | string | null;
}

export interface ReturnCredit {
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount: number;
  tax_amount: number;
  total_amount: number;
  discount_amount: number;
}

export interface ReturnCreditTotals {
  subtotal: number;
  taxable_subtotal: number;
  discount_total: number;
  tax_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  cess_total: number;
  round_off: number;
  grand_total: number;
}

const paise = (value: number | string | null | undefined): number =>
  Math.round((Number(value) || 0) * 100);

const rupees = (value: number): number => Math.round(value) / 100;

/** Base units of a quantity line: packs times units-per-pack, plus loose units. */
export function returnBaseUnits(
  qty: number | string | null | undefined,
  looseQty: number | string | null | undefined,
  unitsPerPack: number | string | null | undefined
): number {
  const upp = Math.max(1, Math.round(Number(unitsPerPack) || 1));
  return Math.max(0, Number(qty) || 0) * upp + Math.max(0, Number(looseQty) || 0);
}

const EMPTY_CREDIT: ReturnCredit = {
  taxable_amount: 0,
  cgst_amount: 0,
  sgst_amount: 0,
  igst_amount: 0,
  cess_amount: 0,
  tax_amount: 0,
  total_amount: 0,
  discount_amount: 0,
};

/** A line's share of a total, in paise, for `base` units out of `sold`. */
function share(originalPaise: number, base: number, sold: number): number {
  return Math.round((originalPaise * base) / sold);
}

/**
 * The component's share of the tax returned so far, less what earlier returns
 * already credited. The closing return hands over everything left.
 */
function componentShare(
  original: number,
  originalTax: number,
  cumTax: number,
  priorTax: number,
  closing: boolean
): number {
  if (original <= 0) return 0;
  if (originalTax <= 0) return closing ? original : 0;

  const cumComponent = closing ? original : Math.round((original * cumTax) / originalTax);
  const priorComponent = priorTax > 0 ? Math.round((original * priorTax) / originalTax) : 0;

  return Math.max(0, cumComponent - priorComponent);
}

/**
 * The credit owed for `returnBase` units of a line that sold `soldBase` units,
 * given `priorBase` units were already returned against it.
 */
export function reverseOriginalLine(
  original: OriginalReturnLine,
  soldBase: number,
  priorBase: number,
  returnBase: number,
  interState = false
): ReturnCredit {
  const sold = Math.max(0, soldBase);
  const prior = Math.max(0, Math.min(priorBase, sold));
  const returned = Math.max(0, returnBase);

  if (sold <= 0 || returned <= 0) return { ...EMPTY_CREDIT };

  const cumBase = Math.min(sold, prior + returned);
  const closing = cumBase >= sold - 0.0001;

  let origTotal = paise(original.total_amount);
  let origTaxable = paise(original.taxable_amount);
  const origDiscount = paise(original.discount_amount);

  let origCgst = paise(original.cgst_amount);
  let origSgst = paise(original.sgst_amount);
  let origIgst = paise(original.igst_amount);
  let origCess = paise(original.cess_amount);

  // A line stored before the component columns existed still carries what the
  // customer paid and what the shelf price tax was; rebuild the split.
  if (origTotal <= 0 && origTaxable > 0) {
    origTotal = origTaxable + origCgst + origSgst + origIgst + origCess;
  }

  let origTax = origTotal - origTaxable;

  if (origTax <= 0 && origCgst + origSgst + origIgst + origCess > 0) {
    origTax = origCgst + origSgst + origIgst + origCess;
    origTaxable = origTotal - origTax;
  }

  if (origTax <= 0) {
    origTax = 0;
    origTaxable = origTotal;
  }

  if (origCgst + origSgst + origIgst + origCess <= 0 && origTax > 0) {
    if (interState) {
      origIgst = origTax;
    } else {
      origCgst = Math.round(origTax / 2);
      origSgst = origTax - origCgst;
    }
  }

  const cumTotal = closing ? origTotal : share(origTotal, cumBase, sold);
  const priorTotal = prior > 0 ? share(origTotal, prior, sold) : 0;
  const cumDiscount = closing ? origDiscount : share(origDiscount, cumBase, sold);
  const priorDiscount = prior > 0 ? share(origDiscount, prior, sold) : 0;

  // taxable = charged value / (1 + the line's own effective rate), so a part
  // return of an inclusive price can never book tax the buyer never paid.
  let cumTaxable: number;
  let priorTaxable: number;
  if (origTaxable > 0 && origTax > 0) {
    const rate = origTax / origTaxable;
    cumTaxable = closing ? origTaxable : Math.round(cumTotal / (1 + rate));
    priorTaxable = prior > 0 ? Math.round(priorTotal / (1 + rate)) : 0;
  } else {
    cumTaxable = closing ? origTaxable : share(origTaxable, cumBase, sold);
    priorTaxable = prior > 0 ? share(origTaxable, prior, sold) : 0;
  }

  const cumTax = cumTotal - cumTaxable;
  const priorTax = priorTotal - priorTaxable;

  const chunkCgst = componentShare(origCgst, origTax, cumTax, priorTax, closing);
  const chunkIgst = componentShare(origIgst, origTax, cumTax, priorTax, closing);
  const chunkCess = componentShare(origCess, origTax, cumTax, priorTax, closing);
  const chunkTax = cumTax - priorTax;
  const chunkSgst = Math.max(0, chunkTax - chunkCgst - chunkIgst - chunkCess);

  return {
    taxable_amount: rupees(cumTaxable - priorTaxable),
    cgst_amount: rupees(chunkCgst),
    sgst_amount: rupees(chunkSgst),
    igst_amount: rupees(chunkIgst),
    cess_amount: rupees(chunkCess),
    tax_amount: rupees(chunkTax),
    total_amount: rupees(cumTotal - priorTotal),
    discount_amount: rupees(cumDiscount - priorDiscount),
  };
}

/** Header figures for a document made of these credits. Never rupee-rounded. */
export function sumReturnCredits(credits: ReturnCredit[]): ReturnCreditTotals {
  const sum = (pick: (credit: ReturnCredit) => number) =>
    Math.round(credits.reduce((acc, credit) => acc + pick(credit) * 100, 0)) / 100;

  const taxable = sum((c) => c.taxable_amount);
  const tax = sum((c) => c.tax_amount);
  const discount = sum((c) => c.discount_amount);
  const total = sum((c) => c.total_amount);

  return {
    subtotal: Math.round((total + discount) * 100) / 100,
    taxable_subtotal: taxable,
    discount_total: discount,
    tax_total: tax,
    cgst_total: sum((c) => c.cgst_amount),
    sgst_total: sum((c) => c.sgst_amount),
    igst_total: sum((c) => c.igst_amount),
    cess_total: sum((c) => c.cess_amount),
    round_off: 0,
    grand_total: total,
  };
}

/** Identifies one original bill line across the whole return history. */
export const returnKey = (productId: string, batchNo: string | undefined): string =>
  `${productId}_${batchNo || ""}`;

/** A line being returned, as either return screen describes it. */
export interface ReversibleReturnLine {
  product_id: string;
  batch_no?: string;
  return_qty?: number;
  qty?: number;
  loose_qty?: number;
  units_per_pack?: number;
}

/** The bill-level facts a reversal needs, whichever invoice record holds them. */
export interface ReversibleOriginalInvoice {
  place_of_supply?: string | null;
  store_state_code?: string | null;
}

/**
 * The credit owed for every line of a return, reversed from the original invoice's
 * own line figures. Null when the bill — or one of the returned lines — is not held
 * on this till; the caller then prices the return itself, which is all it can do.
 */
export function reverseCreditsFromOriginal(
  originalInv: ReversibleOriginalInvoice | null,
  originalItems: OriginalReturnLine[],
  lines: ReversibleReturnLine[],
  returnedBaseUnits: Map<string, number>
): ReturnCredit[] | null {
  if (!originalInv || originalItems.length === 0 || lines.length === 0) return null;

  const storeCode =
    stateCodeOf(originalInv.store_state_code) ??
    stateCodeOf(originalInv.place_of_supply) ??
    "32";
  const interState = (stateCodeOf(originalInv.place_of_supply) ?? storeCode) !== storeCode;

  const credits: ReturnCredit[] = [];
  const creditedInThisReturn = new Map<string, number>();

  for (const line of lines) {
    const candidates = originalItems.filter(
      (it) => String(it.product_id) === String(line.product_id)
    );
    const originalItem =
      candidates.find((it) => line.batch_no && it.batch_no === line.batch_no) ?? candidates[0];
    if (!originalItem) return null;

    const soldBase = returnBaseUnits(
      originalItem.qty,
      originalItem.loose_qty,
      originalItem.units_per_pack
    );
    const returnBase = returnBaseUnits(
      line.return_qty ?? line.qty,
      line.loose_qty,
      line.units_per_pack
    );
    if (soldBase <= 0 || returnBase <= 0) return null;
    // An old local bill can carry quantities without money; there is nothing to
    // reverse there, and crediting zero would be worse than re-pricing the return.
    if (Number(originalItem.total_amount || 0) + Number(originalItem.taxable_amount || 0) <= 0) {
      return null;
    }

    const key = returnKey(line.product_id, line.batch_no || String(originalItem.batch_no ?? ""));
    const priorBase = (returnedBaseUnits.get(key) || 0) + (creditedInThisReturn.get(key) || 0);

    credits.push(reverseOriginalLine(originalItem, soldBase, priorBase, returnBase, interState));
    creditedInThisReturn.set(key, (creditedInThisReturn.get(key) || 0) + returnBase);
  }

  if (sumReturnCredits(credits).grand_total <= 0) return null;

  return credits;
}
