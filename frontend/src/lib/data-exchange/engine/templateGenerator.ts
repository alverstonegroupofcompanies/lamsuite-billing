import type { EntityDefinition, ImportPreviewRow } from "../registry/types";
import { isTauri } from "../../ipc/ipcBridge";

export class TemplateGenerator {
  /**
   * Escape cell for CSV RFC 4180.
   */
  private formatCsvCell(val: any): string {
    if (val === null || val === undefined) return '""';
    let str = String(val);
    if (typeof val === "number") return str;
    str = str.replace(/"/g, '""');
    return `"${str}"`;
  }

  /**
   * Generate CSV template content for an entity with UTF-8 BOM.
   */
  generateCsvTemplate(entityDef: EntityDefinition, includeSampleRows = true): string {
    const fields = Object.values(entityDef.fields);
    const headers = fields.map((f) => f.key);

    const lines: string[] = [];

    // Header row
    lines.push(headers.map((h) => this.formatCsvCell(h)).join(","));

    // Sample rows
    if (includeSampleRows && entityDef.sampleRows && entityDef.sampleRows.length > 0) {
      for (const sample of entityDef.sampleRows) {
        const row = headers.map((key) => this.formatCsvCell(sample[key] ?? ""));
        lines.push(row.join(","));
      }
    }

    return "\uFEFF" + lines.join("\r\n");
  }

  /**
   * Generate SpreadsheetML (Excel XML) template with header styling and metadata.
   */
  generateExcelXmlTemplate(entityDef: EntityDefinition, includeSampleRows = true): string {
    const fields = Object.values(entityDef.fields);
    const headers = fields.map((f) => f.key);

    let rowsXml = "";

    // Header row with Bold style
    rowsXml += '    <Row ss:StyleID="HeaderStyle">\n';
    for (const f of fields) {
      const label = f.required ? `${f.label} *` : f.label;
      rowsXml += `      <Cell><Data ss:Type="String">${this.escapeXml(label)}</Data></Cell>\n`;
    }
    rowsXml += "    </Row>\n";

    // Sample rows
    if (includeSampleRows && entityDef.sampleRows) {
      for (const sample of entityDef.sampleRows) {
        rowsXml += "    <Row>\n";
        for (const f of fields) {
          const val = sample[f.key];
          const type = typeof val === "number" ? "Number" : "String";
          rowsXml += `      <Cell><Data ss:Type="${type}">${this.escapeXml(val ?? "")}</Data></Cell>\n`;
        }
        rowsXml += "    </Row>\n";
      }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#000000"/>
  </Style>
  <Style ss:ID="HeaderStyle">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1E3A8A" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="CodeStyle">
   <Font ss:FontName="Consolas" ss:Size="9" ss:Italic="1" ss:Color="#475569"/>
   <Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${this.escapeXml(entityDef.label.slice(0, 31))}">
  <Table>
${rowsXml}  </Table>
 </Worksheet>
</Workbook>`;

    return xml;
  }

  /**
   * Generate downloadable error CSV containing only rows with errors, plus annotated error reason.
   */
  generateErrorCsv(errorRows: ImportPreviewRow[]): string {
    if (errorRows.length === 0) return "";

    const sampleRow = errorRows[0].data;
    const originalHeaders = Object.keys(sampleRow);
    const headers = ["_row_number", ...originalHeaders, "_error_reasons"];

    const lines: string[] = [];
    lines.push(headers.map((h) => this.formatCsvCell(h)).join(","));

    for (const row of errorRows) {
      const errorMsg = row.errors.map((e) => `[${e.severity.toUpperCase()}] ${e.message}`).join(" | ");
      const rowData = [
        row.rowNumber,
        ...originalHeaders.map((h) => row.data[h] ?? ""),
        errorMsg,
      ];
      lines.push(rowData.map((c) => this.formatCsvCell(c)).join(","));
    }

    return "\uFEFF" + lines.join("\r\n");
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
   * Save / download template or export file with native Tauri save dialog and browser fallback.
   */
  async downloadTemplate(
    fileName: string,
    content: string,
    format: "csv" | "excel",
    mimeType = "text/csv;charset=utf-8;"
  ): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }> {
    const ext = format === "excel" ? "xlsx" : "csv";
    const fullFileName = fileName.endsWith(`.${ext}`) ? fileName : `${fileName}.${ext}`;

    // 1. Native Tauri Save Dialog if running in desktop app
    if (isTauri()) {
      try {
        const { save } = await import("@tauri-apps/api/dialog");
        const { writeTextFile } = await import("@tauri-apps/api/fs");

        const selectedPath = await save({
          defaultPath: fullFileName,
          filters: [
            {
              name: format === "excel" ? "Excel Spreadsheet" : "CSV Document",
              extensions: format === "excel" ? ["xlsx", "xls", "xml"] : ["csv"],
            },
          ],
        });

        if (selectedPath) {
          await writeTextFile({ path: selectedPath, contents: content });
          return { success: true, filePath: selectedPath };
        } else {
          return { success: false, canceled: true };
        }
      } catch (tauriErr: any) {
        console.warn("Tauri native save dialog unavailable, falling back to browser download:", tauriErr);
      }
    }

    // 2. Web Browser Blob Download Fallback
    if (typeof window !== "undefined" && window.document) {
      try {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fullFileName;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();

        setTimeout(() => {
          if (link.parentNode) {
            document.body.removeChild(link);
          }
          URL.revokeObjectURL(url);
        }, 2000);

        return { success: true, filePath: fullFileName };
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
      }
    }

    return { success: false, error: "Window environment not available" };
  }

  /**
   * Browser file download trigger (delegates to downloadTemplate).
   */
  triggerBrowserDownload(fileName: string, content: string, mimeType = "text/csv;charset=utf-8;"): void {
    const isExcel = fileName.endsWith(".xlsx") || fileName.endsWith(".xml") || fileName.endsWith(".xls");
    this.downloadTemplate(fileName, content, isExcel ? "excel" : "csv", mimeType).catch((err) => {
      console.error("Template download error:", err);
    });
  }
}

export const templateGenerator = new TemplateGenerator();
