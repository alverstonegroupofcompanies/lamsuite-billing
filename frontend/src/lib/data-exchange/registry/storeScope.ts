import { sqliteStorage } from "../../db/sqliteStorage";

/**
 * P-STORE-SCOPE: the data-exchange registry works on the active store's local
 * catalog only. "" means no active store (rows stay untagged legacy data).
 */
export function activeStoreId(): string {
  return sqliteStorage.getActiveStoreId() || "";
}

/** Tag an imported row with the active store so it never lands in another store's catalog. */
export function withStore<T extends Record<string, unknown>>(row: T): T & { store_id?: string } {
  const store = activeStoreId();
  return store ? { ...row, store_id: store } : row;
}

/** Rows with no store_id are legacy pre-scope data on this device; they count as this store's. */
export function isForActiveStore(row: { store_id?: string }): boolean {
  return !row.store_id || String(row.store_id) === activeStoreId();
}
