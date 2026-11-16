import { describe, it, expect } from "vitest";
import { printingEngine, type InvoicePrintData } from "./printingEngine";

const IRN = "A1B2C3D4E5F60718A1B2C3D4E5F60718A1B2C3D4E5F60718A1B2C3D4E5F60718";

const baseData: InvoicePrintData = {
  invoice_number: "INV-2026-0042",
  invoice_date: "17-11-2026",
  store_name: "Apex Pharmacy",
  store_gstin: "32ABCDE1234F1Z5",
  customer_name: "QA Traders",
  customer_gstin: "32ABCDE1234F1Z5",
  lines: [{ description: "Paracetamol", qty: 1, rate: 100, gst_percent: 18, amount: 100 }],
  subtotal: 100,
  tax_total: 18,
  round_off: 0,
  grand_total: 118,
  irn: IRN,
  irn_ack_no: "112233445566",
  irn_ack_date: "17-11-2026",
  ewb_number: "123456789012",
  ewb_valid_until: "18-11-2026",
};

describe("Print templates - statutory compliance references", () => {
  it("renders IRN and e-way bill references on the A4 tax invoice", () => {
    const html = printingEngine.generateInvoiceHtml(baseData, { paperSize: "a4" });
    expect(html).toContain("Statutory References");
    expect(html).toContain(IRN);
    expect(html).toContain("112233445566");
    expect(html).toContain("123456789012");
    expect(html).toContain("18-11-2026");
  });

  it("renders compliance references on thermal and half-A4 receipts", () => {
    const thermal = printingEngine.generateInvoiceHtml(baseData, { paperSize: "thermal_80mm" });
    expect(thermal).toContain(`IRN: ${IRN}`);
    expect(thermal).toContain("E-Way Bill: 123456789012");

    const halfA4 = printingEngine.generateInvoiceHtml(baseData, { paperSize: "half_a4" });
    expect(halfA4).toContain(`IRN: ${IRN}`);
  });

  it("prints references on dot-matrix invoices", () => {
    const text = printingEngine.generateDotMatrixText(baseData);
    expect(text).toContain("IRN:");
    expect(text).toContain("EWB: 123456789012");
  });

  it("omits the compliance block when no references are recorded", () => {
    const plain: InvoicePrintData = { ...baseData, irn: undefined, ewb_number: undefined, irn_ack_no: undefined, irn_ack_date: undefined, ewb_valid_until: undefined };
    const html = printingEngine.generateInvoiceHtml(plain, { paperSize: "a4" });
    expect(html).not.toContain("Statutory References");
    expect(html).not.toContain("E-Way Bill:");
  });
});
