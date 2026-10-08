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

export interface DotMatrixPage {
  pageNumber: number;
  totalPages: number;
  lines: string[];
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
   * Wraps long text into lines of specified maximum width.
   */
  wrapText(text: string, width: number): string[] {
    if (!text) return [];
    const words = text.trim().split(/\s+/);
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      if (!currentLine) {
        if (word.length > width) {
          // Word longer than width, split forcefully
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
   * Formats numbers to 2 decimal places with standard commas.
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
   * Formats quantity with loose pieces.
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
    const linesPerPage = options?.linesPerPage || 66; // 11" stationery default
    const curr = options?.currencyPrefix || "Rs.";
    const leftMargin = " ".repeat(options?.leftMarginSpaces || 0);

    if (options?.prePrintedStationery) {
      return this.renderPrePrintedInvoice(data, options);
    }

    if (cols === 132) {
      return this.renderInvoice132(data, options);
    }

    return this.renderInvoice80(data, options);
  }

  /**
   * 80-Column Standard Dot Matrix Format (for standard 9-pin/24-pin 80-column printers)
   */
  private renderInvoice80(data: InvoicePrintData, options?: DotMatrixOptions): string {
    const cols = 80;
    const linesPerPage = options?.linesPerPage || 66;
    const curr = options?.currencyPrefix || "Rs.";
    const leftMargin = " ".repeat(options?.leftMarginSpaces || 0);
    const divDouble = leftMargin + "=".repeat(cols);
    const divSingle = leftMargin + "-".repeat(cols);

    // Build Header Section Lines
    const headerLines: string[] = [];
    if (options?.topMarginLines) {
      for (let i = 0; i < options.topMarginLines; i++) headerLines.push("");
    }

    // Duplicate Marker
    if (options?.isDuplicate || options?.copyMarker) {
      headerLines.push(leftMargin + this.center(`*** ${options?.copyMarker || "DUPLICATE COPY"} ***`, cols));
    }

    // Store Header
    headerLines.push(leftMargin + this.center(data.store_name.toUpperCase(), cols));
    if (data.store_address) {
      const addrLines = this.wrapText(data.store_address, cols);
      addrLines.forEach((l) => headerLines.push(leftMargin + this.center(l, cols)));
    }

    const contactParts: string[] = [];
    if (data.store_phone) contactParts.push(`Ph: ${data.store_phone}`);
    if (data.store_email) contactParts.push(`Email: ${data.store_email}`);
    if (contactParts.length > 0) {
      const contactStr = contactParts.join(" | ");
      const lines = this.wrapText(contactStr, cols);
      lines.forEach((l) => headerLines.push(leftMargin + this.center(l, cols)));
    }

    const licenseParts: string[] = [];
    if (data.store_gstin) licenseParts.push(`GSTIN: ${data.store_gstin}`);
    if (options?.showDrugLicenses !== false && data.drug_license_numbers && data.drug_license_numbers.length > 0) {
      licenseParts.push(`DL: ${data.drug_license_numbers.join(", ")}`);
    }
    if (data.fssai_no) licenseParts.push(`FSSAI: ${data.fssai_no}`);
    if (licenseParts.length > 0) {
      const licStr = licenseParts.join(" | ");
      const lines = this.wrapText(licStr, cols);
      lines.forEach((l) => headerLines.push(leftMargin + this.center(l, cols)));
    }

    headerLines.push(divDouble);

    // Document & Customer Meta Box (2-column layout in 80 cols)
    const docNoDate = `TAX INVOICE: #${data.invoice_number}`.padEnd(42) + `Date: ${data.invoice_date} ${data.invoice_time || ""}`;
    headerLines.push(leftMargin + this.padRight(docNoDate, cols));

    const custName = `Customer   : ${data.customer_name || "Cash Customer"}`.padEnd(42) + `Phone: ${data.customer_phone || "-"}`;
    headerLines.push(leftMargin + this.padRight(custName, cols));

    if (data.customer_gstin || data.place_of_supply) {
      const gstinPos = `Cust GSTIN : ${data.customer_gstin || "-"}`.padEnd(42) + `POS: ${data.place_of_supply || "State"}`;
      headerLines.push(leftMargin + this.padRight(gstinPos, cols));
    }

    if (options?.showDoctorPatient !== false && (data.patient_name || data.doctor_name)) {
      if (data.patient_name) {
        const pat = `Patient    : ${data.patient_name}${data.patient_age ? ` (${data.patient_age}Y/${data.patient_gender || ""})` : ""}`;
        headerLines.push(leftMargin + this.padRight(pat, cols));
      }
      if (data.doctor_name) {
        const doc = `Doctor     : ${data.doctor_name}${data.doctor_reg_no ? ` [Reg: ${data.doctor_reg_no}]` : ""}`;
        headerLines.push(leftMargin + this.padRight(doc, cols));
      }
    }

    headerLines.push(divSingle);

    // Item Table Header (Exact 80 chars)
    const itemTableHead = `${this.padRight("#", 2)} ${this.padRight("Item Description", 23)} ${this.padRight("HSN", 6)} ${this.padRight("Batch", 8)} ${this.padRight("Exp", 5)} ${this.padLeft("Qty", 5)} ${this.padLeft("Rate", 7)} ${this.padLeft("GST", 4)} ${this.padLeft("Amount", 9)}`;
    headerLines.push(leftMargin + itemTableHead);
    headerLines.push(divSingle);

    // Build Item Rows Lines
    const itemLines: string[] = [];
    data.lines.forEach((item, idx) => {
      const num = this.padRight(idx + 1, 2);
      const descFirst = item.description.substring(0, 23).padEnd(23);
      const hsn = this.padRight((item.hsn_code || "-").substring(0, 6), 6);
      const batch = this.padRight((item.batch_no || "-").substring(0, 8), 8);
      const exp = this.padRight((item.expiry_date || "-").substring(0, 5), 5);
      const qty = this.padLeft(this.formatQty(item.qty, item.loose_qty), 5);
      const rate = this.padLeft(item.rate.toFixed(2), 7);
      const gst = this.padLeft(`${item.gst_percent}%`, 4);
      const amt = this.padLeft(this.formatAmount(item.amount), 9);

      itemLines.push(`${leftMargin}${num} ${descFirst} ${hsn} ${batch} ${exp} ${qty} ${rate} ${gst} ${amt}`);

      // If description is longer than 23 chars and truncation is disabled, wrap onto next line
      if (!options?.truncateDescriptions && item.description.length > 23) {
        const remainingDesc = item.description.substring(23);
        const wrapped = this.wrapText(remainingDesc, 55);
        wrapped.forEach((w) => {
          itemLines.push(`${leftMargin}   ${w}`);
        });
      }
    });

    // Build Footer Section Lines
    const footerLines: string[] = [];
    footerLines.push(divSingle);

    // HSN Summary (Compact Table)
    if (options?.showHsnSummary !== false) {
      const hsnRows = calculateHsnSummary(data.lines);
      if (hsnRows.length > 0) {
        footerLines.push(leftMargin + "HSN/SAC     TaxableVal(Rs)  CGST%   CGST(Rs)  SGST%   SGST(Rs)  TotalTax(Rs)");
        hsnRows.forEach((h) => {
          const hCode = this.padRight(h.hsnCode, 11);
          const tVal = this.padLeft(this.formatAmount(h.taxableValue), 14);
          const cRate = this.padLeft(`${h.cgstRate}%`, 7);
          const cAmt = this.padLeft(this.formatAmount(h.cgstAmount), 10);
          const sRate = this.padLeft(`${h.sgstRate}%`, 7);
          const sAmt = this.padLeft(this.formatAmount(h.sgstAmount), 10);
          const totTax = this.padLeft(this.formatAmount(h.totalTax), 13);
          footerLines.push(`${leftMargin}${hCode} ${tVal} ${cRate} ${cAmt} ${sRate} ${sAmt} ${totTax}`);
        });
        footerLines.push(divSingle);
      }
    }

    // Totals Box (Right Aligned)
    const subtotalStr = `Taxable Subtotal: ${curr} ` + this.padLeft(this.formatAmount(data.subtotal), 12);
    footerLines.push(leftMargin + this.padLeft(subtotalStr, cols));

    if (data.cgst_total !== undefined && data.sgst_total !== undefined) {
      const cgstStr = `CGST Total      : ${curr} ` + this.padLeft(this.formatAmount(data.cgst_total), 12);
      const sgstStr = `SGST Total      : ${curr} ` + this.padLeft(this.formatAmount(data.sgst_total), 12);
      footerLines.push(leftMargin + this.padLeft(cgstStr, cols));
      footerLines.push(leftMargin + this.padLeft(sgstStr, cols));
    } else if (data.tax_total > 0) {
      const taxStr = `GST Tax Total   : ${curr} ` + this.padLeft(this.formatAmount(data.tax_total), 12);
      footerLines.push(leftMargin + this.padLeft(taxStr, cols));
    }

    if (data.round_off && Math.abs(data.round_off) > 0.001) {
      const roStr = `Round Off       : ${curr} ` + this.padLeft(this.formatAmount(data.round_off), 12);
      footerLines.push(leftMargin + this.padLeft(roStr, cols));
    }

    footerLines.push(divDouble);
    const grandTotalStr = `GRAND TOTAL     : ${curr} ` + this.padLeft(this.formatAmount(data.grand_total), 12);
    footerLines.push(leftMargin + this.padLeft(grandTotalStr, cols));
    footerLines.push(divDouble);

    // Amount in Words
    const words = data.amount_in_words || numberToWordsIndian(data.grand_total);
    const wordsLines = this.wrapText(`Amount in Words: ${words}`, cols);
    wordsLines.forEach((w) => footerLines.push(leftMargin + w));

    // UPI Payment text (No QR graphics on Dot Matrix)
    if (data.upi_vpa) {
      footerLines.push(leftMargin + `Scan/Pay via UPI: ${data.upi_vpa} | Pay: ${curr} ${this.formatAmount(data.grand_total)}`);
    }

    // Terms and Signatures
    if (options?.showTerms !== false && data.terms_and_conditions) {
      const terms = this.wrapText(`Terms: ${data.terms_and_conditions}`, cols);
      terms.forEach((t) => footerLines.push(leftMargin + t));
    }

    footerLines.push("");
    const signBox = `Customer Signature` + " ".repeat(cols - 18 - 25) + `For ${data.store_name.substring(0, 20)}`;
    footerLines.push(leftMargin + signBox);
    footerLines.push("");
    const authSign = " ".repeat(cols - 25) + `Authorised Signatory`;
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
    const linesPerPage = options?.linesPerPage || 66;
    const curr = options?.currencyPrefix || "Rs.";
    const leftMargin = " ".repeat(options?.leftMarginSpaces || 0);
    const divDouble = leftMargin + "=".repeat(cols);
    const divSingle = leftMargin + "-".repeat(cols);

    const headerLines: string[] = [];
    if (options?.topMarginLines) {
      for (let i = 0; i < options.topMarginLines; i++) headerLines.push("");
    }

    if (options?.isDuplicate || options?.copyMarker) {
      headerLines.push(leftMargin + this.center(`*** ${options?.copyMarker || "DUPLICATE COPY"} ***`, cols));
    }

    headerLines.push(leftMargin + this.center(data.store_name.toUpperCase(), cols));
    if (data.store_address) {
      headerLines.push(leftMargin + this.center(data.store_address, cols));
    }

    const regLine = `GSTIN: ${data.store_gstin || "-"} | DL: ${(data.drug_license_numbers || []).join(", ") || "-"} | Ph: ${data.store_phone || "-"}`;
    headerLines.push(leftMargin + this.center(regLine, cols));
    headerLines.push(divDouble);

    // 3-Column Header Meta Box in 132 columns
    const col1 = `INVOICE NO : #${data.invoice_number}`.padEnd(45);
    const col2 = `DATE: ${data.invoice_date} ${data.invoice_time || ""}`.padEnd(45);
    const col3 = `POS: ${data.place_of_supply || "State"}`;
    headerLines.push(leftMargin + col1 + col2 + col3);

    const cust1 = `CUSTOMER   : ${data.customer_name || "Cash Customer"}`.padEnd(45);
    const cust2 = `PHONE: ${data.customer_phone || "-"}`.padEnd(45);
    const cust3 = `GSTIN: ${data.customer_gstin || "-"}`;
    headerLines.push(leftMargin + cust1 + cust2 + cust3);

    if (data.doctor_name || data.patient_name) {
      const p1 = `PATIENT    : ${data.patient_name || "-"}`.padEnd(45);
      const p2 = `DOCTOR: ${data.doctor_name || "-"}`.padEnd(45);
      const p3 = `REG: ${data.doctor_reg_no || "-"}`;
      headerLines.push(leftMargin + p1 + p2 + p3);
    }

    headerLines.push(divSingle);

    // 132-Column Item Table Header
    // #  Item Description                                 HSN Code    Batch No   Expiry      Qty       Rate(Rs)   Disc(Rs)   Taxable(Rs)   GST%    Amount(Rs)
    const itemHead132 = " #  Item Description                                 HSN Code    Batch No   Expiry      Qty       Rate(Rs)   Disc(Rs)   Taxable(Rs)   GST%    Amount(Rs)";
    headerLines.push(leftMargin + itemHead132);
    headerLines.push(divSingle);

    const itemLines: string[] = [];
    data.lines.forEach((item, idx) => {
      const num = this.padRight(idx + 1, 3);
      const desc = item.description.substring(0, 46).padEnd(46);
      const hsn = this.padRight((item.hsn_code || "-").substring(0, 10), 10);
      const batch = this.padRight((item.batch_no || "-").substring(0, 10), 10);
      const exp = this.padRight((item.expiry_date || "-").substring(0, 7), 7);
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
      if (hsnRows.length > 0) {
        footerLines.push(leftMargin + "HSN/SAC Code       Taxable Amount(Rs)       CGST%      CGST Amount(Rs)      SGST%      SGST Amount(Rs)       Total Tax Amount(Rs)");
        hsnRows.forEach((h) => {
          const cCode = this.padRight(h.hsnCode, 18);
          const tAmt = this.padLeft(this.formatAmount(h.taxableValue), 24);
          const cRate = this.padLeft(`${h.cgstRate}%`, 11);
          const cVal = this.padLeft(this.formatAmount(h.cgstAmount), 20);
          const sRate = this.padLeft(`${h.sgstRate}%`, 11);
          const sVal = this.padLeft(this.formatAmount(h.sgstAmount), 20);
          const tot = this.padLeft(this.formatAmount(h.totalTax), 26);
          footerLines.push(`${leftMargin}${cCode} ${tAmt} ${cRate} ${cVal} ${sRate} ${sVal} ${tot}`);
        });
        footerLines.push(divSingle);
      }
    }

    // Totals Block
    const subStr = `Taxable Subtotal : ${curr} ` + this.padLeft(this.formatAmount(data.subtotal), 14);
    footerLines.push(leftMargin + this.padLeft(subStr, cols));

    if (data.cgst_total !== undefined && data.sgst_total !== undefined) {
      const cgstStr = `CGST Total       : ${curr} ` + this.padLeft(this.formatAmount(data.cgst_total), 14);
      const sgstStr = `SGST Total       : ${curr} ` + this.padLeft(this.formatAmount(data.sgst_total), 14);
      footerLines.push(leftMargin + this.padLeft(cgstStr, cols));
      footerLines.push(leftMargin + this.padLeft(sgstStr, cols));
    }

    if (data.round_off && Math.abs(data.round_off) > 0.001) {
      const roStr = `Round Off        : ${curr} ` + this.padLeft(this.formatAmount(data.round_off), 14);
      footerLines.push(leftMargin + this.padLeft(roStr, cols));
    }

    footerLines.push(divDouble);
    const gtStr = `GRAND TOTAL      : ${curr} ` + this.padLeft(this.formatAmount(data.grand_total), 14);
    footerLines.push(leftMargin + this.padLeft(gtStr, cols));
    footerLines.push(divDouble);

    const words = data.amount_in_words || numberToWordsIndian(data.grand_total);
    footerLines.push(leftMargin + `Amount in Words: ${words}`);

    if (data.upi_vpa) {
      footerLines.push(leftMargin + `UPI ID: ${data.upi_vpa} | Pay Amount: ${curr} ${this.formatAmount(data.grand_total)}`);
    }

    footerLines.push("");
    const signBox = `Customer Signature` + " ".repeat(cols - 18 - 30) + `For ${data.store_name.substring(0, 25)}`;
    footerLines.push(leftMargin + signBox);
    footerLines.push("");
    footerLines.push(leftMargin + " ".repeat(cols - 30) + `Authorised Signatory`);

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
   * Pre-printed stationery mode: prints values at predefined line/column slots without borders
   */
  private renderPrePrintedInvoice(data: InvoicePrintData, options?: DotMatrixOptions): string {
    const cols = options?.columns === 132 ? 132 : 80;
    const linesPerPage = options?.linesPerPage || 66;
    const leftMargin = " ".repeat(options?.leftMarginSpaces || 0);
    const outLines: string[] = [];

    // Header offset
    for (let i = 0; i < 4; i++) outLines.push("");

    outLines.push(leftMargin + " ".repeat(10) + data.invoice_number.padEnd(30) + data.invoice_date);
    outLines.push(leftMargin + " ".repeat(10) + (data.customer_name || "Cash Customer").padEnd(30) + (data.customer_phone || ""));
    outLines.push("");

    // Item lines (formatted plain without frames)
    data.lines.forEach((l, idx) => {
      const num = this.padRight(idx + 1, 3);
      const desc = l.description.substring(0, 28).padEnd(28);
      const batch = (l.batch_no || "-").substring(0, 8).padEnd(8);
      const qty = this.padLeft(l.qty, 5);
      const rate = this.padLeft(l.rate.toFixed(2), 8);
      const amt = this.padLeft(this.formatAmount(l.amount), 10);
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

    const printableLinesPerPage = linesPerPage - 2; // Reserve 2 lines for form-feed margins
    const continuationHead = cols === 132
      ? `${this.padRight("#", 3)} ${this.padRight("Item Description", 46)} ${this.padRight("HSN Code", 10)} ${this.padRight("Batch No", 10)} ${this.padRight("Expiry", 7)} ${this.padLeft("Qty", 8)} ${this.padLeft("Rate(Rs)", 14)} ${this.padLeft("Disc(Rs)", 10)} ${this.padLeft("Taxable(Rs)", 13)} ${this.padLeft("GST%", 6)} ${this.padLeft("Amount(Rs)", 13)}`
      : `${this.padRight("#", 2)} ${this.padRight("Item Description", 23)} ${this.padRight("HSN", 6)} ${this.padRight("Batch", 8)} ${this.padRight("Exp", 5)} ${this.padLeft("Qty", 5)} ${this.padLeft("Rate", 7)} ${this.padLeft("GST", 4)} ${this.padLeft("Amount", 9)}`;

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
      // Check if adding this item line (plus potential continuation footer) exceeds page limit
      if (currentPage.length + 1 + continuationFooter.length > printableLinesPerPage) {
        // Page full, add continuation footer and advance page
        currentPage.push(...continuationFooter);
        pages.push(currentPage);
        pageNum++;
        currentPage = [...continuationHeader];
      }
      currentPage.push(line);
    }

    // Now check if footerLines fit on the current page
    if (currentPage.length + footerLines.length > printableLinesPerPage) {
      // Doesn't fit on current page, push current page and place footer on a new page
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

    // Join pages with Form Feed character (\x0C / \f) so dot-matrix advances to top of form
    return pages.map((p) => p.join("\n")).join("\n\x0C\n") + "\n\x0C";
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
    headerLines.push(leftMargin + `Customer       : ${data.customer_name}`.padEnd(42) + `Phone: ${data.customer_phone || "-"}`);
    headerLines.push(divSingle);

    headerLines.push(leftMargin + " #  Item Description          HSN    Batch     Qty       Rate    GST%     Amount");
    headerLines.push(divSingle);

    const itemLines: string[] = [];
    data.lines.forEach((l, idx) => {
      const num = this.padRight(idx + 1, 3);
      const desc = l.description.substring(0, 25).padEnd(25);
      const hsn = this.padRight((l.hsn_code || "-").substring(0, 6), 6);
      const batch = this.padRight((l.batch_no || "-").substring(0, 8), 8);
      const qty = this.padLeft(l.qty, 6);
      const rate = this.padLeft(l.rate.toFixed(2), 10);
      const gst = this.padLeft(`${l.gst_percent}%`, 7);
      const amt = this.padLeft(this.formatAmount(l.amount), 11);
      itemLines.push(`${leftMargin}${num} ${desc} ${hsn} ${batch} ${qty} ${rate} ${gst} ${amt}`);
    });

    const footerLines: string[] = [];
    footerLines.push(divSingle);
    footerLines.push(leftMargin + this.padLeft(`Taxable Total : ${curr} ` + this.padLeft(this.formatAmount(data.subtotal), 12), cols));
    footerLines.push(leftMargin + this.padLeft(`Tax Total     : ${curr} ` + this.padLeft(this.formatAmount(data.tax_total), 12), cols));
    footerLines.push(divDouble);
    footerLines.push(leftMargin + this.padLeft(`CREDIT TOTAL  : ${curr} ` + this.padLeft(this.formatAmount(data.grand_total), 12), cols));
    footerLines.push(divDouble);
    footerLines.push(leftMargin + `Amount in Words: ${data.amount_in_words || numberToWordsIndian(data.grand_total)}`);
    footerLines.push(leftMargin + `Refund Mode: ${data.refund_mode}`);
    footerLines.push("");
    footerLines.push(leftMargin + `Customer Signature` + " ".repeat(cols - 18 - 25) + `Authorised Signatory`);

    return this.paginateDocument({
      headerLines,
      itemLines,
      footerLines,
      linesPerPage: options?.linesPerPage || 66,
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
    headerLines.push(leftMargin + `Supplier       : ${data.supplier_name}`.padEnd(42) + `GSTIN: ${data.supplier_gstin || "-"}`);
    headerLines.push(divSingle);

    headerLines.push(leftMargin + " #  Item Description          HSN    Batch     Qty       Rate    GST%     Amount");
    headerLines.push(divSingle);

    const itemLines: string[] = [];
    data.lines.forEach((l, idx) => {
      const num = this.padRight(idx + 1, 3);
      const desc = l.description.substring(0, 25).padEnd(25);
      const hsn = this.padRight((l.hsn_code || "-").substring(0, 6), 6);
      const batch = this.padRight((l.batch_no || "-").substring(0, 8), 8);
      const qty = this.padLeft(l.qty, 6);
      const rate = this.padLeft(l.rate.toFixed(2), 10);
      const gst = this.padLeft(`${l.gst_percent}%`, 7);
      const amt = this.padLeft(this.formatAmount(l.amount), 11);
      itemLines.push(`${leftMargin}${num} ${desc} ${hsn} ${batch} ${qty} ${rate} ${gst} ${amt}`);
    });

    const footerLines: string[] = [];
    footerLines.push(divSingle);
    footerLines.push(leftMargin + this.padLeft(`Taxable Total : ${curr} ` + this.padLeft(this.formatAmount(data.subtotal), 12), cols));
    footerLines.push(leftMargin + this.padLeft(`Tax Total     : ${curr} ` + this.padLeft(this.formatAmount(data.tax_total), 12), cols));
    footerLines.push(divDouble);
    footerLines.push(leftMargin + this.padLeft(`DEBIT TOTAL   : ${curr} ` + this.padLeft(this.formatAmount(data.grand_total), 12), cols));
    footerLines.push(divDouble);
    footerLines.push(leftMargin + `Amount in Words: ${data.amount_in_words || numberToWordsIndian(data.grand_total)}`);
    footerLines.push(leftMargin + `Settlement: ${data.settlement_type}`);
    footerLines.push("");
    footerLines.push(leftMargin + `Supplier Signature` + " ".repeat(cols - 18 - 25) + `Authorised Signatory`);

    return this.paginateDocument({
      headerLines,
      itemLines,
      footerLines,
      linesPerPage: options?.linesPerPage || 66,
      cols,
      leftMargin,
      documentNumber: data.return_number,
    });
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
      // SI: Condensed Mode (17.14 CPI)
      bytes.push(0x0F);
    } else if (options?.cpi === "12cpi") {
      // ESC M: 12 CPI Elite
      bytes.push(0x1B, 0x4D);
    } else {
      // ESC P: 10 CPI Pica (Default)
      bytes.push(0x1B, 0x50);
    }

    // 4. Set Line Spacing (ESC 2 = 1/6", ESC 0 = 1/8")
    bytes.push(0x1B, 0x32);

    // 5. Optional Double Strike for Carbon Copies (ESC G)
    if (options?.doubleStrikeCarbon) {
      bytes.push(0x1B, 0x47);
    }

    // 6. Set Form Length in lines (ESC C n)
    if (options?.linesPerPage) {
      bytes.push(0x1B, 0x43, Math.min(127, options.linesPerPage));
    }

    // Encode text to pure ASCII with CRLF line endings
    const cleanText = rawText
      .replace(/₹/g, "Rs.")
      .replace(/\r\n/g, "\n")
      .replace(/\n/g, "\r\n");

    const encoded = encoder.encode(cleanText);
    for (let i = 0; i < encoded.length; i++) {
      bytes.push(encoded[i]);
    }

    // 7. Ensure terminating Form Feed (\x0C) to advance continuous paper to tear perforation
    if (bytes[bytes.length - 1] !== 0x0C && bytes[bytes.length - 2] !== 0x0C) {
      bytes.push(0x0C);
    }

    return new Uint8Array(bytes);
  }

  /**
   * Generates a realistic HTML preview for Dot Matrix stationery with monospace layout, column ruler, and line numbers.
   */
  generateMonospaceHtmlPreview(text: string, options?: { showRuler?: boolean; showPageBreaks?: boolean; columns?: 80 | 132 }): string {
    const cols = options?.columns || 80;
    const pages = text.split("\x0C").filter((p) => p.trim().length > 0);

    // Column Ruler
    let ruler = "";
    if (options?.showRuler !== false) {
      let r1 = "";
      let r2 = "";
      for (let i = 1; i <= cols; i++) {
        if (i % 10 === 0) {
          r1 += String(i / 10).padStart(10, " ");
          r2 += "0";
        } else {
          r2 += String(i % 10);
        }
      }
      ruler = `<div class="ruler font-mono text-[10px] text-emerald-800 bg-emerald-100/80 dark:bg-emerald-950/50 dark:text-emerald-400 p-2 border-b border-emerald-300 dark:border-emerald-800 select-none overflow-x-auto">
        <div class="tracking-widest">${r1}</div>
        <div class="tracking-widest">${r2}</div>
      </div>`;
    }

    const renderedPagesHtml = pages
      .map((pageText, idx) => {
        const pageLines = pageText.split("\n");
        const numberedLines = pageLines
          .map((line, lIdx) => {
            const lineNum = String(lIdx + 1).padStart(2, "0");
            const escapedLine = line
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
            return `<div class="dot-line flex hover:bg-emerald-500/10">
              <span class="line-no text-[10px] text-slate-400 select-none w-7 text-right pr-2 border-r border-slate-300 dark:border-slate-700">${lineNum}</span>
              <span class="line-content pl-2 whitespace-pre text-slate-900 dark:text-slate-100">${escapedLine || " "}</span>
            </div>`;
          })
          .join("");

        return `
          <div class="dot-matrix-form mb-6 bg-[#faf8f0] dark:bg-[#0f172a] shadow-xl border border-slate-300 dark:border-slate-800 rounded-sm p-6 font-mono text-[12px] leading-[18px]">
            <div class="page-perforation-header flex justify-between items-center text-[10px] text-emerald-700 dark:text-emerald-400 border-b border-dashed border-emerald-400 pb-1 mb-3 select-none">
              <span>* CONTINUOUS FORM PERFORATION *</span>
              <span>PAGE ${idx + 1} OF ${pages.length}</span>
              <span>80-COL 10-CPI DRAFT</span>
            </div>
            ${numberedLines}
            <div class="page-perforation-footer flex justify-between items-center text-[10px] text-emerald-700 dark:text-emerald-400 border-t border-dashed border-emerald-400 pt-1 mt-3 select-none">
              <span>* TEAR-OFF LINE (FORM FEED) *</span>
              <span>TOP OF FORM</span>
            </div>
          </div>
        `;
      })
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Dot Matrix Continuous Form Preview</title>
  <style>
    @page { size: auto; margin: 0; }
    body {
      margin: 0;
      padding: 16px;
      font-family: 'Courier New', 'DejaVu Sans Mono', 'Liberation Mono', Menlo, Consolas, monospace;
      background-color: #f1f5f9;
      color: #0f172a;
    }
    @media (prefers-color-scheme: dark) {
      body { background-color: #020617; color: #f8fafc; }
    }
    @media print {
      body { background-color: white !important; color: black !important; padding: 0 !important; }
      .ruler, .page-perforation-header, .page-perforation-footer, .line-no { display: none !important; }
      .dot-matrix-form { border: 0 !important; box-shadow: none !important; margin: 0 !important; padding: 0 !important; background: transparent !important; page-break-after: always; }
      .line-content { font-size: 10pt !important; line-height: 1.2 !important; color: black !important; }
    }
    .ruler { font-family: monospace; white-space: pre; }
    .dot-line { font-family: monospace; }
  </style>
</head>
<body>
  ${ruler}
  <div class="forms-container mt-4">
    ${renderedPagesHtml}
  </div>
</body>
</html>`;
  }

  /**
   * Generates a high-fidelity Monospace PDF document for Dot Matrix preview saving.
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
