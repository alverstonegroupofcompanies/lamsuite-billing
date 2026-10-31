import { InvoicePrintData, CreditNotePrintData, DebitNotePrintData, HsnSummaryRow, calculateHsnSummary, numberToWordsIndian } from "./printingEngine";
import { jsPDF } from "jspdf";

export type DotMatrixCommandSet = "esc_p" | "tvs_native" | "plain_ascii";
export type DotMatrixPitch = "10cpi" | "12cpi" | "17cpi_condensed";
export type DotMatrixEndOfJob = "stop_immediately" | "feed_tear_off" | "form_feed";
export type DotMatrixPaperWidth = "6in" | "10in" | "12in" | "15in" | number;

export interface DotMatrixOptions {
  columns?: number; // 50 (usable area between tractor perforations), 60 (full 6"), 80 (10"), 120 (12"), 132 (15"/condensed) or custom
  printerCarriageColumns?: number; // Physical carriage width of printer (e.g. 80, 100, 120, 132, 136)
  autoCenterPaper?: boolean; // Center continuous paper relative to wider carriage (default true)
  tractorFeedMargin?: boolean; // Account for 0.5" (5 cols) perforated tractor-feed strips on each side (default true for 6in continuous paper)
  paperWidth?: DotMatrixPaperWidth; // Physical paper width loaded in printer
  linesPerPage?: number; // default 66 lines for 11", 72 for 12", 33 for 6" half-page, 0 for Continuous
  cpi?: DotMatrixPitch;
  commandSet?: DotMatrixCommandSet;
  currencyPrefix?: string; // "Rs." by default
  doubleStrikeCarbon?: boolean; // For carbon copy readability
  prePrintedStationery?: boolean; // Print data only at set positions
  leftMarginSpaces?: number; // 0 to 8 spaces
  topMarginLines?: number; // 0 to 6 blank lines
  showHsnSummary?: boolean;
  showDoctorPatient?: boolean;
  showDrugLicenses?: boolean;
  showTerms?: boolean;
  isDuplicate?: boolean;
  copyMarker?: string;
  truncateDescriptions?: boolean; // If false, wraps descriptions on next line
  endOfJobAction?: DotMatrixEndOfJob; // default "stop_immediately"
  feedLinesForTearOff?: number; // 0 to 10 lines (default 0)
}

export interface DotMatrixPreviewOptions {
  columns?: number; // 50, 60, 80, 120, 132 or custom
  printerCarriageColumns?: number;
  autoCenterPaper?: boolean;
  tractorFeedMargin?: boolean;
  paperWidth?: DotMatrixPaperWidth;
  showRuler?: boolean;
  showLineNumbers?: boolean;
  showPageBreaks?: boolean;
  showTractorFeed?: boolean;
  enableBold?: boolean;
  endOfJobAction?: DotMatrixEndOfJob;
  feedLinesForTearOff?: number;
}

/**
 * Resolves total left margin spaces, including automatic horizontal centering offset
 * when smaller paper is used inside a wider printer carriage, accounting for 0.5" (5 cols)
 * tractor-feed perforated margins, plus any user-specified manual margin.
 */
export function resolveLeftMargin(options?: DotMatrixOptions, paperCols?: number): string {
  const manualMargin = Math.max(0, options?.leftMarginSpaces || 0);
  const carriageCols = options?.printerCarriageColumns;
  const autoCenter = options?.autoCenterPaper !== false;
  const paperWidth = options?.paperWidth;

  const is6inTractor =
    paperWidth === "6in" ||
    (typeof paperWidth === "number" && paperWidth <= 7) ||
    paperCols === 50 ||
    options?.tractorFeedMargin === true ||
    (paperCols !== undefined && paperCols <= 55);

  if (is6inTractor) {
    const paperPhysicalCols = 60; // 6.0" physical continuous form
    const tractorMargin = options?.tractorFeedMargin !== false ? 5 : 0; // 0.5" perforated margin past pinfeed holes
    let paperLeftOffset = 0;
    if (autoCenter && carriageCols && carriageCols > paperPhysicalCols) {
      paperLeftOffset = Math.floor((carriageCols - paperPhysicalCols) / 2);
    }
    const totalSpaces = paperLeftOffset + tractorMargin + manualMargin;
    return totalSpaces > 0 ? " ".repeat(totalSpaces) : "";
  }

  // Standard 60, 80, 120, 132 columns paper without tractor offset
  let autoOffset = 0;
  if (autoCenter && carriageCols && paperCols && carriageCols > paperCols) {
    autoOffset = Math.floor((carriageCols - paperCols) / 2);
  }

  const totalSpaces = autoOffset + manualMargin;
  return totalSpaces > 0 ? " ".repeat(totalSpaces) : "";
}

/**
 * Resolves effective columns based on explicit columns or paper width in inches.
 */
export function resolveDotMatrixColumns(options?: { columns?: number; paperWidth?: DotMatrixPaperWidth }): number {
  if (options?.columns && options.columns > 0) {
    return options.columns;
  }
  if (options?.paperWidth) {
    if (typeof options.paperWidth === "number") {
      if (options.paperWidth <= 7) return 50; // 5.0" usable printable area between 0.5" tractor margins
      if (options.paperWidth <= 11) return 80;
      if (options.paperWidth <= 13) return 120;
      return 132;
    }
    switch (options.paperWidth) {
      case "6in":
        return 50; // 5.0" usable printable area between 0.5" tractor margins
      case "10in":
        return 80;
      case "12in":
        return 120;
      case "15in":
        return 132;
    }
  }
  return 80;
}

export class DotMatrixRenderer {
  /**
   * Pads string to right with spaces (left-aligned text).
   */
  padRight(str: string | number | undefined | null, width: number): string {
    const s = String(str ?? "");
    if (s.length >= width) return s.substring(0, width);
    return s + " ".repeat(width - s.length);
  }

  /**
   * Pads string to left with spaces (right-aligned numbers/currency).
   */
  padLeft(str: string | number | undefined | null, width: number): string {
    const s = String(str ?? "");
    if (s.length >= width) return s.substring(0, width);
    return " ".repeat(width - s.length) + s;
  }

  /**
   * Centers string within a given column width.
   */
  center(str: string | number | undefined | null, width: number): string {
    const s = String(str ?? "").trim();
    if (s.length >= width) return s.substring(0, width);
    const leftPad = Math.floor((width - s.length) / 2);
    const rightPad = width - s.length - leftPad;
    return " ".repeat(leftPad) + s + " ".repeat(rightPad);
  }

  /**
   * Robustly formats expiry date to standard MM/YY (5 characters).
   * Parses YYYY-MM, YYYY-MM-DD, MM/YYYY, MM/YY, etc. Never truncates to "2027-".
   */
  formatExpiry(exp?: string): string {
    if (!exp) return "-";
    const trimmed = exp.trim();
    // Case 1: YYYY-MM or YYYY-MM-DD
    const ymd = trimmed.match(/^(\d{4})[-/](\d{1,2})/);
    if (ymd) {
      const yr = ymd[1].slice(-2);
      const mo = ymd[2].padStart(2, "0");
      return `${mo}/${yr}`;
    }
    // Case 2: MM/YYYY or MM/YY
    const mmy = trimmed.match(/^(\d{1,2})[-/](\d{2,4})/);
    if (mmy) {
      const mo = mmy[1].padStart(2, "0");
      const yr = mmy[2].slice(-2);
      return `${mo}/${yr}`;
    }
    return trimmed.substring(0, 5);
  }

  /**
   * Robustly formats invoice/document date to DD-MM-YYYY (with optional HH:mm)
   * in store local time, without UTC day-shift errors.
   */
  formatInvoiceDate(dateStr?: string, timeStr?: string): string {
    if (!dateStr) return "-";
    const s = dateStr.trim();
    // Match YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sss
    const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2}))?/);
    if (ymd) {
      const yr = ymd[1];
      const mo = ymd[2].padStart(2, "0");
      const da = ymd[3].padStart(2, "0");
      let res = `${da}-${mo}-${yr}`;
      if (timeStr && timeStr.trim()) {
        res += ` ${timeStr.trim()}`;
      } else if (ymd[4] && ymd[5]) {
        res += ` ${ymd[4].padStart(2, "0")}:${ymd[5].padStart(2, "0")}`;
      }
      return res;
    }
    // Match DD-MM-YYYY or DD/MM/YYYY
    const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[T\s](\d{1,2}):(\d{1,2}))?/);
    if (dmy) {
      const da = dmy[1].padStart(2, "0");
      const mo = dmy[2].padStart(2, "0");
      const yr = dmy[3];
      let res = `${da}-${mo}-${yr}`;
      if (timeStr && timeStr.trim()) {
        res += ` ${timeStr.trim()}`;
      } else if (dmy[4] && dmy[5]) {
        res += ` ${dmy[4].padStart(2, "0")}:${dmy[5].padStart(2, "0")}`;
      }
      return res;
    }
    return s;
  }

  /**
   * Generates a standard formatted hex dump (offset, hex, ASCII) for raw print job inspection.
   */
  formatHexDump(bytes: Uint8Array): string {
    const lines: string[] = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = bytes.slice(i, i + 16);
      const offset = i.toString(16).padStart(8, "0");
      let hexPart = "";
      let asciiPart = "";
      for (let j = 0; j < 16; j++) {
        if (j < chunk.length) {
          const b = chunk[j];
          hexPart += b.toString(16).padStart(2, "0").toUpperCase() + " ";
          asciiPart += b >= 32 && b <= 126 ? String.fromCharCode(b) : ".";
        } else {
          hexPart += "   ";
        }
        if (j === 7) hexPart += " ";
      }
      lines.push(`${offset}  ${hexPart} |${asciiPart}|`);
    }
    return lines.join("\n");
  }

  /**
   * Wraps long text into lines of specified maximum width at word boundaries.
   */
  wrapText(text: string, width: number): string[] {
    if (!text) return [];
    const words = text.trim().split(/\s+/);
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      if (!currentLine) {
        if (word.length > width) {
          let remaining = word;
          while (remaining.length > width) {
            lines.push(remaining.substring(0, width));
            remaining = remaining.substring(width);
          }
          currentLine = remaining;
        } else {
          currentLine = word;
        }
      } else if (currentLine.length + 1 + word.length <= width) {
        currentLine += " " + word;
      } else {
        lines.push(currentLine);
        if (word.length > width) {
          let remaining = word;
          while (remaining.length > width) {
            lines.push(remaining.substring(0, width));
            remaining = remaining.substring(width);
          }
          currentLine = remaining;
        } else {
          currentLine = word;
        }
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  /**
   * Formats numbers to 2 decimal places with Indian grouping commas.
   */
  formatAmount(num: number | undefined | null): string {
    if (num === undefined || num === null || isNaN(num)) return "0.00";
    return Number(num).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: true,
    });
  }

  /**
   * Formats quantity with loose pieces (e.g. "1" or "1+4L").
   */
  formatQty(qty: number, looseQty?: number): string {
    if (looseQty && looseQty > 0) {
      return `${qty}+${looseQty}L`;
    }
    return String(qty);
  }

  /**
   * Generates formatted continuous dot-matrix text for a Tax Invoice (6-inch/60C, 10-inch/80C, 12-inch/120C, or 132C).
   */
  renderInvoice(data: InvoicePrintData, options?: DotMatrixOptions): string {
    const cols = resolveDotMatrixColumns(options);
    if (options?.prePrintedStationery) {
      return this.renderPrePrintedInvoice(data, options);
    }
    if (cols <= 65) {
      return this.renderInvoice60(data, options, cols);
    }
    if (cols >= 125) {
      return this.renderInvoice132(data, options, cols);
    }
    if (cols >= 100 && cols < 125) {
      return this.renderInvoice120(data, options, cols);
    }
    return this.renderInvoice80(data, options, cols);
  }

  /**
   * 6-Inch Compact Dot Matrix Format (~60 columns, e.g. 6-inch continuous forms / counter vouchers).
   * Formats text, metadata, tables and totals so they fit neatly on narrow paper without clipping.
   */
  private renderInvoice60(data: InvoicePrintData, options?: DotMatrixOptions, customCols?: number): string {
    const cols = customCols || 60;
    const linesPerPage = options?.linesPerPage !== undefined ? options.linesPerPage : 66;
    const curr = options?.currencyPrefix || "Rs.";
    const leftMargin = resolveLeftMargin(options, cols);
    const divDouble = leftMargin + "=".repeat(cols);
    const divSingle = leftMargin + "-".repeat(cols);

    // Build Header Section Lines
    const headerLines: string[] = [];
    if (options?.topMarginLines) {
      for (let i = 0; i < options.topMarginLines; i++) headerLines.push("");
    }

    // 1. Store Details (Centered within 60 columns)
    headerLines.push(leftMargin + this.center(data.store_name.toUpperCase(), cols));
    if (data.store_address) {
      const addrLines = this.wrapText(data.store_address, cols);
      addrLines.forEach((l) => headerLines.push(leftMargin + this.center(l, cols)));
    }

    const contactParts: string[] = [];
    if (data.store_phone) contactParts.push(`Ph: ${data.store_phone}`);
    if (data.store_email) contactParts.push(`Email: ${data.store_email}`);
    if (contactParts.length > 0) {
      const lines = this.wrapText(contactParts.join(" | "), cols);
      lines.forEach((l) => headerLines.push(leftMargin + this.center(l, cols)));
    }

    if (data.store_gstin) {
      headerLines.push(leftMargin + this.center(`GSTIN: ${data.store_gstin}`, cols));
    }

    if (options?.showDrugLicenses !== false && data.drug_license_numbers && data.drug_license_numbers.length > 0) {
      const dlStr = `DL: ${data.drug_license_numbers.join(", ")}`;
      const lines = this.wrapText(dlStr, cols);
      lines.forEach((l) => headerLines.push(leftMargin + this.center(l, cols)));
    }

    if (data.fssai_no) {
      headerLines.push(leftMargin + this.center(`FSSAI: ${data.fssai_no}`, cols));
    }

    headerLines.push(divDouble);

    // 2. Title & Copy Marker (Centered in 60 columns)
    const isDup = options?.isDuplicate || options?.copyMarker;
    const dupText = options?.copyMarker || "DUPLICATE COPY";
    headerLines.push(leftMargin + this.center("TAX INVOICE", cols));
    if (isDup) {
      headerLines.push(leftMargin + this.center(`*** ${dupText} ***`, cols));
    }

    headerLines.push(divSingle);

    // Document & Customer Meta Grid (2 Columns: Left 26/33 cols, Right 24/27 cols)
    const is50Col = cols <= 55;
    const leftColWidth = is50Col ? 26 : Math.min(34, Math.floor(cols * 0.55));
    const rightColWidth = cols - leftColWidth;

    const leftMeta: string[] = [];
    leftMeta.push(`Customer : ${(data.customer_name || "Walk-in").substring(0, leftColWidth - 11)}`);
    leftMeta.push(`Phone    : ${(data.customer_phone || "-").substring(0, leftColWidth - 11)}`);
    if (data.customer_gstin) {
      leftMeta.push(`GSTIN    : ${data.customer_gstin.substring(0, leftColWidth - 11)}`);
    }
    if (options?.showDoctorPatient !== false) {
      if (data.patient_name) {
        const pat = `Patient  : ${data.patient_name}${data.patient_age ? ` (${data.patient_age}Y/${data.patient_gender || ""})` : ""}`;
        leftMeta.push(pat.substring(0, leftColWidth));
      }
      if (data.doctor_name) {
        const doc = `Doctor   : ${data.doctor_name}${data.doctor_reg_no ? ` [${data.doctor_reg_no}]` : ""}`;
        leftMeta.push(doc.substring(0, leftColWidth));
      }
    }

    const rightMeta: string[] = [];
    if (is50Col) {
      rightMeta.push(`Inv No: #${data.invoice_number}`.substring(0, rightColWidth));
      rightMeta.push(`Date  : ${this.formatInvoiceDate(data.invoice_date)}`.substring(0, rightColWidth));
      rightMeta.push(`Pay   : ${data.payment_mode || "Cash"}`.substring(0, rightColWidth));
      if (data.place_of_supply) {
        rightMeta.push(`POS   : ${data.place_of_supply}`.substring(0, rightColWidth));
      }
    } else {
      rightMeta.push(`Invoice No : #${data.invoice_number}`);
      rightMeta.push(`Date       : ${this.formatInvoiceDate(data.invoice_date, data.invoice_time)}`);
      rightMeta.push(`Payment    : ${data.payment_mode || "Cash"}`);
      if (data.place_of_supply) {
        rightMeta.push(`POS        : ${data.place_of_supply}`);
      }
    }

    const maxMetaRows = Math.max(leftMeta.length, rightMeta.length);
    for (let i = 0; i < maxMetaRows; i++) {
      const l = this.padRight(leftMeta[i] || "", leftColWidth);
      const r = this.padRight(rightMeta[i] || "", rightColWidth);
      headerLines.push(leftMargin + (l + r).substring(0, cols));
    }

    headerLines.push(divSingle);

    // Item Table Header: 50 cols (usable area between tractor perforations) or 60 cols
    const descW = is50Col ? 14 : 20;
    const batchW = is50Col ? 6 : 7;
    const expW = 5;
    const qtyW = 4;
    const rateW = is50Col ? 6 : 7;
    const amtW = is50Col ? 7 : 9;

    const itemTableHead = `${this.padRight("#", 2)} ${this.padRight(is50Col ? "Item Desc" : "Item Description", descW)} ${this.padRight("Batch", batchW)} ${this.padRight("Exp", expW)} ${this.padLeft("Qty", qtyW)} ${this.padLeft("Rate", rateW)} ${this.padLeft("Amount", amtW)}`;
    headerLines.push(leftMargin + itemTableHead);
    headerLines.push(divSingle);

    // Build Item Rows
    const itemLines: string[] = [];
    data.lines.forEach((item, idx) => {
      const num = this.padRight(idx + 1, 2);
      const descFirst = item.description.substring(0, descW).padEnd(descW);
      const batch = this.padRight((item.batch_no || "-").substring(0, batchW), batchW);
      const exp = this.padRight(this.formatExpiry(item.expiry_date), expW);
      const qty = this.padLeft(this.formatQty(item.qty, item.loose_qty), qtyW);
      const rate = this.padLeft(item.rate.toFixed(2), rateW);
      const amt = this.padLeft(this.formatAmount(item.amount), amtW);

      itemLines.push(`${leftMargin}${num} ${descFirst} ${batch} ${exp} ${qty} ${rate} ${amt}`);

      // Indented secondary line if description was wrapped or to display HSN/GST
      if (options?.truncateDescriptions !== true && item.description.length > descW) {
        const remainingDesc = item.description.substring(descW, descW + 30).trim();
        const taxNote = item.hsn_code ? ` [HSN:${item.hsn_code} GST:${item.gst_percent}%]` : ` [GST:${item.gst_percent}%]`;
        const extraLine = ("   " + remainingDesc + taxNote).substring(0, cols);
        itemLines.push(leftMargin + extraLine);
      }
    });

    // Build Footer Section
    const footerLines: string[] = [];
    footerLines.push(divSingle);

    // HSN Tax Summary (Compact for 50/60 cols)
    if (options?.showHsnSummary !== false) {
      const hsnRows = calculateHsnSummary(data.lines);
      if (hsnRows.length > 0) {
        if (is50Col) {
          // 49-50 cols: HSN/SAC(7) Taxable(11) CGST(9) SGST(9) TotTax(9) = 49 cols
          const hsnHead = `${this.padRight("HSN/SAC", 7)} ${this.padLeft("Taxable(Rs)", 11)} ${this.padLeft("CGST", 9)} ${this.padLeft("SGST", 9)} ${this.padLeft("TotTax", 9)}`;
          footerLines.push(leftMargin + hsnHead);
          footerLines.push(divSingle);
          hsnRows.forEach((h) => {
            const hCode = this.padRight(h.hsnCode, 7);
            const tVal = this.padLeft(this.formatAmount(h.taxableValue), 11);
            const cgst = this.padLeft(`${h.cgstRate}% ${this.formatAmount(h.cgstAmount)}`, 9);
            const sgst = this.padLeft(`${h.sgstRate}% ${this.formatAmount(h.sgstAmount)}`, 9);
            const totTax = this.padLeft(this.formatAmount(h.totalTax), 9);
            footerLines.push(`${leftMargin}${hCode} ${tVal} ${cgst} ${sgst} ${totTax}`);
          });
          footerLines.push(divSingle);
        } else {
          // HSN/SAC  Taxable(Rs) CGST% CGST(Rs) SGST% SGST(Rs) TotalTax (Exact 60 Cols: 8+1+12+1+5+1+8+1+5+1+8+1+8 = 59-60)
          const hsnHead = `${this.padRight("HSN/SAC", 8)} ${this.padLeft("Taxable(Rs)", 12)} ${this.padLeft("CGST%", 5)} ${this.padLeft("CGST(Rs)", 8)} ${this.padLeft("SGST%", 5)} ${this.padLeft("SGST(Rs)", 8)} ${this.padLeft("TotTax", 8)}`;
          footerLines.push(leftMargin + hsnHead);
          footerLines.push(divSingle);
          hsnRows.forEach((h) => {
            const hCode = this.padRight(h.hsnCode, 8);
            const tVal = this.padLeft(this.formatAmount(h.taxableValue), 12);
            const cRate = this.padLeft(`${h.cgstRate}%`, 5);
            const cAmt = this.padLeft(this.formatAmount(h.cgstAmount), 8);
            const sRate = this.padLeft(`${h.sgstRate}%`, 5);
            const sAmt = this.padLeft(this.formatAmount(h.sgstAmount), 8);
            const totTax = this.padLeft(this.formatAmount(h.totalTax), 8);
            footerLines.push(`${leftMargin}${hCode} ${tVal} ${cRate} ${cAmt} ${sRate} ${sAmt} ${totTax}`);
          });
          footerLines.push(divSingle);
        }
      }
    }

    // Totals Box (Right Aligned to 60 cols)
    const isInterState = (data.igst_total !== undefined && data.igst_total > 0);
    const subtotalStr = `Taxable Subtotal  : ${curr} ` + this.padLeft(this.formatAmount(data.subtotal), 11);
    footerLines.push(leftMargin + this.padLeft(subtotalStr, cols));

    if (isInterState) {
      const igstStr = `Integrated (IGST) : ${curr} ` + this.padLeft(this.formatAmount(data.igst_total || data.tax_total), 11);
      footerLines.push(leftMargin + this.padLeft(igstStr, cols));
    } else if (data.cgst_total !== undefined && data.sgst_total !== undefined) {
      const cgstStr = `Central GST (CGST): ${curr} ` + this.padLeft(this.formatAmount(data.cgst_total), 11);
      const sgstStr = `State GST (SGST)  : ${curr} ` + this.padLeft(this.formatAmount(data.sgst_total), 11);
      footerLines.push(leftMargin + this.padLeft(cgstStr, cols));
      footerLines.push(leftMargin + this.padLeft(sgstStr, cols));
    } else if (data.tax_total > 0) {
      const taxStr = `GST Tax Total     : ${curr} ` + this.padLeft(this.formatAmount(data.tax_total), 11);
      footerLines.push(leftMargin + this.padLeft(taxStr, cols));
    }

    if (data.cess_total && data.cess_total > 0) {
      const cessStr = `Cess Total        : ${curr} ` + this.padLeft(this.formatAmount(data.cess_total), 11);
      footerLines.push(leftMargin + this.padLeft(cessStr, cols));
    }

    if (data.round_off && Math.abs(data.round_off) > 0.001) {
      const roStr = `Round Off         : ${curr} ` + this.padLeft(this.formatAmount(data.round_off), 11);
      footerLines.push(leftMargin + this.padLeft(roStr, cols));
    }

    footerLines.push(divDouble);
    const grandTotalStr = `GRAND TOTAL       : ${curr} ` + this.padLeft(this.formatAmount(data.grand_total), 11);
    footerLines.push(leftMargin + this.padLeft(grandTotalStr, cols));
    footerLines.push(divDouble);

    if (data.payments && data.payments.length > 0) {
      for (const p of data.payments) {
        const pStr = `Paid via ${p.mode}: ${curr} ` + this.padLeft(this.formatAmount(p.amount), 11);
        footerLines.push(leftMargin + this.padLeft(pStr, cols));
      }
      if (data.change_due && data.change_due > 0) {
        const chgStr = `Change Returned   : ${curr} ` + this.padLeft(this.formatAmount(data.change_due), 11);
        footerLines.push(leftMargin + this.padLeft(chgStr, cols));
      }
      footerLines.push(divSingle);
    }

    // Amount in Words
    const words = data.amount_in_words || numberToWordsIndian(data.grand_total);
    const wordsLines = this.wrapText(`Amount in Words: ${words}`, cols);
    wordsLines.forEach((w) => footerLines.push(leftMargin + w));

    if (data.upi_vpa) {
      footerLines.push(leftMargin + `UPI ID: ${data.upi_vpa}`);
    }

    if (options?.showTerms !== false && data.terms_and_conditions) {
      const terms = this.wrapText(`Terms: ${data.terms_and_conditions}`, cols);
      terms.forEach((t) => footerLines.push(leftMargin + t));
    }

    footerLines.push("");
    const signRow = `Customer Signature` + " ".repeat(Math.max(2, cols - 18 - 20)) + `Authorised Signatory`;
    footerLines.push(leftMargin + signRow);

    return this.paginateDocument({
      headerLines,
      itemLines,
      footerLines,
      linesPerPage,
      cols,
      leftMargin,
      documentNumber: data.invoice_number,
      endOfJobAction: options?.endOfJobAction,
      feedLinesForTearOff: options?.feedLinesForTearOff,
    });
  }

  /**
   * 80-Column Standard Dot Matrix Format (for 9-pin/24-pin 80-column printers like Epson LX-310, TVS MSP).
   */
  private renderInvoice80(data: InvoicePrintData, options?: DotMatrixOptions, customCols?: number): string {
    const cols = customCols || 80;
    const linesPerPage = options?.linesPerPage !== undefined ? options.linesPerPage : 66;
    const curr = options?.currencyPrefix || "Rs.";
    const leftMargin = resolveLeftMargin(options, cols);
    const divDouble = leftMargin + "=".repeat(cols);
    const divSingle = leftMargin + "-".repeat(cols);

    // Build Header Section Lines
    const headerLines: string[] = [];
    if (options?.topMarginLines) {
      for (let i = 0; i < options.topMarginLines; i++) headerLines.push("");
    }

    // 1. Store Details (Store Name Prominent & Centered at the top)
    headerLines.push(leftMargin + this.center(data.store_name.toUpperCase(), cols));
    if (data.store_address) {
      const addrLines = this.wrapText(data.store_address, cols);
      addrLines.forEach((l) => headerLines.push(leftMargin + this.center(l, cols)));
    }

    const contactParts: string[] = [];
    if (data.store_phone) contactParts.push(`Ph: ${data.store_phone}`);
    if (data.store_email) contactParts.push(`Email: ${data.store_email}`);
    if (contactParts.length > 0) {
      const lines = this.wrapText(contactParts.join(" | "), cols);
      lines.forEach((l) => headerLines.push(leftMargin + this.center(l, cols)));
    }

    if (data.store_gstin) {
      headerLines.push(leftMargin + this.center(`GSTIN: ${data.store_gstin}`, cols));
    }

    if (options?.showDrugLicenses !== false && data.drug_license_numbers && data.drug_license_numbers.length > 0) {
      const dlStr = `DL: ${data.drug_license_numbers.join(", ")}`;
      const lines = this.wrapText(dlStr, cols);
      lines.forEach((l) => headerLines.push(leftMargin + this.center(l, cols)));
    }

    if (data.fssai_no) {
      headerLines.push(leftMargin + this.center(`FSSAI: ${data.fssai_no}`, cols));
    }

    headerLines.push(divDouble);

    // 2. Title & Copy Marker Bar (Placed AFTER store header)
    const isDup = options?.isDuplicate || options?.copyMarker;
    const dupText = options?.copyMarker || "DUPLICATE COPY";
    if (isDup) {
      const title = "TAX INVOICE";
      const dupTag = `*** ${dupText} ***`;
      headerLines.push(leftMargin + title + " ".repeat(Math.max(1, cols - title.length - dupTag.length)) + dupTag);
    } else {
      headerLines.push(leftMargin + this.center("TAX INVOICE", cols));
    }

    headerLines.push(divSingle);

    // Document & Customer Meta Grid (2 Columns: Left 42 cols, Right 38 cols)
    const leftColWidth = 42;
    const rightColWidth = 38;

    const leftMeta: string[] = [];
    leftMeta.push(`Customer   : ${data.customer_name || "Walk-in Customer"}`);
    leftMeta.push(`Phone      : ${data.customer_phone || "-"}`);
    if (data.customer_gstin) {
      leftMeta.push(`Cust GSTIN : ${data.customer_gstin}`);
    }
    if (options?.showDoctorPatient !== false) {
      if (data.patient_name) {
        const pat = `Patient    : ${data.patient_name}${data.patient_age ? ` (${data.patient_age}Y/${data.patient_gender || ""})` : ""}`;
        leftMeta.push(pat);
      }
      if (data.doctor_name) {
        const doc = `Doctor     : ${data.doctor_name}${data.doctor_reg_no ? ` [${data.doctor_reg_no}]` : ""}`;
        leftMeta.push(doc);
      }
    }

    const rightMeta: string[] = [];
    rightMeta.push(`Invoice No : #${data.invoice_number}`);
    rightMeta.push(`Date       : ${this.formatInvoiceDate(data.invoice_date, data.invoice_time)}`);
    rightMeta.push(`Payment    : ${data.payment_mode || "Cash"}`);
    if (data.place_of_supply) {
      rightMeta.push(`POS        : ${data.place_of_supply}`);
    }

    const maxMetaRows = Math.max(leftMeta.length, rightMeta.length);
    for (let i = 0; i < maxMetaRows; i++) {
      const l = this.padRight(leftMeta[i] || "", leftColWidth);
      const r = this.padRight(rightMeta[i] || "", rightColWidth);
      headerLines.push(leftMargin + l + r);
    }

    headerLines.push(divSingle);

    // Item Table Header (Exact 80 Columns: 2 + 1 + 25 + 1 + 8 + 1 + 8 + 1 + 5 + 1 + 4 + 1 + 7 + 1 + 4 + 1 + 9 = 80)
    // #  Item Description           HSN      Batch    Exp   Qty    Rate  GST    Amount
    const itemTableHead = `${this.padRight("#", 2)} ${this.padRight("Item Description", 25)} ${this.padRight("HSN", 8)} ${this.padRight("Batch", 8)} ${this.padRight("Exp", 5)} ${this.padLeft("Qty", 4)} ${this.padLeft("Rate", 7)} ${this.padLeft("GST", 4)} ${this.padLeft("Amount", 9)}`;
    headerLines.push(leftMargin + itemTableHead);
    headerLines.push(divSingle);

    // Build Item Rows Lines
    const itemLines: string[] = [];
    data.lines.forEach((item, idx) => {
      const num = this.padRight(idx + 1, 2);
      const descFirst = item.description.substring(0, 25).padEnd(25);
      const hsn = this.padRight((item.hsn_code || "-").substring(0, 8), 8);
      const batch = this.padRight((item.batch_no || "-").substring(0, 8), 8);
      const exp = this.padRight(this.formatExpiry(item.expiry_date), 5);
      const qty = this.padLeft(this.formatQty(item.qty, item.loose_qty), 4);
      const rate = this.padLeft(item.rate.toFixed(2), 7);
      const gst = this.padLeft(`${item.gst_percent}%`, 4);
      const amt = this.padLeft(this.formatAmount(item.amount), 9);

      itemLines.push(`${leftMargin}${num} ${descFirst} ${hsn} ${batch} ${exp} ${qty} ${rate} ${gst} ${amt}`);

      // If description is longer than 25 chars and truncation is disabled, wrap onto indented lines
      if (!options?.truncateDescriptions && item.description.length > 25) {
        const remainingDesc = item.description.substring(25);
        const wrapped = this.wrapText(remainingDesc, 50);
        wrapped.forEach((w) => {
          itemLines.push(`${leftMargin}   ${w}`);
        });
      }
    });

    // Build Footer Section Lines
    const footerLines: string[] = [];
    footerLines.push(divSingle);

    // HSN Summary Table (Aligned strictly <= 80 cols)
    if (options?.showHsnSummary !== false) {
      const hsnRows = calculateHsnSummary(data.lines);
      const isInterState = (data.igst_total !== undefined && data.igst_total > 0) || hsnRows.some((r) => r.igstAmount > 0);
      if (hsnRows.length > 0) {
        if (isInterState) {
          const hsnHead = `${this.padRight("HSN/SAC", 10)} ${this.padLeft("TaxableVal(Rs)", 18)} ${this.padLeft("IGST%", 8)} ${this.padLeft("IGST(Rs)", 14)} ${this.padLeft("TotalTax(Rs)", 16)}`;
          footerLines.push(leftMargin + hsnHead);
          footerLines.push(divSingle);
          hsnRows.forEach((h) => {
            const hCode = this.padRight(h.hsnCode, 10);
            const tVal = this.padLeft(this.formatAmount(h.taxableValue), 18);
            const iRate = this.padLeft(`${h.igstRate}%`, 8);
            const iAmt = this.padLeft(this.formatAmount(h.igstAmount), 14);
            const totTax = this.padLeft(this.formatAmount(h.totalTax), 16);
            footerLines.push(`${leftMargin}${hCode} ${tVal} ${iRate} ${iAmt} ${totTax}`);
          });
        } else {
          const hsnHead = `${this.padRight("HSN/SAC", 8)} ${this.padLeft("TaxableVal(Rs)", 14)} ${this.padLeft("CGST%", 5)} ${this.padLeft("CGST(Rs)", 9)} ${this.padLeft("SGST%", 5)} ${this.padLeft("SGST(Rs)", 9)} ${this.padLeft("TotalTax(Rs)", 12)}`;
          footerLines.push(leftMargin + hsnHead);
          footerLines.push(divSingle);
          hsnRows.forEach((h) => {
            const hCode = this.padRight(h.hsnCode, 8);
            const tVal = this.padLeft(this.formatAmount(h.taxableValue), 14);
            const cRate = this.padLeft(`${h.cgstRate}%`, 5);
            const cAmt = this.padLeft(this.formatAmount(h.cgstAmount), 9);
            const sRate = this.padLeft(`${h.sgstRate}%`, 5);
            const sAmt = this.padLeft(this.formatAmount(h.sgstAmount), 9);
            const totTax = this.padLeft(this.formatAmount(h.totalTax), 12);
            footerLines.push(`${leftMargin}${hCode} ${tVal} ${cRate} ${cAmt} ${sRate} ${sAmt} ${totTax}`);
          });
        }
        footerLines.push(divSingle);
      }
    }

    // Totals Box (Right Aligned to 80 cols)
    const isInterState = (data.igst_total !== undefined && data.igst_total > 0);
    const subtotalStr = `Taxable Subtotal  : ${curr} ` + this.padLeft(this.formatAmount(data.subtotal), 11);
    footerLines.push(leftMargin + this.padLeft(subtotalStr, cols));

    if (isInterState) {
      const igstStr = `Integrated (IGST) : ${curr} ` + this.padLeft(this.formatAmount(data.igst_total || data.tax_total), 11);
      footerLines.push(leftMargin + this.padLeft(igstStr, cols));
    } else if (data.cgst_total !== undefined && data.sgst_total !== undefined) {
      const cgstStr = `Central GST (CGST): ${curr} ` + this.padLeft(this.formatAmount(data.cgst_total), 11);
      const sgstStr = `State GST (SGST)  : ${curr} ` + this.padLeft(this.formatAmount(data.sgst_total), 11);
      footerLines.push(leftMargin + this.padLeft(cgstStr, cols));
      footerLines.push(leftMargin + this.padLeft(sgstStr, cols));
    } else if (data.tax_total > 0) {
      const taxStr = `GST Tax Total     : ${curr} ` + this.padLeft(this.formatAmount(data.tax_total), 11);
      footerLines.push(leftMargin + this.padLeft(taxStr, cols));
    }

    if (data.cess_total && data.cess_total > 0) {
      const cessStr = `Cess Total        : ${curr} ` + this.padLeft(this.formatAmount(data.cess_total), 11);
      footerLines.push(leftMargin + this.padLeft(cessStr, cols));
    }

    if (data.round_off && Math.abs(data.round_off) > 0.001) {
      const roStr = `Round Off         : ${curr} ` + this.padLeft(this.formatAmount(data.round_off), 11);
      footerLines.push(leftMargin + this.padLeft(roStr, cols));
    }

    footerLines.push(divDouble);
    const grandTotalStr = `GRAND TOTAL       : ${curr} ` + this.padLeft(this.formatAmount(data.grand_total), 11);
    footerLines.push(leftMargin + this.padLeft(grandTotalStr, cols));
    footerLines.push(divDouble);

    if (data.payments && data.payments.length > 0) {
      for (const p of data.payments) {
        const pStr = `Paid via ${p.mode}${p.reference_no ? ` [${p.reference_no}]` : ""}: ${curr} ` + this.padLeft(this.formatAmount(p.amount), 11);
        footerLines.push(leftMargin + this.padLeft(pStr, cols));
      }
      if (data.change_due && data.change_due > 0) {
        const chgStr = `Change Returned   : ${curr} ` + this.padLeft(this.formatAmount(data.change_due), 11);
        footerLines.push(leftMargin + this.padLeft(chgStr, cols));
      }
      if (data.balance_due && data.balance_due > 0) {
        const balStr = `Balance (Credit)  : ${curr} ` + this.padLeft(this.formatAmount(data.balance_due), 11);
        footerLines.push(leftMargin + this.padLeft(balStr, cols));
      }
      footerLines.push(divSingle);
    }

    // Amount in Words
    const words = data.amount_in_words || numberToWordsIndian(data.grand_total);
    const wordsLines = this.wrapText(`Amount in Words: ${words}`, cols);
    wordsLines.forEach((w) => footerLines.push(leftMargin + w));

    // UPI text (Simple, clean format)
    if (data.upi_vpa) {
      footerLines.push(leftMargin + `UPI ID: ${data.upi_vpa}`);
    }

    // Terms
    if (options?.showTerms !== false && data.terms_and_conditions) {
      const terms = this.wrapText(`Terms: ${data.terms_and_conditions}`, cols);
      terms.forEach((t) => footerLines.push(leftMargin + t));
    }

    footerLines.push("");
    const storeShortName = data.store_name.length > 30 ? data.store_name.substring(0, 30) : data.store_name;
    const forShop = `For ${storeShortName}`;
    const signRow = `Customer Signature` + " ".repeat(Math.max(2, cols - 18 - forShop.length)) + forShop;
    footerLines.push(leftMargin + signRow);
    footerLines.push("");
    const authSign = " ".repeat(cols - 20) + `Authorised Signatory`;
    footerLines.push(leftMargin + authSign);

    // Assemble Paginated Output
    return this.paginateDocument({
      headerLines,
      itemLines,
      footerLines,
      linesPerPage,
      cols,
      leftMargin,
      documentNumber: data.invoice_number,
      endOfJobAction: options?.endOfJobAction,
      feedLinesForTearOff: options?.feedLinesForTearOff,
    });
  }

  /**
   * 120-Column Wide Dot Matrix Format (for 12-inch wide paper / 10 CPI wide fanfold).
   */
  private renderInvoice120(data: InvoicePrintData, options?: DotMatrixOptions, customCols?: number): string {
    const cols = customCols || 120;
    const linesPerPage = options?.linesPerPage !== undefined ? options.linesPerPage : 66;
    const curr = options?.currencyPrefix || "Rs.";
    const leftMargin = resolveLeftMargin(options, cols);
    const divDouble = leftMargin + "=".repeat(cols);
    const divSingle = leftMargin + "-".repeat(cols);

    const headerLines: string[] = [];
    if (options?.topMarginLines) {
      for (let i = 0; i < options.topMarginLines; i++) headerLines.push("");
    }

    // 1. Store Details (Centered within 120 columns)
    headerLines.push(leftMargin + this.center(data.store_name.toUpperCase(), cols));
    if (data.store_address) {
      headerLines.push(leftMargin + this.center(data.store_address, cols));
    }

    const subHeaders: string[] = [];
    if (data.store_gstin) subHeaders.push(`GSTIN: ${data.store_gstin}`);
    if (data.store_phone) subHeaders.push(`Ph: ${data.store_phone}`);
    if (data.store_email) subHeaders.push(`Email: ${data.store_email}`);
    if (options?.showDrugLicenses !== false && data.drug_license_numbers && data.drug_license_numbers.length > 0) {
      subHeaders.push(`DL: ${data.drug_license_numbers.join(", ")}`);
    }
    if (subHeaders.length > 0) {
      headerLines.push(leftMargin + this.center(subHeaders.join(" | "), cols));
    }

    headerLines.push(divDouble);

    // 2. Title & Copy Marker Bar
    const isDup = options?.isDuplicate || options?.copyMarker;
    const dupText = options?.copyMarker || "DUPLICATE COPY";
    if (isDup) {
      const title = "TAX INVOICE";
      const dupTag = `*** ${dupText} ***`;
      headerLines.push(leftMargin + title + " ".repeat(Math.max(1, cols - title.length - dupTag.length)) + dupTag);
    } else {
      headerLines.push(leftMargin + this.center("TAX INVOICE", cols));
    }

    headerLines.push(divSingle);

    // 3-Column Meta Grid in 120 columns (42 + 38 + 40 = 120)
    const p1 = `Customer : ${data.customer_name || "Walk-in Customer"}`.padEnd(42);
    const p2 = `Invoice No: #${data.invoice_number}`.padEnd(38);
    const p3 = `Date: ${this.formatInvoiceDate(data.invoice_date, data.invoice_time)}`.padEnd(40);
    headerLines.push(leftMargin + p1 + p2 + p3);

    const g1 = `Phone    : ${data.customer_phone || "-"}`.padEnd(42);
    const g2 = `Cust GSTIN: ${data.customer_gstin || "-"}`.padEnd(38);
    const g3 = `POS : ${data.place_of_supply || "State"}`.padEnd(40);
    headerLines.push(leftMargin + g1 + g2 + g3);

    if (options?.showDoctorPatient !== false && (data.patient_name || data.doctor_name)) {
      const d1 = `Patient  : ${data.patient_name || "-"}${data.patient_age ? ` (${data.patient_age}Y/${data.patient_gender || ""})` : ""}`.padEnd(42);
      const d2 = `Doctor   : ${data.doctor_name || "-"}`.padEnd(38);
      const d3 = `Payment : ${data.payment_mode || "Cash"}`.padEnd(40);
      headerLines.push(leftMargin + d1 + d2 + d3);
    }

    headerLines.push(divSingle);

    // 120-Column Item Table Header
    // 2+1+36+1+8+1+8+1+5+1+5+1+10+1+7+1+10+1+4+1+15 = 120 cols
    const itemHead120 = `${this.padRight("#", 2)} ${this.padRight("Item Description", 36)} ${this.padRight("HSN/SAC", 8)} ${this.padRight("Batch", 8)} ${this.padRight("Exp", 5)} ${this.padLeft("Qty", 5)} ${this.padLeft("Rate(Rs)", 10)} ${this.padLeft("Disc", 7)} ${this.padLeft("Taxable", 10)} ${this.padLeft("GST%", 4)} ${this.padLeft("Amount (Rs.)", 15)}`;
    headerLines.push(leftMargin + itemHead120);
    headerLines.push(divSingle);

    const itemLines: string[] = [];
    data.lines.forEach((item, idx) => {
      const num = this.padRight(idx + 1, 2);
      const desc = item.description.substring(0, 36).padEnd(36);
      const hsn = this.padRight((item.hsn_code || "-").substring(0, 8), 8);
      const batch = this.padRight((item.batch_no || "-").substring(0, 8), 8);
      const exp = this.padRight(this.formatExpiry(item.expiry_date), 5);
      const qty = this.padLeft(this.formatQty(item.qty, item.loose_qty), 5);
      const rate = this.padLeft(item.rate.toFixed(2), 10);
      const disc = this.padLeft(this.formatAmount(item.discount_amount || 0), 7);
      const taxable = this.padLeft(this.formatAmount((item.amount || 0) * (1 - (item.gst_percent || 0) / 100)), 10);
      const gst = this.padLeft(`${item.gst_percent}%`, 4);
      const amt = this.padLeft(this.formatAmount(item.amount), 15);

      itemLines.push(`${leftMargin}${num} ${desc} ${hsn} ${batch} ${exp} ${qty} ${rate} ${disc} ${taxable} ${gst} ${amt}`);

      if (options?.truncateDescriptions !== true && item.description.length > 36) {
        const wrap2 = item.description.substring(36, 72).trim();
        itemLines.push(`${leftMargin}    ${wrap2}`);
      }
    });

    const footerLines: string[] = [];
    footerLines.push(divSingle);

    // HSN Summary for 120 cols
    if (options?.showHsnSummary !== false) {
      const hsnRows = calculateHsnSummary(data.lines);
      if (hsnRows.length > 0) {
        const hsnHead = `${this.padRight("HSN/SAC", 10)} ${this.padLeft("Taxable Value (Rs)", 22)} ${this.padLeft("CGST Rate", 12)} ${this.padLeft("CGST (Rs)", 16)} ${this.padLeft("SGST Rate", 12)} ${this.padLeft("SGST (Rs)", 16)} ${this.padLeft("Total Tax (Rs)", 22)}`;
        footerLines.push(leftMargin + hsnHead);
        footerLines.push(divSingle);
        hsnRows.forEach((h) => {
          const hCode = this.padRight(h.hsnCode, 10);
          const tVal = this.padLeft(this.formatAmount(h.taxableValue), 22);
          const cRate = this.padLeft(`${h.cgstRate}%`, 12);
          const cAmt = this.padLeft(this.formatAmount(h.cgstAmount), 16);
          const sRate = this.padLeft(`${h.sgstRate}%`, 12);
          const sAmt = this.padLeft(this.formatAmount(h.sgstAmount), 16);
          const totTax = this.padLeft(this.formatAmount(h.totalTax), 22);
          footerLines.push(`${leftMargin}${hCode} ${tVal} ${cRate} ${cAmt} ${sRate} ${sAmt} ${totTax}`);
        });
        footerLines.push(divSingle);
      }
    }

    // Totals Box (Right Aligned to 120 cols)
    const subtotalStr = `Taxable Subtotal  : ${curr} ` + this.padLeft(this.formatAmount(data.subtotal), 12);
    footerLines.push(leftMargin + this.padLeft(subtotalStr, cols));

    if (data.cgst_total !== undefined && data.sgst_total !== undefined) {
      const cgstStr = `Central GST (CGST): ${curr} ` + this.padLeft(this.formatAmount(data.cgst_total), 12);
      const sgstStr = `State GST (SGST)  : ${curr} ` + this.padLeft(this.formatAmount(data.sgst_total), 12);
      footerLines.push(leftMargin + this.padLeft(cgstStr, cols));
      footerLines.push(leftMargin + this.padLeft(sgstStr, cols));
    } else if (data.tax_total > 0) {
      const taxStr = `GST Tax Total     : ${curr} ` + this.padLeft(this.formatAmount(data.tax_total), 12);
      footerLines.push(leftMargin + this.padLeft(taxStr, cols));
    }

    if (data.round_off && Math.abs(data.round_off) > 0.001) {
      const roStr = `Round Off         : ${curr} ` + this.padLeft(this.formatAmount(data.round_off), 12);
      footerLines.push(leftMargin + this.padLeft(roStr, cols));
    }

    footerLines.push(divDouble);
    const grandTotalStr = `GRAND TOTAL       : ${curr} ` + this.padLeft(this.formatAmount(data.grand_total), 12);
    footerLines.push(leftMargin + this.padLeft(grandTotalStr, cols));
    footerLines.push(divDouble);

    const words = data.amount_in_words || numberToWordsIndian(data.grand_total);
    footerLines.push(leftMargin + `Amount in Words: ${words}`);
    if (data.upi_vpa) footerLines.push(leftMargin + `UPI ID: ${data.upi_vpa}`);
    if (options?.showTerms !== false && data.terms_and_conditions) {
      footerLines.push(leftMargin + `Terms: ${data.terms_and_conditions}`);
    }

    footerLines.push("");
    const signRow = `Customer Signature` + " ".repeat(Math.max(2, cols - 18 - 25)) + `Authorised Signatory`;
    footerLines.push(leftMargin + signRow);

    return this.paginateDocument({
      headerLines,
      itemLines,
      footerLines,
      linesPerPage,
      cols,
      leftMargin,
      documentNumber: data.invoice_number,
      endOfJobAction: options?.endOfJobAction,
      feedLinesForTearOff: options?.feedLinesForTearOff,
    });
  }

  /**
   * 132-Column Wide Dot Matrix Format (for wide carriage or 17 CPI condensed mode)
   */
  private renderInvoice132(data: InvoicePrintData, options?: DotMatrixOptions, customCols?: number): string {
    const cols = customCols || 132;
    const linesPerPage = options?.linesPerPage !== undefined ? options.linesPerPage : 66;
    const curr = options?.currencyPrefix || "Rs.";
    const leftMargin = resolveLeftMargin(options, cols);
    const divDouble = leftMargin + "=".repeat(cols);
    const divSingle = leftMargin + "-".repeat(cols);

    const headerLines: string[] = [];
    if (options?.topMarginLines) {
      for (let i = 0; i < options.topMarginLines; i++) headerLines.push("");
    }

    // 1. Store Details (Store Name Prominent & Centered at the top)
    headerLines.push(leftMargin + this.center(data.store_name.toUpperCase(), cols));
    if (data.store_address) {
      headerLines.push(leftMargin + this.center(data.store_address, cols));
    }

    const subHeaders: string[] = [];
    if (data.store_gstin) subHeaders.push(`GSTIN: ${data.store_gstin}`);
    if (data.store_phone) subHeaders.push(`Ph: ${data.store_phone}`);
    if (data.store_email) subHeaders.push(`Email: ${data.store_email}`);
    if (options?.showDrugLicenses !== false && data.drug_license_numbers && data.drug_license_numbers.length > 0) {
      subHeaders.push(`DL: ${data.drug_license_numbers.join(", ")}`);
    }
    if (subHeaders.length > 0) {
      headerLines.push(leftMargin + this.center(subHeaders.join(" | "), cols));
    }

    headerLines.push(divDouble);

    // 2. Title & Copy Marker Bar (Placed AFTER store header)
    const isDup = options?.isDuplicate || options?.copyMarker;
    const dupText = options?.copyMarker || "DUPLICATE COPY";
    if (isDup) {
      const title = "TAX INVOICE";
      const dupTag = `*** ${dupText} ***`;
      headerLines.push(leftMargin + title + " ".repeat(Math.max(1, cols - title.length - dupTag.length)) + dupTag);
    } else {
      headerLines.push(leftMargin + this.center("TAX INVOICE", cols));
    }

    headerLines.push(divSingle);

    // 3-Column Meta Grid in 132 columns
    const p1 = `Customer : ${data.customer_name || "Walk-in Customer"}`.padEnd(46);
    const p2 = `Invoice No: #${data.invoice_number}`.padEnd(42);
    const p3 = `Date: ${this.formatInvoiceDate(data.invoice_date, data.invoice_time)}`.padEnd(44);
    headerLines.push(leftMargin + p1 + p2 + p3);

    const g1 = `Phone    : ${data.customer_phone || "-"}`.padEnd(46);
    const g2 = `Cust GSTIN: ${data.customer_gstin || "-"}`.padEnd(42);
    const g3 = `POS : ${data.place_of_supply || "State"}`.padEnd(44);
    headerLines.push(leftMargin + g1 + g2 + g3);

    if (options?.showDoctorPatient !== false && (data.patient_name || data.doctor_name)) {
      const d1 = `Patient  : ${data.patient_name || "-"}${data.patient_age ? ` (${data.patient_age}Y/${data.patient_gender || ""})` : ""}`.padEnd(46);
      const d2 = `Doctor   : ${data.doctor_name || "-"}`.padEnd(42);
      const d3 = `Payment : ${data.payment_mode || "Cash"}`.padEnd(44);
      headerLines.push(leftMargin + d1 + d2 + d3);
    }

    headerLines.push(divSingle);

    // 132-Column Item Table Header
    // 2+1+42+1+8+1+8+1+5+1+6+1+10+1+7+1+12+1+5+1+17 = 132 cols
    const itemHead132 = `${this.padRight("#", 2)} ${this.padRight("Item Description", 42)} ${this.padRight("HSN/SAC", 8)} ${this.padRight("Batch", 8)} ${this.padRight("Exp", 5)} ${this.padLeft("Qty", 6)} ${this.padLeft("Rate(Rs)", 10)} ${this.padLeft("Disc", 7)} ${this.padLeft("Taxable", 12)} ${this.padLeft("GST%", 5)} ${this.padLeft("Amount (Rs.)", 17)}`;
    headerLines.push(leftMargin + itemHead132);
    headerLines.push(divSingle);

    const itemLines: string[] = [];
    data.lines.forEach((item, idx) => {
      const num = this.padRight(idx + 1, 2);
      const desc = item.description.substring(0, 42).padEnd(42);
      const hsn = this.padRight((item.hsn_code || "-").substring(0, 8), 8);
      const batch = this.padRight((item.batch_no || "-").substring(0, 8), 8);
      const exp = this.padRight(this.formatExpiry(item.expiry_date), 5);
      const qty = this.padLeft(this.formatQty(item.qty, item.loose_qty), 6);
      const rate = this.padLeft(item.rate.toFixed(2), 10);
      const disc = this.padLeft(this.formatAmount(item.discount_amount || 0), 7);
      const taxable = this.padLeft(this.formatAmount(item.taxable_amount || (item.amount / (1 + item.gst_percent / 100))), 12);
      const gst = this.padLeft(`${item.gst_percent}%`, 5);
      const amt = this.padLeft(this.formatAmount(item.amount), 17);

      itemLines.push(`${leftMargin}${num} ${desc} ${hsn} ${batch} ${exp} ${qty} ${rate} ${disc} ${taxable} ${gst} ${amt}`);

      if (!options?.truncateDescriptions && item.description.length > 42) {
        const rem = this.wrapText(item.description.substring(42), 90);
        rem.forEach((r) => itemLines.push(`${leftMargin}    ${r}`));
      }
    });

    const footerLines: string[] = [];
    footerLines.push(divSingle);

    // HSN Summary Table
    if (options?.showHsnSummary !== false) {
      const hsnRows = calculateHsnSummary(data.lines);
      const isInterState = (data.igst_total !== undefined && data.igst_total > 0) || hsnRows.some((r) => r.igstAmount > 0);
      if (hsnRows.length > 0) {
        if (isInterState) {
          footerLines.push(leftMargin + "HSN/SAC Code       Taxable Amount(Rs)       IGST%      IGST Amount(Rs)       Total Tax Amount(Rs)");
          hsnRows.forEach((h) => {
            const cCode = this.padRight(h.hsnCode, 18);
            const tAmt = this.padLeft(this.formatAmount(h.taxableValue), 24);
            const iRate = this.padLeft(`${h.igstRate}%`, 11);
            const iVal = this.padLeft(this.formatAmount(h.igstAmount), 20);
            const totVal = this.padLeft(this.formatAmount(h.totalTax), 26);
            footerLines.push(`${leftMargin}${cCode}${tAmt}${iRate}${iVal}${totVal}`);
          });
        } else {
          footerLines.push(leftMargin + "HSN/SAC Code       Taxable Amount(Rs)       CGST%      CGST Amount(Rs)      SGST%      SGST Amount(Rs)       Total Tax Amount(Rs)");
          hsnRows.forEach((h) => {
            const cCode = this.padRight(h.hsnCode, 18);
            const tAmt = this.padLeft(this.formatAmount(h.taxableValue), 24);
            const cRate = this.padLeft(`${h.cgstRate}%`, 11);
            const cVal = this.padLeft(this.formatAmount(h.cgstAmount), 20);
            const sRate = this.padLeft(`${h.sgstRate}%`, 11);
            const sVal = this.padLeft(this.formatAmount(h.sgstAmount), 20);
            const totVal = this.padLeft(this.formatAmount(h.totalTax), 26);
            footerLines.push(`${leftMargin}${cCode}${tAmt}${cRate}${cVal}${sRate}${sVal}${totVal}`);
          });
        }
        footerLines.push(divSingle);
      }
    }

    // Totals Box
    const isInterState = (data.igst_total !== undefined && data.igst_total > 0);
    footerLines.push(leftMargin + this.padLeft(`Taxable Subtotal  : ${curr} ` + this.padLeft(this.formatAmount(data.subtotal), 14), cols));
    if (isInterState) {
      footerLines.push(leftMargin + this.padLeft(`IGST Amount       : ${curr} ` + this.padLeft(this.formatAmount(data.igst_total || data.tax_total), 14), cols));
    } else if (data.cgst_total !== undefined && data.sgst_total !== undefined) {
      footerLines.push(leftMargin + this.padLeft(`CGST Amount       : ${curr} ` + this.padLeft(this.formatAmount(data.cgst_total), 14), cols));
      footerLines.push(leftMargin + this.padLeft(`SGST Amount       : ${curr} ` + this.padLeft(this.formatAmount(data.sgst_total), 14), cols));
    } else if (data.tax_total > 0) {
      footerLines.push(leftMargin + this.padLeft(`GST Tax Total     : ${curr} ` + this.padLeft(this.formatAmount(data.tax_total), 14), cols));
    }
    if (data.cess_total && data.cess_total > 0) {
      footerLines.push(leftMargin + this.padLeft(`Cess Amount       : ${curr} ` + this.padLeft(this.formatAmount(data.cess_total), 14), cols));
    }
    if (data.round_off) {
      footerLines.push(leftMargin + this.padLeft(`Round Off         : ${curr} ` + this.padLeft(this.formatAmount(data.round_off), 14), cols));
    }
    footerLines.push(divDouble);
    footerLines.push(leftMargin + this.padLeft(`GRAND TOTAL       : ${curr} ` + this.padLeft(this.formatAmount(data.grand_total), 14), cols));
    footerLines.push(divDouble);

    const words = data.amount_in_words || numberToWordsIndian(data.grand_total);
    footerLines.push(leftMargin + `Amount in Words: ${words}`);
    if (data.upi_vpa) {
      footerLines.push(leftMargin + `UPI ID: ${data.upi_vpa}`);
    }
    if (options?.showTerms !== false && data.terms_and_conditions) {
      footerLines.push(leftMargin + `Terms: ${data.terms_and_conditions}`);
    }

    footerLines.push("");
    const signBox = `Customer Signature` + " ".repeat(cols - 18 - 30) + `For ${data.store_name.substring(0, 25)}`;
    footerLines.push(leftMargin + signBox);
    footerLines.push("");
    footerLines.push(leftMargin + " ".repeat(cols - 25) + `Authorised Signatory`);

    return this.paginateDocument({
      headerLines,
      itemLines,
      footerLines,
      linesPerPage,
      cols,
      leftMargin,
      documentNumber: data.invoice_number,
      endOfJobAction: options?.endOfJobAction,
      feedLinesForTearOff: options?.feedLinesForTearOff,
    });
  }

  /**
   * Pre-printed stationery format (Prints values at fixed coordinates without borders).
   */
  private renderPrePrintedInvoice(data: InvoicePrintData, options?: DotMatrixOptions): string {
    const cols = resolveDotMatrixColumns(options);
    const leftMargin = resolveLeftMargin(options, cols);
    const endOfJobAction = options?.endOfJobAction || "stop_immediately";
    const feedLines = Math.min(10, Math.max(0, options?.feedLinesForTearOff || 0));
    const outLines: string[] = [];

    // Header offset for pre-printed letterhead
    for (let i = 0; i < (options?.topMarginLines || 8); i++) {
      outLines.push("");
    }

    // Document Meta
    const metaIndent = Math.min(15, Math.floor(cols * 0.15));
    outLines.push(leftMargin + " ".repeat(metaIndent) + `${data.invoice_number.padEnd(25)} ${this.formatInvoiceDate(data.invoice_date, data.invoice_time)}`);
    outLines.push(leftMargin + " ".repeat(metaIndent) + `${(data.customer_name || "Cash").padEnd(25)} ${data.customer_phone || ""}`);
    outLines.push("");

    // Items
    data.lines.forEach((item, idx) => {
      const num = this.padRight(idx + 1, 3);
      const desc = item.description.substring(0, cols <= 65 ? 18 : 25).padEnd(cols <= 65 ? 18 : 25);
      const batch = this.padRight(item.batch_no || "-", cols <= 65 ? 6 : 8);
      const qty = this.padLeft(item.qty, cols <= 65 ? 4 : 5);
      const rate = this.padLeft(item.rate.toFixed(2), cols <= 65 ? 7 : 8);
      const amt = this.padLeft(this.formatAmount(item.amount), cols <= 65 ? 9 : 10);
      outLines.push(`${leftMargin}${num} ${desc} ${batch} ${qty} ${rate} ${amt}`);
    });

    // Totals at bottom (no artificial padding of empty lines)
    const totIndent = Math.max(10, cols - 20);
    outLines.push(leftMargin + " ".repeat(totIndent) + this.padLeft(this.formatAmount(data.subtotal), cols - totIndent));
    outLines.push(leftMargin + " ".repeat(totIndent) + this.padLeft(this.formatAmount(data.tax_total), cols - totIndent));
    outLines.push(leftMargin + " ".repeat(totIndent) + this.padLeft(this.formatAmount(data.grand_total), cols - totIndent));

    // Trim any trailing blank lines
    while (outLines.length > 0 && outLines[outLines.length - 1].trim() === "") {
      outLines.pop();
    }

    let result = outLines.join("\n");
    if (endOfJobAction === "form_feed") {
      result += "\n\x0C";
    } else if (endOfJobAction === "feed_tear_off" && feedLines > 0) {
      result += "\n" + "\n".repeat(feedLines);
    }

    return result;
  }

  /**
   * Generates Dot Matrix text for Credit Notes / Sales Returns
   */
  renderCreditNote(data: CreditNotePrintData, options?: DotMatrixOptions): string {
    const cols = resolveDotMatrixColumns(options);
    const curr = options?.currencyPrefix || "Rs.";
    const leftMargin = resolveLeftMargin(options, cols);
    const divDouble = leftMargin + "=".repeat(cols);
    const divSingle = leftMargin + "-".repeat(cols);

    const headerLines: string[] = [];
    // Store Details FIRST
    headerLines.push(leftMargin + this.center(data.store_name.toUpperCase(), cols));
    if (data.store_address) headerLines.push(leftMargin + this.center(data.store_address, cols));
    headerLines.push(divDouble);

    // Title AFTER Store Details
    headerLines.push(leftMargin + this.center(`*** CREDIT NOTE / SALES RETURN ***`, cols));
    headerLines.push(divSingle);

    if (cols <= 65) {
      const is50Col = cols <= 55;
      const leftW = is50Col ? 26 : Math.min(32, Math.floor(cols * 0.53));
      const rightW = cols - leftW;
      const descW = is50Col ? 14 : 20;
      const batchW = is50Col ? 6 : 7;
      const rateW = is50Col ? 6 : 7;
      const amtW = is50Col ? 7 : 9;

      headerLines.push(leftMargin + this.padRight(`CREDIT NOTE : #${data.return_number}`, leftW) + this.padRight(`Date: ${this.formatInvoiceDate(data.return_date)}`, rightW));
      if (data.original_invoice_number) {
        headerLines.push(leftMargin + this.padRight(`Orig Invoice: #${data.original_invoice_number}`, leftW) + this.padRight(`Inv Date: ${this.formatInvoiceDate(data.original_invoice_date)}`, rightW));
      }
      headerLines.push(leftMargin + this.padRight(`Customer    : ${(data.customer_name || "").substring(0, leftW - 14)}`, leftW) + this.padRight(`Phone: ${data.customer_phone || "-"}`, rightW));
      headerLines.push(divSingle);

      headerLines.push(leftMargin + `${this.padRight("#", 2)} ${this.padRight(is50Col ? "Item Desc" : "Item Description", descW)} ${this.padRight("Batch", batchW)} ${this.padRight("Exp", 5)} ${this.padLeft("Qty", 4)} ${this.padLeft("Rate", rateW)} ${this.padLeft("Amount", amtW)}`);
      headerLines.push(divSingle);
    } else {
      const leftW = cols >= 120 ? 60 : 42;
      headerLines.push(leftMargin + `CREDIT NOTE NO : #${data.return_number}`.padEnd(leftW) + `Date: ${this.formatInvoiceDate(data.return_date)}`);
      if (data.original_invoice_number) {
        headerLines.push(leftMargin + `Orig Invoice   : #${data.original_invoice_number}`.padEnd(leftW) + `Inv Date: ${this.formatInvoiceDate(data.original_invoice_date)}`);
      }
      const cName = this.padRight(`Customer       : ${data.customer_name.substring(0, leftW - 17)}`, leftW);
      headerLines.push(leftMargin + cName + `Phone: ${data.customer_phone || "-"}`);
      headerLines.push(divSingle);

      if (cols >= 120) {
        headerLines.push(leftMargin + `${this.padRight("#", 2)} ${this.padRight("Item Description", 38)} ${this.padRight("HSN/SAC", 8)} ${this.padRight("Batch", 8)} ${this.padRight("Exp", 5)} ${this.padLeft("Qty", 5)} ${this.padLeft("Rate(Rs)", 10)} ${this.padLeft("Taxable", 11)} ${this.padLeft("GST%", 5)} ${this.padLeft("Amount (Rs.)", 19)}`);
      } else {
        headerLines.push(leftMargin + `${this.padRight("#", 2)} ${this.padRight("Item Description", 25)} ${this.padRight("HSN", 8)} ${this.padRight("Batch", 8)} ${this.padLeft("Qty", 4)} ${this.padLeft("Rate", 7)} ${this.padLeft("GST", 4)} ${this.padLeft("Amount", 9)}`);
      }
      headerLines.push(divSingle);
    }

    const itemLines: string[] = [];
    data.lines.forEach((l, idx) => {
      if (cols <= 65) {
        const is50Col = cols <= 55;
        const descW = is50Col ? 14 : 20;
        const batchW = is50Col ? 6 : 7;
        const rateW = is50Col ? 6 : 7;
        const amtW = is50Col ? 7 : 9;
        const num = this.padRight(idx + 1, 2);
        const desc = l.description.substring(0, descW).padEnd(descW);
        const batch = this.padRight((l.batch_no || "-").substring(0, batchW), batchW);
        const exp = this.padRight(this.formatExpiry((l as any).expiry_date), 5);
        const qty = this.padLeft(l.qty, 4);
        const rate = this.padLeft(l.rate.toFixed(2), rateW);
        const amt = this.padLeft(this.formatAmount(l.amount), amtW);
        itemLines.push(`${leftMargin}${num} ${desc} ${batch} ${exp} ${qty} ${rate} ${amt}`);
      } else if (cols >= 120) {
        const num = this.padRight(idx + 1, 2);
        const desc = l.description.substring(0, 38).padEnd(38);
        const hsn = this.padRight((l.hsn_code || "-").substring(0, 8), 8);
        const batch = this.padRight((l.batch_no || "-").substring(0, 8), 8);
        const exp = this.padRight(this.formatExpiry((l as any).expiry_date), 5);
        const qty = this.padLeft(l.qty, 5);
        const rate = this.padLeft(l.rate.toFixed(2), 10);
        const taxable = this.padLeft(this.formatAmount(l.amount * (1 - (l.gst_percent || 0)/100)), 11);
        const gst = this.padLeft(`${l.gst_percent}%`, 5);
        const amt = this.padLeft(this.formatAmount(l.amount), 19);
        itemLines.push(`${leftMargin}${num} ${desc} ${hsn} ${batch} ${exp} ${qty} ${rate} ${taxable} ${gst} ${amt}`);
      } else {
        const num = this.padRight(idx + 1, 2);
        const desc = l.description.substring(0, 25).padEnd(25);
        const hsn = this.padRight((l.hsn_code || "-").substring(0, 8), 8);
        const batch = this.padRight((l.batch_no || "-").substring(0, 8), 8);
        const qty = this.padLeft(l.qty, 4);
        const rate = this.padLeft(l.rate.toFixed(2), 7);
        const gst = this.padLeft(`${l.gst_percent}%`, 4);
        const amt = this.padLeft(this.formatAmount(l.amount), 9);
        itemLines.push(`${leftMargin}${num} ${desc} ${hsn} ${batch} ${qty} ${rate} ${gst} ${amt}`);
      }
    });

    const footerLines: string[] = [];
    footerLines.push(divSingle);
    footerLines.push(leftMargin + this.padLeft(`Taxable Total : ${curr} ` + this.padLeft(this.formatAmount(data.subtotal), 11), cols));
    footerLines.push(leftMargin + this.padLeft(`Tax Total     : ${curr} ` + this.padLeft(this.formatAmount(data.tax_total), 11), cols));
    footerLines.push(divDouble);
    footerLines.push(leftMargin + this.padLeft(`CREDIT TOTAL  : ${curr} ` + this.padLeft(this.formatAmount(data.grand_total), 11), cols));
    footerLines.push(divDouble);
    const words = data.amount_in_words || numberToWordsIndian(data.grand_total);
    const wordsLines = this.wrapText(`Amount in Words: ${words}`, cols);
    wordsLines.forEach((w) => footerLines.push(leftMargin + w));
    if (data.refund_mode) {
      footerLines.push(leftMargin + `Refund Mode: ${data.refund_mode}`.substring(0, cols));
    }
    footerLines.push("");
    const signRow = `Customer Signature` + " ".repeat(Math.max(2, cols - 18 - 20)) + `Authorised Signatory`;
    footerLines.push(leftMargin + signRow);

    return this.paginateDocument({
      headerLines,
      itemLines,
      footerLines,
      linesPerPage: options?.linesPerPage !== undefined ? options.linesPerPage : 66,
      cols,
      leftMargin,
      documentNumber: data.return_number,
      endOfJobAction: options?.endOfJobAction,
      feedLinesForTearOff: options?.feedLinesForTearOff,
    });
  }

  /**
   * Generates Dot Matrix text for Debit Notes / Purchase Returns
   */
  renderDebitNote(data: DebitNotePrintData, options?: DotMatrixOptions): string {
    const cols = resolveDotMatrixColumns(options);
    const curr = options?.currencyPrefix || "Rs.";
    const leftMargin = resolveLeftMargin(options, cols);
    const divDouble = leftMargin + "=".repeat(cols);
    const divSingle = leftMargin + "-".repeat(cols);

    const headerLines: string[] = [];
    // Store Details FIRST
    headerLines.push(leftMargin + this.center(data.store_name.toUpperCase(), cols));
    if (data.store_address) headerLines.push(leftMargin + this.center(data.store_address, cols));
    headerLines.push(divDouble);

    // Title AFTER Store Details
    headerLines.push(leftMargin + this.center(`*** DEBIT NOTE / PURCHASE RETURN ***`, cols));
    headerLines.push(divSingle);

    if (cols <= 65) {
      const is50Col = cols <= 55;
      const leftW = is50Col ? 26 : Math.min(32, Math.floor(cols * 0.53));
      const rightW = cols - leftW;
      const descW = is50Col ? 14 : 20;
      const batchW = is50Col ? 6 : 7;
      const rateW = is50Col ? 6 : 7;
      const amtW = is50Col ? 7 : 9;

      headerLines.push(leftMargin + this.padRight(`DEBIT NOTE  : #${data.return_number}`, leftW) + this.padRight(`Date: ${this.formatInvoiceDate(data.return_date)}`, rightW));
      if (data.supplier_invoice_no) {
        headerLines.push(leftMargin + this.padRight(`Supplier Inv: #${data.supplier_invoice_no}`, leftW) + this.padRight(`Purch: ${data.original_purchase_number || "-"}`, rightW));
      }
      headerLines.push(leftMargin + this.padRight(`Supplier    : ${(data.supplier_name || "").substring(0, leftW - 14)}`, leftW) + this.padRight(`GST: ${data.supplier_gstin || "-"}`, rightW));
      headerLines.push(divSingle);

      headerLines.push(leftMargin + `${this.padRight("#", 2)} ${this.padRight(is50Col ? "Item Desc" : "Item Description", descW)} ${this.padRight("Batch", batchW)} ${this.padRight("Exp", 5)} ${this.padLeft("Qty", 4)} ${this.padLeft("Rate", rateW)} ${this.padLeft("Amount", amtW)}`);
      headerLines.push(divSingle);
    } else {
      const leftW = cols >= 120 ? 60 : 42;
      headerLines.push(leftMargin + `DEBIT NOTE NO  : #${data.return_number}`.padEnd(leftW) + `Date: ${this.formatInvoiceDate(data.return_date)}`);
      if (data.supplier_invoice_no) {
        headerLines.push(leftMargin + `Supplier Inv   : #${data.supplier_invoice_no}`.padEnd(leftW) + `Purch No: ${data.original_purchase_number || "-"}`);
      }
      const sName = this.padRight(`Supplier       : ${data.supplier_name.substring(0, leftW - 17)}`, leftW);
      headerLines.push(leftMargin + sName + `GSTIN: ${data.supplier_gstin || "-"}`);
      headerLines.push(divSingle);

      if (cols >= 120) {
        headerLines.push(leftMargin + `${this.padRight("#", 2)} ${this.padRight("Item Description", 38)} ${this.padRight("HSN/SAC", 8)} ${this.padRight("Batch", 8)} ${this.padRight("Exp", 5)} ${this.padLeft("Qty", 5)} ${this.padLeft("Rate(Rs)", 10)} ${this.padLeft("Taxable", 11)} ${this.padLeft("GST%", 5)} ${this.padLeft("Amount (Rs.)", 19)}`);
      } else {
        headerLines.push(leftMargin + `${this.padRight("#", 2)} ${this.padRight("Item Description", 25)} ${this.padRight("HSN", 8)} ${this.padRight("Batch", 8)} ${this.padLeft("Qty", 4)} ${this.padLeft("Rate", 7)} ${this.padLeft("GST", 4)} ${this.padLeft("Amount", 9)}`);
      }
      headerLines.push(divSingle);
    }

    const itemLines: string[] = [];
    data.lines.forEach((l, idx) => {
      if (cols <= 65) {
        const is50Col = cols <= 55;
        const descW = is50Col ? 14 : 20;
        const batchW = is50Col ? 6 : 7;
        const rateW = is50Col ? 6 : 7;
        const amtW = is50Col ? 7 : 9;
        const num = this.padRight(idx + 1, 2);
        const desc = l.description.substring(0, descW).padEnd(descW);
        const batch = this.padRight((l.batch_no || "-").substring(0, batchW), batchW);
        const exp = this.padRight(this.formatExpiry((l as any).expiry_date), 5);
        const qty = this.padLeft(l.qty, 4);
        const rate = this.padLeft(l.rate.toFixed(2), rateW);
        const amt = this.padLeft(this.formatAmount(l.amount), amtW);
        itemLines.push(`${leftMargin}${num} ${desc} ${batch} ${exp} ${qty} ${rate} ${amt}`);
      } else if (cols >= 120) {
        const num = this.padRight(idx + 1, 2);
        const desc = l.description.substring(0, 38).padEnd(38);
        const hsn = this.padRight((l.hsn_code || "-").substring(0, 8), 8);
        const batch = this.padRight((l.batch_no || "-").substring(0, 8), 8);
        const exp = this.padRight(this.formatExpiry((l as any).expiry_date), 5);
        const qty = this.padLeft(l.qty, 5);
        const rate = this.padLeft(l.rate.toFixed(2), 10);
        const taxable = this.padLeft(this.formatAmount(l.amount * (1 - (l.gst_percent || 0)/100)), 11);
        const gst = this.padLeft(`${l.gst_percent}%`, 5);
        const amt = this.padLeft(this.formatAmount(l.amount), 19);
        itemLines.push(`${leftMargin}${num} ${desc} ${hsn} ${batch} ${exp} ${qty} ${rate} ${taxable} ${gst} ${amt}`);
      } else {
        const num = this.padRight(idx + 1, 2);
        const desc = l.description.substring(0, 25).padEnd(25);
        const hsn = this.padRight((l.hsn_code || "-").substring(0, 8), 8);
        const batch = this.padRight((l.batch_no || "-").substring(0, 8), 8);
        const qty = this.padLeft(l.qty, 4);
        const rate = this.padLeft(l.rate.toFixed(2), 7);
        const gst = this.padLeft(`${l.gst_percent}%`, 4);
        const amt = this.padLeft(this.formatAmount(l.amount), 9);
        itemLines.push(`${leftMargin}${num} ${desc} ${hsn} ${batch} ${qty} ${rate} ${gst} ${amt}`);
      }
    });

    const footerLines: string[] = [];
    footerLines.push(divSingle);
    footerLines.push(leftMargin + this.padLeft(`Taxable Total : ${curr} ` + this.padLeft(this.formatAmount(data.subtotal), 11), cols));
    footerLines.push(leftMargin + this.padLeft(`Tax Total     : ${curr} ` + this.padLeft(this.formatAmount(data.tax_total), 11), cols));
    footerLines.push(divDouble);
    footerLines.push(leftMargin + this.padLeft(`DEBIT TOTAL   : ${curr} ` + this.padLeft(this.formatAmount(data.grand_total), 11), cols));
    footerLines.push(divDouble);
    const words = data.amount_in_words || numberToWordsIndian(data.grand_total);
    const wordsLines = this.wrapText(`Amount in Words: ${words}`, cols);
    wordsLines.forEach((w) => footerLines.push(leftMargin + w));
    if (data.settlement_type) {
      footerLines.push(leftMargin + `Settlement: ${data.settlement_type}`.substring(0, cols));
    }
    footerLines.push("");
    const signRow = `Supplier Signature` + " ".repeat(Math.max(2, cols - 18 - 20)) + `Authorised Signatory`;
    footerLines.push(leftMargin + signRow);

    return this.paginateDocument({
      headerLines,
      itemLines,
      footerLines,
      linesPerPage: options?.linesPerPage !== undefined ? options.linesPerPage : 66,
      cols,
      leftMargin,
      documentNumber: data.return_number,
      endOfJobAction: options?.endOfJobAction,
      feedLinesForTearOff: options?.feedLinesForTearOff,
    });
  }

  /**
   * Continuous multi-page pagination logic with repeated headers and Form Feeds (\x0C)
   * Only outputs Form Feed (\x0C) between pages, and respects endOfJobAction at the end.
   */
  private paginateDocument(params: {
    headerLines: string[];
    itemLines: string[];
    footerLines: string[];
    linesPerPage: number;
    cols: number;
    leftMargin: string;
    documentNumber: string;
    endOfJobAction?: DotMatrixEndOfJob;
    feedLinesForTearOff?: number;
  }): string {
    const {
      headerLines,
      itemLines,
      footerLines,
      linesPerPage,
      cols,
      leftMargin,
      documentNumber,
      endOfJobAction = "stop_immediately",
      feedLinesForTearOff = 0,
    } = params;

    const trimTrailingEmpty = (lines: string[]): string[] => {
      const copy = [...lines];
      while (copy.length > 0 && copy[copy.length - 1].trim() === "") {
        copy.pop();
      }
      return copy;
    };

    // Continuous Seamless Flow (linesPerPage: 0): Single continuous roll with no artificial page breaks
    if (!linesPerPage || linesPerPage === 0) {
      const allLines = trimTrailingEmpty([...headerLines, ...itemLines, ...footerLines]);
      let result = allLines.join("\n");
      if (endOfJobAction === "form_feed") {
        result += "\n\x0C";
      } else if (endOfJobAction === "feed_tear_off" && feedLinesForTearOff > 0) {
        result += "\n" + "\n".repeat(Math.min(10, Math.max(1, feedLinesForTearOff)));
      }
      return result;
    }

    const printableLinesPerPage = Math.max(10, linesPerPage - 2); // Reserve 2 lines for form-feed margins
    const continuationHead = cols === 132
      ? `${this.padRight("#", 3)} ${this.padRight("Item Description", 46)} ${this.padRight("HSN Code", 10)} ${this.padRight("Batch No", 10)} ${this.padRight("Expiry", 7)} ${this.padLeft("Qty", 8)} ${this.padLeft("Rate(Rs)", 14)} ${this.padLeft("Disc(Rs)", 10)} ${this.padLeft("Taxable(Rs)", 13)} ${this.padLeft("GST%", 6)} ${this.padLeft("Amount(Rs)", 13)}`
      : `${this.padRight("#", 2)} ${this.padRight("Item Description", 25)} ${this.padRight("HSN", 8)} ${this.padRight("Batch", 8)} ${this.padRight("Exp", 5)} ${this.padLeft("Qty", 4)} ${this.padLeft("Rate", 7)} ${this.padLeft("GST", 4)} ${this.padLeft("Amount", 9)}`;

    const continuationHeader = [
      leftMargin + `[ Continued from Page 1 - Document #${documentNumber} ]`,
      leftMargin + "-".repeat(cols),
      leftMargin + continuationHead,
      leftMargin + "-".repeat(cols),
    ];
    const continuationFooter = [
      leftMargin + "-".repeat(cols),
      leftMargin + this.center("[ Continued on Next Page... ]", cols),
    ];

    const pages: string[][] = [];
    let currentPage: string[] = [...headerLines];
    let pageNum = 1;

    for (let i = 0; i < itemLines.length; i++) {
      const line = itemLines[i];
      if (currentPage.length + 1 + continuationFooter.length > printableLinesPerPage) {
        currentPage.push(...continuationFooter);
        pages.push(trimTrailingEmpty(currentPage));
        pageNum++;
        currentPage = [...continuationHeader];
      }
      currentPage.push(line);
    }

    if (currentPage.length + footerLines.length > printableLinesPerPage) {
      currentPage.push(...continuationFooter);
      pages.push(trimTrailingEmpty(currentPage));
      pageNum++;
      currentPage = [
        leftMargin + `[ Document #${documentNumber} - Totals & Summary ]`,
        leftMargin + "-".repeat(cols),
        ...footerLines,
      ];
      pages.push(trimTrailingEmpty(currentPage));
    } else {
      currentPage.push(...footerLines);
      pages.push(trimTrailingEmpty(currentPage));
    }

    // Join pages with Form Feed character (\x0C) strictly BETWEEN pages only!
    let output = pages.map((p) => p.join("\n")).join("\n\x0C\n");

    // Trailing behavior after the last printed line:
    if (endOfJobAction === "form_feed") {
      output += "\n\x0C";
    } else if (endOfJobAction === "feed_tear_off" && feedLinesForTearOff > 0) {
      output += "\n" + "\n".repeat(Math.min(10, Math.max(1, feedLinesForTearOff)));
    }
    // "stop_immediately" (default) appends neither form feed nor extra lines.

    return output;
  }

  /**
   * Generates ESC/P binary sequence with escape commands for hardware dot matrix printers.
   * Supports 'esc_p', 'tvs_native', and 'plain_ascii' command sets.
   */
  generateEscPBytes(rawText: string, options?: DotMatrixOptions): Uint8Array {
    const bytes: number[] = [];
    const encoder = new TextEncoder();
    const commandSet = options?.commandSet || "esc_p";
    const endOfJobAction = options?.endOfJobAction || "stop_immediately";
    const feedLines = Math.min(10, Math.max(0, options?.feedLinesForTearOff || 0));

    // Convert non-ASCII currency symbol (₹ -> Rs.)
    let cleanText = rawText.replace(/₹/g, options?.currencyPrefix || "Rs.");

    if (commandSet === "plain_ascii") {
      // 1. Plain ASCII Mode (Generic / Text Only driver): No escape codes!
      cleanText = cleanText
        .replace(/[^\x00-\x7F]/g, "")
        .replace(/\r\n/g, "\n")
        .replace(/\n/g, "\r\n");

      // Strip trailing form feed if not requested
      if (endOfJobAction !== "form_feed") {
        cleanText = cleanText.replace(/\x0C+$/, "");
      }

      if (!cleanText.endsWith("\r\n")) {
        cleanText += "\r\n";
      }

      const encoded = encoder.encode(cleanText);
      for (let i = 0; i < encoded.length; i++) {
        bytes.push(encoded[i]);
      }

      if (endOfJobAction === "feed_tear_off" && feedLines > 0) {
        for (let i = 0; i < feedLines; i++) {
          bytes.push(0x0D, 0x0A);
        }
      } else if (endOfJobAction === "form_feed") {
        if (bytes[bytes.length - 1] !== 0x0C) {
          bytes.push(0x0C);
        }
      }

      return new Uint8Array(bytes);
    }

    // 2. Hardware ESC/P and TVS MSP Native Command Sets:
    // 1. Initialize Printer (ESC @) at start of job
    bytes.push(0x1B, 0x40);

    // 2. Select Draft Mode (ESC x 0)
    bytes.push(0x1B, 0x78, 0x00);

    // 3. Set Pitch / CPI
    const cols = resolveDotMatrixColumns(options);
    if (cols >= 125 || options?.columns === 132 || options?.cpi === "17cpi_condensed") {
      bytes.push(0x0F); // Condensed mode (17.14 CPI)
    } else if (options?.cpi === "12cpi") {
      bytes.push(0x1B, 0x4D); // 12 CPI Elite
    } else {
      bytes.push(0x12); // Cancel condensed mode (DC2 = 0x12)
      bytes.push(0x1B, 0x50); // 10 CPI Pica
    }

    // 4. Set Line Spacing (ESC 2 = 1/6" standard)
    bytes.push(0x1B, 0x32);

    // 5. Optional Double Strike for Carbon Copies (ESC G)
    if (options?.doubleStrikeCarbon) {
      bytes.push(0x1B, 0x47);
    }

    // 6. Set Form Length in lines (ESC C n) - only when linesPerPage is specified
    if (options?.linesPerPage && options.linesPerPage > 0) {
      bytes.push(0x1B, 0x43, Math.min(127, options.linesPerPage));
    }

    // Convert to CRLF line endings
    cleanText = cleanText
      .replace(/[^\x00-\x7F]/g, "")
      .replace(/\r\n/g, "\n")
      .replace(/\n/g, "\r\n");

    // Strip trailing form feed if not explicitly requested
    if (endOfJobAction !== "form_feed") {
      cleanText = cleanText.replace(/\x0C+$/, "");
    }

    if (!cleanText.endsWith("\r\n")) {
      cleanText += "\r\n";
    }

    const encoded = encoder.encode(cleanText);
    for (let i = 0; i < encoded.length; i++) {
      bytes.push(encoded[i]);
    }

    // Cleanly cancel active modes without ejecting paper (safe reset)
    if (options?.doubleStrikeCarbon) {
      bytes.push(0x1B, 0x48); // Cancel double strike (ESC H)
    }
    if (cols >= 125 || options?.columns === 132 || options?.cpi === "17cpi_condensed") {
      bytes.push(0x12); // Cancel condensed mode (DC2)
    }

    // End-of-job paper handling:
    if (endOfJobAction === "feed_tear_off" && feedLines > 0) {
      for (let i = 0; i < feedLines; i++) {
        bytes.push(0x0D, 0x0A);
      }
    } else if (endOfJobAction === "form_feed") {
      if (bytes[bytes.length - 1] !== 0x0C) {
        bytes.push(0x0C);
      }
    }
    // "stop_immediately" (default) leaves print head exactly after the last character.

    return new Uint8Array(bytes);
  }

  /**
   * Generates authentic Continuous-Form HTML Preview with tractor-feed strips,
   * exact character grid, column ruler, line numbers gutter, and page boundaries.
   */
  generateMonospaceHtmlPreview(text: string, options?: DotMatrixPreviewOptions): string {
    const cols = resolveDotMatrixColumns(options);
    const carriageCols = options?.printerCarriageColumns || cols;
    const rCols = Math.max(cols, carriageCols);
    const showRuler = options?.showRuler !== false;
    const showLineNumbers = options?.showLineNumbers !== false;
    const showPageBreaks = options?.showPageBreaks !== false;
    const is132 = rCols >= 125;

    const pages = text.split("\x0C").filter((p) => p.trim().length > 0);

    // 1. Exact Column Ruler (Tens and Units align with 100% character grid accuracy across carriage)
    let rTens = "";
    let rUnits = "";
    for (let i = 1; i <= rCols; i++) {
      if (i % 10 === 0) {
        rTens += String(i / 10);
      } else {
        rTens += " ";
      }
      rUnits += String(i % 10);
    }

    const rulerHtml = showRuler
      ? `<div class="ruler-container select-none mb-3">
          <div class="dot-line ruler-tens-line text-emerald-400">
            ${showLineNumbers ? `<span class="line-no text-emerald-600 border-emerald-800">COL</span>` : ""}
            <span class="line-content ruler-tens font-bold">${rTens}</span>
          </div>
          <div class="dot-line ruler-units-line text-emerald-300">
            ${showLineNumbers ? `<span class="line-no text-emerald-600 border-emerald-800"></span>` : ""}
            <span class="line-content ruler-units">${rUnits}</span>
          </div>
        </div>`
      : "";

    // 2. Render Pages with Tractor Feed Margins
    const renderedPagesHtml = pages
      .map((pageText, pIdx) => {
        const lines = pageText.split("\n");
        const renderedLines = lines
          .map((rawLine, lIdx) => {
            const lineNum = String(lIdx + 1).padStart(2, "0");
            const escaped = rawLine
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");

            // Detect bold lines (store name, TAX INVOICE, GRAND TOTAL, headers)
            const isBoldLine =
              rawLine.includes("TAX INVOICE") ||
              rawLine.includes("GRAND TOTAL") ||
              rawLine.includes("Item Description") ||
              rawLine.includes("========================================");

            const lineNumHtml = showLineNumbers
              ? `<span class="line-no">${lineNum}</span>`
              : "";

            return `<div class="dot-line ${isBoldLine ? "font-bold text-slate-950 dark:text-white" : ""}">
              ${lineNumHtml}
              <span class="line-content">${escaped || " "}</span>
            </div>`;
          })
          .join("");

        const isLastPage = pIdx === pages.length - 1;
        let endBadgeHtml = "";
        if (isLastPage) {
          const action = options?.endOfJobAction || "stop_immediately";
          const feedN = options?.feedLinesForTearOff || 0;
          let endLabel = "End of print, no paper feed";
          if (action === "form_feed") {
            endLabel = "End of print, form feed to top of next page";
          } else if (action === "feed_tear_off" && feedN > 0) {
            endLabel = `End of print, feed ${feedN} line(s) for tear-off`;
          }
          endBadgeHtml = `
            <div class="end-of-print-badge select-none">
              <span class="badge-line"></span>
              <span class="badge-text">${endLabel}</span>
              <span class="badge-line"></span>
            </div>
          `;
        }

        const pageBreakHtml =
          showPageBreaks && pIdx < pages.length - 1
            ? `<div class="page-break-badge select-none">
                <span class="badge-line"></span>
                <span class="badge-text">PAGE BREAK • FORM FEED (PAGE ${pIdx + 1} OF ${pages.length})</span>
                <span class="badge-line"></span>
              </div>`
            : "";

        return `
          <div class="page-wrapper mb-6">
            <div class="paper-card">
              <div class="tractor-strip-left"></div>
              <div class="paper-body">
                ${pIdx === 0 ? rulerHtml : ""}
                ${renderedLines}
                ${endBadgeHtml}
              </div>
              <div class="tractor-strip-right"></div>
            </div>
            ${pageBreakHtml}
          </div>
        `;
      })
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Dot Matrix Continuous Form Preview</title>
  <style>
    @page { size: auto; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      font-family: 'Courier New', Courier, 'DejaVu Sans Mono', 'Liberation Mono', Menlo, Consolas, monospace;
      background-color: #1e293b;
      color: #1e293b;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
    }
    
    .ruler-container {
      font-family: 'Courier New', Courier, monospace;
      font-size: 13px;
      line-height: 18px;
      background-color: #064e3b;
      padding: 6px 8px;
      border-radius: 4px;
      margin-bottom: 12px;
      white-space: pre;
      letter-spacing: 0px;
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.4);
      width: 100%;
    }
    .ruler-tens { font-weight: bold; color: #34d399; }
    .ruler-units { color: #6ee7b7; opacity: 0.9; }

    .forms-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
    }

    .page-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: fit-content;
    }

    .paper-card {
      display: flex;
      align-items: stretch;
      background-color: #faf8f2;
      border-radius: 2px;
      box-shadow: 0 12px 30px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
      border: 1px solid #cbd5e1;
      overflow: hidden;
      width: fit-content;
    }

    /* Tractor Feed Hole Strips (Continuous Stationery) */
    .tractor-strip-left, .tractor-strip-right {
      width: 28px;
      align-self: stretch;
      background-color: #f1ede2;
      background-image: radial-gradient(circle at 14px 12px, #94a3b8 4px, #f1ede2 4.5px);
      background-size: 28px 24px;
      flex-shrink: 0;
    }
    .tractor-strip-left { border-right: 1px dashed #cbd5e1; }
    .tractor-strip-right { border-left: 1px dashed #cbd5e1; }

    .paper-body {
      padding: 16px 20px;
      background-color: #fefdfa;
      min-width: ${Math.max(480, Math.round(rCols * 8.6 + 40))}px;
    }

    .dot-line {
      display: flex;
      align-items: baseline;
      font-family: 'Courier New', Courier, 'DejaVu Sans Mono', monospace;
      font-size: 13px;
      line-height: 18px;
      white-space: pre;
      letter-spacing: 0px;
    }
    .dot-line:hover {
      background-color: rgba(16, 185, 129, 0.08);
    }

    .line-no {
      display: inline-block;
      width: 28px;
      text-align: right;
      padding-right: 8px;
      margin-right: 10px;
      color: #94a3b8;
      font-size: 11px;
      user-select: none;
      border-right: 1px solid #e2e8f0;
      flex-shrink: 0;
    }

    .line-content {
      white-space: pre;
      font-family: inherit;
      color: #1e293b;
    }

    .page-break-badge {
      display: flex;
      align-items: center;
      width: 100%;
      margin: 16px 0;
      color: #10b981;
      font-size: 10px;
      font-weight: bold;
    }
    .badge-line {
      flex: 1;
      border-bottom: 2px dashed #059669;
    }
    .badge-text {
      padding: 0 12px;
      letter-spacing: 1px;
    }

    .end-of-print-badge {
      display: flex;
      align-items: center;
      width: 100%;
      margin: 16px 0 8px 0;
      color: #64748b;
      font-size: 11px;
      font-weight: bold;
    }
    .end-of-print-badge .badge-line {
      flex: 1;
      border-bottom: 2px solid #cbd5e1;
    }
    .end-of-print-badge .badge-text {
      padding: 0 12px;
      letter-spacing: 0.5px;
      color: #475569;
    }

    @media print {
      body { background-color: white !important; padding: 0 !important; }
      .ruler-container, .tractor-strip-left, .tractor-strip-right, .line-no, .page-break-badge, .end-of-print-badge { display: none !important; }
      .paper-card { box-shadow: none !important; border: none !important; background: transparent !important; page-break-after: always; }
      .paper-body { padding: 0 !important; min-width: auto !important; }
      .line-content { font-size: 10pt !important; line-height: 1.2 !important; color: black !important; }
    }
  </style>
</head>
<body>
  <div class="forms-container">
    ${renderedPagesHtml}
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
</html>`;
  }

  /**
   * Generates a Monospace PDF document for Dot Matrix preview saving.
   */
  generateMonospacePdf(text: string, options?: DotMatrixOptions): Uint8Array {
    const cols = resolveDotMatrixColumns(options);
    const isWide = cols >= 100;
    const doc = new jsPDF({
      orientation: isWide ? "landscape" : "portrait",
      unit: "mm",
      format: "a4",
    });

    const pages = text.split("\x0C").filter((p) => p.trim().length > 0);
    const fontSize = isWide ? 6.5 : (cols <= 65 ? 9.5 : 8.5);
    const lineHeight = isWide ? 3.0 : (cols <= 65 ? 4.2 : 3.8);
    const startX = 10;
    const startY = 12;

    doc.setFont("courier", "normal");
    doc.setFontSize(fontSize);

    pages.forEach((pageText, pIdx) => {
      if (pIdx > 0) doc.addPage();
      const lines = pageText.split("\n");
      let y = startY;

      lines.forEach((line) => {
        const clean = line.replace(/₹/g, "Rs.");
        doc.text(clean, startX, y);
        y += lineHeight;
      });
    });

    return new Uint8Array(doc.output("arraybuffer"));
  }
}

export const dotMatrixRenderer = new DotMatrixRenderer();
