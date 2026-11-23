import { describe, it, expect, beforeEach } from "vitest";
import { MIGRATIONS, sqliteStorage, getMockDatabase } from "./sqliteStorage";

describe("SQLite Storage Engine (SYNC-001, NFR-DATA-01)", () => {
  beforeEach(() => {
    getMockDatabase().reset();
  });

  it("initializes SQLite database and applies latest schema migration", async () => {
    const version = await sqliteStorage.initDatabase();
    expect(version).toBeGreaterThanOrEqual(2);

    const currentVersion = await sqliteStorage.getDatabaseVersion();
    expect(currentVersion).toBeGreaterThanOrEqual(2);
    expect(sqliteStorage.isInitialized()).toBe(true);
  });

  it("stores and retrieves invoice with items in local SQLite", async () => {
    await sqliteStorage.initDatabase();

    const invoiceId = "inv_001";
    const invoiceData = {
      id: invoiceId,
      invoice_number: "INV-2026-0001",
      invoice_date: "2026-09-30",
      customer_name: "Walk-in Customer",
      subtotal: 500,
      tax_total: 25,
      round_off: 0,
      grand_total: 525,
      paid_amount: 525,
      status: "issued",
      sync_state: "pending",
      external_id: "ext-uuid-1",
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    await sqliteStorage.insertRecord("invoices", invoiceId, invoiceData);

    const retrieved = await sqliteStorage.findById("invoices", invoiceId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.invoice_number).toBe("INV-2026-0001");
    expect(retrieved?.grand_total).toBe(525);
    expect(retrieved?.sync_state).toBe("pending");
  });

  it("stores products, batches, and double-entry stock transactions", async () => {
    await sqliteStorage.initDatabase();

    const productId = "prod_paracetamol";
    await sqliteStorage.insertRecord("products", productId, {
      id: productId,
      barcode: "8901234567890",
      name: "Paracetamol 500mg",
      mrp: 30,
      sel_rate: 25,
      gst_percent: 12,
      units_per_pack: 10,
      current_stock: 100,
    });

    const batchId = "batch_b01";
    await sqliteStorage.insertRecord("product_batches", batchId, {
      id: batchId,
      product_id: productId,
      batch_no: "B2026-01",
      expiry_date: "2027-12-31",
      stock_qty: 100,
    });

    const txId = "stk_tx_001";
    await sqliteStorage.insertRecord("stock_transactions", txId, {
      id: txId,
      product_id: productId,
      batch_id: batchId,
      event_type: "SALE",
      qty_delta: -10,
      created_at: Date.now(),
    });

    const batch = await sqliteStorage.findById("product_batches", batchId);
    expect(batch?.batch_no).toBe("B2026-01");

    const tx = await sqliteStorage.findById("stock_transactions", txId);
    expect(tx?.qty_delta).toBe(-10);
    expect(tx?.event_type).toBe("SALE");
  });

  it("enqueues mutation into sync_queue table for cloud sync worker", async () => {
    await sqliteStorage.initDatabase();

    const queueId = "queue_001";
    await sqliteStorage.insertRecord("sync_queue", queueId, {
      id: queueId,
      entity_type: "invoice",
      entity_id: "inv_001",
      action: "create",
      payload_json: JSON.stringify({ invoice_number: "INV-2026-0001" }),
      status: "pending",
      retry_count: 0,
      created_at: Date.now(),
    });

    const pending = await sqliteStorage.findAll("sync_queue");
    expect(pending.length).toBe(1);
    expect(pending[0].entity_type).toBe("invoice");
    expect(pending[0].status).toBe("pending");
  });
});

/**
 * CR-C Task 4.7: the till declares the charge tables field-for-field against
 * specs/02-plan.md 6.2 and finally declares the freight / bill-discount columns
 * purchaseService has written against since v2.0.41.
 */
describe("Purchase charge schema v9 (PUR-011, PUR-017, NFR-DATA-01)", () => {
  const chargeSchema = MIGRATIONS.find((m) => m.name === "purchase_bill_charges");
  if (!chargeSchema) throw new Error("the purchase_bill_charges migration was removed");
  const latest = MIGRATIONS[MIGRATIONS.length - 1];

  const tableSql = (name: string) => {
    const start = chargeSchema.sql.indexOf(`CREATE TABLE IF NOT EXISTS ${name}`);
    expect(start, `${name} is not declared`).toBeGreaterThanOrEqual(0);
    return chargeSchema.sql.slice(start, chargeSchema.sql.indexOf(");", start));
  };

  it("advances the declared schema to the newest migration", async () => {
    expect(chargeSchema.version).toBe(9);
    expect(latest.version).toBe(15);

    await sqliteStorage.initDatabase();
    expect(await sqliteStorage.getDatabaseVersion()).toBe(latest.version);
  });

  it("declares every column the server contract names", () => {
    const charges = tableSql("purchase_charges");
    for (const column of [
      "external_id", "store_id", "purchase_id", "seq", "head_code", "head_name", "note",
      "treatment", "spread_method", "spread_basis_used", "itc_eligibility", "is_rcm",
      "paid_separately", "in_payable", "paid_to_label", "place_of_supply", "sac_code", "amount", "gst_percent",
      "taxable_amount", "cgst_amount", "sgst_amount", "igst_amount", "cess_amount", "total_amount",
      "allocated_amount", "source", "expense_id", "reversed_amount", "created_by",
    ]) {
      expect(charges, `purchase_charges.${column}`).toContain(column);
    }

    const allocations = tableSql("purchase_charge_allocations");
    for (const column of [
      "store_id", "purchase_charge_id", "purchase_item_id", "batch_id",
      "basis_amount", "basis_share", "allocated_amount", "is_remainder_paisa",
    ]) {
      expect(allocations, `purchase_charge_allocations.${column}`).toContain(column);
    }

    // Charge atomicity: a child can never outlive its bill or its charge line.
    expect(charges).toContain("REFERENCES purchase_documents(id) ON DELETE CASCADE");
    expect(allocations).toContain("REFERENCES purchase_charges(id) ON DELETE CASCADE");
    expect(chargeSchema.sql).toContain("purchase_charge_alloc_charge_line_unique");
  });

  it("declares the freight and bill-discount columns the purchase writer has been using", () => {
    for (const column of ["freight_charges", "bill_discount_type", "bill_discount"]) {
      expect(chargeSchema.sql, `purchase_documents.${column}`).toContain(
        `ALTER TABLE purchase_documents ADD COLUMN ${column}`
      );
    }
    for (const column of ["gross_weight_kg", "charge_allocation", "landed_unit_cost", "original_purchase_item_id"]) {
      expect(chargeSchema.sql, `purchase_items.${column}`).toContain(`ALTER TABLE purchase_items ADD COLUMN ${column}`);
    }
    expect(chargeSchema.sql).toContain("ALTER TABLE product_batches ADD COLUMN landed_cost_rate");
  });
});

/**
 * CR-C Task 4.9 (PUR-012): an expense-treated charge lands in the on-device expense
 * register, and the register row has to say which bill and which charge line it came from.
 */
describe("Expense charge traceability v10 (PUR-012)", () => {
  const expenseSchema = MIGRATIONS.find((m) => m.name === "expense_charge_traceability");
  if (!expenseSchema) throw new Error("the expense_charge_traceability migration was removed");

  it("declares the columns that tie an expense row back to its charge line", () => {
    for (const column of [
      "purchase_id", "purchase_charge_id", "gst_percent", "cgst_amount", "sgst_amount",
      "igst_amount", "itc_eligibility", "paid_separately",
    ]) {
      expect(expenseSchema.sql, `expenses.${column}`).toContain(`ALTER TABLE expenses ADD COLUMN ${column}`);
    }
  });
});

/**
 * CR-C-11 Task 4.19 (PUR-013, PUR-016): a charge line's payable fact is stored with the line,
 * so a store turning `separately_paid_in_payable` on cannot restate a bill already printed.
 */
describe("Purchase charge payable flag v11 (PUR-013, PUR-016)", () => {
  const payableSchema = MIGRATIONS.find((m) => m.name === "purchase_charge_in_payable");
  if (!payableSchema) throw new Error("the purchase_charge_in_payable migration was removed");

  it("adds the column and backfills it from the rule the rows were posted under", () => {
    expect(payableSchema.version).toBe(11);
    expect(payableSchema.sql).toContain(
      "ALTER TABLE purchase_charges ADD COLUMN in_payable INTEGER NOT NULL DEFAULT 1"
    );
    expect(payableSchema.sql).toContain(
      "UPDATE purchase_charges SET in_payable = 0 WHERE paid_separately = 1"
    );
  });
});

/**
 * PAY-02: a till line has to say both what the bill kept and what the customer
 * handed over, or a ₹500 tender on a ₹210 bill is stored as a ₹500 payment.
 */
describe("Tender settlement columns v13 (PAY-02)", () => {
  const tenderSchema = MIGRATIONS.find((m) => m.name === "tender_applied_and_handed_over");
  if (!tenderSchema) throw new Error("the tender_applied_and_handed_over migration was removed");

  it("adds the columns the server keeps beside amount", () => {
    expect(tenderSchema.version).toBe(13);
    for (const column of ["tendered_amount", "change_amount"]) {
      expect(tenderSchema.sql, `invoice_payments.${column}`).toContain(
        `ALTER TABLE invoice_payments ADD COLUMN ${column} REAL`
      );
    }
  });
});

/**
 * GAP-01 / SPR-010: the bill header names a person, so the till has to keep
 * that person offline — the columns it writes and the cache it reads from.
 */
describe("Salesperson cache and bill columns v14 (SPR-010)", () => {
  const salespersonSchema = MIGRATIONS.find((m) => m.name === "salespeople_cache_and_bill_column");
  if (!salespersonSchema) throw new Error("the salespeople_cache_and_bill_column migration was removed");

  it("declares the columns a till writes a bill with", () => {
    expect(salespersonSchema.version).toBe(14);
    for (const column of ["salesperson_id", "salesperson_name"]) {
      expect(salespersonSchema.sql, `invoices.${column}`).toContain(
        `ALTER TABLE invoices ADD COLUMN ${column} TEXT`
      );
    }
  });

  it("declares the offline cache the type-ahead reads", () => {
    const start = salespersonSchema.sql.indexOf("CREATE TABLE IF NOT EXISTS salespeople");
    expect(start, "salespeople is not declared").toBeGreaterThanOrEqual(0);
    const table = salespersonSchema.sql.slice(start, salespersonSchema.sql.indexOf(");", start));
    for (const column of ["id", "store_id", "name", "code", "counter_ids_json", "has_pin", "is_active", "archived_at", "cache_synced_at"]) {
      expect(table, `salespeople.${column}`).toContain(column);
    }
    expect(salespersonSchema.sql).toContain("CREATE INDEX IF NOT EXISTS idx_salespeople_store ON salespeople(store_id, name)");
  });
});

/**
 * GAP-02 / PHR-005, PHR-006: an offline bill has to say who vouched for a
 * restricted drug, and the till has to know offline which staff hold a
 * registration and which items are scheduled. A PIN is never among them.
 */
describe("Pharmacist confirmation and drug schedule v15 (PHR-005, PHR-006)", () => {
  const pharmacistSchema = MIGRATIONS.find((m) => m.name === "pharmacist_confirmation_and_drug_schedule");
  if (!pharmacistSchema) throw new Error("the pharmacist_confirmation_and_drug_schedule migration was removed");

  it("adds the columns an offline bill stamps its pharmacist with", () => {
    expect(pharmacistSchema.version).toBe(15);
    for (const column of ["pharmacist_id", "pharmacist_name", "pharmacist_reg_no", "pharmacist_confirmed_at"]) {
      expect(pharmacistSchema.sql, `invoices.${column}`).toContain(
        `ALTER TABLE invoices ADD COLUMN ${column}`
      );
    }
  });

  it("adds the registration the confirmation prompt reads from the cache", () => {
    for (const column of ["is_pharmacist", "reg_no", "registration_valid", "registration_refusal"]) {
      expect(pharmacistSchema.sql, `salespeople.${column}`).toContain(
        `ALTER TABLE salespeople ADD COLUMN ${column}`
      );
    }
    expect(pharmacistSchema.sql).toContain("ALTER TABLE products ADD COLUMN schedule_code TEXT");
  });

  it("keeps the PIN out of the till", () => {
    expect(pharmacistSchema.sql).not.toMatch(/pin/i);
  });
});
