import { describe, it, expect } from "vitest";
import { maskPhoneNumber, maskEmail, redactSecrets } from "../../src/security/mask.js";

describe("PII Masking & Secret Redaction", () => {
  it("masks customer phone numbers for roles without PII access", () => {
    const phone = "9876543210";
    const maskedCashier = maskPhoneNumber(phone, "cashier");
    expect(maskedCashier).toBe("98****3210");

    const maskedAuditor = maskPhoneNumber(phone, "auditor");
    expect(maskedAuditor).toBe("98****3210");
  });

  it("exposes full phone number for admin and manager roles", () => {
    const phone = "9876543210";
    expect(maskPhoneNumber(phone, "admin")).toBe("9876543210");
    expect(maskPhoneNumber(phone, "manager")).toBe("9876543210");
  });

  it("masks customer email for roles without PII access", () => {
    const email = "rahul.sharma@example.com";
    const masked = maskEmail(email, "cashier");
    expect(masked).toBe("r***a@example.com");
  });

  it("redacts auth tokens and passwords from objects", () => {
    const payload = {
      user: "cashier_1",
      password: "SuperSecretPassword123",
      api_token: "token_abc123xyz",
      store: {
        id: 1,
        authorization: "Bearer secret_bearer_token",
      },
    };

    const redacted = redactSecrets(payload);
    expect(redacted.password).toBe("[REDACTED_SECRET]");
    expect(redacted.api_token).toBe("[REDACTED_SECRET]");
    expect(redacted.store.authorization).toBe("[REDACTED_SECRET]");
    expect(redacted.user).toBe("cashier_1");
  });
});
