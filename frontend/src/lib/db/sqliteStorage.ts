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
        taxable_subtotal REAL NOT NULL DEFAULT 0,
        discount_total REAL NOT NULL DEFAULT 0,
        tax_total REAL NOT NULL DEFAULT 0,
        cgst_total REAL NOT NULL DEFAULT 0,
        sgst_total REAL NOT NULL DEFAULT 0,
        igst_total REAL NOT NULL DEFAULT 0,
        cess_total REAL NOT NULL DEFAULT 0,
        round_off REAL NOT NULL DEFAULT 0,
        grand_total REAL NOT NULL DEFAULT 0,
        paid_amount REAL NOT NULL DEFAULT 0,
        payment_mode TEXT NOT NULL DEFAULT 'cash',
        status TEXT NOT NULL DEFAULT 'issued',
        store_state_code TEXT DEFAULT '32',
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
        allocated_discount REAL DEFAULT 0,
        taxable_amount REAL DEFAULT 0,
        gst_percent REAL NOT NULL,
        cgst_amount REAL DEFAULT 0,
        sgst_amount REAL DEFAULT 0,
        igst_amount REAL DEFAULT 0,
        cess_rate REAL DEFAULT 0,
        cess_amount REAL DEFAULT 0,
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
  {
    version: 2,
    name: "purchase_and_supplier_ledger_tables",
    sql: `
      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        gstin TEXT,
        address TEXT,
        state_code TEXT DEFAULT '32',
        place_of_supply TEXT DEFAULT 'Kerala',
        credit_period_days INTEGER DEFAULT 30,
        opening_balance REAL DEFAULT 0,
        outstanding_balance REAL DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS purchase_documents (
        id TEXT PRIMARY KEY,
        purchase_number TEXT NOT NULL UNIQUE,
        module_key TEXT NOT NULL DEFAULT 'purchase',
        supplier_id TEXT NOT NULL,
        supplier_name TEXT NOT NULL,
        supplier_gstin TEXT,
        supplier_invoice_no TEXT NOT NULL,
        purchase_date TEXT NOT NULL,
        due_date TEXT,
        place_of_supply TEXT,
        is_interstate INTEGER DEFAULT 0,
        is_rcm INTEGER DEFAULT 0,
        itc_eligibility TEXT DEFAULT 'eligible',
        subtotal REAL NOT NULL DEFAULT 0,
        discount_total REAL NOT NULL DEFAULT 0,
        tax_total REAL NOT NULL DEFAULT 0,
        cgst_total REAL NOT NULL DEFAULT 0,
        sgst_total REAL NOT NULL DEFAULT 0,
        igst_total REAL NOT NULL DEFAULT 0,
        cess_total REAL NOT NULL DEFAULT 0,
        round_off REAL NOT NULL DEFAULT 0,
        grand_total REAL NOT NULL DEFAULT 0,
        paid_amount REAL NOT NULL DEFAULT 0,
        payment_status TEXT NOT NULL DEFAULT 'unpaid',
        status TEXT NOT NULL DEFAULT 'received',
        notes TEXT,
        sync_state TEXT NOT NULL DEFAULT 'pending',
        external_id TEXT UNIQUE NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_purchase_docs_date ON purchase_documents(purchase_date);
      CREATE INDEX IF NOT EXISTS idx_purchase_docs_supplier ON purchase_documents(supplier_id);
      CREATE INDEX IF NOT EXISTS idx_purchase_docs_inv_no ON purchase_documents(supplier_invoice_no);

      CREATE VIEW IF NOT EXISTS purchases AS SELECT * FROM purchase_documents;

      CREATE TABLE IF NOT EXISTS purchase_items (
        id TEXT PRIMARY KEY,
        purchase_id TEXT NOT NULL REFERENCES purchase_documents(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        hsn_code TEXT,
        batch_id TEXT NOT NULL,
        batch_no TEXT NOT NULL,
        mfg_date TEXT,
        expiry_date TEXT NOT NULL,
        pack_qty REAL NOT NULL,
        loose_qty REAL DEFAULT 0,
        free_qty REAL DEFAULT 0,
        units_per_pack INTEGER DEFAULT 1,
        total_units REAL NOT NULL,
        purchase_rate REAL NOT NULL,
        discount_percent REAL DEFAULT 0,
        discount_amount REAL DEFAULT 0,
        effective_unit_cost REAL NOT NULL,
        taxable_amount REAL DEFAULT 0,
        mrp REAL,
        selling_rate REAL,
        gst_percent REAL NOT NULL,
        cgst_amount REAL DEFAULT 0,
        sgst_amount REAL DEFAULT 0,
        igst_amount REAL DEFAULT 0,
        cess_amount REAL DEFAULT 0,
        tax_amount REAL NOT NULL,
        total_amount REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_purchase_items_doc ON purchase_items(purchase_id);
      CREATE INDEX IF NOT EXISTS idx_purchase_items_prod ON purchase_items(product_id);

      CREATE TABLE IF NOT EXISTS party_ledger_entries (
        id TEXT PRIMARY KEY,
        party_id TEXT NOT NULL,
        party_type TEXT NOT NULL,
        entry_date TEXT NOT NULL,
        reference_type TEXT NOT NULL,
        reference_id TEXT NOT NULL,
        reference_number TEXT NOT NULL,
        debit_amount REAL NOT NULL DEFAULT 0,
        credit_amount REAL NOT NULL DEFAULT 0,
        running_balance REAL NOT NULL DEFAULT 0,
        payment_mode TEXT,
        notes TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_party_ledger_party ON party_ledger_entries(party_id);
      CREATE INDEX IF NOT EXISTS idx_party_ledger_date ON party_ledger_entries(entry_date);

      CREATE TABLE IF NOT EXISTS supplier_payments (
        id TEXT PRIMARY KEY,
        payment_number TEXT NOT NULL UNIQUE,
        supplier_id TEXT NOT NULL,
        supplier_name TEXT NOT NULL,
        payment_date TEXT NOT NULL,
        amount REAL NOT NULL,
        payment_mode TEXT NOT NULL,
        reference_no TEXT,
        purchase_id TEXT,
        notes TEXT,
        sync_state TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_supplier_payments_supp ON supplier_payments(supplier_id);

      CREATE TABLE IF NOT EXISTS purchase_orders (
        id TEXT PRIMARY KEY,
        po_number TEXT NOT NULL UNIQUE,
        supplier_id TEXT NOT NULL,
        supplier_name TEXT NOT NULL,
        po_date TEXT NOT NULL,
        expected_delivery_date TEXT,
        total_amount REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id TEXT PRIMARY KEY,
        po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        hsn_code TEXT,
        ordered_qty REAL NOT NULL,
        received_qty REAL DEFAULT 0,
        purchase_rate REAL NOT NULL,
        gst_percent REAL NOT NULL,
        total_amount REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS purchase_drafts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        supplier_id TEXT,
        supplier_name TEXT,
        supplier_invoice_no TEXT,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 3,
    name: "store_login_staff_and_multicounter",
    sql: `
      CREATE TABLE IF NOT EXISTS store_counters (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        counter_name TEXT NOT NULL,
        counter_code TEXT NOT NULL,
        device_uuid TEXT NOT NULL UNIQUE,
        is_hub INTEGER DEFAULT 0,
        ip_address TEXT,
        port INTEGER DEFAULT 8089,
        app_version TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        pending_queue_count INTEGER DEFAULT 0,
        last_sync_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS counter_sequences (
        id TEXT PRIMARY KEY,
        counter_id TEXT NOT NULL,
        doc_type TEXT NOT NULL,
        financial_year TEXT NOT NULL,
        prefix TEXT NOT NULL,
        next_number INTEGER NOT NULL DEFAULT 1001,
        range_start INTEGER,
        range_end INTEGER,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS staff_users (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        must_change_password INTEGER DEFAULT 0,
        biometric_registered INTEGER DEFAULT 0,
        failed_attempts INTEGER DEFAULT 0,
        locked_until INTEGER,
        permissions_json TEXT NOT NULL,
        enabled_menus_json TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS counter_sessions (
        id TEXT PRIMARY KEY,
        counter_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        user_role TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        status TEXT NOT NULL,
        opening_cash REAL DEFAULT 0,
        closing_cash REAL DEFAULT 0,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS security_audit_logs (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        user_id TEXT,
        user_name TEXT,
        counter_id TEXT,
        details TEXT,
        ip_address TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS document_locks (
        document_id TEXT PRIMARY KEY,
        document_type TEXT NOT NULL,
        locked_by_counter_id TEXT NOT NULL,
        locked_by_user_id TEXT NOT NULL,
        locked_by_user_name TEXT NOT NULL,
        locked_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS distributed_held_bills (
        id TEXT PRIMARY KEY,
        held_by_counter_id TEXT NOT NULL,
        held_by_counter_name TEXT NOT NULL,
        held_by_user_name TEXT NOT NULL,
        customer_name TEXT,
        items_count INTEGER NOT NULL,
        grand_total REAL NOT NULL,
        held_at INTEGER NOT NULL,
        cart_payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'held',
        claimed_by_counter_id TEXT,
        claimed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS cash_shifts (
        id TEXT PRIMARY KEY,
        counter_id TEXT NOT NULL,
        counter_name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        shift_date TEXT NOT NULL,
        opened_at INTEGER NOT NULL,
        closed_at INTEGER,
        opening_cash REAL NOT NULL DEFAULT 0,
        cash_in REAL NOT NULL DEFAULT 0,
        cash_out REAL NOT NULL DEFAULT 0,
        closing_cash_counted REAL,
        expected_cash REAL,
        cash_variance REAL,
        status TEXT NOT NULL DEFAULT 'open',
        payment_totals_json TEXT,
        notes TEXT,
        sync_state TEXT NOT NULL DEFAULT 'pending'
      );

      CREATE TABLE IF NOT EXISTS store_day_closes (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        close_date TEXT NOT NULL,
        closed_by_user_id TEXT NOT NULL,
        closed_by_user_name TEXT NOT NULL,
        counters_included_json TEXT NOT NULL,
        consolidated_sales REAL NOT NULL,
        consolidated_returns REAL NOT NULL,
        consolidated_net REAL NOT NULL,
        consolidated_by_tender_json TEXT NOT NULL,
        total_cash_variance REAL NOT NULL,
        closed_at INTEGER NOT NULL,
        sync_state TEXT NOT NULL DEFAULT 'pending'
      );

      CREATE TABLE IF NOT EXISTS master_versions (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL,
        updated_by_counter_id TEXT NOT NULL,
        PRIMARY KEY (entity_type, entity_id)
      );
    `,
  },
  {
    version: 6,
    name: "data_exchange_and_extended_masters",
    sql: `
      CREATE TABLE IF NOT EXISTS import_history (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        total_rows INTEGER NOT NULL,
        created_count INTEGER NOT NULL,
        updated_count INTEGER NOT NULL,
        skipped_count INTEGER NOT NULL,
        failed_count INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        imported_by TEXT NOT NULL,
        undo_snapshot_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_import_history_date ON import_history(created_at);

      CREATE TABLE IF NOT EXISTS import_drafts (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        file_name TEXT NOT NULL,
        raw_data_json TEXT NOT NULL,
        mappings_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS master_lookups (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        symbol TEXT,
        parent_name TEXT,
        address TEXT,
        precision INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS discount_rules (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        name TEXT NOT NULL,
        rule_type TEXT NOT NULL DEFAULT 'percentage',
        discount_percent REAL DEFAULT 0,
        min_quantity REAL DEFAULT 1,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS bank_accounts (
        id TEXT PRIMARY KEY,
        bank_name TEXT NOT NULL,
        account_number TEXT NOT NULL,
        ifsc_code TEXT,
        branch TEXT,
        upi_id TEXT,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS expense_heads (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'operational',
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS sales_returns (
        id TEXT PRIMARY KEY,
        return_number TEXT NOT NULL UNIQUE,
        original_invoice_no TEXT,
        return_date TEXT NOT NULL,
        customer_name TEXT,
        grand_total REAL NOT NULL DEFAULT 0,
        reason TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS purchase_returns (
        id TEXT PRIMARY KEY,
        return_number TEXT NOT NULL UNIQUE,
        supplier_name TEXT NOT NULL,
        return_date TEXT NOT NULL,
        grand_total REAL NOT NULL DEFAULT 0,
        reason TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS quotations (
        id TEXT PRIMARY KEY,
        quotation_number TEXT NOT NULL UNIQUE,
        quotation_date TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        grand_total REAL NOT NULL DEFAULT 0,
        valid_until TEXT,
        created_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 7,
    name: "create_expenses_and_customer_payments",
    sql: `
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        expense_number TEXT NOT NULL UNIQUE,
        expense_head TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        payment_mode TEXT NOT NULL DEFAULT 'Cash',
        reference_no TEXT,
        notes TEXT,
        expense_date TEXT NOT NULL,
        created_by TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customer_payments (
        id TEXT PRIMARY KEY,
        payment_number TEXT NOT NULL UNIQUE,
        customer_id TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        payment_mode TEXT NOT NULL DEFAULT 'Cash',
        reference_no TEXT,
        notes TEXT,
        payment_date TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
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

  registerMockIpcHandlers() {
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

    registerMockHandler("db:switchStore", async (args) => {
      const { store_id } = (args as { store_id: string }) || {};
      db.setStore(store_id || "default");
      return { success: true, store_id };
    });
  }

  async switchStore(storeId: string, relativeDbPath?: string): Promise<{ success: boolean; store_id: string }> {
    const bridge = getIpcBridge();
    const result = await bridge.invoke<{ success: boolean; store_id: string }>("db:switchStore", {
      store_id: storeId,
      relative_db_path: relativeDbPath,
    });
    // In mock mode ensure memory db is switched
    if (bridge.runtime === "mock") {
      getMockDatabase().setStore(storeId);
    }
    // Re-initialize schema on the target store database
    await this.initDatabase();
    return result;
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

  async updateRecord(table: string, id: string, partial: Record<string, unknown> | object): Promise<void> {
    const existing = (await this.findById<Record<string, unknown>>(table, id)) || {};
    await this.insertRecord(table, id, { ...existing, ...partial });
  }

  async findByField<T = Record<string, unknown>>(table: string, field: string, value: unknown): Promise<T | null> {
    const all = await this.findAll<T>(table);
    return (all as any[]).find((rec) => (rec as any)[field] === value) || null;
  }

  async findById<T = Record<string, unknown>>(table: string, id: string): Promise<T | null> {
    const bridge = getIpcBridge();
    if (table === "purchases" || table === "purchase_documents") {
      const primary = await bridge.invoke<T | null>("db:findById", { table: "purchase_documents", id }).catch(() => null);
      if (primary) return primary;
      const alt = await bridge.invoke<T | null>("db:findById", { table: "purchases", id }).catch(() => null);
      if (alt) return alt;
      return null;
    }
    return await bridge.invoke<T | null>("db:findById", { table, id });
  }

  async findAll<T = Record<string, unknown>>(table: string): Promise<T[]> {
    const bridge = getIpcBridge();
    if (table === "purchases" || table === "purchase_documents") {
      const primary = await bridge.invoke<T[]>("db:findAll", { table: "purchase_documents" }).catch(() => []);
      if (Array.isArray(primary) && primary.length > 0) return primary;
      const alt = await bridge.invoke<T[]>("db:findAll", { table: "purchases" }).catch(() => []);
      if (Array.isArray(alt) && alt.length > 0) return alt;
      return [];
    }
    return await bridge.invoke<T[]>("db:findAll", { table });
  }

  async count(table: string): Promise<number> {
    const records = await this.findAll(table);
    return Array.isArray(records) ? records.length : 0;
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
