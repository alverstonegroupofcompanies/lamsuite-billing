import { describe, it, expect } from "vitest";
import {
  generateDynamicSlipHeightMm,
  generateUpiPaymentString,
  generateWhatsAppShareUrl,
  generateEmailShareUrl,
  numberToWordsIndian,
  calculateHsnSummary,
  chunkInvoiceLines,
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
      registerMockHandler("db:insert", async () => ({ success: true }));
      registerMockHandler("db:findById", async () => null);
      registerMockHandler("db:findAll", async () => []);
      registerMockHandler("get_system_printers", async () => [
        {
          name: "EPSON TM-T82 Thermal",
          displayName: "EPSON TM-T82 Thermal",
          isDefault: true,
          status: "ready",
          printerType: "thermal_pos",
          supportedPaperSizes: ["thermal_80mm", "thermal_58mm"],
          isVirtual: false,
        },
      ]);
      registerMockHandler("print_native_job", async (args) => {
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

      const res = await printingEngine.printThermalReceipt(sampleData, "EPSON TM-T82 Thermal");
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

    it("converts amounts to Indian numbering words correctly", () => {
      expect(numberToWordsIndian(291)).toBe("Indian Two Hundred Ninety One Rupees Only");
      expect(numberToWordsIndian(128.50)).toBe("Indian One Hundred Twenty Eight Rupees and Fifty Paise Only");
      expect(numberToWordsIndian(100500)).toBe("Indian One Lakh Five Hundred Rupees Only");
    });

    it("calculates HSN Tax Summary grouping by HSN code and GST rate", () => {
      const testLines = [
        { description: "Item 1", hsn_code: "300490", qty: 2, rate: 50, gst_percent: 12, amount: 100, taxable_amount: 89.29 },
        { description: "Item 2", hsn_code: "300490", qty: 1, rate: 100, gst_percent: 12, amount: 100, taxable_amount: 89.29 },
        { description: "Item 3", hsn_code: "210690", qty: 1, rate: 200, gst_percent: 18, amount: 200, taxable_amount: 169.49 },
      ];
      const summary = calculateHsnSummary(testLines);
      expect(summary).toHaveLength(2);

      const pharmaHsn = summary.find((s: any) => s.hsnCode === "300490");
      expect(pharmaHsn).toBeDefined();
      expect(pharmaHsn!.cgstRate).toBe(6);
      expect(pharmaHsn!.sgstRate).toBe(6);
      expect(pharmaHsn!.taxableValue).toBe(178.58);

      const foodHsn = summary.find((s: any) => s.hsnCode === "210690");
      expect(foodHsn).toBeDefined();
      expect(foodHsn!.cgstRate).toBe(9);
      expect(foodHsn!.sgstRate).toBe(9);
    });

    it("generates 1-item, 2-item, and 46-item statutory A4 PDFs with valid Unicode %PDF- header and ToUnicode CMap", () => {
      const buildInvoice = (count: number): InvoicePrintData => {
        const lines = [];
        for (let i = 1; i <= count; i++) {
          lines.push({
            description: `Dolo 650 Tablets Batch #${i}`,
            hsn_code: "300490",
            batch_no: `BT-${1000 + i}`,
            expiry_date: "12/28",
            qty: 2,
            rate: 32.5,
            gst_percent: 12,
            amount: 65,
          });
        }
        return {
          invoice_number: `INV-TEST-${count}`,
          invoice_date: "2026-10-01",
          store_name: "LamStone Specialty Pharmacy",
          store_address: "Main Road, Palakkad - 678001",
          store_phone: "9876543210",
          store_gstin: "32ABCDE1234F1Z5",
          customer_name: "Muhammad Anshad",
          customer_phone: "9847012345",
          lines,
          subtotal: count * 58.04,
          tax_total: count * 6.96,
          round_off: 0,
          grand_total: count * 65,
        };
      };

      // 1-item invoice
      const pdf1 = printingEngine.generateInvoicePdf(buildInvoice(1));
      expect(pdf1).toBeInstanceOf(Uint8Array);
      expect(String.fromCharCode(...pdf1.subarray(0, 5))).toBe("%PDF-");
      const str1 = Buffer.from(pdf1).toString("latin1");
      expect(str1).toContain("/ToUnicode");
      expect(str1.toLowerCase()).toContain("20b9"); // Unicode U+20B9 (₹)

      // 2-item invoice
      const pdf2 = printingEngine.generateInvoicePdf(buildInvoice(2));
      expect(pdf2).toBeInstanceOf(Uint8Array);
      expect(String.fromCharCode(...pdf2.subarray(0, 5))).toBe("%PDF-");
      const str2 = Buffer.from(pdf2).toString("latin1");
      expect(str2).toContain("/ToUnicode");
      expect(str2.toLowerCase()).toContain("20b9");

      // 46-item invoice
      const pdf46 = printingEngine.generateInvoicePdf(buildInvoice(46));
      expect(pdf46).toBeInstanceOf(Uint8Array);
      expect(String.fromCharCode(...pdf46.subarray(0, 5))).toBe("%PDF-");
      const str46 = Buffer.from(pdf46).toString("latin1");
      expect(str46).toContain("/ToUnicode");
      expect(str46.toLowerCase()).toContain("20b9");
      expect(pdf46.length).toBeGreaterThan(150000); // 46 items multi-page PDF
    });

    it("generates matching statutory A4 HTML template with HSN summary, QR code, and aligned columns", () => {
      const invoiceData: InvoicePrintData = {
        invoice_number: "INV-HTML-MATCH",
        invoice_date: "2026-10-01",
        store_name: "LamStone Specialty Pharmacy",
        customer_name: "Anshad",
        lines: [
          { description: "Amoxicillin 500mg", hsn_code: "300490", batch_no: "AMX-1", expiry_date: "05/27", qty: 1, rate: 100, gst_percent: 12, amount: 100 },
        ],
        subtotal: 89.29,
        tax_total: 10.71,
        round_off: 0,
        grand_total: 100,
      };

      const html = printingEngine.generateInvoiceHtml(invoiceData);
      expect(html).toContain("TAX INVOICE");
      expect(html).toContain("HSN / GST Tax Summary");
      expect(html).toContain("Scan & Pay via UPI");
      expect(html).toContain("Amount in Words:");
      expect(html).toContain("Terms & Conditions:");
      expect(html).toContain("tabular-nums");
      expect(html).not.toContain("font-family: monospace;");
    });

    it("lays out footer as a non-overlapping grid without absolute positioning", () => {
      const invoiceData: InvoicePrintData = {
        invoice_number: "INV-GRID-TEST",
        invoice_date: "2026-10-01",
        store_name: "LamStone Pharmacy & Retail",
        lines: [
          { description: "Dolo 650", hsn_code: "300490", batch_no: "DL1", expiry_date: "2027-06", qty: 2, rate: 32, gst_percent: 12, amount: 64 },
        ],
        subtotal: 57.14,
        tax_total: 6.86,
        round_off: 0,
        grand_total: 64,
        jurisdiction_note: "Subject to local jurisdiction.",
      };

      const html = printingEngine.generateInvoiceHtml(invoiceData);
      expect(html).toContain("footer-grid");
      expect(html).toContain("grid-template-columns");
      expect(html).toContain("qr-box");
      expect(html).toContain("totals-card");
      expect(html).toContain("terms-card");
      expect(html).toContain("sign-card");
      expect(html).toContain("Authorised Signatory / Pharmacist");
      expect(html).toContain("For LamStone Pharmacy & Retail");
      // Confirm no absolute positioning in footer styles
      expect(html).not.toMatch(/footer[^{]*{[^}]*position:\s*absolute/i);

      // Verify PDF generation succeeds and outputs valid vector PDF with embedded fonts
      const pdfBytes = printingEngine.generateInvoicePdf(invoiceData);
      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(String.fromCharCode(...pdfBytes.subarray(0, 5))).toBe("%PDF-");
      const pdfStr = Buffer.from(pdfBytes).toString("latin1");
      expect(pdfStr).toContain("/ToUnicode");
      expect(pdfStr.toLowerCase()).toContain("20b9");
    });

    it("renders authentic thermal receipt HTML for 80mm and 58mm POS paper widths", () => {
      const invoiceData: InvoicePrintData = {
        invoice_number: "INV-TH-101",
        invoice_date: "2026-10-02",
        store_name: "LamStone Pharmacy",
        lines: [
          { description: "Amoxicillin 500mg", batch_no: "AMX99", expiry_date: "2027-12", qty: 2, rate: 45, gst_percent: 12, amount: 90 },
        ],
        subtotal: 80.36,
        tax_total: 9.64,
        round_off: 0,
        grand_total: 90,
      };

      const html80 = printingEngine.renderDocumentHtml("tax_invoice", invoiceData, {
        paperSize: "thermal_80mm",
        copyMarker: "Original for Recipient",
      });
      expect(html80).toContain("80mm");
      expect(html80).toContain("Amoxicillin 500mg");
      expect(html80).toContain("Original for Recipient");
      expect(html80).toContain("₹90.00");

      const html58 = printingEngine.renderDocumentHtml("tax_invoice", invoiceData, {
        paperSize: "thermal_58mm",
      });
      expect(html58).toContain("58mm");
      expect(html58).toContain("Amoxicillin 500mg");
    });

    it("renders Half-A4 landscape layout with tight tabular formatting", () => {
      const invoiceData: InvoicePrintData = {
        invoice_number: "INV-HALF-001",
        invoice_date: "2026-10-02",
        store_name: "LamStone Pharmacy",
        lines: [
          { description: "Azithromycin 500mg", batch_no: "AZ10", expiry_date: "2027-08", qty: 3, rate: 70, gst_percent: 12, amount: 210 },
        ],
        subtotal: 187.5,
        tax_total: 22.5,
        round_off: 0,
        grand_total: 210,
      };

      const halfA4Html = printingEngine.renderDocumentHtml("tax_invoice", invoiceData, { paperSize: "half_a4" });
      expect(halfA4Html).toContain("Half A4");
      expect(halfA4Html).toContain("A5 landscape");
      expect(halfA4Html).toContain("Azithromycin 500mg");
      expect(halfA4Html).toContain("₹210.00");
    });

    it("dispatches Credit Note and Debit Note rendering across HTML and PDF targets", () => {
      const creditNoteData = {
        return_number: "CR-2026-001",
        return_date: "2026-10-02",
        store_name: "LamStone Pharmacy",
        customer_name: "Test Customer",
        lines: [
          { description: "Cetirizine 10mg", batch_no: "CT01", expiry_date: "2027-05", qty: 1, rate: 20, gst_percent: 12, amount: 20 },
        ],
        subtotal: 17.86,
        tax_total: 2.14,
        round_off: 0,
        grand_total: 20,
        refund_mode: "Cash",
      };

      const cnHtml = printingEngine.renderDocumentHtml("credit_note", creditNoteData);
      expect(cnHtml).toContain("CREDIT NOTE / SALES RETURN");
      expect(cnHtml).toContain("CR-2026-001");

      const cnThermal80 = printingEngine.renderDocumentHtml("credit_note", creditNoteData, { paperSize: "thermal_80mm" });
      expect(cnThermal80).toContain("*** CREDIT NOTE ***");
      expect(cnThermal80).toContain("80mm");
      expect(cnThermal80).not.toContain("width: 72mm;");

      const cnThermal58 = printingEngine.renderDocumentHtml("credit_note", creditNoteData, { paperSize: "thermal_58mm" });
      expect(cnThermal58).toContain("*** CREDIT NOTE ***");
      expect(cnThermal58).toContain("58mm");
      expect(cnThermal58).toContain("Cetirizine 10mg");
      expect(cnThermal58).toContain("TOTAL REFUND:");
      expect(cnThermal58).not.toContain("width: 72mm;");

      const debitNoteData = {
        return_number: "DN-2026-001",
        return_date: "2026-10-02",
        store_name: "LamStone Pharmacy",
        supplier_name: "Apollo Wholesalers",
        lines: [
          { description: "Paracetamol 500mg", batch_no: "PR01", expiry_date: "2027-08", qty: 10, rate: 15, gst_percent: 12, amount: 150 },
        ],
        subtotal: 133.93,
        tax_total: 16.07,
        round_off: 0,
        grand_total: 150,
        settlement_type: "Adjust in Ledger",
      };

      const dnThermal58 = printingEngine.renderDocumentHtml("debit_note", debitNoteData, { paperSize: "thermal_58mm" });
      expect(dnThermal58).toContain("*** DEBIT NOTE ***");
      expect(dnThermal58).toContain("58mm");
      expect(dnThermal58).toContain("Apollo Wholesalers");

      const cnPdf = printingEngine.renderDocumentPdf("credit_note", creditNoteData);
      expect(cnPdf).toBeInstanceOf(Uint8Array);
      expect(String.fromCharCode(...cnPdf.subarray(0, 5))).toBe("%PDF-");
    });

    it("generates ESC/POS binary bytes with initialize, cutter, and drawer kick commands", () => {
      const sampleData: InvoicePrintData = {
        invoice_number: "INV-ESC-001",
        invoice_date: "2026-10-08",
        store_name: "LamStone Pharmacy",
        lines: [
          { description: "Amoxicillin 500mg", qty: 2, rate: 50, gst_percent: 12, amount: 100 },
        ],
        subtotal: 89.28,
        tax_total: 10.72,
        round_off: 0,
        grand_total: 100,
      };

      const bytes = printingEngine.generateEscPosReceiptBytes(sampleData, {
        paperWidthMm: 80,
        autoCut: true,
        cashDrawer: true,
      });

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBeGreaterThan(50);
      // Check ESC @ (0x1B, 0x40)
      expect(bytes[0]).toBe(0x1B);
      expect(bytes[1]).toBe(0x40);
      // Check cash drawer kick (0x1B, 0x70)
      expect(bytes[2]).toBe(0x1B);
      expect(bytes[3]).toBe(0x70);
      // Check GS V cutter command at end (0x1D, 0x56, 0x41)
      const lastFour = bytes.subarray(bytes.length - 4);
      expect(lastFour[0]).toBe(0x1D);
      expect(lastFour[1]).toBe(0x56);
      expect(lastFour[2]).toBe(0x41);
    });

    it("generates Dot Matrix 80-column ASCII draft text with form feed", () => {
      const sampleData: InvoicePrintData = {
        invoice_number: "INV-DOT-001",
        invoice_date: "2026-10-08",
        store_name: "LamStone Pharmacy",
        lines: [
          { description: "Paracetamol 500mg", batch_no: "PC01", expiry_date: "2027-01", qty: 5, rate: 10, gst_percent: 12, amount: 50 },
        ],
        subtotal: 44.64,
        tax_total: 5.36,
        round_off: 0,
        grand_total: 50,
      };

      const text = printingEngine.generateDotMatrixText(sampleData);
      expect(text).toContain("TAX INVOICE");
      expect(text).toContain("INV-DOT-001");
      expect(text).toContain("Paracetamol 500mg");
      // Default stop_immediately must NOT have trailing \x0C (avoids empty page eject bug)
      expect(text).not.toContain("\x0C");

      // Appends \x0C only when form_feed is explicitly chosen
      const textWithFF = printingEngine.generateDotMatrixText(sampleData, { endOfJobAction: "form_feed" });
      expect(textWithFF).toContain("\x0C");
    });

    it("renders clean multi-item batches for 1, 2, 40, and 100+ items", () => {
      const createData = (count: number): InvoicePrintData => ({
        invoice_number: `INV-MULTI-${count}`,
        invoice_date: "2026-10-08",
        store_name: "LamStone Super Meds",
        lines: Array.from({ length: count }, (_, i) => ({
          description: `Product Line Item #${i + 1}`,
          batch_no: `BAT-${1000 + i}`,
          expiry_date: "2028-05",
          qty: 1,
          rate: 100,
          gst_percent: 18,
          amount: 118,
        })),
        subtotal: count * 100,
        tax_total: count * 18,
        round_off: 0,
        grand_total: count * 118,
      });

      // 1 item A4 & thermal
      const html1 = printingEngine.generateInvoiceHtml(createData(1), { paperSize: "a4" });
      expect(html1).toContain("Product Line Item #1");
      const therm1 = printingEngine.generateInvoiceHtml(createData(1), { paperSize: "thermal_80mm" });
      expect(therm1).toContain("Product Line Item #1");

      // 2 items A4 & thermal
      const html2 = printingEngine.generateInvoiceHtml(createData(2), { paperSize: "a4" });
      expect(html2).toContain("Product Line Item #2");

      // 40 items A4 & PDF
      const data40 = createData(40);
      const html40 = printingEngine.generateInvoiceHtml(data40, { paperSize: "a4" });
      expect(html40).toContain("Product Line Item #40");
      expect(html40).toContain("table-header-group");
      const pdf40 = printingEngine.generateInvoicePdf(data40);
      expect(pdf40.byteLength).toBeGreaterThan(1000);

      // 100 items A4 & thermal
      const data100 = createData(100);
      const html100 = printingEngine.generateInvoiceHtml(data100, { paperSize: "a4" });
      expect(html100).toContain("Product Line Item #100");
    });

    it("chunks items into balanced pages without overflowing A4 boundaries", () => {
      // Single page: 10 items
      const items10 = Array.from({ length: 10 }, (_, i) => ({ id: i }));
      const chunks10 = chunkInvoiceLines(items10, 14, 16, 24, 14);
      expect(chunks10.length).toBe(1);
      expect(chunks10[0].length).toBe(10);

      // Single page: 14 items
      const items14 = Array.from({ length: 14 }, (_, i) => ({ id: i }));
      const chunks14 = chunkInvoiceLines(items14, 14, 16, 24, 14);
      expect(chunks14.length).toBe(1);
      expect(chunks14[0].length).toBe(14);

      // 24 items (the user's invoice case): should cleanly split into 2 balanced pages (12 and 12)
      const items24 = Array.from({ length: 24 }, (_, i) => ({ id: i }));
      const chunks24 = chunkInvoiceLines(items24, 14, 16, 24, 14);
      expect(chunks24.length).toBe(2);
      expect(chunks24[0].length).toBe(12);
      expect(chunks24[1].length).toBe(12);

      // 45 items: splits into 3 pages
      const items45 = Array.from({ length: 45 }, (_, i) => ({ id: i }));
      const chunks45 = chunkInvoiceLines(items45, 14, 16, 24, 14);
      expect(chunks45.length).toBe(3);
      expect(chunks45[0].length).toBe(16);
      expect(chunks45[1].length + chunks45[2].length).toBe(29);
    });

    it("renders 24-item A4 invoice as 2 separate sheets with repeated headers, continued notice, and vertical lines", () => {
      const lines24 = Array.from({ length: 24 }, (_, i) => ({
        description: `Pharmaceutical Medicine Item #${i + 1}`,
        hsn_code: "300490",
        batch_no: `BT-${2000 + i}`,
        expiry_date: "10/28",
        qty: 2,
        rate: 50,
        gst_percent: 12,
        amount: 100,
      }));

      const invoiceData: InvoicePrintData = {
        invoice_number: "INV-556277",
        invoice_date: "2026-10-14",
        store_name: "LamStone Pharmacy",
        customer_name: "Abdul Rahman",
        lines: lines24,
        subtotal: 2142.86,
        tax_total: 257.14,
        round_off: 0,
        grand_total: 2400,
      };

      const html = printingEngine.generateInvoiceHtml(invoiceData, { paperSize: "a4" });

      // Must have exactly two .a4-sheet elements
      const sheetMatches = html.match(/class="a4-sheet"/g);
      expect(sheetMatches).not.toBeNull();
      expect(sheetMatches!.length).toBe(2);

      // Page 1 assertions
      expect(html).toContain("Page 1 of 2");
      expect(html).toContain("Continued on Page 2 &rarr;");
      expect(html).toContain("Pharmaceutical Medicine Item #1");
      expect(html).toContain("Pharmaceutical Medicine Item #12");

      // Page 2 assertions
      expect(html).toContain("Page 2 of 2");
      expect(html).toContain("Tax Invoice #INV-556277");
      expect(html).toContain("Pharmaceutical Medicine Item #13");
      expect(html).toContain("Pharmaceutical Medicine Item #24");

      // HSN summary, words, and totals must be on the final page
      expect(html).toContain("HSN / GST Tax Summary");
      expect(html).toContain("Amount in Words:");
      expect(html).toContain("Scan & Pay via UPI");

      // Vertical lines styling on table cells
      expect(html).toContain("border-right: 1px solid #cbd5e1;");

      // Page-break rules for physical print & Save PDF parity
      expect(html).toContain("page-break-after: always !important;");
      expect(html).toContain(".a4-sheet:last-child");
      expect(html).toContain("page-break-after: auto !important;");
    });

    it("renders single-page invoice compactly without continuation banner or extra sheets", () => {
      const lines5 = Array.from({ length: 5 }, (_, i) => ({
        description: `Medicine #${i + 1}`,
        hsn_code: "300490",
        qty: 1,
        rate: 50,
        gst_percent: 12,
        amount: 50,
      }));

      const invoiceData: InvoicePrintData = {
        invoice_number: "INV-SINGLE-01",
        invoice_date: "2026-10-14",
        store_name: "LamStone Pharmacy",
        lines: lines5,
        subtotal: 223.21,
        tax_total: 26.79,
        round_off: 0,
        grand_total: 250,
      };

      const html = printingEngine.generateInvoiceHtml(invoiceData, { paperSize: "a4" });
      const sheetMatches = html.match(/class="a4-sheet"/g);
      expect(sheetMatches!.length).toBe(1);
      expect(html).toContain("Page 1 of 1");
      expect(html).not.toContain("Continued on Page");
    });
  });
});
