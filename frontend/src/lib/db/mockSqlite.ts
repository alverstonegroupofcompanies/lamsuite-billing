export class MockSqliteDatabase {
  private tables = new Map<string, Map<string, Record<string, unknown>>>();
  private schemaVersion: number = 0;

  constructor() {
    this.reset();
  }

  reset() {
    this.tables.clear();
    this.schemaVersion = 0;
    this.ensureTable("schema_version");
    this.ensureTable("invoices");
    this.ensureTable("invoice_items");
    this.ensureTable("products");
    this.ensureTable("product_batches");
    this.ensureTable("stock_transactions");
    this.ensureTable("sync_queue");
    this.ensureTable("store_settings");
  }

  ensureTable(tableName: string): Map<string, Record<string, unknown>> {
    if (!this.tables.has(tableName)) {
      this.tables.set(tableName, new Map());
    }
    return this.tables.get(tableName)!;
  }

  insert(table: string, id: string, record: Record<string, unknown> | object): void {
    const t = this.ensureTable(table);
    t.set(id, { ...(record as Record<string, unknown>) });
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
    return t.delete(id);
  }

  clearTable(table: string): void {
    if (this.tables.has(table)) {
      this.tables.get(table)!.clear();
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
