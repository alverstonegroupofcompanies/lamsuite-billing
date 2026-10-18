export class MockSqliteDatabase {
  private tables = new Map<string, Map<string, Record<string, unknown>>>();
  private schemaVersion: number = 0;

  constructor() {
    this.reset();
  }

  private isBrowser(): boolean {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  }

  reset() {
    this.tables.clear();
    this.schemaVersion = 0;
    this.ensureTable("schema_version");
    this.ensureTable("invoices");
    this.ensureTable("invoice_items");
    this.ensureTable("products");
    this.ensureTable("product_batches");
    this.ensureTable("customers");
    this.ensureTable("suppliers");
    this.ensureTable("doctors");
    this.ensureTable("patients");
    this.ensureTable("stock_transactions");
    this.ensureTable("sync_queue");
    this.ensureTable("store_settings");
    this.ensureTable("purchase_documents");
    this.ensureTable("purchase_items");
    this.ensureTable("sales_returns");
    this.ensureTable("sales_return_items");
    this.ensureTable("purchase_returns");
    this.ensureTable("quotations");
    this.ensureTable("expense_heads");
    this.ensureTable("party_ledger_entries");
    this.ensureTable("supplier_payments");
    this.ensureTable("expenses");
    this.ensureTable("customer_payments");
  }

  ensureTable(tableName: string): Map<string, Record<string, unknown>> {
    if (!this.tables.has(tableName)) {
      const map = new Map<string, Record<string, unknown>>();
      // Try restoring from localStorage if available
      if (this.isBrowser()) {
        try {
          const raw = window.localStorage.getItem(`lamsuite_tbl_${tableName}`);
          if (raw) {
            const entries: [string, Record<string, unknown>][] = JSON.parse(raw);
            for (const [k, v] of entries) {
              map.set(k, v);
            }
          }
        } catch {
          // ignore
        }
      }
      this.tables.set(tableName, map);
    }
    return this.tables.get(tableName)!;
  }

  private persistTable(tableName: string): void {
    if (this.isBrowser()) {
      try {
        const t = this.ensureTable(tableName);
        const entries = Array.from(t.entries());
        window.localStorage.setItem(`lamsuite_tbl_${tableName}`, JSON.stringify(entries));
      } catch {
        // ignore
      }
    }
  }

  insert(table: string, id: string, record: Record<string, unknown> | object): void {
    const t = this.ensureTable(table);
    t.set(id, { ...(record as Record<string, unknown>) });
    this.persistTable(table);

    // Keep purchases and purchase_documents synchronized in mock/browser mode
    if (table === "purchase_documents") {
      const alt = this.ensureTable("purchases");
      alt.set(id, { ...(record as Record<string, unknown>) });
      this.persistTable("purchases");
    } else if (table === "purchases") {
      const alt = this.ensureTable("purchase_documents");
      alt.set(id, { ...(record as Record<string, unknown>) });
      this.persistTable("purchase_documents");
    }
  }

  findById<T = Record<string, unknown>>(table: string, id: string): T | null {
    const t = this.ensureTable(table);
    let row = t.get(id);
    if (!row && table === "purchases") {
      row = this.ensureTable("purchase_documents").get(id);
    } else if (!row && table === "purchase_documents") {
      row = this.ensureTable("purchases").get(id);
    }
    return row ? ({ ...row } as T) : null;
  }

  findAll<T = Record<string, unknown>>(table: string, filter?: (item: Record<string, unknown>) => boolean): T[] {
    let rows: Record<string, unknown>[];
    if (table === "purchases" || table === "purchase_documents") {
      const docs = Array.from(this.ensureTable("purchase_documents").values());
      const alts = Array.from(this.ensureTable("purchases").values());
      const map = new Map<string, Record<string, unknown>>();
      for (const item of alts) {
        if (item && item.id) map.set(item.id as string, item);
      }
      for (const item of docs) {
        if (item && item.id) map.set(item.id as string, item);
      }
      rows = Array.from(map.values());
    } else {
      const t = this.ensureTable(table);
      rows = Array.from(t.values());
    }

    if (filter) {
      return rows.filter(filter) as T[];
    }
    return rows as T[];
  }

  delete(table: string, id: string): boolean {
    const t = this.ensureTable(table);
    const res = t.delete(id);
    this.persistTable(table);
    return res;
  }

  clearTable(table: string): void {
    if (this.tables.has(table)) {
      this.tables.get(table)!.clear();
    }
    if (this.isBrowser()) {
      try {
        window.localStorage.removeItem(`lamsuite_tbl_${table}`);
      } catch {
        // ignore
      }
    }
  }

  count(table: string): number {
    return this.ensureTable(table).size;
  }

  getSchemaVersion(): number {
    return this.schemaVersion;
  }

  setSchemaVersion(version: number): void {
    this.schemaVersion = version;
  }
}
