export interface ParsedSheet {
  sheetName: string;
  headers: string[];
  rows: Record<string, any>[];
  totalRows: number;
}

export interface ParseResult {
  fileName: string;
  sheets: ParsedSheet[];
  activeSheetIndex: number;
}

/**
 * Universal CSV / TSV / Excel Spreadsheet Parser.
 * Zero-dependency RFC 4180 parser and Excel SpreadsheetML XML reader.
 */
export class UniversalDataParser {
  /**
   * Parse raw text, CSV, TSV, or Excel XML file content.
   */
  parseText(rawText: string, fileName = "import.csv"): ParseResult {
    const cleanText = rawText.replace(/^\uFEFF/, ""); // Remove UTF-8 BOM

    // Check if it's an XML Spreadsheet (SpreadsheetML) commonly exported by Marg/Busy/Tally
    if (cleanText.includes("<?xml") || cleanText.includes("<Workbook") || cleanText.includes("<ss:Workbook")) {
      return this.parseSpreadsheetXml(cleanText, fileName);
    }

    // Otherwise, treat as Delimited Text (CSV, TSV, Semicolon)
    const sheet = this.parseDelimited(cleanText, "Sheet1");
    return {
      fileName,
      sheets: [sheet],
      activeSheetIndex: 0,
    };
  }

  /**
   * Auto-detect delimiter from the first non-empty lines.
   */
  detectDelimiter(text: string): string {
    const sampleLines = text.split(/\r?\n/).slice(0, 5).filter((l) => l.trim().length > 0);
    if (sampleLines.length === 0) return ",";

    const counts = {
      "\t": 0,
      ",": 0,
      ";": 0,
      "|": 0,
    };

    for (const line of sampleLines) {
      counts["\t"] += (line.match(/\t/g) || []).length;
      counts[","] += (line.match(/,/g) || []).length;
      counts[";"] += (line.match(/;/g) || []).length;
      counts["|"] += (line.match(/\|/g) || []).length;
    }

    let bestDelimiter = ",";
    let maxCount = 0;
    for (const [delim, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        bestDelimiter = delim;
      }
    }
    return bestDelimiter;
  }

  /**
   * RFC 4180 compliant CSV / TSV parser supporting quoted fields and embedded newlines.
   */
  parseDelimited(text: string, sheetName = "Sheet1"): ParsedSheet {
    const delimiter = this.detectDelimiter(text);
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = "";
    let insideQuotes = false;

    let i = 0;
    while (i < text.length) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (insideQuotes) {
        if (char === '"' && nextChar === '"') {
          // Escaped double quote
          currentCell += '"';
          i += 2;
          continue;
        } else if (char === '"') {
          // Closing quote
          insideQuotes = false;
          i++;
          continue;
        } else {
          currentCell += char;
          i++;
          continue;
        }
      } else {
        if (char === '"') {
          insideQuotes = true;
          i++;
          continue;
        } else if (char === delimiter) {
          currentRow.push(currentCell.trim());
          currentCell = "";
          i++;
          continue;
        } else if (char === "\r" && nextChar === "\n") {
          currentRow.push(currentCell.trim());
          if (currentRow.some((c) => c.length > 0)) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentCell = "";
          i += 2;
          continue;
        } else if (char === "\n" || char === "\r") {
          currentRow.push(currentCell.trim());
          if (currentRow.some((c) => c.length > 0)) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentCell = "";
          i++;
          continue;
        } else {
          currentCell += char;
          i++;
          continue;
        }
      }
    }

    // Last field / row
    if (currentCell.length > 0 || currentRow.length > 0) {
      currentRow.push(currentCell.trim());
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
    }

    if (rows.length === 0) {
      return { sheetName, headers: [], rows: [], totalRows: 0 };
    }

    // Extract headers from first non-empty row
    const rawHeaders = rows[0];
    const headers = rawHeaders.map((h, idx) => (h && h.length > 0 ? h : `Column_${idx + 1}`));

    const recordList: Record<string, any>[] = [];
    for (let r = 1; r < rows.length; r++) {
      const rowValues = rows[r];
      // Skip completely empty lines
      if (rowValues.every((val) => !val || val.trim().length === 0)) continue;
      // Skip secondary header / field-key metadata row (e.g. row 2 containing "barcode", "name", "hsn_sac_code")
      if (r === 1 && this.isSecondaryHeaderRow(headers, rowValues)) continue;

      const record: Record<string, any> = {};
      headers.forEach((header, colIdx) => {
        record[header] = rowValues[colIdx] ?? "";
      });
      recordList.push(record);
    }

    return {
      sheetName,
      headers,
      rows: recordList,
      totalRows: recordList.length,
    };
  }

  /**
   * Detect if a row immediately following the main header row is a secondary technical field-key row
   * or a repeated header row (e.g., from 2-row templates where row 1 is labels and row 2 is field keys).
   */
  private isSecondaryHeaderRow(headers: string[], rowValues: string[]): boolean {
    const nonEmpty = rowValues.map((v) => (v ?? "").trim()).filter((v) => v.length > 0);
    if (nonEmpty.length < 2) return false;

    const knownFieldKeys = new Set([
      "barcode",
      "name",
      "print_name",
      "generic_name",
      "hsn_sac_code",
      "gst_percent",
      "cess_percent",
      "mrp",
      "sel_rate",
      "ptr",
      "pts",
      "cost_price",
      "units_per_pack",
      "rack_location",
      "shelf_location",
      "reorder_level",
      "category_name",
      "brand_name",
      "unit_name",
      "is_active",
      "batch_no",
      "expiry_date",
      "mfg_date",
      "stock_qty",
      "phone",
      "gstin",
      "email",
      "address",
      "place_of_supply",
      "credit_limit",
      "invoice_number",
      "invoice_date",
      "supplier_name",
      "party_name",
      "total_amount",
      "return_number",
      "quotation_number",
      "schema_name",
      "account_name",
      "head_name",
      "code",
    ]);

    const norm = (s: string) =>
      s
        .trim()
        .toLowerCase()
        .replace(/%/g, "_percent")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    let matchesCount = 0;
    for (let i = 0; i < rowValues.length; i++) {
      const cell = (rowValues[i] ?? "").trim();
      if (!cell) continue;
      const normCell = norm(cell);
      const normHeader = norm(headers[i] ?? "");

      if (
        knownFieldKeys.has(cell.toLowerCase()) ||
        (normCell.length > 1 && normCell === normHeader) ||
        (normCell.length > 2 && normHeader.includes(normCell) && /^[a-z][a-z0-9_]*$/.test(cell))
      ) {
        matchesCount++;
      }
    }

    return matchesCount >= Math.ceil(nonEmpty.length * 0.5);
  }

  /**
   * Parse SpreadsheetML (Excel 2003 XML / Marg / Tally XML).
   */
  parseSpreadsheetXml(xmlContent: string, fileName: string): ParseResult {
    const sheets: ParsedSheet[] = [];

    // Simple regex-based multi-sheet extraction to avoid DOMParser browser-only dependency in Node/Vitest
    const worksheetRegex = /<(?:ss:)?Worksheet[^>]*?(?:ss:)?Name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:ss:)?Worksheet>/gi;
    let match: RegExpExecArray | null;

    while ((match = worksheetRegex.exec(xmlContent)) !== null) {
      const sheetName = match[1];
      const sheetBody = match[2];

      const rowRegex = /<((?:ss:)?Row[^>]*)>([\s\S]*?)<\/(?:ss:)?Row>/gi;
      const parsedRows: string[][] = [];

      let rowMatch: RegExpExecArray | null;
      while ((rowMatch = rowRegex.exec(sheetBody)) !== null) {
        const rowTagAttrs = rowMatch[1];
        // Skip template CodeStyle secondary header rows explicitly
        if (/StyleID\s*=\s*["']CodeStyle["']/i.test(rowTagAttrs)) {
          continue;
        }
        const cellBody = rowMatch[2];
        const cellRegex = /<(?:ss:)?Data[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/gi;
        const cells: string[] = [];

        let cellMatch: RegExpExecArray | null;
        while ((cellMatch = cellRegex.exec(cellBody)) !== null) {
          cells.push(cellMatch[1].trim());
        }
        if (cells.length > 0) {
          parsedRows.push(cells);
        }
      }

      if (parsedRows.length > 0) {
        const headers = parsedRows[0].map((h, idx) => h || `Col_${idx + 1}`);
        const dataRows: Record<string, any>[] = [];

        for (let i = 1; i < parsedRows.length; i++) {
          if (i === 1 && this.isSecondaryHeaderRow(headers, parsedRows[i])) {
            continue;
          }
          const rec: Record<string, any> = {};
          headers.forEach((h, idx) => {
            rec[h] = parsedRows[i][idx] ?? "";
          });
          dataRows.push(rec);
        }

        sheets.push({
          sheetName,
          headers,
          rows: dataRows,
          totalRows: dataRows.length,
        });
      }
    }

    if (sheets.length === 0) {
      // Fallback: parse as delimited text if XML tags had no standard Worksheet tags
      return {
        fileName,
        sheets: [this.parseDelimited(xmlContent, "Sheet1")],
        activeSheetIndex: 0,
      };
    }

    return {
      fileName,
      sheets,
      activeSheetIndex: 0,
    };
  }
}

export const universalDataParser = new UniversalDataParser();
