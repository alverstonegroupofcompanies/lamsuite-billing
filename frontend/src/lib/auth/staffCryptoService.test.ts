import { describe, it, expect } from "vitest";
import { staffCryptoService } from "./staffCryptoService";

describe("StaffCryptoService", () => {
  it("generates a random salt with requested length", () => {
    const salt1 = staffCryptoService.generateSalt(16);
    const salt2 = staffCryptoService.generateSalt(16);
    expect(salt1).toHaveLength(32); // 16 bytes = 32 hex chars
    expect(salt2).toHaveLength(32);
    expect(salt1).not.toBe(salt2);
  });

  it("hashes password and verifies successfully", async () => {
    const password = "StoreCashier@2026!";
    const hash = await staffCryptoService.hashSecret(password);
    expect(hash).toContain("$pbkdf2-sha256$");

    const isValid = await staffCryptoService.verifySecret(password, hash);
    expect(isValid).toBe(true);

    const isInvalid = await staffCryptoService.verifySecret("wrong_password", hash);
    expect(isInvalid).toBe(false);
  });

  it("hashes 4-digit quick PIN and verifies successfully", async () => {
    const pin = "4826";
    const pinHash = await staffCryptoService.hashPin(pin);
    expect(pinHash).toContain("$pbkdf2-sha256$");

    const isValid = await staffCryptoService.verifyPin(pin, pinHash);
    expect(isValid).toBe(true);

    const isInvalid = await staffCryptoService.verifyPin("9999", pinHash);
    expect(isInvalid).toBe(false);
  });

  it("rejects empty or corrupt stored hash", async () => {
    expect(await staffCryptoService.verifySecret("pass", "")).toBe(false);
    expect(await staffCryptoService.verifySecret("pass", "corrupted$hash")).toBe(false);
  });
});
