import { getIpcBridge, isTauri, invokeCommand } from "../ipc/ipcBridge";
import {
  printerManagerService,
  PaperSize,
  getDotMatrixColumns,
  getPaperWidthFromSize,
} from "./printerManagerService";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as QRCodeModule from "qrcode";
import { ROBOTO_REGULAR_BASE64, ROBOTO_BOLD_BASE64 } from "./embeddedFonts";
import { dotMatrixRenderer, DotMatrixOptions } from "./dotMatrixRenderer";

const QRCode = (QRCodeModule as any).default || QRCodeModule;

export interface InvoicePrintData {
  invoice_number: string;
  invoice_date: string;
  invoice_time?: string;
  store_name: string;
  store_address?: string;
  store_phone?: string;
  store_email?: string;
  store_gstin?: string;
  drug_license_numbers?: string[]; // e.g. ["20B-12345", "21B-67890"]
  fssai_no?: string;
  place_of_supply?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_gstin?: string;
  customer_address?: string;
  patient_name?: string;
  patient_age?: string | number;
  patient_gender?: string;
  doctor_name?: string;
  doctor_reg_no?: string;
  payment_mode?: string;
  payment_status?: string;
  payments?: Array<{
    mode: string;
    amount: number;
    reference_no?: string;
  }>;
  change_due?: number;
  balance_due?: number;
  lines: Array<{
    description: string;
    hsn_code?: string;
    batch_no?: string;
    expiry_date?: string;
    qty: number;
    loose_qty?: number;
    rate: number;
    ptr?: number;
    pts?: number;
    discount_amount?: number;
    taxable_amount?: number;
    gst_percent: number;
    cgst_amount?: number;
    sgst_amount?: number;
    igst_amount?: number;
    cess_percent?: number;
    cess_amount?: number;
    amount: number;
  }>;
  subtotal: number;
  tax_total: number;
  cgst_total?: number;
  sgst_total?: number;
  igst_total?: number;
  cess_total?: number;
  round_off: number;
  grand_total: number;
  amount_in_words?: string;
  upi_vpa?: string;
  terms_and_conditions?: string;
  jurisdiction_note?: string;
  footer_note?: string;
}

export interface PrintRenderOptions {
  paperSize?: PaperSize;
  copies?: number;
  orientation?: "portrait" | "landscape";
  showHsnSummary?: boolean;
  showUpiQr?: boolean;
  showDoctorPatient?: boolean;
  showDrugLicenses?: boolean;
  showTerms?: boolean;
  showDiscountColumn?: boolean;
  showMrp?: boolean;
  copyMarker?: string;
  templateId?: string;
  zoomScale?: number;
  currencySymbolFormat?: "rupee_symbol" | "rs_text";
  isDuplicate?: boolean;
  printerName?: string;
}

export interface HsnSummaryRow {
  hsnCode: string;
  taxableValue: number;
  rate?: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  cessRate: number;
  cessAmount: number;
  totalTax: number;
}

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function numberToWordsIndian(amount: number): string {
  const num = Math.round(Math.abs(amount) * 100) / 100;
  const whole = Math.floor(num);
  const paise = Math.round((num - whole) * 100);
  if (whole === 0 && paise === 0) return "Indian Zero Rupees Only";

  const units = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function convertTwoDigits(n: number): string {
    if (n < 20) return units[n];
    const t = Math.floor(n / 10);
    const r = n % 10;
    return tens[t] + (r > 0 ? " " + units[r] : "");
  }

  function convertThreeDigits(n: number): string {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    let res = "";
    if (h > 0) res += units[h] + " Hundred";
    if (rest > 0) {
      if (res.length > 0) res += " ";
      res += convertTwoDigits(rest);
    }
    return res;
  }

  let words = "";
  const crore = Math.floor(whole / 10000000);
  let rem = whole % 10000000;
  const lakh = Math.floor(rem / 100000);
  rem = rem % 100000;
  const thousand = Math.floor(rem / 1000);
  rem = rem % 1000;
  const hundredPart = rem;

  if (crore > 0) words += convertTwoDigits(crore) + " Crore ";
  if (lakh > 0) words += convertTwoDigits(lakh) + " Lakh ";
  if (thousand > 0) words += convertTwoDigits(thousand) + " Thousand ";
  if (hundredPart > 0) words += convertThreeDigits(hundredPart) + " ";

  words = words.trim();
  let result = words ? `${words} Rupees` : "";
  if (paise > 0) {
    const paiseWords = convertTwoDigits(paise);
    result = result ? `${result} and ${paiseWords} Paise` : `${paiseWords} Paise`;
  }
  return `Indian ${result} Only`;
}

export function calculateHsnSummary(lines: InvoicePrintData["lines"]): HsnSummaryRow[] {
  const map = new Map<string, HsnSummaryRow>();
  for (const l of lines) {
    const hsn = l.hsn_code || "300490";
    const gstRate = l.gst_percent || 0;
    const cessRate = l.cess_percent || 0;
    const key = `${hsn}_${gstRate}_${cessRate}`;
    const lineTotal = l.amount || 0;
    const lineTaxable = l.taxable_amount !== undefined
      ? l.taxable_amount
      : (gstRate > 0 ? round2(lineTotal / (1 + gstRate / 100)) : lineTotal);

    const isInterState = l.igst_amount !== undefined && l.igst_amount > 0;
    const halfRate = isInterState ? 0 : gstRate / 2;

    const lineCgst = l.cgst_amount !== undefined
      ? l.cgst_amount
      : (isInterState ? 0 : round2(lineTaxable * (halfRate / 100)));
    const lineSgst = l.sgst_amount !== undefined
      ? l.sgst_amount
      : (isInterState ? 0 : round2(lineTaxable * (halfRate / 100)));
    const lineIgst = l.igst_amount !== undefined
      ? l.igst_amount
      : (isInterState ? round2(lineTaxable * (gstRate / 100)) : 0);
    const lineCess = l.cess_amount !== undefined
      ? l.cess_amount
      : (cessRate > 0 ? round2(lineTaxable * (cessRate / 100)) : 0);

    const existing = map.get(key) || {
      hsnCode: hsn,
      taxableValue: 0,
      rate: gstRate,
      cgstRate: halfRate,
      cgstAmount: 0,
      sgstRate: halfRate,
      sgstAmount: 0,
      igstRate: isInterState ? gstRate : 0,
      igstAmount: 0,
      cessRate,
      cessAmount: 0,
      totalTax: 0,
    };

    existing.taxableValue = round2(existing.taxableValue + lineTaxable);
    existing.cgstAmount = round2(existing.cgstAmount + lineCgst);
    existing.sgstAmount = round2(existing.sgstAmount + lineSgst);
    existing.igstAmount = round2(existing.igstAmount + lineIgst);
    existing.cessAmount = round2(existing.cessAmount + lineCess);
    existing.totalTax = round2(existing.cgstAmount + existing.sgstAmount + existing.igstAmount + existing.cessAmount);

    map.set(key, existing);
  }

  return Array.from(map.values());
}

export function generateQrCodeSvg(text: string, size = 80): string {
  try {
    const qr = (QRCode as any).create(text, { errorCorrectionLevel: "M" });
    const count = qr.modules.size;
    let paths = "";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.modules.get(r, c)) {
          paths += `M${c},${r}h1v1h-1z `;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${count} ${count}" width="${size}" height="${size}"><path fill="#0f172a" d="${paths}" /></svg>`;
  } catch (e) {
    return "";
  }
}

export function drawQrCodeJsPdf(doc: jsPDF, text: string, x: number, y: number, size: number): void {
  try {
    const qr = (QRCode as any).create(text, { errorCorrectionLevel: "M" });
    const count = qr.modules.size;
    const cellSize = size / count;
    doc.setFillColor(15, 23, 42);
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.modules.get(r, c)) {
          doc.rect(x + c * cellSize, y + r * cellSize, cellSize, cellSize, "F");
        }
      }
    }
  } catch (e) {
    console.warn("Could not draw QR code in PDF:", e);
  }
}

export interface PrintColumnConfig {
  id: string;
  label: string;
  visible: boolean;
  widthPercent: number;
  order: number;
}

export interface NamedPrintTemplate {
  id: string;
  name: string;
  paperSize: "thermal_80mm" | "thermal_58mm" | "a4" | "a5";
  showDrugLicenses: boolean;
  showDoctorDetails: boolean;
  showPatientDetails: boolean;
  showUpiQr: boolean;
  showTerms: boolean;
  showJurisdiction: boolean;
  fontFamily: "monospace" | "sans-serif" | "serif";
  columns: PrintColumnConfig[];
}

export interface PrinterProfile {
  id: string;
  name: string;
  deviceType: "thermal" | "laser_inkjet" | "pdf_virtual";
  connection: "usb" | "network" | "bluetooth" | "system_default";
  ipAddress?: string;
  paperSize: "thermal_80mm" | "thermal_58mm" | "a4" | "a5";
  isDefault: boolean;
  silentPrint: boolean;
}

export const DEFAULT_PRINT_COLUMNS: PrintColumnConfig[] = [
  { id: "description", label: "Item / Description", visible: true, widthPercent: 35, order: 1 },
  { id: "batch", label: "Batch & Exp", visible: true, widthPercent: 18, order: 2 },
  { id: "hsn", label: "HSN", visible: true, widthPercent: 12, order: 3 },
  { id: "qty", label: "Qty", visible: true, widthPercent: 10, order: 4 },
  { id: "rate", label: "Rate", visible: true, widthPercent: 12, order: 5 },
  { id: "amount", label: "Amount", visible: true, widthPercent: 13, order: 6 },
];

export const STANDARD_TEMPLATES: NamedPrintTemplate[] = [
  {
    id: "thermal_standard",
    name: "Standard Thermal 80mm",
    paperSize: "thermal_80mm",
    showDrugLicenses: true,
    showDoctorDetails: true,
    showPatientDetails: true,
    showUpiQr: true,
    showTerms: true,
    showJurisdiction: true,
    fontFamily: "monospace",
    columns: [...DEFAULT_PRINT_COLUMNS],
  },
  {
    id: "thermal_compact",
    name: "Compact Thermal 58mm",
    paperSize: "thermal_58mm",
    showDrugLicenses: false,
    showDoctorDetails: false,
    showPatientDetails: false,
    showUpiQr: true,
    showTerms: false,
    showJurisdiction: false,
    fontFamily: "monospace",
    columns: DEFAULT_PRINT_COLUMNS.filter((c) => ["description", "qty", "amount"].includes(c.id)),
  },
  {
    id: "a4_tax_invoice",
    name: "Statutory A4 Tax Invoice",
    paperSize: "a4",
    showDrugLicenses: true,
    showDoctorDetails: true,
    showPatientDetails: true,
    showUpiQr: true,
    showTerms: true,
    showJurisdiction: true,
    fontFamily: "sans-serif",
    columns: [...DEFAULT_PRINT_COLUMNS],
  },
];

export function generateDynamicSlipHeightMm(linesCount: number, hasClinicalMeta = false): number {
  const headerHeight = hasClinicalMeta ? 45 : 35;
  const lineItemHeight = 6.5; // average height per printed line
  const totalsHeight = 30;
  const footerMargin = 15;

  return Math.round(headerHeight + linesCount * lineItemHeight + totalsHeight + footerMargin);
}

export function generateUpiPaymentString(vpa: string, payeeName: string, amount: number, billNo: string): string {
  const cleanVpa = vpa.trim();
  const cleanPayee = encodeURIComponent(payeeName.trim());
  const formattedAmount = amount.toFixed(2);
  const cleanBillNo = encodeURIComponent(billNo.trim());

  return `upi://pay?pa=${cleanVpa}&pn=${cleanPayee}&am=${formattedAmount}&tr=${cleanBillNo}&cu=INR`;
}

/** Generate a formatted WhatsApp sharing URL for invoice dispatch */
export function generateWhatsAppShareUrl(phone: string, data: InvoicePrintData): string {
  const cleanPhone = phone.replace(/\D/g, "");
  const targetPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

  const text = `*Invoice #${data.invoice_number}* from *${data.store_name}*\n` +
    `Date: ${data.invoice_date}\n` +
    `Total: ₹${data.grand_total.toFixed(2)}\n\n` +
    `Thank you for your business!`;

  return `https://wa.me/${targetPhone}?text=${encodeURIComponent(text)}`;
}

/** Generate a mailto link with invoice summary */
export function generateEmailShareUrl(email: string, data: InvoicePrintData): string {
  const subject = `Invoice #${data.invoice_number} from ${data.store_name}`;
  const body = `Dear Customer,\n\nPlease find the details for your bill #${data.invoice_number} dated ${data.invoice_date}.\n` +
    `Total Amount: ₹${data.grand_total.toFixed(2)}\n\n` +
    `Thank you for shopping with ${data.store_name}.`;

  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Chunks invoice line items across discrete A4/A5 pages.
 * Single page invoices (<= maxSingle) fit compactly on 1 page.
 * Multi-page invoices are cleanly balanced across pages.
 */
export function chunkInvoiceLines<T>(
  lines: T[],
  maxSingle: number = 14,
  maxPage1: number = 16,
  maxMiddle: number = 24,
  maxFinal: number = 14
): T[][] {
  if (lines.length <= maxSingle) {
    return [lines];
  }

  const total = lines.length;
  // If it can fit in exactly 2 pages:
  if (total <= maxPage1 + maxFinal) {
    const half = Math.ceil(total / 2);
    const p1Count = Math.min(maxPage1, Math.max(half, total - maxFinal));
    return [lines.slice(0, p1Count), lines.slice(p1Count)];
  }

  // 3 or more pages:
  const pages: T[][] = [];
  pages.push(lines.slice(0, maxPage1));
  let remaining = lines.slice(maxPage1);

  while (remaining.length > maxFinal) {
    if (remaining.length <= maxMiddle + maxFinal) {
      const half = Math.ceil(remaining.length / 2);
      const midCount = Math.min(maxMiddle, Math.max(half, remaining.length - maxFinal));
      pages.push(remaining.slice(0, midCount));
      pages.push(remaining.slice(midCount));
      return pages;
    }
    pages.push(remaining.slice(0, maxMiddle));
    remaining = remaining.slice(maxMiddle);
  }

  if (remaining.length > 0) {
    pages.push(remaining);
  }

  return pages;
}

export class PrintingEngine {
  private templates: NamedPrintTemplate[] = [...STANDARD_TEMPLATES];
  private printerProfiles: PrinterProfile[] = [
    {
      id: "def_thermal",
      name: "Counter 80mm ESC/POS Thermal",
      deviceType: "thermal",
      connection: "system_default",
      paperSize: "thermal_80mm",
      isDefault: true,
      silentPrint: true,
    },
    {
      id: "office_a4",
      name: "Office Laser / A4 Network Printer",
      deviceType: "laser_inkjet",
      connection: "network",
      ipAddress: "192.168.1.200",
      paperSize: "a4",
      isDefault: false,
      silentPrint: false,
    },
  ];

  getTemplates(): NamedPrintTemplate[] {
    return [...this.templates];
  }

  saveTemplate(template: NamedPrintTemplate): void {
    const idx = this.templates.findIndex((t) => t.id === template.id);
    if (idx >= 0) {
      this.templates[idx] = template;
    } else {
      this.templates.push(template);
    }
  }

  getPrinterProfiles(): PrinterProfile[] {
    return [...this.printerProfiles];
  }

  savePrinterProfile(profile: PrinterProfile): void {
    const idx = this.printerProfiles.findIndex((p) => p.id === profile.id);
    if (idx >= 0) {
      this.printerProfiles[idx] = profile;
    } else {
      this.printerProfiles.push(profile);
    }
  }

  async printThermalReceipt(data: InvoicePrintData, printerName?: string): Promise<{ success: boolean; job_id?: string; error?: string }> {
    const targetPrinter = printerName || (await printerManagerService.getDefaultPrinterForPaperSize("thermal_80mm"));
    const html = this.generateInvoiceHtml(data, { paperSize: "thermal_80mm" });
    const rawEscPos = this.generateEscPosReceiptBytes(data, { paperWidthMm: 80, autoCut: true, cashDrawer: true });

    const res = await printerManagerService.executePrintJob({
      printerName: targetPrinter,
      paperSize: "thermal_80mm",
      docType: "tax_invoice",
      docNumber: data.invoice_number,
      htmlContent: html,
      rawEscPosBytes: rawEscPos,
    });

    if (res.success) {
      return { success: true, job_id: res.jobId };
    }

    // Browser runtime fallback
    if (typeof window !== "undefined" && !isTauri()) {
      try {
        const printWindow = window.open("", "_blank", "width=400,height=750");
        if (printWindow) {
          printWindow.document.open();
          printWindow.document.write(html);
          printWindow.document.close();
          printWindow.focus();
          setTimeout(() => printWindow.print(), 300);
          return { success: true, job_id: "browser_print_thermal" };
        }
      } catch (e) {
        console.warn("Browser thermal print fallback failed:", e);
      }
    }

    return { success: false, error: res.error || "Print failed" };
  }

  async printA4TaxInvoice(data: InvoicePrintData, printerName?: string): Promise<{ success: boolean; job_id?: string; error?: string }> {
    const targetPrinter = printerName || (await printerManagerService.getDefaultPrinterForPaperSize("a4"));
    const html = this.generateInvoiceHtml(data, { paperSize: "a4" });
    const pdfBytes = this.generateInvoicePdf(data);

    const res = await printerManagerService.executePrintJob({
      printerName: targetPrinter,
      paperSize: "a4",
      docType: "tax_invoice",
      docNumber: data.invoice_number,
      htmlContent: html,
      pdfBytes,
    });

    if (res.success) {
      return { success: true, job_id: res.jobId };
    }

    // Browser runtime fallback
    if (typeof window !== "undefined" && !isTauri()) {
      try {
        const printWindow = window.open("", "_blank", "width=850,height=900");
        if (printWindow) {
          printWindow.document.open();
          printWindow.document.write(html);
          printWindow.document.close();
          printWindow.focus();
          setTimeout(() => printWindow.print(), 300);
          return { success: true, job_id: "browser_print_a4" };
        }
      } catch (e) {
        console.warn("Browser print window failed:", e);
      }
    }

    return { success: false, error: res.error || "Print failed" };
  }

  /**
   * Generates a complete, self-contained printable HTML document for Statutory A4 / Half-A4 / Thermal Tax Invoice
   */
  generateInvoiceHtml(data: InvoicePrintData, options?: PrintRenderOptions): string {
    const paperSize = options?.paperSize || "a4";
    if (paperSize === "thermal_80mm" || paperSize === "thermal_58mm") {
      return this.generateThermalInvoiceHtml(data, paperSize === "thermal_58mm" ? 58 : 80, options);
    }
    if (paperSize === "half_a4") {
      return this.generateHalfA4InvoiceHtml(data, options);
    }

    const amountWords = data.amount_in_words || numberToWordsIndian(data.grand_total);
    const showHsn = options?.showHsnSummary !== false;
    const showQr = options?.showUpiQr !== false;
    const showClinical = options?.showDoctorPatient !== false;
    const showLicenses = options?.showDrugLicenses !== false;
    const showTerms = options?.showTerms !== false;
    const copyMarker = options?.copyMarker;
    const isDuplicate = options?.isDuplicate;

    const hsnRows = calculateHsnSummary(data.lines);
    const upiVpa = data.upi_vpa || "pharmacy@upi";
    const upiUri = generateUpiPaymentString(upiVpa, data.store_name, data.grand_total, data.invoice_number);
    const qrSvg = generateQrCodeSvg(upiUri, 76);

    const isInterState = (data.igst_total !== undefined && data.igst_total > 0) || hsnRows.some((r) => r.igstAmount > 0);
    const cgstTotal = data.cgst_total !== undefined ? data.cgst_total : round2(data.tax_total / 2);
    const sgstTotal = data.sgst_total !== undefined ? data.sgst_total : round2(data.tax_total / 2);
    const igstTotal = data.igst_total !== undefined ? data.igst_total : (isInterState ? data.tax_total : 0);
    const cessTotal = data.cess_total !== undefined ? data.cess_total : hsnRows.reduce((sum, r) => sum + r.cessAmount, 0);

    let totalHsnTaxable = 0;
    let totalHsnCgst = 0;
    let totalHsnSgst = 0;
    let totalHsnIgst = 0;
    let totalHsnCess = 0;
    let totalHsnTax = 0;

    const hsnRowsHtml = hsnRows
      .map((r) => {
        totalHsnTaxable += r.taxableValue;
        totalHsnCgst += r.cgstAmount;
        totalHsnSgst += r.sgstAmount;
        totalHsnIgst += r.igstAmount;
        totalHsnCess += r.cessAmount;
        totalHsnTax += r.totalTax;

        if (isInterState) {
          return `
          <tr>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1;">${r.hsnCode}</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">₹ ${r.taxableValue.toFixed(2)}</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">${r.igstRate}%</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">₹ ${r.igstAmount.toFixed(2)}</td>
            ${cessTotal > 0 ? `<td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">₹ ${r.cessAmount.toFixed(2)}</td>` : ""}
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #cbd5e1; font-weight: 700; font-variant-numeric: tabular-nums;">₹ ${r.totalTax.toFixed(2)}</td>
          </tr>`;
        }

        return `
        <tr>
          <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1;">${r.hsnCode}</td>
          <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">₹ ${r.taxableValue.toFixed(2)}</td>
          <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">${r.cgstRate}%</td>
          <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">₹ ${r.cgstAmount.toFixed(2)}</td>
          <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">${r.sgstRate}%</td>
          <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">₹ ${r.sgstAmount.toFixed(2)}</td>
          ${cessTotal > 0 ? `<td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">₹ ${r.cessAmount.toFixed(2)}</td>` : ""}
          <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #cbd5e1; font-weight: 700; font-variant-numeric: tabular-nums;">₹ ${r.totalTax.toFixed(2)}</td>
        </tr>`;
      })
      .join("");

    const pageChunks = chunkInvoiceLines(data.lines, 14, 16, 24, 14);
    const totalPages = pageChunks.length;

    let cumulativeIdx = 0;
    const pagesHtml = pageChunks
      .map((chunk, pageIdx) => {
        const pageNum = pageIdx + 1;
        const isFirstPage = pageNum === 1;
        const isLastPage = pageNum === totalPages;
        const startIdx = cumulativeIdx;
        cumulativeIdx += chunk.length;
        const endIdx = cumulativeIdx;

        const itemsRowsHtml = chunk
          .map((l, i) => {
            const itemNumber = startIdx + i + 1;
            return `
          <tr>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1;">${itemNumber}</td>
            <td style="padding: 4px 6px; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1;">
              <div style="font-weight: 700; color: #0f172a;">${l.description}</div>
            </td>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1;">${l.hsn_code || "300490"}</td>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${l.batch_no || "-"}</td>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1;">${l.expiry_date || "-"}</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">${l.qty}${l.loose_qty ? ` + ${l.loose_qty}L` : ""}</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">₹ ${l.rate.toFixed(2)}</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">${l.gst_percent}%</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #cbd5e1; font-weight: 700; color: #0f172a; font-variant-numeric: tabular-nums;">₹ ${l.amount.toFixed(2)}</td>
          </tr>`;
          })
          .join("");

        return `
      <div class="a4-sheet">
        ${
          isFirstPage
            ? `
        <div class="header">
          <div class="store-name">${data.store_name}</div>
          <div class="store-sub">${data.store_address || "Main Road, Palakkad, Kerala - 678001"} • Phone: ${data.store_phone || "9876543210"}</div>
          ${
            showLicenses
              ? `<div class="store-licenses">
            ${data.store_gstin ? `GSTIN: ${data.store_gstin}` : ""}
            ${data.drug_license_numbers?.length ? `  |  DL: ${data.drug_license_numbers.join(", ")}` : ""}
            ${data.fssai_no ? `  |  FSSAI: ${data.fssai_no}` : ""}
          </div>`
              : ""
          }
          <div class="tax-badge">TAX INVOICE</div>
          ${copyMarker ? `<div class="copy-marker">[ ${copyMarker} ]</div>` : ""}
          ${isDuplicate ? `<div class="duplicate-watermark">DUPLICATE</div>` : ""}
        </div>

        <div class="meta-grid">
          <div class="meta-col">
            <div><strong>Billed To:</strong> ${data.customer_name || "Walk-in Customer"}</div>
            <div>Mobile: ${data.customer_phone || "Not specified"}</div>
            ${showClinical && data.patient_name ? `<div>Patient: ${data.patient_name} ${data.patient_age ? `(${data.patient_age} yrs)` : ""}${data.patient_gender ? ` / ${data.patient_gender}` : ""}</div>` : ""}
            ${showClinical && data.doctor_name ? `<div>Doctor: ${data.doctor_name} ${data.doctor_reg_no ? `[Reg: ${data.doctor_reg_no}]` : ""}</div>` : ""}
          </div>
          <div class="meta-col" style="text-align: right;">
            <div style="font-size: 12px; font-weight: 800; color: #1d4ed8;">#${data.invoice_number}</div>
            <div>Date: ${data.invoice_date}${data.invoice_time ? ` ${data.invoice_time}` : ""}</div>
            <div>Payment Mode: <strong>${data.payment_mode || "Cash"}</strong> (${data.payment_status || "Paid"})</div>
            <div>Place of Supply: ${data.place_of_supply || "32-Kerala"}</div>
          </div>
        </div>
        `
            : `
        <div class="running-header">
          <div>
            <span class="running-store">${data.store_name}</span>
            <span class="running-inv">Tax Invoice #${data.invoice_number}</span>
            <span class="running-date">Date: ${data.invoice_date}</span>
          </div>
          <div class="running-page">Page ${pageNum} of ${totalPages}</div>
        </div>
        `
        }

        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 28px; text-align: center; border-right: 1px solid #cbd5e1;">#</th>
              <th style="text-align: left; border-right: 1px solid #cbd5e1;">Item Description</th>
              <th style="width: 60px; text-align: center; border-right: 1px solid #cbd5e1;">HSN</th>
              <th style="width: 65px; text-align: center; border-right: 1px solid #cbd5e1;">Batch</th>
              <th style="width: 55px; text-align: center; border-right: 1px solid #cbd5e1;">Exp</th>
              <th style="width: 45px; text-align: right; border-right: 1px solid #cbd5e1;">Qty</th>
              <th style="width: 75px; text-align: right; border-right: 1px solid #cbd5e1;">Rate (₹)</th>
              <th style="width: 55px; text-align: right; border-right: 1px solid #cbd5e1;">GST %</th>
              <th style="width: 85px; text-align: right;">Total (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRowsHtml}
          </tbody>
        </table>

        ${
          !isLastPage
            ? `
        <div class="continuation-bar">
          <div>Showing items ${startIdx + 1} to ${endIdx} of ${data.lines.length} Total Items</div>
          <div class="continuation-link">Continued on Page ${pageNum + 1} &rarr;</div>
        </div>
        `
            : ""
        }

        ${
          isLastPage
            ? `
        ${
          showHsn
            ? `
        <!-- HSN / GST Tax Summary -->
        <div style="margin-top: 10px; margin-bottom: 10px;">
          <div style="font-weight: 700; font-size: 9px; color: #475569; text-transform: uppercase; margin-bottom: 3px;">HSN / GST Tax Summary</div>
          <table class="data-table" style="margin-bottom: 0;">
            <thead>
              <tr>
                <th style="text-align: center; border-right: 1px solid #cbd5e1;">HSN/SAC</th>
                <th style="text-align: right; border-right: 1px solid #cbd5e1;">Taxable Value (₹)</th>
                ${isInterState ? `
                <th style="text-align: right; border-right: 1px solid #cbd5e1;">IGST %</th>
                <th style="text-align: right; border-right: 1px solid #cbd5e1;">IGST (₹)</th>
                ` : `
                <th style="text-align: right; border-right: 1px solid #cbd5e1;">CGST %</th>
                <th style="text-align: right; border-right: 1px solid #cbd5e1;">CGST (₹)</th>
                <th style="text-align: right; border-right: 1px solid #cbd5e1;">SGST %</th>
                <th style="text-align: right; border-right: 1px solid #cbd5e1;">SGST (₹)</th>
                `}
                ${cessTotal > 0 ? `<th style="text-align: right; border-right: 1px solid #cbd5e1;">Cess (₹)</th>` : ""}
                <th style="text-align: right;">Total Tax (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${hsnRowsHtml}
              <tr style="background: #f1f5f9; font-weight: 700;">
                <td style="padding: 4px 6px; text-align: center; border-top: 1px solid #94a3b8; border-right: 1px solid #cbd5e1;">Total</td>
                <td style="padding: 4px 6px; text-align: right; border-top: 1px solid #94a3b8; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">₹ ${totalHsnTaxable.toFixed(2)}</td>
                ${isInterState ? `
                <td style="padding: 4px 6px; border-top: 1px solid #94a3b8; border-right: 1px solid #cbd5e1;"></td>
                <td style="padding: 4px 6px; text-align: right; border-top: 1px solid #94a3b8; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">₹ ${totalHsnIgst.toFixed(2)}</td>
                ` : `
                <td style="padding: 4px 6px; border-top: 1px solid #94a3b8; border-right: 1px solid #cbd5e1;"></td>
                <td style="padding: 4px 6px; text-align: right; border-top: 1px solid #94a3b8; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">₹ ${totalHsnCgst.toFixed(2)}</td>
                <td style="padding: 4px 6px; border-top: 1px solid #94a3b8; border-right: 1px solid #cbd5e1;"></td>
                <td style="padding: 4px 6px; text-align: right; border-top: 1px solid #94a3b8; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">₹ ${totalHsnSgst.toFixed(2)}</td>
                `}
                ${cessTotal > 0 ? `<td style="padding: 4px 6px; text-align: right; border-top: 1px solid #94a3b8; border-right: 1px solid #cbd5e1; font-variant-numeric: tabular-nums;">₹ ${totalHsnCess.toFixed(2)}</td>` : ""}
                <td style="padding: 4px 6px; text-align: right; border-top: 1px solid #94a3b8; font-variant-numeric: tabular-nums;">₹ ${totalHsnTax.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>`
            : ""
        }

        <div class="footer-container">
          <div class="amount-words-bar">
            <span style="color: #64748b; font-weight: 600;">Amount in Words:</span> ${amountWords}
          </div>

          <div class="footer-grid">
            <!-- Top-Left: UPI QR -->
            <div class="footer-cell">
              <div class="qr-box">
                ${showQr ? qrSvg : ""}
                <div style="font-size: 9.5px; color: #334155;">
                  <div style="font-weight: 800; color: #0f172a; margin-bottom: 2px;">Scan & Pay via UPI</div>
                  <div style="margin-bottom: 1px;">UPI ID: <strong>${upiVpa}</strong></div>
                  <div style="margin-bottom: 2px;">Amount: <strong>₹ ${data.grand_total.toFixed(2)}</strong></div>
                  <div style="font-size: 8.5px; color: #64748b;">Supports GPay, PhonePe, Paytm & UPI Apps</div>
                </div>
              </div>
            </div>

            <!-- Top-Right: Totals -->
            <div class="footer-cell">
              <div class="totals-card">
                <div class="total-line"><span>Taxable Subtotal:</span><span style="font-weight: 600;">₹ ${data.subtotal.toFixed(2)}</span></div>
                ${isInterState ? `
                <div class="total-line"><span>Integrated GST (IGST):</span><span style="font-weight: 600;">₹ ${igstTotal.toFixed(2)}</span></div>
                ` : `
                <div class="total-line"><span>Central GST (CGST):</span><span style="font-weight: 600;">₹ ${cgstTotal.toFixed(2)}</span></div>
                <div class="total-line"><span>State GST (SGST):</span><span style="font-weight: 600;">₹ ${sgstTotal.toFixed(2)}</span></div>
                `}
                ${cessTotal > 0 ? `<div class="total-line"><span>Cess:</span><span style="font-weight: 600;">₹ ${cessTotal.toFixed(2)}</span></div>` : ""}
                <div class="total-line"><span>Total Tax:</span><span style="font-weight: 600;">₹ ${data.tax_total.toFixed(2)}</span></div>
                ${data.round_off ? `<div class="total-line"><span>Round Off:</span><span style="font-weight: 600;">${data.round_off > 0 ? "+" : ""}₹ ${data.round_off.toFixed(2)}</span></div>` : ""}
                <div class="grand-total-line"><span>Grand Total:</span><span>₹ ${data.grand_total.toFixed(2)}</span></div>
                ${data.payments && data.payments.length > 0 ? `
                <div style="border-top: 1px dashed #cbd5e1; margin-top: 5px; padding-top: 4px; font-size: 8.5px;">
                  ${data.payments.map((p) => `
                    <div style="display: flex; justify-content: space-between; color: #475569; margin-bottom: 1.5px;">
                      <span>Paid via ${p.mode}${p.reference_no ? ` [${p.reference_no}]` : ""}:</span>
                      <span style="font-weight: 600;">₹ ${Number(p.amount).toFixed(2)}</span>
                    </div>
                  `).join("")}
                  ${data.change_due && data.change_due > 0 ? `
                    <div style="display: flex; justify-content: space-between; color: #047857; font-weight: 600;">
                      <span>Change Returned:</span>
                      <span>₹ ${Number(data.change_due).toFixed(2)}</span>
                    </div>
                  ` : ""}
                  ${data.balance_due && data.balance_due > 0 ? `
                    <div style="display: flex; justify-content: space-between; color: #b45309; font-weight: 700;">
                      <span>Balance Due (Credit):</span>
                      <span>₹ ${Number(data.balance_due).toFixed(2)}</span>
                    </div>
                  ` : ""}
                </div>
                ` : ""}
              </div>
            </div>

            <!-- Bottom-Left: Terms -->
            <div class="footer-cell">
              <div class="terms-card">
                <div>
                  <div class="terms-title">Terms & Conditions:</div>
                  <div>1. Goods once sold will not be returned without original cash memo.</div>
                  <div>2. Refrigerated medicines are strictly non-returnable.</div>
                  <div>3. ${data.jurisdiction_note || "Subject to local jurisdiction."}</div>
                </div>
                <div class="terms-brand">${data.footer_note || "Computer Generated Tax Invoice • LamSuite POS"}</div>
              </div>
            </div>

            <!-- Bottom-Right: Signature -->
            <div class="footer-cell">
              <div class="sign-card">
                <div class="sign-store">For ${data.store_name}</div>
                <div class="sign-space"></div>
                <div class="sign-line">Authorised Signatory / Pharmacist</div>
              </div>
            </div>
          </div>
        </div>
        `
            : ""
        }

        <div class="spacer-fill"></div>
        <div class="page-footer">
          <div>Computer Generated Tax Invoice • ${data.store_name}</div>
          <div class="page-num">Page ${pageNum} of ${totalPages}</div>
        </div>
      </div>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Tax Invoice - ${data.invoice_number}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 8mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 10px;
      line-height: 1.35;
      color: #1e293b;
      margin: 0;
      padding: 24px 16px;
      background-color: #cbd5e1;
      font-variant-numeric: tabular-nums;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
      min-height: 100vh;
    }
    .a4-sheet {
      width: 210mm;
      max-width: 210mm;
      min-height: 297mm;
      flex-shrink: 0;
      background: #ffffff;
      box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.15), 0 0 1px rgba(0, 0, 0, 0.2);
      border: 1px solid #cbd5e1;
      border-radius: 2px;
      padding: 12mm 14mm;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      overflow: hidden;
      position: relative;
    }
    @media print {
      body {
        background: white !important;
        padding: 0 !important;
        margin: 0 !important;
        display: block !important;
      }
      .a4-sheet {
        box-shadow: none !important;
        border: none !important;
        margin: 0 !important;
        padding: 8mm !important;
        width: 100% !important;
        min-height: auto !important;
        page-break-after: always !important;
        break-after: page !important;
      }
      .a4-sheet:last-child {
        page-break-after: auto !important;
        break-after: auto !important;
      }
      .no-print {
        display: none !important;
      }
    }
    .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 10px; position: relative; }
    .store-name { font-size: 18px; font-weight: 800; color: #0f172a; }
    .store-sub { font-size: 10px; color: #475569; margin-top: 2px; }
    .store-licenses { font-size: 9.5px; font-weight: 700; color: #334155; margin-top: 3px; }
    .tax-badge { font-size: 12px; font-weight: 800; letter-spacing: 0.5px; color: #0f172a; margin-top: 5px; }
    .copy-marker { font-size: 8.5px; font-weight: 800; color: #64748b; letter-spacing: 0.5px; text-transform: uppercase; margin-top: 2px; }
    .duplicate-watermark { position: absolute; top: 0; right: 0; border: 2px solid #ef4444; color: #ef4444; font-weight: 800; font-size: 11px; padding: 2px 7px; border-radius: 4px; letter-spacing: 1px; transform: rotate(-5deg); }

    .running-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1.5px solid #0f172a;
      padding-bottom: 6px;
      margin-bottom: 8px;
      font-size: 9.5px;
    }
    .running-store { font-weight: 800; color: #0f172a; font-size: 11px; }
    .running-inv { color: #1d4ed8; font-weight: 700; margin-left: 8px; }
    .running-date { color: #64748b; margin-left: 8px; }
    .running-page { font-weight: 700; color: #475569; }

    .meta-grid { display: flex; justify-content: space-between; border: 1px solid #cbd5e1; border-radius: 5px; background: #f8fafc; padding: 7px 10px; margin-bottom: 10px; page-break-inside: avoid; break-inside: avoid; }
    .meta-col { width: 48%; line-height: 1.4; }

    table.data-table { width: 100%; border-collapse: collapse; font-size: 9.5px; margin-bottom: 8px; border: 1px solid #cbd5e1; }
    table.data-table thead { display: table-header-group; }
    table.data-table tfoot { display: table-footer-group; }
    table.data-table tr { page-break-inside: avoid; break-inside: avoid; }
    table.data-table th { background: #f1f5f9; color: #0f172a; font-weight: 700; padding: 5px 6px; border-top: 1px solid #cbd5e1; border-bottom: 2px solid #94a3b8; }
    table.data-table tr:nth-child(even) { background: #f8fafc; }

    .continuation-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f8fafc;
      border: 1px dashed #94a3b8;
      border-radius: 4px;
      padding: 5px 10px;
      margin-top: 6px;
      font-size: 9px;
      color: #475569;
    }
    .continuation-link { font-weight: 700; color: #1d4ed8; }

    .footer-container { margin-top: 10px; page-break-inside: avoid; break-inside: avoid; }
    .amount-words-bar { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 5px 9px; font-size: 9.5px; font-weight: 700; color: #1e293b; margin-bottom: 8px; }

    .footer-grid { display: grid; grid-template-columns: ${showQr ? "1fr 310px" : "1fr 310px"}; gap: 8px 14px; align-items: stretch; }
    .footer-cell { display: flex; flex-direction: column; }

    .qr-box { display: flex; align-items: center; gap: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 5px; padding: 7px 10px; height: 100%; box-sizing: border-box; }
    .totals-card { border: 1px solid #cbd5e1; border-radius: 5px; background: #f8fafc; padding: 7px 12px; font-variant-numeric: tabular-nums; box-sizing: border-box; }
    .total-line { display: flex; justify-content: space-between; padding: 2px 0; font-size: 10px; color: #475569; }
    .grand-total-line { display: flex; justify-content: space-between; padding-top: 5px; margin-top: 5px; border-top: 2px solid #0f172a; font-size: 12.5px; font-weight: 800; color: #1d4ed8; }

    .terms-card { border: 1px solid #e2e8f0; border-radius: 5px; background: #fff; padding: 6px 9px; font-size: 8.5px; color: #64748b; line-height: 1.4; height: 100%; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; }
    .terms-title { font-weight: 700; text-transform: uppercase; color: #475569; margin-bottom: 2px; }
    .terms-brand { margin-top: 4px; font-size: 8px; color: #94a3b8; border-top: 1px dashed #e2e8f0; padding-top: 3px; }

    .sign-card { border: 1px solid #cbd5e1; border-radius: 5px; background: #f8fafc; padding: 7px 12px; text-align: center; display: flex; flex-direction: column; justify-content: space-between; height: 100%; min-height: 65px; box-sizing: border-box; }
    .sign-store { font-size: 9.5px; font-weight: 700; color: #1e293b; }
    .sign-space { min-height: 20px; }
    .sign-line { font-size: 8.5px; font-weight: 600; color: #475569; border-top: 1px solid #94a3b8; padding-top: 2px; }

    .spacer-fill { flex-grow: 1; min-height: 6px; }
    .page-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid #e2e8f0;
      padding-top: 6px;
      margin-top: 8px;
      font-size: 8.5px;
      color: #64748b;
    }
    .page-num { font-weight: 700; color: #334155; }
  </style>
</head>
<body>
  ${pagesHtml}
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
   * Generates continuous strip thermal receipt HTML for 80mm and 58mm POS thermal printers
   */
  generateThermalInvoiceHtml(data: InvoicePrintData, widthMm: 80 | 58 = 80, options?: PrintRenderOptions): string {
    const is58 = widthMm === 58;
    const showQr = options?.showUpiQr !== false;
    const showClinical = options?.showDoctorPatient !== false;
    const showLicenses = options?.showDrugLicenses !== false;
    const showTerms = options?.showTerms !== false;
    const copyMarker = options?.copyMarker;

    const upiVpa = data.upi_vpa || "pharmacy@upi";
    const upiUri = generateUpiPaymentString(upiVpa, data.store_name, data.grand_total, data.invoice_number);
    const qrSvg = generateQrCodeSvg(upiUri, is58 ? 85 : 100);

    const isInterState = data.igst_total !== undefined && data.igst_total > 0;
    const cgstTotal = data.cgst_total !== undefined ? data.cgst_total : round2(data.tax_total / 2);
    const sgstTotal = data.sgst_total !== undefined ? data.sgst_total : round2(data.tax_total / 2);
    const igstTotal = data.igst_total !== undefined ? data.igst_total : (isInterState ? data.tax_total : 0);
    const cessTotal = data.cess_total !== undefined ? data.cess_total : 0;

    const linesHtml = data.lines
      .map((l, i) => {
        if (is58) {
          return `
          <div style="margin-bottom: 4px; border-bottom: 1px dotted #cbd5e1; padding-bottom: 3px;">
            <div style="font-weight: 700; word-break: break-word;">${i + 1}. ${l.description}</div>
            <div style="display: flex; justify-content: space-between; font-size: 9px; color: #334155;">
              <span>${l.qty}${l.loose_qty ? `+${l.loose_qty}L` : ""} × ₹${l.rate.toFixed(2)} (${l.gst_percent}%)</span>
              <span style="font-weight: 700; color: #000;">₹${l.amount.toFixed(2)}</span>
            </div>
            ${l.batch_no ? `<div style="font-size: 8px; color: #64748b;">B: ${l.batch_no} ${l.expiry_date ? `Exp: ${l.expiry_date}` : ""}</div>` : ""}
          </div>`;
        }
        return `
        <div style="margin-bottom: 5px; border-bottom: 1px dotted #cbd5e1; padding-bottom: 3px;">
          <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 10.5px;">
            <span style="word-break: break-word; max-width: 70%;">${i + 1}. ${l.description}</span>
            <span style="font-variant-numeric: tabular-nums;">₹${l.amount.toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 9.5px; color: #475569;">
            <span>${l.batch_no ? `B: ${l.batch_no}` : ""}${l.expiry_date ? ` | Exp: ${l.expiry_date}` : ""}${l.hsn_code ? ` | HSN: ${l.hsn_code}` : ""}</span>
            <span style="font-variant-numeric: tabular-nums;">${l.qty}${l.loose_qty ? `+${l.loose_qty}L` : ""} @ ₹${l.rate.toFixed(2)} (${l.gst_percent}% GST)</span>
          </div>
        </div>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt - ${data.invoice_number}</title>
  <style>
    @media print {
      @page { size: ${widthMm}mm auto; margin: 0; }
      html, body { margin: 0 !important; padding: 0 !important; width: ${widthMm}mm !important; background: #fff !important; }
      .thermal-paper { box-shadow: none !important; border: none !important; width: ${widthMm}mm !important; padding: ${is58 ? "2mm 1.5mm" : "3mm 2.5mm"} !important; min-height: auto !important; margin: 0 !important; }
      .no-print { display: none !important; }
    }
    * { box-sizing: border-box; }
    html { margin: 0; padding: 0; }
    body {
      margin: 0;
      padding: ${is58 ? "2px 0" : "8px 0"};
      display: flex;
      justify-content: center;
      background: #f1f5f9;
      font-family: 'Courier New', Courier, monospace, monospace;
      font-size: ${is58 ? "10px" : "11px"};
      line-height: 1.3;
      color: #0f172a;
    }
    .thermal-paper {
      width: ${is58 ? "58mm" : "80mm"};
      max-width: 100%;
      min-height: auto;
      background: #ffffff;
      padding: ${is58 ? "2.5mm 2mm" : "4.5mm 3.5mm"};
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
      border: 1px solid #e2e8f0;
      border-radius: 2px;
      margin: 0 auto;
    }
    .center { text-align: center; }
    .bold { font-weight: 700; }
    .divider { border-top: 1px dashed #475569; margin: 5px 0; }
    .double-divider { border-top: 2px dashed #0f172a; margin: 6px 0; }
    .flex-between { display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <div class="thermal-paper">
    <div class="center bold" style="font-size: ${is58 ? "13px" : "15px"};">${data.store_name}</div>
    ${data.store_address ? `<div class="center" style="font-size: ${is58 ? "8.5px" : "9.5px"}; color: #334155;">${data.store_address}</div>` : ""}
    ${data.store_phone ? `<div class="center" style="font-size: ${is58 ? "8.5px" : "9.5px"};">Tel: ${data.store_phone}</div>` : ""}
    ${showLicenses && data.store_gstin ? `<div class="center" style="font-size: 8.5px;">GSTIN: ${data.store_gstin}</div>` : ""}
    ${showLicenses && data.drug_license_numbers?.length ? `<div class="center" style="font-size: 8px;">DL: ${data.drug_license_numbers.join(", ")}</div>` : ""}

    <div class="divider"></div>
    <div class="center bold" style="font-size: ${is58 ? "10px" : "11px"}; letter-spacing: 0.5px;">*** TAX INVOICE ***</div>
    ${copyMarker ? `<div class="center bold" style="font-size: 8.5px; color: #475569;">[ ${copyMarker} ]</div>` : ""}
    <div class="divider"></div>

    <div class="flex-between"><span>Inv No:</span><span class="bold">#${data.invoice_number}</span></div>
    <div class="flex-between"><span>Date:</span><span>${data.invoice_date}${data.invoice_time ? ` ${data.invoice_time}` : ""}</span></div>
    <div class="flex-between"><span>Customer:</span><span class="bold">${data.customer_name || "Walk-in"}</span></div>
    ${data.customer_phone ? `<div class="flex-between"><span>Mobile:</span><span>${data.customer_phone}</span></div>` : ""}
    ${showClinical && data.patient_name ? `<div class="flex-between"><span>Patient:</span><span>${data.patient_name}</span></div>` : ""}
    ${showClinical && data.doctor_name ? `<div class="flex-between"><span>Doctor:</span><span>${data.doctor_name}</span></div>` : ""}
    <div class="flex-between"><span>Pay Mode:</span><span class="bold">${data.payment_mode || "Cash"} (${data.payment_status || "Paid"})</span></div>

    <div class="divider"></div>
    <div style="font-weight: 700; font-size: ${is58 ? "9px" : "10px"}; text-transform: uppercase; margin-bottom: 4px;">Items (${data.lines.length})</div>
    
    ${linesHtml}

    <div class="divider"></div>
    <div class="flex-between"><span>Subtotal:</span><span>₹${data.subtotal.toFixed(2)}</span></div>
    ${isInterState ? `
    <div class="flex-between"><span>IGST:</span><span>₹${igstTotal.toFixed(2)}</span></div>
    ` : `
    <div class="flex-between"><span>CGST:</span><span>₹${cgstTotal.toFixed(2)}</span></div>
    <div class="flex-between"><span>SGST:</span><span>₹${sgstTotal.toFixed(2)}</span></div>
    `}
    ${cessTotal > 0 ? `<div class="flex-between"><span>Cess:</span><span>₹${cessTotal.toFixed(2)}</span></div>` : ""}
    ${data.round_off ? `<div class="flex-between"><span>Round Off:</span><span>${data.round_off > 0 ? "+" : ""}₹${data.round_off.toFixed(2)}</span></div>` : ""}
    
    <div class="double-divider"></div>
    <div class="flex-between bold" style="font-size: ${is58 ? "13px" : "15px"};">
      <span>NET PAYABLE:</span>
      <span>₹${data.grand_total.toFixed(2)}</span>
    </div>
    <div class="double-divider"></div>

    ${data.payments && data.payments.length > 0 ? `
    <div style="font-size: ${is58 ? "8.5px" : "9.5px"}; margin: 4px 0;">
      ${data.payments.map((p) => `
        <div class="flex-between">
          <span>Paid ${p.mode}${p.reference_no ? ` (${p.reference_no})` : ""}:</span>
          <span class="bold">₹${Number(p.amount).toFixed(2)}</span>
        </div>
      `).join("")}
      ${data.change_due && data.change_due > 0 ? `
        <div class="flex-between bold" style="color: #047857;">
          <span>Change Returned:</span>
          <span>₹${Number(data.change_due).toFixed(2)}</span>
        </div>
      ` : ""}
      ${data.balance_due && data.balance_due > 0 ? `
        <div class="flex-between bold" style="color: #b45309;">
          <span>Balance Due (Credit):</span>
          <span>₹${Number(data.balance_due).toFixed(2)}</span>
        </div>
      ` : ""}
    </div>
    <div class="divider"></div>
    ` : ""}

    ${showQr && qrSvg ? `
    <div class="center" style="margin: 8px 0;">
      <div>${qrSvg}</div>
      <div style="font-size: 8px; color: #475569; margin-top: 2px;">Scan with any UPI app to pay</div>
      <div class="bold" style="font-size: 8.5px;">UPI: ${upiVpa}</div>
    </div>
    <div class="divider"></div>
    ` : ""}

    ${showTerms ? `
    <div class="center" style="font-size: 8px; color: #475569; margin-top: 6px;">
      <div>${data.terms_and_conditions || "Medicines strictly non-returnable without cash memo."}</div>
      <div style="margin-top: 3px;">${data.jurisdiction_note || "Subject to local jurisdiction."}</div>
    </div>
    ` : ""}

    <div class="center bold" style="font-size: 9px; margin-top: 8px;">
      ${data.footer_note || "Thank you! Visit again"}
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Generates Half A4 (A5 Landscape) Tax Invoice HTML
   */
  generateHalfA4InvoiceHtml(data: InvoicePrintData, options?: PrintRenderOptions): string {
    const amountWords = data.amount_in_words || numberToWordsIndian(data.grand_total);
    const showQr = options?.showUpiQr !== false;
    const showLicenses = options?.showDrugLicenses !== false;
    const copyMarker = options?.copyMarker;

    const upiVpa = data.upi_vpa || "pharmacy@upi";
    const upiUri = generateUpiPaymentString(upiVpa, data.store_name, data.grand_total, data.invoice_number);
    const qrSvg = generateQrCodeSvg(upiUri, 58);

    const isInterState = data.igst_total !== undefined && data.igst_total > 0;
    const cgstTotal = data.cgst_total !== undefined ? data.cgst_total : round2(data.tax_total / 2);
    const sgstTotal = data.sgst_total !== undefined ? data.sgst_total : round2(data.tax_total / 2);
    const igstTotal = data.igst_total !== undefined ? data.igst_total : (isInterState ? data.tax_total : 0);
    const cessTotal = data.cess_total !== undefined ? data.cess_total : 0;

    const itemsRows = data.lines
      .map(
        (l, i) => `
        <tr>
          <td style="padding: 3px 4px; text-align: center; border-bottom: 1px solid #cbd5e1;">${i + 1}</td>
          <td style="padding: 3px 4px; border-bottom: 1px solid #cbd5e1; font-weight: 700;">${l.description}</td>
          <td style="padding: 3px 4px; text-align: center; border-bottom: 1px solid #cbd5e1;">${l.batch_no || "-"}</td>
          <td style="padding: 3px 4px; text-align: center; border-bottom: 1px solid #cbd5e1;">${l.expiry_date || "-"}</td>
          <td style="padding: 3px 4px; text-align: right; border-bottom: 1px solid #cbd5e1;">${l.qty}${l.loose_qty ? `+${l.loose_qty}L` : ""}</td>
          <td style="padding: 3px 4px; text-align: right; border-bottom: 1px solid #cbd5e1;">₹${l.rate.toFixed(2)}</td>
          <td style="padding: 3px 4px; text-align: right; border-bottom: 1px solid #cbd5e1;">${l.gst_percent}%</td>
          <td style="padding: 3px 4px; text-align: right; border-bottom: 1px solid #cbd5e1; font-weight: 700;">₹${l.amount.toFixed(2)}</td>
        </tr>`
      )
      .join("");

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Tax Invoice (Half A4) - ${data.invoice_number}</title>
  <style>
    @media print {
      @page { size: A5 landscape; margin: 5mm; }
      body { margin: 0; padding: 0; background: #fff !important; }
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 9px;
      line-height: 1.25;
      color: #1e293b;
      margin: 0;
      padding: 10px;
      background: #fff;
    }
    .header-bar { display: flex; justify-content: space-between; border-bottom: 1.5px solid #0f172a; padding-bottom: 4px; margin-bottom: 6px; }
    .meta-bar { display: flex; justify-content: space-between; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px 8px; margin-bottom: 6px; font-size: 8.5px; }
    table.data-table { width: 100%; border-collapse: collapse; font-size: 8.5px; margin-bottom: 6px; }
    table.data-table th { background: #f1f5f9; color: #0f172a; font-weight: 700; padding: 3px 4px; border-top: 1px solid #cbd5e1; border-bottom: 1.5px solid #94a3b8; }
    .bottom-grid { display: flex; justify-content: space-between; gap: 8px; }
    .totals-box { width: 220px; border: 1px solid #cbd5e1; border-radius: 4px; background: #f8fafc; padding: 4px 8px; font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <div class="header-bar">
    <div>
      <div style="font-size: 14px; font-weight: 800; color: #0f172a;">${data.store_name}</div>
      <div style="font-size: 8px; color: #475569;">${data.store_address || ""} • Tel: ${data.store_phone || ""}</div>
      ${showLicenses && data.store_gstin ? `<div style="font-size: 8px; font-weight: 700;">GSTIN: ${data.store_gstin}</div>` : ""}
    </div>
    <div style="text-align: right;">
      <div style="font-size: 11px; font-weight: 800; color: #1d4ed8;">TAX INVOICE</div>
      ${copyMarker ? `<div style="font-size: 8px; color: #64748b;">[ ${copyMarker} ]</div>` : ""}
      <div style="font-weight: 700;">#${data.invoice_number}</div>
      <div style="font-size: 8px;">Date: ${data.invoice_date}</div>
    </div>
  </div>

  <div class="meta-bar">
    <div><strong>Customer:</strong> ${data.customer_name || "Walk-in"} ${data.customer_phone ? `(${data.customer_phone})` : ""}</div>
    <div>Pay Mode: <strong>${data.payment_mode || "Cash"}</strong> (${data.payment_status || "Paid"})</div>
  </div>

  <table class="data-table">
    <thead>
      <tr>
        <th style="width: 20px; text-align: center;">#</th>
        <th style="text-align: left;">Item Description</th>
        <th style="width: 60px; text-align: center;">Batch</th>
        <th style="width: 50px; text-align: center;">Exp</th>
        <th style="width: 35px; text-align: right;">Qty</th>
        <th style="width: 55px; text-align: right;">Rate (₹)</th>
        <th style="width: 45px; text-align: right;">GST%</th>
        <th style="width: 65px; text-align: right;">Total (₹)</th>
      </tr>
    </thead>
    <tbody>
      ${itemsRows}
    </tbody>
  </table>

  <div class="bottom-grid">
    <div style="flex: 1; display: flex; gap: 8px; align-items: center;">
      ${showQr && qrSvg ? `<div>${qrSvg}</div>` : ""}
      <div style="font-size: 8px; color: #64748b;">
        <div><strong>Words:</strong> ${amountWords}</div>
        <div style="margin-top: 3px;">${data.terms_and_conditions || "Goods once sold cannot be returned without cash memo."}</div>
      </div>
    </div>

    <div class="totals-box">
      <div style="display: flex; justify-content: space-between;"><span>Taxable:</span><span>₹${data.subtotal.toFixed(2)}</span></div>
      <div style="display: flex; justify-content: space-between;"><span>GST Total:</span><span>₹${data.tax_total.toFixed(2)}</span></div>
      ${data.round_off ? `<div style="display: flex; justify-content: space-between;"><span>Round Off:</span><span>${data.round_off > 0 ? "+" : ""}₹${data.round_off.toFixed(2)}</span></div>` : ""}
      <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 800; border-top: 1.5px solid #0f172a; margin-top: 3px; padding-top: 3px; color: #1d4ed8;">
        <span>Grand Total:</span><span>₹${data.grand_total.toFixed(2)}</span>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Generates a high-fidelity vector PDF matching the Statutory A4 Tax Invoice layout,
   * using embedded Roboto font with full Unicode ₹ support, repeating headers, and totals summary.
   */
  generateInvoicePdf(data: InvoicePrintData): Uint8Array {
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    // Embed local TrueType font with full Indian Rupee (₹, U+20B9) Unicode support
    doc.addFileToVFS("Roboto-Regular.ttf", ROBOTO_REGULAR_BASE64);
    doc.addFont("Roboto-Regular.ttf", "Roboto", "normal");
    doc.addFileToVFS("Roboto-Bold.ttf", ROBOTO_BOLD_BASE64);
    doc.addFont("Roboto-Bold.ttf", "Roboto", "bold");
    doc.setFont("Roboto", "normal");

    const pageWidth = 210;
    const marginX = 12;
    const contentWidth = pageWidth - marginX * 2; // 186mm
    const centerX = pageWidth / 2;

    // Header: Pharmacy Name & Contact
    doc.setFont("Roboto", "bold");
    doc.setFontSize(15);
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text(data.store_name || "Pharmacy Store", centerX, 14, { align: "center" });

    doc.setFont("Roboto", "normal");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105); // slate-600
    const addressLine = `${data.store_address || "Main Road, Palakkad, Kerala - 678001"} • Phone: ${data.store_phone || "9876543210"}`;
    doc.text(addressLine, centerX, 18.5, { align: "center" });

    // Licenses (GSTIN, DL, FSSAI)
    const licenseItems: string[] = [];
    if (data.store_gstin) licenseItems.push(`GSTIN: ${data.store_gstin}`);
    if (data.drug_license_numbers && data.drug_license_numbers.length > 0) {
      licenseItems.push(`DL: ${data.drug_license_numbers.join(", ")}`);
    }
    if (data.fssai_no) licenseItems.push(`FSSAI: ${data.fssai_no}`);

    if (licenseItems.length > 0) {
      doc.setFont("Roboto", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(51, 65, 85);
      doc.text(licenseItems.join("  |  "), centerX, 22.5, { align: "center" });
    }

    // Divider Line
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(marginX, 24.5, marginX + contentWidth, 24.5);

    // Title Badge
    doc.setFont("Roboto", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text("TAX INVOICE", centerX, 29, { align: "center" });

    // Metadata Grid (Customer / Patient / Doctor / Invoice Info)
    const metaBoxY = 31.5;
    const metaBoxHeight = 19;
    doc.setFillColor(248, 250, 252);
    doc.rect(marginX, metaBoxY, contentWidth, metaBoxHeight, "F");
    doc.setDrawColor(226, 232, 240);
    doc.rect(marginX, metaBoxY, contentWidth, metaBoxHeight, "S");

    doc.setFontSize(7.5);
    const leftX = marginX + 3;
    const rightColX = marginX + contentWidth / 2 + 10;

    // Left Column
    doc.setFont("Roboto", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text(`Billed To: ${data.customer_name || "Walk-in Customer"}`, leftX, metaBoxY + 4.5);

    doc.setFont("Roboto", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text(`Mobile: ${data.customer_phone || "Not specified"}`, leftX, metaBoxY + 8.5);

    if (data.patient_name) {
      const patientInfo = `Patient: ${data.patient_name}${data.patient_age ? ` (${data.patient_age} yrs)` : ""}${data.patient_gender ? ` / ${data.patient_gender}` : ""}`;
      doc.text(patientInfo, leftX, metaBoxY + 12.5);
    } else {
      doc.text("Category: Retail Sale", leftX, metaBoxY + 12.5);
    }

    if (data.doctor_name) {
      const doctorInfo = `Doctor: ${data.doctor_name}${data.doctor_reg_no ? ` [Reg: ${data.doctor_reg_no}]` : ""}`;
      doc.text(doctorInfo, leftX, metaBoxY + 16.5);
    }

    // Right Column
    doc.setFont("Roboto", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text(`Invoice No: ${data.invoice_number}`, rightColX, metaBoxY + 4.5);

    doc.setFont("Roboto", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text(`Date: ${data.invoice_date}${data.invoice_time ? ` ${data.invoice_time}` : ""}`, rightColX, metaBoxY + 8.5);
    doc.text(`Payment: ${data.payment_mode || "Cash"} (${data.payment_status || "Paid"})`, rightColX, metaBoxY + 12.5);
    doc.text(`Place of Supply: ${data.place_of_supply || "32-Kerala"}`, rightColX, metaBoxY + 16.5);

    // Items Table using jspdf-autotable
    const tableRows = data.lines.map((l, i) => [
      String(i + 1),
      l.description,
      l.hsn_code || "300490",
      l.batch_no || "-",
      l.expiry_date || "-",
      `${l.qty}${l.loose_qty ? ` + ${l.loose_qty}L` : ""}`,
      `₹ ${l.rate.toFixed(2)}`,
      `${l.gst_percent}%`,
      `₹ ${l.amount.toFixed(2)}`,
    ]);

    const colAlignments: Record<number, "left" | "center" | "right"> = {
      0: "center",
      1: "left",
      2: "center",
      3: "center",
      4: "center",
      5: "right",
      6: "right",
      7: "right",
      8: "right",
    };

    autoTable(doc, {
      startY: 53.5,
      margin: { left: marginX, right: marginX },
      head: [["#", "Item Description", "HSN", "Batch", "Exp", "Qty", "Rate (₹)", "GST %", "Total (₹)"]],
      body: tableRows,
      theme: "grid",
      showHead: "everyPage",
      styles: {
        font: "Roboto",
        fontSize: 7.5,
        textColor: [30, 41, 59],
        cellPadding: 1.8,
      },
      headStyles: {
        font: "Roboto",
        fontStyle: "bold",
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        fontSize: 7.5,
      },
      alternateRowStyles: {
        fillColor: [255, 255, 255],
      },
      columnStyles: {
        0: { cellWidth: 8 },
        1: { cellWidth: 54, fontStyle: "bold" },
        2: { cellWidth: 18 },
        3: { cellWidth: 20 },
        4: { cellWidth: 16 },
        5: { cellWidth: 14 },
        6: { cellWidth: 18 },
        7: { cellWidth: 14 },
        8: { cellWidth: 24, fontStyle: "bold" },
      },
      didParseCell: (hookData) => {
        hookData.cell.styles.halign = colAlignments[hookData.column.index] || "left";
      },
    });

    // Check final position for HSN Summary & Totals
    let currY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 4 : 120;
    if (currY + 65 > 280) {
      doc.addPage();
      currY = 15;
    }

    // HSN Tax Summary Table
    const hsnRows = calculateHsnSummary(data.lines);
    const isInterState = (data.igst_total !== undefined && data.igst_total > 0) || hsnRows.some((r) => r.igstAmount > 0);
    const cessTotal = data.cess_total !== undefined ? data.cess_total : hsnRows.reduce((sum, r) => sum + r.cessAmount, 0);

    let totalHsnTaxable = 0;
    let totalHsnCgst = 0;
    let totalHsnSgst = 0;
    let totalHsnIgst = 0;
    let totalHsnCess = 0;
    let totalHsnTax = 0;

    const hsnTableBody = hsnRows.map((r) => {
      totalHsnTaxable += r.taxableValue;
      totalHsnCgst += r.cgstAmount;
      totalHsnSgst += r.sgstAmount;
      totalHsnIgst += r.igstAmount;
      totalHsnCess += r.cessAmount;
      totalHsnTax += r.totalTax;

      if (isInterState) {
        return [
          r.hsnCode,
          `₹ ${r.taxableValue.toFixed(2)}`,
          `${r.igstRate}%`,
          `₹ ${r.igstAmount.toFixed(2)}`,
          ...(cessTotal > 0 ? [`₹ ${r.cessAmount.toFixed(2)}`] : []),
          `₹ ${r.totalTax.toFixed(2)}`,
        ];
      }

      return [
        r.hsnCode,
        `₹ ${r.taxableValue.toFixed(2)}`,
        `${r.cgstRate}%`,
        `₹ ${r.cgstAmount.toFixed(2)}`,
        `${r.sgstRate}%`,
        `₹ ${r.sgstAmount.toFixed(2)}`,
        ...(cessTotal > 0 ? [`₹ ${r.cessAmount.toFixed(2)}`] : []),
        `₹ ${r.totalTax.toFixed(2)}`,
      ];
    });

    if (isInterState) {
      hsnTableBody.push([
        "Total",
        `₹ ${totalHsnTaxable.toFixed(2)}`,
        "",
        `₹ ${totalHsnIgst.toFixed(2)}`,
        ...(cessTotal > 0 ? [`₹ ${totalHsnCess.toFixed(2)}`] : []),
        `₹ ${totalHsnTax.toFixed(2)}`,
      ]);
    } else {
      hsnTableBody.push([
        "Total",
        `₹ ${totalHsnTaxable.toFixed(2)}`,
        "",
        `₹ ${totalHsnCgst.toFixed(2)}`,
        "",
        `₹ ${totalHsnSgst.toFixed(2)}`,
        ...(cessTotal > 0 ? [`₹ ${totalHsnCess.toFixed(2)}`] : []),
        `₹ ${totalHsnTax.toFixed(2)}`,
      ]);
    }

    const hsnAlignments: Record<number, "left" | "center" | "right"> = {
      0: "center",
      1: "right",
      2: "right",
      3: "right",
      4: "right",
      5: "right",
      6: "right",
      7: "right",
    };

    doc.setFont("Roboto", "bold");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text("HSN / GST TAX SUMMARY", marginX, currY);

    const hsnHead = isInterState
      ? [["HSN/SAC", "Taxable Value (₹)", "IGST %", "IGST (₹)", ...(cessTotal > 0 ? ["Cess (₹)"] : []), "Total Tax (₹)"]]
      : [["HSN/SAC", "Taxable Value (₹)", "CGST %", "CGST (₹)", "SGST %", "SGST (₹)", ...(cessTotal > 0 ? ["Cess (₹)"] : []), "Total Tax (₹)"]];

    autoTable(doc, {
      startY: currY + 1.5,
      margin: { left: marginX, right: marginX },
      head: hsnHead,
      body: hsnTableBody,
      theme: "grid",
      styles: {
        font: "Roboto",
        fontSize: 7,
        textColor: [30, 41, 59],
        cellPadding: 1.5,
      },
      headStyles: {
        font: "Roboto",
        fontStyle: "bold",
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        fontSize: 7,
      },
      didParseCell: (hookData) => {
        hookData.cell.styles.halign = hsnAlignments[hookData.column.index] || "left";
        if (hookData.row.index === hsnTableBody.length - 1) {
          hookData.cell.styles.fontStyle = "bold";
          hookData.cell.styles.fillColor = [248, 250, 252];
        }
      },
    });

    let bottomY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 4 : 160;
    if (bottomY + 68 > 280) {
      doc.addPage();
      bottomY = 15;
    }

    const colLeftX = marginX; // 12mm
    const colRightWidth = 75; // 75mm (Totals & Signature width)
    const gap = 5; // 5mm gap between columns
    const colLeftWidth = contentWidth - colRightWidth - gap; // 186 - 75 - 5 = 106mm
    const colRightX = colLeftX + colLeftWidth + gap; // 12 + 106 + 5 = 123mm

    // Amount in Words Banner (Full width: 186mm)
    const amountWords = data.amount_in_words || numberToWordsIndian(data.grand_total);
    doc.setFillColor(248, 250, 252);
    doc.rect(colLeftX, bottomY, contentWidth, 7, "F");
    doc.setDrawColor(203, 213, 225);
    doc.rect(colLeftX, bottomY, contentWidth, 7, "S");

    doc.setFont("Roboto", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);
    doc.text("Amount in Words: ", colLeftX + 3, bottomY + 4.8);
    const wordsPrefixWidth = doc.getTextWidth("Amount in Words: ");
    doc.setFont("Roboto", "normal");
    doc.text(amountWords, colLeftX + 3 + wordsPrefixWidth, bottomY + 4.8, { maxWidth: contentWidth - wordsPrefixWidth - 6 });

    // Grid Row 1 (Y: bottomY + 9mm, Height: 32mm)
    const row1Y = bottomY + 9;
    const row1Height = 32;

    // Top-Left: UPI QR Box (X: colLeftX = 12mm, Width: colLeftWidth = 106mm)
    doc.setFillColor(248, 250, 252);
    doc.rect(colLeftX, row1Y, colLeftWidth, row1Height, "F");
    doc.setDrawColor(226, 232, 240);
    doc.rect(colLeftX, row1Y, colLeftWidth, row1Height, "S");

    const upiVpa = data.upi_vpa || "pharmacy@upi";
    const upiUri = generateUpiPaymentString(upiVpa, data.store_name, data.grand_total, data.invoice_number);
    drawQrCodeJsPdf(doc, upiUri, colLeftX + 4, row1Y + 4, 24);

    const qrTextX = colLeftX + 32;
    doc.setFont("Roboto", "bold");
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text("Scan & Pay via UPI", qrTextX, row1Y + 9);

    doc.setFont("Roboto", "normal");
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text(`UPI VPA: ${upiVpa}`, qrTextX, row1Y + 14.5);
    doc.setFont("Roboto", "bold");
    doc.text(`Total Amount: ₹ ${data.grand_total.toFixed(2)}`, qrTextX, row1Y + 19.5);
    doc.setFont("Roboto", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text("Scan with GPay, PhonePe, Paytm, or any UPI app", qrTextX, row1Y + 25);

    // Top-Right: Totals Card (X: colRightX = 123mm, Width: colRightWidth = 75mm)
    doc.setFillColor(248, 250, 252);
    doc.rect(colRightX, row1Y, colRightWidth, row1Height, "F");
    doc.setDrawColor(203, 213, 225);
    doc.rect(colRightX, row1Y, colRightWidth, row1Height, "S");

    doc.setFontSize(7.5);
    doc.setFont("Roboto", "normal");
    doc.setTextColor(71, 85, 105);

    const cgstTotal = data.cgst_total !== undefined ? data.cgst_total : round2(data.tax_total / 2);
    const sgstTotal = data.sgst_total !== undefined ? data.sgst_total : round2(data.tax_total / 2);
    const igstTotal = data.igst_total !== undefined ? data.igst_total : (isInterState ? data.tax_total : 0);
    const rightValX = colRightX + colRightWidth - 4;

    doc.text("Taxable Subtotal:", colRightX + 3, row1Y + 5);
    doc.text(`₹ ${data.subtotal.toFixed(2)}`, rightValX, row1Y + 5, { align: "right" });

    if (isInterState) {
      doc.text("Integrated GST (IGST):", colRightX + 3, row1Y + 9.5);
      doc.text(`₹ ${igstTotal.toFixed(2)}`, rightValX, row1Y + 9.5, { align: "right" });
    } else {
      doc.text("Central GST (CGST):", colRightX + 3, row1Y + 9.5);
      doc.text(`₹ ${cgstTotal.toFixed(2)}`, rightValX, row1Y + 9.5, { align: "right" });

      doc.text("State GST (SGST):", colRightX + 3, row1Y + 14);
      doc.text(`₹ ${sgstTotal.toFixed(2)}`, rightValX, row1Y + 14, { align: "right" });
    }

    if (cessTotal > 0) {
      doc.text("Cess:", colRightX + 3, row1Y + (isInterState ? 14 : 17));
      doc.text(`₹ ${cessTotal.toFixed(2)}`, rightValX, row1Y + (isInterState ? 14 : 17), { align: "right" });
    }

    doc.text("Total Tax:", colRightX + 3, row1Y + 19);
    doc.text(`₹ ${data.tax_total.toFixed(2)}`, rightValX, row1Y + 19, { align: "right" });

    if (data.round_off !== 0) {
      const roSign = data.round_off > 0 ? "+" : "";
      doc.text("Round-Off:", colRightX + 3, row1Y + 22.5);
      doc.text(`${roSign}₹ ${data.round_off.toFixed(2)}`, rightValX, row1Y + 22.5, { align: "right" });
    }

    doc.setDrawColor(203, 213, 225);
    doc.line(colRightX + 2, row1Y + 23.5, colRightX + colRightWidth - 2, row1Y + 23.5);

    doc.setFont("Roboto", "bold");
    doc.setFontSize(9);
    doc.setTextColor(29, 78, 216); // blue-700
    doc.text("Grand Total:", colRightX + 3, row1Y + 28);
    doc.text(`₹ ${data.grand_total.toFixed(2)}`, rightValX, row1Y + 28, { align: "right" });

    // Grid Row 2 (Y: row1Y + row1Height + 3mm, Height: 24mm)
    const row2Y = row1Y + row1Height + 3;
    const row2Height = 24;

    // Bottom-Left: Terms & Conditions Box (X: colLeftX = 12mm, Width: colLeftWidth = 106mm)
    doc.setFillColor(255, 255, 255);
    doc.rect(colLeftX, row2Y, colLeftWidth, row2Height, "F");
    doc.setDrawColor(226, 232, 240);
    doc.rect(colLeftX, row2Y, colLeftWidth, row2Height, "S");

    doc.setFont("Roboto", "bold");
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text("TERMS & CONDITIONS:", colLeftX + 3, row2Y + 4.5);

    doc.setFont("Roboto", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text("1. Goods once sold will not be returned without original cash memo.", colLeftX + 3, row2Y + 8.5, { maxWidth: colLeftWidth - 6 });
    doc.text("2. Refrigerated medicines are strictly non-returnable.", colLeftX + 3, row2Y + 12.5, { maxWidth: colLeftWidth - 6 });
    doc.text(`3. ${data.jurisdiction_note || "Subject to local jurisdiction."}`, colLeftX + 3, row2Y + 16.5, { maxWidth: colLeftWidth - 6 });

    doc.setFontSize(6);
    doc.setTextColor(148, 163, 184);
    doc.text(data.footer_note || "Computer Generated Tax Invoice • LamSuite POS", colLeftX + 3, row2Y + 21);

    // Bottom-Right: Authorised Signatory Box (X: colRightX = 123mm, Width: colRightWidth = 75mm)
    doc.setFillColor(248, 250, 252);
    doc.rect(colRightX, row2Y, colRightWidth, row2Height, "F");
    doc.setDrawColor(203, 213, 225);
    doc.rect(colRightX, row2Y, colRightWidth, row2Height, "S");

    doc.setFont("Roboto", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);
    doc.text(`For ${data.store_name}`, colRightX + colRightWidth / 2, row2Y + 5, { align: "center", maxWidth: colRightWidth - 4 });

    doc.setDrawColor(148, 163, 184);
    doc.line(colRightX + 8, row2Y + 17, colRightX + colRightWidth - 8, row2Y + 17);

    doc.setFont("Roboto", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(71, 85, 105);
    doc.text("Authorised Signatory / Pharmacist", colRightX + colRightWidth / 2, row2Y + 21, { align: "center" });

    // Page Numbering & Bottom Brand Mark on all pages
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFont("Roboto", "normal");
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Page ${p} of ${totalPages}  •  Computer Generated Statutory Tax Invoice  •  LamSuite POS`,
        centerX,
        292,
        { align: "center" }
      );
    }

    return new Uint8Array(doc.output("arraybuffer"));
  }

  async openFile(filePath: string): Promise<boolean> {
    if (isTauri()) {
      try {
        await invokeCommand("open_file", { path: filePath });
        return true;
      } catch (e) {
        console.error("Failed to open file via Tauri:", e);
        return false;
      }
    }
    return false;
  }

  async revealFile(filePath: string): Promise<boolean> {
    if (isTauri()) {
      try {
        await invokeCommand("reveal_file", { path: filePath });
        return true;
      } catch (e) {
        console.error("Failed to reveal file via Tauri:", e);
        return false;
      }
    }
    return false;
  }

  async exportToPdf(data: InvoicePrintData): Promise<{ success: boolean; file_path?: string; cancelled?: boolean; error?: string }> {
    const cleanInvoiceNo = data.invoice_number.replace(/[^a-zA-Z0-9_-]/g, "_");
    const defaultFileName = `Invoice_${cleanInvoiceNo}.pdf`;

    let pdfBytes: Uint8Array;
    try {
      pdfBytes = this.generateInvoicePdf(data);
    } catch (err: any) {
      console.error("PDF generation failed:", err);
      return { success: false, error: `PDF generation error: ${err?.message || err}` };
    }

    // 1. Desktop Tauri App: Native Save As Dialog (Finder on macOS / Explorer on Windows)
    if (isTauri()) {
      try {
        const LAST_FOLDER_KEY = "lamsuite_last_save_pdf_folder";
        let defaultPath = defaultFileName;
        try {
          const lastFolder = typeof window !== "undefined" ? localStorage.getItem(LAST_FOLDER_KEY) : null;
          if (lastFolder) {
            const cleanFolder = lastFolder.replace(/[/\\]+$/, "");
            defaultPath = `${cleanFolder}/${defaultFileName}`;
          }
        } catch {}

        let chosenPath: string | null = null;
        try {
          const g = typeof window !== "undefined" ? (window as any) : {};
          if (typeof g.__TAURI__?.dialog?.save === "function") {
            chosenPath = await g.__TAURI__.dialog.save({
              defaultPath,
              filters: [{ name: "PDF Document (*.pdf)", extensions: ["pdf"] }],
              title: "Save Invoice as PDF",
            });
          } else {
            const { save } = await import("@tauri-apps/api/dialog");
            chosenPath = await save({
              defaultPath,
              filters: [
                { name: "PDF Document (*.pdf)", extensions: ["pdf"] },
              ],
              title: "Save Invoice as PDF",
            });
          }
        } catch (dialogErr: any) {
          console.error("Tauri dialog save error:", dialogErr);
          return { success: false, error: `Could not open file save dialog: ${dialogErr?.message || dialogErr}` };
        }

        // If user cancelled the Finder / File Explorer dialog, stop immediately with cancelled: true
        if (!chosenPath) {
          return { success: false, cancelled: true };
        }

        // Ensure file path ends with .pdf extension
        if (!chosenPath.toLowerCase().endsWith(".pdf")) {
          chosenPath = `${chosenPath}.pdf`;
        }

        // Remember the chosen folder for next time
        const lastSlash = Math.max(chosenPath.lastIndexOf("/"), chosenPath.lastIndexOf("\\"));
        if (lastSlash > 0) {
          const chosenDir = chosenPath.substring(0, lastSlash);
          try {
            localStorage.setItem(LAST_FOLDER_KEY, chosenDir);
          } catch {}
        }

        // Convert pdfBytes to base64 string for redundant serialization support
        let pdfBase64 = "";
        try {
          let binary = "";
          const len = pdfBytes.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(pdfBytes[i]);
          }
          pdfBase64 = btoa(binary);
        } catch (e) {
          console.warn("Base64 conversion failed:", e);
        }

        // Provide both camelCase and snake_case keys (top-level and embedded in data)
        const payload = {
          data: {
            ...data,
            targetPath: chosenPath,
            target_path: chosenPath,
            pdfBase64,
            pdf_base64: pdfBase64,
          },
          targetPath: chosenPath,
          target_path: chosenPath,
          pdfBytes: Array.from(pdfBytes),
          pdf_bytes: Array.from(pdfBytes),
          pdfBase64,
          pdf_base64: pdfBase64,
        };

        const res = await invokeCommand<{ success: boolean; file_path?: string }>("print:export_pdf", payload);

        if (res && res.success) {
          return { success: true, file_path: res.file_path };
        } else {
          return { success: false, error: "Failed to write PDF file to disk" };
        }
      } catch (err: any) {
        console.error("Tauri PDF export failed:", err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // 2. In Browser runtime: Save as PDF
    if (typeof window !== "undefined") {
      // Modern browser File System Access API: triggers native Finder / File Explorer "Save As" sheet
      if ("showSaveFilePicker" in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: defaultFileName,
            types: [
              {
                description: "PDF Document (*.pdf)",
                accept: { "application/pdf": [".pdf"] },
              },
            ],
          });
          const writable = await handle.createWritable();
          await writable.write(pdfBytes);
          await writable.close();
          return { success: true, file_path: handle.name || defaultFileName };
        } catch (pickerErr: any) {
          if (pickerErr && typeof pickerErr === "object" && (pickerErr as { name?: string }).name === "AbortError") {
            return { success: false, cancelled: true };
          }
          return { success: false, error: pickerErr?.message || "Failed to save PDF to selected location" };
        }
      }

      // Browser Fallback: Direct download blob with correct application/pdf MIME type
      try {
        const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = defaultFileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        return { success: true, file_path: `Downloads/${defaultFileName}` };
      } catch (blobErr: any) {
        return { success: false, error: blobErr?.message || "Browser download failed" };
      }
    }

    // 3. Desktop / Mock runtime fallback (e.g. testing)
    try {
      let pdfBase64 = "";
      try {
        let binary = "";
        const len = pdfBytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(pdfBytes[i]);
        }
        pdfBase64 = btoa(binary);
      } catch {}

      const fallbackPath = `/exports/${defaultFileName}`;
      const payload = {
        data: {
          ...data,
          targetPath: fallbackPath,
          target_path: fallbackPath,
          pdfBase64,
          pdf_base64: pdfBase64,
        },
        targetPath: fallbackPath,
        target_path: fallbackPath,
        pdfBytes: Array.from(pdfBytes),
        pdf_bytes: Array.from(pdfBytes),
        pdfBase64,
        pdf_base64: pdfBase64,
      };

      const res = await invokeCommand<{ success: boolean; file_path?: string }>("print:export_pdf", payload);
      if (res && res.success) {
        return { success: true, file_path: res.file_path || fallbackPath };
      }
      return { success: false, error: "Failed to write PDF file" };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Generates Statutory A4 Credit Note HTML for Sales Returns
   */
  generateCreditNoteA4Html(data: CreditNotePrintData): string {
    const isInterState = data.igst_total !== undefined && data.igst_total > 0;
    const cgstTotal = data.cgst_total !== undefined ? data.cgst_total : round2(data.tax_total / 2);
    const sgstTotal = data.sgst_total !== undefined ? data.sgst_total : round2(data.tax_total / 2);
    const igstTotal = data.igst_total !== undefined ? data.igst_total : (isInterState ? data.tax_total : 0);
    const cessTotal = data.cess_total !== undefined ? data.cess_total : 0;
    const amountWords = data.amount_in_words || numberToWordsIndian(data.grand_total);

    const pageChunks = chunkInvoiceLines(data.lines, 14, 16, 24, 14);
    const totalPages = pageChunks.length;

    let cumulativeIdx = 0;
    const pagesHtml = pageChunks
      .map((chunk, pageIdx) => {
        const pageNum = pageIdx + 1;
        const isFirstPage = pageNum === 1;
        const isLastPage = pageNum === totalPages;
        const startIdx = cumulativeIdx;
        cumulativeIdx += chunk.length;
        const endIdx = cumulativeIdx;

        const itemsRows = chunk
          .map(
            (it, idx) => `
          <tr>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">${startIdx + idx + 1}</td>
            <td style="padding: 4px 6px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
              <div style="font-weight: 700; color: #0f172a;">${it.description}</div>
              ${it.reason ? `<div style="font-size: 8.5px; color: #dc2626;">Reason: ${it.reason}</div>` : ""}
            </td>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">${it.hsn_code || "300490"}</td>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; font-family: monospace;">${it.batch_no || "-"}</td>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">${it.expiry_date || "-"}</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; font-weight: 700;">${it.qty}</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; font-variant-numeric: tabular-nums;">₹ ${it.rate.toFixed(2)}</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">${it.gst_percent}%</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #e2e8f0; font-weight: 700; font-variant-numeric: tabular-nums;">₹ ${it.amount.toFixed(2)}</td>
          </tr>`
          )
          .join("");

        return `
      <div class="a4-sheet">
        ${
          isFirstPage
            ? `
        <div class="header">
          <div class="store-name">${data.store_name}</div>
          <div style="font-size: 10px; color: #475569;">${data.store_address || ""} • Phone: ${data.store_phone || ""}</div>
          <div style="font-size: 9.5px; font-weight: 700; color: #334155; margin-top: 2px;">
            ${data.store_gstin ? `GSTIN: ${data.store_gstin}` : ""}
          </div>
          <div class="tax-badge">CREDIT NOTE / SALES RETURN</div>
        </div>

        <div class="meta-grid">
          <div class="meta-col">
            <div><strong>Customer:</strong> ${data.customer_name}</div>
            <div>Mobile: ${data.customer_phone || "Not specified"}</div>
            ${data.customer_gstin ? `<div>GSTIN: ${data.customer_gstin}</div>` : ""}
            <div>Refund Mode: <strong>${data.refund_mode}</strong></div>
            ${data.customer_debit_note_number ? `<div style="margin-top: 3px; color: #991b1b; font-weight: 700;">Customer DN Ref: #${data.customer_debit_note_number} ${data.customer_debit_note_date ? `(${data.customer_debit_note_date})` : ""}</div>` : ""}
          </div>
          <div class="meta-col" style="text-align: right;">
            <div style="font-size: 12px; font-weight: 800; color: #b91c1c;">#${data.return_number}</div>
            <div>Credit Note Date: ${data.return_date}</div>
            ${data.original_invoice_number ? `<div>Original Invoice: <strong>#${data.original_invoice_number}</strong> ${data.original_invoice_date ? `(${data.original_invoice_date})` : ""}</div>` : data.invoice_references && data.invoice_references.length > 0 ? `<div>Invoices: <strong>${data.invoice_references.map((r) => `#${r.invoice_number}`).join(", ")}</strong></div>` : "<div>Standalone Sales Return</div>"}
          </div>
        </div>
        `
            : `
        <div class="running-header">
          <div>
            <span class="running-store">${data.store_name}</span>
            <span class="running-inv">Credit Note #${data.return_number}</span>
            <span class="running-date">Date: ${data.return_date}</span>
          </div>
          <div class="running-page">Page ${pageNum} of ${totalPages}</div>
        </div>
        `
        }

        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 28px; text-align: center; border-right: 1px solid #fecaca;">#</th>
              <th style="text-align: left; border-right: 1px solid #fecaca;">Returned Item Description</th>
              <th style="width: 60px; text-align: center; border-right: 1px solid #fecaca;">HSN</th>
              <th style="width: 65px; text-align: center; border-right: 1px solid #fecaca;">Batch</th>
              <th style="width: 55px; text-align: center; border-right: 1px solid #fecaca;">Exp</th>
              <th style="width: 45px; text-align: right; border-right: 1px solid #fecaca;">Qty</th>
              <th style="width: 75px; text-align: right; border-right: 1px solid #fecaca;">Rate (₹)</th>
              <th style="width: 55px; text-align: right; border-right: 1px solid #fecaca;">GST %</th>
              <th style="width: 85px; text-align: right;">Reversal (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>

        ${
          !isLastPage
            ? `
        <div class="continuation-bar">
          <div>Showing items ${startIdx + 1} to ${endIdx} of ${data.lines.length} Total Returned Items</div>
          <div class="continuation-link">Continued on Page ${pageNum + 1} &rarr;</div>
        </div>
        `
            : ""
        }

        ${
          isLastPage
            ? `
        <div class="footer-container">
          <div class="amount-words-bar">
            <span style="color: #64748b; font-weight: 600;">Refund Amount in Words:</span> ${amountWords}
          </div>

          <div class="footer-grid">
            <div style="border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; font-size: 9px; color: #64748b;">
              <div style="font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;">Notes & Settlement Terms:</div>
              <div>1. Credit Note issued against returned goods as per Statutory GST Rule 53.</div>
              <div>2. Adjusted in customer ledger or refunded via ${data.refund_mode}.</div>
              ${data.notes ? `<div style="margin-top: 6px; color: #0f172a; font-weight: 600;">Remarks: ${data.notes}</div>` : ""}
              <div style="margin-top: 12px; font-size: 8.5px; color: #94a3b8;">Computer Generated Credit Note • LamSuite POS</div>
            </div>

            <div class="totals-card">
              <div class="total-line"><span>Taxable Reversal:</span><span style="font-weight: 600;">₹ ${data.subtotal.toFixed(2)}</span></div>
              <div class="total-line"><span>Central GST (CGST):</span><span style="font-weight: 600;">₹ ${cgstTotal.toFixed(2)}</span></div>
              <div class="total-line"><span>State GST (SGST):</span><span style="font-weight: 600;">₹ ${sgstTotal.toFixed(2)}</span></div>
              <div class="total-line"><span>Total GST Reversal:</span><span style="font-weight: 600;">₹ ${data.tax_total.toFixed(2)}</span></div>
              ${data.round_off ? `<div class="total-line"><span>Round Off:</span><span style="font-weight: 600;">${data.round_off > 0 ? "+" : ""}₹ ${data.round_off.toFixed(2)}</span></div>` : ""}
              <div class="grand-total-line"><span>Total Refund:</span><span>₹ ${data.grand_total.toFixed(2)}</span></div>
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; margin-top: 12px;">
            <div class="sign-card" style="width: 250px;">
              <div style="font-size: 10px; font-weight: 700; color: #1e293b;">For ${data.store_name}</div>
              <div style="min-height: 20px;"></div>
              <div style="font-size: 8.5px; font-weight: 600; color: #475569; border-top: 1px solid #94a3b8; padding-top: 2px;">
                Authorised Signatory / Pharmacist
              </div>
            </div>
          </div>
        </div>
        `
            : ""
        }

        <div class="spacer-fill"></div>
        <div class="page-footer">
          <div>Computer Generated Credit Note • ${data.store_name}</div>
          <div class="page-num">Page ${pageNum} of ${totalPages}</div>
        </div>
      </div>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Credit Note - ${data.return_number}</title>
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 10px; line-height: 1.35; color: #1e293b; margin: 0; padding: 24px 16px; background: #cbd5e1; font-variant-numeric: tabular-nums; display: flex; flex-direction: column; align-items: center; gap: 24px; min-height: 100vh; }
    .a4-sheet { width: 210mm; max-width: 210mm; min-height: 297mm; flex-shrink: 0; background: #ffffff; box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.15), 0 0 1px rgba(0, 0, 0, 0.2); border: 1px solid #cbd5e1; border-radius: 2px; padding: 12mm 14mm; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; position: relative; }
    @media print {
      body { background: white !important; padding: 0 !important; margin: 0 !important; display: block !important; }
      .a4-sheet { box-shadow: none !important; border: none !important; margin: 0 !important; padding: 8mm !important; width: 100% !important; min-height: auto !important; page-break-after: always !important; break-after: page !important; }
      .a4-sheet:last-child { page-break-after: auto !important; break-after: auto !important; }
    }
    .header { text-align: center; border-bottom: 2px solid #b91c1c; padding-bottom: 6px; margin-bottom: 10px; }
    .store-name { font-size: 18px; font-weight: 800; color: #0f172a; }
    .tax-badge { font-size: 12px; font-weight: 800; letter-spacing: 0.5px; color: #b91c1c; margin-top: 5px; }
    .running-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5px solid #b91c1c; padding-bottom: 6px; margin-bottom: 8px; font-size: 9.5px; }
    .running-store { font-weight: 800; color: #0f172a; font-size: 11px; }
    .running-inv { color: #b91c1c; font-weight: 700; margin-left: 8px; }
    .running-date { color: #64748b; margin-left: 8px; }
    .running-page { font-weight: 700; color: #475569; }
    .meta-grid { display: flex; justify-content: space-between; border: 1px solid #fca5a5; border-radius: 5px; background: #fff1f2; padding: 7px 10px; margin-bottom: 10px; }
    .meta-col { width: 48%; }
    table.data-table { width: 100%; border-collapse: collapse; font-size: 9.5px; margin-bottom: 8px; border: 1px solid #fca5a5; }
    table.data-table th { background: #fef2f2; color: #991b1b; font-weight: 700; padding: 5px 6px; border-top: 1px solid #fecaca; border-bottom: 2px solid #f87171; }
    .continuation-bar { display: flex; justify-content: space-between; align-items: center; background: #fff1f2; border: 1px dashed #f87171; border-radius: 4px; padding: 5px 10px; margin-top: 6px; font-size: 9px; color: #991b1b; }
    .continuation-link { font-weight: 700; color: #b91c1c; }
    .footer-container { margin-top: 10px; page-break-inside: avoid; }
    .amount-words-bar { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 5px 9px; font-size: 9.5px; font-weight: 700; color: #1e293b; margin-bottom: 8px; }
    .footer-grid { display: grid; grid-template-columns: 1fr 310px; gap: 8px 14px; align-items: stretch; }
    .totals-card { border: 1px solid #cbd5e1; border-radius: 5px; background: #f8fafc; padding: 7px 12px; font-variant-numeric: tabular-nums; }
    .total-line { display: flex; justify-content: space-between; padding: 2px 0; font-size: 10px; color: #475569; }
    .grand-total-line { display: flex; justify-content: space-between; padding-top: 5px; margin-top: 5px; border-top: 2px solid #b91c1c; font-size: 12.5px; font-weight: 800; color: #b91c1c; }
    .sign-card { border: 1px solid #cbd5e1; border-radius: 5px; background: #f8fafc; padding: 7px 12px; text-align: center; display: flex; flex-direction: column; justify-content: space-between; min-height: 65px; }
    .spacer-fill { flex-grow: 1; min-height: 6px; }
    .page-footer { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #e2e8f0; padding-top: 6px; margin-top: 8px; font-size: 8.5px; color: #64748b; }
    .page-num { font-weight: 700; color: #334155; }
  </style>
</head>
<body>
  ${pagesHtml}
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
   * Generates compact thermal receipt slip for Credit Notes (58mm and 80mm supported)
   */
  generateCreditNoteThermalSlip(
    data: CreditNotePrintData,
    widthMm: 80 | 58 = 80,
    options?: PrintRenderOptions
  ): string {
    const is58 = widthMm === 58;
    const showLicenses = options?.showDrugLicenses !== false;
    const copyMarker = options?.copyMarker;
    const curr = options?.currencySymbolFormat === "rs_text" ? "Rs. " : "₹";

    const isInterState = data.igst_total !== undefined && data.igst_total > 0;
    const cgstTotal = data.cgst_total !== undefined ? data.cgst_total : round2(data.tax_total / 2);
    const sgstTotal = data.sgst_total !== undefined ? data.sgst_total : round2(data.tax_total / 2);
    const igstTotal = data.igst_total !== undefined ? data.igst_total : (isInterState ? data.tax_total : 0);
    const cessTotal = data.cess_total !== undefined ? data.cess_total : 0;

    const linesHtml = data.lines
      .map((l, i) => {
        if (is58) {
          return `
          <div style="margin-bottom: 4px; border-bottom: 1px dotted #cbd5e1; padding-bottom: 3px;">
            <div style="font-weight: 700; word-break: break-word;">${i + 1}. ${l.description}</div>
            <div style="display: flex; justify-content: space-between; font-size: 9px; color: #334155; margin-top: 1px;">
              <span>${l.qty} × ${curr}${l.rate.toFixed(2)}${l.gst_percent ? ` (${l.gst_percent}%)` : ""}</span>
              <span style="font-weight: 700; color: #000; font-variant-numeric: tabular-nums;">${curr}${l.amount.toFixed(2)}</span>
            </div>
            ${(l.batch_no || l.expiry_date) ? `<div style="font-size: 8px; color: #64748b;">${l.batch_no ? `B: ${l.batch_no}` : ""}${l.batch_no && l.expiry_date ? " " : ""}${l.expiry_date ? `Exp: ${l.expiry_date}` : ""}</div>` : ""}
            ${l.reason ? `<div style="font-size: 8px; color: #2563eb;">Reason: ${l.reason}</div>` : ""}
          </div>`;
        }
        return `
        <div style="margin-bottom: 5px; border-bottom: 1px dotted #cbd5e1; padding-bottom: 3px;">
          <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 10.5px;">
            <span style="word-break: break-word; max-width: 70%;">${i + 1}. ${l.description}</span>
            <span style="font-variant-numeric: tabular-nums;">${curr}${l.amount.toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 9.5px; color: #475569; margin-top: 1px;">
            <span>${l.batch_no ? `B: ${l.batch_no}` : ""}${l.expiry_date ? ` | Exp: ${l.expiry_date}` : ""}${l.hsn_code ? ` | HSN: ${l.hsn_code}` : ""}${l.reason ? ` | ${l.reason}` : ""}</span>
            <span style="font-variant-numeric: tabular-nums;">${l.qty} @ ${curr}${l.rate.toFixed(2)}${l.gst_percent ? ` (${l.gst_percent}%)` : ""}</span>
          </div>
        </div>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Credit Note - ${data.return_number}</title>
  <style>
    @media print {
      @page { size: ${widthMm}mm auto; margin: 0; }
      html, body { margin: 0 !important; padding: 0 !important; width: ${widthMm}mm !important; background: #fff !important; }
      .thermal-paper { box-shadow: none !important; border: none !important; width: ${widthMm}mm !important; padding: ${is58 ? "2mm 1.5mm" : "3mm 2.5mm"} !important; min-height: auto !important; margin: 0 !important; }
      .no-print { display: none !important; }
    }
    * { box-sizing: border-box; }
    html { margin: 0; padding: 0; }
    body {
      margin: 0;
      padding: ${is58 ? "2px 0" : "8px 0"};
      display: flex;
      justify-content: center;
      background: #f1f5f9;
      font-family: 'Courier New', Courier, monospace, monospace;
      font-size: ${is58 ? "10px" : "11px"};
      line-height: 1.3;
      color: #0f172a;
    }
    .thermal-paper {
      width: ${is58 ? "58mm" : "80mm"};
      max-width: 100%;
      min-height: auto;
      background: #ffffff;
      padding: ${is58 ? "2.5mm 2mm" : "4.5mm 3.5mm"};
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
      border: 1px solid #e2e8f0;
      border-radius: 2px;
      margin: 0 auto;
    }
    .center { text-align: center; }
    .bold { font-weight: 700; }
    .divider { border-top: 1px dashed #475569; margin: 5px 0; }
    .double-divider { border-top: 2px dashed #0f172a; margin: 6px 0; }
    .flex-between { display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <div class="thermal-paper">
    <div class="center bold" style="font-size: ${is58 ? "13px" : "15px"};">${data.store_name}</div>
    ${data.store_address ? `<div class="center" style="font-size: ${is58 ? "8.5px" : "9.5px"}; color: #334155;">${data.store_address}</div>` : ""}
    ${data.store_phone ? `<div class="center" style="font-size: ${is58 ? "8.5px" : "9.5px"};">Tel: ${data.store_phone}</div>` : ""}
    ${showLicenses && data.store_gstin ? `<div class="center" style="font-size: 8.5px;">GSTIN: ${data.store_gstin}</div>` : ""}
    ${showLicenses && data.drug_license_numbers?.length ? `<div class="center" style="font-size: 8px;">DL: ${data.drug_license_numbers.join(", ")}</div>` : ""}

    <div class="divider"></div>
    <div class="center bold" style="font-size: ${is58 ? "10px" : "11px"}; letter-spacing: 0.5px;">*** CREDIT NOTE ***</div>
    <div class="center" style="font-size: 8.5px; color: #475569;">(SALES RETURN / GST CREDIT NOTE)</div>
    ${copyMarker ? `<div class="center bold" style="font-size: 8.5px; color: #475569; margin-top: 2px;">[ ${copyMarker} ]</div>` : ""}
    <div class="divider"></div>

    <div class="flex-between"><span>Note #:</span><span class="bold">#${data.return_number}</span></div>
    <div class="flex-between"><span>Date:</span><span>${data.return_date}</span></div>
    ${data.original_invoice_number ? `<div class="flex-between"><span>Orig Inv:</span><span>#${data.original_invoice_number}${data.original_invoice_date ? ` (${data.original_invoice_date})` : ""}</span></div>` : ""}
    ${data.customer_debit_note_number ? `<div class="flex-between"><span>Cust Ref:</span><span>${data.customer_debit_note_number}</span></div>` : ""}
    <div class="flex-between"><span>Customer:</span><span class="bold">${data.customer_name || "Walk-in Customer"}</span></div>
    ${data.customer_phone ? `<div class="flex-between"><span>Mobile:</span><span>${data.customer_phone}</span></div>` : ""}
    ${data.customer_gstin ? `<div class="flex-between"><span>Cust GSTIN:</span><span>${data.customer_gstin}</span></div>` : ""}

    <div class="divider"></div>
    <div style="font-weight: 700; font-size: ${is58 ? "9px" : "10px"}; text-transform: uppercase; margin-bottom: 4px;">Returned Items (${data.lines.length})</div>

    ${linesHtml}

    <div class="divider"></div>

    <div class="flex-between"><span>Taxable Reversal:</span><span>${curr}${data.subtotal.toFixed(2)}</span></div>
    <div class="flex-between"><span>CGST Reversal:</span><span>${curr}${cgstTotal.toFixed(2)}</span></div>
    <div class="flex-between"><span>SGST Reversal:</span><span>${curr}${sgstTotal.toFixed(2)}</span></div>
    ${data.round_off ? `<div class="flex-between"><span>Round Off:</span><span>${data.round_off > 0 ? "+" : ""}${curr}${data.round_off.toFixed(2)}</span></div>` : ""}
    
    <div class="double-divider"></div>
    <div class="flex-between" style="font-size: ${is58 ? "12px" : "13px"}; font-weight: 700; margin: 3px 0;">
      <span>TOTAL REFUND:</span>
      <span>${curr}${data.grand_total.toFixed(2)}</span>
    </div>
    <div class="double-divider"></div>

    <div class="flex-between" style="font-size: ${is58 ? "8.5px" : "9.5px"}; margin-top: 4px;">
      <span>Refund Mode:</span>
      <span class="bold">${data.refund_mode || "Cash"}</span>
    </div>

    ${data.notes ? `<div style="font-size: 8.5px; color: #475569; margin-top: 4px; border-top: 1px dotted #cbd5e1; padding-top: 2px;">Note: ${data.notes}</div>` : ""}

    <div class="divider"></div>
    <div class="center" style="font-size: ${is58 ? "8px" : "9px"}; color: #475569; line-height: 1.35; margin-top: 6px;">
      Goods returned & verified by Pharmacist<br/>
      For ${data.store_name}<br/>
      Authorised Signatory<br/>
      <span style="font-size: 7.5px; color: #94a3b8;">Powered by LamSuite Retail</span>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Generates compact thermal receipt slip for Debit Notes / Purchase Returns (58mm and 80mm supported)
   */
  generateDebitNoteThermalSlip(
    data: DebitNotePrintData,
    widthMm: 80 | 58 = 80,
    options?: PrintRenderOptions
  ): string {
    const is58 = widthMm === 58;
    const showLicenses = options?.showDrugLicenses !== false;
    const copyMarker = options?.copyMarker;
    const curr = options?.currencySymbolFormat === "rs_text" ? "Rs. " : "₹";

    const isInterState = data.igst_total !== undefined && data.igst_total > 0;
    const cgstTotal = data.cgst_total !== undefined ? data.cgst_total : round2(data.tax_total / 2);
    const sgstTotal = data.sgst_total !== undefined ? data.sgst_total : round2(data.tax_total / 2);
    const igstTotal = data.igst_total !== undefined ? data.igst_total : (isInterState ? data.tax_total : 0);
    const cessTotal = data.cess_total !== undefined ? data.cess_total : 0;

    const linesHtml = data.lines
      .map((l, i) => {
        if (is58) {
          return `
          <div style="margin-bottom: 4px; border-bottom: 1px dotted #cbd5e1; padding-bottom: 3px;">
            <div style="font-weight: 700; word-break: break-word;">${i + 1}. ${l.description}</div>
            <div style="display: flex; justify-content: space-between; font-size: 9px; color: #334155; margin-top: 1px;">
              <span>${l.qty} × ${curr}${l.rate.toFixed(2)}${l.gst_percent ? ` (${l.gst_percent}%)` : ""}</span>
              <span style="font-weight: 700; color: #000; font-variant-numeric: tabular-nums;">${curr}${l.amount.toFixed(2)}</span>
            </div>
            ${(l.batch_no || l.expiry_date) ? `<div style="font-size: 8px; color: #64748b;">${l.batch_no ? `B: ${l.batch_no}` : ""}${l.batch_no && l.expiry_date ? " " : ""}${l.expiry_date ? `Exp: ${l.expiry_date}` : ""}</div>` : ""}
            ${l.reason ? `<div style="font-size: 8px; color: #2563eb;">Reason: ${l.reason}</div>` : ""}
          </div>`;
        }
        return `
        <div style="margin-bottom: 5px; border-bottom: 1px dotted #cbd5e1; padding-bottom: 3px;">
          <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 10.5px;">
            <span style="word-break: break-word; max-width: 70%;">${i + 1}. ${l.description}</span>
            <span style="font-variant-numeric: tabular-nums;">${curr}${l.amount.toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 9.5px; color: #475569; margin-top: 1px;">
            <span>${l.batch_no ? `B: ${l.batch_no}` : ""}${l.expiry_date ? ` | Exp: ${l.expiry_date}` : ""}${l.hsn_code ? ` | HSN: ${l.hsn_code}` : ""}${l.reason ? ` | ${l.reason}` : ""}</span>
            <span style="font-variant-numeric: tabular-nums;">${l.qty} @ ${curr}${l.rate.toFixed(2)}${l.gst_percent ? ` (${l.gst_percent}%)` : ""}</span>
          </div>
        </div>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Debit Note - ${data.return_number}</title>
  <style>
    @media print {
      @page { size: ${widthMm}mm auto; margin: 0; }
      html, body { margin: 0 !important; padding: 0 !important; width: ${widthMm}mm !important; background: #fff !important; }
      .thermal-paper { box-shadow: none !important; border: none !important; width: ${widthMm}mm !important; padding: ${is58 ? "2mm 1.5mm" : "3mm 2.5mm"} !important; min-height: auto !important; margin: 0 !important; }
      .no-print { display: none !important; }
    }
    * { box-sizing: border-box; }
    html { margin: 0; padding: 0; }
    body {
      margin: 0;
      padding: ${is58 ? "2px 0" : "8px 0"};
      display: flex;
      justify-content: center;
      background: #f1f5f9;
      font-family: 'Courier New', Courier, monospace, monospace;
      font-size: ${is58 ? "10px" : "11px"};
      line-height: 1.3;
      color: #0f172a;
    }
    .thermal-paper {
      width: ${is58 ? "58mm" : "80mm"};
      max-width: 100%;
      min-height: auto;
      background: #ffffff;
      padding: ${is58 ? "2.5mm 2mm" : "4.5mm 3.5mm"};
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
      border: 1px solid #e2e8f0;
      border-radius: 2px;
      margin: 0 auto;
    }
    .center { text-align: center; }
    .bold { font-weight: 700; }
    .divider { border-top: 1px dashed #475569; margin: 5px 0; }
    .double-divider { border-top: 2px dashed #0f172a; margin: 6px 0; }
    .flex-between { display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <div class="thermal-paper">
    <div class="center bold" style="font-size: ${is58 ? "13px" : "15px"};">${data.store_name}</div>
    ${data.store_address ? `<div class="center" style="font-size: ${is58 ? "8.5px" : "9.5px"}; color: #334155;">${data.store_address}</div>` : ""}
    ${data.store_phone ? `<div class="center" style="font-size: ${is58 ? "8.5px" : "9.5px"};">Tel: ${data.store_phone}</div>` : ""}
    ${showLicenses && data.store_gstin ? `<div class="center" style="font-size: 8.5px;">GSTIN: ${data.store_gstin}</div>` : ""}

    <div class="divider"></div>
    <div class="center bold" style="font-size: ${is58 ? "10px" : "11px"}; letter-spacing: 0.5px;">*** DEBIT NOTE ***</div>
    <div class="center" style="font-size: 8.5px; color: #475569;">(PURCHASE RETURN / DEBIT NOTE)</div>
    ${copyMarker ? `<div class="center bold" style="font-size: 8.5px; color: #475569; margin-top: 2px;">[ ${copyMarker} ]</div>` : ""}
    <div class="divider"></div>

    <div class="flex-between"><span>Debit Note #:</span><span class="bold">#${data.return_number}</span></div>
    <div class="flex-between"><span>Date:</span><span>${data.return_date}</span></div>
    ${data.original_purchase_number ? `<div class="flex-between"><span>Orig PO/Bill:</span><span>#${data.original_purchase_number}</span></div>` : ""}
    ${data.supplier_invoice_no ? `<div class="flex-between"><span>Supplier Inv:</span><span>#${data.supplier_invoice_no}</span></div>` : ""}
    <div class="flex-between"><span>Supplier:</span><span class="bold">${data.supplier_name}</span></div>
    ${data.supplier_phone ? `<div class="flex-between"><span>Mobile:</span><span>${data.supplier_phone}</span></div>` : ""}
    ${data.supplier_gstin ? `<div class="flex-between"><span>Supp GSTIN:</span><span>${data.supplier_gstin}</span></div>` : ""}

    <div class="divider"></div>
    <div style="font-weight: 700; font-size: ${is58 ? "9px" : "10px"}; text-transform: uppercase; margin-bottom: 4px;">Returned Items (${data.lines.length})</div>

    ${linesHtml}

    <div class="divider"></div>

    <div class="flex-between"><span>Taxable Reversal:</span><span>${curr}${data.subtotal.toFixed(2)}</span></div>
    <div class="flex-between"><span>CGST Reversal:</span><span>${curr}${cgstTotal.toFixed(2)}</span></div>
    <div class="flex-between"><span>SGST Reversal:</span><span>${curr}${sgstTotal.toFixed(2)}</span></div>
    ${data.round_off ? `<div class="flex-between"><span>Round Off:</span><span>${data.round_off > 0 ? "+" : ""}${curr}${data.round_off.toFixed(2)}</span></div>` : ""}
    
    <div class="double-divider"></div>
    <div class="flex-between" style="font-size: ${is58 ? "12px" : "13px"}; font-weight: 700; margin: 3px 0;">
      <span>TOTAL DEBIT:</span>
      <span>${curr}${data.grand_total.toFixed(2)}</span>
    </div>
    <div class="double-divider"></div>

    <div class="flex-between" style="font-size: ${is58 ? "8.5px" : "9.5px"}; margin-top: 4px;">
      <span>Settlement:</span>
      <span class="bold">${data.settlement_type || "Adjust in Ledger"}</span>
    </div>

    ${data.notes ? `<div style="font-size: 8.5px; color: #475569; margin-top: 4px; border-top: 1px dotted #cbd5e1; padding-top: 2px;">Note: ${data.notes}</div>` : ""}

    <div class="divider"></div>
    <div class="center" style="font-size: ${is58 ? "8px" : "9px"}; color: #475569; line-height: 1.35; margin-top: 6px;">
      Goods returned to supplier as per GST rules<br/>
      For ${data.store_name}<br/>
      Authorised Signatory<br/>
      <span style="font-size: 7.5px; color: #94a3b8;">Powered by LamSuite Retail</span>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Generates vector PDF for Credit Notes using embedded Roboto font
   */
  generateCreditNotePdf(data: CreditNotePrintData): Uint8Array {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    doc.addFileToVFS("Roboto-Regular.ttf", ROBOTO_REGULAR_BASE64);
    doc.addFont("Roboto-Regular.ttf", "Roboto", "normal");
    doc.addFileToVFS("Roboto-Bold.ttf", ROBOTO_BOLD_BASE64);
    doc.addFont("Roboto-Bold.ttf", "Roboto", "bold");
    doc.setFont("Roboto", "normal");

    const marginX = 12;
    const contentWidth = 186;
    const centerX = 105;

    // Header
    doc.setFont("Roboto", "bold");
    doc.setFontSize(15);
    doc.setTextColor(15, 23, 42);
    doc.text(data.store_name, centerX, 14, { align: "center" });

    doc.setFont("Roboto", "normal");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(`${data.store_address || ""} • Phone: ${data.store_phone || ""}`, centerX, 18.5, { align: "center" });

    doc.setFont("Roboto", "bold");
    doc.setFontSize(11);
    doc.setTextColor(185, 28, 28); // red-700
    doc.text("CREDIT NOTE / SALES RETURN", centerX, 24, { align: "center" });

    // Meta box
    doc.setFillColor(255, 241, 242);
    doc.rect(marginX, 27, contentWidth, 18, "F");
    doc.setDrawColor(252, 165, 165);
    doc.rect(marginX, 27, contentWidth, 18, "S");

    doc.setFont("Roboto", "normal");
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(`Customer: ${data.customer_name}`, marginX + 3, 32);
    doc.text(`Mobile: ${data.customer_phone || "-"}`, marginX + 3, 37);
    doc.text(`Refund Mode: ${data.refund_mode}`, marginX + 3, 42);

    doc.setFont("Roboto", "bold");
    doc.setTextColor(185, 28, 28);
    doc.text(`Credit Note: #${data.return_number}`, marginX + contentWidth - 3, 32, { align: "right" });
    doc.setFont("Roboto", "normal");
    doc.setTextColor(15, 23, 42);
    doc.text(`Date: ${data.return_date}`, marginX + contentWidth - 3, 37, { align: "right" });
    doc.text(
      data.original_invoice_number ? `Original Inv: #${data.original_invoice_number}` : "Standalone Return",
      marginX + contentWidth - 3,
      42,
      { align: "right" }
    );

    // Items table
    const tableBody = data.lines.map((l, idx) => [
      String(idx + 1),
      l.description,
      l.hsn_code || "300490",
      l.batch_no || "-",
      l.expiry_date || "-",
      String(l.qty),
      `₹ ${l.rate.toFixed(2)}`,
      `${l.gst_percent}%`,
      `₹ ${l.amount.toFixed(2)}`,
    ]);

    autoTable(doc, {
      startY: 48,
      margin: { left: marginX, right: marginX },
      head: [["#", "Item Description", "HSN", "Batch", "Exp", "Qty", "Rate", "GST %", "Total (₹)"]],
      body: tableBody,
      theme: "plain",
      styles: { font: "Roboto", fontSize: 7.5, cellPadding: 2, textColor: [30, 41, 59] },
      headStyles: { font: "Roboto", fontStyle: "bold", fillColor: [254, 242, 242], textColor: [153, 27, 27] },
      columnStyles: {
        0: { halign: "center", cellWidth: 10 },
        1: { halign: "left" },
        2: { halign: "center", cellWidth: 20 },
        3: { halign: "center", cellWidth: 22 },
        4: { halign: "center", cellWidth: 18 },
        5: { halign: "right", cellWidth: 14, fontStyle: "bold" },
        6: { halign: "right", cellWidth: 20 },
        7: { halign: "right", cellWidth: 16 },
        8: { halign: "right", cellWidth: 24, fontStyle: "bold" },
      },
    });

    let bottomY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 6 : 140;
    if (bottomY + 50 > 280) {
      doc.addPage();
      bottomY = 15;
    }

    // Amount in words
    const amountWords = data.amount_in_words || numberToWordsIndian(data.grand_total);
    doc.setFillColor(248, 250, 252);
    doc.rect(marginX, bottomY, contentWidth, 7, "F");
    doc.setDrawColor(203, 213, 225);
    doc.rect(marginX, bottomY, contentWidth, 7, "S");
    doc.setFont("Roboto", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);
    doc.text(`Refund Amount in Words: ${amountWords}`, marginX + 3, bottomY + 4.8);

    // Totals card on right
    const rowY = bottomY + 10;
    const totalsW = 75;
    const totalsX = marginX + contentWidth - totalsW;
    doc.setFillColor(248, 250, 252);
    doc.rect(totalsX, rowY, totalsW, 30, "F");
    doc.setDrawColor(203, 213, 225);
    doc.rect(totalsX, rowY, totalsW, 30, "S");

    doc.setFont("Roboto", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text("Taxable Reversal:", totalsX + 3, rowY + 6);
    doc.text(`₹ ${data.subtotal.toFixed(2)}`, totalsX + totalsW - 3, rowY + 6, { align: "right" });

    doc.text("GST Reversal:", totalsX + 3, rowY + 12);
    doc.text(`₹ ${data.tax_total.toFixed(2)}`, totalsX + totalsW - 3, rowY + 12, { align: "right" });

    doc.setFont("Roboto", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(185, 28, 28);
    doc.text("Total Refund:", totalsX + 3, rowY + 24);
    doc.text(`₹ ${data.grand_total.toFixed(2)}`, totalsX + totalsW - 3, rowY + 24, { align: "right" });

    // Signatory on left
    const signW = 105;
    doc.setFillColor(255, 255, 255);
    doc.rect(marginX, rowY, signW, 30, "F");
    doc.setDrawColor(226, 232, 240);
    doc.rect(marginX, rowY, signW, 30, "S");

    doc.setFont("Roboto", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text("Credit Note issued against returned goods as per GST rules.", marginX + 3, rowY + 6);
    doc.text(`Refund Mode: ${data.refund_mode}`, marginX + 3, rowY + 11);
    doc.text(`For ${data.store_name}`, marginX + signW - 3, rowY + 18, { align: "right" });
    doc.text("Authorised Signatory / Pharmacist", marginX + signW - 3, rowY + 26, { align: "right" });

    return new Uint8Array(doc.output("arraybuffer"));
  }

  /**
   * Generates Statutory A4 Debit Note HTML for Purchase Returns
   */
  generateDebitNoteA4Html(data: DebitNotePrintData): string {
    const isInterState = data.igst_total !== undefined && data.igst_total > 0;
    const cgstTotal = data.cgst_total !== undefined ? data.cgst_total : round2(data.tax_total / 2);
    const sgstTotal = data.sgst_total !== undefined ? data.sgst_total : round2(data.tax_total / 2);
    const igstTotal = data.igst_total !== undefined ? data.igst_total : (isInterState ? data.tax_total : 0);
    const cessTotal = data.cess_total !== undefined ? data.cess_total : 0;
    const amountWords = data.amount_in_words || numberToWordsIndian(data.grand_total);

    const pageChunks = chunkInvoiceLines(data.lines, 14, 16, 24, 14);
    const totalPages = pageChunks.length;

    let cumulativeIdx = 0;
    const pagesHtml = pageChunks
      .map((chunk, pageIdx) => {
        const pageNum = pageIdx + 1;
        const isFirstPage = pageNum === 1;
        const isLastPage = pageNum === totalPages;
        const startIdx = cumulativeIdx;
        cumulativeIdx += chunk.length;
        const endIdx = cumulativeIdx;

        const itemsRows = chunk
          .map(
            (it, idx) => `
          <tr>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">${startIdx + idx + 1}</td>
            <td style="padding: 4px 6px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
              <div style="font-weight: 700; color: #0f172a;">${it.description}</div>
              ${it.reason ? `<div style="font-size: 8.5px; color: #2563eb;">Reason: ${it.reason}</div>` : ""}
            </td>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">${it.hsn_code || "300490"}</td>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; font-family: monospace;">${it.batch_no || "-"}</td>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">${it.expiry_date || "-"}</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; font-weight: 700;">${it.qty}</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; font-variant-numeric: tabular-nums;">₹ ${it.rate.toFixed(2)}</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">${it.gst_percent}%</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #e2e8f0; font-weight: 700; font-variant-numeric: tabular-nums;">₹ ${it.amount.toFixed(2)}</td>
          </tr>`
          )
          .join("");

        return `
      <div class="a4-sheet">
        ${
          isFirstPage
            ? `
        <div class="header">
          <div class="store-name">${data.store_name}</div>
          <div style="font-size: 10px; color: #475569;">${data.store_address || ""} • Phone: ${data.store_phone || ""}</div>
          <div style="font-size: 9.5px; font-weight: 700; color: #334155; margin-top: 2px;">
            ${data.store_gstin ? `GSTIN: ${data.store_gstin}` : ""}
          </div>
          <div class="tax-badge">DEBIT NOTE / PURCHASE RETURN</div>
        </div>

        <div class="meta-grid">
          <div class="meta-col">
            <div><strong>To Supplier:</strong> ${data.supplier_name}</div>
            ${data.supplier_gstin ? `<div>GSTIN: ${data.supplier_gstin}</div>` : ""}
            <div>Settlement: <strong>${data.settlement_type === "credit_adjust" ? "Adjust against Payable" : "Refund Received"}</strong></div>
          </div>
          <div class="meta-col" style="text-align: right;">
            <div style="font-size: 12px; font-weight: 800; color: #1e3a8a;">#${data.return_number}</div>
            <div>Return Date: ${data.return_date}</div>
            ${data.original_purchase_number ? `<div>Purchase Ref: <strong>#${data.original_purchase_number}</strong></div>` : ""}
            ${data.supplier_invoice_no ? `<div>Supplier Bill #: ${data.supplier_invoice_no}</div>` : ""}
          </div>
        </div>
        `
            : `
        <div class="running-header">
          <div>
            <span class="running-store">${data.store_name}</span>
            <span class="running-inv">Debit Note #${data.return_number}</span>
            <span class="running-date">Date: ${data.return_date}</span>
          </div>
          <div class="running-page">Page ${pageNum} of ${totalPages}</div>
        </div>
        `
        }

        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 28px; text-align: center; border-right: 1px solid #bbf7d0;">#</th>
              <th style="text-align: left; border-right: 1px solid #bbf7d0;">Returned Item Description</th>
              <th style="width: 60px; text-align: center; border-right: 1px solid #bbf7d0;">HSN</th>
              <th style="width: 65px; text-align: center; border-right: 1px solid #bbf7d0;">Batch</th>
              <th style="width: 55px; text-align: center; border-right: 1px solid #bbf7d0;">Exp</th>
              <th style="width: 45px; text-align: right; border-right: 1px solid #bbf7d0;">Qty</th>
              <th style="width: 75px; text-align: right; border-right: 1px solid #bbf7d0;">Purchase Rate (₹)</th>
              <th style="width: 55px; text-align: right; border-right: 1px solid #bbf7d0;">GST %</th>
              <th style="width: 85px; text-align: right;">Reversal (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>

        ${
          !isLastPage
            ? `
        <div class="continuation-bar">
          <div>Showing items ${startIdx + 1} to ${endIdx} of ${data.lines.length} Total Returned Items</div>
          <div class="continuation-link">Continued on Page ${pageNum + 1} &rarr;</div>
        </div>
        `
            : ""
        }

        ${
          isLastPage
            ? `
        <div class="footer-container">
          <div class="amount-words-bar">
            <span style="color: #64748b; font-weight: 600;">Reversal Amount in Words:</span> ${amountWords}
          </div>

          <div class="footer-grid">
            <div style="border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; font-size: 9px; color: #64748b;">
              <div style="font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;">Input GST Reversal & Settlement:</div>
              <div>1. Debit Note issued to supplier for return of goods as per GST statutory provisions.</div>
              <div>2. Input Tax Credit (ITC) reversed accordingly.</div>
              ${data.notes ? `<div style="margin-top: 6px; color: #0f172a; font-weight: 600;">Remarks: ${data.notes}</div>` : ""}
              <div style="margin-top: 12px; font-size: 8.5px; color: #94a3b8;">Computer Generated Debit Note • LamSuite POS</div>
            </div>

            <div class="totals-card">
              <div class="total-line"><span>Taxable Purchase Value:</span><span style="font-weight: 600;">₹ ${data.subtotal.toFixed(2)}</span></div>
              <div class="total-line"><span>CGST Reversal:</span><span style="font-weight: 600;">₹ ${cgstTotal.toFixed(2)}</span></div>
              <div class="total-line"><span>SGST Reversal:</span><span style="font-weight: 600;">₹ ${sgstTotal.toFixed(2)}</span></div>
              <div class="total-line"><span>Total Input GST Reversed:</span><span style="font-weight: 600;">₹ ${data.tax_total.toFixed(2)}</span></div>
              ${data.round_off ? `<div class="total-line"><span>Round Off:</span><span style="font-weight: 600;">${data.round_off > 0 ? "+" : ""}₹ ${data.round_off.toFixed(2)}</span></div>` : ""}
              <div class="grand-total-line"><span>Total Debit Amount:</span><span>₹ ${data.grand_total.toFixed(2)}</span></div>
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; margin-top: 12px;">
            <div class="sign-card" style="width: 250px;">
              <div style="font-size: 10px; font-weight: 700; color: #1e293b;">For ${data.store_name}</div>
              <div style="min-height: 20px;"></div>
              <div style="font-size: 8.5px; font-weight: 600; color: #475569; border-top: 1px solid #94a3b8; padding-top: 2px;">
                Authorised Signatory
              </div>
            </div>
          </div>
        </div>
        `
            : ""
        }

        <div class="spacer-fill"></div>
        <div class="page-footer">
          <div>Computer Generated Debit Note • ${data.store_name}</div>
          <div class="page-num">Page ${pageNum} of ${totalPages}</div>
        </div>
      </div>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Debit Note - ${data.return_number}</title>
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 10px; line-height: 1.35; color: #1e293b; margin: 0; padding: 24px 16px; background: #cbd5e1; font-variant-numeric: tabular-nums; display: flex; flex-direction: column; align-items: center; gap: 24px; min-height: 100vh; }
    .a4-sheet { width: 210mm; max-width: 210mm; min-height: 297mm; flex-shrink: 0; background: #ffffff; box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.15), 0 0 1px rgba(0, 0, 0, 0.2); border: 1px solid #cbd5e1; border-radius: 2px; padding: 12mm 14mm; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; position: relative; }
    @media print {
      body { background: white !important; padding: 0 !important; margin: 0 !important; display: block !important; }
      .a4-sheet { box-shadow: none !important; border: none !important; margin: 0 !important; padding: 8mm !important; width: 100% !important; min-height: auto !important; page-break-after: always !important; break-after: page !important; }
      .a4-sheet:last-child { page-break-after: auto !important; break-after: auto !important; }
    }
    .header { text-align: center; border-bottom: 2px solid #1e3a8a; padding-bottom: 6px; margin-bottom: 10px; }
    .store-name { font-size: 18px; font-weight: 800; color: #0f172a; }
    .tax-badge { font-size: 12px; font-weight: 800; letter-spacing: 0.5px; color: #1e3a8a; margin-top: 5px; }
    .running-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5px solid #1e3a8a; padding-bottom: 6px; margin-bottom: 8px; font-size: 9.5px; }
    .running-store { font-weight: 800; color: #0f172a; font-size: 11px; }
    .running-inv { color: #1e3a8a; font-weight: 700; margin-left: 8px; }
    .running-date { color: #64748b; margin-left: 8px; }
    .running-page { font-weight: 700; color: #475569; }
    .meta-grid { display: flex; justify-content: space-between; border: 1px solid #93c5fd; border-radius: 5px; background: #eff6ff; padding: 7px 10px; margin-bottom: 10px; }
    .meta-col { width: 48%; }
    table.data-table { width: 100%; border-collapse: collapse; font-size: 9.5px; margin-bottom: 8px; border: 1px solid #93c5fd; }
    table.data-table th { background: #f0fdf4; color: #166534; font-weight: 700; padding: 5px 6px; border-top: 1px solid #bbf7d0; border-bottom: 2px solid #86efac; }
    .continuation-bar { display: flex; justify-content: space-between; align-items: center; background: #eff6ff; border: 1px dashed #93c5fd; border-radius: 4px; padding: 5px 10px; margin-top: 6px; font-size: 9px; color: #1e3a8a; }
    .continuation-link { font-weight: 700; color: #1e3a8a; }
    .footer-container { margin-top: 10px; page-break-inside: avoid; }
    .amount-words-bar { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 5px 9px; font-size: 9.5px; font-weight: 700; color: #1e293b; margin-bottom: 8px; }
    .footer-grid { display: grid; grid-template-columns: 1fr 310px; gap: 8px 14px; align-items: stretch; }
    .totals-card { border: 1px solid #cbd5e1; border-radius: 5px; background: #f8fafc; padding: 7px 12px; font-variant-numeric: tabular-nums; }
    .total-line { display: flex; justify-content: space-between; padding: 2px 0; font-size: 10px; color: #475569; }
    .grand-total-line { display: flex; justify-content: space-between; padding-top: 5px; margin-top: 5px; border-top: 2px solid #1e3a8a; font-size: 12.5px; font-weight: 800; color: #1e3a8a; }
    .sign-card { border: 1px solid #cbd5e1; border-radius: 5px; background: #f8fafc; padding: 7px 12px; text-align: center; display: flex; flex-direction: column; justify-content: space-between; min-height: 65px; }
    .spacer-fill { flex-grow: 1; min-height: 6px; }
    .page-footer { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #e2e8f0; padding-top: 6px; margin-top: 8px; font-size: 8.5px; color: #64748b; }
    .page-num { font-weight: 700; color: #334155; }
  </style>
</head>
<body>
  ${pagesHtml}
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
   * Generates vector PDF for Debit Notes using embedded Roboto font
   */
  generateDebitNotePdf(data: DebitNotePrintData): Uint8Array {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    doc.addFileToVFS("Roboto-Regular.ttf", ROBOTO_REGULAR_BASE64);
    doc.addFont("Roboto-Regular.ttf", "Roboto", "normal");
    doc.addFileToVFS("Roboto-Bold.ttf", ROBOTO_BOLD_BASE64);
    doc.addFont("Roboto-Bold.ttf", "Roboto", "bold");
    doc.setFont("Roboto", "normal");

    const marginX = 12;
    const contentWidth = 186;
    const centerX = 105;

    // Header
    doc.setFont("Roboto", "bold");
    doc.setFontSize(15);
    doc.setTextColor(15, 23, 42);
    doc.text(data.store_name, centerX, 14, { align: "center" });

    doc.setFont("Roboto", "normal");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(`${data.store_address || ""} • Phone: ${data.store_phone || ""}`, centerX, 18.5, { align: "center" });

    doc.setFont("Roboto", "bold");
    doc.setFontSize(11);
    doc.setTextColor(30, 58, 138); // blue-900
    doc.text("DEBIT NOTE / PURCHASE RETURN", centerX, 24, { align: "center" });

    // Meta box
    doc.setFillColor(239, 246, 255);
    doc.rect(marginX, 27, contentWidth, 18, "F");
    doc.setDrawColor(147, 197, 253);
    doc.rect(marginX, 27, contentWidth, 18, "S");

    doc.setFont("Roboto", "normal");
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(`Supplier: ${data.supplier_name}`, marginX + 3, 32);
    doc.text(`GSTIN: ${data.supplier_gstin || "-"}`, marginX + 3, 37);
    doc.text(`Settlement: ${data.settlement_type === "credit_adjust" ? "Adjust against Payable" : "Refund Received"}`, marginX + 3, 42);

    doc.setFont("Roboto", "bold");
    doc.setTextColor(30, 58, 138);
    doc.text(`Debit Note: #${data.return_number}`, marginX + contentWidth - 3, 32, { align: "right" });
    doc.setFont("Roboto", "normal");
    doc.setTextColor(15, 23, 42);
    doc.text(`Date: ${data.return_date}`, marginX + contentWidth - 3, 37, { align: "right" });
    doc.text(
      data.original_purchase_number ? `Purchase Bill: #${data.original_purchase_number}` : "Standalone Return",
      marginX + contentWidth - 3,
      42,
      { align: "right" }
    );

    // Items table
    const tableBody = data.lines.map((l, idx) => [
      String(idx + 1),
      l.description,
      l.hsn_code || "300490",
      l.batch_no || "-",
      l.expiry_date || "-",
      String(l.qty),
      `₹ ${l.rate.toFixed(2)}`,
      `${l.gst_percent}%`,
      `₹ ${l.amount.toFixed(2)}`,
    ]);

    autoTable(doc, {
      startY: 48,
      margin: { left: marginX, right: marginX },
      head: [["#", "Item Description", "HSN", "Batch", "Exp", "Qty", "Purchase Rate", "GST %", "Total (₹)"]],
      body: tableBody,
      theme: "plain",
      styles: { font: "Roboto", fontSize: 7.5, cellPadding: 2, textColor: [30, 41, 59] },
      headStyles: { font: "Roboto", fontStyle: "bold", fillColor: [239, 246, 255], textColor: [30, 58, 138] },
      columnStyles: {
        0: { halign: "center", cellWidth: 10 },
        1: { halign: "left" },
        2: { halign: "center", cellWidth: 20 },
        3: { halign: "center", cellWidth: 22 },
        4: { halign: "center", cellWidth: 18 },
        5: { halign: "right", cellWidth: 14, fontStyle: "bold" },
        6: { halign: "right", cellWidth: 22 },
        7: { halign: "right", cellWidth: 16 },
        8: { halign: "right", cellWidth: 24, fontStyle: "bold" },
      },
    });

    let bottomY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 6 : 140;
    if (bottomY + 50 > 280) {
      doc.addPage();
      bottomY = 15;
    }

    // Amount in words
    const amountWords = data.amount_in_words || numberToWordsIndian(data.grand_total);
    doc.setFillColor(248, 250, 252);
    doc.rect(marginX, bottomY, contentWidth, 7, "F");
    doc.setDrawColor(203, 213, 225);
    doc.rect(marginX, bottomY, contentWidth, 7, "S");
    doc.setFont("Roboto", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);
    doc.text(`Debit Amount in Words: ${amountWords}`, marginX + 3, bottomY + 4.8);

    // Totals card on right
    const rowY = bottomY + 10;
    const totalsW = 75;
    const totalsX = marginX + contentWidth - totalsW;
    doc.setFillColor(248, 250, 252);
    doc.rect(totalsX, rowY, totalsW, 30, "F");
    doc.setDrawColor(203, 213, 225);
    doc.rect(totalsX, rowY, totalsW, 30, "S");

    doc.setFont("Roboto", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text("Taxable Value:", totalsX + 3, rowY + 6);
    doc.text(`₹ ${data.subtotal.toFixed(2)}`, totalsX + totalsW - 3, rowY + 6, { align: "right" });

    doc.text("Input GST Reversal:", totalsX + 3, rowY + 12);
    doc.text(`₹ ${data.tax_total.toFixed(2)}`, totalsX + totalsW - 3, rowY + 12, { align: "right" });

    doc.setFont("Roboto", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(30, 58, 138);
    doc.text("Total Debit:", totalsX + 3, rowY + 24);
    doc.text(`₹ ${data.grand_total.toFixed(2)}`, totalsX + totalsW - 3, rowY + 24, { align: "right" });

    // Signatory on left
    const signW = 105;
    doc.setFillColor(255, 255, 255);
    doc.rect(marginX, rowY, signW, 30, "F");
    doc.setDrawColor(226, 232, 240);
    doc.rect(marginX, rowY, signW, 30, "S");

    doc.setFont("Roboto", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text("Debit Note issued to supplier for return of goods under GST rules.", marginX + 3, rowY + 6);
    doc.text(`Settlement: ${data.settlement_type === "credit_adjust" ? "Adjust against Payable" : "Refund Received"}`, marginX + 3, rowY + 11);
    doc.text(`For ${data.store_name}`, marginX + signW - 3, rowY + 18, { align: "right" });
    doc.text("Authorised Signatory", marginX + signW - 3, rowY + 26, { align: "right" });

    return new Uint8Array(doc.output("arraybuffer"));
  }

  /**
   * Inward Purchase Bill A4 HTML generator
   */
  generatePurchaseBillA4Html(data: any, options?: PrintRenderOptions): string {
    const items = data.items || data.lines || [];
    const pageChunks = chunkInvoiceLines(items, 16, 18, 26, 16);
    const totalPages = pageChunks.length;

    let cumulativeIdx = 0;
    const pagesHtml = pageChunks
      .map((chunk: any[], pageIdx: number) => {
        const pageNum = pageIdx + 1;
        const isFirstPage = pageNum === 1;
        const isLastPage = pageNum === totalPages;
        const startIdx = cumulativeIdx;
        cumulativeIdx += chunk.length;
        const endIdx = cumulativeIdx;

        const itemsHtml = chunk
          .map(
            (it: any, idx: number) => `
          <tr>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">${startIdx + idx + 1}</td>
            <td style="padding: 4px 6px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
              <div style="font-weight: 700;">${it.item_name || it.description || "Product"}</div>
            </td>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; font-family: monospace;">${it.batch_no || "-"}</td>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">${it.expiry_date || "-"}</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; font-weight: 700;">${it.qty || 0}</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">₹ ${(it.ptr || it.rate || 0).toFixed(2)}</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">${it.discount_percent || it.disc_percent || 0}%</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">${it.gst_percent || 0}%</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #e2e8f0; font-weight: 700;">₹ ${(it.net_amount || it.amount || 0).toFixed(2)}</td>
          </tr>`
          )
          .join("");

        return `
      <div class="a4-sheet">
        ${
          isFirstPage
            ? `
        <div class="header">
          <div class="title">${data.store_name || "LamStone Pharmacy"}</div>
          <div class="badge">PURCHASE INWARD VOUCHER (GRN)</div>
        </div>
        <div class="meta-box">
          <div>
            <div><strong>Supplier:</strong> ${data.supplier_name || "Distributor"}</div>
            ${data.supplier_gstin ? `<div>GSTIN: ${data.supplier_gstin}</div>` : ""}
            <div>Supplier Bill No: <strong>${data.supplier_invoice_number || data.supplier_invoice_no || "-"}</strong></div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 800; color: #1e3a8a;">GRN #${data.purchase_number || data.id}</div>
            <div>Date: ${data.purchase_date || data.bill_date || new Date().toISOString().split("T")[0]}</div>
            <div>Payment Status: <strong>${data.payment_status || "Credit"}</strong></div>
          </div>
        </div>
        `
            : `
        <div class="running-header">
          <div>
            <span class="running-store">${data.store_name || "LamStone Pharmacy"}</span>
            <span class="running-inv">GRN #${data.purchase_number || data.id}</span>
            <span class="running-date">Supplier: ${data.supplier_name || "Distributor"}</span>
          </div>
          <div class="running-page">Page ${pageNum} of ${totalPages}</div>
        </div>
        `
        }

        <table>
          <thead>
            <tr>
              <th style="width: 28px; text-align: center; border-right: 1px solid #cbd5e1;">#</th>
              <th style="text-align: left; border-right: 1px solid #cbd5e1;">Product Description</th>
              <th style="width: 65px; text-align: center; border-right: 1px solid #cbd5e1;">Batch</th>
              <th style="width: 55px; text-align: center; border-right: 1px solid #cbd5e1;">Exp</th>
              <th style="width: 45px; text-align: right; border-right: 1px solid #cbd5e1;">Qty</th>
              <th style="width: 65px; text-align: right; border-right: 1px solid #cbd5e1;">PTR (₹)</th>
              <th style="width: 50px; text-align: right; border-right: 1px solid #cbd5e1;">Disc%</th>
              <th style="width: 50px; text-align: right; border-right: 1px solid #cbd5e1;">GST%</th>
              <th style="width: 80px; text-align: right;">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        ${
          !isLastPage
            ? `
        <div class="continuation-bar">
          <div>Showing items ${startIdx + 1} to ${endIdx} of ${items.length} Total Items</div>
          <div class="continuation-link">Continued on Page ${pageNum + 1} &rarr;</div>
        </div>
        `
            : ""
        }

        ${
          isLastPage
            ? `
        <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
          <div style="width: 240px; border: 1px solid #cbd5e1; border-radius: 4px; background: #f8fafc; padding: 6px 10px;">
            <div style="display: flex; justify-content: space-between;"><span>Taxable Subtotal:</span><span>₹ ${(data.subtotal || 0).toFixed(2)}</span></div>
            <div style="display: flex; justify-content: space-between;"><span>Input GST Total:</span><span>₹ ${(data.tax_total || data.gst_total || 0).toFixed(2)}</span></div>
            <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: 12px; color: #1e3a8a; border-top: 1.5px solid #0f172a; margin-top: 4px; padding-top: 4px;">
              <span>Total Purchase:</span><span>₹ ${(data.grand_total || data.total_amount || 0).toFixed(2)}</span>
            </div>
          </div>
        </div>
        `
            : ""
        }

        <div class="spacer-fill"></div>
        <div class="page-footer">
          <div>Goods Received Note • ${data.store_name || "LamStone Pharmacy"}</div>
          <div class="page-num">Page ${pageNum} of ${totalPages}</div>
        </div>
      </div>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Purchase Inward - ${data.purchase_number || data.bill_number || "PUR"}</title>
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 10px; color: #1e293b; margin: 0; padding: 24px 16px; background: #cbd5e1; display: flex; flex-direction: column; align-items: center; gap: 24px; min-height: 100vh; }
    .a4-sheet { width: 210mm; max-width: 210mm; min-height: 297mm; flex-shrink: 0; background: #ffffff; box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.15), 0 0 1px rgba(0, 0, 0, 0.2); border: 1px solid #cbd5e1; border-radius: 2px; padding: 12mm 14mm; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; position: relative; }
    @media print {
      body { background: white !important; padding: 0 !important; margin: 0 !important; display: block !important; }
      .a4-sheet { box-shadow: none !important; border: none !important; margin: 0 !important; padding: 8mm !important; width: 100% !important; min-height: auto !important; page-break-after: always !important; break-after: page !important; }
      .a4-sheet:last-child { page-break-after: auto !important; break-after: auto !important; }
    }
    .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 10px; }
    .title { font-size: 16px; font-weight: 800; color: #0f172a; }
    .badge { font-size: 11px; font-weight: 800; color: #1e3a8a; margin-top: 4px; }
    .running-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5px solid #0f172a; padding-bottom: 6px; margin-bottom: 8px; font-size: 9.5px; }
    .running-store { font-weight: 800; color: #0f172a; font-size: 11px; }
    .running-inv { color: #1e3a8a; font-weight: 700; margin-left: 8px; }
    .running-date { color: #64748b; margin-left: 8px; }
    .running-page { font-weight: 700; color: #475569; }
    .meta-box { display: flex; justify-content: space-between; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 5px; padding: 7px 10px; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 9.5px; margin-bottom: 8px; border: 1px solid #cbd5e1; }
    th { background: #f1f5f9; padding: 5px 6px; border-top: 1px solid #cbd5e1; border-bottom: 1.5px solid #94a3b8; font-weight: 700; color: #0f172a; }
    .continuation-bar { display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px dashed #94a3b8; border-radius: 4px; padding: 5px 10px; margin-top: 6px; font-size: 9px; color: #475569; }
    .continuation-link { font-weight: 700; color: #1d4ed8; }
    .spacer-fill { flex-grow: 1; min-height: 6px; }
    .page-footer { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #e2e8f0; padding-top: 6px; margin-top: 8px; font-size: 8.5px; color: #64748b; }
    .page-num { font-weight: 700; color: #334155; }
  </style>
</head>
<body>
  ${pagesHtml}
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
   * Barcode Labels Sheet HTML generator
   */
  generateBarcodeLabelsHtml(data: any, options?: PrintRenderOptions): string {
    const labels = data.labels || data.items || [];
    const copies = options?.copies || 1;
    const labelCards: string[] = [];

    for (let c = 0; c < copies; c++) {
      for (const item of labels) {
        labelCards.push(`
        <div style="border: 1px dashed #94a3b8; border-radius: 4px; padding: 6px; text-align: center; font-size: 9px; page-break-inside: avoid; background: #fff;">
          <div style="font-weight: 800; font-size: 10px; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.item_name || item.name || "Item"}</div>
          <div style="font-family: monospace; font-size: 8px; color: #475569;">B: ${item.batch_no || "-"} | Exp: ${item.expiry_date || "-"}</div>
          <div style="font-size: 14px; font-weight: 800; color: #1d4ed8; margin: 3px 0;">₹ ${(item.mrp || item.rate || 0).toFixed(2)}</div>
          <div style="font-family: monospace; font-size: 8.5px; letter-spacing: 1px; color: #0f172a;">*${item.barcode || item.code || "ITEM"}*</div>
        </div>`);
      }
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Barcode Labels</title>
  <style>
    @media print { body { margin: 0; padding: 5mm; } @page { size: A4 portrait; margin: 5mm; } }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 12px; background: #f8fafc; }
    .label-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  </style>
</head>
<body>
  <div class="label-grid">
    ${labelCards.join("")}
  </div>
</body>
</html>`;
  }

  /**
   * Generic Report printable HTML generator
   */
  generateReportHtml(data: any, options?: PrintRenderOptions): string {
    const columns: Array<{ key: string; label: string; align?: "left" | "center" | "right" }> = data.columns || [];
    const rows: Array<Record<string, any>> = data.rows || [];

    const ths = columns
      .map((c) => `<th style="text-align: ${c.align || "left"}; padding: 5px 6px;">${c.label}</th>`)
      .join("");

    const trs = rows
      .map(
        (r, idx) => `
        <tr>
          <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #e2e8f0;">${idx + 1}</td>
          ${columns
            .map(
              (c) => `
            <td style="padding: 4px 6px; text-align: ${c.align || "left"}; border-bottom: 1px solid #e2e8f0;">
              ${r[c.key] !== undefined ? r[c.key] : "-"}
            </td>`
            )
            .join("")}
        </tr>`
      )
      .join("");

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${data.title || "Report"}</title>
  <style>
    @media print { body { margin: 0; padding: 8mm; } @page { size: A4 ${options?.orientation || "portrait"}; margin: 8mm; } }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 10px; color: #1e293b; margin: 0; padding: 16px; background: #fff; }
    .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 10px; }
    .title { font-size: 16px; font-weight: 800; color: #0f172a; }
    .subtitle { font-size: 10px; color: #475569; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 9px; }
    th { background: #f1f5f9; padding: 5px 6px; border-top: 1px solid #cbd5e1; border-bottom: 1.5px solid #94a3b8; font-weight: 700; color: #0f172a; }
    tr:nth-child(even) { background: #f8fafc; }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">${data.store_name || "LamStone Pharmacy"}</div>
    <div style="font-size: 12px; font-weight: 700; color: #1d4ed8; margin-top: 4px;">${data.title || "Audit Report"}</div>
    <div class="subtitle">${data.subtitle || `Generated on ${new Date().toLocaleString()}`}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width: 25px; text-align: center;">#</th>
        ${ths}
      </tr>
    </thead>
    <tbody>
      ${trs}
    </tbody>
  </table>
</body>
</html>`;
  }

  /**
   * Unified dispatcher to render HTML preview for any document type
   */
  renderDocumentHtml(docType: string, data: any, options?: PrintRenderOptions): string {
    const isDotMatrix = Boolean(options?.paperSize && options.paperSize.startsWith("dot_matrix"));
    if (isDotMatrix) {
      let rawText = "";
      const pSize = options!.paperSize as PaperSize;
      const cols = getDotMatrixColumns(pSize);
      const paperWidth = getPaperWidthFromSize(pSize);
      const dotOpts: DotMatrixOptions = {
        columns: cols,
        paperWidth,
        isDuplicate: options?.isDuplicate,
        copyMarker: options?.copyMarker,
        showHsnSummary: options?.showHsnSummary,
        showDoctorPatient: options?.showDoctorPatient,
        showDrugLicenses: options?.showDrugLicenses,
        showTerms: options?.showTerms,
        currencyPrefix: options?.currencySymbolFormat === "rupee_symbol" ? "Rs." : "Rs.",
      };

      switch (docType) {
        case "sales_return":
        case "credit_note":
        case "customer_debit_note":
          rawText = dotMatrixRenderer.renderCreditNote(data as CreditNotePrintData, dotOpts);
          break;
        case "purchase_return":
        case "debit_note":
          rawText = dotMatrixRenderer.renderDebitNote(data as DebitNotePrintData, dotOpts);
          break;
        default:
          rawText = dotMatrixRenderer.renderInvoice(data as InvoicePrintData, dotOpts);
          break;
      }
      return dotMatrixRenderer.generateMonospaceHtmlPreview(rawText, {
        columns: cols,
        showRuler: true,
        showPageBreaks: true,
      });
    }

    let html = "";
    switch (docType) {
      case "tax_invoice":
      case "invoice":
      case "bill":
        html = this.generateInvoiceHtml(data as InvoicePrintData, options);
        break;

      case "sales_return":
      case "credit_note":
      case "customer_debit_note":
        if (options?.paperSize === "thermal_80mm" || options?.paperSize === "thermal_58mm") {
          html = this.generateCreditNoteThermalSlip(
            data as CreditNotePrintData,
            options.paperSize === "thermal_58mm" ? 58 : 80,
            options
          );
        } else {
          html = this.generateCreditNoteA4Html(data as CreditNotePrintData);
        }
        break;

      case "purchase_return":
      case "debit_note":
        if (options?.paperSize === "thermal_80mm" || options?.paperSize === "thermal_58mm") {
          html = this.generateDebitNoteThermalSlip(
            data as DebitNotePrintData,
            options.paperSize === "thermal_58mm" ? 58 : 80,
            options
          );
        } else {
          html = this.generateDebitNoteA4Html(data as DebitNotePrintData);
        }
        break;

      case "purchase":
      case "purchase_bill":
        html = this.generatePurchaseBillA4Html(data, options);
        break;

      case "barcode":
      case "barcode_labels":
        html = this.generateBarcodeLabelsHtml(data, options);
        break;

      case "report":
        html = this.generateReportHtml(data, options);
        break;

      default:
        html = this.generateInvoiceHtml(data as InvoicePrintData, options);
        break;
    }

    const escapeScript = `<script>
      window.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          window.parent.postMessage({ type: 'MODAL_ESCAPE' }, '*');
        }
      }, true);
    </script>`;

    if (html.includes("</body>")) {
      return html.replace("</body>", `${escapeScript}</body>`);
    }
    return html + escapeScript;
  }

  /**
   * Generates ESC/POS byte sequence for thermal slip printing with cut & cash drawer commands.
   */
  generateEscPosReceiptBytes(data: InvoicePrintData, options?: { paperWidthMm?: 58 | 80; autoCut?: boolean; cashDrawer?: boolean }): Uint8Array {
    const is58 = options?.paperWidthMm === 58;
    const maxCols = is58 ? 32 : 42;
    const bytes: number[] = [];

    const encoder = new TextEncoder();
    const pushStr = (s: string) => {
      const clean = s.replace(/₹/g, "Rs.");
      const encoded = encoder.encode(clean);
      for (let i = 0; i < encoded.length; i++) {
        bytes.push(encoded[i]);
      }
    };

    // ESC @: Initialize printer
    bytes.push(0x1B, 0x40);

    // Optional Cash Drawer Kick (Pin 2: ESC p 0 25 250)
    if (options?.cashDrawer) {
      bytes.push(0x1B, 0x70, 0x00, 0x19, 0xFA);
    }

    // Center Align: ESC a 1
    bytes.push(0x1B, 0x61, 0x01);

    // Double-height Store Name
    bytes.push(0x1B, 0x21, 0x10);
    pushStr(`${data.store_name}\n`);

    // Normal text
    bytes.push(0x1B, 0x21, 0x00);
    if (data.store_address) pushStr(`${data.store_address}\n`);
    if (data.store_phone) pushStr(`Tel: ${data.store_phone}\n`);
    if (data.store_gstin) pushStr(`GSTIN: ${data.store_gstin}\n`);

    const divider = "-".repeat(maxCols);
    pushStr(`${divider}\n`);
    pushStr(`*** TAX INVOICE ***\n`);
    pushStr(`${divider}\n`);

    // Left Align: ESC a 0
    bytes.push(0x1B, 0x61, 0x00);
    pushStr(`Inv No: #${data.invoice_number}\n`);
    pushStr(`Date  : ${data.invoice_date} ${data.invoice_time || ""}\n`);
    pushStr(`Cust  : ${data.customer_name || "Walk-in"}\n`);
    pushStr(`Pay   : ${data.payment_mode || "Cash"} (${data.payment_status || "Paid"})\n`);
    pushStr(`${divider}\n`);

    // Items Header
    if (is58) {
      pushStr(`Item              Qty     Total\n`);
    } else {
      pushStr(`Item Description      Qty   Rate   Total\n`);
    }
    pushStr(`${divider}\n`);

    for (const l of data.lines) {
      const desc = l.description.substring(0, is58 ? 16 : 20).padEnd(is58 ? 16 : 20);
      const qtyStr = `${l.qty}${l.loose_qty ? `+${l.loose_qty}L` : ""}`.padStart(5);
      const amtStr = `Rs.${l.amount.toFixed(2)}`.padStart(is58 ? 9 : 10);
      if (is58) {
        pushStr(`${desc} ${qtyStr} ${amtStr}\n`);
      } else {
        const rateStr = `${l.rate.toFixed(2)}`.padStart(6);
        pushStr(`${desc} ${qtyStr} ${rateStr} ${amtStr}\n`);
      }
    }

    pushStr(`${divider}\n`);
    const totalLabel = "Grand Total:".padEnd(maxCols - 14);
    const totalVal = `Rs.${data.grand_total.toFixed(2)}`.padStart(14);
    bytes.push(0x1B, 0x21, 0x20); // Bold / large total
    pushStr(`${totalLabel}${totalVal}\n`);
    bytes.push(0x1B, 0x21, 0x00);

    pushStr(`${divider}\n`);
    bytes.push(0x1B, 0x61, 0x01); // Center
    pushStr(`Thank you for your visit!\n`);
    if (data.terms_and_conditions) {
      pushStr(`${data.terms_and_conditions.substring(0, maxCols)}\n`);
    }

    pushStr("\n\n\n");

    if (options?.autoCut !== false) {
      bytes.push(0x1D, 0x56, 0x41, 0x03);
    }

    return new Uint8Array(bytes);
  }

  /**
   * Generates formatted fixed-width ASCII draft text for Dot Matrix printers with form feed.
   */
  generateDotMatrixText(data: InvoicePrintData, options?: DotMatrixOptions): string {
    return dotMatrixRenderer.renderInvoice(data, options);
  }

  /**
   * Unified dispatcher to render Vector / Monospace PDF for any document type
   */
  renderDocumentPdf(docType: string, data: any, options?: PrintRenderOptions): Uint8Array {
    const isDotMatrix = Boolean(options?.paperSize && options.paperSize.startsWith("dot_matrix"));
    if (isDotMatrix) {
      const pSize = options!.paperSize as PaperSize;
      const cols = getDotMatrixColumns(pSize);
      const paperWidth = getPaperWidthFromSize(pSize);
      const dotOpts: DotMatrixOptions = {
        columns: cols,
        paperWidth,
        isDuplicate: options?.isDuplicate,
        copyMarker: options?.copyMarker,
        showHsnSummary: options?.showHsnSummary,
        showDoctorPatient: options?.showDoctorPatient,
        showDrugLicenses: options?.showDrugLicenses,
        showTerms: options?.showTerms,
      };

      let text = "";
      switch (docType) {
        case "sales_return":
        case "credit_note":
        case "customer_debit_note":
          text = dotMatrixRenderer.renderCreditNote(data as CreditNotePrintData, dotOpts);
          break;
        case "purchase_return":
        case "debit_note":
          text = dotMatrixRenderer.renderDebitNote(data as DebitNotePrintData, dotOpts);
          break;
        default:
          text = dotMatrixRenderer.renderInvoice(data as InvoicePrintData, dotOpts);
          break;
      }
      return dotMatrixRenderer.generateMonospacePdf(text, dotOpts);
    }

    switch (docType) {
      case "tax_invoice":
      case "invoice":
      case "bill":
        return this.generateInvoicePdf(data as InvoicePrintData);

      case "sales_return":
      case "credit_note":
      case "customer_debit_note":
        return this.generateCreditNotePdf(data as CreditNotePrintData);

      case "purchase_return":
      case "debit_note":
        return this.generateDebitNotePdf(data as DebitNotePrintData);

      default:
        return this.generateInvoicePdf(data as InvoicePrintData);
    }
  }
}

export interface ReturnLinePrintItem {
  description: string;
  hsn_code?: string;
  batch_no?: string;
  expiry_date?: string;
  qty: number;
  rate: number;
  gst_percent: number;
  taxable_amount?: number;
  cgst_amount?: number;
  sgst_amount?: number;
  igst_amount?: number;
  cess_amount?: number;
  amount: number;
  reason?: string;
}

export interface CreditNotePrintData {
  return_number: string;
  return_date: string;
  original_invoice_number?: string;
  original_invoice_date?: string;
  customer_debit_note_number?: string;
  customer_debit_note_date?: string;
  invoice_references?: Array<{ invoice_number: string; invoice_date?: string }>;
  store_name: string;
  store_address?: string;
  store_phone?: string;
  store_gstin?: string;
  drug_license_numbers?: string[];
  customer_name: string;
  customer_phone?: string;
  customer_gstin?: string;
  lines: ReturnLinePrintItem[];
  subtotal: number;
  tax_total: number;
  cgst_total?: number;
  sgst_total?: number;
  igst_total?: number;
  cess_total?: number;
  round_off: number;
  grand_total: number;
  refund_mode: string;
  amount_in_words?: string;
  notes?: string;
}

export interface DebitNotePrintData {
  return_number: string;
  return_date: string;
  original_purchase_number?: string;
  supplier_invoice_no?: string;
  store_name: string;
  store_address?: string;
  store_phone?: string;
  store_gstin?: string;
  supplier_name: string;
  supplier_phone?: string;
  supplier_gstin?: string;
  lines: ReturnLinePrintItem[];
  subtotal: number;
  tax_total: number;
  cgst_total?: number;
  sgst_total?: number;
  igst_total?: number;
  cess_total?: number;
  round_off: number;
  grand_total: number;
  settlement_type: string;
  amount_in_words?: string;
  notes?: string;
}

export const printingEngine = new PrintingEngine();
