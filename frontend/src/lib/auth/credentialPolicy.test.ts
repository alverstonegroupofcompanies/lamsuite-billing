import { describe, it, expect } from "vitest";
import { validatePassword, validatePin } from "./credentialPolicy";

describe("credential policy", () => {
  it("rejects short or blank passwords", () => {
    expect(validatePassword("")).toContain("at least 8");
    expect(validatePassword("short")).toContain("at least 8");
  });

  it("accepts a password with at least 8 characters", () => {
    expect(validatePassword("StoreCashier@2026")).toBeNull();
  });

  it("rejects repeated and sequential PINs", () => {
    expect(validatePin("1111")).toContain("same digit");
    expect(validatePin("000000")).toContain("same digit");
    expect(validatePin("1234")).toContain("sequence");
    expect(validatePin("654321")).toContain("sequence");
  });

  it("rejects non-numeric or wrong-length PINs", () => {
    expect(validatePin("12a4")).toContain("4 to 6 numeric");
    expect(validatePin("123")).toContain("4 to 6 numeric");
    expect(validatePin("1234567")).toContain("4 to 6 numeric");
  });

  it("accepts a non-trivial PIN", () => {
    expect(validatePin("5829")).toBeNull();
    expect(validatePin("739146")).toBeNull();
  });
});
