import { API_BASE_URL } from "../../config/env";
import { storeDeviceService } from "../auth/storeDeviceService";

/**
 * MIG-01 — the wizard drives the server pipeline, in the store's own database.
 *
 * The engine this replaced wrote rows into one workstation's SQLite and stamped
 * them "synced", so a store that completed all six green steps still had an
 * empty new system. Every call here goes to /api/till/migrations/*, where the
 * device token names the branch and the pipeline runs inside a database
 * transaction the admin panel, the portal and every other counter read from.
 */

export type MigrationSourceType = "api" | "file" | "device";

export interface MigrationIssue {
  type: "error" | "warning" | "info";
  category: string;
  message: string;
  details?: string[];
}

export interface PrecheckReport {
  can_proceed: boolean;
  record_counts: Record<string, number>;
  issues: MigrationIssue[];
  summary: {
    total_entities: number;
    total_records: number;
    warnings_count: number;
    errors_count: number;
  };
}

export interface MigrationStats {
  store?: number;
  lookups?: number;
  parties?: number;
  users?: number;
  products?: number;
  batches?: number;
  invoices?: number;
  purchases?: number;
  stock_adjustments?: number;
  transfers?: number;
  expenses?: number;
  payments?: number;
  held_bills?: number;
  unresolved?: number;
  errors?: string[];
  is_dry_run?: boolean;
}

export interface MigrationRun {
  id: number;
  run_uuid: string;
  store_id: number;
  source_type: MigrationSourceType;
  source_reference: string | null;
  status: "running" | "completed" | "failed" | "rolled_back";
  is_dry_run: boolean;
  progress_stats?: MigrationStats | null;
  error_message?: string | null;
  cutover_at?: string | null;
  cutover_phrase?: string | null;
  created_at: string;
  reconciliation_report?: ReconciliationReport | null;
}

export interface ReconciliationReport {
  id: number;
  is_passed: boolean;
  counts_comparison?: { source: Record<string, number>; target: Record<string, number> };
  financial_comparison?: {
    sales?: { source: number; target: number; diff: number };
    purchases?: { source: number; target: number; diff: number };
  };
  stock_comparison?: { total_stock_qty: number; valuation: number };
  balance_comparison?: { customer_balance: number; supplier_balance: number };
  discrepancies?: { category: string; entity: string; message: string }[];
}

export interface StartResult {
  run: MigrationRun;
  stats: MigrationStats;
  is_dry_run: boolean;
  reconciliation: ReconciliationReport | null;
  cutover_phrase?: string | null;
}

export interface BundleRef {
  bundle_ref: string;
  bytes: number;
  entities: Record<string, number>;
}

/** A refusal the server gave with a reason the operator can act on. */
export class MigrationRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "MigrationRequestError";
  }
}

const ENDPOINT = `${API_BASE_URL}/api/till/migrations`;

async function headersFor(json: boolean): Promise<Record<string, string>> {
  const headers = await storeDeviceService.getDeviceAuthHeaders();

  if (!headers["X-Device-Token"]) {
    throw new MigrationRequestError(
      "Claim this terminal to a counter before migrating store data.",
      0
    );
  }

  headers["Accept"] = "application/json";

  if (json) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; form?: FormData } = {}
): Promise<T> {
  const json = options.body !== undefined;

  const res = await fetch(`${ENDPOINT}${path}`, {
    method: options.method || (options.form ? "POST" : "GET"),
    headers: await headersFor(json),
    body: json ? JSON.stringify(options.body) : options.form,
  });

  const payload = (await res.json().catch(() => ({}))) as {
    message?: string;
    code?: string;
  };

  if (!res.ok) {
    throw new MigrationRequestError(
      payload.message || `Migration request failed (HTTP ${res.status}).`,
      res.status,
      payload.code
    );
  }

  return payload as T;
}

/** `{ success, data }` is the shape every migration endpoint answers with. */
async function unwrap<T>(path: string, options: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const payload = await request<{ success: boolean; message?: string; data: T }>(path, options);

  if (payload.success === false) {
    throw new MigrationRequestError(payload.message || "The server refused this migration step.", 200);
  }

  return payload.data;
}

export const tillMigrationService = {
  /** Hand the bundle to the server and keep only the reference it issues. */
  async uploadBundle(file: File): Promise<BundleRef> {
    const form = new FormData();
    form.append("bundle", file, file.name);

    return unwrap<BundleRef>("/bundle", { form });
  },

  async precheck(sourceType: MigrationSourceType, config: Record<string, unknown>): Promise<PrecheckReport> {
    return unwrap<PrecheckReport>("/precheck", {
      method: "POST",
      body: { source_type: sourceType, config },
    });
  },

  async start(
    sourceType: MigrationSourceType,
    config: Record<string, unknown>,
    isDryRun: boolean
  ): Promise<StartResult> {
    return unwrap<StartResult>("/start", {
      method: "POST",
      body: { source_type: sourceType, config, is_dry_run: isDryRun },
    });
  },

  async list(): Promise<MigrationRun[]> {
    return unwrap<MigrationRun[]>("");
  },

  async show(uuid: string): Promise<MigrationRun> {
    return unwrap<MigrationRun>(`/${encodeURIComponent(uuid)}`);
  },

  async reconcile(uuid: string, sourceType: MigrationSourceType, config: Record<string, unknown>): Promise<ReconciliationReport> {
    return unwrap<ReconciliationReport>(`/${encodeURIComponent(uuid)}/reconcile`, {
      method: "POST",
      body: { source_type: sourceType, config },
    });
  },

  async rollback(uuid: string): Promise<Record<string, number>> {
    return unwrap<Record<string, number>>(`/${encodeURIComponent(uuid)}/rollback`, { method: "POST" });
  },

  async cutover(uuid: string, confirmationPhrase: string): Promise<MigrationRun> {
    return unwrap<MigrationRun>(`/${encodeURIComponent(uuid)}/cutover`, {
      method: "POST",
      body: { confirmation_phrase: confirmationPhrase },
    });
  },
};
