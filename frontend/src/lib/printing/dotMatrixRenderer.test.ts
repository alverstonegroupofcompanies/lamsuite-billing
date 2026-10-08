import { describe, it, expect } from "vitest";
import { dotMatrixRenderer, DotMatrixRenderer, type DotMatrixOptions } from "./dotMatrixRenderer";
import type { InvoicePrintData, CreditNotePrintData, DebitNotePrintData } from "./printingEngine";

describe("Dot Matrix Plain-Text Renderer & ESC/P Generator", () => {
  const sampleInvoice: InvoicePrintData = {
    invoice_number: "INV-2026-8801",
    invoice_date: "2026-10-08",
    invoice_time: "14:30",
    store_name: "Alverstone MediCare & Surgical Store",
    store_address: "Shop 4, Trade Center, MG Road, Ernakulam, Kerala - 682016",
    store_phone: "0484-2345678",
    store_email: "support@alverstone.in",
    store_gstin: "32ABCDE1234F1Z5",
    drug_license_numbers: ["KL-EKM-123456", "KL-EKM-123457"],
    fssai_no: "11320000000001",
    customer_name: "Rahul Varma",
    customer_phone: "9876543210",
    customer_gstin: "32AAAAA0000A1Z5",
    place_of_supply: "Kerala (32)",
    doctor_name: "Dr. K. S. Menon",
    doctor_reg_no: "TCMC-44218",
    patient_name: "Arya Varma",
    patient_age: 28,
    patient_gender: "F",
    payment_mode: "UPI",
    upi_vpa: "alverstone@icici",
    lines: [
      {
        description: "Augmentin 625 Duo Tablet (Amoxycillin + Clavulanic Acid)",
        hsn_code: "300420",
        batch_no: "AUG892",
        expiry_date: "12/27",
        qty: 2,
        loose_qty: 0,
        rate: 205.5,
        gst_percent: 12,
        amount: 390.45,
      },
      {
        description: "Pan D Capsule (Pantoprazole + Domperidone)",
        hsn_code: "300490",
        batch_no: "PND102",
        expiry_date: "08/28",
        qty: 1,
        loose_qty: 4,
        rate: 198.0,
        gst_percent: 12,
        amount: 250.8,
      },
    ],
    subtotal: 641.25,
    cgst_total: 38.48,
    sgst_total: 38.48,
    tax_total: 76.96,
    round_off: -0.21,
    grand_total: 718.0,
    amount_in_words: "Indian Seven Hundred Eighteen Rupees Only",
    terms_and_conditions: "Goods once sold will not be taken back without original bill.",
  };

  describe("Plain ASCII Formatting & Character ROM Safety", () => {
    it("never contains the non-ASCII ₹ currency glyph in 80-column output", () => {
      const text = dotMatrixRenderer.renderInvoice(sampleInvoice, { columns: 80 });
      expect(text).not.toContain("₹");
      expect(text).toContain("Rs.");
    });

    it("never contains the non-ASCII ₹ currency glyph in 132-column output", () => {
      const text = dotMatrixRenderer.renderInvoice(sampleInvoice, { columns: 132 });
      expect(text).not.toContain("₹");
      expect(text).toContain("Rs.");
    });

    it("aligns columns correctly within an exact 80-column width", () => {
      const text = dotMatrixRenderer.renderInvoice(sampleInvoice, { columns: 80 });
      const lines = text.split("\n");
      
      lines.forEach((line) => {
        const clean = line.replace(/\x0C/g, "");
        expect(clean.length).toBeLessThanOrEqual(80);
      });
    });

    it("includes proper document header, patient details, and item lines", () => {
      const text = dotMatrixRenderer.renderInvoice(sampleInvoice, { columns: 80 });
      expect(text).toContain("TAX INVOICE: #INV-2026-8801");
      expect(text).toContain("ALVERSTONE MEDICARE & SURGICAL STORE");
      expect(text).toContain("Rahul Varma");
      expect(text).toContain("Dr. K. S. Menon");
      expect(text).toContain("Arya Varma (28Y/F)");
      expect(text).toContain("Augmentin 625 Duo");
      expect(text).toContain("AUG892");
      expect(text).toContain("Pan D Capsule");
      expect(text).toContain("1+4L"); // Loose qty formatted as 1+4L
      expect(text).toContain("718.00");
      expect(text).toContain("Scan/Pay via UPI: alverstone@icici");
    });
  });

  describe("Continuous Multi-Page Pagination", () => {
    it("paginates 40 items over multiple pages with continuation headers and form feed markers", () => {
      const longLines = Array.from({ length: 40 }, (_, idx) => ({
        description: `Pharmaceutical Medicine Item #${idx + 1}`,
        hsn_code: "300490",
        batch_no: `BAT${1000 + idx}`,
        expiry_date: "11/27",
        qty: idx + 1,
        rate: 50.0 + idx,
        gst_percent: 12,
        amount: (idx + 1) * (50.0 + idx),
      }));

      const largeInvoice: InvoicePrintData = {
        ...sampleInvoice,
        lines: longLines,
        subtotal: 50000,
        tax_total: 6000,
        grand_total: 56000,
      };

      // 40 items on a 66-line page will span at least 2 pages
      const text = dotMatrixRenderer.renderInvoice(largeInvoice, { columns: 80, linesPerPage: 66 });
      
      // Check for Form Feed \x0C between pages
      const pages = text.split("\x0C").filter((p) => p.trim().length > 0);
      expect(pages.length).toBeGreaterThanOrEqual(2);

      // Page 1 should include continuation footer
      expect(pages[0]).toContain("[ Continued on Next Page... ]");

      // Page 2 should include continuation header
      expect(pages[1]).toContain("[ Continued from Page 1 - Document #INV-2026-8801 ]");
    });
  });

  describe("Description Wrapping vs Truncation", () => {
    it("wraps long item descriptions onto a secondary line when truncateDescriptions is false", () => {
      const text = dotMatrixRenderer.renderInvoice(sampleInvoice, {
        columns: 80,
        truncateDescriptions: false,
      });

      // Long item description contains "Clavulanic Acid" which wraps to line 2
      expect(text).toContain("Clavulanic");
    });

    it("truncates long item descriptions when truncateDescriptions is true", () => {
      const text = dotMatrixRenderer.renderInvoice(sampleInvoice, {
        columns: 80,
        truncateDescriptions: true,
      });

      // Should not show the secondary indented continuation line
      expect(text).not.toMatch(/\n\s{4}Duo Tablet/);
    });
  });

  describe("Sales Returns / Credit Notes & Purchase Returns / Debit Notes", () => {
    it("renders plain-text Sales Return / Credit Note with correct totals and reference", () => {
      const creditNote: CreditNotePrintData = {
        return_number: "CN-2026-0042",
        return_date: "2026-10-08",
        original_invoice_number: "INV-2026-8801",
        store_name: "Alverstone MediCare",
        customer_name: "Rahul Varma",
        customer_phone: "9876543210",
        refund_mode: "store_credit",
        lines: [
          {
            description: "Augmentin 625 Duo Tablet",
            hsn_code: "300420",
            batch_no: "AUG892",
            qty: 1,
            rate: 205.5,
            gst_percent: 12,
            amount: 205.5,
          },
        ],
        subtotal: 205.5,
        tax_total: 24.66,
        round_off: 0,
        grand_total: 230.16,
      };

      const text = dotMatrixRenderer.renderCreditNote(creditNote, { columns: 80 });
      expect(text).toContain("*** CREDIT NOTE / SALES RETURN ***");
      expect(text).toContain("CREDIT NOTE NO : #CN-2026-0042");
      expect(text).toContain("Orig Invoice   : #INV-2026-8801");
      expect(text).toContain("Augmentin 625 Duo Tablet");
      expect(text).toContain("CREDIT TOTAL  : Rs.       230.16");
      expect(text).toContain("Refund Mode: store_credit");
    });

    it("renders plain-text Purchase Return / Debit Note with supplier references", () => {
      const debitNote: DebitNotePrintData = {
        return_number: "PR-2026-0019",
        return_date: "2026-10-08",
        original_purchase_number: "PUR-2026-550",
        supplier_invoice_no: "SUP-INV-9901",
        store_name: "Alverstone MediCare",
        supplier_name: "Cipla Healthcare Distribution",
        supplier_gstin: "32ZZZZZ1111Z1Z2",
        settlement_type: "supplier_credit",
        lines: [
          {
            description: "Asthalin Inhaler 200 MDI",
            hsn_code: "300490",
            batch_no: "AST554",
            qty: 10,
            rate: 120.0,
            gst_percent: 12,
            amount: 1200.0,
          },
        ],
        subtotal: 1200.0,
        tax_total: 144.0,
        round_off: 0,
        grand_total: 1344.0,
      };

      const text = dotMatrixRenderer.renderDebitNote(debitNote, { columns: 80 });
      expect(text).toContain("*** DEBIT NOTE / PURCHASE RETURN ***");
      expect(text).toContain("DEBIT NOTE NO  : #PR-2026-0019");
      expect(text).toContain("Supplier Inv   : #SUP-INV-9901");
      expect(text).toContain("Cipla Healthcare Distribution");
      expect(text).toContain("DEBIT TOTAL   : Rs.     1,344.00");
    });
  });

  describe("Pre-Printed Stationery Mode", () => {
    it("renders data-only text without decorative borders in pre-printed mode", () => {
      const text = dotMatrixRenderer.renderInvoice(sampleInvoice, {
        columns: 80,
        prePrintedStationery: true,
      });

      // No long separator lines
      expect(text).not.toContain("================================================================================");
      expect(text).not.toContain("--------------------------------------------------------------------------------");
      expect(text).toContain("INV-2026-8801");
      expect(text).toContain("AUG892");
      expect(text).toContain("718.00");
    });
  });

  describe("ESC/P Binary Generation (Hardware Driver)", () => {
    it("generates correct initialization and formatting ESC/P sequences", () => {
      const text = "Hello Dot Matrix\n";
      const bytes = dotMatrixRenderer.generateEscPBytes(text, {
        columns: 80,
        linesPerPage: 66,
        cpi: "10cpi",
        doubleStrikeCarbon: true,
      });

      // ESC @ (0x1B, 0x40) - Reset/Init
      expect(bytes[0]).toBe(0x1b);
      expect(bytes[1]).toBe(0x40);

      // ESC x 0 (0x1B, 0x78, 0x00) - Draft Mode
      expect(bytes[2]).toBe(0x1b);
      expect(bytes[3]).toBe(0x78);
      expect(bytes[4]).toBe(0x00);

      // Double Strike ESC G (0x1B, 0x47)
      const hasDoubleStrike = Array.from(bytes).some(
        (b, i) => b === 0x1b && bytes[i + 1] === 0x47
      );
      expect(hasDoubleStrike).toBe(true);

      // Form Length ESC C 66 (0x1B, 0x43, 0x42)
      const hasFormLength = Array.from(bytes).some(
        (b, i) => b === 0x1b && bytes[i + 1] === 0x43 && bytes[i + 2] === 66
      );
      expect(hasFormLength).toBe(true);

      // Terminating Form Feed (0x0C)
      expect(bytes[bytes.length - 1]).toBe(0x0c);
    });

    it("activates condensed 17.14 CPI (0x0F) for 132-column width", () => {
      const bytes = dotMatrixRenderer.generateEscPBytes("Wide 132 columns\n", {
        columns: 132,
      });

      // SI (0x0F) condensed mode
      expect(Array.from(bytes)).toContain(0x0f);
    });
  });

  describe("Monospace HTML Preview & Monospace PDF Export", () => {
    it("generates continuous-form HTML preview with column ruler and line numbers gutter", () => {
      const text = dotMatrixRenderer.renderInvoice(sampleInvoice, { columns: 80 });
      const html = dotMatrixRenderer.generateMonospaceHtmlPreview(text, {
        showRuler: true,
        columns: 80,
      });

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("ruler");
      expect(html).toContain("CONTINUOUS FORM PERFORATION");
      expect(html).toContain("TEAR-OFF LINE (FORM FEED)");
      expect(html).toContain("line-no");
      expect(html).toContain("line-content");
      expect(html).toContain("INV-2026-8801");
    });

    it("generates valid Monospace PDF byte buffer using Courier font", () => {
      const text = dotMatrixRenderer.renderInvoice(sampleInvoice, { columns: 80 });
      const pdfBytes = dotMatrixRenderer.generateMonospacePdf(text, { columns: 80 });

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(500); // Standard minimal PDF is > 500 bytes
      
      // Check PDF header %PDF-
      const header = String.fromCharCode(pdfBytes[0], pdfBytes[1], pdfBytes[2], pdfBytes[3], pdfBytes[4]);
      expect(header).toBe("%PDF-");
    });
  });
});
