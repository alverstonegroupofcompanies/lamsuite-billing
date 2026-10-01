import { getIpcBridge } from "../ipc/ipcBridge";

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
    const bridge = getIpcBridge();
    const dynamicHeight = generateDynamicSlipHeightMm(data.lines.length, Boolean(data.doctor_name || data.patient_name));

    return await bridge.invoke<{ success: boolean; job_id?: string }>("print:thermal", {
      data,
      dynamicHeightMm: dynamicHeight,
      printerName: printerName || this.printerProfiles.find((p) => p.isDefault)?.name,
    });
  }

  async printA4TaxInvoice(data: InvoicePrintData, printerName?: string): Promise<{ success: boolean; job_id?: string }> {
    const bridge = getIpcBridge();
    return await bridge.invoke<{ success: boolean; job_id?: string }>("print:a4", {
      data,
      printerName: printerName || this.printerProfiles.find((p) => p.paperSize === "a4")?.name,
    });
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

  async revealFile(filePath: string): Promise<boolean> {
    const bridge = getIpcBridge();
    if (bridge.runtime === "tauri") {
      try {
        await bridge.invoke("reveal_file", { path: filePath });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  async exportToPdf(data: InvoicePrintData): Promise<{ success: boolean; file_path?: string; cancelled?: boolean }> {
    const bridge = getIpcBridge();
    const cleanInvoiceNo = data.invoice_number.replace(/[^a-zA-Z0-9_-]/g, "_");
    const defaultFileName = `Invoice_${cleanInvoiceNo}.html`;
    const html = this.generateInvoiceHtml(data);

    // 1. If running inside desktop Tauri app, open native Save File Dialog (Finder on macOS / Explorer on Windows)
    if (bridge.runtime === "tauri") {
      try {
        let chosenPath: string | null = null;
        try {
          const { save } = await import("@tauri-apps/api/dialog");
          chosenPath = await save({
            defaultPath: defaultFileName,
            filters: [
              { name: "Printable Invoice (HTML)", extensions: ["html", "htm"] },
              { name: "PDF Document", extensions: ["pdf"] },
            ],
            title: "Save Invoice File",
          });

          // If user cancelled the Finder / File Explorer dialog
          if (!chosenPath) {
            return { success: false, cancelled: true };
          }
        } catch (dialogErr) {
          console.warn("Tauri dialog save prompt fallback:", dialogErr);
        }

        const res = await bridge.invoke<{ success: boolean; file_path?: string }>("print:export_pdf", {
          data,
          target_path: chosenPath || undefined,
          html_content: html,
        });

        return res;
      } catch (err) {
        console.error("Tauri PDF export failed:", err);
      }
    }

    // 2. In Browser runtime: Save as PDF from the browser
    if (typeof window !== "undefined") {
      // Modern browser File System Access API: triggers native Finder / File Explorer "Save As" sheet
      if ("showSaveFilePicker" in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: `Invoice_${cleanInvoiceNo}.html`,
            types: [
              {
                description: "Printable Tax Invoice",
                accept: { "text/html": [".html", ".htm"] },
              },
            ],
          });
          const writable = await handle.createWritable();
          await writable.write(html);
          await writable.close();
          return { success: true, file_path: handle.name || `Invoice_${cleanInvoiceNo}.html` };
        } catch (pickerErr: any) {
          if (pickerErr && typeof pickerErr === "object" && (pickerErr as { name?: string }).name === "AbortError") {
            return { success: false, cancelled: true };
          }
        }
      }

      // Browser Fallback: Open print dialog (Save as PDF) and download file to ~/Downloads
      try {
        const printWindow = window.open("", "_blank", "width=850,height=900");
        if (printWindow) {
          printWindow.document.open();
          printWindow.document.write(html);
          printWindow.document.close();
          printWindow.focus();
          setTimeout(() => {
            printWindow.print();
          }, 300);
        }
      } catch {}

      // Also trigger direct download to ~/Downloads/
      const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Invoice_${cleanInvoiceNo}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      return { success: true, file_path: `Downloads/Invoice_${cleanInvoiceNo}.html` };
    }

    return { success: true, file_path: `/exports/invoice_${data.invoice_number}.pdf` };
  }
}

export const printingEngine = new PrintingEngine();
