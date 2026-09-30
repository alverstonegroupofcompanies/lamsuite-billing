export interface ColumnMappingSuggestion {
  columnName: string;
  mappedField: "item_name" | "batch_no" | "expiry_date" | "qty" | "purchase_rate" | "mrp" | "hsn_code" | "gst_percent" | "none";
}

export interface ExtractedOcrInvoice {
  supplier_gstin?: string;
  invoice_number?: string;
  invoice_date?: string;
  lines: Array<{
    description: string;
    hsn?: string;
    batch?: string;
    expiry?: string;
    qty: number;
    rate: number;
    gst_percent?: number;
  }>;
}

export class PurchaseImportService {
  suggestColumnMapping(headers: string[]): ColumnMappingSuggestion[] {
    return headers.map((header) => {
      const h = header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

      if (h.includes("item") || h.includes("product") || h.includes("description") || h.includes("particulars")) {
        return { columnName: header, mappedField: "item_name" };
      }
      if (h.includes("batch") || h.includes("lot")) {
        return { columnName: header, mappedField: "batch_no" };
      }
      if (h.includes("exp")) {
        return { columnName: header, mappedField: "expiry_date" };
      }
      if (h.includes("qty") || h.includes("quantity")) {
        return { columnName: header, mappedField: "qty" };
      }
      if (h.includes("rate") || h.includes("cost") || h.includes("price") || h.includes("ptr")) {
        return { columnName: header, mappedField: "purchase_rate" };
      }
      if (h.includes("mrp")) {
        return { columnName: header, mappedField: "mrp" };
      }
      if (h.includes("hsn") || h.includes("sac")) {
        return { columnName: header, mappedField: "hsn_code" };
      }
      if (h.includes("gst") || h.includes("tax")) {
        return { columnName: header, mappedField: "gst_percent" };
      }

      return { columnName: header, mappedField: "none" };
    });
  }

  parseOcrText(ocrText: string): ExtractedOcrInvoice {
    const lines = ocrText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    let supplierGstin: string | undefined;
    let invoiceNumber: string | undefined;
    let invoiceDate: string | undefined;
    const extractedLines: ExtractedOcrInvoice["lines"] = [];

    // 1. Extract GSTIN
    const gstinRegex = /\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})\b/i;
    for (const line of lines) {
      const gstinMatch = line.match(gstinRegex);
      if (gstinMatch && !supplierGstin) {
        supplierGstin = gstinMatch[1].toUpperCase();
      }

      if (!invoiceNumber) {
        const invMatch = line.match(/\b(?:tax\s+invoice|invoice|inv|bill)\s*(?:no\.?|#)?\s*[:\-]?\s*([A-Za-z0-9\/\-]+)/i);
        if (invMatch) invoiceNumber = invMatch[1].trim();
      }

      if (!invoiceDate) {
        const dateMatch = line.match(/\b(?:date)?\s*[:\-]?\s*(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/i);
        if (dateMatch) invoiceDate = dateMatch[1].trim();
      }
    }

    return {
      supplier_gstin: supplierGstin,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      lines: extractedLines,
    };
  }
}

export const purchaseImportService = new PurchaseImportService();
