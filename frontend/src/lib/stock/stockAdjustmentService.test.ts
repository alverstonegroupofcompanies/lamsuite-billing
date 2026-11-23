import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { productsStore, type ProductBatch, type ProductItem } from "../masters/productsStore";
import { DEFAULT_STOCK_ADJUSTMENT_POLICY, type StockAdjustmentPolicyConfig } from "../settings/companySettingsService";
import {
  StockAdjustmentPolicyError,
  computeAdjustmentQty,
  parseStockAdjustmentCsv,
  postStockAdjustment,
  resolveStockAdjustmentLines,
  validateStockAdjustmentDocument,
  type StockAdjustmentDocumentInput,
  type StockAdjustmentLineInput,
} from "./stockAdjustmentService";

const product = (overrides: Partial<ProductItem>): ProductItem => ({
  id: "p1",
  name: "Paracetamol 500mg",
  barcode: "8901001",
  mrp: 20,
  sel_rate: 18,
  gst_percent: 12,
  units_per_pack: 10,
  current_stock: 100,
  is_active: true,
  ...overrides,
});

const batch = (overrides: Partial<ProductBatch>): ProductBatch => ({
  id: "b1",
  product_id: "p1",
  batch_no: "B-01",
  expiry_date: "2027-12-31",
  stock_qty: 100,
  purchase_rate: 10,
  ...overrides,
});

const line = (overrides: Partial<StockAdjustmentLineInput> = {}): StockAdjustmentLineInput => ({
  product_id: "p1",
  batch_id: "b1",
  adjustment_qty: -5,
  reason: "Damaged",
  notes: "broken strip",
  ...overrides,
});

const policy = (overrides: Partial<StockAdjustmentPolicyConfig> = {}): StockAdjustmentPolicyConfig => ({
  ...DEFAULT_STOCK_ADJUSTMENT_POLICY,
  ...overrides,
});

async function seed(): Promise<void> {
  await productsStore.upsertProduct(product({ id: "p1" }));
  await productsStore.upsertProduct(product({ id: "p2", name: "Dolo 650mg", barcode: "8901002", current_stock: 40 }));
  await productsStore.upsertBatch(batch({ id: "b1", product_id: "p1", stock_qty: 100 }));
  await productsStore.upsertBatch(batch({ id: "b2", product_id: "p2", batch_no: "D-02", stock_qty: 40 }));
}

describe("Stock adjustment documents (items 27-28)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    await seed();
  });

  it("computes physical-count deltas and keeps explicit adjustment deltas", () => {
    expect(computeAdjustmentQty(100, 95, undefined, "physical_count")).toBe(-5);
    expect(computeAdjustmentQty(20, 24, undefined, "physical_count")).toBe(4);
    expect(computeAdjustmentQty(20, null, undefined, "physical_count")).toBe(0);
    expect(computeAdjustmentQty(100, 95, -7, "adjustment")).toBe(-7);
  });

  it("resolves lines from batches, filling product name and system stock", async () => {
    const [batches, products] = await Promise.all([
      sqliteStorage.findAll<ProductBatch>("product_batches"),
      productsStore.getAllProducts(false),
    ]);
    const map: Record<string, ProductItem> = {};
    products.forEach((p) => (map[p.id] = p));

    const { lines, lineErrors } = resolveStockAdjustmentLines(
      { mode: "physical_count", lines: [{ product_id: "p1", batch_id: "b1", counted_qty: 95, reason: "Physical Count" }] },
      batches,
      map
    );

    expect(lineErrors).toEqual({});
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      line_no: 1,
      product_id: "p1",
      product_name: "Paracetamol 500mg",
      batch_no: "B-01",
      system_qty: 100,
      adjustment_qty: -5,
      unit_cost: 10,
    });
  });

  it("rejects lines whose batch cannot be found instead of guessing", () => {
    const { lines, lineErrors } = resolveStockAdjustmentLines(
      { mode: "adjustment", lines: [{ product_id: "p1", batch_id: "missing", adjustment_qty: 1, reason: "Other" }] },
      [batch({})],
      { p1: product({}) }
    );
    expect(lines).toHaveLength(0);
    expect(lineErrors[1][0]).toContain("batch");
  });

  it("blocks negative stock, disallowed roles and missing notes from the shared policy", async () => {
    const [batches, products] = await Promise.all([
      sqliteStorage.findAll<ProductBatch>("product_batches"),
      productsStore.getAllProducts(false),
    ]);
    const map: Record<string, ProductItem> = {};
    products.forEach((p) => (map[p.id] = p));

    const document: StockAdjustmentDocumentInput = {
      mode: "adjustment",
      lines: [line({ adjustment_qty: -150, notes: "", reason: "" })],
    };
    const { lines } = resolveStockAdjustmentLines(document, batches, map);

    const negative = validateStockAdjustmentDocument(document, lines, {}, {
      policy: policy({ require_notes: true }),
      role: "cashier",
    });
    expect(negative.errors.some((e) => e.includes("note"))).toBe(true);
    expect(negative.lineErrors[1].some((e) => e.toLowerCase().includes("negative stock"))).toBe(true);

    const roleBlocked = validateStockAdjustmentDocument(document, lines, {}, {
      policy: policy({ allowed_roles: ["store_owner"] }),
      role: "cashier",
    });
    expect(roleBlocked.errors.some((e) => e.includes("cannot post"))).toBe(true);

    const managerAllowed = validateStockAdjustmentDocument(document, lines, {}, {
      policy: policy({ allowed_roles: ["manager"], allow_negative_stock: true }),
      role: "store_manager",
    });
    expect(managerAllowed.errors).toEqual([]);
  });

  it("flags approval thresholds and value limits", async () => {
    const [batches, products] = await Promise.all([
      sqliteStorage.findAll<ProductBatch>("product_batches"),
      productsStore.getAllProducts(false),
    ]);
    const map: Record<string, ProductItem> = {};
    products.forEach((p) => (map[p.id] = p));
    const document: StockAdjustmentDocumentInput = { mode: "adjustment", lines: [line({ adjustment_qty: -10 })] };
    const { lines } = resolveStockAdjustmentLines(document, batches, map);

    const approval = validateStockAdjustmentDocument(document, lines, {}, {
      policy: policy({ approval_threshold_value: 50 }),
    });
    expect(approval.requiresApproval).toBe(true);
    expect(approval.totalValue).toBe(100);

    const overLimit = validateStockAdjustmentDocument(document, lines, {}, {
      policy: policy({ max_value_per_document: 25 }),
    });
    expect(overLimit.errors.some((e) => e.includes("per-adjustment limit"))).toBe(true);
  });

  it("locks documents dated before the policy cutoff", () => {
    const document: StockAdjustmentDocumentInput = {
      mode: "adjustment",
      document_date: "2026-01-01",
      lines: [line()],
    };
    const result = validateStockAdjustmentDocument(
      document,
      [{ ...line(), line_no: 1, system_qty: 100, adjustment_qty: -5, unit_cost: 10, product_name: "Paracetamol" }],
      {},
      { policy: policy({ locked_before_date: "2026-06-30" }) }
    );
    expect(result.errors.some((e) => e.includes("locked"))).toBe(true);
  });

  it("mirrors the counter's daily document and unit allowance", () => {
    const now = new Date("2026-11-22T10:00:00");
    const document: StockAdjustmentDocumentInput = { mode: "adjustment", lines: [line({ adjustment_qty: 6 })] };
    const resolved = [
      { ...line({ adjustment_qty: 6 }), line_no: 1, system_qty: 100, adjustment_qty: 6, unit_cost: 10, product_name: "Paracetamol" },
    ];

    const docCapped = validateStockAdjustmentDocument(document, resolved, {}, {
      policy: policy({ max_documents_per_day: 1 }),
      now,
      recentDocuments: [{ total_qty: 2, status: "posted", created_at: now.getTime() }],
    });
    expect(docCapped.errors.some((e) => e.includes("Daily stock adjustment limit"))).toBe(true);

    const rejectedIgnored = validateStockAdjustmentDocument(document, resolved, {}, {
      policy: policy({ max_documents_per_day: 1 }),
      now,
      recentDocuments: [{ total_qty: 2, status: "rejected", created_at: now.getTime() }],
    });
    expect(rejectedIgnored.errors).toEqual([]);

    const unitsCapped = validateStockAdjustmentDocument(document, resolved, {}, {
      policy: policy({ max_units_per_day: 10 }),
      now,
      recentDocuments: [{ total_qty: 6, status: "posted", created_at: now.getTime() }],
    });
    expect(unitsCapped.errors.some((e) => e.toLowerCase().includes("units"))).toBe(true);
  });

  it("posts one stock ledger row per line and updates batch and product stock", async () => {
    const result = await postStockAdjustment(
      {
        document_id: "adj_test_1",
        mode: "adjustment",
        notes: "Cycle count",
        lines: [line({ adjustment_qty: -5 }), line({ product_id: "p2", batch_id: "b2", adjustment_qty: 4, reason: "Found Stock" })],
      },
      { policy: policy() }
    );

    expect(result).toMatchObject({
      success: true,
      document_id: "adj_test_1",
      status: "posted",
      lines_posted: 2,
      total_qty: 9,
    });

    const b1 = await sqliteStorage.findById<ProductBatch>("product_batches", "b1");
    const b2 = await sqliteStorage.findById<ProductBatch>("product_batches", "b2");
    expect(b1?.stock_qty).toBe(95);
    expect(b2?.stock_qty).toBe(44);

    const p1 = await productsStore.getProductById("p1");
    const p2 = await productsStore.getProductById("p2");
    expect(p1?.current_stock).toBe(95);
    expect(p2?.current_stock).toBe(44);

    const txs = await sqliteStorage.findAll<{ reference_id: string; event_type: string; qty_delta: number }>(
      "stock_transactions"
    );
    expect(txs).toHaveLength(2);
    expect(txs.every((t) => t.reference_id === "adj_test_1")).toBe(true);
    expect(txs.map((t) => t.event_type).sort()).toEqual(["ADJUSTMENT_IN", "ADJUSTMENT_OUT"]);
    expect(txs.reduce((sum, t) => sum + Number(t.qty_delta), 0)).toBe(-1);

    const documents = await sqliteStorage.findAll<{ document_id: string; status: string; lines_json: string }>(
      "stock_adjustment_documents"
    );
    expect(documents).toHaveLength(1);
    expect(documents[0].document_id).toBe("adj_test_1");
    expect(documents[0].status).toBe("posted");

    const audit = await sqliteStorage.findAll<{ event_type: string }>("security_audit_logs");
    expect(audit.some((a) => a.event_type === "STOCK_ADJUSTMENT_POSTED")).toBe(true);

    const queue = await sqliteStorage.findAll<{ entity_type: string; entity_id: string; payload_json: string }>(
      "sync_queue"
    );
    const events = queue.filter((q) => q.entity_type === "stock_adjustment");
    expect(events).toHaveLength(1);
    expect(events[0].entity_id).toBe("adj_test_1");
    const payload = JSON.parse(events[0].payload_json);
    expect(payload.document_id).toBe("adj_test_1");
    expect(payload.lines).toHaveLength(2);
  });

  it("posts physical-count lines using counted minus system stock", async () => {
    const result = await postStockAdjustment(
      {
        mode: "physical_count",
        lines: [
          { product_id: "p1", batch_id: "b1", counted_qty: 95, reason: "Physical Count" },
          { product_id: "p2", batch_id: "b2", counted_qty: 44, reason: "Physical Count" },
        ],
      },
      { policy: policy() }
    );
    expect(result.status).toBe("posted");
    expect(result.total_qty).toBe(9);

    const txs = await sqliteStorage.findAll<{ event_type: string; qty_delta: number }>("stock_transactions");
    expect(txs).toHaveLength(2);
    expect(txs.every((t) => t.event_type === "RECONCILIATION_ADJUSTMENT")).toBe(true);
    expect(txs.map((t) => Number(t.qty_delta)).sort((a, b) => a - b)).toEqual([-5, 4]);
  });

  it("holds stock unchanged when the document needs approval", async () => {
    const result = await postStockAdjustment(
      {
        document_id: "adj_pending_1",
        mode: "adjustment",
        lines: [line({ adjustment_qty: -5 })],
      },
      { policy: policy({ approval_threshold_value: 1 }) }
    );

    expect(result.status).toBe("pending_approval");
    expect(result.requires_approval).toBe(true);
    expect(result.lines_posted).toBe(0);

    const b1 = await sqliteStorage.findById<ProductBatch>("product_batches", "b1");
    expect(b1?.stock_qty).toBe(100);
    expect(await sqliteStorage.findAll("stock_transactions")).toHaveLength(0);

    const documents = await sqliteStorage.findAll<{ status: string; requires_approval: number }>(
      "stock_adjustment_documents"
    );
    expect(documents[0].status).toBe("pending_approval");
    expect(documents[0].requires_approval).toBe(1);

    const audit = await sqliteStorage.findAll<{ event_type: string }>("security_audit_logs");
    expect(audit.some((a) => a.event_type === "STOCK_ADJUSTMENT_SUBMITTED")).toBe(true);
  });

  it("throws a policy error with per-line messages instead of posting partially", async () => {
    await expect(
      postStockAdjustment(
        { mode: "adjustment", lines: [line({ adjustment_qty: -150 }), line({ product_id: "p2", batch_id: "b2", adjustment_qty: 1 })] },
        { policy: policy() }
      )
    ).rejects.toBeInstanceOf(StockAdjustmentPolicyError);

    const b1 = await sqliteStorage.findById<ProductBatch>("product_batches", "b1");
    const b2 = await sqliteStorage.findById<ProductBatch>("product_batches", "b2");
    expect(b1?.stock_qty).toBe(100);
    expect(b2?.stock_qty).toBe(40);
    expect(await sqliteStorage.findAll("stock_transactions")).toHaveLength(0);
    expect(await sqliteStorage.findAll("stock_adjustment_documents")).toHaveLength(0);
  });

  it("parses comma-separated CSV with a validation preview and no silent clamping", async () => {
    const text = [
      "Barcode,Batch,Counted,Reason,Notes",
      "8901001,B-01,95,Damaged,broken strip",
      "9999999,B-01,10,Other,unknown product",
      "8901002,NOPE,5,Other,unknown batch",
      "8901002,D-02,not-a-number,Other,bad qty",
    ].join("\n");

    const [batches, products] = await Promise.all([
      sqliteStorage.findAll<ProductBatch>("product_batches"),
      productsStore.getAllProducts(false),
    ]);
    const result = parseStockAdjustmentCsv(text, batches, products, "physical_count");

    expect(result.summary).toEqual({ totalRows: 4, validCount: 1, invalidCount: 3 });
    expect(result.validLines).toHaveLength(1);
    expect(result.validLines[0]).toMatchObject({
      product_id: "p1",
      batch_id: "b1",
      counted_qty: 95,
      adjustment_qty: -5,
      notes: "broken strip",
    });
    expect(result.invalidRows.map((r) => r.row)).toEqual([3, 4, 5]);
    expect(result.invalidRows[0].error).toContain("not found");
    expect(result.invalidRows[1].error).toContain("Batch");
    expect(result.invalidRows[2].error).toContain("number");
  });

  it("accepts tab-separated spreadsheet pastes and adjustment deltas", async () => {
    const text = ["Product\tBatch\tAdjustment\n8901001\tB-01\t-3", "8901002\tD-02\t2"].join("\n");
    const [batches, products] = await Promise.all([
      sqliteStorage.findAll<ProductBatch>("product_batches"),
      productsStore.getAllProducts(false),
    ]);
    const result = parseStockAdjustmentCsv(text, batches, products, "adjustment");

    expect(result.validLines).toHaveLength(2);
    expect(result.validLines[0].adjustment_qty).toBe(-3);
    expect(result.validLines[1].adjustment_qty).toBe(2);
    expect(result.validLines[0].counted_qty).toBeUndefined();
  });
});
