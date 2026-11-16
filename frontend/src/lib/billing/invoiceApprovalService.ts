import { getResolvedApiBaseUrl } from "../../config/env";

export type InvoiceApprovalAction = "edit" | "cancel";
export type InvoiceApprovalMode = "manager" | "one_time_pin";

export interface InvoiceApprovalGrant {
  id: string;
  token: string;
  action: InvoiceApprovalAction;
  mode: InvoiceApprovalMode;
  approvedByName: string;
  expiresAt: string;
}

export interface ApprovalVerifyResult {
  success: boolean;
  grant?: InvoiceApprovalGrant;
  error?: string;
  code?: string;
}

const GRANT_PREFIX = "lamsuite_invoice_approval_";

function storage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) return window.sessionStorage;
  } catch {
    // Private mode / sandboxed webview.
  }
  return null;
}

function authHeaders(storeId: string): Record<string, string> {
  let token: string | null = null;
  try {
    token =
      storage()?.getItem("staff_token") ??
      (typeof window !== "undefined" ? window.localStorage?.getItem("staff_token") : null) ??
      null;
  } catch {
    token = null;
  }
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Store-Id": storeId,
    "Store-Id": storeId,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Manager / administrator approval for editing or cancelling a saved invoice.
 * The server owns verification; the client only holds the short-lived grant.
 */
export class InvoiceApprovalService {
  async verifyManager(params: {
    storeId: string;
    invoiceId: string;
    action: InvoiceApprovalAction;
    identifier: string;
    secret: string;
    requestedBy?: string;
    counterCode?: string;
    reason?: string;
  }): Promise<ApprovalVerifyResult> {
    return this.verify(params.invoiceId, {
      action: params.action,
      mode: "manager",
      identifier: params.identifier.trim(),
      secret: params.secret,
      requested_by: params.requestedBy,
      counter_code: params.counterCode,
      reason: params.reason,
    }, params.storeId);
  }

  async verifyOneTimePin(params: {
    storeId: string;
    invoiceId: string;
    action: InvoiceApprovalAction;
    userId: string;
    pin: string;
    counterCode?: string;
    reason?: string;
  }): Promise<ApprovalVerifyResult> {
    return this.verify(params.invoiceId, {
      action: params.action,
      mode: "one_time_pin",
      user_id: params.userId,
      pin: params.pin.trim(),
      counter_code: params.counterCode,
      reason: params.reason,
    }, params.storeId);
  }

  saveGrant(invoiceId: string, grant: InvoiceApprovalGrant): void {
    try {
      storage()?.setItem(`${GRANT_PREFIX}${invoiceId}`, JSON.stringify(grant));
    } catch {
      // The caller still has the in-memory grant for this action.
    }
  }

  getGrant(invoiceId: string): InvoiceApprovalGrant | null {
    try {
      const raw = storage()?.getItem(`${GRANT_PREFIX}${invoiceId}`);
      if (!raw) return null;
      const grant = JSON.parse(raw) as InvoiceApprovalGrant;
      if (!grant?.id || !grant?.expiresAt) return null;
      if (new Date(grant.expiresAt).getTime() <= Date.now()) {
        this.clearGrant(invoiceId);
        return null;
      }
      return grant;
    } catch {
      return null;
    }
  }

  clearGrant(invoiceId: string): void {
    try {
      storage()?.removeItem(`${GRANT_PREFIX}${invoiceId}`);
    } catch {
      // Ignore storage failures.
    }
  }

  private async verify(
    invoiceId: string,
    body: Record<string, unknown>,
    storeId: string
  ): Promise<ApprovalVerifyResult> {
    try {
      const res = await fetch(
        `${getResolvedApiBaseUrl()}/api/invoices/${encodeURIComponent(invoiceId)}/approvals/verify`,
        {
          method: "POST",
          headers: authHeaders(storeId),
          body: JSON.stringify(body),
        }
      );

      const data = await res.json().catch(() => ({} as Record<string, unknown>));

      if (!res.ok || data?.success === false) {
        return {
          success: false,
          error: typeof data?.error === "string" ? data.error : "Approval failed.",
          code: typeof data?.code === "string" ? data.code : undefined,
        };
      }

      const approval = (data?.approval ?? {}) as Record<string, unknown>;
      const token = typeof data?.token === "string" ? data.token : "";
      if (!token) {
        return { success: false, error: "Approval response did not include a grant token." };
      }

      return {
        success: true,
        grant: {
          id: String(approval.id ?? ""),
          token,
          action: (approval.action as InvoiceApprovalAction) ?? (body.action as InvoiceApprovalAction),
          mode: (approval.mode as InvoiceApprovalMode) ?? (body.mode as InvoiceApprovalMode),
          approvedByName: String(approval.approved_by_name ?? ""),
          expiresAt: String(approval.expires_at ?? new Date(Date.now() + 5 * 60000).toISOString()),
        },
      };
    } catch {
      return {
        success: false,
        error: "Could not reach the server to verify approval. Connect to the store server and try again.",
      };
    }
  }
}

export const invoiceApprovalService = new InvoiceApprovalService();
