import { describe, it, expect } from "vitest";
import { printingEngine } from "./printingEngine";

/**
 * CR-C Task 4.13 / PUR-009 — a printed purchase document shows the charges the supplier billed
 * besides the goods.
 *
 * The paper is what a store hands to a clerk and what an auditor keeps, so it must name every charge
 * head with the tax the engine put on it, mark the money that went to a courier rather than the
 * supplier, and foot to the same payable the bill posted with — to the paisa, or the document is a
 * second, contradictory answer about the same rupees.
 */

// Ten packs at ₹100 + 12% GST = ₹1,120.00 of goods.
const ITEMS = [
  {
    item_name: "Paracetamol 650mg",
    batch_no: "BATCH-01",
    expiry_date: "2030-12-31",
    qty: 10,
    ptr: 100,
    discount_percent: 0,
    gst_percent: 12,
    net_amount: 1120,
  },
];

// The engine's own calculated charge rows, as the posting path stores them.
const FREIGHT = {
  head_code: "FREIGHT",
  head_name: "Freight",
  amount: 200,
  gst_rate: 0,
  taxable_amount: 200,
  total_tax: 0,
  total_amount: 200,
  treatment: "add_to_cost",
  paid_separately: false,
  in_payable: true,
};

const COURIER = {
  head_code: "COURIER",
  head_name: "Courier",
  amount: 20,
  gst_rate: 18,
  taxable_amount: 20,
  cgst_amount: 1.8,
  sgst_amount: 1.8,
  total_tax: 3.6,
  total_amount: 23.6,
  treatment: "expense",
  paid_separately: true,
  in_payable: false,
};

// ₹1,120.00 goods + ₹200.00 freight in the payable; the ₹23.60 courier charge is paid outside it.
const PAYABLE = 1320;

// The same goods in the shape the dot-matrix layouts take — they print the sales document engine,
// so a purchase bill keyed on dot matrix arrives here as lines.
const DOT_MATRIX_LINES = [
  {
    description: "Paracetamol 650mg",
    batch_no: "BATCH-01",
    expiry_date: "2030-12",
    qty: 10,
    rate: 100,
    gst_percent: 12,
    amount: 1120,
  },
];

const purchaseDoc = (charges: unknown[]) => ({
  purchase_number: "PB-0001",
  invoice_number: "PB-0001",
  invoice_date: "2026-11-20",
  supplier_name: "Walkthrough Distributors",
  customer_name: "Walkthrough Distributors",
  supplier_invoice_no: "WD-77",
  purchase_date: "2026-11-20",
  store_name: "LamStone Test Store",
  items: ITEMS,
  lines: DOT_MATRIX_LINES,
  subtotal: 1120,
  tax_total: 120,
  round_off: 0,
  grand_total: PAYABLE,
  charges,
});

const spaces = (html: string) => html.replace(/\s+/g, " ");

// The paper an auditor keeps is read as text, not as markup: a layout free to put the amount in its
// own <span> still has to say the same sentence.
const printedText = (html: string) => spaces(html.replace(/<[^>]*>/g, " "));

describe("purchase document printing with charges (PUR-009)", () => {
  it("prints every charge head with its taxable value, tax and total", () => {
    const html = printingEngine.generatePurchaseBillA4Html(purchaseDoc([FREIGHT, COURIER]));

    expect(html).toContain("Charges on this bill");
    expect(html).toContain("Freight");
    expect(html).toContain("Courier");
    expect(spaces(html)).toContain("₹ 200.00");
    expect(spaces(html)).toContain("₹ 20.00");
    expect(spaces(html)).toContain("₹ 3.60");
    expect(spaces(html)).toContain("₹ 23.60");
  });

  it("marks the separately-paid charge and keeps the payable footing the bill posted with", () => {
    const html = spaces(
      printingEngine.generatePurchaseBillA4Html(purchaseDoc([FREIGHT, COURIER]))
    );

    expect(html).toContain("paid separately");
    // Only the freight is in the payable, so the charge block foots on ₹200.00 and the payable
    // still reads ₹1,320.00 — the paper and the posted document say the same rupees.
    expect(html).toContain("In payable ₹ 200.00");
    expect(html).toContain("₹ 1320.00");
  });

  it("prints no charge block for a bill that owns no charges", () => {
    const html = printingEngine.generatePurchaseBillA4Html(purchaseDoc([]));

    expect(html).not.toContain("Charges on this bill");
    expect(html).toContain("₹ 1320.00");
  });

  it("carries the charges through the dot-matrix layout too", () => {
    for (const paperSize of ["dot_matrix_80col", "dot_matrix_132col"] as const) {
      const preview = printingEngine.renderDocumentHtml(
        "purchase_bill",
        purchaseDoc([FREIGHT, COURIER]),
        { paperSize }
      );

      expect(preview, paperSize).toContain("FREIGHT");
      expect(preview, paperSize).toContain("200.00");
      expect(preview, paperSize).toContain("COURIER");
      expect(preview, paperSize).toContain("23.60");
      expect(preview.toLowerCase(), paperSize).toContain("paid separately");
      expect(preview, paperSize).toContain("GRAND TOTAL");
      // The paper's own thousands separators, whatever layout printed them.
      expect(preview.replace(/,/g, ""), paperSize).toContain("1320.00");
    }
  });

  it("carries the charges through the invoice layout a saved bill reprints on", () => {
    const reprinted = printedText(
      printingEngine.generateInvoiceHtml({
        invoice_number: "PB-0001",
        invoice_date: "2026-11-20",
        store_name: "LamStone Test Store",
        customer_name: "Walkthrough Distributors",
        lines: DOT_MATRIX_LINES,
        subtotal: 1120,
        tax_total: 120,
        round_off: 0,
        grand_total: PAYABLE,
        charges: [FREIGHT, COURIER],
      } as never)
    );

    expect(reprinted).toContain("Freight — taxable ₹ 200.00, GST ₹ 0.00: ₹ 200.00");
    expect(reprinted).toContain("Courier — paid separately, outside this bill: ₹ 23.60");
    expect(reprinted).toContain("Grand Total: ₹ 1320.00");
  });

  it("leaves a sales document untouched when it carries no charges", () => {
    const salesDoc = {
      invoice_number: "INV-0001",
      store_name: "LamStone Test Store",
      customer_name: "Walk-in",
      bill_date: "2026-11-20",
      items: [{ item_name: "Paracetamol", qty: 1, rate: 20, net_amount: 20, gst_percent: 12 }],
      lines: [{ description: "Paracetamol", qty: 1, rate: 20, gst_percent: 12, amount: 20 }],
      subtotal: 20,
      tax_total: 2.4,
      grand_total: 22.4,
    };

    expect(printingEngine.renderDocumentHtml("invoice", salesDoc, { paperSize: "dot_matrix_80col" })).not.toContain(
      "paid separately"
    );
  });
});
