export interface BusinessRuleErrorPayload {
  code: string;
  rule: string | null;
  line: number | null;
  field: string | null;
  message: string;
  fix: string | null;
  /** APR-003: the action keys an `approval_required` answer names. */
  actions?: string[];
  /** APR-003: why each action was deferred, keyed by action. */
  reasons?: Record<string, string>;
  /** PHR-004: the restricted lines an unconfirmed bill was refused for. */
  restricted_items?: RestrictedDrugLine[];
}

/** One line of a refused document, as the server's schedule list read it. */
export interface RestrictedDrugLine {
  line: number;
  product_id: number | null;
  product_name: string;
  batch_no: string | null;
  schedule_code: string;
  qty: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const asLineNumber = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

function asActions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const actions = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry !== "");

  return actions.length > 0 ? actions : undefined;
}

function asReasons(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;

  const reasons: Record<string, string> = {};

  for (const [action, message] of Object.entries(value)) {
    const text = asNonEmptyString(message);
    if (text) reasons[action] = text;
  }

  return Object.keys(reasons).length > 0 ? reasons : undefined;
}

function asRestrictedLines(value: unknown): RestrictedDrugLine[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const lines: RestrictedDrugLine[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) continue;

    const productName = asNonEmptyString(entry.product_name);
    if (!productName) continue;

    lines.push({
      line: asLineNumber(entry.line) ?? lines.length + 1,
      product_id: typeof entry.product_id === "number" ? entry.product_id : null,
      product_name: productName,
      batch_no: asNonEmptyString(entry.batch_no),
      schedule_code: (asNonEmptyString(entry.schedule_code) || "").toUpperCase(),
      qty: Number(entry.qty) || 0,
    });
  }

  return lines.length > 0 ? lines : undefined;
}

function fromPayload(candidate: Record<string, unknown>): BusinessRuleErrorPayload | null {
  const code = asNonEmptyString(candidate.code);
  const message = asNonEmptyString(candidate.message);
  if (!code || !message) return null;

  return {
    code,
    rule: asNonEmptyString(candidate.rule),
    line: asLineNumber(candidate.line),
    field: asNonEmptyString(candidate.field),
    message,
    fix: asNonEmptyString(candidate.fix),
    actions: asActions(candidate.actions),
    reasons: asReasons(candidate.reasons),
    restricted_items: asRestrictedLines(candidate.restricted_items),
  };
}

/**
 * Normalises structured API failures ({code, rule, line, field, message, fix})
 * from an axios/fetch error, a response body, or the payload itself.
 * Returns null for generic validation or network failures so callers keep their
 * existing fallback messaging.
 */
export function parseBusinessRuleError(input: unknown): BusinessRuleErrorPayload | null {
  if (!isRecord(input)) return null;

  const direct = fromPayload(input);
  if (direct) return direct;

  const response = input.response;
  if (isRecord(response) && isRecord(response.data)) {
    const nested = fromPayload(response.data);
    if (nested) return nested;
  }

  const body = input.body;
  if (isRecord(body)) {
    const nested = fromPayload(body);
    if (nested) return nested;
  }

  const data = input.data;
  if (isRecord(data)) {
    return fromPayload(data);
  }

  return null;
}

export function isBusinessRuleError(input: unknown): input is BusinessRuleErrorPayload {
  return parseBusinessRuleError(input) !== null;
}

/** One-line message for toasts; the fix hint is shown only when present. */
export function formatBusinessRuleError(payload: BusinessRuleErrorPayload): string {
  const location = payload.line ? `Line ${payload.line}: ` : "";
  return payload.fix ? `${location}${payload.message} ${payload.fix}` : `${location}${payload.message}`;
}
