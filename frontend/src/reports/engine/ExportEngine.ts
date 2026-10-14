import type { ReportColumn } from "../types";

export class ExportEngine {
  /**
   * Escape and format a value for CSV output
   */
  private formatCsvCell(val: any): string {
    if (val === null || val === undefined) return '""';
    let str = String(val);
    if (typeof val === "number") {
      return str;
    }
    // Escape internal double quotes by doubling them
    str = str.replace(/"/g, '""');
    return `"${str}"`;
  }

  /**
   * Generate CSV content with UTF-8 BOM for flawless Excel compatibility
   */
  generateCsvContent(headers: string[], rows: any[][]): string {
    const lines: string[] = [];
    // BOM for UTF-8 Excel
    const headerLine = headers.map((h) => this.formatCsvCell(h)).join(",");
    lines.push(headerLine);

    for (const row of rows) {
      const rowLine = row.map((cell) => this.formatCsvCell(cell)).join(",");
      lines.push(rowLine);
    }

    return "\uFEFF" + lines.join("\r\n");
  }

  /**
   * Trigger browser file download for CSV
   */
  downloadCsv(filename: string, content: string): void {
    if (typeof window === "undefined" || !window.document) return;

    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename.endsWith(".csv") ? filename : `${filename}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * High-level export helper from report columns and rows
   */
  exportReport<TRow>(
    filename: string,
    columns: ReportColumn<TRow>[],
    rows: TRow[],
    visibleColumnIds?: string[]
  ): void {
    const activeCols = visibleColumnIds
      ? columns.filter((c) => visibleColumnIds.includes(c.id))
      : columns.filter((c) => c.isDefaultVisible);

    const headers = activeCols.map((c) => c.header);
    const rowData = rows.map((row) =>
      activeCols.map((c) => {
        const val = c.accessor(row);
        if (typeof val === "object" && val !== null) {
          return JSON.stringify(val);
        }
        return val;
      })
    );

    const csvContent = this.generateCsvContent(headers, rowData);
    this.downloadCsv(filename, csvContent);
  }
}

export const exportEngine = new ExportEngine();
