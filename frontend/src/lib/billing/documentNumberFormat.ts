/**
 * One numbering contract, shared by every document the till prints and by the server's own numbering
 * (`CounterSequenceService` mirrors this file — change the two together).
 *
 * A store sets the rule, a counter may override it, and a series with no rule prints exactly as it
 * did before: `width` is a minimum length, never a fixed one. 9999 with width 4 prints `10000` —
 * truncating would hand out a number the book already holds.
 */

/** The document series a store numbers, keyed as `sequences.numbering` is keyed. */
export type DocumentSeries =
  | "invoice"
  | "sales_return"
  | "purchase_return"
  | "purchase"
  | "quotation"
  | "adjustment"
  | "transfer";

export interface NumberingRule {
  /** Printed after the serial, e.g. `/26`. Blank means nothing is appended. */
  suffix?: string | null;
  /** Minimum digit count of the serial part. */
  width?: number | null;
  /** Fill the serial to `width` with zeros. Off keeps the serial bare. */
  padZeros?: boolean;
}

/** How a store series maps onto `sequences` and onto the server's counter series doc types. */
export interface SeriesFields {
  label: string;
  prefixKey: string;
  nextKey: string;
  docType: string;
  fallbackPrefix: string;
  fallbackNext: number;
}

export const NUMBERING_SERIES: Record<DocumentSeries, SeriesFields> = {
  invoice: { label: "Sales Invoice", prefixKey: "invoicePrefix", nextKey: "nextInvoiceNumber", docType: "invoice", fallbackPrefix: "INV", fallbackNext: 1001 },
  sales_return: { label: "Sales Return", prefixKey: "returnPrefix", nextKey: "nextReturnNumber", docType: "sales_return", fallbackPrefix: "SR", fallbackNext: 1 },
  purchase_return: { label: "Purchase Return", prefixKey: "purchaseReturnPrefix", nextKey: "nextPurchaseReturnNumber", docType: "purchase_return", fallbackPrefix: "PR", fallbackNext: 1 },
  purchase: { label: "Purchase Inward", prefixKey: "purchasePrefix", nextKey: "nextPurchaseNumber", docType: "purchase_bill", fallbackPrefix: "PUR", fallbackNext: 201 },
  quotation: { label: "Quotation", prefixKey: "quotationPrefix", nextKey: "nextQuotationNumber", docType: "quotation", fallbackPrefix: "QUO", fallbackNext: 101 },
  adjustment: { label: "Stock Adjustment", prefixKey: "adjustmentPrefix", nextKey: "nextAdjustmentNumber", docType: "stock_adjustment", fallbackPrefix: "ADJ", fallbackNext: 401 },
  transfer: { label: "Stock Transfer", prefixKey: "transferPrefix", nextKey: "nextTransferNumber", docType: "stock_transfer", fallbackPrefix: "TRF", fallbackNext: 501 },
};

export const DOCUMENT_SERIES = Object.keys(NUMBERING_SERIES) as DocumentSeries[];

export interface SerialRule extends NumberingRule {
  prefix?: string | null;
}

/**
 * Accepts every shape the rules arrive in: camelCase from the till, snake_case from the admin panel,
 * and `null` for a series that has never been configured.
 */
export function normalizeNumberingRule(raw: unknown): NumberingRule | null {
  if (!raw || typeof raw !== "object") return null;
  const rule = raw as Record<string, any>;
  const suffix = rule.suffix ?? rule.serial_suffix;
  const width = rule.width ?? rule.serial_width ?? rule.digits;
  const pad = rule.padZeros ?? rule.pad_zeros ?? rule.pad;
  const askedWidth = Math.trunc(Number(width));
  return {
    suffix: suffix === null || suffix === undefined ? null : String(suffix),
    width: Number.isFinite(askedWidth) && askedWidth > 0 ? askedWidth : null,
    padZeros: pad === true || pad === 1 || pad === "1" || pad === "true",
  };
}

/**
 * Merges per-series rules. A series the incoming map omits keeps the rule it had — `sequences` is
 * written back whole, so a plain replace would drop the width of a series the panel never shows.
 */
export function mergeNumberingRules(
  local: Record<string, unknown> | null | undefined,
  remote: unknown
): Record<string, NumberingRule> {
  const merged: Record<string, NumberingRule> = {};
  for (const series of DOCUMENT_SERIES) {
    const existing = normalizeNumberingRule((local || {})[series]);
    if (existing) merged[series] = existing;
  }

  const incoming = (remote && typeof remote === "object" ? remote : {}) as Record<string, unknown>;
  for (const [series, raw] of Object.entries(incoming)) {
    const rule = normalizeNumberingRule(raw);
    if (!rule) continue;
    merged[series] = { ...(merged[series] || {}), ...rule };
  }
  return merged;
}

/** The width that actually applies: a rule shorter than the number cannot be honoured. */
export function effectiveSerialWidth(numberText: string, width: number | string | null | undefined): number {
  const asked = Math.trunc(Number(width));
  if (!Number.isFinite(asked) || asked < 1) return 0;
  return Math.max(asked, numberText.length);
}

/** The numeric part as it prints — zero-filled to the rule's width, then the suffix. */
export function formatSerial(number: number | string, rule: NumberingRule | null | undefined): string {
  const digits = String(Math.trunc(Math.abs(Number(number)) || 0));
  const width = effectiveSerialWidth(digits, rule?.width);
  const padded = rule?.padZeros && digits.length < width ? digits.padStart(width, "0") : digits;
  const sign = Number(number) < 0 ? "-" : "";
  const suffix = rule?.suffix?.trim() || "";
  return `${sign}${padded}${suffix}`;
}

/** `PREFIX-SERIAL`, the join every document number in this app uses. */
export function formatDocumentNumber(rule: SerialRule | null | undefined, number: number | string): string {
  const prefix = rule?.prefix?.trim().replace(/-+$/, "");
  const serial = formatSerial(number, rule);
  return prefix ? `${prefix}-${serial}` : serial;
}

/**
 * The integer a printed number carries. The suffix is cut first because a suffix holding digits
 * (`/26`) would otherwise be read as the serial. Null means the text has no number in it, which is
 * what a temporary offline marker looks like.
 */
export function parseSerialNumber(value: string | null | undefined, suffix?: string | null): number | null {
  let text = String(value ?? "").trim();
  if (!text) return null;

  const tail = suffix?.trim();
  if (tail && text.endsWith(tail)) text = text.slice(0, -tail.length);

  const match = /(\d+)(?:\D*)$/.exec(text);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The narrowest width a rule may claim without shortening a number the book already holds. Suffix
 * characters count because they occupy the padded field the way Tally's do.
 */
export function minWidthForSerial(number: number | string, suffix?: string | null): number {
  const digits = String(Math.trunc(Math.abs(Number(number)) || 0));
  return digits.length + (suffix?.trim() ? suffix.trim().length : 0);
}

/** Reads a series' prefix, next number and rule out of a `sequences` object. */
export function readSeries(
  sequences: Record<string, any> | null | undefined,
  series: DocumentSeries
): { prefix: string; next: number; rule: NumberingRule } {
  const fields = NUMBERING_SERIES[series];
  const seq = sequences || {};
  const rule = normalizeNumberingRule((seq.numbering || {})[series]) || {};
  const fallbackNext = Number(fields.fallbackNext);
  const storedNext = Number(seq[fields.nextKey]);
  return {
    prefix: String(seq[fields.prefixKey] || fields.fallbackPrefix),
    next: Number.isFinite(storedNext) && storedNext > 0 ? Math.trunc(storedNext) : fallbackNext,
    rule,
  };
}

/** The number a series prints next, in the shape `previewNext*` has always returned. */
export function previewSeries(
  sequences: Record<string, any> | null | undefined,
  series: DocumentSeries
): string {
  const { prefix, next, rule } = readSeries(sequences, series);
  return formatDocumentNumber({ ...rule, prefix }, next);
}

/** A series ready for a generator: the prefix with no trailing dash, its cursor, and its rule. */
export function numberingFor(
  sequences: Record<string, any> | null | undefined,
  series: DocumentSeries
): { prefix: string; searchPrefix: string; next: number; rule: NumberingRule } {
  const read = readSeries(sequences, series);
  const prefix = read.prefix.replace(/-+$/, "");
  return { prefix, searchPrefix: `${prefix}-`, next: read.next, rule: read.rule };
}

/**
 * The serial a series hands out next: its stored cursor, raised past every number this till already
 * holds. A bill numbered while the server was unreachable is in that list, so it cannot be issued
 * twice once the cursor catches up.
 */
export function nextSerialAfter(
  cursor: number | null | undefined,
  numbers: (string | null | undefined)[],
  rule: NumberingRule
): number {
  let next = Number(cursor) || 1;
  for (const text of numbers) {
    const parsed = parseSerialNumber(text, rule.suffix);
    if (parsed !== null && parsed >= next) next = parsed + 1;
  }
  return next;
}
