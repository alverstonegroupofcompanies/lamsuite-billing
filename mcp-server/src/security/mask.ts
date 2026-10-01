import { hasPermission, type UserRole } from "./roles.js";

/**
 * Mask phone numbers for privacy unless the role has `customers:view_pii`.
 * e.g., '9876543210' -> '98****3210'
 */
export function maskPhoneNumber(phone: string | undefined | null, role: UserRole): string {
  if (!phone) return "";
  if (hasPermission(role, "customers:view_pii")) {
    return phone;
  }

  const clean = phone.trim();
  if (clean.length <= 4) {
    return "****";
  }

  if (clean.length <= 7) {
    return clean.slice(0, 2) + "*".repeat(clean.length - 4) + clean.slice(-2);
  }

  // E.g., for 10 digits '9876543210' -> '98****3210'
  const visiblePrefix = 2;
  const visibleSuffix = 4;
  const maskLen = clean.length - visiblePrefix - visibleSuffix;
  return clean.slice(0, visiblePrefix) + "*".repeat(Math.max(2, maskLen)) + clean.slice(-visibleSuffix);
}

/**
 * Mask email address for privacy.
 * e.g. 'john.doe@example.com' -> 'j***e@example.com'
 */
export function maskEmail(email: string | undefined | null, role: UserRole): string {
  if (!email) return "";
  if (hasPermission(role, "customers:view_pii")) {
    return email;
  }

  const parts = email.split("@");
  if (parts.length !== 2) return "*****";
  const [user, domain] = parts;
  if (user.length <= 2) return `*@${domain}`;
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
}

/**
 * Redact sensitive fields in objects (e.g. passwords, bearer tokens, api keys)
 * before emitting to audit logs or public responses.
 */
export function redactSecrets(data: any): any {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map(redactSecrets);
  }

  const sensitiveKeys = [
    "password",
    "token",
    "api_token",
    "secret",
    "authorization",
    "bearer",
    "api_key",
    "private_key",
  ];

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    const isSensitive = sensitiveKeys.some((k) => key.toLowerCase().includes(k));
    if (isSensitive && typeof value === "string") {
      result[key] = "[REDACTED_SECRET]";
    } else if (typeof value === "object") {
      result[key] = redactSecrets(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}
