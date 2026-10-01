import { getIpcBridge, registerMockHandler } from "../ipc/ipcBridge";
import { MockSqliteDatabase } from "./mockSqlite";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_lamsuite_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        module_key TEXT NOT NULL DEFAULT 'invoice',
        invoice_number TEXT NOT NULL UNIQUE,
        invoice_date TEXT NOT NULL,
        due_date TEXT,
        customer_id TEXT,
        customer_name TEXT,
        customer_gstin TEXT,
        place_of_supply TEXT,
        subtotal REAL NOT NULL DEFAULT 0,
        discount_total REAL NOT NULL DEFAULT 0,
        tax_total REAL NOT NULL DEFAULT 0,
        round_off REAL NOT NULL DEFAULT 0,
        grand_total REAL NOT NULL DEFAULT 0,
        paid_amount REAL NOT NULL DEFAULT 0,
        payment_mode TEXT NOT NULL DEFAULT 'cash',
        status TEXT NOT NULL DEFAULT 'issued',
        patient_name TEXT,
        doctor_name TEXT,
        doctor_reg_no TEXT,
        sync_state TEXT NOT NULL DEFAULT 'pending',
        external_id TEXT UNIQUE NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);
      CREATE INDEX IF NOT EXISTS idx_invoices_sync ON invoices(sync_state);

      CREATE TABLE IF NOT EXISTS invoice_items (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        hsn_code TEXT,
        batch_no TEXT,
        expiry_date TEXT,
        qty REAL NOT NULL,
        loose_qty REAL DEFAULT 0,
        units_per_pack INTEGER DEFAULT 1,
        unit_price REAL NOT NULL,
        mrp REAL,
        discount_percent REAL DEFAULT 0,
        discount_amount REAL DEFAULT 0,
        gst_percent REAL NOT NULL,
        cgst_amount REAL DEFAULT 0,
        sgst_amount REAL DEFAULT 0,
        igst_amount REAL DEFAULT 0,
        total_amount REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        barcode TEXT NOT NULL,
        name TEXT NOT NULL,
        print_name TEXT,
        generic_name TEXT,
        hsn_sac_code TEXT,
        category_id TEXT,
        brand_id TEXT,
        unit_id TEXT,
        mrp REAL NOT NULL,
        sel_rate REAL NOT NULL,
        ptr REAL,
        pts REAL,
        gst_percent REAL NOT NULL,
        units_per_pack INTEGER DEFAULT 1,
        rack_location TEXT,
        shelf_location TEXT,
        reorder_level REAL DEFAULT 0,
        current_stock REAL DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        external_id TEXT UNIQUE
      );

      CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

      CREATE TABLE IF NOT EXISTS product_batches (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        batch_no TEXT NOT NULL,
        mfg_date TEXT,
        expiry_date TEXT NOT NULL,
        stock_qty REAL NOT NULL DEFAULT 0,
        mrp REAL,
        purchase_rate REAL,
        selling_rate REAL,
        rack_location TEXT,
        shelf_location TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_batches_product ON product_batches(product_id);
      CREATE INDEX IF NOT EXISTS idx_batches_expiry ON product_batches(expiry_date);

      CREATE TABLE IF NOT EXISTS stock_transactions (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        batch_id TEXT,
        event_type TEXT NOT NULL,
        qty_delta REAL NOT NULL,
        unit_cost REAL,
        reference_type TEXT,
        reference_id TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_stock_tx_product ON stock_transactions(product_id);

      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
    `,
  },
];

let mockDb: MockSqliteDatabase | null = null;

export function getMockDatabase(): MockSqliteDatabase {
  if (!mockDb) {
    mockDb = new MockSqliteDatabase();
  }
  return mockDb;
}

export class SqliteStorageService {
  private initialized = false;

  constructor() {
    this.registerMockIpcHandlers();
  }

  private registerMockIpcHandlers() {
    const db = getMockDatabase();

    registerMockHandler("db:migrate", async () => {
      const latestVersion = MIGRATIONS[MIGRATIONS.length - 1].version;
      db.setSchemaVersion(latestVersion);
      return { success: true, version: latestVersion };
    });

    registerMockHandler("db:version", async () => {
      return { version: db.getSchemaVersion() };
    });

    registerMockHandler("db:insert", async (args) => {
      const { table, id, record } = (args as { table: string; id: string; record: Record<string, unknown> }) || {};
      if (!table || !id || !record) throw new Error("Missing table, id or record");
      db.insert(table, id, record);
      return { success: true };
    });

    registerMockHandler("db:findById", async (args) => {
      const { table, id } = (args as { table: string; id: string }) || {};
      return db.findById(table, id);
    });

    registerMockHandler("db:findAll", async (args) => {
      const { table } = (args as { table: string }) || {};
      return db.findAll(table);
    });

    registerMockHandler("db:delete", async (args) => {
      const { table, id } = (args as { table: string; id: string }) || {};
      if (!table || !id) throw new Error("Missing table or id");
      return { success: db.delete(table, id) };
    });

    registerMockHandler("db:execute", async (args) => {
      const { sql } = (args as { sql?: string }) || {};
      if (sql) {
        const match = sql.match(/DELETE\s+FROM\s+([a-zA-Z0-9_]+)/i);
        if (match) {
          db.clearTable(match[1]);
        }
      }
      return { success: true };
    });
  }

  async initDatabase(): Promise<number> {
    const bridge = getIpcBridge();
    const result = await bridge.invoke<{ success: boolean; version: number }>("db:migrate");
    this.initialized = true;
    return result.version;
  }

  async getDatabaseVersion(): Promise<number> {
    const bridge = getIpcBridge();
    const result = await bridge.invoke<{ version: number }>("db:version");
    return result.version;
  }

  async insertRecord(table: string, id: string, record: Record<string, unknown> | object): Promise<void> {
    const bridge = getIpcBridge();
    await bridge.invoke("db:insert", { table, id, record: record as Record<string, unknown> });
  }

  async findById<T = Record<string, unknown>>(table: string, id: string): Promise<T | null> {
    const bridge = getIpcBridge();
    return await bridge.invoke<T | null>("db:findById", { table, id });
  }

  async findAll<T = Record<string, unknown>>(table: string): Promise<T[]> {
    const bridge = getIpcBridge();
    return await bridge.invoke<T[]>("db:findAll", { table });
  }

  async deleteRecord(table: string, id: string): Promise<boolean> {
    const bridge = getIpcBridge();
    const res = await bridge.invoke<{ success: boolean }>("db:delete", { table, id });
    return Boolean(res?.success);
  }

  async executeSql(sql: string): Promise<void> {
    const bridge = getIpcBridge();
    const match = sql.match(/DELETE\s+FROM\s+([a-zA-Z0-9_]+)/i);
    if (match) {
      const table = match[1];
      if (bridge.runtime === "mock") {
        getMockDatabase().clearTable(table);
        return;
      }
    }
    await bridge.invoke("db:execute", { sql });
  }

  async clearTable(table: string): Promise<void> {
    await this.executeSql(`DELETE FROM ${table}`);
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export const sqliteStorage = new SqliteStorageService();
