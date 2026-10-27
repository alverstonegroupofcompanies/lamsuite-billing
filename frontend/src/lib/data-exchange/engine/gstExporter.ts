import { sqliteStorage } from "../../db/sqliteStorage";
import { universalExporter, type ExportFormat, type ExportResult } from "./exporter";

export interface Gstr1SummaryData {
  b2b: any[];
  b2cl: any[];
  b2cs: any[];
  cdnr: any[];
  hsnSummary: any[];
  docsSummary: any[];
}

export class GstStatutoryExporter {
  /**
   * Compile and export GSTR-1 in statutory format.
   */
  async exportGstr1(
    fromDate: string,
    toDate: string,
    format: ExportFormat = "excel"
  ): Promise<ExportResult> {
    const invoices = await sqliteStorage.findAll<any>("invoices");
    const invoiceItems = await sqliteStorage.findAll<any>("invoice_items");

    // Filter date range
    const rangeInvoices = invoices.filter((inv) => {
      if (inv.status === "cancelled") return false;
      const d = inv.invoice_date;
      return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
    });

    const b2bRows: any[] = [];
    const b2clRows: any[] = [];
    const b2csMap = new Map<string, { pos: string; rate: number; taxable: number; cess: number }>();
    const hsnMap = new Map<string, { hsn: string; uqc: string; qty: number; taxable: number; cgst: number; sgst: number; igst: number }>();

    // Index items by invoice_id
    const itemsByInvoice = new Map<string, any[]>();
    for (const item of invoiceItems) {
      if (!itemsByInvoice.has(item.invoice_id)) {
        itemsByInvoice.set(item.invoice_id, []);
      }
      itemsByInvoice.get(item.invoice_id)!.push(item);
    }

    for (const inv of rangeInvoices) {
      const isB2b = Boolean(inv.customer_gstin && inv.customer_gstin.trim().length === 15);
      const isInterState = inv.place_of_supply && inv.place_of_supply !== "Kerala" && !inv.place_of_supply.startsWith("32");
      const isLarge = Number(inv.grand_total || 0) > 250000;
      const invItems = itemsByInvoice.get(inv.id) || [];

      // Group items by GST rate
      const rateGroups = new Map<number, { taxable: number; cess: number }>();
      if (invItems.length > 0) {
        for (const item of invItems) {
          const rate = Number(item.gst_percent || 0);
          const tax = Number(item.cgst_amount || 0) + Number(item.sgst_amount || 0) + Number(item.igst_amount || 0);
          const taxable = Number(item.taxable_amount ?? (item.total_amount - tax));
          const cess = Number(item.cess_amount || 0);
          const grp = rateGroups.get(rate) || { taxable: 0, cess: 0 };
          grp.taxable += taxable;
          grp.cess += cess;
          rateGroups.set(rate, grp);
        }
      } else {
        const rate = inv.tax_total > 0 && inv.subtotal > 0 ? Math.round((inv.tax_total / inv.subtotal) * 100) : 0;
        rateGroups.set(rate, { taxable: Number(inv.taxable_subtotal || inv.subtotal || 0), cess: Number(inv.cess_total || 0) });
      }

      for (const [rate, grp] of rateGroups.entries()) {
        if (isB2b) {
          b2bRows.push({
            gstin: inv.customer_gstin,
            customer_name: inv.customer_name,
            invoice_number: inv.invoice_number,
            invoice_date: inv.invoice_date,
            invoice_value: inv.grand_total,
            place_of_supply: inv.place_of_supply || "32-Kerala",
            reverse_charge: "N",
            rate,
            taxable_value: Math.round((grp.taxable + Number.EPSILON) * 100) / 100,
            cess: Math.round((grp.cess + Number.EPSILON) * 100) / 100,
          });
        } else if (isInterState && isLarge) {
          b2clRows.push({
            invoice_number: inv.invoice_number,
            invoice_date: inv.invoice_date,
            invoice_value: inv.grand_total,
            place_of_supply: inv.place_of_supply || "32-Kerala",
            rate,
            taxable_value: Math.round((grp.taxable + Number.EPSILON) * 100) / 100,
            cess: Math.round((grp.cess + Number.EPSILON) * 100) / 100,
          });
        } else {
          const pos = inv.place_of_supply || "32-Kerala";
          const key = `${pos}_${rate}`;
          const existing = b2csMap.get(key) || { pos, rate, taxable: 0, cess: 0 };
          existing.taxable += grp.taxable;
          existing.cess += grp.cess;
          b2csMap.set(key, existing);
        }
      }
    }

    // Compile HSN Summary from invoice_items
    const matchedInvoiceIds = new Set(rangeInvoices.map((i) => i.id));
    const rangeItems = invoiceItems.filter((item) => matchedInvoiceIds.has(item.invoice_id));

    for (const item of rangeItems) {
      const hsn = item.hsn_code || "30049099";
      const existing = hsnMap.get(hsn) || {
        hsn,
        uqc: "NOS",
        qty: 0,
        taxable: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
      };

      existing.qty += Number(item.qty || 0);
      existing.taxable += Number(item.total_amount - (item.cgst_amount + item.sgst_amount + item.igst_amount));
      existing.cgst += Number(item.cgst_amount || 0);
      existing.sgst += Number(item.sgst_amount || 0);
      existing.igst += Number(item.igst_amount || 0);
      hsnMap.set(hsn, existing);
    }

    // Export B2B or Full GSTR-1 dataset
    const exportRows = b2bRows.length > 0 ? b2bRows : Array.from(b2csMap.values());
    const columns = [
      { key: "gstin", label: "GSTIN/UIN of Recipient" },
      { key: "customer_name", label: "Receiver Name" },
      { key: "invoice_number", label: "Invoice Number" },
      { key: "invoice_date", label: "Invoice Date" },
      { key: "invoice_value", label: "Invoice Value (₹)", format: "currency" as const },
      { key: "place_of_supply", label: "Place Of Supply" },
      { key: "reverse_charge", label: "Reverse Charge" },
      { key: "rate", label: "Rate (%)" },
      { key: "taxable_value", label: "Taxable Value (₹)", format: "currency" as const },
      { key: "cess", label: "Cess Amount (₹)", format: "currency" as const },
    ];

    return await universalExporter.exportData({
      fileName: `GSTR-1_${fromDate}_to_${toDate}`,
      format,
      title: `GSTR-1 Outward Supplies (${fromDate} to ${toDate})`,
      columns,
      rows: exportRows,
      orientation: "landscape",
    });
  }

  /**
   * Export GSTR-2 Purchase Register.
   */
  async exportPurchaseRegister(
    fromDate: string,
    toDate: string,
    format: ExportFormat = "excel"
  ): Promise<ExportResult> {
    const purchases = await sqliteStorage.findAll<any>("purchase_documents");

    const filtered = purchases.filter((p) => {
      const d = p.purchase_date;
      return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
    });

    const columns = [
      { key: "supplier_gstin", label: "Supplier GSTIN" },
      { key: "supplier_name", label: "Supplier Name" },
      { key: "supplier_invoice_no", label: "Supplier Invoice No" },
      { key: "purchase_date", label: "Invoice Date" },
      { key: "grand_total", label: "Invoice Total (₹)", format: "currency" as const },
      { key: "subtotal", label: "Taxable Value (₹)", format: "currency" as const },
      { key: "tax_total", label: "Total GST (₹)", format: "currency" as const },
      { key: "itc_eligibility", label: "ITC Eligibility" },
      { key: "payment_status", label: "Payment Status" },
    ];

    return await universalExporter.exportData({
      fileName: `Purchase_Register_${fromDate}_to_${toDate}`,
      format,
      title: `Purchase Register & Inward ITC (${fromDate} to ${toDate})`,
      columns,
      rows: filtered,
      orientation: "landscape",
    });
  }

  /**
   * Export HSN Summary Table.
   */
  async exportHsnSummary(
    fromDate: string,
    toDate: string,
    format: ExportFormat = "excel"
  ): Promise<ExportResult> {
    const invoices = await sqliteStorage.findAll<any>("invoices");
    const invoiceItems = await sqliteStorage.findAll<any>("invoice_items");

    const matchedIds = new Set(
      invoices
        .filter((inv) => {
          if (inv.status === "cancelled") return false;
          const d = inv.invoice_date;
          return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
        })
        .map((inv) => inv.id)
    );

    const hsnMap = new Map<string, any>();
    for (const item of invoiceItems) {
      if (!matchedIds.has(item.invoice_id)) continue;
      const hsn = item.hsn_code || "30049099";
      const existing = hsnMap.get(hsn) || {
        hsn_code: hsn,
        description: item.product_name,
        uqc: "NOS",
        total_qty: 0,
        taxable_value: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        total_value: 0,
      };

      existing.total_qty += Number(item.qty || 0);
      const tax = Number(item.cgst_amount || 0) + Number(item.sgst_amount || 0) + Number(item.igst_amount || 0);
      existing.taxable_value += Number(item.total_amount - tax);
      existing.cgst += Number(item.cgst_amount || 0);
      existing.sgst += Number(item.sgst_amount || 0);
      existing.igst += Number(item.igst_amount || 0);
      existing.total_value += Number(item.total_amount || 0);
      hsnMap.set(hsn, existing);
    }

    const columns = [
      { key: "hsn_code", label: "HSN / SAC Code" },
      { key: "description", label: "Description" },
      { key: "uqc", label: "UQC" },
      { key: "total_qty", label: "Total Quantity", format: "number" as const },
      { key: "taxable_value", label: "Taxable Value (₹)", format: "currency" as const },
      { key: "cgst", label: "CGST (₹)", format: "currency" as const },
      { key: "sgst", label: "SGST (₹)", format: "currency" as const },
      { key: "igst", label: "IGST (₹)", format: "currency" as const },
      { key: "total_value", label: "Total Value (₹)", format: "currency" as const },
    ];

    return await universalExporter.exportData({
      fileName: `HSN_Summary_${fromDate}_to_${toDate}`,
      format,
      title: `HSN / SAC Outward Supplies Summary (${fromDate} to ${toDate})`,
      columns,
      rows: Array.from(hsnMap.values()),
      orientation: "landscape",
    });
  }
}

export const gstStatutoryExporter = new GstStatutoryExporter();
