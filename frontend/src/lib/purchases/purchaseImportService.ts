export interface ColumnMappingSuggestion {
  columnName: string;
  mappedField: "item_name" | "batch_no" | "expiry_date" | "qty" | "purchase_rate" | "mrp" | "hsn_code" | "gst_percent" | "none";
}

export interface ExtractedOcrInvoice {
  supplier_name?: string;
  supplier_gstin?: string;
  invoice_number?: string;
  invoice_date?: string;
  lines: Array<{
    product_name: string;
    description?: string;
    hsn?: string;
    batch_no?: string;
    expiry_date?: string;
    qty: number;
    free_qty?: number;
    purchase_rate: number;
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

  parseDelimitedTable(rawText: string, delimiter?: string): {
    headers: string[];
    records: Record<string, string>[];
  } {
    const rawLines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (rawLines.length === 0) return { headers: [], records: [] };

    // Auto-detect delimiter if not specified
    const sep = delimiter || (rawLines[0].includes("\t") ? "\t" : ",");
    const headers = rawLines[0].split(sep).map((h) => h.trim().replace(/^["']|["']$/g, "").toLowerCase());

    const records: Record<string, string>[] = [];
    for (let i = 1; i < rawLines.length; i++) {
      const cells = rawLines[i].split(sep).map((c) => c.trim().replace(/^["']|["']$/g, ""));
      const record: Record<string, string> = {};
      headers.forEach((h, idx) => {
        record[h] = cells[idx] || "";
      });
      records.push(record);
    }

    return { headers, records };
  }

  parseOcrText(ocrText: string): ExtractedOcrInvoice {
    return this.extractInvoiceFromOcrText(ocrText);
  }

  extractInvoiceFromOcrText(ocrText: string): ExtractedOcrInvoice {
    const lines = ocrText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    let supplierName: string | undefined;
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

      if (!supplierName && (line.toLowerCase().includes("ltd") || line.toLowerCase().includes("pharma") || line.toLowerCase().includes("distributor"))) {
        supplierName = line;
      }
    }

    return {
      supplier_name: supplierName,
      supplier_gstin: supplierGstin,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      lines: extractedLines,
    };
  }
}

export const purchaseImportService = new PurchaseImportService();
