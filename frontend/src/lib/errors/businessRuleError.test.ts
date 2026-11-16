import { describe, expect, it } from "vitest";
import {
  formatBusinessRuleError,
  isBusinessRuleError,
  parseBusinessRuleError,
} from "./businessRuleError";

describe("businessRuleError", () => {
  const payload = {
    success: false,
    code: "QTY_LOOSE_NOT_ALLOWED",
    rule: "loose_sale",
    line: 2,
    field: "loose_qty",
    message: "This product is sealed; loose units cannot be sold.",
    fix: "Enter a whole number of strips.",
  };

  it("parses a direct payload", () => {
    expect(parseBusinessRuleError(payload)).toEqual({
      code: "QTY_LOOSE_NOT_ALLOWED",
      rule: "loose_sale",
      line: 2,
      field: "loose_qty",
      message: "This product is sealed; loose units cannot be sold.",
      fix: "Enter a whole number of strips.",
    });
  });

  it("parses an axios-style error", () => {
    const error = { response: { status: 422, data: payload } };
    expect(parseBusinessRuleError(error)?.code).toBe("QTY_LOOSE_NOT_ALLOWED");
  });

  it("parses a response-body wrapper", () => {
    expect(parseBusinessRuleError({ body: payload })?.line).toBe(2);
  });

  it("ignores generic validation errors", () => {
    expect(parseBusinessRuleError({ message: "The given data was invalid.", errors: {} })).toBeNull();
  });

  it("ignores non-objects and empty messages", () => {
    expect(parseBusinessRuleError(null)).toBeNull();
    expect(parseBusinessRuleError("boom")).toBeNull();
    expect(parseBusinessRuleError({ code: "X", message: "" })).toBeNull();
  });

  it("normalises a string line number and rejects invalid ones", () => {
    expect(parseBusinessRuleError({ ...payload, line: "3" })?.line).toBe(3);
    expect(parseBusinessRuleError({ ...payload, line: 0 })?.line).toBeNull();
    expect(parseBusinessRuleError({ ...payload, line: "abc" })?.line).toBeNull();
  });

  it("detects business-rule errors", () => {
    expect(isBusinessRuleError(payload)).toBe(true);
    expect(isBusinessRuleError({ code: "X" })).toBe(false);
  });

  it("formats the message with line and fix", () => {
    expect(formatBusinessRuleError(parseBusinessRuleError(payload)!)).toBe(
      "Line 2: This product is sealed; loose units cannot be sold. Enter a whole number of strips."
    );
    expect(
      formatBusinessRuleError({
        code: "X",
        rule: null,
        line: null,
        field: null,
        message: "Fix required.",
        fix: null,
      })
    ).toBe("Fix required.");
  });
});
