import { InvoicePrintData, CreditNotePrintData, DebitNotePrintData, HsnSummaryRow, calculateHsnSummary, numberToWordsIndian } from "./printingEngine";
import { jsPDF } from "jspdf";

export type DotMatrixCommandSet = "esc_p" | "tvs_native" | "plain_ascii";
export type DotMatrixPitch = "10cpi" | "12cpi" | "17cpi_condensed";

export interface DotMatrixOptions {
  columns?: 80 | 132;
  linesPerPage?: number; // default 66 lines for 11", 72 for 12", 33 for 6" half-page
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
}

export interface DotMatrixPreviewOptions {
  columns?: 80 | 132;
  showRuler?: boolean;
  showLineNumbers?: boolean;
  showPageBreaks?: boolean;
  showTractorFeed?: boolean;
  enableBold?: boolean;
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
   * Generates formatted continuous dot-matrix text for a Tax Invoice (80 or 132 columns).
   */
  renderInvoice(data: InvoicePrintData, options?: DotMatrixOptions): string {
    const cols = options?.columns === 132 ? 132 : 80;
    if (options?.prePrintedStationery) {
      return this.renderPrePrintedInvoice(data, options);
    }
    if (cols === 132) {
      return this.renderInvoice132(data, options);
    }
    return this.renderInvoice80(data, options);
  }

  /**
   * 80-Column Standard Dot Matrix Format (for 9-pin/24-pin 80-column printers like Epson LX-310, TVS MSP).
   */
  private renderInvoice80(data: InvoicePrintData, options?: DotMatrixOptions): string {
    const cols = 80;
    const linesPerPage = options?.linesPerPage !== undefined ? options.linesPerPage : 66;
    const curr = options?.currencyPrefix || "Rs.";
    const leftMargin = " ".repeat(options?.leftMarginSpaces || 0);
    const divDouble = leftMargin + "=".repeat(cols);
    const divSingle = leftMargin + "-".repeat(cols);

    // Build Header Section Lines
    const headerLines: string[] = [];
    if (options?.topMarginLines) {
      for (let i = 0; i < options.topMarginLines; i++) headerLines.push("");
    }

    // Title / Duplicate Marker Bar
    const isDup = options?.isDuplicate || options?.copyMarker;
    const dupText = options?.copyMarker || "DUPLICATE COPY";
    if (isDup) {
      const title = "TAX INVOICE";
      const dupTag = `*** ${dupText} ***`;
      headerLines.push(leftMargin + title + " ".repeat(Math.max(1, cols - title.length - dupTag.length)) + dupTag);
    } else {
      headerLines.push(leftMargin + this.center("TAX INVOICE", cols));
    }

    // Store Details (Centered, non-wrapping)
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
    rightMeta.push(`Date       : ${data.invoice_date}${data.invoice_time ? ` ${data.invoice_time}` : ""}`);
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
    });
  }

  /**
   * 132-Column Wide Dot Matrix Format (for wide carriage or 17 CPI condensed mode)
   */
  private renderInvoice132(data: InvoicePrintData, options?: DotMatrixOptions): string {
    const cols = 132;
    const linesPerPage = options?.linesPerPage !== undefined ? options.linesPerPage : 66;
    const curr = options?.currencyPrefix || "Rs.";
    const leftMargin = " ".repeat(options?.leftMarginSpaces || 0);
    const divDouble = leftMargin + "=".repeat(cols);
    const divSingle = leftMargin + "-".repeat(cols);

    const headerLines: string[] = [];
    if (options?.topMarginLines) {
      for (let i = 0; i < options.topMarginLines; i++) headerLines.push("");
    }

    const isDup = options?.isDuplicate || options?.copyMarker;
    const dupText = options?.copyMarker || "DUPLICATE COPY";
    if (isDup) {
      const title = "TAX INVOICE";
      const dupTag = `*** ${dupText} ***`;
      headerLines.push(leftMargin + title + " ".repeat(Math.max(1, cols - title.length - dupTag.length)) + dupTag);
    } else {
      headerLines.push(leftMargin + this.center("TAX INVOICE", cols));
    }

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

    // 3-Column Meta Grid in 132 columns
    const p1 = `Customer : ${data.customer_name || "Walk-in Customer"}`.padEnd(46);
    const p2 = `Invoice No: #${data.invoice_number}`.padEnd(42);
    const p3 = `Date: ${data.invoice_date} ${data.invoice_time || ""}`.padEnd(44);
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
    const itemHead132 = `${this.padRight("#", 3)} ${this.padRight("Item Description", 46)} ${this.padRight("HSN Code", 10)} ${this.padRight("Batch No", 10)} ${this.padRight("Expiry", 7)} ${this.padLeft("Qty", 8)} ${this.padLeft("Rate(Rs)", 14)} ${this.padLeft("Disc(Rs)", 10)} ${this.padLeft("Taxable(Rs)", 13)} ${this.padLeft("GST%", 6)} ${this.padLeft("Amount(Rs)", 13)}`;
    headerLines.push(leftMargin + itemHead132);
    headerLines.push(divSingle);

    const itemLines: string[] = [];
    data.lines.forEach((item, idx) => {
      const num = this.padRight(idx + 1, 3);
      const desc = item.description.substring(0, 46).padEnd(46);
      const hsn = this.padRight((item.hsn_code || "-").substring(0, 10), 10);
      const batch = this.padRight((item.batch_no || "-").substring(0, 10), 10);
      const exp = this.padRight(this.formatExpiry(item.expiry_date), 7);
      const qty = this.padLeft(this.formatQty(item.qty, item.loose_qty), 8);
      const rate = this.padLeft(item.rate.toFixed(2), 14);
      const disc = this.padLeft(this.formatAmount(item.discount_amount || 0), 10);
      const taxable = this.padLeft(this.formatAmount(item.taxable_amount || (item.amount / (1 + item.gst_percent / 100))), 13);
      const gst = this.padLeft(`${item.gst_percent}%`, 6);
      const amt = this.padLeft(this.formatAmount(item.amount), 13);

      itemLines.push(`${leftMargin}${num} ${desc} ${hsn} ${batch} ${exp} ${qty} ${rate} ${disc} ${taxable} ${gst} ${amt}`);

      if (!options?.truncateDescriptions && item.description.length > 46) {
        const rem = this.wrapText(item.description.substring(46), 90);
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
    });
  }

  /**
   * Pre-printed stationery format (Prints values at fixed coordinates without borders).
   */
  private renderPrePrintedInvoice(data: InvoicePrintData, options?: DotMatrixOptions): string {
    const linesPerPage = options?.linesPerPage || 66;
    const leftMargin = " ".repeat(options?.leftMarginSpaces || 0);
    const outLines: string[] = [];

    // Header offset for pre-printed letterhead
    for (let i = 0; i < (options?.topMarginLines || 8); i++) {
      outLines.push("");
    }

    // Document Meta
    outLines.push(leftMargin + `               ${data.invoice_number.padEnd(25)} ${data.invoice_date}`);
    outLines.push(leftMargin + `               ${(data.customer_name || "Cash").padEnd(25)} ${data.customer_phone || ""}`);
    outLines.push("");

    // Items
    data.lines.forEach((item, idx) => {
      const num = this.padRight(idx + 1, 3);
      const desc = item.description.substring(0, 25).padEnd(25);
      const batch = this.padRight(item.batch_no || "-", 8);
      const qty = this.padLeft(item.qty, 5);
      const rate = this.padLeft(item.rate.toFixed(2), 8);
      const amt = this.padLeft(this.formatAmount(item.amount), 10);
      outLines.push(`${leftMargin}${num} ${desc} ${batch} ${qty} ${rate} ${amt}`);
    });

    while (outLines.length < linesPerPage - 8) {
      outLines.push("");
    }

    // Totals at bottom
    outLines.push(leftMargin + " ".repeat(55) + this.padLeft(this.formatAmount(data.subtotal), 12));
    outLines.push(leftMargin + " ".repeat(55) + this.padLeft(this.formatAmount(data.tax_total), 12));
    outLines.push(leftMargin + " ".repeat(55) + this.padLeft(this.formatAmount(data.grand_total), 12));
    outLines.push("\x0C");

    return outLines.join("\n");
  }

  /**
   * Generates Dot Matrix text for Credit Notes / Sales Returns
   */
  renderCreditNote(data: CreditNotePrintData, options?: DotMatrixOptions): string {
    const cols = options?.columns === 132 ? 132 : 80;
    const curr = options?.currencyPrefix || "Rs.";
    const leftMargin = " ".repeat(options?.leftMarginSpaces || 0);
    const divDouble = leftMargin + "=".repeat(cols);
    const divSingle = leftMargin + "-".repeat(cols);

    const headerLines: string[] = [];
    headerLines.push(leftMargin + this.center(`*** CREDIT NOTE / SALES RETURN ***`, cols));
    headerLines.push(leftMargin + this.center(data.store_name.toUpperCase(), cols));
    if (data.store_address) headerLines.push(leftMargin + this.center(data.store_address, cols));
    headerLines.push(divDouble);

    headerLines.push(leftMargin + `CREDIT NOTE NO : #${data.return_number}`.padEnd(42) + `Date: ${data.return_date}`);
    if (data.original_invoice_number) {
      headerLines.push(leftMargin + `Orig Invoice   : #${data.original_invoice_number}`.padEnd(42) + `Inv Date: ${data.original_invoice_date || "-"}`);
    }
    const cName = this.padRight(`Customer       : ${data.customer_name.substring(0, 25)}`, 42);
    headerLines.push(leftMargin + cName + `Phone: ${data.customer_phone || "-"}`);
    headerLines.push(divSingle);

    headerLines.push(leftMargin + `${this.padRight("#", 2)} ${this.padRight("Item Description", 25)} ${this.padRight("HSN", 8)} ${this.padRight("Batch", 8)} ${this.padLeft("Qty", 4)} ${this.padLeft("Rate", 7)} ${this.padLeft("GST", 4)} ${this.padLeft("Amount", 9)}`);
    headerLines.push(divSingle);

    const itemLines: string[] = [];
    data.lines.forEach((l, idx) => {
      const num = this.padRight(idx + 1, 2);
      const desc = l.description.substring(0, 25).padEnd(25);
      const hsn = this.padRight((l.hsn_code || "-").substring(0, 8), 8);
      const batch = this.padRight((l.batch_no || "-").substring(0, 8), 8);
      const qty = this.padLeft(l.qty, 4);
      const rate = this.padLeft(l.rate.toFixed(2), 7);
      const gst = this.padLeft(`${l.gst_percent}%`, 4);
      const amt = this.padLeft(this.formatAmount(l.amount), 9);
      itemLines.push(`${leftMargin}${num} ${desc} ${hsn} ${batch} ${qty} ${rate} ${gst} ${amt}`);
    });

    const footerLines: string[] = [];
    footerLines.push(divSingle);
    footerLines.push(leftMargin + this.padLeft(`Taxable Total : ${curr} ` + this.padLeft(this.formatAmount(data.subtotal), 11), cols));
    footerLines.push(leftMargin + this.padLeft(`Tax Total     : ${curr} ` + this.padLeft(this.formatAmount(data.tax_total), 11), cols));
    footerLines.push(divDouble);
    footerLines.push(leftMargin + this.padLeft(`CREDIT TOTAL  : ${curr} ` + this.padLeft(this.formatAmount(data.grand_total), 11), cols));
    footerLines.push(divDouble);
    footerLines.push(leftMargin + `Amount in Words: ${data.amount_in_words || numberToWordsIndian(data.grand_total)}`);
    footerLines.push(leftMargin + `Refund Mode: ${data.refund_mode}`);
    footerLines.push("");
    footerLines.push(leftMargin + `Customer Signature` + " ".repeat(cols - 18 - 25) + `Authorised Signatory`);

    return this.paginateDocument({
      headerLines,
      itemLines,
      footerLines,
      linesPerPage: options?.linesPerPage !== undefined ? options.linesPerPage : 66,
      cols,
      leftMargin,
      documentNumber: data.return_number,
    });
  }

  /**
   * Generates Dot Matrix text for Debit Notes / Purchase Returns
   */
  renderDebitNote(data: DebitNotePrintData, options?: DotMatrixOptions): string {
    const cols = options?.columns === 132 ? 132 : 80;
    const curr = options?.currencyPrefix || "Rs.";
    const leftMargin = " ".repeat(options?.leftMarginSpaces || 0);
    const divDouble = leftMargin + "=".repeat(cols);
    const divSingle = leftMargin + "-".repeat(cols);

    const headerLines: string[] = [];
    headerLines.push(leftMargin + this.center(`*** DEBIT NOTE / PURCHASE RETURN ***`, cols));
    headerLines.push(leftMargin + this.center(data.store_name.toUpperCase(), cols));
    headerLines.push(divDouble);

    headerLines.push(leftMargin + `DEBIT NOTE NO  : #${data.return_number}`.padEnd(42) + `Date: ${data.return_date}`);
    if (data.supplier_invoice_no) {
      headerLines.push(leftMargin + `Supplier Inv   : #${data.supplier_invoice_no}`.padEnd(42) + `Purch No: ${data.original_purchase_number || "-"}`);
    }
    const sName = this.padRight(`Supplier       : ${data.supplier_name.substring(0, 25)}`, 42);
    headerLines.push(leftMargin + sName + `GSTIN: ${data.supplier_gstin || "-"}`);
    headerLines.push(divSingle);

    headerLines.push(leftMargin + `${this.padRight("#", 2)} ${this.padRight("Item Description", 25)} ${this.padRight("HSN", 8)} ${this.padRight("Batch", 8)} ${this.padLeft("Qty", 4)} ${this.padLeft("Rate", 7)} ${this.padLeft("GST", 4)} ${this.padLeft("Amount", 9)}`);
    headerLines.push(divSingle);

    const itemLines: string[] = [];
    data.lines.forEach((l, idx) => {
      const num = this.padRight(idx + 1, 2);
      const desc = l.description.substring(0, 25).padEnd(25);
      const hsn = this.padRight((l.hsn_code || "-").substring(0, 8), 8);
      const batch = this.padRight((l.batch_no || "-").substring(0, 8), 8);
      const qty = this.padLeft(l.qty, 4);
      const rate = this.padLeft(l.rate.toFixed(2), 7);
      const gst = this.padLeft(`${l.gst_percent}%`, 4);
      const amt = this.padLeft(this.formatAmount(l.amount), 9);
      itemLines.push(`${leftMargin}${num} ${desc} ${hsn} ${batch} ${qty} ${rate} ${gst} ${amt}`);
    });

    const footerLines: string[] = [];
    footerLines.push(divSingle);
    footerLines.push(leftMargin + this.padLeft(`Taxable Total : ${curr} ` + this.padLeft(this.formatAmount(data.subtotal), 11), cols));
    footerLines.push(leftMargin + this.padLeft(`Tax Total     : ${curr} ` + this.padLeft(this.formatAmount(data.tax_total), 11), cols));
    footerLines.push(divDouble);
    footerLines.push(leftMargin + this.padLeft(`DEBIT TOTAL   : ${curr} ` + this.padLeft(this.formatAmount(data.grand_total), 11), cols));
    footerLines.push(divDouble);
    footerLines.push(leftMargin + `Amount in Words: ${data.amount_in_words || numberToWordsIndian(data.grand_total)}`);
    footerLines.push(leftMargin + `Settlement: ${data.settlement_type}`);
    footerLines.push("");
    footerLines.push(leftMargin + `Supplier Signature` + " ".repeat(cols - 18 - 25) + `Authorised Signatory`);

    return this.paginateDocument({
      headerLines,
      itemLines,
      footerLines,
      linesPerPage: options?.linesPerPage !== undefined ? options.linesPerPage : 66,
      cols,
      leftMargin,
      documentNumber: data.return_number,
    });
  }

  /**
   * Continuous multi-page pagination logic with repeated headers and Form Feeds (\x0C)
   */
  private paginateDocument(params: {
    headerLines: string[];
    itemLines: string[];
    footerLines: string[];
    linesPerPage: number;
    cols: number;
    leftMargin: string;
    documentNumber: string;
  }): string {
    const { headerLines, itemLines, footerLines, linesPerPage, cols, leftMargin, documentNumber } = params;

    // Continuous Seamless Flow (linesPerPage: 0): Single continuous roll with no artificial page breaks
    if (!linesPerPage || linesPerPage === 0) {
      const allLines = [...headerLines, ...itemLines, ...footerLines];
      return allLines.join("\n") + "\n\x0C";
    }

    const printableLinesPerPage = linesPerPage - 2; // Reserve 2 lines for form-feed margins
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
        pages.push(currentPage);
        pageNum++;
        currentPage = [...continuationHeader];
      }
      currentPage.push(line);
    }

    if (currentPage.length + footerLines.length > printableLinesPerPage) {
      currentPage.push(...continuationFooter);
      pages.push(currentPage);
      pageNum++;
      currentPage = [
        leftMargin + `[ Document #${documentNumber} - Totals & Summary ]`,
        leftMargin + "-".repeat(cols),
        ...footerLines,
      ];
      pages.push(currentPage);
    } else {
      currentPage.push(...footerLines);
      pages.push(currentPage);
    }

    // Join pages with Form Feed character (\x0C)
    return pages.map((p) => p.join("\n")).join("\n\x0C\n") + "\n\x0C";
  }

  /**
   * Generates ESC/P binary sequence with escape commands for hardware dot matrix printers.
   */
  generateEscPBytes(rawText: string, options?: DotMatrixOptions): Uint8Array {
    const bytes: number[] = [];
    const encoder = new TextEncoder();

    // 1. Initialize Printer (ESC @)
    bytes.push(0x1B, 0x40);

    // 2. Select Draft Mode (ESC x 0)
    bytes.push(0x1B, 0x78, 0x00);

    // 3. Set Pitch / CPI
    if (options?.columns === 132 || options?.cpi === "17cpi_condensed") {
      bytes.push(0x0F);
    } else if (options?.cpi === "12cpi") {
      bytes.push(0x1B, 0x4D);
    } else {
      bytes.push(0x1B, 0x50);
    }

    // 4. Set Line Spacing (ESC 2 = 1/6")
    bytes.push(0x1B, 0x32);

    // 5. Optional Double Strike for Carbon Copies (ESC G)
    if (options?.doubleStrikeCarbon) {
      bytes.push(0x1B, 0x47);
    }

    // 6. Set Form Length in lines (ESC C n)
    if (options?.linesPerPage) {
      bytes.push(0x1B, 0x43, Math.min(127, options.linesPerPage));
    }

    // Convert non-ASCII symbols (e.g. ₹ -> Rs.) and encode with CRLF line endings
    const cleanText = rawText
      .replace(/₹/g, "Rs.")
      .replace(/\r\n/g, "\n")
      .replace(/\n/g, "\r\n");

    const encoded = encoder.encode(cleanText);
    for (let i = 0; i < encoded.length; i++) {
      bytes.push(encoded[i]);
    }

    // 7. Ensure terminating Form Feed (\x0C)
    if (bytes[bytes.length - 1] !== 0x0C && bytes[bytes.length - 2] !== 0x0C) {
      bytes.push(0x0C);
    }

    return new Uint8Array(bytes);
  }

  /**
   * Generates authentic Continuous-Form HTML Preview with tractor-feed strips,
   * exact character grid, column ruler, line numbers gutter, and page boundaries.
   */
  generateMonospaceHtmlPreview(text: string, options?: DotMatrixPreviewOptions): string {
    const cols = options?.columns || 80;
    const showRuler = options?.showRuler !== false;
    const showLineNumbers = options?.showLineNumbers !== false;
    const showPageBreaks = options?.showPageBreaks !== false;
    const is132 = cols === 132;

    const pages = text.split("\x0C").filter((p) => p.trim().length > 0);

    // 1. Exact Column Ruler (Tens and Units align with 100% character grid accuracy)
    let rTens = "";
    let rUnits = "";
    for (let i = 1; i <= cols; i++) {
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
      min-width: ${is132 ? "1050px" : "680px"};
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

    @media print {
      body { background-color: white !important; padding: 0 !important; }
      .ruler-container, .tractor-strip-left, .tractor-strip-right, .line-no, .page-break-badge { display: none !important; }
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
    const is132 = options?.columns === 132;
    const doc = new jsPDF({
      orientation: is132 ? "landscape" : "portrait",
      unit: "mm",
      format: "a4",
    });

    const pages = text.split("\x0C").filter((p) => p.trim().length > 0);
    const fontSize = is132 ? 6.5 : 8.5;
    const lineHeight = is132 ? 3.0 : 3.8;
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
