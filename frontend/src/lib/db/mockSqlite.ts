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
  }

  findById<T = Record<string, unknown>>(table: string, id: string): T | null {
    const t = this.ensureTable(table);
    const row = t.get(id);
    return row ? ({ ...row } as T) : null;
  }

  findAll<T = Record<string, unknown>>(table: string, filter?: (item: Record<string, unknown>) => boolean): T[] {
    const t = this.ensureTable(table);
    const rows = Array.from(t.values());
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
