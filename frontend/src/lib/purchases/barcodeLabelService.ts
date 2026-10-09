export interface BarcodeLabelItem {
  product_id: string;
  product_name: string;
  barcode: string;
  batch_no: string;
  expiry_date?: string;
  mrp?: number;
  selling_rate?: number;
  quantity_to_print: number;
}

export type LabelTemplate = "thermal_50x25" | "thermal_38x25_dual" | "a4_24up" | "a4_65up";

export interface LabelPrintConfig {
  template: LabelTemplate;
  storeName: string;
  showStoreName: boolean;
  showMrp: boolean;
  showSellingRate: boolean;
  showExpiry: boolean;
  showBatch: boolean;
}

export class BarcodeLabelService {
  /**
   * Generates formatted HTML for direct printing or preview of barcode labels
   */
  generatePrintHtml(items: BarcodeLabelItem[], config: LabelPrintConfig): string {
    const flatLabels: BarcodeLabelItem[] = [];
    for (const item of items) {
      const count = Math.max(1, item.quantity_to_print || 1);
      for (let i = 0; i < count; i++) {
        flatLabels.push(item);
      }
    }

    const isThermal = config.template.startsWith("thermal");

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Barcode Labels</title>
        <style>
          @page {
            margin: ${isThermal ? "0" : "8mm"};
            size: ${config.template === "thermal_50x25" ? "50mm 25mm" : config.template === "thermal_38x25_dual" ? "80mm 25mm" : "A4 portrait"};
          }
          * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          body { background: #fff; padding: ${isThermal ? "2mm" : "0"}; }
          .label-grid {
            display: grid;
            gap: 2mm;
            ${
              config.template === "thermal_50x25"
                ? "grid-template-columns: 1fr;"
                : config.template === "thermal_38x25_dual"
                ? "grid-template-columns: 1fr 1fr;"
                : config.template === "a4_24up"
                ? "grid-template-columns: repeat(3, 1fr); gap: 3mm;"
                : "grid-template-columns: repeat(5, 1fr); gap: 1.5mm;"
            }
          }
          .label-card {
            border: 1px dashed #ccc;
            padding: 2mm;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            height: ${isThermal ? "21mm" : config.template === "a4_24up" ? "33mm" : "18mm"};
            overflow: hidden;
            text-align: center;
            page-break-inside: avoid;
          }
          .store-name { font-size: 7px; font-weight: bold; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .prod-name { font-size: 8px; font-weight: 700; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
          .meta-row { display: flex; justify-content: space-between; font-size: 6.5px; color: #333; margin: 1px 0; }
          .barcode-box { font-family: "Courier New", Courier, monospace; font-size: 8px; letter-spacing: 2px; font-weight: bold; margin-top: 1px; }
          .barcode-bars {
            height: 6mm;
            margin: 1px auto;
            background: repeating-linear-gradient(90deg, #000 0px, #000 1.5px, #fff 1.5px, #fff 3px, #000 3px, #000 4px, #fff 4px, #fff 5.5px);
            width: 80%;
          }
          .price-box { font-size: 8px; font-weight: 800; color: #000; }
        </style>
      </head>
      <body>
        <div class="label-grid">
          ${flatLabels
            .map(
              (l) => `
            <div class="label-card">
              ${config.showStoreName ? `<div class="store-name">${config.storeName || "PHARMACY"}</div>` : ""}
              <div class="prod-name">${l.product_name}</div>
              <div class="meta-row">
                ${config.showBatch ? `<span>B: ${l.batch_no}</span>` : ""}
                ${config.showExpiry && l.expiry_date ? `<span>EXP: ${l.expiry_date.slice(2, 7)}</span>` : ""}
              </div>
              <div class="barcode-bars"></div>
              <div class="barcode-box">${l.barcode || l.batch_no}</div>
              <div class="meta-row" style="margin-top: 1px;">
                ${config.showMrp && l.mrp ? `<span>MRP: ₹${l.mrp.toFixed(2)}</span>` : "<span></span>"}
                ${config.showSellingRate && l.selling_rate ? `<span class="price-box">OUR: ₹${l.selling_rate.toFixed(2)}</span>` : ""}
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      </body>
      </html>
    `;
  }
}

export const barcodeLabelService = new BarcodeLabelService();
