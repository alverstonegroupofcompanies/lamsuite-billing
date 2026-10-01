import { getIpcBridge, isTauri, invokeCommand } from "../ipc/ipcBridge";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export interface InvoicePrintData {
  invoice_number: string;
  invoice_date: string;
  store_name: string;
  store_address?: string;
  store_phone?: string;
  store_gstin?: string;
  drug_license_numbers?: string[]; // e.g. ["20B-12345", "21B-67890"]
  fssai_no?: string;
  customer_name?: string;
  customer_phone?: string;
  patient_name?: string;
  patient_age?: string | number;
  patient_gender?: string;
  doctor_name?: string;
  doctor_reg_no?: string;
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
    gst_percent: number;
    amount: number;
  }>;
  subtotal: number;
  tax_total: number;
  round_off: number;
  grand_total: number;
  upi_vpa?: string;
  terms_and_conditions?: string;
  jurisdiction_note?: string;
  footer_note?: string;
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

  async printThermalReceipt(data: InvoicePrintData, printerName?: string): Promise<{ success: boolean; job_id?: string }> {
    const dynamicHeight = generateDynamicSlipHeightMm(data.lines.length, Boolean(data.doctor_name || data.patient_name));

    if (isTauri()) {
      return await invokeCommand<{ success: boolean; job_id?: string }>("print:thermal", {
        data,
        dynamicHeightMm: dynamicHeight,
        printerName: printerName || this.printerProfiles.find((p) => p.isDefault)?.name,
      });
    }

    const bridge = getIpcBridge();
    if (bridge.runtime === "mock") {
      try {
        return await bridge.invoke<{ success: boolean; job_id?: string }>("print:thermal", {
          data,
          dynamicHeightMm: dynamicHeight,
          printerName: printerName || this.printerProfiles.find((p) => p.isDefault)?.name,
        });
      } catch {}
    }

    // In plain browser: open print preview window with thermal receipt formatting
    if (typeof window !== "undefined") {
      try {
        const html = this.generateInvoiceHtml(data);
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
        console.warn("Browser thermal print failed:", e);
      }
    }

    return { success: true, job_id: "thermal_preview_fallback" };
  }

  async printA4TaxInvoice(data: InvoicePrintData, printerName?: string): Promise<{ success: boolean; job_id?: string }> {
    if (isTauri()) {
      return await invokeCommand<{ success: boolean; job_id?: string }>("print:a4", {
        data,
        printerName: printerName || this.printerProfiles.find((p) => p.paperSize === "a4")?.name,
      });
    }

    const bridge = getIpcBridge();
    if (bridge.runtime === "mock") {
      try {
        return await bridge.invoke<{ success: boolean; job_id?: string }>("print:a4", {
          data,
          printerName: printerName || this.printerProfiles.find((p) => p.paperSize === "a4")?.name,
        });
      } catch {}
    }

    // In plain browser: open print preview with statutory A4 tax invoice and trigger native print
    if (typeof window !== "undefined") {
      try {
        const html = this.generateInvoiceHtml(data);
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

    return { success: true, job_id: "preview_fallback" };
  }

  /**
   * Generates a complete, self-contained printable HTML document for A4 Tax Invoice
   */
  generateInvoiceHtml(data: InvoicePrintData): string {
    const linesRows = data.lines
      .map(
        (l, i) => `
        <tr>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: center;">${i + 1}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0;"><strong>${l.description}</strong></td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-family: monospace;">${l.batch_no || "-"}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-family: monospace;">${l.expiry_date || "-"}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${l.qty}${l.loose_qty ? ` + ${l.loose_qty}L` : ""}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: right; font-family: monospace;">₹ ${l.rate.toFixed(2)}</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${l.gst_percent}%</td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: right; font-family: monospace; font-weight: bold;">₹ ${l.amount.toFixed(2)}</td>
        </tr>`
      )
      .join("");

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Tax Invoice - ${data.invoice_number}</title>
  <style>
    @media print {
      body { margin: 0; padding: 12mm; }
      @page { size: A4 portrait; margin: 10mm; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 11px;
      color: #1e293b;
      margin: 0;
      padding: 24px;
      background: #fff;
    }
    .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
    .store-name { font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; }
    .meta-grid { display: flex; justify-content: space-between; margin-bottom: 16px; }
    .meta-box { width: 48%; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { background: #f8fafc; font-weight: 700; text-align: left; padding: 8px; border-bottom: 2px solid #cbd5e1; }
    .totals { width: 280px; margin-left: auto; margin-bottom: 20px; }
    .total-row { display: flex; justify-content: space-between; padding: 3px 0; }
    .grand-total { font-size: 14px; font-weight: 800; border-top: 2px solid #0f172a; padding-top: 6px; color: #1d4ed8; }
    .footer { text-align: center; border-top: 1px dashed #cbd5e1; padding-top: 10px; font-size: 10px; color: #64748b; }
  </style>
</head>
<body>
  <div class="header">
    <div class="store-name">${data.store_name}</div>
    <div>${data.store_address || "Main Road, Palakkad, Kerala - 678001"} • Phone: ${data.store_phone || "9876543210"}</div>
    ${data.store_gstin ? `<div>GSTIN: <strong>${data.store_gstin}</strong></div>` : ""}
    ${data.drug_license_numbers?.length ? `<div>DL No: ${data.drug_license_numbers.join(", ")}</div>` : ""}
  </div>

  <div class="meta-grid">
    <div class="meta-box">
      <div><strong>Billed To:</strong> ${data.customer_name || "Walk-in Customer"}</div>
      ${data.customer_phone ? `<div>Mobile: ${data.customer_phone}</div>` : ""}
      ${data.patient_name ? `<div>Patient: ${data.patient_name} ${data.patient_age ? `(${data.patient_age} yrs)` : ""}</div>` : ""}
      ${data.doctor_name ? `<div>Doctor: ${data.doctor_name} ${data.doctor_reg_no ? `[Reg: ${data.doctor_reg_no}]` : ""}</div>` : ""}
    </div>
    <div class="meta-box" style="text-align: right;">
      <div><strong>TAX INVOICE</strong></div>
      <div style="font-size: 13px; font-weight: 700; color: #1d4ed8;">#${data.invoice_number}</div>
      <div>Date: ${data.invoice_date}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 30px; text-align: center;">#</th>
        <th>Item Description</th>
        <th>Batch</th>
        <th>Exp</th>
        <th style="text-align: right;">Qty</th>
        <th style="text-align: right;">Rate</th>
        <th style="text-align: right;">GST</th>
        <th style="text-align: right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${linesRows}
    </tbody>
  </table>

  <div class="totals">
    <div class="total-row"><span>Taxable Subtotal:</span><span>₹ ${data.subtotal.toFixed(2)}</span></div>
    <div class="total-row"><span>Total GST:</span><span>₹ ${data.tax_total.toFixed(2)}</span></div>
    ${data.round_off ? `<div class="total-row"><span>Round Off:</span><span>${data.round_off > 0 ? "+" : ""}₹ ${data.round_off.toFixed(2)}</span></div>` : ""}
    <div class="total-row grand-total"><span>Grand Total:</span><span>₹ ${data.grand_total.toFixed(2)}</span></div>
  </div>

  <div class="footer">
    <p>${data.terms_and_conditions || "Thank you for your business! Goods once sold cannot be returned without original cash memo."}</p>
    <p>${data.jurisdiction_note || "Subject to local jurisdiction."}</p>
  </div>
</body>
</html>`;
  }

  /**
   * Generates a high-fidelity vector PDF matching the A4 Tax Invoice layout,
   * with automatic multi-page splitting, repeating headers, and totals summary.
   */
  generateInvoicePdf(data: InvoicePrintData): Uint8Array {
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    const pageWidth = 210;
    const marginX = 12;
    const contentWidth = pageWidth - marginX * 2; // 186mm
    const centerX = pageWidth / 2;

    // Header: Pharmacy Name & Contact
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text(data.store_name || "Pharmacy Store", centerX, 15, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105); // slate-600
    const addressLine = `${data.store_address || "Main Road, Palakkad, Kerala - 678001"} • Phone: ${data.store_phone || "9876543210"}`;
    doc.text(addressLine, centerX, 20.5, { align: "center" });

    // Licenses (GSTIN, DL, FSSAI)
    const licenseItems: string[] = [];
    if (data.store_gstin) licenseItems.push(`GSTIN: ${data.store_gstin}`);
    if (data.drug_license_numbers && data.drug_license_numbers.length > 0) {
      licenseItems.push(`DL: ${data.drug_license_numbers.join(", ")}`);
    }
    if (data.fssai_no) licenseItems.push(`FSSAI: ${data.fssai_no}`);

    if (licenseItems.length > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(51, 65, 85);
      doc.text(licenseItems.join("  |  "), centerX, 25, { align: "center" });
    }

    // Divider Line
    doc.setDrawColor(203, 213, 225); // slate-300
    doc.setLineWidth(0.4);
    doc.line(marginX, 27.5, marginX + contentWidth, 27.5);

    // Title Badge
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(30, 41, 59);
    doc.text("TAX INVOICE", centerX, 32.5, { align: "center" });

    // Metadata Grid (Customer / Patient / Doctor / Invoice Info)
    const metaBoxY = 35;
    const metaBoxHeight = 22;
    doc.setFillColor(248, 250, 252); // slate-50
    doc.rect(marginX, metaBoxY, contentWidth, metaBoxHeight, "F");
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.rect(marginX, metaBoxY, contentWidth, metaBoxHeight, "S");

    doc.setFontSize(8);
    const leftX = marginX + 3;
    const rightColX = marginX + contentWidth / 2 + 10;

    // Left Column
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text(`Billed To: ${data.customer_name || "Walk-in Customer"}`, leftX, metaBoxY + 5);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text(`Mobile: ${data.customer_phone || "Not specified"}`, leftX, metaBoxY + 9.5);

    if (data.patient_name) {
      const patientInfo = `Patient: ${data.patient_name}${data.patient_age ? ` (${data.patient_age} yrs)` : ""}${data.patient_gender ? ` / ${data.patient_gender}` : ""}`;
      doc.text(patientInfo, leftX, metaBoxY + 14);
    } else {
      doc.text("Category: Retail Sale", leftX, metaBoxY + 14);
    }

    if (data.doctor_name) {
      const doctorInfo = `Doctor: ${data.doctor_name}${data.doctor_reg_no ? ` [Reg: ${data.doctor_reg_no}]` : ""}`;
      doc.text(doctorInfo, leftX, metaBoxY + 18.5);
    }

    // Right Column
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text(`Invoice No: ${data.invoice_number}`, rightColX, metaBoxY + 5);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text(`Date: ${data.invoice_date}`, rightColX, metaBoxY + 9.5);
    doc.text("Place of Supply: 32-Kerala", rightColX, metaBoxY + 14);

    // Items Table using jspdf-autotable
    const tableRows = data.lines.map((l, i) => [
      String(i + 1),
      l.description,
      l.batch_no || "-",
      l.expiry_date || "-",
      `${l.qty}${l.loose_qty ? ` + ${l.loose_qty}L` : ""}`,
      l.rate.toFixed(2),
      `${l.gst_percent}%`,
      l.amount.toFixed(2),
    ]);

    autoTable(doc, {
      startY: 60,
      margin: { left: marginX, right: marginX },
      head: [["#", "Item / Description", "Batch", "Expiry", "Qty", "Rate (₹)", "GST %", "Total (₹)"]],
      body: tableRows,
      theme: "grid",
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        fontStyle: "bold",
        fontSize: 8,
        halign: "left",
      },
      bodyStyles: {
        fontSize: 7.5,
        textColor: [30, 41, 59],
        cellPadding: 2,
      },
      alternateRowStyles: {
        fillColor: [255, 255, 255],
      },
      columnStyles: {
        0: { halign: "center", cellWidth: 8 },
        1: { halign: "left", cellWidth: 54, fontStyle: "bold" },
        2: { halign: "center", cellWidth: 22 },
        3: { halign: "center", cellWidth: 18 },
        4: { halign: "right", cellWidth: 16 },
        5: { halign: "right", cellWidth: 20 },
        6: { halign: "right", cellWidth: 16 },
        7: { halign: "right", cellWidth: 32, fontStyle: "bold" },
      },
    });

    // Check final position for Totals & Footer
    let finalY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 5 : 120;
    if (finalY + 45 > 280) {
      doc.addPage();
      finalY = 15;
    }

    // Totals Box (Right Side)
    const totalsBoxWidth = 72;
    const totalsBoxX = marginX + contentWidth - totalsBoxWidth;
    doc.setFillColor(248, 250, 252);
    doc.rect(totalsBoxX, finalY, totalsBoxWidth, 28, "F");
    doc.setDrawColor(226, 232, 240);
    doc.rect(totalsBoxX, finalY, totalsBoxWidth, 28, "S");

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text("Taxable Subtotal:", totalsBoxX + 3, finalY + 5.5);
    doc.text(`₹ ${data.subtotal.toFixed(2)}`, totalsBoxX + totalsBoxWidth - 3, finalY + 5.5, { align: "right" });

    doc.text("GST Tax Total:", totalsBoxX + 3, finalY + 10.5);
    doc.text(`₹ ${data.tax_total.toFixed(2)}`, totalsBoxX + totalsBoxWidth - 3, finalY + 10.5, { align: "right" });

    if (data.round_off !== 0) {
      doc.text("Round-Off:", totalsBoxX + 3, finalY + 15.5);
      const roSign = data.round_off > 0 ? "+" : "";
      doc.text(`${roSign}₹ ${data.round_off.toFixed(2)}`, totalsBoxX + totalsBoxWidth - 3, finalY + 15.5, { align: "right" });
    }

    doc.setDrawColor(203, 213, 225);
    doc.line(totalsBoxX + 2, finalY + 18.5, totalsBoxX + totalsBoxWidth - 2, finalY + 18.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(29, 78, 216); // blue-700
    doc.text("Grand Total:", totalsBoxX + 3, finalY + 24);
    doc.text(`₹ ${data.grand_total.toFixed(2)}`, totalsBoxX + totalsBoxWidth - 3, finalY + 24, { align: "right" });

    // Terms & Signatory (Left Side)
    const termsX = marginX;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      data.terms_and_conditions || "Thank you for your business! Goods once sold cannot be returned without original cash memo.",
      termsX,
      finalY + 8,
      { maxWidth: 105 }
    );
    doc.text(data.jurisdiction_note || "Subject to local jurisdiction.", termsX, finalY + 15, { maxWidth: 105 });

    doc.setFont("helvetica", "bold");
    doc.setTextColor(51, 65, 85);
    doc.text("Authorised Signatory / Pharmacist", termsX, finalY + 25);

    // Page Numbering & Bottom Brand Mark on all pages
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Page ${p} of ${totalPages}  •  Computer Generated Tax Invoice  •  LamSuite POS`,
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
}

export const printingEngine = new PrintingEngine();
