import { getIpcBridge } from "../ipc/ipcBridge";

export interface InvoicePrintData {
  invoice_number: string;
  invoice_date: string;
  store_name: string;
  store_address?: string;
  store_gstin?: string;
  drug_license_numbers?: string[]; // e.g. ["20B-12345", "21B-67890"]
  fssai_no?: string;
  customer_name?: string;
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
    discount_amount?: number;
    gst_percent: number;
    amount: number;
  }>;
  subtotal: number;
  tax_total: number;
  round_off: number;
  grand_total: number;
  upi_vpa?: string;
}

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

export class PrintingEngine {
  async printThermalReceipt(data: InvoicePrintData, printerName?: string): Promise<{ success: boolean; job_id?: string }> {
    const bridge = getIpcBridge();
    const dynamicHeight = generateDynamicSlipHeightMm(data.lines.length, Boolean(data.doctor_name || data.patient_name));

    return await bridge.invoke<{ success: boolean; job_id?: string }>("print:thermal", {
      data,
      dynamicHeightMm: dynamicHeight,
      printerName,
    });
  }

  async printA4TaxInvoice(data: InvoicePrintData, printerName?: string): Promise<{ success: boolean; job_id?: string }> {
    const bridge = getIpcBridge();
    return await bridge.invoke<{ success: boolean; job_id?: string }>("print:a4", {
      data,
      printerName,
    });
  }
}

export const printingEngine = new PrintingEngine();
