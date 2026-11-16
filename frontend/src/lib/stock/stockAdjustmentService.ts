import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch, type ProductItem } from "../masters/productsStore";
import {
  companySettingsService,
  DEFAULT_STOCK_ADJUSTMENT_POLICY,
  type StockAdjustmentPolicyConfig,
} from "../settings/companySettingsService";
import { syncQueueService } from "../sync/syncQueueService";
import { staffAuthService } from "../auth/staffAuthService";

export type StockAdjustmentMode = "adjustment" | "physical_count";

export const STOCK_ADJUSTMENT_REASONS = [
  "Damaged",
  "Expired",
  "Breakage",
  "Theft",
  "Found Stock",
  "Physical Count",
  "Other",
] as const;

export type StockAdjustmentReason = (typeof STOCK_ADJUSTMENT_REASONS)[number];

export interface StockAdjustmentLineInput {
  id?: string;
  product_id: string;
  product_name?: string;
  batch_id: string;
  batch_no?: string;
  system_qty?: number;
  adjustment_qty?: number;
  counted_qty?: number | null;
  unit_cost?: number;
  reason: StockAdjustmentReason | string;
  notes?: string;
}

export interface ResolvedStockAdjustmentLine extends StockAdjustmentLineInput {
  line_no: number;
  system_qty: number;
  adjustment_qty: number;
  unit_cost: number;
}

export interface StockAdjustmentDocumentInput {
  document_id?: string;
  mode: StockAdjustmentMode;
  reason?: string;
  notes?: string;
  document_date?: string;
  lines: StockAdjustmentLineInput[];
}

export interface StockAdjustmentValidation {
  errors: string[];
  lineErrors: Record<number, string[]>;
  totalQty: number;
  totalValue: number;
  requiresApproval: boolean;
}

export interface StockAdjustmentPostResult {
  success: boolean;
  document_id: string;
  status: "posted" | "pending_approval";
  requires_approval: boolean;
  lines_posted: number;
  total_qty: number;
  total_value: number;
  errors?: string[];
}

export class StockAdjustmentPolicyError extends Error {
  constructor(
    message: string,
    public errors: string[] = [message],
    public lineErrors: Record<number, string[]> = {}
  ) {
    super(message);
    this.name = "StockAdjustmentPolicyError";
  }
}

export function normalizeStockAdjustmentRole(role?: string | null): string {
  const value = String(role || "").trim().toLowerCase();
  if (!value) return "";
  if (["owner", "admin", "store_owner"].includes(value)) return "store_owner";
  if (value === "store_manager") return "manager";
  return value;
}

export function getStockAdjustmentPolicy(): StockAdjustmentPolicyConfig {
  const settings = companySettingsService.getSettings();
  return {
    ...DEFAULT_STOCK_ADJUSTMENT_POLICY,
    ...(settings.stock_adjustment_policy || {}),
  };
}

export function computeAdjustmentQty(
  systemQty: number,
  countedQty: number | null | undefined,
  explicitDelta: number | undefined,
  mode: StockAdjustmentMode
): number {
  if (mode === "physical_count") {
    if (countedQty === null || countedQty === undefined || Number.isNaN(Number(countedQty))) return 0;
    return Number((Number(countedQty) - Number(systemQty || 0)).toFixed(3));
  }
  return Number(explicitDelta || 0);
}

export function resolveStockAdjustmentLines(
  document: StockAdjustmentDocumentInput,
  batches: ProductBatch[],
  products: Record<string, ProductItem>
): { lines: ResolvedStockAdjustmentLine[]; lineErrors: Record<number, string[]> } {
  const lineErrors: Record<number, string[]> = {};
  const lines: ResolvedStockAdjustmentLine[] = [];

  document.lines.forEach((raw, index) => {
    const lineNo = index + 1;
    const batch = batches.find((b) => String(b.id) === String(raw.batch_id));
    if (!batch) {
      lineErrors[lineNo] = ["Select a product batch for this line."];
      return;
    }

    const product = products[String(batch.product_id)];
    const systemQty = Number(batch.stock_qty || 0);
    const delta = computeAdjustmentQty(systemQty, raw.counted_qty, raw.adjustment_qty, document.mode);

    lines.push({
      ...raw,
      line_no: lineNo,
      product_id: String(batch.product_id),
      product_name: raw.product_name || product?.name || "Unknown Product",
      batch_no: raw.batch_no || batch.batch_no,
      system_qty: systemQty,
      adjustment_qty: delta,
      unit_cost: Number(raw.unit_cost ?? batch.purchase_rate ?? 0),
    });
  });

  return { lines, lineErrors };
}

export function validateStockAdjustmentDocument(
  document: StockAdjustmentDocumentInput,
  resolvedLines: ResolvedStockAdjustmentLine[],
  initialLineErrors: Record<number, string[]> = {},
  options: { policy?: StockAdjustmentPolicyConfig; role?: string | null; now?: Date } = {}
): StockAdjustmentValidation {
  const policy = options.policy || getStockAdjustmentPolicy();
  const role = normalizeStockAdjustmentRole(options.role ?? staffAuthService.getCurrentSession()?.user?.role);
  const errors: string[] = [];
  const lineErrors: Record<number, string[]> = { ...initialLineErrors };
  const pushLine = (lineNo: number, message: string) => {
    lineErrors[lineNo] = [...(lineErrors[lineNo] || []), message];
  };

  if (!document.lines || document.lines.length === 0) {
    errors.push("Add at least one adjustment line.");
  }

  const allowedRoles = (policy.allowed_roles || []).map(normalizeStockAdjustmentRole).filter(Boolean);
  if (allowedRoles.length > 0 && role !== "super_admin" && !allowedRoles.includes(role)) {
    errors.push(
      `Your role (${role || "unknown"}) cannot post stock adjustments. Allowed roles: ${allowedRoles.join(", ")}.`
    );
  }

  if (policy.require_notes) {
    const hasNotes = String(document.notes || "").trim().length > 0;
    const hasLineReason = resolvedLines.some((l) => String(l.reason || "").trim().length > 0);
    if (!hasNotes && !hasLineReason) {
      errors.push("A note or reason is required for stock adjustments at this store.");
    }
  }

  const allowedReasons = (policy.allowed_reasons || []).map((r) => String(r).toLowerCase().trim());
  let totalQty = 0;
  let totalValue = 0;

  for (const line of resolvedLines) {
    const reason = String(line.reason || "").trim();
    if (!reason) {
      pushLine(line.line_no, "Select an adjustment reason.");
    } else if (allowedReasons.length > 0 && !allowedReasons.includes(reason.toLowerCase())) {
      pushLine(line.line_no, `Reason "${reason}" is not allowed by store policy.`);
    }

    if (line.adjustment_qty === 0) {
      pushLine(line.line_no, "Adjustment quantity cannot be zero.");
    }

    if (document.mode === "physical_count" && (line.counted_qty === null || line.counted_qty === undefined)) {
      pushLine(line.line_no, "Enter the physical counted quantity.");
    }

    if (policy.max_qty_per_line !== null && Math.abs(line.adjustment_qty) > policy.max_qty_per_line) {
      pushLine(
        line.line_no,
        `Quantity exceeds the ${policy.max_qty_per_line} unit per-line limit.`
      );
    }

    const balance = Number((line.system_qty + line.adjustment_qty).toFixed(3));
    if (!policy.allow_negative_stock && balance < 0) {
      pushLine(
        line.line_no,
        `Negative stock is blocked: this line would leave ${balance} units of ${line.product_name}.`
      );
    }

    totalQty += Math.abs(line.adjustment_qty);
    totalValue += Math.abs(line.adjustment_qty) * Number(line.unit_cost || 0);
  }

  if (policy.max_value_per_document !== null && totalValue > policy.max_value_per_document) {
    errors.push(
      `Document value ₹${totalValue.toFixed(2)} exceeds the ₹${Number(policy.max_value_per_document).toFixed(2)} per-adjustment limit.`
    );
  }

  const documentDate = String(document.document_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  if (policy.locked_before_date && documentDate <= String(policy.locked_before_date).slice(0, 10)) {
    errors.push(`Stock adjustments on or before ${policy.locked_before_date} are locked by the store policy.`);
  }

  if (policy.allowed_time_window?.start && policy.allowed_time_window?.end) {
    const now = options.now || new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (hhmm < policy.allowed_time_window.start || hhmm > policy.allowed_time_window.end) {
      errors.push(
        `Stock adjustments are only allowed between ${policy.allowed_time_window.start} and ${policy.allowed_time_window.end}.`
      );
    }
  }

  const requiresApproval =
    (policy.approval_threshold_value !== null && totalValue >= policy.approval_threshold_value) ||
    (policy.approval_threshold_qty !== null && totalQty >= policy.approval_threshold_qty);

  return {
    errors,
    lineErrors,
    totalQty: Number(totalQty.toFixed(3)),
    totalValue: Number(totalValue.toFixed(2)),
    requiresApproval,
  };
}

/**
 * Post a multi-line adjustment locally, write one ledger row per line and
 * enqueue exactly one sync event carrying the same document_id.
 */
export async function postStockAdjustment(
  document: StockAdjustmentDocumentInput,
  options: {
    policy?: StockAdjustmentPolicyConfig;
    role?: string | null;
    now?: Date;
    documentId?: string;
  } = {}
): Promise<StockAdjustmentPostResult> {
  const [batches, products] = await Promise.all([
    sqliteStorage.findAll<ProductBatch>("product_batches"),
    productsStore.getAllProducts(),
  ]);
  const productMap: Record<string, ProductItem> = {};
  for (const product of products) {
    productMap[product.id] = product;
  }

  const { lines, lineErrors } = resolveStockAdjustmentLines(document, batches, productMap);
  const validation = validateStockAdjustmentDocument(document, lines, lineErrors, {
    policy: options.policy,
    role: options.role,
    now: options.now,
  });

  if (validation.errors.length > 0 || Object.keys(validation.lineErrors).length > 0) {
    const allErrors = [...validation.errors, ...Object.values(validation.lineErrors).flat()];
    throw new StockAdjustmentPolicyError(allErrors[0] || "Stock adjustment validation failed", allErrors, validation.lineErrors);
  }

  const documentId =
    document.document_id ||
    options.documentId ||
    `adj_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const status: "posted" | "pending_approval" = validation.requiresApproval ? "pending_approval" : "posted";
  const documentDate = String(document.document_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const postedLines = lines.filter((line) => line.adjustment_qty !== 0);
  const now = Date.now();
  const ledgerRows: Array<{ id: string; record: Record<string, unknown> }> = [];
  const auditRows: Array<{ id: string; record: Record<string, unknown> }> = [];

  if (status === "posted") {
    const batchTotals = new Map<string, number>();

    for (const line of postedLines) {
      const batch = batches.find((b) => String(b.id) === String(line.batch_id));
      if (!batch) continue;

      batch.stock_qty = Number((Number(batch.stock_qty || 0) + line.adjustment_qty).toFixed(3));
      await productsStore.upsertBatch(batch);
      batchTotals.set(
        String(line.product_id),
        Number(((batchTotals.get(String(line.product_id)) || 0) + line.adjustment_qty).toFixed(3))
      );

      const txId = `stk_${documentId}_${line.line_no}`;
      ledgerRows.push({
        id: txId,
        record: {
          id: txId,
          product_id: line.product_id,
          batch_id: line.batch_id,
          event_type:
            document.mode === "physical_count"
              ? "RECONCILIATION_ADJUSTMENT"
              : line.adjustment_qty >= 0
              ? "ADJUSTMENT_IN"
              : "ADJUSTMENT_OUT",
          qty_delta: line.adjustment_qty,
          unit_cost: line.unit_cost,
          reference_type: "STOCK_ADJUSTMENT",
          reference_id: documentId,
          notes: `${line.reason}: ${line.notes || document.notes || ""}`.trim().replace(/:$/, ""),
          created_at: now,
        },
      });
    }

    for (const [productId, delta] of batchTotals.entries()) {
      const product = productMap[productId];
      if (product) {
        product.current_stock = Number((Number(product.current_stock || 0) + delta).toFixed(3));
        await productsStore.upsertProduct(product);
      }
    }

    if (ledgerRows.length > 0) {
      await sqliteStorage.insertBatch("stock_transactions", ledgerRows);
    }
  }

  await sqliteStorage.insertRecord("stock_adjustment_documents", documentId, {
    id: documentId,
    document_id: documentId,
    mode: document.mode,
    reason: document.reason || postedLines[0]?.reason || "",
    notes: document.notes || "",
    document_date: documentDate,
    status,
    requires_approval: validation.requiresApproval ? 1 : 0,
    total_qty: validation.totalQty,
    total_value: validation.totalValue,
    lines_json: JSON.stringify(postedLines),
    created_at: now,
  });

  auditRows.push({
    id: `audit_${documentId}`,
    record: {
      id: `audit_${documentId}`,
      event_type: status === "posted" ? "STOCK_ADJUSTMENT_POSTED" : "STOCK_ADJUSTMENT_SUBMITTED",
      user_id: staffAuthService.getCurrentSession()?.user?.id || null,
      user_name: staffAuthService.getCurrentSession()?.user?.full_name || null,
      counter_id: null,
      details: JSON.stringify({
        document_id: documentId,
        mode: document.mode,
        lines: postedLines.length,
        total_qty: validation.totalQty,
        total_value: validation.totalValue,
      }),
      ip_address: null,
      created_at: now,
    },
  });
  await sqliteStorage.insertBatch("security_audit_logs", auditRows);

  try {
    await syncQueueService.enqueue("stock_adjustment", documentId, "create", {
      id: documentId,
      document_id: documentId,
      mode: document.mode,
      reason: document.reason || postedLines[0]?.reason || "",
      notes: document.notes || "",
      document_date: documentDate,
      lines: postedLines.map((line) => ({
        product_id: line.product_id,
        batch_id: line.batch_id,
        batch_no: line.batch_no,
        adjustment_qty: line.adjustment_qty,
        counted_qty: line.counted_qty ?? null,
        unit_cost: line.unit_cost,
        reason: line.reason,
        notes: line.notes || null,
      })),
    });
  } catch {
    // Local post already succeeded; the sync queue retries on reconnect.
  }

  return {
    success: true,
    document_id: documentId,
    status,
    requires_approval: validation.requiresApproval,
    lines_posted: status === "posted" ? postedLines.length : 0,
    total_qty: validation.totalQty,
    total_value: validation.totalValue,
  };
}

export interface CsvInvalidRow {
  row: number;
  raw: string;
  error: string;
}

export interface CsvImportResult {
  validLines: StockAdjustmentLineInput[];
  invalidRows: CsvInvalidRow[];
  summary: { totalRows: number; validCount: number; invalidCount: number };
}

interface CsvColumnMap {
  product: number;
  batch: number;
  qty: number;
  reason: number;
  notes: number;
  cost: number;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function detectColumn(header: string[]): CsvColumnMap | null {
  const indexOf = (aliases: string[]) =>
    header.findIndex((h) => aliases.includes(String(h || "").trim().toLowerCase().replace(/[\s_-]+/g, "_")));

  const product = indexOf(["barcode", "product", "product_name", "item", "sku", "item_code", "name"]);
  const batch = indexOf(["batch", "batch_no", "batch_number", "lot", "lot_no"]);
  const qty = indexOf([
    "counted",
    "counted_qty",
    "physical",
    "physical_qty",
    "count",
    "qty",
    "quantity",
    "adjustment",
    "adjustment_qty",
    "qty_delta",
    "delta",
  ]);
  if (product < 0 || batch < 0 || qty < 0) return null;

  return {
    product,
    batch,
    qty,
    reason: indexOf(["reason", "event_type", "type"]),
    notes: indexOf(["notes", "note", "remarks", "remark", "explanation"]),
    cost: indexOf(["unit_cost", "cost", "purchase_rate", "rate"]),
  };
}

function isCountedColumn(header: string[]): boolean {
  if (!header || header.length === 0) return false;
  return header.some((h) =>
    ["counted", "counted_qty", "physical", "physical_qty", "count", "count_qty"].includes(
      String(h || "").trim().toLowerCase().replace(/[\s_-]+/g, "_")
    )
  );
}

/**
 * Parse CSV/TSV/XLSX-pasted rows into adjustment lines with a validation
 * preview. Rows referencing unknown barcodes/batches are reported, never
 * silently dropped or clamped.
 */
export function parseStockAdjustmentCsv(
  text: string,
  batches: ProductBatch[],
  products: ProductItem[],
  mode: StockAdjustmentMode
): CsvImportResult {
  const rawLines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  const invalidRows: CsvInvalidRow[] = [];
  const validLines: StockAdjustmentLineInput[] = [];
  if (rawLines.length === 0) {
    return { validLines, invalidRows, summary: { totalRows: 0, validCount: 0, invalidCount: 0 } };
  }

  const delimiter = rawLines[0].includes("\t") ? "\t" : ",";
  const firstCells = splitCsvLine(rawLines[0], delimiter);
  const headerMap = detectColumn(firstCells);
  const hasHeader = Boolean(headerMap);
  const dataRows = hasHeader ? rawLines.slice(1) : rawLines;
  const numericColumns = hasHeader && isCountedColumn(firstCells);

  const productByBarcode = new Map<string, ProductItem>();
  const productByName = new Map<string, ProductItem>();
  for (const product of products) {
    if (product.barcode) productByBarcode.set(String(product.barcode).trim().toLowerCase(), product);
    if (product.name) productByName.set(String(product.name).trim().toLowerCase(), product);
  }

  dataRows.forEach((raw, index) => {
    const rowNumber = index + (hasHeader ? 2 : 1);
    const cells = splitCsvLine(raw, delimiter);
    const column: CsvColumnMap =
      headerMap || { product: 0, batch: 1, qty: 2, reason: 3, notes: 4, cost: -1 };

    const productToken = String(cells[column.product] || "").trim();
    const batchToken = String(cells[column.batch] || "").trim();
    const qtyToken = String(cells[column.qty] || "").trim();

    if (!productToken) {
      invalidRows.push({ row: rowNumber, raw, error: "Product barcode/SKU is missing." });
      return;
    }
    if (!batchToken) {
      invalidRows.push({ row: rowNumber, raw, error: "Batch number is missing." });
      return;
    }

    const product =
      productByBarcode.get(productToken.toLowerCase()) || productByName.get(productToken.toLowerCase());
    if (!product) {
      invalidRows.push({ row: rowNumber, raw, error: `Product "${productToken}" not found.` });
      return;
    }

    const batch = batches.find(
      (b) => String(b.product_id) === String(product.id) && String(b.batch_no || "").toLowerCase() === batchToken.toLowerCase()
    );
    if (!batch) {
      invalidRows.push({
        row: rowNumber,
        raw,
        error: `Batch "${batchToken}" not found for ${product.name}.`,
      });
      return;
    }

    const qty = Number(qtyToken);
    if (!qtyToken || Number.isNaN(qty)) {
      invalidRows.push({ row: rowNumber, raw, error: "Quantity must be a number." });
      return;
    }

    const reasonToken = column.reason >= 0 ? String(cells[column.reason] || "").trim() : "";
    const reason =
      STOCK_ADJUSTMENT_REASONS.find((r) => r.toLowerCase() === reasonToken.toLowerCase()) ||
      (reasonToken ? reasonToken : mode === "physical_count" ? "Physical Count" : "Other");

    const line: StockAdjustmentLineInput = {
      product_id: String(product.id),
      product_name: product.name,
      batch_id: String(batch.id),
      batch_no: batch.batch_no,
      system_qty: Number(batch.stock_qty || 0),
      reason,
      notes: column.notes >= 0 ? String(cells[column.notes] || "").trim() : undefined,
      unit_cost:
        column.cost >= 0 && cells[column.cost] !== undefined && String(cells[column.cost]).trim() !== ""
          ? Number(cells[column.cost])
          : Number(batch.purchase_rate || 0),
    };

    if (mode === "physical_count" || (hasHeader && numericColumns)) {
      line.counted_qty = qty;
      line.adjustment_qty = computeAdjustmentQty(Number(batch.stock_qty || 0), qty, undefined, "physical_count");
    } else {
      line.adjustment_qty = qty;
    }

    validLines.push(line);
  });

  return {
    validLines,
    invalidRows,
    summary: {
      totalRows: dataRows.length,
      validCount: validLines.length,
      invalidCount: invalidRows.length,
    },
  };
}
