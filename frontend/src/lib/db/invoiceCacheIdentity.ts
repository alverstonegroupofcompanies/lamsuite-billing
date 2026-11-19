import { sqliteStorage } from "./sqliteStorage";

/**
 * A bill reaches the till's own cache under two identities: the key the till minted for it
 * (`ext_…`, `offline_inv_…`) and the numeric id the server gave it. The online post used to store
 * the row under both, and the register re-seeds by server id, so one bill ends up as two rows
 * holding two answers — a revision or a cancellation lands on one key while the register, the
 * drawer and the reports keep reading the other, which still shows the original money and
 * "issued". Every ingest therefore has to write one document to one key.
 */
export type InvoiceSnapshotIdentity = {
  id?: unknown;
  external_id?: unknown;
  invoice_number?: unknown;
  store_id?: unknown;
};

export type InvoiceIdentityState = {
  /** The single key this document lives on in the local cache. */
  canonicalKey: string;
  /** The till's own idempotency key, which must survive on the canonical row. */
  external_id?: string;
  /** True when an unpushed copy of this bill exists — the server snapshot must not be written. */
  skip: boolean;
};

const asKey = (value: unknown): string =>
  value === undefined || value === null ? "" : String(value).trim();

const isUnpushed = (row: Record<string, unknown>): boolean =>
  row.sync_state === "pending" || asKey(row.sync_status) === "pending";

/** Every line and tender the till holds for one bill, whatever key it was written under. */
export async function clearInvoiceChildren(invoiceKey: string): Promise<void> {
  const key = asKey(invoiceKey);
  if (!key) return;
  for (const table of ["invoice_items", "invoice_payments"] as const) {
    const rows = await sqliteStorage
      .findAll<Record<string, unknown>>(table)
      .catch(() => [] as Record<string, unknown>[]);
    for (const row of rows) {
      if (asKey(row.invoice_id) !== key) continue;
      const id = asKey(row.id);
      // Cache rows written before this change can carry the server line id as their record id
      // while being stored under the register's `item_…` primary key, so both forms are removed.
      for (const candidate of [id, `item_${id}`, `pay_${id}`]) {
        if (candidate) await sqliteStorage.deleteRecord(table, candidate);
      }
    }
  }
}

/**
 * Resolves an incoming server snapshot to the one local key for that bill and removes any older
 * twin, so the till is left with a single row, a single set of lines and a single status.
 */
export async function canonicalizeInvoiceIdentity(
  snapshot: InvoiceSnapshotIdentity
): Promise<InvoiceIdentityState> {
  const serverKey = asKey(snapshot.id);
  const extKey = asKey(snapshot.external_id);
  const number = asKey(snapshot.invoice_number);
  const storeId = asKey(snapshot.store_id);
  const state: InvoiceIdentityState = {
    canonicalKey: serverKey || extKey || number,
    external_id: extKey || undefined,
    skip: false,
  };
  if (!state.canonicalKey) return { ...state, canonicalKey: "", skip: true };

  const rows = await sqliteStorage
    .findAll<Record<string, unknown>>("invoices")
    .catch(() => [] as Record<string, unknown>[]);

  const matches: Record<string, unknown>[] = [];
  for (const row of rows) {
    const key = asKey(row.id);
    if (!key) continue;
    const sameDocument =
      key === state.canonicalKey ||
      (!!number &&
        asKey(row.invoice_number) === number &&
        (!storeId || !row.store_id || asKey(row.store_id) === storeId)) ||
      (!!extKey && (key === extKey || asKey(row.external_id) === extKey)) ||
      (!!serverKey && asKey(row.external_id) === serverKey);
    if (sameDocument) matches.push(row);
  }

  // A snapshot that names the server's id keys the bill by it, because that is the id the
  // register, the drawer and the print template already hand back. A summary that carries no
  // server id (the broadcast of a status change) keeps the row where this device already has it
  // rather than moving it — the till's queue entries reference the key the bill was given.
  if (matches.length > 0) {
    state.canonicalKey = serverKey
      ? serverKey
      : asKey(matches.reduce((a, b) => (Number(b.updated_at || 0) > Number(a.updated_at || 0) ? b : a)).id);
  }

  for (const row of matches) {
    if (isUnpushed(row)) state.skip = true;
    if (!state.external_id) {
      state.external_id =
        asKey(row.external_id) || (asKey(row.id) !== state.canonicalKey ? asKey(row.id) : "") || undefined;
    }
  }
  if (state.skip) return state;

  for (const row of matches) {
    const key = asKey(row.id);
    if (key === state.canonicalKey) continue;
    await clearInvoiceChildren(key);
    await sqliteStorage.deleteRecord("invoices", key);
  }
  return state;
}
