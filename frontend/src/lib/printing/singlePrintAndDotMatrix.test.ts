import { describe, it, expect, beforeEach } from "vitest";
import {
  printingEngine,
  resolvePrintColumns,
  formatColumnCellHtml,
  type InvoicePrintData,
  type PrintColumnConfig,
} from "./printingEngine";
import {
  deriveDotMatrixColumns,
  getDotMatrixColumns,
  getPaperWidthInches,
  getPrinterMaxCarriageWidthInches,
  isPaperWiderThanPrinter,
  printerManagerService,
} from "./printerManagerService";
import { dotMatrixRenderer } from "./dotMatrixRenderer";

describe("Phase 5 - Unified Print Button, Column Customization & Dot-Matrix Reflow", () => {
  const sampleInvoice: InvoicePrintData = {
    invoice_number: "INV-2026-001",
    invoice_date: "2026-11-02",
    invoice_time: "10:30 AM",
    store_name: "Apex Supermarket",
    store_address: "123 Commercial Hub, Kochi",
    store_phone: "9876500000",
    store_gstin: "32ABCDE1234F1Z5",
    store_type: "general",
    gst_type: "regular",
    customer_name: "John Doe",
    customer_phone: "9123456789",
    place_of_supply: "32-Kerala",
    payment_mode: "UPI",
    payment_status: "Paid",
    lines: [
      {
        description: "Organic Green Tea 250g",
        hsn_code: "090210",
        qty: 2,
        rate: 150.0,
        gst_percent: 5,
        amount: 300.0,
      },
      {
        description: "Almond Butter 500g",
        hsn_code: "200819",
        qty: 1,
        rate: 450.0,
        gst_percent: 12,
        amount: 450.0,
      },
    ],
    subtotal: 750.0,
    tax_total: 69.0,
    round_off: 0.0,
    grand_total: 819.0,
  };

  beforeEach(() => {
    if (typeof localStorage !== "undefined" && typeof localStorage.clear === "function") {
      localStorage.clear();
    }
  });

  describe("Item 4: Column Customization & Renaming", () => {
    it("renaming a column header (e.g. 'Rate' to 'Price') reflects in HTML preview", () => {
      const customizedColumns: PrintColumnConfig[] = [
        { id: "sl_no", label: "No.", visible: true, widthPercent: 5, order: 1 },
        { id: "description", label: "Product Name", visible: true, widthPercent: 40, order: 2 },
        { id: "qty", label: "Quantity", visible: true, widthPercent: 15, order: 3 },
        { id: "rate", label: "Unit Price", visible: true, widthPercent: 20, order: 4 },
        { id: "amount", label: "Line Total", visible: true, widthPercent: 20, order: 5 },
      ];

      const html = printingEngine.generateInvoiceHtml(sampleInvoice, {
        columns: customizedColumns,
      });

      // Verify customized headers exist in HTML
      expect(html).toContain("Product Name");
      expect(html).toContain("Quantity");
      expect(html).toContain("Unit Price");
      expect(html).toContain("Line Total");
      // Verify unselected columns (e.g. HSN, Batch, Exp) are omitted
      expect(html).not.toContain("<th style=\"width: 60px; text-align: center; border-right: 1px solid #cbd5e1;\">HSN</th>");
    });

    it("customized column titles reflect identically in vector PDF generation", () => {
      const customizedColumns: PrintColumnConfig[] = [
        { id: "description", label: "Item", visible: true, widthPercent: 50, order: 1 },
        { id: "rate", label: "Price", visible: true, widthPercent: 25, order: 2 },
        { id: "amount", label: "Total", visible: true, widthPercent: 25, order: 3 },
      ];

      const pdfBytes = printingEngine.generateInvoicePdf(sampleInvoice, {
        columns: customizedColumns,
      });

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(500);

      const header = String.fromCharCode(...pdfBytes.subarray(0, 5));
      expect(header).toBe("%PDF-");
    });

    it("saves and retrieves last-used document print settings per docType", async () => {
      const docSettings = {
        paperSize: "a4" as const,
        copies: 2,
        columns: [
          { id: "description", label: "Custom Item", visible: true, widthPercent: 50, order: 1 },
          { id: "rate", label: "Price", visible: true, widthPercent: 50, order: 2 },
        ],
      };

      await printerManagerService.setLastUsedDocSettings("tax_invoice", docSettings);
      const retrieved = await printerManagerService.getLastUsedDocSettings("tax_invoice");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.paperSize).toBe("a4");
      expect(retrieved?.copies).toBe(2);
      expect(retrieved?.columns?.[0].label).toBe("Custom Item");
    });
  });

  describe("Item 11: Dot-Matrix Paper Sizes & Column Derivation", () => {
    it("derives exact columns at standard 10 CPI for 6, 10, 12, and 15 inch paper", () => {
      // 6" narrow paper with 1" tractor margins = 5" usable * 10 CPI = 50 cols
      expect(deriveDotMatrixColumns("dot_matrix_6in", "10cpi")).toBe(50);

      // 10" paper = 10" * 10 CPI = 100 cols
      expect(deriveDotMatrixColumns("dot_matrix_10in", "10cpi")).toBe(100);

      // 12" paper = 12" * 10 CPI = 120 cols
      expect(deriveDotMatrixColumns("dot_matrix_12in", "10cpi")).toBe(120);

      // 15" paper = 15" * 10 CPI = 150 cols
      expect(deriveDotMatrixColumns("dot_matrix_15in", "10cpi")).toBe(150);
    });

    it("scales derived column counts correctly at 12 CPI (Elite) and 17 CPI (Condensed)", () => {
      // 10" paper at 12 CPI = 120 cols
      expect(deriveDotMatrixColumns("dot_matrix_10in", "12cpi")).toBe(120);

      // 10" paper at 17 CPI = 170 cols
      expect(deriveDotMatrixColumns("dot_matrix_10in", "17cpi_condensed")).toBe(170);

      // 12" paper at 12 CPI = 144 cols
      expect(deriveDotMatrixColumns("dot_matrix_12in", "12cpi")).toBe(144);

      // 15" paper at 17 CPI = 255 cols
      expect(deriveDotMatrixColumns("dot_matrix_15in", "17cpi_condensed")).toBe(255);
    });

    it("supports custom paper width in inches", () => {
      // 8.5" paper at 10 CPI = 85 cols
      expect(deriveDotMatrixColumns("dot_matrix_custom", "10cpi", { customWidthInches: 8.5 })).toBe(85);
      // 8.5" paper at 12 CPI = 102 cols
      expect(deriveDotMatrixColumns("dot_matrix_custom", "12cpi", { customWidthInches: 8.5 })).toBe(102);
    });

    it("reflows dot-matrix text cleanly across all 4 paper widths without truncation", () => {
      const widths: Array<"6in" | "10in" | "12in" | "15in"> = ["6in", "10in", "12in", "15in"];

      for (const w of widths) {
        const pSize = `dot_matrix_${w}` as any;
        const cols = deriveDotMatrixColumns(pSize, "10cpi");
        const rendered = dotMatrixRenderer.renderInvoice(sampleInvoice, {
          columns: cols,
          paperWidth: w,
        });

        expect(rendered).toBeDefined();
        expect(rendered).toContain("APEX SUPERMARKET");
        expect(rendered).toContain("Organic Green");
        expect(rendered).toContain("819.00");
      }
    });

    it("warns when selected paper width is wider than printer maximum carriage width", () => {
      const narrowPrinter = {
        name: "EPSON LX-310",
        displayName: "EPSON LX-310",
        isDefault: true,
        status: "ready" as const,
        printerType: "dot_matrix" as const,
        carriageWidthCols: 80, // 80 cols = 10 inches platen
        supportedPaperSizes: ["dot_matrix_6in" as const, "dot_matrix_10in" as const],
        isVirtual: false,
      };

      // 15" paper on 10" printer should trigger warning
      const check15in = isPaperWiderThanPrinter("dot_matrix_15in", narrowPrinter, null);
      expect(check15in.isWider).toBe(true);
      expect(check15in.paperWidthInches).toBe(15.0);
      expect(check15in.maxCarriageWidthInches).toBe(10.0);

      // 10" paper on 10" printer should NOT trigger warning
      const check10in = isPaperWiderThanPrinter("dot_matrix_10in", narrowPrinter, null);
      expect(check10in.isWider).toBe(false);

      // 6" paper on 10" printer should NOT trigger warning
      const check6in = isPaperWiderThanPrinter("dot_matrix_6in", narrowPrinter, null);
      expect(check6in.isWider).toBe(false);
    });
  });
});
