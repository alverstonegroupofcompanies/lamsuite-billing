import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { EntityDefinition } from "../registry/types";
import { isTauri } from "../../ipc/ipcBridge";
import { companySettingsService } from "../../settings/companySettingsService";

export type ExportFormat = "csv" | "excel" | "pdf";

export interface ExportColumnChoice {
  key: string;
  label: string;
  format?: "text" | "currency" | "number" | "date";
}

export interface ExportOptions {
  fileName: string;
  format: ExportFormat;
  title?: string;
  columns?: ExportColumnChoice[];
  rows: Record<string, any>[];
  entityDef?: EntityDefinition;
  orientation?: "portrait" | "landscape";
}

export interface ExportResult {
  success: boolean;
  filePath?: string;
  fileName: string;
  format: ExportFormat;
  rowCount: number;
  isNativeSaved: boolean;
}

export class UniversalExporter {
  /**
   * Escape cell for CSV.
   */
  private formatCsvCell(val: any): string {
    if (val === null || val === undefined) return '""';
    let str = String(val);
    if (typeof val === "number") return str;
    str = str.replace(/"/g, '""');
    return `"${str}"`;
  }

  /**
   * Generate CSV with UTF-8 BOM.
   */
  generateCsv(columns: ExportColumnChoice[], rows: Record<string, any>[]): string {
    const headers = columns.map((c) => c.label);
    const lines: string[] = [];

    // Header row
    lines.push(headers.map((h) => this.formatCsvCell(h)).join(","));

    // Data rows
    for (const row of rows) {
      const line = columns.map((c) => this.formatCsvCell(row[c.key] ?? ""));
      lines.push(line.join(","));
    }

    return "\uFEFF" + lines.join("\r\n");
  }

  /**
   * Generate SpreadsheetML (Excel XML) with styling.
   */
  generateExcelXml(title: string, columns: ExportColumnChoice[], rows: Record<string, any>[]): string {
    let rowsXml = "";

    // Title Row
    rowsXml += '    <Row ss:Height="25">\n';
    rowsXml += `      <Cell ss:MergeAcross="${columns.length - 1}" ss:StyleID="TitleStyle"><Data ss:Type="String">${this.escapeXml(title)}</Data></Cell>\n`;
    rowsXml += "    </Row>\n";

    // Header Row
    rowsXml += '    <Row ss:Height="20" ss:StyleID="HeaderStyle">\n';
    for (const c of columns) {
      rowsXml += `      <Cell><Data ss:Type="String">${this.escapeXml(c.label)}</Data></Cell>\n`;
    }
    rowsXml += "    </Row>\n";

    // Data Rows
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const styleId = i % 2 === 0 ? "EvenRow" : "OddRow";
      rowsXml += `    <Row ss:StyleID="${styleId}">\n`;
      for (const c of columns) {
        const val = row[c.key];
        const isNum = typeof val === "number";
        const type = isNum ? "Number" : "String";
        rowsXml += `      <Cell><Data ss:Type="${type}">${this.escapeXml(val ?? "")}</Data></Cell>\n`;
      }
      rowsXml += "    </Row>\n";
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#000000"/>
  </Style>
  <Style ss:ID="TitleStyle">
   <Font ss:FontName="Calibri" ss:Size="14" ss:Bold="1" ss:Color="#1E3A8A"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="HeaderStyle">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1E40AF" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="EvenRow">
   <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="OddRow">
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Data">
  <Table>
${rowsXml}  </Table>
 </Worksheet>
</Workbook>`;

    return xml;
  }

  /**
   * Generate Styled Vector PDF.
   */
  async generatePdf(
    title: string,
    columns: ExportColumnChoice[],
    rows: Record<string, any>[],
    orientation: "portrait" | "landscape" = "landscape"
  ): Promise<Uint8Array> {
    const doc = new jsPDF({
      orientation,
      unit: "pt",
      format: "a4",
    });

    const settings = await companySettingsService.loadSettings();
    const storeName = settings.store_name || "LamSuite Billing Workstation";
    const storeGstin = settings.gstin ? `GSTIN: ${settings.gstin}` : "";

    // Header Title Banner
    doc.setFillColor(30, 58, 138); // Blue 900
    doc.rect(0, 0, doc.internal.pageSize.getWidth(), 50, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(storeName, 40, 25);

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`${title} | ${storeGstin}`, 40, 40);

    const generatedOn = `Generated: ${new Date().toLocaleString("en-IN")}`;
    doc.text(generatedOn, doc.internal.pageSize.getWidth() - 40, 30, { align: "right" });

    // Table
    const headers = columns.map((c) => c.label);
    const body = rows.map((row) => columns.map((c) => String(row[c.key] ?? "")));

    autoTable(doc, {
      head: [headers],
      body,
      startY: 65,
      theme: "grid",
      styles: {
        fontSize: 8,
        cellPadding: 4,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [30, 64, 175],
        textColor: 255,
        fontStyle: "bold",
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      margin: { left: 30, right: 30, bottom: 40 },
      didDrawPage: (data) => {
        // Footer page numbering
        const pageCount = (doc as any).internal.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(
          `Page ${data.pageNumber} of ${pageCount}`,
          doc.internal.pageSize.getWidth() / 2,
          doc.internal.pageSize.getHeight() - 15,
          { align: "center" }
        );
      },
    });

    return doc.output("arraybuffer") as unknown as Uint8Array;
  }

  private escapeXml(unsafe: any): string {
    return String(unsafe ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /**
   * Execute export with native Tauri save dialog or browser download.
   */
  async exportData(options: ExportOptions): Promise<ExportResult> {
    const {
      fileName,
      format,
      title = "LamSuite Data Export",
      rows,
      entityDef,
      orientation = "landscape",
    } = options;

    // Resolve columns
    const columns: ExportColumnChoice[] =
      options.columns ||
      (entityDef
        ? Object.values(entityDef.fields).map((f) => ({
            key: f.key,
            label: f.label,
            format: f.type === "currency" ? "currency" : f.type === "number" ? "number" : "text",
          }))
        : Object.keys(rows[0] || {}).map((k) => ({ key: k, label: k, format: "text" })));

    let contentString = "";
    let binaryPdf: Uint8Array | null = null;
    let extension: string = format;
    let mimeType = "text/csv;charset=utf-8;";

    if (format === "csv") {
      contentString = this.generateCsv(columns, rows);
      extension = "csv";
      mimeType = "text/csv;charset=utf-8;";
    } else if (format === "excel") {
      contentString = this.generateExcelXml(title, columns, rows);
      extension = "xlsx"; // Compatible with Excel
      mimeType = "application/vnd.ms-excel";
    } else if (format === "pdf") {
      binaryPdf = await this.generatePdf(title, columns, rows, orientation);
      extension = "pdf";
      mimeType = "application/pdf";
    }

    const fullFileName = fileName.endsWith(`.${extension}`) ? fileName : `${fileName}.${extension}`;

    // 1. Native Tauri Save Dialog if running in desktop app
    if (isTauri()) {
      try {
        const { save } = await import("@tauri-apps/api/dialog");
        const { writeTextFile, writeBinaryFile } = await import("@tauri-apps/api/fs");

        const selectedPath = await save({
          defaultPath: fullFileName,
          filters: [
            {
              name: format.toUpperCase(),
              extensions: [extension],
            },
          ],
        });

        if (selectedPath) {
          if (format === "pdf" && binaryPdf) {
            await writeBinaryFile({ path: selectedPath, contents: binaryPdf });
          } else {
            await writeTextFile({ path: selectedPath, contents: contentString });
          }

          return {
            success: true,
            filePath: selectedPath,
            fileName: fullFileName,
            format,
            rowCount: rows.length,
            isNativeSaved: true,
          };
        }
      } catch (tauriErr) {
        console.warn("Tauri native save dialog unavailable, falling back to browser download:", tauriErr);
      }
    }

    // 2. Web Browser Blob Download Fallback
    if (typeof window !== "undefined" && window.document) {
      const blob =
        format === "pdf" && binaryPdf
          ? new Blob([binaryPdf as unknown as BlobPart], { type: mimeType })
          : new Blob([contentString], { type: mimeType });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fullFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    return {
      success: true,
      fileName: fullFileName,
      format,
      rowCount: rows.length,
      isNativeSaved: false,
    };
  }
}

export const universalExporter = new UniversalExporter();
