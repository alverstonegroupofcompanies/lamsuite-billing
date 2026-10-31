import type { PrintableDocumentData, PrintableDocumentHeader, ColumnFormat, ReportPrintFormattingOptions } from "../types";
import { dotMatrixRenderer, resolveLeftMargin } from "../../lib/printing/dotMatrixRenderer";

export class PrintFormatter {
  /**
   * Format numbers to Indian currency representation (e.g. 1,23,456.78)
   */
  formatIndianNumber(num: number): string {
    const n = Number(num) || 0;
    const parts = Math.abs(n).toFixed(2).split(".");
    let intPart = parts[0];
    const decPart = parts[1];

    if (intPart.length > 3) {
      const lastThree = intPart.substring(intPart.length - 3);
      const remaining = intPart.substring(0, intPart.length - 3);
      const formattedRemaining = remaining.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
      intPart = `${formattedRemaining},${lastThree}`;
    }

    return `${n < 0 ? "-" : ""}${intPart}.${decPart}`;
  }

  /**
   * Pad string to exact width with spaces
   */
  padField(str: string, width: number, align: "left" | "right" | "center" = "left"): string {
    const s = String(str ?? "");
    if (s.length >= width) {
      return s.substring(0, width);
    }
    const pad = width - s.length;
    if (align === "right") {
      return " ".repeat(pad) + s;
    }
    if (align === "center") {
      const leftPad = Math.floor(pad / 2);
      const rightPad = pad - leftPad;
      return " ".repeat(leftPad) + s + " ".repeat(rightPad);
    }
    return s + " ".repeat(pad);
  }

  /**
   * Universal cell formatter based on column format & options
   */
  formatCellValue(
    val: any,
    format?: ColumnFormat,
    options?: {
      isDotMatrix?: boolean;
      currencyPrefix?: string;
      colId?: string;
    }
  ): string {
    if (val === null || val === undefined || val === "") {
      return "-";
    }

    const isDotMatrix = options?.isDotMatrix ?? false;
    const currPrefix = options?.currencyPrefix ?? (isDotMatrix ? "" : "₹");
    const colId = (options?.colId || "").toLowerCase();

    // Inferred format if not explicitly set
    let activeFormat = format;
    if (!activeFormat) {
      if (typeof val === "number") {
        if (
          colId.includes("count") ||
          colId.includes("txn") ||
          colId.includes("qty") ||
          colId.includes("quantity") ||
          colId.includes("bill")
        ) {
          activeFormat = "number";
        } else if (
          colId.includes("percent") ||
          colId.includes("share") ||
          colId.includes("pct")
        ) {
          activeFormat = "percentage";
        } else {
          activeFormat = "currency";
        }
      } else if (typeof val === "string") {
        if (/^\d{4}-\d{2}-\d{2}/.test(val) || colId.includes("date")) {
          activeFormat = "date";
        }
      } else if (val instanceof Date) {
        activeFormat = "date";
      }
    }

    switch (activeFormat) {
      case "currency": {
        const num = Number(val);
        if (isNaN(num)) return String(val);
        const isNeg = num < 0;
        const absStr = this.formatIndianNumber(Math.abs(num));
        return isNeg ? `-${currPrefix}${absStr}` : `${currPrefix}${absStr}`;
      }

      case "percentage": {
        const num = Number(val);
        if (isNaN(num)) return String(val);
        return `${num.toFixed(1)}%`;
      }

      case "number": {
        const num = Number(val);
        if (isNaN(num)) return String(val);
        if (Number.isInteger(num)) {
          return num.toLocaleString("en-IN");
        }
        return num.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
      }

      case "date": {
        if (val instanceof Date && !isNaN(val.getTime())) {
          const dd = String(val.getDate()).padStart(2, "0");
          const mm = String(val.getMonth() + 1).padStart(2, "0");
          const yyyy = String(val.getFullYear());
          if (isDotMatrix) {
            return `${dd}/${mm}/${yyyy.slice(-2)}`;
          }
          return `${dd}/${mm}/${yyyy}`;
        }
        if (typeof val === "string") {
          const match = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (match) {
            if (isDotMatrix) {
              // Format compact DD/MM/YY for 80-column grid
              const yy = match[1].slice(-2);
              return `${match[3]}/${match[2]}/${yy}`;
            }
            return `${match[3]}/${match[2]}/${match[1]}`;
          }
        }
        return String(val);
      }

      default: {
        let str = String(val);
        if (isDotMatrix) {
          str = str
            .replace(/[├]/g, "|")
            .replace(/[└]/g, "\\")
            .replace(/[─]/g, "-")
            .replace(/[₹]/g, "Rs.");
        }
        return str;
      }
    }
  }

  /**
   * Concise header label for Dot Matrix to fit tight column grids
   */
  getDotMatrixHeaderLabel(h: PrintableDocumentHeader, width: number): string {
    const colId = h.id.toLowerCase();
    const clean = h.label.replace(/[₹]/g, "Rs.").replace(/\(₹\)/g, "(Rs)").trim();

    if (width <= 12) {
      if (colId.includes("taxable") || colId.includes("subtotal")) return "Taxable";
      if (colId.includes("cgst")) return "CGST";
      if (colId.includes("sgst")) return "SGST";
      if (colId.includes("igst")) return "IGST";
      if (colId.includes("grand_total") || colId.includes("total_amount") || colId === "total") return "Total";
      if (colId.includes("tax_total") || colId.includes("total_tax")) return "Tot.Tax";
      if (colId.includes("supplier") && (colId.includes("invoice") || colId.includes("bill") || colId.includes("no"))) return "Bill No";
      if (colId.includes("supplier") || colId.includes("customer") || colId.includes("party")) return "Party";
      if (colId.includes("payment")) return "Payment";
      if (colId.includes("date")) return "Date";
      if (colId.includes("invoice_number") || colId.includes("purchase_number") || colId.includes("bill") || colId.includes("voucher")) return "Voucher";
    }
    return clean;
  }

  /**
   * Distribute columns intelligently by content type for 80 or 132 columns with zero overflow guarantee
   */
  computeDotMatrixColumnWidths(headers: PrintableDocumentHeader[], totalWidth: number = 80): number[] {
    const n = headers.length;
    if (n === 0) return [];
    const spaces = n - 1;
    const avail = totalWidth - spaces;

    if (avail <= n * 3) {
      // Degenerate case: give equal minimal widths
      const w = Math.max(2, Math.floor(avail / n));
      return headers.map(() => w);
    }

    const isTight80 = totalWidth <= 80;

    // Assign proportional weights by content type
    const weights: number[] = headers.map((h) => {
      const colId = h.id.toLowerCase();
      let fmt = h.format;
      if (!fmt) {
        if (colId.includes("count") || colId.includes("txn") || colId.includes("qty")) fmt = "number";
        else if (colId.includes("percent") || colId.includes("share")) fmt = "percentage";
        else if (colId.includes("amount") || colId.includes("total") || colId.includes("tax") || colId.includes("rate") || colId.includes("subtotal")) fmt = "currency";
        else if (colId.includes("date")) fmt = "date";
      }

      // Party / Item Name (text column with most variable length)
      if (
        (colId.includes("name") || colId.includes("party") || colId.includes("desc") || colId.includes("customer") || colId.includes("supplier") || colId.includes("item")) &&
        !colId.includes("invoice") &&
        !colId.includes("bill") &&
        !colId.includes("voucher")
      ) {
        return isTight80 ? 15 : 28;
      }

      // Voucher / Bill / Invoice numbers
      if (
        colId.includes("voucher") ||
        colId.includes("bill") ||
        colId.includes("invoice") ||
        colId.includes("number") ||
        colId.includes("order") ||
        colId.includes("ref")
      ) {
        return isTight80 ? 9 : 14;
      }

      // Dates
      if (fmt === "date" || colId.includes("date")) {
        return isTight80 ? 8 : 11;
      }

      // Grand total / net invoice value
      if (colId.includes("grand_total") || colId.includes("total_amount") || colId === "total" || colId.includes("net_amount")) {
        return isTight80 ? 10 : 15;
      }

      // Taxable subtotal
      if (colId.includes("taxable") || colId.includes("subtotal")) {
        return isTight80 ? 9 : 14;
      }

      // Tax totals (CGST, SGST, IGST, tax_total)
      if (colId.includes("cgst") || colId.includes("sgst") || colId.includes("igst")) {
        return isTight80 ? 7 : 12;
      }
      if (colId.includes("tax")) {
        return isTight80 ? 8 : 13;
      }

      // Payment status / Mode
      if (fmt === "badge" || colId.includes("payment") || colId.includes("mode") || colId.includes("status")) {
        return isTight80 ? 7 : 12;
      }

      // Generic currency / number
      if (fmt === "currency") return isTight80 ? 8 : 13;
      if (fmt === "number") return isTight80 ? 5 : 8;
      if (fmt === "percentage") return isTight80 ? 6 : 9;

      return isTight80 ? 8 : 12;
    });

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    // Initial floor distribution ensuring minimum 4 chars per column
    const minColWidth = isTight80 && n >= 8 ? 4 : 5;
    const widths: number[] = weights.map((w) => {
      const raw = Math.floor((w / totalWeight) * avail);
      return Math.max(minColWidth, raw);
    });

    let currentSum = widths.reduce((sum, w) => sum + w, 0);

    // If sum exceeds avail due to minColWidth clamps, reduce from largest columns down to minColWidth
    if (currentSum > avail) {
      let excess = currentSum - avail;
      while (excess > 0) {
        let maxIdx = -1;
        let maxVal = minColWidth;
        for (let i = 0; i < n; i++) {
          if (widths[i] > maxVal) {
            maxVal = widths[i];
            maxIdx = i;
          }
        }
        if (maxIdx === -1) break; // All columns at minColWidth
        widths[maxIdx]--;
        excess--;
      }
    } else if (currentSum < avail) {
      // If sum is less than avail, distribute remaining characters 1-by-1 to highest weight columns
      let remaining = avail - currentSum;
      const sortedIndices = weights
        .map((w, idx) => ({ w, idx }))
        .sort((a, b) => b.w - a.w)
        .map((item) => item.idx);

      let cycle = 0;
      while (remaining > 0) {
        const targetIdx = sortedIndices[cycle % n];
        widths[targetIdx]++;
        remaining--;
        cycle++;
      }
    }

    return widths;
  }

  /**
   * Generate Dot Matrix plain text ASCII representation (60, 80, 120, or 132 columns)
   * Supports automatic horizontal centering offset within wider printer carriages.
   */
  generateDotMatrixText(
    doc: PrintableDocumentData,
    columns: number = 80,
    options?: { printerColumns?: number; autoCenter?: boolean; leftMarginSpaces?: number }
  ): string {
    const W = columns;
    const lines: string[] = [];

    // Header
    lines.push("=".repeat(W));
    lines.push(this.padField(doc.storeDetails.storeName.toUpperCase(), W, "center"));
    if (doc.storeDetails.address) {
      lines.push(this.padField(doc.storeDetails.address, W, "center"));
    }
    const storeInfoLine = [
      doc.storeDetails.phone ? `Ph: ${doc.storeDetails.phone}` : "",
      doc.storeDetails.gstin ? `GSTIN: ${doc.storeDetails.gstin}` : "",
      doc.storeDetails.dlNo ? `DL: ${doc.storeDetails.dlNo}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
    if (storeInfoLine) {
      lines.push(this.padField(storeInfoLine, W, "center"));
    }
    lines.push("-".repeat(W));
    const cleanTitle = (doc.title || "").replace(/[₹]/g, "Rs.").toUpperCase();
    lines.push(this.padField(cleanTitle, W, "center"));
    if (doc.subtitle) {
      lines.push(this.padField(doc.subtitle.replace(/[₹]/g, "Rs."), W, "center"));
    }
    lines.push(this.padField("(Amounts in Rs.)", W, "right"));
    lines.push("-".repeat(W));

    // Filter Summary
    if (doc.filterSummary && doc.filterSummary.length > 0) {
      const filterLine = doc.filterSummary.map((f) => `${f.label}: ${f.value}`).join("  |  ");
      lines.push(this.padField(filterLine, W, "left"));
      lines.push(this.padField(`Generated: ${doc.generatedAt}`, W, "left"));
      lines.push("-".repeat(W));
    }

    const numCols = doc.headers.length;
    if (numCols === 0) return lines.join("\n");

    const widths = this.computeDotMatrixColumnWidths(doc.headers, W);

    // Table Header
    const headerRow = doc.headers
      .map((h, i) => {
        const cleanLabel = this.getDotMatrixHeaderLabel(h, widths[i]);
        return this.padField(cleanLabel, widths[i], h.align || "left");
      })
      .join(" ");
    lines.push(headerRow);
    lines.push("-".repeat(W));

    // Table Rows
    for (const row of doc.rows) {
      const rowLine = doc.headers
        .map((h, i) => {
          const raw = row[h.id];
          const val = this.formatCellValue(raw, h.format, {
            isDotMatrix: true,
            currencyPrefix: "",
            colId: h.id,
          });
          return this.padField(val, widths[i], h.align || "left");
        })
        .join(" ");
      lines.push(rowLine);
    }

    lines.push("=".repeat(W));

    // Totals line if provided
    if (doc.totals) {
      const totalsLine = doc.headers
        .map((h, i) => {
          if (doc.totals![h.id] !== undefined) {
            const raw = doc.totals![h.id];
            const val = this.formatCellValue(raw, h.format, {
              isDotMatrix: true,
              currencyPrefix: "",
              colId: h.id,
            });
            return this.padField(val, widths[i], h.align || "right");
          }
          return i === 0 ? this.padField("TOTAL", widths[i], "left") : " ".repeat(widths[i]);
        })
        .join(" ");
      lines.push(totalsLine);
      lines.push("=".repeat(W));
    }

    lines.push(this.padField("*** END OF REPORT ***", W, "center"));

    const leftPad = resolveLeftMargin(
      {
        printerCarriageColumns: options?.printerColumns,
        autoCenterPaper: options?.autoCenter !== false,
        leftMarginSpaces: options?.leftMarginSpaces,
        paperWidth: W <= 65 ? "6in" : undefined,
      },
      W
    );
    if (leftPad.length > 0) {
      return lines.map((l) => leftPad + l).join("\n");
    }
    return lines.join("\n");
  }

  /**
   * Transforms multi-column financial registers into space-saving compact documents
   * by combining related fields (Voucher+Date, Party+Bill+Items, Tax Breakdown, Total+Status)
   */
  createCompactDocument(doc: PrintableDocumentData): PrintableDocumentData {
    // Only compact if document has 6 or more columns and matches standard register fields
    if (doc.headers.length < 6) return doc;

    const hIds = doc.headers.map((h) => h.id.toLowerCase());
    const hasVoucher = hIds.some((id) => id.includes("voucher") || id.includes("number") || id.includes("invoice_no") || id.includes("bill_no"));
    const hasParty = hIds.some((id) => id.includes("supplier") || id.includes("customer") || id.includes("party") || id.includes("name"));
    const hasTotal = hIds.some((id) => id.includes("grand") || id.includes("total") || id.includes("amount"));

    if (!hasVoucher || !hasParty || !hasTotal) return doc;

    // Detect column keys
    const voucherCol = doc.headers.find((h) => {
      const id = h.id.toLowerCase();
      return (id.includes("voucher") || id.includes("number") || id.includes("invoice_number")) && !id.includes("date");
    })?.id || doc.headers[0].id;

    const dateCol = doc.headers.find((h) => h.id.toLowerCase().includes("date"))?.id || "";

    const partyCol = doc.headers.find((h) => {
      const id = h.id.toLowerCase();
      return id.includes("supplier_name") || id.includes("customer_name") || id.includes("party_name") || id.includes("name");
    })?.id || "";

    const billRefCol = doc.headers.find((h) => {
      const id = h.id.toLowerCase();
      return (id.includes("supplier_invoice") || id.includes("bill_no") || id.includes("ref")) && id !== voucherCol;
    })?.id || "";

    const taxableCol = doc.headers.find((h) => {
      const id = h.id.toLowerCase();
      return id.includes("taxable") || id.includes("subtotal");
    })?.id || "";

    const cgstCol = doc.headers.find((h) => h.id.toLowerCase().includes("cgst"))?.id || "";
    const sgstCol = doc.headers.find((h) => h.id.toLowerCase().includes("sgst"))?.id || "";
    const taxTotalCol = doc.headers.find((h) => {
      const id = h.id.toLowerCase();
      return (id.includes("tax_total") || id.includes("total_tax")) || (id.includes("tax") && !id.includes("cgst") && !id.includes("sgst") && !id.includes("taxable"));
    })?.id || "";

    const grandTotalCol = doc.headers.find((h) => {
      const id = h.id.toLowerCase();
      return id.includes("grand_total") || id.includes("invoice_val") || id === "total" || id.includes("total_amount");
    })?.id || "";

    const statusCol = doc.headers.find((h) => {
      const id = h.id.toLowerCase();
      return id.includes("payment_status") || id.includes("status") || id.includes("mode") || id.includes("payment");
    })?.id || "";

    const isPurchase = doc.title.toLowerCase().includes("purchase") || doc.headers.some((h) => h.id.includes("supplier"));
    const partyLabel = isPurchase ? "SUPPLIER & DETAILS" : "CUSTOMER & DETAILS";

    // Compact Headers
    const compactHeaders: PrintableDocumentHeader[] = [
      { id: "col_voucher_date", label: "VOUCHER / DATE", align: "left" },
      { id: "col_party_details", label: partyLabel, align: "left" },
    ];

    if (taxableCol) {
      compactHeaders.push({ id: "col_taxable", label: "TAXABLE VALUE (₹)", align: "right", format: "currency" });
    }

    if (taxTotalCol || cgstCol) {
      compactHeaders.push({ id: "col_gst_breakdown", label: "TAX / GST (₹)", align: "right" });
    }

    compactHeaders.push({ id: "col_total_status", label: "INVOICE VALUE & STATUS", align: "right" });

    // Compact Rows
    const compactRows = doc.rows.map((row) => {
      const voucherVal = row[voucherCol] || "-";
      const dateRaw = dateCol ? row[dateCol] : "";
      const dateFormatted = this.formatCellValue(dateRaw, "date", { colId: dateCol });

      const partyVal = partyCol ? row[partyCol] : "-";
      const billRefVal = billRefCol ? row[billRefCol] : "";
      const itemsSummary = row.items_summary || row.items || "";

      // 1. Voucher & Date
      const voucherDateHtml = `
        <div class="col-code font-bold">${voucherVal}</div>
        ${dateFormatted && dateFormatted !== "-" ? `<div style="font-size: 8.5px; color: #64748b; margin-top: 1.5px;">${dateFormatted}</div>` : ""}
      `;

      // 2. Party, Bill No & Items
      let partyDetailsHtml = `<div class="col-name font-bold">${partyVal}</div>`;
      if (billRefVal && billRefVal !== "-") {
        partyDetailsHtml += `<div style="font-size: 8.5px; color: #475569; margin-top: 1.5px;">Bill: <span class="font-mono">${billRefVal}</span></div>`;
      }
      if (itemsSummary) {
        partyDetailsHtml += `<div style="font-size: 8px; color: #64748b; font-style: italic; margin-top: 1.5px; line-height: 1.25;">Items: ${itemsSummary}</div>`;
      }

      // 3. Taxable Value
      const taxableNum = taxableCol ? row[taxableCol] : undefined;

      // 4. Tax / GST with breakdown
      let taxTotalVal = 0;
      if (taxTotalCol && row[taxTotalCol] !== undefined) {
        taxTotalVal = Number(row[taxTotalCol]) || 0;
      } else if (cgstCol && sgstCol) {
        taxTotalVal = (Number(row[cgstCol]) || 0) + (Number(row[sgstCol]) || 0);
      }

      const cgstVal = cgstCol ? Number(row[cgstCol]) || 0 : 0;
      const sgstVal = sgstCol ? Number(row[sgstCol]) || 0 : 0;

      let gstHtml = `<div class="col-num font-bold">${this.formatCellValue(taxTotalVal, "currency")}</div>`;
      if (cgstVal > 0 || sgstVal > 0) {
        gstHtml += `<div style="font-size: 8px; color: #64748b; text-align: right; margin-top: 1.5px;">CGST: ${this.formatIndianNumber(cgstVal)} | SGST: ${this.formatIndianNumber(sgstVal)}</div>`;
      }

      // 5. Total & Status
      const grandTotalVal = grandTotalCol ? Number(row[grandTotalCol]) || 0 : 0;
      const statusRaw = statusCol ? String(row[statusCol] || "").trim() : "";
      const statusLower = statusRaw.toLowerCase();
      let bClass = "badge-neutral";
      if (statusLower === "paid" || statusLower === "cash" || statusLower === "received") bClass = "badge-success";
      else if (statusLower === "unpaid" || statusLower === "cancelled" || statusLower === "overdue") bClass = "badge-danger";
      else if (statusLower === "partial" || statusLower === "pending") bClass = "badge-warning";
      else if (statusLower === "upi" || statusLower === "card") bClass = "badge-info";

      const totalStatusHtml = `
        <div class="col-num font-bold">${this.formatCellValue(grandTotalVal, "currency")}</div>
        ${statusRaw ? `<div style="text-align: right; margin-top: 2px;"><span class="pill-badge ${bClass}">${statusRaw.toUpperCase()}</span></div>` : ""}
      `;

      return {
        col_voucher_date: voucherDateHtml,
        col_party_details: partyDetailsHtml,
        col_taxable: taxableNum,
        col_gst_breakdown: gstHtml,
        col_total_status: totalStatusHtml,
      };
    });

    // Compact Totals
    const compactTotals: Record<string, any> = {};
    if (doc.totals) {
      if (taxableCol && doc.totals[taxableCol] !== undefined) {
        compactTotals.col_taxable = doc.totals[taxableCol];
      }

      let totTax = 0;
      if (taxTotalCol && doc.totals[taxTotalCol] !== undefined) {
        totTax = Number(doc.totals[taxTotalCol]) || 0;
      } else if (cgstCol && sgstCol && doc.totals[cgstCol] !== undefined) {
        totTax = (Number(doc.totals[cgstCol]) || 0) + (Number(doc.totals[sgstCol]) || 0);
      }

      const totCgst = cgstCol && doc.totals[cgstCol] !== undefined ? Number(doc.totals[cgstCol]) || 0 : 0;
      const totSgst = sgstCol && doc.totals[sgstCol] !== undefined ? Number(doc.totals[sgstCol]) || 0 : 0;

      let totGstHtml = `<div class="col-num font-bold">${this.formatCellValue(totTax, "currency")}</div>`;
      if (totCgst > 0 || totSgst > 0) {
        totGstHtml += `<div style="font-size: 8px; color: #64748b; text-align: right; margin-top: 1.5px;">CGST: ${this.formatIndianNumber(totCgst)} | SGST: ${this.formatIndianNumber(totSgst)}</div>`;
      }
      compactTotals.col_gst_breakdown = totGstHtml;

      const totGrand = grandTotalCol && doc.totals[grandTotalCol] !== undefined ? Number(doc.totals[grandTotalCol]) || 0 : 0;
      compactTotals.col_total_status = `<div class="col-num font-bold">${this.formatCellValue(totGrand, "currency")}</div>`;
    }

    return {
      ...doc,
      headers: compactHeaders,
      rows: compactRows,
      totals: Object.keys(compactTotals).length > 0 ? compactTotals : undefined,
    };
  }

  /**
   * Generate HTML for A4 (Landscape/Portrait/Compact), Thermal, or Dot Matrix preview/printing
   */
  generatePrintHtml(
    doc: PrintableDocumentData,
    layout: "a4" | "a4-landscape" | "a4-portrait" | "a4-compact" | "thermal" | "dot-matrix" | "dot-matrix-60" | "dot-matrix-120" | "dot-matrix-132" = "a4",
    isCompact: boolean = false,
    options?: ReportPrintFormattingOptions
  ): string {
    const shouldCompact = isCompact || layout === "a4-compact";
    const activeDoc = shouldCompact ? this.createCompactDocument(doc) : doc;

    if (layout.startsWith("dot-matrix")) {
      const is6in = layout === "dot-matrix-60";
      const cols =
        is6in
          ? 50 // 5.0" usable body between 0.5" tractor margins
          : layout === "dot-matrix-120"
          ? 120
          : layout === "dot-matrix-132"
          ? 132
          : 80;
      const carriageCols = options?.printerColumns || (is6in ? 60 : cols);
      const text = this.generateDotMatrixText(activeDoc, cols, {
        printerColumns: carriageCols,
        autoCenter: options?.autoCenter !== false,
        leftMarginSpaces: options?.leftMarginSpaces,
      });
      return dotMatrixRenderer.generateMonospaceHtmlPreview(text, {
        columns: cols,
        paperWidth: is6in ? "6in" : undefined,
        printerCarriageColumns: carriageCols,
        autoCenterPaper: options?.autoCenter !== false,
        showRuler: true,
        showLineNumbers: true,
        showPageBreaks: true,
      });
    }

    if (layout === "thermal") {
      return this.generateThermalHtml(activeDoc);
    }

    if (layout === "a4-landscape") {
      return this.generateA4Html(activeDoc, "landscape", options);
    }

    if (layout === "a4-portrait" || layout === "a4-compact") {
      return this.generateA4Html(activeDoc, "portrait", options);
    }

    return this.generateA4Html(activeDoc, undefined, options);
  }

  /**
   * POS Thermal 80mm Receipt Roll Layout
   */
  private generateThermalHtml(doc: PrintableDocumentData): string {
    const isMultiColumn = doc.headers.length > 4;

    // Helper to format ISO date
    const formatDate = (val: any) => {
      if (typeof val === "string") {
        const m = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[3]}/${m[2]}/${m[1]}`;
      }
      return String(val || "-");
    };

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${doc.title}</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: #111827;
            background-color: #e2e8f0;
            margin: 0;
            padding: 20px 10px;
            display: flex;
            justify-content: center;
            min-height: 100vh;
          }
          .receipt-roll {
            width: 330px;
            background: #ffffff;
            box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.25), 0 0 1px rgba(0, 0, 0, 0.2);
            border-radius: 2px;
            padding: 16px 14px;
            box-sizing: border-box;
          }
          .tear-line {
            text-align: center;
            font-size: 9px;
            color: #94a3b8;
            letter-spacing: 2px;
            margin: 6px 0;
            user-select: none;
          }
          .store-name { font-size: 15px; font-weight: 800; color: #000; text-align: center; text-transform: uppercase; margin: 0; }
          .store-meta { font-size: 10px; color: #4b5563; text-align: center; margin-top: 2px; line-height: 1.3; }
          .dashed-divider { border-top: 1px dashed #4b5563; margin: 8px 0; }
          .double-divider { border-top: 2px solid #000; margin: 6px 0; }
          .report-title { font-size: 13px; font-weight: 700; text-align: center; text-transform: uppercase; margin: 2px 0; letter-spacing: 0.5px; }
          .filter-bar { font-size: 9.5px; text-align: center; color: #4b5563; margin-bottom: 4px; }
          
          /* Compact Multi-Column Card Mode (Sales Register, etc.) */
          .thermal-card {
            padding: 6px 0;
            border-bottom: 1px dashed #cbd5e1;
          }
          .thermal-card-top {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            font-size: 11px;
          }
          .thermal-card-bottom {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            font-size: 9.5px;
            color: #4b5563;
            margin-top: 2px;
          }

          /* Standard Table Mode for <= 4 columns */
          table { width: 100%; border-collapse: collapse; font-size: 10px; margin: 4px 0; }
          th {
            padding: 4px 2px;
            border-bottom: 1px solid #111827;
            font-weight: 700;
            font-size: 9.5px;
            text-transform: uppercase;
          }
          td { padding: 3.5px 2px; vertical-align: top; }
          .text-left { text-align: left; }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .subnote { font-size: 8.5px; color: #4b5563; font-style: italic; padding-left: 6px; padding-bottom: 3px; }

          .totals-wrap {
            margin-top: 8px;
            border-top: 1px dashed #111827;
            border-bottom: 2px solid #111827;
            padding: 6px 0;
          }
          .total-row {
            display: flex;
            justify-content: space-between;
            font-size: 10.5px;
            padding: 2px 0;
            color: #1f2937;
          }
          .total-row.grand-total {
            font-weight: 800;
            font-size: 12.5px;
            color: #000;
            border-top: 1px solid #e5e7eb;
            padding-top: 4px;
            margin-top: 2px;
          }
          .footer-note { text-align: center; font-size: 8.5px; color: #6b7280; margin-top: 10px; }

          @media print {
            body { background: white !important; padding: 0 !important; }
            .receipt-roll { box-shadow: none !important; width: 100% !important; padding: 0 !important; }
            .tear-line { display: none !important; }
          }
        </style>
      </head>
      <body>
        <div class="receipt-roll">
          <div class="tear-line">✂ - - - - - - - - - - - - - - - - - - - - ✂</div>
          
          <div class="store-name">${doc.storeDetails.storeName}</div>
          <div class="store-meta">${doc.storeDetails.address}</div>
          <div class="store-meta">
            ${[
              doc.storeDetails.phone ? `Ph: ${doc.storeDetails.phone}` : "",
              doc.storeDetails.gstin ? `GSTIN: ${doc.storeDetails.gstin}` : "",
              doc.storeDetails.dlNo ? `DL: ${doc.storeDetails.dlNo}` : "",
            ].filter(Boolean).join(" | ")}
          </div>

          <div class="dashed-divider"></div>
          <div class="report-title">${doc.title}</div>
          ${doc.filterSummary && doc.filterSummary.length > 0 ? `
            <div class="filter-bar">
              ${doc.filterSummary.map((f) => `${f.label}: ${f.value}`).join(" • ")}
            </div>
          ` : ""}
          <div class="dashed-divider"></div>

          ${isMultiColumn ? `
            <!-- Dense Multi-Column Register Mode -->
            <div>
              ${(() => {
                const voucherKey = doc.headers.find((h) => {
                  const id = h.id.toLowerCase();
                  return (id.includes("voucher") || id.includes("number") || id.includes("bill") || id.includes("invoice")) && !id.includes("date");
                })?.id;
                const partyKey = doc.headers.find((h) => {
                  const id = h.id.toLowerCase();
                  return id.includes("supplier") || id.includes("customer") || id.includes("party") || id.includes("name");
                })?.id;
                const dateKey = doc.headers.find((h) => h.id.toLowerCase().includes("date"))?.id;
                const paymentKey = doc.headers.find((h) => {
                  const id = h.id.toLowerCase();
                  return id.includes("payment") || id.includes("status") || id.includes("mode");
                })?.id;
                const taxableKey = doc.headers.find((h) => {
                  const id = h.id.toLowerCase();
                  return id.includes("taxable") || id.includes("subtotal");
                })?.id;
                const taxKey = doc.headers.find((h) => {
                  const id = h.id.toLowerCase();
                  return id.includes("tax_total") || id.includes("total_tax");
                })?.id;

                return doc.rows.map((row) => {
                  const billNo = (voucherKey ? row[voucherKey] : undefined) || row.invoice_number || row.purchase_number || row.bill_no || row.id || Object.values(row)[0];
                  const dateRaw = (dateKey ? row[dateKey] : undefined) || row.invoice_date || row.purchase_date || row.date || "";
                  const date = formatDate(dateRaw);
                  const payment = (paymentKey ? row[paymentKey] : undefined) || row.payment_status || row.payment_mode || row.payment || "";
                  const customer = (partyKey ? row[partyKey] : undefined) || row.supplier_name || row.customer_name || row.party_name || "";
                  
                  // Find primary amount (grand total or net sales)
                  const grandTotal = row.grand_total !== undefined 
                    ? this.formatCellValue(row.grand_total, "currency")
                    : row.amount !== undefined 
                    ? this.formatCellValue(row.amount, "currency") 
                    : row.total !== undefined
                    ? this.formatCellValue(row.total, "currency")
                    : "-";
                  
                  // Secondary amounts
                  const taxableVal = taxableKey ? row[taxableKey] : (row.taxable_subtotal !== undefined ? row.taxable_subtotal : row.subtotal);
                  const taxable = taxableVal !== undefined ? this.formatCellValue(taxableVal, "currency") : null;
                  
                  const taxVal = taxKey ? row[taxKey] : (row.total_tax !== undefined ? row.total_tax : row.tax_total);
                  const totalTax = taxVal !== undefined 
                    ? this.formatCellValue(taxVal, "currency") 
                    : (row.cgst_amount !== undefined && row.sgst_amount !== undefined)
                    ? this.formatCellValue((Number(row.cgst_amount) || 0) + (Number(row.sgst_amount) || 0), "currency")
                    : (row.cgst_total !== undefined && row.sgst_total !== undefined)
                    ? this.formatCellValue((Number(row.cgst_total) || 0) + (Number(row.sgst_total) || 0), "currency")
                    : null;

                return `
                  <div class="thermal-card">
                    <div class="thermal-card-top">
                      <span style="font-weight: 700; color: #000;">${billNo}</span>
                      <span style="color: #4b5563;">${date}${payment ? ` • ${payment}` : ""}</span>
                      <span style="font-weight: 700; color: #000;">${grandTotal}</span>
                    </div>
                    <div class="thermal-card-bottom">
                      <span style="color: #1f2937; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${customer || "-"}</span>
                      <span>${taxable ? `Taxable: ${taxable}` : ""}${totalTax ? ` | GST: ${totalTax}` : ""}</span>
                    </div>
                  </div>
                `;
                }).join("");
              })()}
            </div>
          ` : `
            <!-- Standard Compact Table Mode -->
            <table>
              <thead>
                <tr>
                  ${doc.headers.map((h) => `<th class="text-${h.align || "left"}">${h.label}</th>`).join("")}
                </tr>
              </thead>
              <tbody>
                ${doc.rows.map((row) => {
                  const noteVal = row.note || row.remarks || row.description;
                  const mainCells = doc.headers.map((h, i) => {
                    const raw = row[h.id];
                    const formatted = this.formatCellValue(raw, h.format, { colId: h.id });
                    const isSubItem = i === 0 && (String(raw).includes("├─") || String(raw).includes("└─") || String(raw).startsWith("  "));
                    const cleanText = isSubItem
                      ? `<span style="padding-left: 8px;">↳ ${String(formatted).replace(/[├─└]/g, "").trim()}</span>`
                      : formatted;
                    return `<td class="text-${h.align || "left"}">${cleanText}</td>`;
                  }).join("");

                  const noteHtml = noteVal ? `<tr><td colspan="${doc.headers.length}" class="subnote">↳ ${noteVal}</td></tr>` : "";
                  return `<tr>${mainCells}</tr>${noteHtml}`;
                }).join("")}
              </tbody>
            </table>
          `}

          ${doc.totals ? `
            <div class="totals-wrap">
              ${doc.headers.map((h) => {
                if (doc.totals![h.id] !== undefined) {
                  const formatted = this.formatCellValue(doc.totals![h.id], h.format, { colId: h.id });
                  const isGrand = h.id.includes("grand") || h.id === "amount" || h.id === "total";
                  return `
                    <div class="total-row ${isGrand ? "grand-total" : ""}">
                      <span>${h.label}:</span>
                      <span>${formatted}</span>
                    </div>
                  `;
                }
                return "";
              }).join("")}
            </div>
          ` : ""}

          <div class="footer-note">
            <div>Generated: ${doc.generatedAt}</div>
            <div>LamSuite Retail 2.0 • End of Report</div>
          </div>

          <div class="tear-line" style="margin-top: 12px;">✂ - - - - - - - - - - - - - - - - - - - - ✂</div>
        </div>
        <script>
          window.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              window.parent.postMessage({ type: 'MODAL_ESCAPE' }, '*');
            }
          }, true);
        </script>
      </body>
      </html>
    `;
  }

  /**
   * Proportional column width distributor for A4 Landscape / Portrait
   */
  computeA4ColumnWidths(headers: PrintableDocumentHeader[], isLandscape: boolean = false): string[] {
    const n = headers.length;
    if (n === 0) return [];

    const weights: number[] = headers.map((h) => {
      const colId = h.id.toLowerCase();
      const fmt = h.format;

      // Compact combined columns
      if (colId === "col_voucher_date") return 17;
      if (colId === "col_party_details") return 38;
      if (colId === "col_taxable") return 14;
      if (colId === "col_gst_breakdown") return 15;
      if (colId === "col_total_status") return 16;

      // Voucher / Invoice / Bill number / Order No / Ref No (checked before party name so supplier_invoice_no is treated as bill ref)
      if (
        (colId.includes("voucher") ||
          colId.includes("bill_no") ||
          colId.includes("invoice_no") ||
          colId.includes("bill") ||
          colId.includes("invoice") ||
          colId.includes("number") ||
          colId.includes("order_no") ||
          colId.includes("ref")) &&
        !colId.includes("name") &&
        !colId.includes("amount") &&
        !colId.includes("val") &&
        !colId.includes("date")
      ) {
        return isLandscape ? 12 : (n >= 8 ? 10 : 13);
      }

      // Party / Item / Product / Customer / Supplier Name or Description (flexible text)
      if (
        colId.includes("name") ||
        colId.includes("desc") ||
        colId.includes("party") ||
        colId.includes("item") ||
        colId.includes("customer") ||
        colId.includes("supplier") ||
        colId.includes("product")
      ) {
        return isLandscape ? 28 : (n >= 8 ? 26 : 30);
      }

      // Dates
      if (fmt === "date" || colId.includes("date") || colId.includes("expiry")) {
        return isLandscape ? 9 : (n >= 8 ? 8.5 : 10);
      }

      // Batch No / Barcode
      if (colId.includes("batch") || colId.includes("barcode")) {
        return isLandscape ? 9.5 : (n >= 8 ? 9 : 11);
      }

      // GSTIN / Tax ID / DL No
      if (colId.includes("gstin") || colId.includes("dl") || colId.includes("tax_id")) {
        return 12;
      }

      // Status / Payment / Mode / Badges
      if (fmt === "badge" || colId.includes("status") || colId.includes("payment") || colId.includes("mode")) {
        return isLandscape ? 8.5 : (n >= 8 ? 8 : 9.5);
      }

      // Numerical amounts
      if (fmt === "currency" || fmt === "number") {
        if (colId.includes("cgst") || colId.includes("sgst") || colId.includes("igst")) {
          return isLandscape ? 7.5 : (n >= 8 ? 7.5 : 9);
        }
        if (colId.includes("tax") || colId.includes("round") || colId.includes("cess")) {
          return isLandscape ? 8 : (n >= 8 ? 8 : 9.5);
        }
        if (
          colId.includes("grand") ||
          colId.includes("net") ||
          colId.includes("invoice_val") ||
          colId.includes("subtotal") ||
          colId.includes("taxable")
        ) {
          return isLandscape ? 10 : (n >= 8 ? 9.5 : 11.5);
        }
        if (colId.includes("qty") || colId.includes("stock") || colId.includes("count")) {
          return isLandscape ? 7.5 : (n >= 8 ? 7 : 8.5);
        }
        return isLandscape ? 9 : (n >= 8 ? 8.5 : 10);
      }

      if (fmt === "percentage" || colId.includes("pct") || colId.includes("percent")) {
        return 6.5;
      }

      return 10;
    });

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const percentages = weights.map((w) => Number(((w / totalWeight) * 100).toFixed(1)));
    const currentSum = Number(percentages.reduce((a, b) => a + b, 0).toFixed(1));
    const diff = Number((100 - currentSum).toFixed(1));
    percentages[0] = Number((percentages[0] + diff).toFixed(1));

    return percentages.map((p) => `${p}%`);
  }

  /**
   * Executive A4 Report Layout (Landscape / Portrait)
   */
  generateA4Html(
    doc: PrintableDocumentData,
    orientation?: "portrait" | "landscape",
    options?: ReportPrintFormattingOptions
  ): string {
    const isLandscape = orientation === "landscape" || (!orientation && doc.headers.length >= 7);
    const colWidths = this.computeA4ColumnWidths(doc.headers, isLandscape);

    // Dynamic density & typography based on column count and settings
    const nCols = doc.headers.length;
    const isDensePortrait = !isLandscape && nCols >= 8;
    const isMediumPortrait = !isLandscape && nCols === 7;

    // Font size settings
    let fontBasePx = isDensePortrait ? 9.5 : isMediumPortrait ? 10.5 : 11.5;
    if (options?.fontSize === "small") fontBasePx *= 0.88;
    if (options?.fontSize === "large") fontBasePx *= 1.15;

    // Cell padding
    const cellPadding = isDensePortrait
      ? "3.5px 3px"
      : isMediumPortrait
      ? "4.5px 5px"
      : isLandscape && nCols >= 10
      ? "4px 4px"
      : "6px 7px";

    // Margins
    const pageMargins =
      options?.margins === "compact"
        ? (isLandscape ? "6mm 8mm" : "8mm 10mm")
        : options?.margins === "none"
        ? "4mm 4mm"
        : (isLandscape ? "8mm 10mm" : "10mm 12mm");

    const sheetPadding =
      options?.margins === "compact"
        ? (isLandscape ? "8mm 10mm" : "10mm 12mm")
        : options?.margins === "none"
        ? "6mm 6mm"
        : (isLandscape ? "10mm 12mm" : "12mm 14mm");

    // Multi-page pagination calculation
    const page1MaxRows = isDensePortrait ? 26 : isLandscape ? 16 : 22;
    const pageOtherMaxRows = isDensePortrait ? 32 : isLandscape ? 22 : 28;

    const pages: Array<typeof doc.rows> = [];
    if (doc.rows.length <= page1MaxRows) {
      pages.push(doc.rows);
    } else {
      pages.push(doc.rows.slice(0, page1MaxRows));
      let cur = page1MaxRows;
      while (cur < doc.rows.length) {
        pages.push(doc.rows.slice(cur, cur + pageOtherMaxRows));
        cur += pageOtherMaxRows;
      }
    }
    const totalPages = pages.length;
    const operatorName = options?.operatorName || "Authorized Staff";

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${doc.title}</title>
        <style>
          @page {
            size: ${isLandscape ? "A4 landscape" : "A4 portrait"};
            margin: ${pageMargins};
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: #0f172a;
            background-color: #cbd5e1;
            margin: 0;
            padding: 24px 16px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 24px;
            min-height: 100vh;
            overflow-x: hidden;
          }
          .a4-sheet {
            width: ${isLandscape ? "297mm" : "210mm"};
            max-width: ${isLandscape ? "297mm" : "210mm"};
            min-height: ${isLandscape ? "210mm" : "297mm"};
            flex-shrink: 0;
            background: #ffffff;
            box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.15), 0 0 1px rgba(0, 0, 0, 0.2);
            border: 1px solid #cbd5e1;
            border-radius: 2px;
            padding: ${sheetPadding};
            display: flex;
            flex-direction: column;
            box-sizing: border-box;
            overflow: hidden;
          }
          .header-wrap {
            border-bottom: 2px solid #0f172a;
            padding-bottom: 8px;
            margin-bottom: 10px;
          }
          .header-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
          }
          .store-title {
            font-size: 19px;
            font-weight: 800;
            color: #0f172a;
            letter-spacing: -0.02em;
            margin: 0;
            text-transform: uppercase;
          }
          .store-meta {
            font-size: 10px;
            color: #475569;
            margin-top: 2px;
          }
          .report-header {
            margin-top: 6px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
          }
          .report-title {
            font-size: 14px;
            font-weight: 800;
            color: #0f172a;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            margin: 0;
          }
          .report-subtitle {
            font-size: 10px;
            color: #64748b;
            margin-top: 2px;
          }
          .running-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #cbd5e1;
            padding-bottom: 6px;
            margin-bottom: 8px;
            font-size: 10px;
            color: #475569;
          }
          .running-header strong {
            color: #0f172a;
          }
          .filter-box {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 10px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            padding: 5px 10px;
            margin-bottom: 8px;
            font-size: 9.5px;
          }
          .filter-pill { color: #334155; }
          .filter-pill strong { color: #0f172a; font-weight: 600; }

          table {
            width: 100%;
            max-width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            margin-top: 2px;
            border: 1px solid #94a3b8;
          }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
          tr { page-break-inside: avoid; break-inside: avoid; }

          th {
            background-color: #f8fafc;
            color: #1e293b;
            font-weight: 700;
            font-size: ${isDensePortrait ? "8px" : "8.5px"};
            padding: ${cellPadding};
            border-top: 1.5px solid #94a3b8;
            border-bottom: 2px solid #475569;
            border-right: 1px solid #cbd5e1;
            text-transform: uppercase;
            letter-spacing: 0.02em;
            white-space: normal;
            line-height: 1.15;
            word-break: normal;
          }
          th:last-child {
            border-right: none;
          }
          td {
            padding: ${cellPadding};
            border-bottom: 1px solid #e2e8f0;
            border-right: 1px solid #e2e8f0;
            font-size: ${fontBasePx}px;
            color: #1e293b;
            vertical-align: middle;
            overflow: hidden;
          }
          td:last-child {
            border-right: none;
          }
          tr:nth-child(even) td { background-color: #fafbfc; }

          /* Column Typography & Behavior */
          .col-code {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-weight: 600;
            color: #0f172a;
            white-space: nowrap;
            letter-spacing: -0.01em;
            font-size: ${isDensePortrait ? "8.5px" : "9px"};
            text-decoration: none;
          }
          .col-date {
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
            text-align: center;
            font-size: ${isDensePortrait ? "8.5px" : "9px"};
          }
          .col-name {
            font-weight: 600;
            color: #0f172a;
            line-height: 1.25;
            overflow-wrap: break-word;
            word-break: normal;
            font-size: ${isDensePortrait ? "9px" : "9.5px"};
          }
          .col-num {
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
            text-align: right;
            font-size: ${isDensePortrait ? "8.5px" : fontBasePx + "px"};
            letter-spacing: -0.01em;
          }
          .col-badge {
            white-space: nowrap;
            text-align: center;
          }

          .indent-tree {
            color: #64748b;
            margin-right: 4px;
            font-family: monospace;
          }
          .negative-amt {
            color: #dc2626 !important;
            font-weight: 600;
          }

          /* Status Badges */
          .pill-badge {
            display: inline-block;
            font-size: 8.5px;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 4px;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            white-space: nowrap;
            line-height: 1;
          }
          .badge-success { background-color: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
          .badge-danger { background-color: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
          .badge-warning { background-color: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
          .badge-info { background-color: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
          .badge-neutral { background-color: #f8fafc; color: #475569; border: 1px solid #cbd5e1; }

          tfoot td {
            font-weight: 700;
            background-color: #f8fafc !important;
            border-top: 2px solid #0f172a;
            border-bottom: 2px solid #0f172a;
            border-right: 1px solid #cbd5e1;
            color: #0f172a;
            font-size: ${isDensePortrait ? "8.5px" : fontBasePx + "px"};
            padding: ${cellPadding};
            letter-spacing: -0.01em;
          }
          tfoot td:last-child {
            border-right: none;
          }
          .text-left { text-align: left; }
          .text-center { text-align: center; }
          .text-right { text-align: right; }

          .spacer-fill { flex-grow: 1; min-height: 12px; }

          .footer-section {
            margin-top: 14px;
            padding-top: 8px;
            border-top: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            font-size: 9px;
            color: #64748b;
          }
          .page-counter-box {
            font-weight: 600;
            color: #334155;
            font-size: 9px;
          }
          .sign-box {
            text-align: center;
            border-top: 1px solid #94a3b8;
            padding-top: 3px;
            width: 130px;
            font-size: 8.5px;
            font-weight: 600;
            color: #334155;
          }

          @media print {
            body { background: white !important; padding: 0 !important; margin: 0 !important; display: block !important; }
            .a4-sheet {
              box-shadow: none !important;
              border: none !important;
              margin: 0 !important;
              padding: ${sheetPadding} !important;
              width: 100% !important;
              min-height: auto !important;
              page-break-after: always !important;
              break-after: page !important;
            }
            .a4-sheet:last-child {
              page-break-after: auto !important;
              break-after: auto !important;
            }
            table {
              border: 1px solid #94a3b8 !important;
            }
            th {
              border-top: 1.5px solid #94a3b8 !important;
              border-bottom: 2px solid #475569 !important;
              border-right: 1px solid #cbd5e1 !important;
            }
            th:last-child {
              border-right: none !important;
            }
            td {
              border-bottom: 1px solid #cbd5e1 !important;
              border-right: 1px solid #cbd5e1 !important;
            }
            td:last-child {
              border-right: none !important;
            }
            tfoot td {
              border-top: 2px solid #000000 !important;
              border-bottom: 2px solid #000000 !important;
              border-right: 1px solid #cbd5e1 !important;
            }
            tfoot td:last-child {
              border-right: none !important;
            }
            .pill-badge {
              background: transparent !important;
              color: #000000 !important;
              border: 1px solid #64748b !important;
              font-weight: 700 !important;
            }
          }
        </style>
      </head>
      <body>
        ${pages
          .map((pageRows, pageIdx0) => {
            const pageNum = pageIdx0 + 1;
            const isFirstPage = pageNum === 1;
            const isLastPage = pageNum === totalPages;

            return `
              <div class="a4-sheet page-sheet" id="page-${pageNum}" data-page="${pageNum}">
                ${
                  isFirstPage
                    ? `
                  ${
                    options?.showHeader !== false
                      ? `
                    <div class="header-wrap">
                      <div class="header-top">
                        <div>
                          <div class="store-title">${doc.storeDetails.storeName}</div>
                          <div class="store-meta">${doc.storeDetails.address}</div>
                          <div class="store-meta">
                            ${[
                              doc.storeDetails.phone ? `Phone: ${doc.storeDetails.phone}` : "",
                              doc.storeDetails.gstin ? `GSTIN: ${doc.storeDetails.gstin}` : "",
                              doc.storeDetails.dlNo ? `DL: ${doc.storeDetails.dlNo}` : "",
                            ]
                              .filter(Boolean)
                              .join(" | ")}
                          </div>
                        </div>
                      </div>
                      <div class="report-header">
                        <div>
                          <div class="report-title">${doc.title}</div>
                          ${doc.subtitle ? `<div class="report-subtitle">${doc.subtitle}</div>` : ""}
                        </div>
                      </div>
                    </div>
                  `
                      : ""
                  }

                  ${
                    options?.showFilterSummary !== false && doc.filterSummary && doc.filterSummary.length > 0
                      ? `
                    <div class="filter-box">
                      ${doc.filterSummary
                        .map((f) => `<div class="filter-pill"><strong>${f.label}:</strong> ${f.value}</div>`)
                        .join("")}
                      <div class="filter-pill" style="margin-left: auto;"><strong>Generated:</strong> ${doc.generatedAt}</div>
                    </div>
                  `
                      : ""
                  }
                `
                    : `
                  <div class="running-header">
                    <div><strong>${doc.storeDetails.storeName}</strong> • ${doc.title}</div>
                    <div class="page-counter">Page ${pageNum} of ${totalPages}</div>
                  </div>
                `
                }

                <table class="report-table">
                  <colgroup>
                    ${colWidths.map((w) => `<col style="width: ${w};">`).join("")}
                  </colgroup>
                  <thead>
                    <tr>
                      ${doc.headers.map((h) => `<th class="text-${h.align || "left"}">${h.label}</th>`).join("")}
                    </tr>
                  </thead>
                  <tbody>
                    ${pageRows
                      .map(
                        (row) => `
                      <tr>
                        ${doc.headers
                          .map((h, i) => {
                            const raw = row[h.id];
                            const formatted = this.formatCellValue(raw, h.format, { colId: h.id });
                            const isNeg = typeof raw === "number" && raw < 0;
                            const isSubItem =
                              i === 0 &&
                              (String(raw).includes("├─") || String(raw).includes("└─") || String(raw).startsWith("  "));

                            let cellContent = formatted;
                            if (
                              typeof raw === "string" &&
                              (raw.startsWith("<div") || raw.startsWith("<span") || raw.includes("<div"))
                            ) {
                              cellContent = raw;
                            } else if (isSubItem) {
                              cellContent = `<span class="indent-tree">↳</span><span>${String(formatted)
                                .replace(/[├─└]/g, "")
                                .trim()}</span>`;
                            } else if (
                              h.format === "badge" ||
                              h.id.toLowerCase().includes("payment") ||
                              h.id.toLowerCase().includes("status")
                            ) {
                              const valStr = String(raw ?? "")
                                .trim()
                                .toLowerCase();
                              let bClass = "badge-neutral";
                              if (
                                valStr === "paid" ||
                                valStr === "received" ||
                                valStr === "success" ||
                                valStr === "active" ||
                                valStr === "cash" ||
                                valStr === "adjusted"
                              ) {
                                bClass = "badge-success";
                              } else if (
                                valStr === "unpaid" ||
                                valStr === "overdue" ||
                                valStr === "cancelled" ||
                                valStr === "danger"
                              ) {
                                bClass = "badge-danger";
                              } else if (
                                valStr === "partial" ||
                                valStr === "pending" ||
                                valStr === "draft" ||
                                valStr === "warning"
                              ) {
                                bClass = "badge-warning";
                              } else if (
                                valStr === "upi" ||
                                valStr === "card" ||
                                valStr === "bank" ||
                                valStr === "info" ||
                                valStr === "refunded"
                              ) {
                                bClass = "badge-info";
                              }
                              cellContent = `<span class="pill-badge ${bClass}">${formatted}</span>`;
                            }

                            const colId = h.id.toLowerCase();
                            const align =
                              h.align || (h.format === "currency" || h.format === "number" ? "right" : "left");
                            const classes: string[] = [`text-${align}`];

                            if (isNeg) classes.push("negative-amt");

                            if (
                              colId.includes("voucher") ||
                              colId.includes("invoice_no") ||
                              colId.includes("bill_no") ||
                              colId.includes("number") ||
                              colId.includes("code") ||
                              colId.includes("hsn")
                            ) {
                              classes.push("col-code");
                            } else if (h.format === "date" || colId.includes("date")) {
                              classes.push("col-date");
                            } else if (
                              colId.includes("name") ||
                              colId.includes("party") ||
                              colId.includes("supplier") ||
                              colId.includes("customer") ||
                              colId.includes("product")
                            ) {
                              classes.push("col-name");
                            } else if (h.format === "currency" || h.format === "number" || h.format === "percentage") {
                              classes.push("col-num");
                            } else if (h.format === "badge" || colId.includes("status") || colId.includes("payment")) {
                              classes.push("col-badge");
                            }

                            return `<td class="${classes.join(" ")}">${cellContent}</td>`;
                          })
                          .join("")}
                      </tr>
                    `
                      )
                      .join("")}
                  </tbody>
                  ${
                    isLastPage && doc.totals
                      ? `
                    <tfoot>
                      <tr>
                        ${(() => {
                          const firstTotalIdx = doc.headers.findIndex((h) => doc.totals![h.id] !== undefined);
                          const itemLabel =
                            doc.title.toLowerCase().includes("purchase") || doc.title.toLowerCase().includes("sale")
                              ? doc.rows.length === 1
                                ? "Bill"
                                : "Bills"
                              : doc.rows.length === 1
                              ? "Record"
                              : "Records";
                          const totalLabelText = `TOTAL (${doc.rows.length} ${itemLabel})`;

                          if (firstTotalIdx > 0) {
                            const labelCell = `<td colspan="${firstTotalIdx}" class="text-left font-bold" style="color: #0f172a; white-space: nowrap; padding-left: 6px;">${totalLabelText}</td>`;
                            const totalCells = doc.headers
                              .slice(firstTotalIdx)
                              .map((h) => {
                                if (doc.totals![h.id] !== undefined) {
                                  const raw = doc.totals![h.id];
                                  const formatted =
                                    typeof raw === "string" && (raw.startsWith("<div") || raw.includes("<div"))
                                      ? raw
                                      : this.formatCellValue(raw, h.format, { colId: h.id });
                                  const isNeg = typeof raw === "number" && raw < 0;
                                  const align = h.align || "right";
                                  return `<td class="text-${align} col-num${isNeg ? " negative-amt" : ""}">${formatted}</td>`;
                                }
                                return `<td></td>`;
                              })
                              .join("");
                            return labelCell + totalCells;
                          } else {
                            return doc.headers
                              .map((h, i) => {
                                if (doc.totals![h.id] !== undefined) {
                                  const raw = doc.totals![h.id];
                                  const formatted =
                                    typeof raw === "string" && (raw.startsWith("<div") || raw.includes("<div"))
                                      ? raw
                                      : this.formatCellValue(raw, h.format, { colId: h.id });
                                  const isNeg = typeof raw === "number" && raw < 0;
                                  const align = h.align || "right";
                                  return `<td class="text-${align} col-num${isNeg ? " negative-amt" : ""}">${formatted}</td>`;
                                }
                                if (i === 0) {
                                  return `<td class="text-left font-bold" style="color: #0f172a; white-space: nowrap; padding-left: 6px;">${totalLabelText}</td>`;
                                }
                                return `<td></td>`;
                              })
                              .join("");
                          }
                        })()}
                      </tr>
                    </tfoot>
                  `
                      : ""
                  }
                </table>

                <div class="spacer-fill"></div>

                ${
                  options?.showFooter !== false
                    ? `
                  <div class="footer-section">
                    <div>
                      <div>Printed from LamSuite Retail 2.0 • Financial Audit Report</div>
                      <div style="margin-top: 2px;">Generated: ${doc.generatedAt} • User: ${operatorName}</div>
                    </div>
                    <div class="page-counter-box">
                      Page ${pageNum} of ${totalPages}
                    </div>
                    ${
                      isLastPage
                        ? `
                      <div class="sign-box">
                        Authorized Signatory
                      </div>
                    `
                        : ""
                    }
                  </div>
                `
                    : ""
                }
              </div>
            `;
          })
          .join("")}
        <script>
          window.addEventListener("keydown", function(e) {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              window.parent.postMessage({ type: "MODAL_ESCAPE" }, "*");
            }
          }, true);
        </script>
      </body>
      </html>
    `;
  }
}

export const printFormatter = new PrintFormatter();
