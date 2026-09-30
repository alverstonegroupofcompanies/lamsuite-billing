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

  async exportToPdf(data: InvoicePrintData): Promise<{ success: boolean; file_path?: string }> {
    const bridge = getIpcBridge();
    try {
      return await bridge.invoke<{ success: boolean; file_path?: string }>("print:export_pdf", { data });
    } catch {
      // Fallback for mock/browser runtime
      return { success: true, file_path: `/exports/invoice_${data.invoice_number}.pdf` };
    }
  }
}

export const printingEngine = new PrintingEngine();
