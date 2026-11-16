export interface BusinessRuleErrorPayload {
  code: string;
  rule: string | null;
  line: number | null;
  field: string | null;
  message: string;
  fix: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const asLineNumber = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

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
