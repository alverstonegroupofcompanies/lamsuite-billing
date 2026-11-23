/**
 * Client-side CSV download for the registers that read their rows as JSON.
 *
 * A field containing a comma, quote or newline is quoted the way RFC 4180 says, because an
 * accountant opens these files in Excel and a supplier name with a comma must not split a row.
 */
export function downloadCsv(
  filename: string,
  header: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>
): void {
  const cell = (value: string | number | boolean | null | undefined): string => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const csv = [header, ...rows].map((row) => row.map(cell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
