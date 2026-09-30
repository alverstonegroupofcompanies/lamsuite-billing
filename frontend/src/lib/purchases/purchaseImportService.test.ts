import { describe, it, expect } from "vitest";
import { purchaseImportService } from "./purchaseImportService";

describe("Purchase Import & OCR Extractor (PUR-005, PUR-006)", () => {
  describe("Column Mapping Engine", () => {
    it("suggests correct field mapping from diverse supplier spreadsheet headers", () => {
      const headers = [
        "Product Description",
        "Batch No",
        "EXP_DATE",
        "Quantity",
        "PTR (Rate)",
        "M.R.P",
        "HSN / SAC",
        "GST %",
        "Random Column",
      ];

      const mapping = purchaseImportService.suggestColumnMapping(headers);

      expect(mapping[0].mappedField).toBe("item_name");
      expect(mapping[1].mappedField).toBe("batch_no");
      expect(mapping[2].mappedField).toBe("expiry_date");
      expect(mapping[3].mappedField).toBe("qty");
      expect(mapping[4].mappedField).toBe("purchase_rate");
      expect(mapping[5].mappedField).toBe("mrp");
      expect(mapping[6].mappedField).toBe("hsn_code");
      expect(mapping[7].mappedField).toBe("gst_percent");
      expect(mapping[8].mappedField).toBe("none");
    });
  });

  describe("OCR Text Parser", () => {
    it("extracts supplier GSTIN, invoice number, and invoice date from OCR string", () => {
      const sampleOcrText = `
        APEX PHARMACEUTICAL DISTRIBUTORS
        GSTIN: 32AABCU9603R1ZM
        Tax Invoice No: INV/2026/8892
        Date: 28/09/2026
        ------------------------------------------
        1. Paracetamol 500mg  HSN: 3004  Qty: 50
      `;

      const res = purchaseImportService.parseOcrText(sampleOcrText);

      expect(res.supplier_gstin).toBe("32AABCU9603R1ZM");
      expect(res.invoice_number).toBe("INV/2026/8892");
      expect(res.invoice_date).toBe("28/09/2026");
    });
  });
});
