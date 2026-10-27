import { sqliteStorage } from "../db/sqliteStorage";
import type { InvoiceRecord, InvoiceItemRecord } from "../reports/reportEngine";

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Validates Indian GSTIN using format regex and official Luhn Mod-36 checksum algorithm.
 */
export function validateGstinChecksum(gstin: string): { valid: boolean; reason?: string } {
  if (!gstin || typeof gstin !== "string") {
    return { valid: false, reason: "GSTIN is required" };
  }

  const clean = gstin.trim().toUpperCase();
  if (clean.length !== 15) {
    return { valid: false, reason: `Invalid GSTIN length (${clean.length} chars, expected 15)` };
  }

  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  if (!gstinRegex.test(clean)) {
    return { valid: false, reason: "GSTIN does not match standard 15-character format (State + PAN + Entity + Z + Checksum)" };
  }

  // Calculate Luhn Mod-36 checksum
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const char = clean[i];
    const codePoint = GSTIN_CHARS.indexOf(char);
    if (codePoint === -1) {
      return { valid: false, reason: `Invalid character '${char}' in GSTIN` };
    }
    const factor = (i % 2 === 0) ? 1 : 2;
    const product = codePoint * factor;
    const quotient = Math.floor(product / 36);
    const remainder = product % 36;
    sum += quotient + remainder;
  }

  const checkCode = (36 - (sum % 36)) % 36;
  const expectedChar = GSTIN_CHARS[checkCode];
  const actualChar = clean[14];

  if (expectedChar !== actualChar) {
    return {
      valid: false,
      reason: `Checksum digit mismatch: expected '${expectedChar}', got '${actualChar}'`,
    };
  }

  return { valid: true };
}

export interface TaxAnomaly {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  anomaly_type:
    | "TOTAL_MISMATCH"
    | "TAX_HEAD_MISMATCH"
    | "PLACE_OF_SUPPLY_MISMATCH"
    | "INVALID_GSTIN"
    | "STATE_CODE_MISMATCH"
    | "MISSING_HSN"
    | "INVALID_GST_RATE";
  severity: "error" | "warning";
  description: string;
  expected?: string | number;
  actual?: string | number;
}

export interface TaxReconciliationReport {
  generated_at: string;
  period: { startDate: string; endDate: string };
  total_invoices_audited: number;
  clean_invoices_count: number;
  anomalies_count: number;
  financial_summary: {
    total_taxable: number;
    total_cgst: number;
    total_sgst: number;
    total_igst: number;
    total_cess: number;
    total_tax: number;
    total_round_off: number;
    total_grand: number;
  };
  anomalies: TaxAnomaly[];
}

const STATUTORY_GST_RATES = new Set([0, 0.25, 3, 5, 12, 18, 28]);

export class TaxReconciliationService {
  /**
   * Run comprehensive statutory GST reconciliation across all invoices & items in a date range.
   */
  async runAudit(startDate: string, endDate: string, storeStateCode = "32"): Promise<TaxReconciliationReport> {
    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const allItems = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");

    const itemsByInvoice = new Map<string, InvoiceItemRecord[]>();
    for (const item of allItems) {
      if (!itemsByInvoice.has(item.invoice_id)) {
        itemsByInvoice.set(item.invoice_id, []);
      }
      itemsByInvoice.get(item.invoice_id)!.push(item);
    }

    const inRange = allInvoices.filter(
      (inv) =>
        inv.status !== "cancelled" &&
        inv.invoice_date >= startDate &&
        inv.invoice_date <= endDate
    );

    const anomalies: TaxAnomaly[] = [];

    let sumTaxable = 0;
    let sumCgst = 0;
    let sumSgst = 0;
    let sumIgst = 0;
    let sumCess = 0;
    let sumTax = 0;
    let sumRoundOff = 0;
    let sumGrand = 0;

    let cleanCount = 0;

    for (const inv of inRange) {
      const items = itemsByInvoice.get(inv.id) || [];
      const isReturn = inv.module_key === "sales_return" || inv.module_key === "credit_note";
      const sign = isReturn ? -1 : 1;

      const invGrand = Number(inv.grand_total) || 0;
      const invTax = Number(inv.tax_total) || 0;
      const invTaxable = Number(inv.taxable_subtotal ?? inv.subtotal) || 0;
      const invRoundOff = Number(inv.round_off) || 0;
      const invCgst = Number(inv.cgst_total ?? 0);
      const invSgst = Number(inv.sgst_total ?? 0);
      const invIgst = Number(inv.igst_total ?? 0);
      const invCess = Number(inv.cess_total ?? 0);

      sumTaxable += invTaxable * sign;
      sumCgst += invCgst * sign;
      sumSgst += invSgst * sign;
      sumIgst += invIgst * sign;
      sumCess += invCess * sign;
      sumTax += invTax * sign;
      sumRoundOff += invRoundOff * sign;
      sumGrand += invGrand * sign;

      let hasAnomaly = false;

      // 1. Line Sum vs Document Header Tie-out
      if (items.length > 0) {
        let lineSumTotal = 0;
        let lineSumTaxable = 0;
        let lineSumTax = 0;

        for (const item of items) {
          const lTot = Number(item.total_amount) || 0;
          const lTaxable = Number(item.taxable_amount ?? (lTot - (Number(item.cgst_amount) || 0) - (Number(item.sgst_amount) || 0) - (Number(item.igst_amount) || 0)));
          const lTax = (Number(item.cgst_amount) || 0) + (Number(item.sgst_amount) || 0) + (Number(item.igst_amount) || 0) + (Number((item as any).cess_amount) || 0);

          lineSumTotal += lTot;
          lineSumTaxable += lTaxable;
          lineSumTax += lTax;

          // HSN check
          const hsn = (item.hsn_code || "").trim();
          if (!hsn || hsn.length < 4) {
            hasAnomaly = true;
            anomalies.push({
              invoice_id: inv.id,
              invoice_number: inv.invoice_number,
              invoice_date: inv.invoice_date,
              anomaly_type: "MISSING_HSN",
              severity: "warning",
              description: `Item '${item.product_name}' has missing or incomplete HSN/SAC code ('${hsn}')`,
              expected: "Valid 4, 6 or 8-digit HSN/SAC code",
              actual: hsn || "EMPTY",
            });
          }

          // GST Rate check
          const rate = Number(item.gst_percent);
          if (!STATUTORY_GST_RATES.has(rate)) {
            hasAnomaly = true;
            anomalies.push({
              invoice_id: inv.id,
              invoice_number: inv.invoice_number,
              invoice_date: inv.invoice_date,
              anomaly_type: "INVALID_GST_RATE",
              severity: "error",
              description: `Item '${item.product_name}' has non-statutory GST rate (${rate}%)`,
              expected: "0%, 0.25%, 3%, 5%, 12%, 18%, or 28%",
              actual: `${rate}%`,
            });
          }
        }

        lineSumTotal = Math.round(lineSumTotal * 100) / 100;
        const expectedGrandWithRound = Math.round((lineSumTotal + invRoundOff) * 100) / 100;

        if (Math.abs(expectedGrandWithRound - invGrand) > 0.05) {
          hasAnomaly = true;
          anomalies.push({
            invoice_id: inv.id,
            invoice_number: inv.invoice_number,
            invoice_date: inv.invoice_date,
            anomaly_type: "TOTAL_MISMATCH",
            severity: "error",
            description: `Sum of line totals (₹${lineSumTotal}) + round-off (₹${invRoundOff}) differs from invoice grand total (₹${invGrand})`,
            expected: expectedGrandWithRound,
            actual: invGrand,
          });
        }
      }

      // 2. Place of Supply vs Tax Heads
      const posState = inv.place_of_supply ? inv.place_of_supply.slice(0, 2) : storeStateCode;
      const isInterState = posState !== storeStateCode;

      if (isInterState) {
        if (invCgst > 0 || invSgst > 0) {
          hasAnomaly = true;
          anomalies.push({
            invoice_id: inv.id,
            invoice_number: inv.invoice_number,
            invoice_date: inv.invoice_date,
            anomaly_type: "PLACE_OF_SUPPLY_MISMATCH",
            severity: "error",
            description: `Inter-state supply to State ${posState} contains Central/State GST instead of IGST`,
            expected: `IGST only (State ${posState})`,
            actual: `CGST: ₹${invCgst}, SGST: ₹${invSgst}`,
          });
        }
      } else {
        if (invIgst > 0) {
          hasAnomaly = true;
          anomalies.push({
            invoice_id: inv.id,
            invoice_number: inv.invoice_number,
            invoice_date: inv.invoice_date,
            anomaly_type: "PLACE_OF_SUPPLY_MISMATCH",
            severity: "error",
            description: `Intra-state supply within State ${storeStateCode} contains IGST instead of CGST+SGST`,
            expected: `CGST + SGST (State ${storeStateCode})`,
            actual: `IGST: ₹${invIgst}`,
          });
        }
      }

      // 3. Customer GSTIN Checksum & State Validation
      if (inv.customer_gstin && inv.customer_gstin.trim().length > 0) {
        const gstinVal = validateGstinChecksum(inv.customer_gstin);
        if (!gstinVal.valid) {
          hasAnomaly = true;
          anomalies.push({
            invoice_id: inv.id,
            invoice_number: inv.invoice_number,
            invoice_date: inv.invoice_date,
            anomaly_type: "INVALID_GSTIN",
            severity: "error",
            description: `Customer GSTIN '${inv.customer_gstin}' is invalid: ${gstinVal.reason}`,
            expected: "Valid 15-character GSTIN with Luhn-mod-36 checksum",
            actual: inv.customer_gstin,
          });
        } else {
          // Check state code matching
          const gstinState = inv.customer_gstin.trim().slice(0, 2);
          if (inv.place_of_supply && inv.place_of_supply.slice(0, 2) !== gstinState) {
            hasAnomaly = true;
            anomalies.push({
              invoice_id: inv.id,
              invoice_number: inv.invoice_number,
              invoice_date: inv.invoice_date,
              anomaly_type: "STATE_CODE_MISMATCH",
              severity: "warning",
              description: `GSTIN state code (${gstinState}) does not match invoice Place of Supply (${inv.place_of_supply})`,
              expected: `Place of Supply matching State ${gstinState}`,
              actual: inv.place_of_supply,
            });
          }
        }
      }

      if (!hasAnomaly) {
        cleanCount++;
      }
    }

    return {
      generated_at: new Date().toISOString(),
      period: { startDate, endDate },
      total_invoices_audited: inRange.length,
      clean_invoices_count: cleanCount,
      anomalies_count: anomalies.length,
      financial_summary: {
        total_taxable: Math.round(sumTaxable * 100) / 100,
        total_cgst: Math.round(sumCgst * 100) / 100,
        total_sgst: Math.round(sumSgst * 100) / 100,
        total_igst: Math.round(sumIgst * 100) / 100,
        total_cess: Math.round(sumCess * 100) / 100,
        total_tax: Math.round(sumTax * 100) / 100,
        total_round_off: Math.round(sumRoundOff * 100) / 100,
        total_grand: Math.round(sumGrand * 100) / 100,
      },
      anomalies,
    };
  }
}

export const taxReconciliationService = new TaxReconciliationService();
