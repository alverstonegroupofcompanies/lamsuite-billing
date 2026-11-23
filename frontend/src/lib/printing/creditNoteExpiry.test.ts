import { describe, it, expect } from "vitest";
import { printingEngine, type CreditNotePrintData, type DebitNotePrintData } from "./printingEngine";

// UI-03 (G8-UI): return slips printed the expiry exactly as the server sent it,
// e.g. "Exp: 2027-03-30T18:30:00.000000Z" for a batch expiring 31-03-2027.
const SERVER_EXPIRY = "2027-03-30T18:30:00.000000Z";

const line = {
  description: "Amoxicillin 250mg",
  hsn_code: "3004",
  batch_no: "EX1",
  expiry_date: SERVER_EXPIRY,
  qty: 1,
  rate: 100,
  gst_percent: 12,
  amount: 112,
};

const totals = { subtotal: 100, tax_total: 12, round_off: 0, grand_total: 112 };

const creditNote: CreditNotePrintData = {
  return_number: "CN-EXP-1",
  return_date: "23-11-2026",
  store_name: "Expiry Pharmacy",
  customer_name: "Walk-in Customer",
  lines: [line],
  refund_mode: "cash",
  ...totals,
};

const debitNote: DebitNotePrintData = {
  return_number: "DN-EXP-1",
  return_date: "23-11-2026",
  store_name: "Expiry Pharmacy",
  supplier_name: "QA Distributors",
  lines: [line],
  settlement_type: "adjust",
  ...totals,
};

describe("Return slips print the expiry as a month/year (UI-03)", () => {
  for (const width of [80, 58] as const) {
    it(`credit note thermal ${width}mm shows Exp: 03/27`, () => {
      const html = printingEngine.generateCreditNoteThermalSlip(creditNote, width);
      expect(html).toContain("Exp: 03/27");
      expect(html).not.toContain("T18:30");
    });

    it(`debit note thermal ${width}mm shows Exp: 03/27`, () => {
      const html = printingEngine.generateDebitNoteThermalSlip(debitNote, width);
      expect(html).toContain("Exp: 03/27");
      expect(html).not.toContain("T18:30");
    });
  }
});
