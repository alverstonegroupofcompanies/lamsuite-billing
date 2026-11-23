import { getResolvedApiBaseUrl } from "../../config/env";

/**
 * APR-003..010 — what the till does when the server answers "needs a grant".
 *
 * The counter's profile is applied by the server, so a bill above the owner's
 * discount or price threshold comes back as `approval_required` with the action
 * keys it named. That answer is not a dead end: an approver's PIN (or a
 * one-time PIN an administrator issued) is exchanged for a single-use grant,
 * and the same bill — same external id, so the grant still matches it — is sent
 * again with the token.
 */

export type ApprovalMode = "approver_pin" | "one_time_pin";

export class ApprovalRequiredError extends Error {
  readonly actions: string[];
  readonly reasons: Record<string, string>;
  readonly externalId: string;

  constructor(actions: string[], reasons: Record<string, string>, externalId: string) {
    super(reasons[actions[0]] || "This bill needs an approver before it can be saved.");
    this.name = "ApprovalRequiredError";
    this.actions = actions;
    this.reasons = reasons;
    this.externalId = externalId;
  }
}

export class ApprovalGrantError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApprovalGrantError";
    this.code = code;
  }
}

export interface ApprovalGrantRequest {
  externalId: string;
  actions: string[];
  mode: ApprovalMode;
  pin: string;
  identifier?: string;
  reason?: string;
}

/** Exchanges a PIN for the token the pending save needs. */
export async function requestApprovalGrant(request: ApprovalGrantRequest): Promise<string> {
  const res = await fetch(`${getResolvedApiBaseUrl()}/api/approvals/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      document_type: "invoice",
      document_external_id: request.externalId,
      actions: request.actions,
      mode: request.mode,
      identifier: request.identifier?.trim() || null,
      pin: request.pin,
      reason: request.reason?.trim() || null,
    }),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok || !body?.success || typeof body?.token !== "string") {
    throw new ApprovalGrantError(
      String(body?.code || "APPROVAL_GRANT_FAILED"),
      String(body?.error || body?.message || "The approval could not be granted.")
    );
  }

  return body.token as string;
}

const ACTION_LABELS: Record<string, string> = {
  "pos.discount": "Discount above this counter's limit",
  "pos.price_override": "Price changed beyond this counter's limit",
  "invoice.edit": "Editing a saved bill",
  "invoice.cancel": "Cancelling a bill",
  "return.create": "Return above this counter's limit",
  "return.purchase": "Purchase return above this counter's limit",
  "stock.adjust": "Stock adjustment above this counter's limit",
  "pos.sell_beyond_stock": "Selling stock the counter does not have",
};

export function approvalActionLabel(action: string): string {
  return ACTION_LABELS[action] || action;
}
