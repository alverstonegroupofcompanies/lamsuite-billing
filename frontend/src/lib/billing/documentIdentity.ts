export interface DocumentIdentityLike {
  id?: string;
  server_id?: string | number | null;
  external_id?: string | null;
  invoice_number?: string;
  module_key?: string | null;
  store_id?: string | number | null;
  invoice_date?: string;
  sync_state?: string;
  updated_at?: number;
  created_at?: number;
}

/**
 * Offline-first writes cache the same bill twice: once under the local id and
 * once under the server id returned by the sync push. Both copies carry the
 * same business identity, so every listing and total must collapse on this key.
 */
export function canonicalDocumentKey(record: DocumentIdentityLike): string {
  const externalId = record.external_id?.toString().trim();
  if (externalId) return `ext:${externalId}`;

  if (record.server_id !== undefined && record.server_id !== null) {
    return `srv:${record.server_id}`;
  }

  const number = (record.invoice_number || record.id || "").toString().trim().toUpperCase();
  const moduleKey = (record.module_key || "invoice").toString().trim().toLowerCase();
  const storeId = record.store_id === undefined || record.store_id === null ? "" : String(record.store_id);
  return `doc:${storeId}|${moduleKey}|${number}`;
}

function isTemporaryNumber(value: string | undefined): boolean {
  return typeof value === "string" && /^(TEMP|TMP|OFFLINE)/i.test(value.trim());
}

export { isTemporaryNumber };

/**
 * A number the counter issued while the till was out of contact is not the
 * book number: the server files the document under its own series and reports
 * the swap, and the till's copy has to follow it or the marker survives as the
 * document's identity (CNT-014).
 */
export interface ServerRenumbering {
  external_id?: string | null;
  from?: string | null;
  to: string;
  doc_type: string;
  counter_id?: number | null;
}

export function applyServerRenumbering<T extends DocumentIdentityLike>(
  records: T[],
  renumberings: ServerRenumbering[] | undefined
): T[] {
  if (!renumberings?.length) return records;

  return records.map((record) => {
    const hit = renumberings.find(
      (entry) =>
        (entry.external_id && record.external_id && String(entry.external_id) === String(record.external_id)) ||
        (entry.from && record.invoice_number === entry.from)
    );

    if (!hit || record.invoice_number === hit.to) return record;

    return { ...record, invoice_number: hit.to };
  });
}

function preferenceScore(record: DocumentIdentityLike): number {
  let score = 0;
  if (record.sync_state === "synced") score += 1;
  if (record.server_id !== undefined && record.server_id !== null && String(record.id) === String(record.server_id)) {
    score += 2;
  }
  if (record.invoice_number && !isTemporaryNumber(record.invoice_number)) score += 1;
  return score;
}

/** Keeps one row per business document, preferring the authoritative copy. */
export function dedupeDocuments<T extends DocumentIdentityLike>(records: T[]): T[] {
  const winners = new Map<string, T>();
  for (const record of records) {
    const key = canonicalDocumentKey(record);
    const current = winners.get(key);
    if (!current) {
      winners.set(key, record);
      continue;
    }

    const currentScore = preferenceScore(current);
    const nextScore = preferenceScore(record);
    const currentTime = Number(current.updated_at ?? current.created_at ?? 0);
    const nextTime = Number(record.updated_at ?? record.created_at ?? 0);

    if (nextScore > currentScore || (nextScore === currentScore && nextTime > currentTime)) {
      winners.set(key, record);
    }
  }
  return Array.from(winners.values());
}
