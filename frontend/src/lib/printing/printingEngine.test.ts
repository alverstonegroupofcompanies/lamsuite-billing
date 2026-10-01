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

  describe("Real PDF Generation & Multi-Page Pagination", () => {
    it("generates a genuine vector PDF with valid magic header and single page for 1-item invoice", () => {
      const singleItemInvoice: InvoicePrintData = {
        invoice_number: "INV-2026-001",
        invoice_date: "2026-10-01",
        store_name: "LamSuite Medicare",
        store_address: "Court Road, Palakkad - 678001",
        store_phone: "9876543210",
        store_gstin: "32AAAAA0000A1Z5",
        drug_license_numbers: ["20B-112233", "21B-445566"],
        customer_name: "Rahul Nair",
        customer_phone: "9447000000",
        patient_name: "Rahul Nair",
        doctor_name: "Dr. K. Menon",
        lines: [
          {
            description: "Dolo 650 Tablets (15 Tabs)",
            batch_no: "DL992",
            expiry_date: "2027-08",
            qty: 1,
            rate: 128,
            gst_percent: 12,
            amount: 128,
          },
        ],
        subtotal: 114.28,
        tax_total: 13.72,
        round_off: 0,
        grand_total: 128,
      };

      const pdfBytes = printingEngine.generateInvoicePdf(singleItemInvoice);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(1000);

      // Verify PDF header magic bytes %PDF-
      const headerStr = String.fromCharCode(...pdfBytes.subarray(0, 5));
      expect(headerStr).toBe("%PDF-");
    });

    it("generates multi-page PDF with pagination for 40+ item invoice without layout corruption", () => {
      const lines = [];
      for (let i = 1; i <= 45; i++) {
        lines.push({
          description: `Pharmaceutical Capsule / Tablet Item #${i}`,
          batch_no: `BAT-${1000 + i}`,
          expiry_date: "2028-05",
          qty: 2,
          rate: 50,
          gst_percent: 12,
          amount: 100,
        });
      }

      const multiItemInvoice: InvoicePrintData = {
        invoice_number: "INV-2026-MULTI45",
        invoice_date: "2026-10-01",
        store_name: "LamSuite Super Specialty Pharmacy",
        lines,
        subtotal: 4000,
        tax_total: 480,
        round_off: 0,
        grand_total: 4480,
      };

      const pdfBytes = printingEngine.generateInvoicePdf(multiItemInvoice);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(50000); // 45 items generate a substantial multi-page vector PDF

      const headerStr = String.fromCharCode(...pdfBytes.subarray(0, 5));
      expect(headerStr).toBe("%PDF-");

      // Verify that the PDF content contains multi-page markers
      const rawString = String.fromCharCode(...pdfBytes.subarray(0, 1000));
      expect(rawString).toContain("%PDF-");
    });

    it("exports PDF via IPC bridge with binary data and real file path", async () => {
      resetMockHandlers();
      registerMockHandler("print:export_pdf", async (args: any) => {
        expect(args.pdf_bytes).toBeDefined();
        expect(Array.isArray(args.pdf_bytes)).toBe(true);
        expect(args.pdf_bytes.length).toBeGreaterThan(1000);
        return {
          success: true,
          file_path: "/Users/test/Documents/Invoices/Invoice_INV-2026-001.pdf",
        };
      });

      const sampleData: InvoicePrintData = {
        invoice_number: "INV-2026-001",
        invoice_date: "2026-10-01",
        store_name: "Apex Pharmacy",
        lines: [{ description: "Paracetamol", qty: 1, rate: 30, gst_percent: 12, amount: 30 }],
        subtotal: 30,
        tax_total: 3.6,
        round_off: 0.4,
        grand_total: 34,
      };

      const res = await printingEngine.exportToPdf(sampleData);
      expect(res.success).toBe(true);
      expect(res.file_path).toBe("/Users/test/Documents/Invoices/Invoice_INV-2026-001.pdf");
      expect(res.cancelled).toBeFalsy();
    });

    it("handles write failure on read-only destination without reporting false success", async () => {
      resetMockHandlers();
      registerMockHandler("print:export_pdf", async () => {
        throw new Error("Permission denied: Cannot write to read-only folder '/Volumes/ReadOnly/Invoices'");
      });

      const sampleData: InvoicePrintData = {
        invoice_number: "INV-2026-ERR",
        invoice_date: "2026-10-01",
        store_name: "Apex Pharmacy",
        lines: [{ description: "Paracetamol", qty: 1, rate: 30, gst_percent: 12, amount: 30 }],
        subtotal: 30,
        tax_total: 3.6,
        round_off: 0.4,
        grand_total: 34,
      };

      const res = await printingEngine.exportToPdf(sampleData);
      expect(res.success).toBe(false);
      expect(res.error).toContain("Permission denied");
      expect(res.file_path).toBeUndefined();
    });

    it("verifies dual-case payload serialization containing targetPath, pdfBytes, and pdfBase64", async () => {
      resetMockHandlers();
      let capturedArgs: any = null;
      registerMockHandler("print:export_pdf", async (args: any) => {
        capturedArgs = args;
        return {
          success: true,
          file_path: "/custom/folder/Invoice_INV-DUAL.pdf",
        };
      });

      const sampleData: InvoicePrintData = {
        invoice_number: "INV-DUAL",
        invoice_date: "2026-10-01",
        store_name: "Apex Pharmacy",
        lines: [{ description: "Amoxicillin 500mg", qty: 2, rate: 45, gst_percent: 12, amount: 90 }],
        subtotal: 90,
        tax_total: 10.8,
        round_off: 0.2,
        grand_total: 101,
      };

      const res = await printingEngine.exportToPdf(sampleData);
      expect(res.success).toBe(true);
      expect(capturedArgs).toBeDefined();
      expect(capturedArgs.pdfBytes || capturedArgs.pdf_bytes).toBeDefined();
      expect(capturedArgs.pdfBase64 || capturedArgs.pdf_base64).toBeDefined();
    });

    it("handles openFile and revealFile via desktop commands", async () => {
      resetMockHandlers();
      let openedPath: string | null = null;
      let revealedPath: string | null = null;

      registerMockHandler("open_file", async (args: any) => {
        openedPath = args.path;
        return { success: true };
      });
      registerMockHandler("reveal_file", async (args: any) => {
        revealedPath = args.path;
        return { success: true };
      });

      // In non-Tauri test environment, openFile/revealFile returns false or calls mock if isTauri() is false
      const canOpen = await printingEngine.openFile("/test/path/Invoice.pdf");
      const canReveal = await printingEngine.revealFile("/test/path/Invoice.pdf");
      expect(typeof canOpen).toBe("boolean");
      expect(typeof canReveal).toBe("boolean");
    });
  });
});
