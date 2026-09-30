import { describe, it, expect } from "vitest";
import {
  generateDynamicSlipHeightMm,
  generateUpiPaymentString,
  generateWhatsAppShareUrl,
  generateEmailShareUrl,
  printingEngine,
  type InvoicePrintData,
} from "./printingEngine";
import { registerMockHandler, resetMockHandlers } from "../ipc/ipcBridge";

describe("Printing Engine & Document Layouts (PRN-001, PRN-002, PRN-005)", () => {
  describe("Dynamic Thermal Slip Height", () => {
    it("calculates compact slip height for short receipts without wasting paper", () => {
      // 2 items, no clinical metadata
      const height = generateDynamicSlipHeightMm(2, false);
      expect(height).toBe(93); // 35 + (2 * 6.5 = 13) + 30 + 15 = 93mm
    });

    it("expands slip height dynamically for pharmacy prescriptions with doctor details", () => {
      // 8 items with clinical metadata
      const height = generateDynamicSlipHeightMm(8, true);
      expect(height).toBe(142); // 45 + (8 * 6.5 = 52) + 30 + 15 = 142mm
    });
  });

  describe("Dynamic UPI QR Generator", () => {
    it("formats standard NPCI UPI payment URI with exact amount and reference", () => {
      const uri = generateUpiPaymentString("medstore@okhdfcbank", "City Meds", 420.5, "INV-2026-0042");
      expect(uri).toBe("upi://pay?pa=medstore@okhdfcbank&pn=City%20Meds&am=420.50&tr=INV-2026-0042&cu=INR");
    });
  });

  describe("WhatsApp & Email Share Link Generators", () => {
    const sampleData: InvoicePrintData = {
      invoice_number: "INV-2026-001",
      invoice_date: "2026-09-30",
      store_name: "Apex Pharmacy",
      lines: [{ description: "Paracetamol", qty: 1, rate: 30, gst_percent: 12, amount: 30 }],
      subtotal: 30,
      tax_total: 3.6,
      round_off: 0.4,
      grand_total: 34,
    };

    it("generates WhatsApp dispatch link with international dialing code and encoded bill details", () => {
      const waUrl = generateWhatsAppShareUrl("9876543210", sampleData);
      expect(waUrl).toContain("https://wa.me/919876543210");
      expect(waUrl).toContain("INV-2026-001");
      expect(waUrl).toContain("34.00");
    });

    it("generates email mailto link with encoded subject and summary body", () => {
      const emailUrl = generateEmailShareUrl("customer@example.com", sampleData);
      expect(emailUrl).toContain("mailto:customer%40example.com");
      expect(emailUrl).toContain("INV-2026-001");
    });
  });

  describe("Native Print Dispatch & Templates", () => {
    it("invokes native thermal print via desktop IPC bridge", async () => {
      resetMockHandlers();
      registerMockHandler("print:thermal", async (args) => {
        return { success: true, job_id: "spool_job_881", received: args };
      });

      const sampleData: InvoicePrintData = {
        invoice_number: "INV-2026-001",
        invoice_date: "2026-09-30",
        store_name: "Apex Pharmacy",
        lines: [{ description: "Paracetamol", qty: 1, rate: 30, gst_percent: 12, amount: 30 }],
        subtotal: 30,
        tax_total: 3.6,
        round_off: 0.4,
        grand_total: 34,
      };

      const res = await printingEngine.printThermalReceipt(sampleData, "EPSON TM-T82");
      expect(res.success).toBe(true);
      expect(res.job_id).toBe("spool_job_881");
    });

    it("maintains default named print templates and printer profiles", () => {
      const templates = printingEngine.getTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(3);
      expect(templates.map((t) => t.id)).toContain("thermal_standard");
      expect(templates.map((t) => t.id)).toContain("a4_tax_invoice");

      const profiles = printingEngine.getPrinterProfiles();
      expect(profiles.length).toBeGreaterThanOrEqual(2);
      expect(profiles.find((p) => p.isDefault)?.silentPrint).toBe(true);
    });
  });
});
